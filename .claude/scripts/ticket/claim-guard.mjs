// 팀 워크플로우 통합 — 청구 전제 게이트: "청구는 origin에 푸시된 계획 버전에만"(순수).
// docs/team-workflow-integration-design.md: 청구자가 로컬(미공유) 기획 변경으로 청구하면
// 픽업자가 그 버전을 재현할 수 없다(레퍼런스 없음). 따라서 청구는 **공유된(origin에 푸시된)**
// feature-plan 버전에 대해서만 허용한다. 이 모듈은 순수 판정만 — 실제 origin 대조(git)는
// git-origin.mjs 실행부가 하고, 그 결과(존재·일치)를 여기 넘긴다.

/**
 * origin 동기 상태로 청구 가능 여부를 판정한다(순수).
 *  - originExists=false      → 'no-origin-plan'(origin에 계획이 없음 — 아직 공유 안 됨)
 *  - planMatchesOrigin=false → 'local-plan-not-pushed'(로컬이 origin과 다름 — 커밋·푸시 먼저)
 *  - 둘 다 만족             → eligible
 * @param {{originExists: boolean, planMatchesOrigin: boolean}} state
 * @returns {{eligible: boolean, reason: string|null}}
 */
export function computeClaimEligibility({originExists, planMatchesOrigin}) {
  if (!originExists) return {eligible: false, reason: 'no-origin-plan'}
  if (!planMatchesOrigin) return {eligible: false, reason: 'local-plan-not-pushed'}
  return {eligible: true, reason: null}
}

// 청구 거부 사유별 사람용 안내(개발자가 무엇을 해야 하는지).
export function claimEligibilityGuidance(reason) {
  switch (reason) {
    case 'no-origin-plan':
      return 'origin에 feature-plan이 없습니다. 계획을 커밋·푸시해 팀과 공유한 뒤 청구하세요.'
    case 'local-plan-not-pushed':
      return '로컬 feature-plan이 origin과 다릅니다(미커밋 또는 미푸시 변경). 청구는 공유된 버전에만 가능하니, 계획 변경을 커밋·푸시한 뒤 청구하세요 — 그래야 픽업자가 같은 레퍼런스를 재현합니다.'
    default:
      return null
  }
}
