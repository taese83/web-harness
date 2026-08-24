// 팀 워크플로우 통합 — 아웃바운드 emit 코어 (통합 빌드 2단계).
// docs/team-workflow-integration-design.md 지점 A: feature-plan 단위 → 티켓.
//
// 이 모듈은 **순수 오케스트레이션 코어**다 — 멱등 emit-plan(create/update/close/unchanged)을
// 계산할 뿐, 외부 티켓 생성·원장 쓰기(side-effect)는 하지 않는다. 실제 발행은 confirm 게이트를
// 통과한 runner가 provider.emit + 원장 append로 수행한다(미리보기→확인→생성).
//
// **분배(assignment)는 emit의 일부가 아니다.** emit은 티켓 "생성"만 하고, "누가 맡느냐"는
// 선택적 하류 단계(트래커 assignee)다 — 혼자 개발이면 분배 없이 본인이 픽업한다. 그래서
// 이 코어는 assignee를 전혀 모른다.

import {createHash} from 'node:crypto'

const sha256 = value => createHash('sha256').update(value).digest('hex')
const uniqueSorted = values => [...new Set(values)].sort()

/**
 * feature-plan 단위 하나를 **TicketDraft**(사전-발행 payload)로 만든다(순수).
 * ticketId는 미정(null) — provider.create가 발행 시 부여하며, 그때 완전한 NormalizedTicket이
 * 된다(normalize.mjs의 validateNormalizedTicket은 ticketId 문자열을 요구하므로 draft 자체는
 * 그 검증을 통과하지 않는다 — 의도된 상태 구분). AC = 연결된 TC 참조, 상세 동작은 body.
 * specCompleteness로 스펙 완결성만 보고(게이트 안 함).
 * @param {{featureId: string, title?: string, body?: string, testCaseIds?: string[], type?: string}} unit
 * @returns {Object} TicketDraft (ticketId:null, provider:'pending')
 */
export function buildTicketDraft(unit) {
  const testCaseIds = uniqueSorted(unit.testCaseIds ?? [])
  const missing = []
  if (!unit.body) missing.push('behavior')
  if (testCaseIds.length === 0) missing.push('testCaseIds')
  return {
    ticketId: null,              // provider가 생성 시 부여
    provider: 'pending',
    sourceKey: unit.featureId,   // 하네스측 안정 식별자(왕복 앵커)
    title: unit.title || unit.featureId,
    body: unit.body ?? '',
    acceptanceCriteria: testCaseIds.map(id => `${id}`),
    type: unit.type ?? 'feature',
    harnessRefs: {featureIds: [unit.featureId], testCaseIds},
    specCompleteness: {ready: missing.length === 0, missing},
  }
}

/**
 * 재발행 멱등 판정용 내용 해시. 티켓에 실리는 필드만 정규화해 해시 —
 * 순서·중복에 안정적이라 같은 내용이면 같은 해시(불필요한 갱신 방지).
 * @param {{title?: string, body?: string, testCaseIds?: string[], type?: string}} unit
 */
export function unitContentHash(unit) {
  return sha256(JSON.stringify({
    title: unit.title ?? '',
    body: unit.body ?? '',
    testCaseIds: uniqueSorted(unit.testCaseIds ?? []),
    type: unit.type ?? 'feature',
  }))
}

/**
 * feature-plan 단위들과 기존 원장 상태를 비교해 멱등 emit-plan을 만든다(순수).
 * 이것이 미리보기(dry-run)이며, 어떤 외부 쓰기도 하기 전에 사람이 확인한다.
 *
 * 규율(설계 A): 새 FEAT→생성, 내용 변경→갱신, 무변경→건너뜀, 원장에 있으나 units에서
 * 사라진 FEAT→닫기. 이는 plan-delta의 stable-ID 사상과 같은 축이되, 대상이 "계획 스냅샷"이
 * 아니라 "티켓 발행 상태"라 별개 구현이다(정직 표기 — 문자 그대로의 재사용이 아님).
 *
 * @param {Array} units
 * @param {Map<string, {ticketKey: string, contentHash: string, closed?: boolean}>} ledgerState
 * @returns {{create: Array, update: Array, close: Array, unchanged: Array}}
 */
