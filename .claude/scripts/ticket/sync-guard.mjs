// 팀 워크플로우 통합 — 픽업 준비 게이트: 브랜치·형상·컨플릭(순수).
// docs/team-workflow-integration-design.md 4점 스펙 중 픽업측(점 2·3·4):
//  2. 현재 브랜치에서 청구된 것만 픽업(브랜치 대조)
//  3. 형상이 다르면 청구된 형상으로 맞춤(sync-required 신호)
//  4. 맞출 때 컨플릭은 해결돼야 함(컨플릭 감지 시 fail-closed 차단)
// 이 모듈은 순수 판정만 — 브랜치·working-tree 상태는 git-origin.mjs 실행부가 읽어 넘긴다.
// 실제 pull·컨플릭 해결은 개발자 git 작업이다(하네스는 감지·차단·안내만, 자동 해결 안 함).

/**
 * 픽업 진입 준비도를 판정한다(순수). 우선순위대로 하나라도 걸리면 그 지점에서 차단.
 *  - 'branch-mismatch'      : 청구 브랜치 ≠ 현재 브랜치(점 2) — 청구 브랜치로 전환 필요
 *  - 'conflicts-unresolved' : working-tree에 미해결 컨플릭(점 4) — 해결 먼저
 *  - 'sync-required'        : 청구 형상 ≠ 로컬 형상(점 3) — 청구 형상으로 pull 필요
 *  - 'ready'                : 진입 가능
 * @param {{claimBranch: string|null, currentBranch: string|null, claimedHash: string|null, localHash: string|null, working?: {conflicted?: boolean}}} args
 * @returns {{ready: boolean, status: string, need: string|null}}
 */
export function evaluatePickupReadiness({claimBranch, currentBranch, claimedHash, localHash, working = {}}) {
  // 점 2 — 브랜치 대조(청구 브랜치가 기록돼 있을 때만; 없으면 대조 생략=하위호환).
  if (claimBranch && currentBranch && claimBranch !== currentBranch) {
    return {ready: false, status: 'branch-mismatch', need: `현재 브랜치(${currentBranch}) ≠ 청구 브랜치(${claimBranch}) — 청구 브랜치로 전환 후 픽업`}
  }
  // 점 4 — 미해결 컨플릭이면 형상 정렬·개발 진입 모두 차단(정렬이 컨플릭을 만들었든 기존이든).
  if (working?.conflicted) {
    return {ready: false, status: 'conflicts-unresolved', need: '병합 컨플릭을 해결한 뒤 다시 픽업(하네스는 자동 해결하지 않음)'}
  }
  // 점 3 — 청구 형상과 로컬 형상이 다르면 청구 형상으로 정렬 필요.
  if (claimedHash && claimedHash !== localHash) {
    return {ready: false, status: 'sync-required', need: '청구된 형상으로 계획을 pull해 맞춘 뒤 픽업(정렬 후 컨플릭 없으면 진입)'}
  }
  return {ready: true, status: 'ready', need: null}
}
