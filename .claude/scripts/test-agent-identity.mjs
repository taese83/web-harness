#!/usr/bin/env node
// test-agent-identity.mjs — 훅이 하네스 에이전트와 같은 이름의 프로젝트 에이전트를 가르는가.
//
// 고정하는 사실:
//   - 원본 저장소(개발 판본)에서는 접두 없는 이름이 하네스 에이전트다 — 기존 동작 그대로
//   - 플러그인 판본에서 프로젝트·사용자가 **정의한** 같은 이름의 에이전트는 하네스 검증 제한도(Bash) 쓰기 소유권도
//     물려받지 않는다. 정의가 없는 접두 없는 이름은 종전처럼 하네스 에이전트다(제한이 풀리는 쪽으로 틀리지 않는다)
//   - 판본은 빌드 산출물의 매니페스트로 가른다 — 훅을 플러그인 배치 그대로 복사해 실제 프로세스로 돌린다
import assert from 'node:assert/strict'
import test from 'node:test'
import {spawnSync} from 'node:child_process'
import {cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath, pathToFileURL} from 'node:url'
import {harnessAgentName} from './agent-identity.mjs'

const SCRIPTS = fileURLToPath(new URL('.', import.meta.url))

// 프로젝트가 `.claude/agents/<name>.md`로 에이전트를 정의한다.
const declareAgent = (root, name) => {
  mkdirSync(join(root, '.claude/agents'), {recursive: true})
  writeFileSync(join(root, '.claude/agents', `${name}.md`), `---\nname: ${name}\ndescription: 프로젝트 에이전트\n---\n본문\n`)
}

test('판별(순수): 플러그인 판본에서는 프로젝트가 정의한 같은 이름만 하네스 밖이다', () => {
  const project = realpathSync(mkdtempSync(join(tmpdir(), 'wh-agent-identity-pure-')))
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'wh-agent-identity-home-')))
  try {
    const plugin = {pluginBuild: true, projectRoot: project, home}
    assert.equal(harnessAgentName('code-reviewer', {pluginBuild: false, projectRoot: project, home}), 'code-reviewer')
    assert.equal(harnessAgentName('web-harness:code-reviewer', {pluginBuild: false}), 'code-reviewer')
    assert.equal(harnessAgentName('code-reviewer', plugin), 'code-reviewer', '정의가 없는데 하네스 제한을 풀었다')
    declareAgent(project, 'code-reviewer')
    assert.equal(harnessAgentName('code-reviewer', plugin), null, '프로젝트 에이전트가 하네스 이름을 물려받았다')
    assert.equal(harnessAgentName('web-harness:code-reviewer', plugin), 'code-reviewer')
    declareAgent(home, 'developer')
    assert.equal(harnessAgentName('developer', plugin), null, '사용자 에이전트가 하네스 이름을 물려받았다')
    assert.equal(harnessAgentName('other-plugin:code-reviewer', plugin), null)
    assert.equal(harnessAgentName('web-harness:', plugin), null)
    assert.equal(harnessAgentName(undefined), null, '메인 스레드는 에이전트가 아니다')
  } finally {
    rmSync(project, {recursive: true, force: true})
    rmSync(home, {recursive: true, force: true})
  }
})

// 훅을 **플러그인 배치**(…/.claude/scripts + …/.claude-plugin/plugin.json)로 복사하고 스팩 있는 프로젝트 하나를 만든다.
const SPEC = {schemaVersion: 2, layerMap: {shared: 'src/shared'}, testLayers: {unit: 'src'}}
const makeLayout = () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wh-agent-identity-')))
  const plugin = join(root, 'plugin')
  cpSync(SCRIPTS, join(plugin, '.claude/scripts'), {recursive: true, filter: source => !/\/test-[^/]*\.mjs$/.test(source)})
  mkdirSync(join(plugin, '.claude-plugin'), {recursive: true})
  writeFileSync(join(plugin, '.claude-plugin/plugin.json'), JSON.stringify({name: 'web-harness', version: '0.0.0'}))
  const project = join(root, 'project')
  mkdirSync(join(project, '_workspace/03_dev'), {recursive: true})
  mkdirSync(join(project, 'src'), {recursive: true})
  writeFileSync(join(project, '_workspace/03_dev/spec.json'), JSON.stringify(SPEC))
  const home = join(root, 'home')
  mkdirSync(home, {recursive: true})
  return {root, pluginScripts: join(plugin, '.claude/scripts'), sourceScripts: SCRIPTS, project, home}
}
const withLayouts = async run => {
  const layout = makeLayout()
  try { await run(layout) } finally { rmSync(layout.root, {recursive: true, force: true}) }
}
const runHook = (scripts, hook, payload, project) => spawnSync(process.execPath, [join(scripts, hook)], {
  input: JSON.stringify({cwd: project, ...payload}), cwd: project, encoding: 'utf8',
  env: {...process.env, CLAUDE_PROJECT_DIR: project, HOME: join(project, '..', 'home')},
})

