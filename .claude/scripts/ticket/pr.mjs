// 팀 워크플로우 통합 — 아웃바운드 PR/status 코어 (통합 빌드 C단계, 순수).
// docs/team-workflow-integration-design.md 지점 C: 개발 결과 → PR·티켓 연결.
//
// 이 모듈은 순수하고 **트래커 무관**하다(I3) — gh 실행(pr create·issue comment)은 실행부가
// confirm 게이트 뒤에 한다. close 참조 서식(`Closes #N` 등)은 트래커별이라 provider가 렌더하며
// 여기서는 provider가 준 문자열을 받을 뿐이다. C는 pr-drafter를 **대체하지 않고** 그 산출
// (사람 승인된 요약) 위에 증거·링크를 얹는다.
//
// 세 어려운 지점을 코드로 강제한다:
//  (1) 증거 위조 금지(I1) — QA/TC 산출물의 *존재*만 정직 표기한다. "검증 완료/certified"를
//      만들지 않는다. 서명 receipt 검증은 release-tier-contract 몫이며 C는 첨부 여부만 말한다.
//  (2) close 대상 정합 — 닫을 이슈가 원장의 실제 청구(featureId↔ticketKey)와 일치할 때만
//      verified 링크한다. 불일치면 거부, 원장 미기록이면 non-closing 참조로 강등(provider 렌더가
//      자동 닫힘을 막음) — 엉뚱한/미확인 이슈 자동 닫힘 방지.
//  (3) STALE 완료 차단 — 픽업 후 상류 기획이 바뀌었으면(change-scope STALE) PR 완료를 막는다
//      (개발 *중*이 아니라 *완료* 시점 게이트 — 고정 스냅샷으로 개발하되 머지 전 재동기 요구).
import {isChangeScopeStale} from './pickup.mjs'

/**
 * 증거 번들에서 *존재하는 산출물만* 정직하게 요약한다(순수). 위조 없음 — 없는 건 없다고 한다.
 * tier는 첨부 성격의 라벨이지 통과 판정이 아니다:
 *  - 'no-evidence'                 : 아무 산출물 없음
 *  - 'diagnostic-only'             : TC 실행/단일 체크만(진단용 — release evidence 아님)
 *  - 'release-receipt-referenced'  : release receipt 객체가 첨부됨(유효/서명 검증은 C 밖 — 참조만)
 * @param {{tcResults?: Array<{id: string, verdict: 'pass'|'fail'|'not-run'}>, qaReports?: string[], releaseReceipt?: any}} [evidence]
 * @returns {{tier: string, tcResults: Array, qaReports: string[], hasReleaseReceipt: boolean, failingTcs: string[]}}
 */
export function summarizeEvidence(evidence = {}) {
  const tcResults = Array.isArray(evidence.tcResults) ? evidence.tcResults : []
  const qaReports = Array.isArray(evidence.qaReports) ? evidence.qaReports : []
  const hasReleaseReceipt = evidence.releaseReceipt != null
  const failingTcs = tcResults.filter(tc => tc.verdict === 'fail').map(tc => tc.id)
  let tier = 'no-evidence'
  if (hasReleaseReceipt) tier = 'release-receipt-referenced'
  else if (tcResults.length > 0 || qaReports.length > 0) tier = 'diagnostic-only'
  return {tier, tcResults, qaReports, hasReleaseReceipt, failingTcs}
}

/**
 * PR을 완료(링크)해도 되는지 게이트(순수). 하드 차단:
 *  - stale-change-scope : 상류 기획 변경(픽업 스냅샷과 현재 unit 불일치) → 재동기 요구
 *  - failing-tc         : TC 실행 결과에 fail 존재 → 통과 안 된 PR을 "준비됨"으로 링크 금지
 * no-evidence는 하드 차단이 아니라 본문에 정직 표기(진단 안 됨). 차단 아님 ≠ 통과.
 * @param {Object} args {changeScope, currentUnit, evidence}
 * @returns {{ok: boolean, blockers: string[], summary: Object}}
 */
export function completionGate({changeScope, currentUnit, evidence}) {
  const summary = summarizeEvidence(evidence)
  const blockers = []
  if (isChangeScopeStale(changeScope, currentUnit)) blockers.push('stale-change-scope')
  if (summary.failingTcs.length > 0) blockers.push('failing-tc')
  return {ok: blockers.length === 0, blockers, summary}
}

