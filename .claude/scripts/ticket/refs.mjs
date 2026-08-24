// 팀 워크플로우 통합 — 하네스↔티켓 왕복 마커 (트래커 무관, I3).
// 마커 형식은 web-harness 자체 규약이라 특정 트래커에 종속되지 않는다 — 쓰기(provider가
// 이슈 본문에 스탬프)와 읽기(pickup이 되읽음) 양쪽이 이 모듈을 공유한다. GitHub 전용
// 파일에 있던 parseIssueRefs를 여기로 옮겨 "provider 인터페이스 뒤 격리"(설계 I3)를 지킨다.

const FEAT_ID = /\bFEAT-\d{3,}\b/g
const TC_ID = /\bTC-\d{3,}-\d+\b/g
const unique = values => [...new Set(values)]

export const MARKER_BEGIN = '<!-- web-harness:refs'
export const MARKER_END = '-->'

// 브랜치 스탬프(설계 §4-1 선언 기반 발견) — 마커의 branch= 값. 공백 없는 브랜치명만 유효
// (git ref 규칙상 공백 불가라 실브랜치는 전부 통과). 파싱은 marker 구획 안에서만.
const BRANCH_FIELD = /\bbranch=([^\s]+)/

/**
 * FEAT/TC(+브랜치)를 이슈 본문에 스탬프할 마커 문자열을 만든다(왕복 쓰기). 순수.
 * branch는 "이 티켓이 어느 작업 브랜치 소속인가"의 레지스트리 스탬프(설계 §4-1) — 없으면 생략
 * (하위호환: 기존 마커 형식 그대로).
 * @param {string[]} featureIds
 * @param {string[]} testCaseIds
 * @param {{branch?: string|null}} [options]
 * @returns {string}
 */
export function buildRefsMarker(featureIds, testCaseIds, {branch = null} = {}) {
  const branchField = branch ? ` branch=${branch}` : ''
  return `${MARKER_BEGIN} feat=${(featureIds ?? []).join(',')} tc=${(testCaseIds ?? []).join(',')}${branchField} ${MARKER_END}`
}

/**
 * 티켓/이슈 본문의 왕복 마커에서 하네스 refs를 되읽는다(왕복 읽기). 순수.
 * 마커가 없으면 본문 전체에서 형식 엄격 스캔으로 폴백(사람이 맨몸으로 만든 이슈 대응).
 * branch는 마커 구획 안에서만 읽는다(본문 산문의 "branch=..." 언급 오탐 방지) — 마커 없으면 null.
 * @param {string} body
 * @returns {{featureIds: string[], testCaseIds: string[], branch: string|null}}
 */
export function parseIssueRefs(body) {
  if (typeof body !== 'string') return {featureIds: [], testCaseIds: [], branch: null}
  const markerStart = body.indexOf(MARKER_BEGIN)
  const scope = markerStart >= 0
    ? body.slice(markerStart, body.indexOf(MARKER_END, markerStart) + MARKER_END.length)
    : body
  const branchMatch = markerStart >= 0 ? scope.match(BRANCH_FIELD) : null
  return {
    featureIds: unique(scope.match(FEAT_ID) ?? []),
    testCaseIds: unique(scope.match(TC_ID) ?? []),
    branch: branchMatch ? branchMatch[1] : null,
  }
}
