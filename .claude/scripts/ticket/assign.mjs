// 팀 워크플로우 통합 — 픽업 시 개발 소유권 판정 (청구≠픽업 분리, 순수).
// docs/team-workflow-integration-design.md: 청구(발행)와 픽업(착수)은 별개 동사다.
//  - 청구/발행: 이슈를 *존재*하게 하는 side-effect. lead 일괄 발행이든 dev lazy-claim이든
//    **누구든** 할 수 있다(computeEmitPlan / claimFeature). 청구자 ≠ 픽업자여도 된다.
//  - 픽업/착수: 그와 별개로 개발자가 미배정 이슈의 **개발 소유권**을 self-assign으로 가져간다.
//
// 이 모듈은 순수하다 — 실제 `gh issue edit --add-assignee`는 실행부가 confirm 게이트 뒤에
// 한다. 여기서는 이슈의 현재 배정 상태 + 개발자로 "가져가도 되는가"를 판정만 한다.

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