export function computeEmitPlan(units, ledgerState = new Map()) {
  // vacuous close-all 가드(리뷰 HIGH, plan-delta NO_STABLE_IDS와 같은 관용구): 파서가 형식
  // 미커버(예: 표 형식 계획)로 unit 0개를 조용히 반환하면, 열린 원장과 결합 시 "전 티켓 닫기"
  // 계획이 나온다. 빈 units + 열린 청구 존재는 정당한 상태가 아니라 상류 결함 신호 — loud fail.
  const openClaims = [...ledgerState.values()].filter(entry => !entry.closed)
  if ((units?.length ?? 0) === 0 && openClaims.length > 0) {
    throw new Error(`EMPTY_UNITS_CLOSE_ALL: 계획에서 unit 0개인데 열린 청구 ${openClaims.length}건 — 전 티켓 닫기 방지(파서 형식 커버리지 확인: 표 형식 계획은 미지원)`)
  }
  const create = []
  const update = []
  const unchanged = []
  const seen = new Set()
  // 중복 featureId는 상류 파싱 결함의 신호 — 조용히 하나를 고르면 티켓 중복 발행으로 이어져
  // 멱등성을 정면으로 깬다. loud-fail로 상류 버그를 표면화한다(fail-closed).
  for (const unit of units) {
    if (seen.has(unit.featureId)) throw new Error(`DUPLICATE_FEATURE_ID: ${unit.featureId}`)
    seen.add(unit.featureId)
  }
  for (const unit of units) {
    const featureId = unit.featureId
    const contentHash = unitContentHash(unit)
    const existing = ledgerState.get(featureId)
    const payload = buildTicketDraft(unit)
    if (!existing || existing.closed) {
      // 원장에 없거나, 닫혔다가 units에 다시 나타남 → 재생성(reopen도 생성으로 취급)
      create.push({featureId, payload, contentHash, reopen: Boolean(existing?.closed)})
    } else if (existing.contentHash !== contentHash) {
      update.push({featureId, ticketKey: existing.ticketKey, payload, contentHash})
    } else {
      unchanged.push({featureId, ticketKey: existing.ticketKey})
    }
  }
  const close = []
  for (const [featureId, entry] of ledgerState) {
    if (!seen.has(featureId) && !entry.closed) close.push({featureId, ticketKey: entry.ticketKey})
  }
  return {create, update, close, unchanged}
}

/**
 * emit-plan을 사람이 확인할 미리보기 문자열로 만든다(순수). 실제 발행 전 필수 게이트.
 */
export function formatEmitPreview(plan) {
  const lines = [`생성 ${plan.create.length} · 갱신 ${plan.update.length} · 닫기 ${plan.close.length} · 무변경 ${plan.unchanged.length}`]
  for (const item of plan.create) {
    const warn = item.payload.specCompleteness.ready ? '' : ` ⚠ 스펙 미완(${item.payload.specCompleteness.missing.join(',')})`
    lines.push(`  + ${item.featureId}${item.reopen ? ' (재개)' : ''}: ${item.payload.title}${warn}`)
  }
  for (const item of plan.update) lines.push(`  ~ ${item.featureId} (${item.ticketKey}): ${item.payload.title}`)
  for (const item of plan.close) lines.push(`  - ${item.featureId} (${item.ticketKey}): units에서 사라짐 → 닫기`)
  return lines.join('\n')
}

/**
 * lazy-claim 모델(GitHub Issues + gh CLI): 개발자에게 보여줄 "청구 가능 리스트"와 "잡힘"을
 * emit-plan에서 뽑는다(순수). batch 발행이 아니라 — 아직 이슈가 없는 단위(create)가
 * 청구 가능이고, 이미 이슈가 있는 단위(unchanged/update)는 잡힘(누가는 트래커 assignee).
 * @param {{create: Array, update: Array, unchanged: Array}} plan
 * @returns {{claimable: Array<{featureId: string, draft: Object}>, taken: Array<{featureId: string, ticketKey: string}>}}
 */
export function claimView(plan) {
  return {
    claimable: plan.create.map(item => ({featureId: item.featureId, draft: item.payload, contentHash: item.contentHash})),
    taken: [...plan.update, ...plan.unchanged].map(item => ({featureId: item.featureId, ticketKey: item.ticketKey})),
  }
}
