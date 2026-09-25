import {RETIRED_AGENTS} from '../agent-registry.mjs'
import {existsSync, lstatSync, readFileSync, readdirSync} from 'node:fs'
import {join} from 'node:path'
import {deriveRoleSuffixes} from './agent-reachability.mjs'
// 모르는 사후 검사 종류는 실행 때에야 실패로 드러나므로 여기서 먼저 막는다 — 목록은 runChecks와 한 곳이다.
import {CHECK_TYPES} from '../plugin-eval-checks-lib.mjs'

const PLUGIN_CASE_KEYS = new Set(['schema_version', 'name', 'description', 'tags', 'plugins', 'runs', 'expected_outcome', 'model',
  'max_turns', 'timeout_seconds', 'allowed_tools', 'append_system_prompt', 'env'])
const GRADER_TYPES = new Set(['regex', 'tool_used', 'tool_order', 'file_exists', 'llm', 'baseline'])
const frontmatterMap = text => {
  const block = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!block) return null
  // `key: value` 한 줄과, 값이 빈 키 아래의 `  - 항목` 목록을 읽는다(목록은 `[a, b]`로 모은다).
  const keys = new Map()
  let listKey = null
  for (const line of block[1].split(/\r?\n/)) {
    const item = line.match(/^\s+-\s+(.+)$/)
    if (item && listKey) { keys.set(listKey, `${keys.get(listKey).replace(/\]$/, '')}${keys.get(listKey) === '[' ? '' : ', '}${item[1].trim()}]`); continue }
    const pair = line.match(/^([A-Za-z_]+):\s*(.*)$/)
    if (!pair) continue
    listKey = pair[2].trim() === '' ? pair[1] : null
    keys.set(pair[1], listKey ? '[' : pair[2].trim())
  }
  return {keys, body: block[2]}
}

/**
 * 배포본 평가 사례(`claude plugin eval` 형식)를 실행 없이 검사한다. 알 수 없는 키는 러너가 거부하고, 짧은 턴·시간 상한은
 * 하네스 흐름을 중간에 끊어 실패를 플러그인 탓으로 보이게 한다. 진입은 배포본이 쓰는 이름공간 명령(`/web-harness:`)이어야 한다.
 */
