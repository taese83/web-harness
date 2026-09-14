// 팀 워크플로우 통합 — 권한 감지·라우팅 (통합 빌드 5단계, 순수).
// 개발자가 대상 repo에 권한이 없으면 lazy-claim(이슈 생성)이 실패한다. 권한 등급이 "어느
// 트리거 모델을 쓸지"를 정한다 — write=lazy-claim, 그 이하=리드-주도. 이 모듈은 순수하게
// 등급 매핑·gh 오류 분류·모델 라우팅·안내 문구만 담고, 실제 gh 권한 조회는 실행부(별도)의 몫.

// GitHub viewerPermission(ADMIN/MAINTAIN/WRITE/TRIAGE/READ) → 하네스 등급.
// 미지 값은 least-privilege로 'read' 취급(이슈 생성 불가로 보수적 판정).
const WRITE_CAPABLE = new Set(['ADMIN', 'MAINTAIN', 'WRITE'])


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

