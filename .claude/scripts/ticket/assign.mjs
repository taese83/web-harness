// 팀 워크플로우 통합 — 픽업 시 개발 소유권 판정 (청구≠픽업 분리, 순수).
// docs/team-workflow-integration-design.md: 청구(발행)와 픽업(착수)은 별개 동사다.
//  - 청구/발행: 이슈를 *존재*하게 하는 side-effect. lead 일괄 발행이든 dev lazy-claim이든
//    **누구든** 할 수 있다(computeEmitPlan / claimFeature). 청구자 ≠ 픽업자여도 된다.
//  - 픽업/착수: 그와 별개로 개발자가 미배정 이슈의 **개발 소유권**을 self-assign으로 가져간다.
//
// 이 모듈은 순수하다 — 실제 `gh issue edit --add-assignee`는 실행부가 confirm 게이트 뒤에
// 한다. 여기서는 이슈의 현재 배정 상태 + 개발자로 "가져가도 되는가"를 판정만 한다.
import {pickupTicket} from './pickup.mjs'
import {unitContentHash} from './emit.mjs'

/**
 * 픽업 시점 개발 소유권을 판정한다(순수). 청구는 이미 됐다는 전제(이슈 존재).
 *  - 'assignable'  : 미배정 → self-assign 가능(가져감)
 *  - 'already-mine': 이미 내가 배정 → 멱등(재픽업 안전, 재배정 불필요)
 *  - 'taken'       : 남이 배정 → **차단**(훔치지 않음 — 명시적 재배정/핸드오프는 별개 행위)
 *  - 'no-developer': 개발자 식별자 없음 → 판정 불가
 *
 * **한계(TOCTOU, 리뷰 지적 2026-08-21)**: 이 순수 함수는 호출 시점 스냅샷(issue.assignees)만
 * 본다. 두 개발자가 *동시에* 같은 미배정 이슈를 읽으면 둘 다 'assignable'을 받고, 실행부
 * assignArgs(`gh issue edit --add-assignee`)는 additive(compare-and-swap 아님)라 둘 다 성공해
 * 다중 배정이 남을 수 있다. 순차(이미-taken) 케이스만 차단하며 동시 경합은 **이 코어가 막지
 * 못한다** — 실행부 배선이 assign 직전 재조회+재판정, 사후 다중배정 감지로 완화해야 한다
 * (protected-core.md §4 등록). claim-race(발행 경합)의 원장-우선 가드와 같은 클래스다.
 * @param {{issue: {assignees?: string[]}, developer: string}} args
 * @returns {{status: string, action: 'self-assign'|'none'|'blocked'|null, developer?: string, by?: string[]}}
 */
export function computeAssignmentPlan({issue, developer}) {
  const me = String(developer ?? '').trim()
  if (!me) return {status: 'no-developer', action: null}
  const assignees = (issue?.assignees ?? []).map(a => String(a)).filter(Boolean)
  if (assignees.length === 0) return {status: 'assignable', action: 'self-assign', developer: me}
  if (assignees.includes(me)) return {status: 'already-mine', action: 'none', developer: me}
  return {status: 'taken', action: 'blocked', by: assignees}
}

/**
 * 픽업 오케스트레이션(순수): 소유권 게이트 → 통과 시 change-scope 파생.
 * 청구자와 픽업자가 다른 경우를 정면으로 다룬다 — 남이 발행한 이슈라도, 미배정이면 이 개발자가
 * 가져가고(self-assign 필요), 남이 이미 가져갔으면 차단(중복 개발 방지). 소유권이 정리된 뒤에야
 * pickupTicket으로 넘어간다(비신뢰 본문 스캔·계획 대조는 그쪽 몫).
 * @param {Object} args {issue, developer, planUnits, allowedPathsSeed?, preserve?, requestType?}
 * @returns {{ok: boolean, changeScope?: Object, bounce?: {reason: string, by?: string[]}, assignment: Object, injection?: Object}}
 */
export function pickupWithOwnership({issue, developer, planUnits, allowedPathsSeed = [], preserve = [], requestType = 'feature'}) {
  const assignment = computeAssignmentPlan({issue, developer})
  if (assignment.status === 'taken') {
    return {ok: false, bounce: {reason: 'assigned-to-other', by: assignment.by}, assignment}
  }
  if (assignment.status === 'no-developer') {
    return {ok: false, bounce: {reason: 'no-developer'}, assignment}
  }
  // 소유권 확보(assignable=self-assign 필요, already-mine=멱등) → change-scope 파생.
  const pick = pickupTicket({issue, planUnits, allowedPathsSeed, preserve, requestType})
  return {...pick, assignment}
}

/**
 * 개발자가 "지금 뭘 집을 수 있나"를 보는 가용성 보드(순수). feature-plan 단위 + 원장(청구 이력)
 * + 이슈 배정 상태를 합쳐 FEAT마다 상태를 매긴다. "이미 청구된 것"과 "아직인 것"을 한 뷰로.
 * 상태:
 *  - 'unclaimed'   : 청구 안 됨(이슈 없음) → 발행/청구 대상
 *  - 'pickupable'  : 청구됨·미배정 → 이 개발자가 픽업(self-assign) 가능
 *  - 'mine'        : 나에게 배정됨 → 계속 진행
 *  - 'in-progress' : 남에게 배정됨 → 픽업 불가(by 표기)
 * 각 행에 stale(원장 청구 시점 대비 계획 변경)도 실어, 이미 청구된 것이 상류 변경으로 낡았는지
 * 표시한다. gh 조회는 caller가 하고(issuesByFeature 주입) 이 함수는 순수 판정만.
 * @param {Object} args {units(feature-plan), ledgerState(Map), issuesByFeature(Map<featureId,{number,assignees[]}>|나 null), developer}
 * @returns {Array<{featureId: string, title: string, status: string, ticketKey?: string|number, assignees?: string[], stale: boolean}>}
 */
export function buildAvailabilityBoard({units = [], ledgerState = new Map(), issuesByFeature = new Map(), developer}) {
  return units.map(unit => {
    const featureId = unit.featureId
    const record = ledgerState.get?.(featureId) ?? null
    const issue = issuesByFeature.get?.(featureId) ?? null
    // stale: 원장에 청구 시점 contentHash가 있고 현재 단위 해시와 다르면 상류 계획 변경.
    const stale = record?.contentHash != null && record.contentHash !== unitContentHash(unit)
    const base = {featureId, title: unit.title ?? '(제목 없음)', stale}
    if (!issue) return {...base, status: 'unclaimed'}
    const assignment = computeAssignmentPlan({issue, developer})
    const status = assignment.status === 'assignable' ? 'pickupable'
      : assignment.status === 'already-mine' ? 'mine'
      : assignment.status === 'taken' ? 'in-progress'
      : 'pickupable' // no-developer면 배정 판정 불가 → 미배정으로 취급(집을 수 있음)
    return {
      ...base,
      status,
      ticketKey: record?.ticketKey ?? issue.number ?? null,
      ...(assignment.by ? {assignees: assignment.by} : {}),
    }
  })
}
