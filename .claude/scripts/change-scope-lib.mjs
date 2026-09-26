// change-scope-lib.mjs — change-scope.md에서 스폰 범위(ALLOWED_PATHS)를 읽는 단일 해석기.
//
// 소유권 훅(집행)과 개발 착수 점검(예행)이 이 함수 하나를 쓴다 — 둘이 다르게 읽으면 예행이
// 실제와 갈려, 정당한 범위가 차단으로 보이거나(오탐) 차단될 쓰기가 통과로 보인다(누락).
//
// 표기는 둘이다: ```json change-scope 펜스(기계 정본)와 수기 줄(`ALLOWED_PATHS: a, b` — 별표·따옴표 무관).
// change brief는 라운드마다 append되므로 **문서에서 마지막 항목이 현재 범위다** — 첫 항목을 읽으면 두 번째
// 라운드부터 지난 라운드의 범위로 판정한다. 마지막 항목이 깨진 펜스 JSON이면 error를 돌려준다 —
// 판정할 수 없는 범위를 "제한 없음"으로 넓히지 않는다. ALLOWED_PATHS가 없는 펜스는 건너뛴다.

const asPathList = value => (Array.isArray(value)
  ? value.filter(entry => typeof entry === 'string' && entry.trim())
  : [])

/** @returns {{paths: string[]} | {error: string}} paths가 비었으면 범위 미발급이다. */
export function parseChangeScopeAllowedPaths(source) {
  const entries = []
  for (const fence of source.matchAll(/```json\s+change-scope\s*\n([\s\S]*?)\n```/g)) {
    entries.push({index: fence.index, end: fence.index + fence[0].length, fence: fence[1]})
  }
  // 펜스 안의 JSON 키(`"ALLOWED_PATHS": [...]`)는 줄 표기로 다시 세지 않는다.
  const inFence = index => entries.some(entry => index > entry.index && index < entry.end)
  for (const line of source.matchAll(/^[-*\s]*["*]{0,2}ALLOWED_PATHS["*]{0,2}\s*[:：]\s*(\S.*)$/gmi)) {
    if (!inFence(line.index)) entries.push({index: line.index, line: line[1]})
  }
  entries.sort((left, right) => right.index - left.index)
  for (const entry of entries) {
    if (entry.line !== undefined) {
      return {paths: entry.line.split(/[,·]/).map(value => value.replace(/[`"\s]/g, '')).filter(Boolean)}
    }
    let parsed
    try {
      parsed = JSON.parse(entry.fence)
    } catch (error) {
      return {error: error instanceof Error ? error.message : String(error)}
    }
    const paths = asPathList(parsed?.ALLOWED_PATHS)
    if (paths.length > 0) return {paths}
  }
  return {paths: []}
}