export const pluginEvalCaseProblems = casesDirectory => {
  if (!existsSync(casesDirectory)) return ['.claude/evals/plugin이 없다 — 배포본 회귀 사례가 없다']
  const problems = []
  let regressionCases = 0
  for (const name of readdirSync(casesDirectory).sort()) {
    const caseDirectory = join(casesDirectory, name)
    if (!lstatSync(caseDirectory).isDirectory()) continue
    const promptPath = join(caseDirectory, 'prompt.md')
    if (!existsSync(promptPath)) { problems.push(`${name}: prompt.md가 없다`); continue }
    const prompt = frontmatterMap(readFileSync(promptPath, 'utf8'))
    if (!prompt) { problems.push(`${name}: prompt.md 머리말이 없다`); continue }
    for (const key of prompt.keys.keys()) if (!PLUGIN_CASE_KEYS.has(key)) problems.push(`${name}: 알 수 없는 키 ${key}`)
    if (!(Number(prompt.keys.get('max_turns')) >= 20)) problems.push(`${name}: max_turns가 20 미만이거나 없다(기본 10은 하네스 흐름을 끊는다)`)
    if (!(Number(prompt.keys.get('timeout_seconds')) >= 600)) problems.push(`${name}: timeout_seconds가 600 미만이거나 없다`)
    if (!prompt.body.trimStart().startsWith('/web-harness:')) problems.push(`${name}: 진입이 배포본 이름공간 명령(/web-harness:)이 아니다`)
    if (/\bregression\b/.test(prompt.keys.get('tags') ?? '')) regressionCases += 1
    const gradersDirectory = join(caseDirectory, 'graders')
    const graders = existsSync(gradersDirectory) ? readdirSync(gradersDirectory).filter(file => file.endsWith('.md')) : []
    if (graders.length === 0) problems.push(`${name}: 채점기가 없다`)
    for (const file of graders) {
      const type = frontmatterMap(readFileSync(join(gradersDirectory, file), 'utf8'))?.keys.get('type')
      if (!GRADER_TYPES.has(type)) problems.push(`${name}/graders/${file}: 알 수 없는 채점기 type ${type}`)
    }
    // 음성 채점기(안 한 것)만으로는 아무것도 하지 않은 실행도 통과한다 — 한 일을 보는 채점기나 사후 검사가 하나는 있어야 한다.
    const positiveGraders = graders.filter(file => {
      const grader = frontmatterMap(readFileSync(join(gradersDirectory, file), 'utf8'))?.keys
      const type = grader?.get('type')
      if (type === 'regex') return grader.get('match') !== 'not_contains'
      if (type === 'tool_used') return Number(grader.get('min') ?? 1) >= 1
      if (type === 'file_exists') return grader.get('exists') !== 'false'
      return ['tool_order', 'llm', 'baseline'].includes(type)
    }).length
    const checksPath = join(caseDirectory, 'checks.json')
    const checks = existsSync(checksPath) ? JSON.parse(readFileSync(checksPath, 'utf8')) : {checks: []}
    const positiveChecks = (checks.checks ?? []).filter(check => ['ticket-drafts-valid', 'file-exists', 'artifact-exists', 'artifact-matches'].includes(check.type)).length
    // 시드에 이미 있는 파일을 보는 file-exists는 아무것도 하지 않은 실행도 통과시킨다.
    const seedDirectory = checks.seed ? join(casesDirectory, '..', 'seeds', checks.seed) : null
    for (const check of checks.checks ?? []) {
      if (!CHECK_TYPES.has(check.type)) problems.push(`${name}: 알 수 없는 사후 검사 type ${check.type}`)
      // 시드에 이미 있는 경로의 부재를 요구하면 모든 실행이 실패한다 — 사례 정의의 결함이다.
      if (check.type === 'file-absent' && seedDirectory && existsSync(join(seedDirectory, check.path))) {
        problems.push(`${name}: file-absent ${check.path}가 시드에 이미 있다 — 모든 실행이 실패한다`)
      }
      if (check.type === 'artifact-matches') {
        let pattern = null
        try { pattern = new RegExp(check.pattern, 'm') } catch { problems.push(`${name}: artifact-matches ${check.path}의 pattern이 정규식이 아니다`) }
        const seeded = seedDirectory ? [`${check.path}.md`, join(check.path, 'INDEX.md')].map(path => join(seedDirectory, path)).find(path => existsSync(path)) : null
        if (seeded && pattern?.test(readFileSync(seeded, 'utf8'))) {
          problems.push(`${name}: artifact-matches ${check.path}가 시드에서 이미 맞는다 — 아무것도 하지 않은 실행도 통과한다`)
        }
      }
      if (check.type === 'file-exists' && seedDirectory && existsSync(join(seedDirectory, check.path))) {
        problems.push(`${name}: file-exists ${check.path}가 시드에 이미 있다 — 아무것도 하지 않은 실행도 통과한다`)
      }
      if (check.type === 'artifact-exists' && seedDirectory && [`${check.path}.md`, check.path].some(path => existsSync(join(seedDirectory, path)))) {
        problems.push(`${name}: artifact-exists ${check.path}가 시드에 이미 있다 — 아무것도 하지 않은 실행도 통과한다`)
      }
    }
    if (/\bregression\b/.test(prompt.keys.get('tags') ?? '') && positiveGraders + positiveChecks === 0) {
      problems.push(`${name}: 한 일을 보는 채점기·사후 검사가 없다 — 아무것도 하지 않은 실행도 통과한다`)
    }
    const casePath = join(caseDirectory, 'case.yaml')
    const scaffold = existsSync(casePath) ? readFileSync(casePath, 'utf8').match(/^\s*scaffold_script:\s*(\S+)/m)?.[1] : null
    if (scaffold && !existsSync(join(caseDirectory, scaffold))) problems.push(`${name}: scaffold_script ${scaffold}가 없다`)
  }
  if (regressionCases === 0) problems.push('regression 태그 사례가 없다 — 릴리스 전 배포본 회귀가 비었다')
  return problems
}

