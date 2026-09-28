#!/usr/bin/env node
// test-hook-denial-log.mjs — PreToolUse 훅이 막을 때 로컬 기록(context-telemetry.jsonl, kind: deny)에 한 줄 남기는지 고정한다.
//
// 고정하는 사실: 막은 호출은 훅·코드·도구·대상 분류로 남는다(Grep 검색어·명령 원문은 남기지 않는다), 허용한 호출은 남지 않는다,
// 하네스 프로젝트가 아니면(`_workspace/04_qa/` 없음) 아무것도 만들지 않는다, 집계가 훅·코드별 건수와 같은 대상 반복을 보여 준다.
import assert from 'node:assert/strict'
import test from 'node:test'
import {spawnSync} from 'node:child_process'
import {existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const LOG = '_workspace/04_qa/context-telemetry.jsonl'
const runHook = (script, root, input) => spawnSync(process.execPath, [join(here, script)],
  {input: JSON.stringify({cwd: root, session_id: 's1', ...input}), encoding: 'utf8', env: {...process.env, CLAUDE_PROJECT_DIR: root}})
const withProject = (run, {harness = true} = {}) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wh-deny-log-')))
  try {
    if (harness) mkdirSync(join(root, '_workspace/04_qa'), {recursive: true})
    writeFileSync(join(root, '.env'), 'SECRET=1\n')
    mkdirSync(join(root, 'src'), {recursive: true})
    writeFileSync(join(root, 'src/app.ts'), 'export {}\n')
    return run(root)
  } finally { rmSync(root, {recursive: true, force: true}) }
}
const rows = root => (existsSync(join(root, LOG)) ? readFileSync(join(root, LOG), 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [])

test('막은 호출은 훅·코드·대상 분류로 남고, 허용한 호출은 남지 않는다', () => {
  withProject(root => {
    assert.equal(runHook('enforce-sensitive-access.mjs', root, {tool_name: 'Read', tool_input: {file_path: join(root, '.env')}}).status, 2)
    assert.equal(runHook('enforce-sensitive-access.mjs', root, {tool_name: 'Read', tool_input: {file_path: join(root, 'src/app.ts')}}).status, 0)
    const [row, ...rest] = rows(root)
    assert.equal(rest.length, 0, '허용한 호출이 기록됐다')
    assert.equal(row.kind, 'deny')
    assert.equal(row.hook, 'enforce-sensitive-access')
    assert.equal(row.code, 'DENY_SECRET_PATH')
    assert.equal(row.target, '.env')
    assert.equal(row.agent, null)
  })
})

test('Grep 검색어는 남기지 않고 경로만 남긴다', () => {
  withProject(root => {
    runHook('enforce-sensitive-access.mjs', root, {tool_name: 'Grep', tool_input: {pattern: 'sk-live-TOPSECRET', path: '.'}})
    const text = readFileSync(join(root, LOG), 'utf8')
    assert.doesNotMatch(text, /TOPSECRET/)
    assert.match(text, /DENY_RECURSIVE_ROOT_GREP/)
  })
})

test('문구로 막는 훅도 남는다(서브에이전트 표시 포함)', () => {
  withProject(root => {
    const result = runHook('enforce-agent-ownership.mjs', root,
      {tool_name: 'Write', agent_type: 'web-harness:developer', tool_input: {file_path: join(root, 'src/app.ts'), content: 'x'}})
    assert.equal(result.status, 2, result.stderr)
    const row = rows(root).at(-1)
    assert.equal(row.hook, 'enforce-agent-ownership')
    assert.equal(row.agent, 'web-harness:developer')
    assert.match(row.code, /^[A-Z_]+$/, '거부 문구가 아니라 안정 코드를 남긴다')
    assert.notEqual(row.code, 'UNCODED', '거부 자리의 코드가 전달되지 않았다')
    assert.equal(row.target, 'src/app.ts')
  })
})

test('하네스 프로젝트가 아니면 아무것도 만들지 않는다', () => {
  withProject(root => {
    assert.equal(runHook('enforce-sensitive-access.mjs', root, {tool_name: 'Read', tool_input: {file_path: join(root, '.env')}}).status, 2)
    assert.ok(!existsSync(join(root, '_workspace')))
  }, {harness: false})
})

test('집계: 훅·코드별 건수와 같은 대상 반복(오탐 후보)을 보여 주고, 결과 바이트 합계에 섞지 않는다', () => {
  withProject(root => {
    for (let index = 0; index < 2; index += 1) {
      runHook('enforce-sensitive-access.mjs', root, {tool_name: 'Glob', tool_input: {pattern: '**/*'}})
    }
    const report = spawnSync(process.execPath, [join(here, 'report-execution-telemetry.mjs'), '--project', root], {encoding: 'utf8'})
    assert.match(report.stdout, /훅 거부: 2회 \(메인 2 · 서브에이전트 0\)/)
    assert.match(report.stdout, /enforce-sensitive-access DENY_GIT_CONFIG_GLOB: 2회/)
    assert.match(report.stdout, /같은 대상 반복 거부\(오탐 후보\):\n\s+enforce-sensitive-access glob:\*\*\/\*: 2회/)
    assert.match(report.stdout, /메인 세션 도구 결과: 0회/)
  })
})

test('나머지 거부 훅도 안정 코드로 남는다 — ai-safety·release-gate·verifier-bash', () => {
  withProject(root => {
    const cases = [
      ['enforce-ai-safety.mjs', {tool_name: 'Write', tool_input: {file_path: join(root, 'src/llm.ts'), content: 'new OpenAI({dangerouslyAllowBrowser: true})'}},
        'enforce-ai-safety', 'BROWSER_CREDENTIAL'],
      ['enforce-release-gate.mjs', {tool_name: 'Write', tool_input: {file_path: join(root, '_workspace/04_qa/evidence/x.json'), content: '{}'}},
        'enforce-release-gate', 'RECEIPT_HAND_WRITE'],
      ['enforce-verifier-bash.mjs', {tool_name: 'Bash', agent_type: 'code-reviewer', tool_input: {command: 'rm -rf src'}},
        'enforce-verifier-bash', /^GLOBAL_POLICY_/],
    ]
    for (const [script, input, hook, code] of cases) {
      const result = runHook(script, root, input)
      assert.equal(result.status, 2, `${script}: ${result.stderr}`)
      const row = rows(root).at(-1)
      assert.equal(row.hook, hook)
      if (code instanceof RegExp) assert.match(row.code, code)
      else assert.equal(row.code, code)
      assert.doesNotMatch(JSON.stringify(row), /dangerouslyAllowBrowser|rm -rf/, '내용·명령 원문이 기록됐다')
    }
  })
})
