// 통합 빌드 4단계 — claim runner. confirm(=개발자의 티켓 선택 행위) 뒤 실제 발행을 수행한다.
// docs/team-workflow-integration-design.md 지점 A의 lazy-claim 실행부.
//
// side-effect(티켓 생성·원장 append)는 provider/ledger 인터페이스로 **주입**한다 — 테스트는
// mock, 실사용은 구체 provider(별도 파일). 이 오케스트레이션 자체는 외부 명령을 직접 spawn하지
// 않아 순수 로직으로 테스트 가능하다.
//
// **트래커 어휘는 여기에 없다**(`ticket-provider.mjs`). 종전에는 이 파일이 `provider-github.mjs`를
// 정적 import해 필드 빌드와 조회 키(라벨)를 직접 알았다 — provider를 주입해도 GitHub이 남아
// 있었다. 조회는 `findByFeature(featureId)`이고 **키의 형태는 provider가 정한다**(GitHub은 라벨,
// Jira는 JQL). claim 경쟁의 잔여 race는 그 키로 사후 감지·dedup 가능(후속).
import {buildTicketDraft, unitContentHash} from './emit.mjs'
import {isClosedIssue, requireTicketProvider, ticketKeyOf} from './ticket-provider.mjs'
import {claimCapability, permissionGuidance} from './permissions.mjs'

/**
 * 개발자가 선택한 FEAT 단위를 청구한다: 기존 이슈 확인 → 없으면 발행(assignee=청구자) →
 * 원장 append. 이미 청구됐으면(트래커에 이슈 존재) 재발행하지 않고 그 이슈를 반환(멱등).
 *
 * @param {Object} args
 * @param {{featureId: string, title?: string, body?: string, testCaseIds?: string[], type?: string}} args.unit
 * @param {import('./ticket-provider.mjs').TicketProvider} args.provider
 * @param {{append: (record: any) => Promise<void>|void, find?: (featureId: string) => any}} args.ledger
 *   ledger.find는 원장의 기존 기록(있으면)을 반환 — **1차 멱등 가드**(동기·일관).
 * @param {string|null} [args.assignee]   미지정 시 미배정(혼자 개발/나중 분배)
 * @param {string|null} [args.branch]     청구가 이뤄진 브랜치 — 원장에 기록(픽업 브랜치 대조, 점 2)
 * @param {() => string} [args.now]
 * @returns {Promise<{claimed: boolean, alreadyClaimed: boolean, issue: any, record?: any, specWarning: string[]|null}>}
 */
