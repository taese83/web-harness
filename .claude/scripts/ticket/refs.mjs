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
  // 마커 정본을 침묵 손상시키는 브랜치명은 loud 거부(리뷰 지적): 공백은 branch= 필드를 절단하고,
  // "-->"는 HTML 주석을 조기 종결해 왕복이 조용히 틀린다. git ref 규칙은 "-->"를 허용하므로
  // 병적이지만 가능 — 정본 주장을 유지하려면 손상은 시끄러워야 한다.
  if (branch && /\s|-->/.test(branch)) throw new Error(`INVALID_BRANCH_STAMP: 마커를 손상시키는 브랜치명(공백/-->): ${branch}`)
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

/**
 * 사람이 쓴 티켓 본문에 왕복 마커를 **덧붙인다**(순수).
 *
 * **덮어쓰지 않는다.** 이 함수의 존재 이유가 그것이다 — 역방향 인테이크는 사람이 직접 쓴
 * 티켓을 대상으로 하고, 본문을 통째로 교체하면 **기획자가 쓴 내용이 사라진다.** 되돌릴 수
 * 없는 파괴이므로 이 경로에는 교체가 없다: 기존 본문을 그대로 두고 끝에 마커만 붙인다.
 *
 * **멱등이다.** 이미 같은 마커가 있으면 `null`을 돌려주고 호출부는 쓰기를 건너뛴다 —
 * 재실행이 티켓을 마커로 도배하지 않는다.
 *
 * @param {string} body  현재 본문(트래커에서 방금 읽은 것)
 * @param {string} marker  `buildRefsMarker` 산출
 * @returns {string|null}  붙인 본문, 또는 이미 있으면 `null`
 */
export function stampRefsInto(body, marker) {
  const current = String(body ?? '')
  if (typeof marker !== 'string' || !marker.startsWith(MARKER_BEGIN)) {
    throw new Error(`INVALID_REFS_MARKER: buildRefsMarker 산출이 아니다: ${String(marker).slice(0, 40)}`)
  }
  // 같은 마커가 이미 있으면 아무것도 하지 않는다.
  if (current.includes(marker)) return null
  // **다른 마커가 이미 있으면 손대지 않는다.** 그것은 이 티켓이 이미 다른 FEAT에 묶여 있다는
  // 뜻이고, 조용히 바꾸면 원장과 본문이 갈라진다 — 판단은 사람 몫이다.
  if (current.includes(MARKER_BEGIN)) {
    throw new Error('REFS_MARKER_CONFLICT: 이미 다른 왕복 마커가 있다 — 원장과 본문이 갈라지지 않게 사람이 정한다')
  }
  return `${current.replace(/\s+$/, '')}\n\n${marker}\n`
}
