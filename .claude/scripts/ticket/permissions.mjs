// 팀 워크플로우 통합 — 권한 감지·라우팅 (통합 빌드 5단계, 순수).
// 개발자가 대상 repo에 권한이 없으면 lazy-claim(이슈 생성)이 실패한다. 권한 등급이 "어느
// 트리거 모델을 쓸지"를 정한다 — write=lazy-claim, 그 이하=리드-주도. 이 모듈은 순수하게
// 등급 매핑·gh 오류 분류·모델 라우팅·안내 문구만 담고, 실제 gh 권한 조회는 실행부(별도)의 몫.

// GitHub viewerPermission(ADMIN/MAINTAIN/WRITE/TRIAGE/READ) → 하네스 등급.
// 미지 값은 least-privilege로 'read' 취급(이슈 생성 불가로 보수적 판정).
const WRITE_CAPABLE = new Set(['ADMIN', 'MAINTAIN', 'WRITE'])
export function permissionTier(viewerPermission) {
  const value = String(viewerPermission ?? '').toUpperCase()
  if (WRITE_CAPABLE.has(value)) return 'write'
  if (value === 'TRIAGE') return 'triage'
  return 'read' // READ·NONE·미지 — 모두 이슈 생성 불가로 보수 판정
}

/**
 * `gh repo view --json viewerPermission`의 stdout에서 등급을 뽑는다. 순수.
 * 파싱 실패는 'read'로 보수 폴백(권한을 넉넉히 가정하지 않음).
 * @param {string} stdout
 * @returns {'write'|'triage'|'read'}
 */
export function parseViewerPermission(stdout) {
  try {
    const parsed = JSON.parse(stdout)
    return permissionTier(parsed?.viewerPermission)
  } catch {
    return 'read'
  }
}

/**
 * 등급 → 개발자가 할 수 있는 것 + 맞는 트리거 모델. 순수.
 * @param {'write'|'triage'|'read'} tier
 */
export function claimCapability(tier) {
  switch (tier) {
    case 'write':
      return {canCreateIssue: true, canAssign: true, model: 'lazy-claim'}
    case 'triage':
      // 이슈 생성은 불가하나 기존 이슈 self-assign은 가능 — 리드가 batch-emit, 개발자는 배정.
      return {canCreateIssue: false, canAssign: true, model: 'lead-emit-self-assign'}
    default:
      // read/none/fork — 이슈 접근 불가. 리드가 생성+배정, 개발자는 fork에서 개발 → PR.
      return {canCreateIssue: false, canAssign: false, model: 'fork-lead-driven'}
  }
}

/**
 * gh 실패 메시지를 분류한다(권한/미접근/인증/미지). 순수 — 실행 결과 문자열만 본다.
 * @param {string} message
 * @returns {{kind: 'forbidden'|'not-found'|'auth'|'unknown', hint: string}}
 */
export function classifyGhError(message) {
  const text = String(message ?? '')
  if (/HTTP 403|forbidden|not have permission|resource not accessible/i.test(text)) {
    return {kind: 'forbidden', hint: '이 repo에 이슈 쓰기 권한이 없습니다(403).'}
  }
  if (/HTTP 404|not found|could not resolve to a repository/i.test(text)) {
    return {kind: 'not-found', hint: 'repo에 접근할 수 없습니다(404) — 비공개이거나 협업자가 아닙니다.'}
  }
  if (/HTTP 401|not logged|gh auth|authentication/i.test(text)) {
    return {kind: 'auth', hint: 'GitHub 인증이 필요합니다 — gh auth login.'}
  }
  return {kind: 'unknown', hint: text.slice(0, 200)}
}

/**
 * 등급별 실행 가능한 안내 문구(개발자에게). 순수.
 * @param {'write'|'triage'|'read'} tier
 * @param {string} repo
 */
export function permissionGuidance(tier, repo) {
  const cap = claimCapability(tier)
  if (cap.canCreateIssue) return `${repo}: 쓰기 권한 있음 — 티켓을 직접 청구(lazy-claim)할 수 있습니다.`
  if (cap.canAssign) return `${repo}: triage 권한 — 이슈를 직접 만들 수 없습니다. 리드가 사전 생성한 이슈를 self-assign(gh issue edit --add-assignee @me)하세요.`
  return `${repo}: 이슈 쓰기 권한 없음 — 리드가 이슈를 생성·배정하고, 당신은 fork에서 개발해 PR을 올리세요. 또는 협업자 권한을 요청하세요.`
}