export async function claimFeature({unit, provider, ledger, assignee = null, branch = null, permission = null, repo = '', designRefs = [], now = () => new Date().toISOString()}) {
  requireTicketProvider(provider)
  const featureId = unit.featureId
  if (typeof featureId !== 'string' || !/^FEAT-\d{3,}$/.test(featureId)) {
    throw new Error(`INVALID_FEATURE_ID: ${featureId}`)
  }
  // 0. 권한 pre-check(등급이 주어지면). lazy-claim은 이슈 쓰기가 필요하므로, 쓰기 불가
  //    등급이면 시도조차 하지 않고 맞는 모델·안내로 라우팅한다(실패 API 호출 회피, 친절한
  //    안내). 등급 미제공이면 기존처럼 시도(하위 호환).
  if (permission) {
    const cap = claimCapability(permission)
    if (!cap.canCreateIssue) {
      return {claimed: false, alreadyClaimed: false, blocked: true, reason: 'insufficient-permission',
        model: cap.model, guidance: permissionGuidance(permission, repo), issue: null, specWarning: null}
    }
  }
  // 1. 청구 경쟁 — **로컬 원장이 1차 가드**다. 트래커 조회는 색인 지연으로 직전 생성 티켓을
  //    못 보는 실측 갭이 있어(2026-08-21 GitHub 라이브), 신뢰할 멱등 가드가 아니다.
  //    원장은 동기 기록·일관 조회라 같은 원장을 보는 흐름의 재청구를 확실히 잡는다.
  const recorded = ledger.find?.(featureId)
  // **닫힌 레코드는 살아 있는 청구가 아니다.** 이 한 줄이 없어서 재개 경로가 막혔다 —
  // emit이 `reopen: true`로 create 계획을 냈는데 여기서 alreadyClaimed로 되돌아갔고,
  // 재청구가 조용히 no-op이 됐다(2026-08-30 실측).
  if (recorded && !recorded.closed) {
    return {claimed: false, alreadyClaimed: true, issue: {ticketKey: recorded.ticketKey}, specWarning: null}
  }
  // 2. 트래커는 크로스-머신 2차 가드(다른 원장을 쓰는 개발자의 선행 청구). 지연은 잔여 race로
  //    남고, provider가 정한 FEAT 조회 키가 사후 중복 감지·dedup의 기계 키가 된다.
  const existing = await provider.findByFeature(featureId)
  // 트래커에 **닫힌** 티켓이 있으면 새 번호를 내지 않고 되살린다 — 내용이 같은 티켓을 번호만
  // 바꿔 다시 내면 히스토리가 끊긴다. 되살리기를 제공하지 않는 provider면 정직하게 막는다.
  if (existing && isClosedIssue(provider, existing)) {
    if (typeof provider.reopenIssue !== 'function') {
      return {claimed: false, alreadyClaimed: true, issue: existing, specWarning: null,
        note: 'closed-ticket-not-reopenable'}
    }
    const key = ticketKeyOf(existing)
    await provider.reopenIssue(key, '계획이 다시 이 단위를 포함해 재개합니다.')
    const reopenedRecord = {
      featureId, ticketKey: key, provider: provider.name, contentHash: unitContentHash(unit), createdAt: now(),
      ...(assignee ? {assignee} : {}), ...(branch ? {branch} : {}),
    }
    await ledger.append(reopenedRecord)
    return {claimed: true, alreadyClaimed: false, reopened: true, issue: {...existing, ticketKey: key},
      record: reopenedRecord, specWarning: null}
  } else if (existing) {
    return {claimed: false, alreadyClaimed: true, issue: existing, specWarning: null}
  }
  // 2. draft → 이슈 필드(assignee=청구자). 스펙 미완이면 경고만 — 파서/발행은 게이트하지
  //    않고 pickup(단계 5)이 되돌림을 결정한다(스펙 상류 규율).
  const draft = buildTicketDraft(unit)
  const fields = provider.buildFields(draft, {assignee, branch, designRefs}) // 브랜치 스탬프(마커+라벨, §4-1 레지스트리)
  // 3. 발행(side-effect via provider). 권한 감지를 pre-check로 못 한 경우(등급 미제공)의
  //    reactive 안전망: 오류를 분류해 권한/미접근이면 친절한 결과로 전환, 그 외는 loud.
  //    분류기는 provider가 재정의할 수 있다 — 트래커마다 오류 문자열이 다르다.
  let issue
  try {
    issue = await provider.createIssue(fields)
  } catch (error) {
    // **트래커 중립 폴백.** 종전에는 gh 오류 분류기로 떨어졌는데, 그러면 Jira 401이
    // "gh auth login" 안내를 받는다 — 분류를 못 하면 분류한 척하지 않고 loud하게 올린다.
    const classify = typeof provider.classifyError === 'function' ? provider.classifyError : () => ({kind: 'unknown', hint: ''})
    const classified = classify(error?.message)
    if (classified.kind === 'forbidden' || classified.kind === 'not-found' || classified.kind === 'auth') {
      return {claimed: false, alreadyClaimed: false, blocked: true, reason: classified.kind,
        guidance: `${classified.hint} (${repo || '대상 repo'})`, issue: null, specWarning: null}
    }
    throw error // 미지 오류는 loud-fail 유지
  }
  // 4. 원장 append(왕복 정본, side-effect via ledger). ticketKey = 트래커 키(#42 · PROJ-123).
  //    provider 이름을 함께 남긴다 — 두 트래커가 한 원장에 섞이면 무엇으로 조회할지의 근거다.
  // 계약(`ticket-provider.mjs`)은 createIssue 반환에 키가 있을 것을 요구한다. 없으면 여기서
  // 막는다 — 통과시키면 키 없는 발행이 원장에 남고, 그 레코드로는 아무것도 되찾지 못한다.
  const issuedKey = ticketKeyOf(issue)
  if (!issuedKey) {
    throw new Error(`TICKET_KEY_MISSING: ${provider.name}가 돌려준 발행 결과에 키가 없다 — ${JSON.stringify(issue)?.slice(0, 200)}`)
  }
  const record = {
    featureId,
    ticketKey: issuedKey,
    provider: provider.name,
    contentHash: unitContentHash(unit),
    createdAt: now(),
    ...(assignee ? {assignee} : {}),
    ...(branch ? {branch} : {}), // 픽업 시 브랜치 대조(점 2) — 미지정이면 생략(하위호환)
  }
  await ledger.append(record)
  return {
    claimed: true,
    alreadyClaimed: false,
    issue,
    record,
    specWarning: draft.specCompleteness.ready ? null : draft.specCompleteness.missing,
  }
}
