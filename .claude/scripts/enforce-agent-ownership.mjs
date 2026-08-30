#!/usr/bin/env node

import {existsSync, readFileSync, realpathSync, statSync} from 'node:fs'
import {dirname, isAbsolute, join, relative, resolve, sep} from 'node:path'
import {AGENT_OWNERSHIP, DEVELOPER_AGENT, intersectWithScope, ORCHESTRATOR_AUTHORED_ARTIFACTS, resolveDeveloperOwnership, resolveSpecOwnership} from './agent-registry.mjs'

// 확정된 스팩의 layerMap이 있으면 소유권 경로를 그것에서 얻는다(Stage 3b).
// 없거나 신뢰할 수 없으면 **기존 등록부로 돌아간다** — 절대 전체 허용이 되지 않는다.
// 스팩이 우회 벡터가 되지 않는 근거: (1) spec-lock은 어떤 에이전트도 소유하지 않는다,
// (2) layerMap 경로의 실존은 validate-spec-conformance가 대조한다,
// (3) 레이어가 서로 겹치면 resolveSpecOwnership이 null을 돌려 스팩을 신뢰하지 않는다.
const readSpecLock = projectRoot => {
  const path = join(projectRoot, '_workspace/03_dev/spec.json')
  if (!existsSync(path) || !statSync(path).isFile()) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

const readInput = async () => {
  let source = ''
  for await (const chunk of process.stdin) source += chunk
  return JSON.parse(source)
}

const nearestExistingPath = targetPath => {
  let currentPath = targetPath
  while (!existsSync(currentPath)) {
    const parentPath = dirname(currentPath)
    if (parentPath === currentPath) return currentPath
    currentPath = parentPath
  }
  return currentPath
}

const block = message => {
  process.stderr.write(`${message}\n`)
  process.exit(2)
}

try {
  const input = await readInput()
  if (!['Edit', 'Write'].includes(input.tool_name) || !input.agent_type) process.exit(0)

  const filePath = input.tool_input?.file_path
  if (typeof filePath !== 'string' || !isAbsolute(filePath)) block('Blocked: Write/Edit requires an absolute file_path.')

  const projectRoot = realpathSync(process.env.CLAUDE_PROJECT_DIR ?? input.cwd)
  const requestedPath = resolve(filePath)
  const existingPath = nearestExistingPath(requestedPath)
  const realExistingPath = realpathSync(existingPath)
  const realRelativePath = relative(projectRoot, realExistingPath)
  const outsideThroughSymlink = realRelativePath === '..' || realRelativePath.startsWith(`..${sep}`)
  if (outsideThroughSymlink) block(`Blocked: ${input.agent_type} cannot write outside the project root.`)

  const relativePath = relative(projectRoot, requestedPath).split(sep).join('/')
  if (relativePath.startsWith('../') || relativePath === '..') block(`Blocked: ${input.agent_type} cannot write outside the project root.`)

  // change-scope.md의 ALLOWED_PATHS — 스폰별 범위. 없으면 범위 제한이 없다(소유권만 적용).
  //
  // **정본은 ```json change-scope 펜스다.** 종전에는 문서 전체에서 "ALLOWED_PATHS가 처음
  // 나오는 곳"을 부분 문자열로 잡아서, 산문·주석·예시가 진짜 범위보다 앞에 있으면 그것이
  // 이겼다 — 승자가 **문서 편집 순서에 좌우**됐다(적대 리뷰 2026-08-30). 실물 change-scope는
  // ALLOWED_PATHS를 3번(산문·JSON·마크다운 줄) 담는다.
  //
  // 펜스가 있는데 JSON이 깨졌으면 **막는다.** 종전에는 `[]`로 떨어졌고 빈 배열은
  // `intersectWithScope`에서 "제한 없음"이라 **범위가 조용히 layerMap 전체로 넓어졌다** —
  // 파싱 실패가 확대로 이어지는 fail-open이었다. 판정할 수 없으면 통과시키지 않는다.
  const readAllowedPaths = root => {
    let source
    try {
      source = readFileSync(join(root, '_workspace/03_dev/change-scope.md'), 'utf8')
    } catch {
      return [] // 파일 부재 = 범위 미발급. 소유권만 적용한다(계약대로)
    }
    const asPathList = value => (Array.isArray(value)
      ? value.filter(entry => typeof entry === 'string' && entry.trim())
      : [])
    const fence = source.match(/```json\s+change-scope\s*\n([\s\S]*?)\n```/)
    if (fence) {
      let parsed
      try {
        parsed = JSON.parse(fence[1])
      } catch (error) {
        block('Blocked: _workspace/03_dev/change-scope.md의 change-scope 블록이 유효한 JSON이 아니다 '
          + `(${error instanceof Error ? error.message : String(error)}). 범위를 판정할 수 없으면 넓히지 않는다 — 블록을 고쳐라.`)
      }
      const fromFence = asPathList(parsed?.ALLOWED_PATHS)
      if (fromFence.length > 0) return fromFence
      // 펜스는 있는데 ALLOWED_PATHS가 없다 — 수기 표기로 내려간다(둘 다 없으면 범위 미발급)
    }
    // 펜스가 없는 수기 change-scope. 별표·따옴표 유무를 가리지 않는다 — 종전에는 줄 표기가
    // 별표를 **요구**하고 폴백은 허용해서, `ALLOWED_PATHS: a, b`라고 민무늬로 적으면 어느
    // 쪽에도 안 걸려 범위가 조용히 사라졌다.
    const line = source.match(/^[-*\s]*["*]{0,2}ALLOWED_PATHS["*]{0,2}\s*[:：]\s*(\S.*)$/mi)
    if (!line) return []
    return line[1].split(/[,·]/).map(value => value.replace(/[`"\s]/g, '')).filter(Boolean)
  }

  // 프로젝트가 `workspace/<project>/`로 중첩되면 **판정 기준 root가 둘로 갈린다.**
  // 종전에는 쓰기 경로만 접두를 벗기고(ownershipPath) 스팩·범위는 하네스 root에서 읽어서,
  // 중첩 프로젝트는 스팩을 확정해도 `developer`가 영원히 막혔다(2026-08-30 실측 — 하네스
  // root에는 `_workspace/`가 아예 없다). ALLOWED_PATHS도 같은 이유로 통째로 미적용됐는데
  // 그쪽은 조용히 **넓어지는** 방향이라 더 나쁘다. 둘을 같은 root에서 읽는다.
  // 중첩 판정은 이름이 아니라 **실존**으로 한다. `workspace/` 디렉터리를 가진 평범한 프로젝트가
  // 있고, 이름만 보고 root를 옮기면 그 프로젝트 자신의 스팩이 무시돼 developer가 전면 차단된다
  // (오탐 방향은 loud지만 오탐은 오탐이다 — 적대 리뷰 2026-08-30).
  const nestedCandidate = relativePath.match(/^workspace\/[^/]+\//)
  const nestedPrefix = nestedCandidate && existsSync(join(projectRoot, nestedCandidate[0], '_workspace'))
    ? nestedCandidate
    : null
  const ownershipPath = nestedPrefix ? relativePath.slice(nestedPrefix[0].length) : relativePath
  const ownershipRoot = nestedPrefix ? join(projectRoot, nestedPrefix[0]) : projectRoot

  // 플러그인 설치 시 agent_type은 `web-harness:<agent>`로 네임스페이스가 붙는다 — ownership
  // 등록부는 bare 이름 기준이므로 자기 플러그인 접두만 벗겨 판정한다. 임의 접두를 벗기면
  // 이름이 겹치는 서드파티 플러그인 에이전트가 ownership을 상속받으므로 반드시 고정한다.
  const agentType = String(input.agent_type).replace(/^web-harness:/, '')

  // 오케스트레이터가 쓰는 산출물은 **어떤 스팩·범위보다 앞서** 막는다. 종전에는 "아무도
  // 소유하지 않는다"가 등록부의 부재로만 표현됐는데, layerMap은 `_workspace/`를 금지하지
  // 않고 레이어 패턴이 선행 세그먼트를 허용하므로 스팩에 그 경로를 적으면 developer가
  // spec.json을 고쳐 **자기 소유권을 스스로 넓힐** 수 있었다(적대 리뷰 2026-08-30).
  // 이 diff가 중첩 프로젝트에서 스팩 유래 소유권을 처음 활성화하므로 먼저 닫는다.
  if (ORCHESTRATOR_AUTHORED_ARTIFACTS.some(artifact => artifact.endsWith('/')
    ? ownershipPath.startsWith(artifact)
    : ownershipPath === artifact)) {
    block(`Blocked: ${input.agent_type} cannot write ${ownershipPath} — it is orchestrator-authored `
      + 'and owned by no agent. A spec or scope that names it does not grant ownership.')
  }

  const spec = readSpecLock(ownershipRoot)
  // 개발 에이전트는 layerMap 전체를 소유하고, 스폰 범위(change-scope ALLOWED_PATHS)가 그 위에서
  // 다시 좁힌다 — 병렬 격리가 에이전트 정체성이 아니라 모듈 경계에서 나온다(2026-08-26).
  const specPatterns = agentType === DEVELOPER_AGENT
    ? intersectWithScope(resolveDeveloperOwnership(spec) ?? [], readAllowedPaths(ownershipRoot))
    : resolveSpecOwnership(spec, agentType)
  const allowedPatterns = (specPatterns?.length ? specPatterns : null) ?? AGENT_OWNERSHIP[agentType]
  // developer는 기본 소유권이 **비어 있다** — 스팩의 layerMap이 소유를 공급하는 구조다
  // (FSD 경로 폴백을 주면 그 순간 다시 경로 처방이 되므로 의도된 설계다). 그런데 스팩이
  // 없으면 "소유권 정의 없음"이라는 같은 문구로 막혀, 개발자가 원인을 스스로 파헤쳐야 했다
  // (2026-08-30 실측: spec.json이 없는 프로젝트에서 7경로 전부 default-deny).
  // 무엇이 없어서 막혔고 무엇을 하면 풀리는지 말한다.
  if (!allowedPatterns || allowedPatterns.length === 0) {
    if (agentType === DEVELOPER_AGENT) {
      block(`Blocked: ${input.agent_type} has no write ownership because the spec lock is missing or its layerMap is empty `
        + `(_workspace/03_dev/spec.json). The developer agent owns nothing by default — the spec's layerMap supplies ownership. `
        + `Confirm the spec before Phase 3 implementation spawns.`)
    }
    block(`Blocked: no write ownership is defined for ${input.agent_type}.`)
  }
  const ownJournalPath = `_workspace/03_dev/change-journal/${agentType}.md`
  if (ownershipPath === ownJournalPath) process.exit(0)
  if (!allowedPatterns.some(pattern => pattern.test(ownershipPath))) {
    // `specPatterns`는 빈 배열일 수 있고 빈 배열은 truthy다 — 종전에는 폴백해 놓고도
    // `spec-lock layerMap`이라 표시해 원인을 반대로 가리켰다(2026-08-30 실측).
    // 실제로 판정에 쓰인 근거를 그대로 적는다.
    const basis = specPatterns?.length ? 'spec-lock layerMap' : 'default registry'
    block(`Blocked: ${input.agent_type} does not own ${ownershipPath} (basis: ${basis}). Route the change to the owning agent.`)
  }

} catch (error) {
  block(`Blocked: ownership hook could not validate the operation: ${error instanceof Error ? error.message : String(error)}`)
}
