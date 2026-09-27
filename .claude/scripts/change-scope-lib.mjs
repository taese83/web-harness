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

// 펜스의 `"PHASE": "plan"`은 light change 레인의 계획 패스다 — 그 범위가 현재인 동안 developer는 계획 문서만 쓴다
// (소유권 훅이 source를 막는다). 줄 표기에는 단계가 없다(구현 단계).
/** @returns {{paths: string[], phase: string|null} | {error: string}} paths가 비었으면 범위 미발급이다. */
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
  // 줄 표기의 단계(`PHASE: plan`) — 같은 항목에서 ALLOWED_PATHS 줄 **앞**(앞 항목 뒤)에 적힌 것만 그 항목의 단계다.
  const phaseLines = [...source.matchAll(/^[-*\s]*["*]{0,2}PHASE["*]{0,2}\s*[:：]\s*[`"]?([a-z]+)/gmi)]
    .filter(line => !inFence(line.index))
  // 항목 경계는 앞 항목과 그 사이의 마지막 제목(`## …`)이다 — 앞 항목 끝에 붙은 PHASE를 다음 항목이 물려받지 않게.
  const headings = [...source.matchAll(/^#{1,6}\s/gm)].map(match => match.index)
  entries.sort((left, right) => right.index - left.index)
  for (const [position, entry] of entries.entries()) {
    if (entry.line !== undefined) {
      const previous = Math.max(entries[position + 1]?.index ?? -1, ...headings.filter(index => index < entry.index))
      const phase = phaseLines.filter(line => line.index > previous && line.index < entry.index).at(-1)?.[1] ?? null
      return {paths: entry.line.split(/[,·]/).map(value => value.replace(/[`"\s]/g, '')).filter(Boolean), phase: phase ? phase.toLowerCase() : null}
    }
    let parsed
    try {
      parsed = JSON.parse(entry.fence)
    } catch (error) {
      return {error: error instanceof Error ? error.message : String(error)}
    }
    const paths = asPathList(parsed?.ALLOWED_PATHS)
    if (paths.length > 0) return {paths, phase: typeof parsed?.PHASE === 'string' ? parsed.PHASE : null}
  }
  return {paths: [], phase: null}
}