test('verifier Bash 훅: 플러그인 판본의 프로젝트 리뷰어는 하네스 verifier 제한을 받지 않는다', () => {
  return withLayouts(({pluginScripts, sourceScripts, project}) => {
    const bash = agentType => ({tool_name: 'Bash', agent_type: agentType, tool_input: {command: 'git diff main...HEAD'}})
    assert.equal(runHook(pluginScripts, 'enforce-verifier-bash.mjs', bash('code-reviewer'), project).status, 2,
      '프로젝트가 정의하지 않은 접두 없는 이름의 verifier 제한이 풀렸다')
    declareAgent(project, 'code-reviewer')
    assert.equal(runHook(pluginScripts, 'enforce-verifier-bash.mjs', bash('code-reviewer'), project).status, 0,
      '프로젝트 리뷰어가 하네스 verifier로 오인돼 git diff가 막혔다')
    assert.equal(runHook(pluginScripts, 'enforce-verifier-bash.mjs', bash('web-harness:code-reviewer'), project).status, 2,
      '하네스 리뷰어의 verifier 제한이 풀렸다')
    assert.equal(runHook(sourceScripts, 'enforce-verifier-bash.mjs', bash('code-reviewer'), project).status, 2,
      '개발 판본에서 접두 없는 하네스 리뷰어의 verifier 제한이 풀렸다')
  })
})

test('소유권 훅: 플러그인 판본의 같은 이름 프로젝트 에이전트는 하네스 소유권을 물려받지 않는다', () => {
  return withLayouts(({pluginScripts, sourceScripts, project}) => {
    const write = agentType => ({tool_name: 'Write', agent_type: agentType, tool_input: {file_path: join(project, 'src/shared/a.ts')}})
    assert.equal(runHook(pluginScripts, 'enforce-agent-ownership.mjs', write('developer'), project).status, 0,
      '프로젝트가 정의하지 않은 접두 없는 developer가 막혔다(종전 동작)')
    declareAgent(project, 'developer')
    const foreign = runHook(pluginScripts, 'enforce-agent-ownership.mjs', write('developer'), project)
    assert.equal(foreign.status, 2, '프로젝트의 developer가 하네스 developer 소유권으로 썼다')
    assert.match(foreign.stderr, /not a web-harness agent/)
    assert.equal(runHook(pluginScripts, 'enforce-agent-ownership.mjs', write('web-harness:developer'), project).status, 0,
      runHook(pluginScripts, 'enforce-agent-ownership.mjs', write('web-harness:developer'), project).stderr)
    assert.equal(runHook(sourceScripts, 'enforce-agent-ownership.mjs', write('developer'), project).status, 0,
      '개발 판본에서 접두 없는 하네스 developer가 막혔다')
  })
})

test('개발 착수 점검: 플러그인 판본의 소유권 예행은 실제 스폰 이름(web-harness:developer)으로 통과한다', () => withLayouts(async ({pluginScripts, sourceScripts, project}) => {
  for (const scripts of [pluginScripts, sourceScripts]) {
    const {checkOwnership} = await import(pathToFileURL(join(scripts, 'validate-development-readiness.mjs')).href)
    const result = checkOwnership(project, SPEC)
    assert.equal(result.state, 'PASS', `${scripts === sourceScripts ? '개발' : '플러그인'} 판본의 소유권 예행이 막혔다: ${JSON.stringify(result)}`)
  }
}))
