// 팀 워크플로우 통합 — 하네스↔티켓 왕복 마커 (트래커 무관, I3).
// 마커 형식은 web-harness 자체 규약이라 특정 트래커에 종속되지 않는다 — 쓰기(provider가
// 이슈 본문에 스탬프)와 읽기(pickup이 되읽음) 양쪽이 이 모듈을 공유한다. GitHub 전용
// 파일에 있던 parseIssueRefs를 여기로 옮겨 "provider 인터페이스 뒤 격리"(설계 I3)를 지킨다.

const FEAT_ID = /\bFEAT-\d{3,}\b/g
const TC_ID = /\bTC-\d{3,}-\d+\b/g
const unique = values => [...new Set(values)]

export const MARKER_BEGIN = '<!-- web-harness:refs'
export const MARKER_END = '-->'

/**
 * FEAT/TC를 이슈 본문에 스탬프할 마커 문자열을 만든다(왕복 쓰기). 순수.
 * @param {string[]} featureIds
 * @param {string[]} testCaseIds
 * @returns {string}
 */
export function buildRefsMarker(featureIds, testCaseIds) {
  return `${MARKER_BEGIN} feat=${(featureIds ?? []).join(',')} tc=${(testCaseIds ?? []).join(',')} ${MARKER_END}`
}

/**
 * 티켓/이슈 본문의 왕복 마커에서 하네스 refs를 되읽는다(왕복 읽기). 순수.
 * 마커가 없으면 본문 전체에서 형식 엄격 스캔으로 폴백(사람이 맨몸으로 만든 이슈 대응).
 * @param {string} body
 * @returns {{featureIds: string[], testCaseIds: string[]}}
 */
export function parseIssueRefs(body) {
  if (typeof body !== 'string') return {featureIds: [], testCaseIds: []}
  const markerStart = body.indexOf(MARKER_BEGIN)
  const scope = markerStart >= 0
    ? body.slice(markerStart, body.indexOf(MARKER_END, markerStart) + MARKER_END.length)
    : body
  return {
    featureIds: unique(scope.match(FEAT_ID) ?? []),
    testCaseIds: unique(scope.match(TC_ID) ?? []),
  }
}