/**
 * `Closes #N` 대상이 원장의 실제 청구와 일치하는지 확인한다(순수). 엉뚱한 이슈 자동 닫힘 방지.
 *  - 원장에 이 FEAT 청구가 있고 ticketKey가 같음 → verified 링크
 *  - 원장 청구가 있는데 ticketKey 불일치       → 거부(CLOSE_TARGET_MISMATCH)
 *  - 원장에 청구 없음(아직 미기록)              → 링크하되 verified=false(정직: 소유 미확인)
 * @param {{featureId: string, ticketKey: string|number, ledgerState: Map}} args
 * @returns {{ok: boolean, closes?: string, verified?: boolean, error?: string, warning?: string}}
 */
export function computeCloseLink({featureId, ticketKey, ledgerState}) {
  const key = String(ticketKey ?? '').trim()
  if (!key) return {ok: false, error: 'MISSING_TICKET_KEY'}
  const record = ledgerState?.get?.(featureId) ?? null
  if (record && String(record.ticketKey) !== key) {
    return {ok: false, error: 'CLOSE_TARGET_MISMATCH', warning: `원장 청구 ${record.ticketKey} ≠ 링크 대상 ${key}`}
  }
  return {ok: true, closes: key, verified: record != null}
}

/**
 * PR 완료를 원장에 반영할지 멱등 판정(순수). 이미 prUrl 있으면 재링크 금지.
 * @param {{featureId: string, ledgerState: Map, prUrl: string, now: string}} args
 * @returns {{status: 'already-linked'|'link', existing?: string, record?: Object}}
 */
export function computePrLinkPlan({featureId, ledgerState, prUrl, now}) {
  const record = ledgerState?.get?.(featureId) ?? null
  if (record?.prUrl) return {status: 'already-linked', existing: record.prUrl}
  return {
    status: 'link',
    // 원장 append 레코드 — 기존 청구 필드를 보존하며 prUrl만 채운다(없으면 최소 필드).
    record: {
      featureId,
      ticketKey: record ? String(record.ticketKey) : null,
      contentHash: record?.contentHash ?? null,
      createdAt: record?.createdAt ?? now,
      prUrl,
    },
  }
}

/**
 * PR 본문을 만든다(순수, 트래커 무관). pr-drafter 요약 위에 close 참조 + 증거 요약을 얹는다.
 * close 참조 줄(`Closes #N` 등)은 트래커별 서식이라 **여기서 만들지 않고** provider가 렌더한
 * 문자열(`closeLine`)을 그대로 받는다(I3 — GitHub 구문 유출 금지). null이면 링크 없음.
 * 증거 블록은 *존재하는 산출물만* 나열하고 tier를 정직 라벨한다 — "검증 통과"를 주장하지 않는다.
 * @param {Object} args {summary(사람 요약, pr-drafter), changeScope, closeLine(provider 렌더|null), evidence}
 * @returns {string}
 */
export function buildPrBody({summary, changeScope, closeLine, evidence}) {
  const ev = summarizeEvidence(evidence)
  const lines = [summary?.trim() || '(pr-drafter 요약 없음)', '']
  if (closeLine) {
    lines.push(closeLine)
    lines.push('')
  }
  lines.push('## web-harness 추적성')
  lines.push(`- FEAT: ${changeScope?.featureId ?? '(미상)'}`)
  lines.push(`- TC: ${(changeScope?.testCaseIds ?? []).join(', ') || '(없음 — 스펙 미완)'}`)
  lines.push(`- change-scope digest: \`${changeScope?.sourceDigest ?? '(없음)'}\``)
  lines.push('')
  lines.push('## 첨부 증거 (존재 여부 — 통과 판정 아님)')
  lines.push(`- 릴리스 tier: **${ev.tier}**`)
  if (ev.tcResults.length > 0) {
    for (const tc of ev.tcResults) lines.push(`  - ${tc.id}: ${tc.verdict}`)
  }
  if (ev.qaReports.length > 0) lines.push(`- QA 리포트: ${ev.qaReports.join(', ')}`)
  lines.push('')
  lines.push('> 첨부는 산출물 *존재*를 뜻하며 검증 통과를 의미하지 않는다. 서명 release receipt')
  lines.push('> 검증은 release-tier-contract 몫이다(C는 위조하지 않는다).')
  return lines.join('\n')
}
