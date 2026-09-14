// work-pickup.mjs — WORK 티켓을 개발 에이전트에 넘기는 **판정**(순수).
//
// legacy FEAT 픽업의 게이트를 버리지 않고 **옮긴다**(I2). 대응은 이렇다:
//   인젝션 스캔      → 그대로(같은 `scanUntrustedIssue`)
//   종류 선판정      → WORK가 아니면 거부. 분해된 FEAT 티켓은 **어느 WORK로 가야 하는지** 알려준다
//   스펙 대조        → 마커의 workId·FEAT·TC가 계획에 실재하는가(지어낸 TC를 받지 않는다)
//   STALE(계획 변경) → 발행 시점 계획 digest ↔ 지금 계획 digest(`evaluatePickupReadiness` 재사용)
//   청구 버전 대조   → 원장의 `publish-confirmed`가 이 티켓 키를 아는가(미등록 티켓은 못 집는다)
//   준비도 되돌림    → 미해결 결정·미등록 선행이면 착수하지 않는다
//   TC 없는 완료 거부 → WORK는 TC가 없을 수 있다(기반 작업). 그때는 `checks`가 **필수**이며
//                      change-scope가 그것을 실어 완료 판정이 볼 것을 남긴다 — 빈 채로 보내지 않는다
import {quarantineExcerpt, scanUntrustedIssue} from './pickup.mjs'
import {classifyTicketKind, parseWorkMarker} from './work-refs.mjs'
import {parseIssueRefs} from './refs.mjs'
import {evaluatePickupReadiness} from './sync-guard.mjs'

const list = value => (Array.isArray(value) ? value : [])
const keyOf = issue => issue?.ticketKey ?? issue?.key ?? (issue?.number != null ? String(issue.number) : null)

/**
 * 분해된 FEAT를 픽업하려 할 때 **어디로 가야 하는지** 만든다(순수).
 * 「이 FEAT는 개발 티켓이 아니다」로 끝내면 사람은 다음 행동을 모른다.
 */
export function workRouteForFeature(plan, featureId) {
  const binding = list(plan?.featureBindings).find(entry => entry.featureId === featureId)
  if (!binding) return null
  return {featureId, requiredWorkIds: list(binding.requiredWorkIds),
    acceptanceOwners: list(binding.acceptanceOwners).map(owner => ({testCaseId: owner.testCaseId, workId: owner.workId}))}
}

/**
 * WORK change-scope(순수). **legacy와 같은 키 집합**이다(`ticket-kinds.md` 표가 정본) —
 * 개발 에이전트가 두 모델에서 다른 모양을 받으면 계약이 둘로 갈린다.
 * 차이는 값이 오는 곳이다: 쓰기 경계는 검토받은 계획이 정하므로 `needsConfirmation`이 거짓이고,
 * STALE 앵커는 단위 해시가 아니라 **계획 digest**다.
 */
