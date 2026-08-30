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

/**
 * 원장이 이미 정한 **청구 브랜치**. 티켓은 한 base 위에 모여야 한다 — 티켓마다 base가 다르면
 * PR이 서로 다른 브랜치로 나가 흐름이 갈라진다.
 *
 * 판정은 **최빈값**이다(최신값이 아니다). 실수로 다른 브랜치에서 한 번 발행하면 그 뒤로는
 * 그것이 "최신"이 되어 오염이 굳는다 — 2026-08-30 실측: 청구 브랜치가
 * `feature/mini4wd-track-3d`(14건)인데 `main`에서 4건을 발행했고 아무도 막지 않았다.
 * PR base가 갈라져 리뷰·머지 흐름이 둘로 쪼개진다.
 */
export function establishedClaimBranch(ledgerEntries) {
  const counts = new Map()
  for (const entry of ledgerEntries ?? []) {
    const branch = entry?.branch
    if (typeof branch !== 'string' || branch === '') continue
    counts.set(branch, (counts.get(branch) ?? 0) + 1)
  }
  if (counts.size === 0) return null // 첫 청구 — 정할 것이 없다
  let best = null
  for (const [branch, count] of counts) {
    if (best === null || count > best.count || (count === best.count && branch < best.branch)) {
      best = {branch, count}
    }
  }
  return best.branch
}

/**
 * 현재 브랜치가 확립된 청구 브랜치와 다르면 막는다. 의도적 이전이면 `--claim-branch`로
 * 명시하게 한다 — 조용히 갈라지는 것만 금지한다.
 */
export function checkClaimBranch({current, ledgerEntries, allow = null}) {
  const established = establishedClaimBranch(ledgerEntries)
  if (established === null) return {ok: true, established: current ?? null}
  if (current === established) return {ok: true, established}
  if (allow !== null && allow === current) return {ok: true, established: current, migrated: true}
  return {
    ok: false,
    established,
    current: current ?? null,
    guidance: `이 프로젝트의 청구 브랜치는 \`${established}\`인데 지금은 \`${current ?? '(미지정)'}\`입니다 — `
      + '티켓마다 base가 다르면 PR이 서로 다른 브랜치로 나가 흐름이 갈라집니다. '
      + `그 브랜치에서 청구하거나, 의도적 이전이면 \`--claim-branch ${current ?? ''}\`로 명시하세요.`,
  }
}
