#!/usr/bin/env node

import {existsSync, readFileSync, realpathSync, statSync, lstatSync} from 'node:fs'
import {dirname, isAbsolute, join, relative, resolve, sep} from 'node:path'
import {AGENT_OWNERSHIP, DEVELOPER_AGENT, intersectWithScope, isProtectedWritePath, ORCHESTRATOR_AUTHORED_ARTIFACTS, resolveDeveloperOwnership, resolveSpecOwnership} from './agent-registry.mjs'
import {acquireLease, leaseBlockMessage} from './write-lease-lib.mjs'
import {harnessAgentName} from './agent-identity.mjs'
import {parseChangeScopeAllowedPaths} from './change-scope-lib.mjs'

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

// 링크 **자체**가 있으면 있는 것으로 본다(`lstat`) — `existsSync`는 링크를 따라가서 대상 없는 링크를 「없는 경로」로
// 읽고, 조상까지만 풀린 판정이 링크를 건너뛰었다(Write는 링크를 따라 대상을 새로 만든다).
const presentAsEntry = path => { try { lstatSync(path); return true } catch { return false } }

const nearestExistingPath = targetPath => {
  let currentPath = targetPath
  while (!presentAsEntry(currentPath)) {
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
  let realExistingPath
  try { realExistingPath = realpathSync(existingPath) } catch {
    block(`Blocked: ${input.agent_type} cannot write through a symlink whose target does not exist.`)
  }
  const realRelativePath = relative(projectRoot, realExistingPath)
  const outsideThroughSymlink = realRelativePath === '..' || realRelativePath.startsWith(`..${sep}`)
  if (outsideThroughSymlink) block(`Blocked: ${input.agent_type} cannot write outside the project root.`)

  // **판정은 실제로 쓰일 자리로 한다.** 종전에는 루트 밖으로 나가는 symlink만 막고 소유·범위는 요청 경로로
  // 판정해서, 프로젝트 **안**의 symlink(`src/pages/list/link → ../../entities`)를 거치면 범위 밖 파일이 범위
  // 안 경로로 통과했다(적대 리뷰 2026-09-14). 존재하는 가장 가까운 조상을 realpath로 풀고 나머지를 붙인다.
  const effectivePath = join(realExistingPath, relative(existingPath, requestedPath))
  const relativePath = relative(projectRoot, effectivePath).split(sep).join('/')
  if (relativePath.startsWith('../') || relativePath === '..') block(`Blocked: ${input.agent_type} cannot write outside the project root.`)

  // change-scope.md의 ALLOWED_PATHS — 스폰별 범위. 없으면 범위 제한이 없다(소유권만 적용).
  // 해석은 change-scope-lib 하나다 — 개발 착수 점검의 예행도 같은 함수로 읽는다.
  // 펜스 JSON이 깨졌으면 막는다 — 판정할 수 없는 범위를 layerMap 전체로 넓히지 않는다.
  const readAllowedPaths = root => {
    let source
    try {
      source = readFileSync(join(root, '_workspace/03_dev/change-scope.md'), 'utf8')
    } catch {
      return [] // 파일 부재 = 범위 미발급. 소유권만 적용한다(계약대로)
    }
    const scope = parseChangeScopeAllowedPaths(source)
    if (scope.error) {
      block('Blocked: _workspace/03_dev/change-scope.md의 change-scope 블록이 유효한 JSON이 아니다 '
        + `(${scope.error}). 범위를 판정할 수 없으면 넓히지 않는다 — 블록을 고쳐라.`)
    }
    return scope.paths
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

  // 등록부는 하네스 에이전트의 bare 이름 기준이다. 플러그인 판본에서 프로젝트가 정의한 같은 이름은 프로젝트
  // 에이전트라 소유권을 물려받지 않는다(null → 아래에서 소유권 없음으로 막힌다). 판정은 agent-identity.mjs.
  const agentType = harnessAgentName(input.agent_type, {projectRoot})

  if (isProtectedWritePath(ownershipPath)) {
    block(`Blocked: ${input.agent_type} cannot write ${ownershipPath} — dependency trees, VCS internals, the harness and agent/IDE/MCP settings are never agent-owned.`)
  }

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

  if (agentType === null) {
    block(`Blocked: ${input.agent_type} is not a web-harness agent — harness write ownership is granted only to `
      + `web-harness:<agent> in the plugin build. A project agent with the same name does not inherit it.`)
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
  // **같은 체크아웃의 developer 스폰은 한 번에 하나만 쓴다(감사 FINDING-003).** 범위 파일
  // (`change-scope.md`)을 모든 스폰이 공유하므로 병렬로 쓰면 마지막 범위가 다른 스폰에도 적용된다.
  // 스폰 신원은 런타임이 `agent_id`로 넣는다(2026-09-11 실측: 병렬 서브에이전트 둘 → 서로 다른 id,
  // 메인 스레드 → 없음).
  // 소유권 **정의**가 있는 developer만 잡는다(스팩이 없는 스폰은 위에서 막혀 임대를 잡지 않는다).
  // layerMap 밖 경로 쓰기는 임대를 잡은 뒤 아래에서 막힌다 — 이미 쓰려는 같은 스폰이므로 그 스폰의
  // `SubagentStop`이 놓는다.
  if (agentType === DEVELOPER_AGENT && typeof input.agent_id === 'string' && input.agent_id) {
    const lease = acquireLease({projectRoot, agentId: input.agent_id, agentType, sessionId: input.session_id ?? null})
    if (lease.held) block(leaseBlockMessage({held: lease.held, path: lease.path, agentType: input.agent_type}))
    if (lease.unavailable) {
      block(`Blocked: ${input.agent_type} — write 임대를 만들 수 없어 같은 체크아웃의 직렬화를 보장할 수 없다 `
        + `(${lease.unavailable.join(' · ')}). 보장할 수 없으면 쓰지 않는다.`)
    }
  }
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