export function buildWorkChangeScope({issue, plan, planDigest, work, featureIds, testCaseIds}) {
  return {
    ticketKey: keyOf(issue),
    ticket: {key: keyOf(issue), provider: issue?.provider ?? null, revision: issue?.revision ?? null, revisionStage: 'pre-pickup'},
    // 공유 작업은 소비 FEAT가 여럿이라 하나를 고를 수 없다 — 하나일 때만 싣고, 목록은 늘 싣는다.
    featureId: featureIds.length === 1 ? featureIds[0] : null,
    featureIds: [...featureIds],
    workId: work.workId,
    planId: plan.planId,
    TARGET_BEHAVIOR: quarantineExcerpt(issue),
    requestType: 'work',
    testCaseIds: [...testCaseIds],
    // TC가 없는 기반 작업은 `checks`가 수용 기준이다 — 비어 있을 수 없다(계획 검증이 보장한다).
    checks: list(work.checks).map(check => ({kind: check.kind, expectedOutcome: check.expectedOutcome, targetRefs: list(check.targetRefs)})),
    dependsOn: list(work.dependsOn),
    ALLOWED_PATHS: list(work.writePaths),
    needsConfirmation: false,
    PUBLIC_CONTRACTS_TO_PRESERVE: list(work.contractRefs).map(ref => `${ref.path}${ref.anchor ? `#${ref.anchor}` : ''}`),
    NON_GOALS: list(work.nonGoals),
    CHANGE_BUDGET: null,
    sourceDigest: planDigest,
  }
}

/**
 * WORK 픽업 판정(순수).
 * @param {{issue: object, plan: object, planDigest: string, state: object, view?: object|null,
 *          currentBranch?: string|null, working?: object}} args
 *   state: `foldWorkState` 결과 · view: `computeWorkView` 결과(미해결 결정 판정)
 * @returns {{ok: boolean, changeScope?: object, bounce?: object, injection: object}}
 */
export function pickupWorkTicket({issue, plan, planDigest, state, view = null, currentBranch = null, working = {}}) {
  const injection = scanUntrustedIssue(issue)
  if (injection.injectionSuspect) {
    return {ok: false, injection, bounce: {reason: 'injection-suspect', markers: injection.markers, sources: injection.sources}}
  }
  const kind = classifyTicketKind(issue?.body ?? '')
  if (kind.kind === 'conflict' || kind.error) return {ok: false, injection, bounce: {reason: 'ticket-kind-conflict', detail: kind.error}}
  if (kind.kind !== 'work') {
    // 분해된 FEAT면 **어느 WORK로 가야 하는지** 함께 준다. 그렇지 않으면 legacy 경로의 몫이다.
    const featureId = kind.kind === 'legacy' ? (list(parseIssueRefs(issue?.body ?? '').featureIds)[0] ?? null) : null
    const route = featureId ? workRouteForFeature(plan, featureId) : null
    return {ok: false, injection,
      bounce: {reason: route ? 'feature-decomposed-pick-work' : `${kind.kind}-ticket-not-work`, ticketKind: kind.kind, route}}
  }
  const marker = parseWorkMarker(issue?.body ?? '')
  if (!marker?.workId) return {ok: false, injection, bounce: {reason: 'work-marker-unreadable'}}
  if (marker.planId && plan.planId && marker.planId !== plan.planId) {
    return {ok: false, injection, bounce: {reason: 'other-plan', markerPlanId: marker.planId, planId: plan.planId}}
  }
  const work = list(plan.workItems).find(entry => entry.workId === marker.workId) ?? null
  if (!work) return {ok: false, injection, bounce: {reason: 'unknown-work', workId: marker.workId}}
  if ((work.lifecycle ?? 'active') !== 'active') {
    return {ok: false, injection, bounce: {reason: 'work-cancelled', workId: work.workId, lifecycle: work.lifecycle}}
  }
  // **등록 대조.** 원장이 이 작업의 티켓을 모르면 그것은 이 계획이 낸 티켓이 아니다 —
  // 본문 마커만 믿고 착수하면 남이 손으로 만든 티켓이 개발 지시가 된다.
  const registered = state?.works?.get(work.workId) ?? null
  if (registered?.status !== 'published') {
    return {ok: false, injection, bounce: {reason: 'work-not-registered', workId: work.workId, status: registered?.status ?? 'unpublished'}}
  }
  const ticketKey = keyOf(issue)
  // **재지 못한 것을 통과로 접지 않는다** — 키가 없으면 어느 티켓인지 모른 채 넘기는 것이다.
  if (!ticketKey) return {ok: false, injection, bounce: {reason: 'ticket-key-unknown', registered: registered.ticketKey ?? null}}
  if (registered.ticketKey && registered.ticketKey !== ticketKey) {
    return {ok: false, injection, bounce: {reason: 'ticket-key-mismatch', registered: registered.ticketKey, picked: ticketKey}}
  }
  // STALE: 발행 시점 계획 ↔ 지금 계획. 브랜치·컨플릭 판정은 legacy와 **같은 함수**를 쓴다.
  const readiness = evaluatePickupReadiness({claimBranch: registered.branch ?? null, currentBranch,
    claimedHash: registered.planDigest ?? marker.planDigest ?? null, localHash: planDigest, working})
  if (!readiness.ready) {
    return {ok: false, injection, bounce: {reason: readiness.status === 'sync-required' ? 'stale-plan' : readiness.status, need: readiness.need,
      publishedWith: registered.planDigest ?? marker.planDigest ?? null, localPlanDigest: planDigest}}
  }
  const row = list(view?.rows).find(entry => entry.workId === work.workId) ?? null
  if (row?.status === 'blocked-decision') {
    return {ok: false, injection, bounce: {reason: 'decision-unresolved', workId: work.workId}}
  }
  // **선행이 등록돼 있어야 착수한다.** 완료 여부는 아직 원장에 없다(P3) — 없는 것을 있다고 하지 않고,
  // 지금 잴 수 있는 것(등록)까지만 막는다. 그 사실을 되돌림 메시지가 그대로 적는다.
  const missingDeps = list(work.dependsOn).filter(dep => (state?.works?.get(dep)?.status ?? 'unpublished') !== 'published')
  if (missingDeps.length > 0) {
    return {ok: false, injection, bounce: {reason: 'dependency-not-registered', workId: work.workId, missing: missingDeps}}
  }
  const featureIds = list(plan.featureBindings).filter(binding => list(binding.requiredWorkIds).includes(work.workId))
    .map(binding => binding.featureId)
  const owned = list(plan.featureBindings).flatMap(binding =>
    list(binding.acceptanceOwners).filter(owner => owner.workId === work.workId).map(owner => owner.testCaseId))
  // TC가 없으면 `checks`가 수용 기준이다 — 둘 다 없으면 **무엇으로 끝났다고 할지 없다.**
  if (owned.length === 0 && list(work.checks).length === 0) {
    return {ok: false, injection, bounce: {reason: 'no-acceptance', workId: work.workId}}
  }
  return {ok: true, injection, changeScope: buildWorkChangeScope({issue, plan, planDigest, work, featureIds, testCaseIds: owned})}
}
