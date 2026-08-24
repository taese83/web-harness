// 팀 워크플로우 통합 — 선택→라우팅 판정 (증분 4, 설계 §4-3, 순수).
// "전체 표시·전체 선택 가능, 전환은 자동이되 확인 1회 + 상태 가드" — 티켓 선택이 브랜치 전환을
// 수반할 때 무엇이 허용되는지를 §4-3 결정표 그대로 판정한다. 실제 checkout(side-effect)은
// 실행부가 confirm 뒤에 한다. sync-guard의 branch-mismatch "거부"를 "해소 제안"으로 승격하는
// 층이며, 게이트 강도는 그대로다(dirty·컨플릭은 여전히 fail-closed).

/**
 * 브랜치 전환 계획을 판정한다(순수, §4-3 결정표).
 *  - target === current            → none (전환 불필요 — 바로 픽업 게이트로)
 *  - 컨플릭 미해결                  → blocked: conflicts-unresolved (해결 먼저 — 침묵 해결 금지)
 *  - 추적 파일 dirty               → blocked: dirty-worktree (커밋/스태시 먼저 — 침묵 스태시 금지)
 *  - 다른 티켓 개발 진행 중         → switch + 강한 경고(active-pickup) — 명시 확인 시에만
 *  - 클린                          → switch + 확인 1회(needsConfirm — 자동이되 침묵 아님)
 * untracked-only는 checkout을 막지 않으므로 차단하지 않되 note로 표기(정직).
 * @param {Object} args {targetBranch, currentBranch, worktree: {dirty, conflicted, untrackedOnly?}, activePickup?: {featureId}|null}
 * @returns {{action: 'none'|'switch'|'blocked', needsConfirm: boolean, reason?: string, warnings: string[], guidance: string|null}}
 */
export function computeSwitchPlan({targetBranch, currentBranch, worktree = {}, activePickup = null}) {
  if (!targetBranch) return {action: 'blocked', needsConfirm: false, reason: 'no-target-branch', warnings: [], guidance: '대상 브랜치를 알 수 없습니다(티켓의 브랜치 스탬프 확인)'}
  if (targetBranch === currentBranch) {
    return {action: 'none', needsConfirm: false, warnings: [], guidance: null}
  }
  if (worktree.conflicted) {
    return {action: 'blocked', needsConfirm: false, reason: 'conflicts-unresolved', warnings: [], guidance: '병합 컨플릭을 해결한 뒤 전환하세요(하네스는 자동 해결하지 않음)'}
  }
  if (worktree.dirty) {
    return {action: 'blocked', needsConfirm: false, reason: 'dirty-worktree', warnings: [], guidance: '미커밋 변경이 있습니다 — 커밋 또는 스태시 후 전환하세요(침묵 스태시 금지)'}
  }
  const warnings = []
  if (activePickup) warnings.push(`active-pickup:${activePickup.featureId}`) // 진행 중 티켓 — 완료/보류 권장
  if (worktree.untrackedOnly) warnings.push('untracked-files')               // 전환은 가능 — 표기만
  return {action: 'switch', needsConfirm: true, warnings, guidance: null}
}

/**
 * 티켓 선택의 전체 라우트 단계를 만든다(순수) — UI/프롬프트가 같은 단계를 보여주도록 공용.
 * 전환 판정 + (전환 후 밟을) 픽업 게이트 순서를 하나의 단계 목록으로.
 * @param {Object} args computeSwitchPlan 인자 + {featureId}
 * @returns {{ok: boolean, blocked: {reason: string, guidance: string|null}|null, steps: Array<{step: string, needsConfirm?: boolean, warnings?: string[]}>}}
 */
export function describeRoute(args) {
  const plan = computeSwitchPlan(args)
  if (plan.action === 'blocked') {
    return {ok: false, blocked: {reason: plan.reason, guidance: plan.guidance}, steps: []}
  }
  const steps = []
  if (plan.action === 'switch') {
    steps.push({step: `switch:${args.targetBranch}`, needsConfirm: true, warnings: plan.warnings})
  }
  // 전환 뒤에도 픽업 4점 게이트(형상 정렬·컨플릭·소유권)는 그대로 밟는다 — 라우팅은 게이트를
  // 건너뛰게 하는 게 아니라 branch-mismatch 하나를 해소해줄 뿐이다(§4-3).
  steps.push({step: 'pickup-readiness'})   // sync-guard.evaluatePickupReadiness
  steps.push({step: `pickup:${args.featureId}`, needsConfirm: true}) // self-assign은 확인 뒤
  return {ok: true, blocked: null, steps}
}
