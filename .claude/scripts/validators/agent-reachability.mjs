// agent-reachability.mjs — 스킬·에이전트 문서가 **실존하지 않는 에이전트를 스폰 지시**하는지 본다.
//
// 왜 별도 모듈인가: validate-harness의 기존 reachability는 정방향(에이전트가 어디선가 언급되는가)
// 뿐이라, 삭제·개명 뒤 남은 죽은 스폰 지시가 조용히 통과했다. 실측(2026-08-27): `visual-developer`
// — 596c92e의 `test-writer`→`developer` 일괄 치환이 `visual-test-writer`를 **만든 적 없는 이름**으로
// 바꿨고, 6곳에 스폰 지시로 남은 채 harness-ci가 8커밋 동안 green이었다.
//
// 어휘를 하드코딩하지 않는 이유: 하드코딩은 실제로 뚫렸다. 같은 날 eval receipt(a3)가 바로 이
// 속성을 검사하면서 역할 접미사 목록에 `developer`를 빠뜨려 `visual-developer`를 **추출조차 못 하고**
// PASS를 냈다. 여기서는 접미사를 실존 에이전트 이름의 마지막 세그먼트에서 파생하므로, 에이전트가
// 늘면 어휘도 함께 자라고 같은 사각이 재발하지 않는다.
//
// 규약: 제거된 에이전트를 **과거 서술**로 언급할 때는 백틱을 쓰지 않는다 — 이 저장소에서 백틱은
// "하네스가 실제로 쓰는 식별자"를 뜻한다. 이 구분이 있어야 수기 예외 목록(드리프트하는 프록시)
// 없이 서술과 지시를 가를 수 있다.
//
// 프록시 표기: 백틱 표기는 관례이고 이 검사는 그 관례를 강제한다 — 백틱 없이 쓴 **진짜 스폰 지시**는
// 잡지 못한다(fail-open 방향). 반대로 서술에 백틱을 쓰면 loud FAIL이므로 조용히 새지는 않는다.

// 백틱으로 감싼 하이픈 포함 소문자 토큰. 백틱이 양끝을 앵커하므로 `foo.md`·`foo/bar` 같은 경로는
// 애초에 매칭되지 않는다.
const BACKTICK_TOKEN = /`([a-z0-9]+(?:-[a-z0-9]+)+)`/g

export const basename = path => path.split(/[\\/]/).at(-1).replace(/\.md$/, '')

// 실존 에이전트 이름의 마지막 하이픈 세그먼트 = 역할 어휘. `developer`처럼 하이픈이 없는 이름도
// 자기 자신이 접미사가 되므로 `visual-developer`가 후보로 잡힌다.
export const deriveRoleSuffixes = agentNames =>
  new Set([...agentNames].map(agentName => agentName.split('-').at(-1)))

/**
 * @param {{agentNames: Iterable<string>, documents: Array<{path: string, source: string}>}} input
 * @returns {Array<{path: string, line: number, token: string}>} 실존하지 않는 에이전트 지시
 */
export function findDanglingAgentDispatches({agentNames, documents}) {
  const known = new Set(agentNames)
  if (known.size === 0) {
    // 에이전트를 하나도 못 찾았으면 "위반 0건 통과"가 아니라 검사 미수행이다 — vacuous pass 차단.
    throw new Error('agent-reachability: no agent names supplied (check not performed)')
  }
  const roleSuffixes = deriveRoleSuffixes(known)
  const dangling = []
  for (const {path, source} of documents) {
    source.split(/\r?\n/).forEach((line, index) => {
      for (const match of line.matchAll(BACKTICK_TOKEN)) {
        const token = match[1]
        if (known.has(token)) continue
        if (!roleSuffixes.has(token.split('-').at(-1))) continue
        dangling.push({path, line: index + 1, token})
      }
    })
  }
  return dangling
}

/**
 * validate-harness 호출부. 실존 에이전트 이름 집합을 돌려주어 호출자가 다른 검사(예: web-only
 * 등록부의 실존 대조)에 재사용하게 한다.
 */
export const validateAgentReachability = ({agentFiles, activeMarkdown, read, pass, fail}) => {
  const agentNames = new Set(agentFiles.map(basename))
  const documents = activeMarkdown.map(relativePath => ({path: relativePath, source: read(relativePath)}))
  for (const dispatch of findDanglingAgentDispatches({agentNames, documents})) {
    fail(`${dispatch.path}:${dispatch.line}: dispatches an agent that does not exist: ${dispatch.token}`)
  }
  pass('reverse agent reachability checked (no dispatch to a nonexistent agent)')
  return agentNames
}