/**
 * 시나리오가 부르는 스킬과 단언이 이름 붙인 에이전트가 실재하는가(순수). 없는 스킬은 실행이 곧장 헛돌고,
 * 없는 에이전트를 기대하는 단언은 영영 통과하지 못한다. 에이전트 후보는 실존 에이전트 이름의 마지막 세그먼트
 * (역할 어휘)로 끝나는 하이픈 토큰이다 — 지금 어느 에이전트도 쓰지 않는 역할 어휘로 끝나는 이름은 못 잡는다.
 */
export const staleScenarioReferences = ({scenarios, skillNames, agentNames, retiredAgents = {}}) => {
  const known = new Set(agentNames)
  const roleSuffixes = deriveRoleSuffixes(known)
  return scenarios.flatMap(scenario => {
    const problems = []
    const skill = String(scenario.entrySkill ?? '').trim().split(/\s+/)[0].replace(/^\//, '')
    if (!skillNames.has(skill)) problems.push(`entrySkill ${scenario.entrySkill}은 없는 스킬이다`)
    for (const token of new Set(JSON.stringify(scenario.assertions ?? []).match(/\b[a-z0-9]+(?:-[a-z0-9]+)+\b/g) ?? [])) {
      if (!known.has(token) && roleSuffixes.has(token.split('-').at(-1))) problems.push(`단언이 없는 에이전트 ${token}를 기대한다`)
    }
    // 퇴역 이름은 이름으로 본다 — 같은 접미사의 마지막 에이전트가 사라지면 위 추론이 그 이름을 놓친다.
    for (const token of new Set(JSON.stringify(scenario.assertions ?? []).match(/\b[a-z0-9]+(?:-[a-z0-9]+)+\b/g) ?? [])) {
      if (Object.hasOwn(retiredAgents, token) && !roleSuffixes.has(token.split('-').at(-1))) {
        problems.push(`단언이 퇴역 에이전트 ${token}를 기대한다 — 그 일은 ${retiredAgents[token]}가 한다`)
      }
    }
    return problems.map(problem => ({id: scenario.id, problem}))
  })
}

import {
  createWorkflowSecurityManifest, isImmutableUsesTarget, validateWorkflowSecurityFixtures, validateWorkflowSecurityProjects,
} from '../workflow-security-lib.mjs'
export {createWorkflowSecurityManifest, inspectWorkflowSecurity, parseTrustedPromotionActions, validateWorkflowSecurityProjects} from '../workflow-security-lib.mjs'

export const validateWorkflowsAndEvals = ({
  claudeDirectory,
  repositoryRoot,
  pass,
  fail,
  workflowSecurityManifest = createWorkflowSecurityManifest(['.']),
}) => {
  const fullSha = 'a'.repeat(40)
  if (!isImmutableUsesTarget(`actions/checkout@${fullSha}`)) fail('workflow pin classifier rejects a full commit SHA')
  if (!isImmutableUsesTarget(`docker://alpine@sha256:${'b'.repeat(64)}`)) fail('workflow pin classifier rejects a container digest')
  for (const mutableTarget of ['actions/checkout@main', 'actions/checkout@v4', 'actions/checkout@v4.2.1', 'actions/checkout@abc1234', 'docker://alpine:3.22']) {
    if (isImmutableUsesTarget(mutableTarget)) fail(`workflow pin classifier accepts mutable target ${mutableTarget}`)
  }
  pass('workflow pin classifier self-test completed')

  validateWorkflowSecurityFixtures({claudeDirectory, pass, fail})
  validateWorkflowSecurityProjects({repositoryRoot, manifest: workflowSecurityManifest, pass, fail})

  const evalPath = join(claudeDirectory, 'evals', 'scenarios.json')
  if (!existsSync(evalPath)) {
    fail('.claude/evals/scenarios.json is missing')
  } else {
    try {
      const scenarios = JSON.parse(readFileSync(evalPath, 'utf8'))
      const scenarioIds = new Set()
      if (!Array.isArray(scenarios) || scenarios.length < 20) fail('at least twenty eval scenarios are required')
      for (const scenario of scenarios) {
        if (!scenario.id || scenarioIds.has(scenario.id)) fail(`invalid or duplicate eval id: ${scenario.id ?? '<missing>'}`)
        scenarioIds.add(scenario.id)
        if (!scenario.entrySkill || !scenario.prompt) fail(`${scenario.id}: entrySkill and prompt are required`)
        if (!Array.isArray(scenario.assertions) || scenario.assertions.length === 0) fail(`${scenario.id}: assertions are required`)
        // 선언한 seed·suite가 실재해야 한다 — 없는 seed는 실행 시점에야 드러나고, 오타 suite는 묶음에서 조용히 빠진다.
        if (scenario.seed !== undefined && (!/^[a-z0-9-]+$/.test(scenario.seed) || !existsSync(join(claudeDirectory, 'evals', 'seeds', scenario.seed)))) {
          fail(`${scenario.id}: seed .claude/evals/seeds/${scenario.seed} is missing`)
        }
        if (scenario.suites !== undefined && (!Array.isArray(scenario.suites) || scenario.suites.some(name => !['regression'].includes(name)))) {
          fail(`${scenario.id}: suites must list known suites (regression)`)
        }
      }
      const skillNames = new Set(readdirSync(join(claudeDirectory, 'skills')).filter(name => existsSync(join(claudeDirectory, 'skills', name, 'SKILL.md'))))
      const agentNames = readdirSync(join(claudeDirectory, 'agents')).filter(name => name.endsWith('.md')).map(name => name.slice(0, -'.md'.length))
      for (const {id, problem} of staleScenarioReferences({scenarios, skillNames, agentNames, retiredAgents: RETIRED_AGENTS})) fail(`${id}: ${problem}`)
      for (const problem of pluginEvalCaseProblems(join(claudeDirectory, 'evals', 'plugin'))) fail(`.claude/evals/plugin/${problem}`)
      for (const routingScenario of [
        'grafana-timeseries-dashboard',
        'historical-timeseries-routing',
        'realtime-chat-routing',
        'local-domain-state-workflow',
        'preference-persistence-routing',
        'external-ingestion-static-snapshot',
        'github-actions-static-ingestion-vercel',
        'external-ingestion-selector-drift',
        'generated-artifact-missing-source',
        'qa-evidence-tamper',
      ]) {
        if (!scenarioIds.has(routingScenario)) fail(`required routing eval is missing: ${routingScenario}`)
      }
      pass(`${scenarios.length} eval scenario contracts checked`)
    } catch (error) {
      fail(`eval scenarios are not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
    }
  }


  // canonical CI 제안본(.claude/ci/<name>)이 .github/workflows/<name>로 활성 배치된 경우 두 사본은
  // 바이트 동일해야 한다 — 남은 배포 사본 표면(I4)이며, 드리프트하면 CI가 canonical과 다른 게이트를
  // 조용히 실행한다. 활성 미러가 없는 제안본(예: hybrid-t1 활성화 전)은 검사 대상이 아니다.
  const canonicalCiRoot = join(claudeDirectory, 'ci')
  if (existsSync(canonicalCiRoot)) {
    let mirroredWorkflowCount = 0
    for (const entry of readdirSync(canonicalCiRoot, {withFileTypes: true})) {
      if (!entry.isFile() || !entry.name.endsWith('.yml')) continue
      const activeMirrorPath = join(repositoryRoot, '.github', 'workflows', entry.name)
      if (!existsSync(activeMirrorPath)) continue
      mirroredWorkflowCount += 1
      if (readFileSync(join(canonicalCiRoot, entry.name), 'utf8') !== readFileSync(activeMirrorPath, 'utf8')) {
        fail(`CI_MIRROR_DRIFT: .claude/ci/${entry.name} and .github/workflows/${entry.name} have diverged — update both copies in the same commit`)
      }
    }
    pass(`${mirroredWorkflowCount} activated CI workflow mirror(s) checked against canonical proposals`)
  }
}
