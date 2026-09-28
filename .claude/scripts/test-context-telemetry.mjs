#!/usr/bin/env node
// test-context-telemetry.mjs — 메인 세션 도구 결과 크기 기록(막지 않는다)과 집계.
import assert from 'node:assert/strict'
import test from 'node:test'
import {spawnSync} from 'node:child_process'
import {existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'

const hook = fileURLToPath(new URL('./record-context-telemetry.mjs', import.meta.url))
const report = fileURLToPath(new URL('./report-execution-telemetry.mjs', import.meta.url))
const withProject = (fn, {harness = true} = {}) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wh-ctx-')))
  try {
    if (harness) mkdirSync(join(root, '_workspace/04_qa'), {recursive: true})
    return fn(root)
  } finally { rmSync(root, {recursive: true, force: true}) }
}
const run = (root, input) => spawnSync(process.execPath, [hook], {input: JSON.stringify({cwd: root, session_id: 's1', ...input}), encoding: 'utf8', env: {...process.env, CLAUDE_PROJECT_DIR: root}})
const rowsOf = root => readFileSync(join(root, '_workspace/04_qa/context-telemetry.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line))

test('메인 세션의 도구 결과 크기와 대상만 기록한다 — 내용은 남기지 않는다', () => {
  withProject(root => {
    const secret = 'SECRET-CONTENT-7731'.repeat(10)
    assert.equal(run(root, {tool_name: 'Bash', tool_input: {command: 'node .claude/scripts/run-quality-gates.mjs --check lint'}, tool_response: {stdout: secret}}).status, 0)
    assert.equal(run(root, {tool_name: 'Read', tool_input: {file_path: join(root, '_workspace/01_plan/feature-plan.md'), offset: 70, limit: 48}, tool_response: 'x'.repeat(300)}).status, 0)
    assert.equal(run(root, {tool_name: 'Agent', tool_input: {subagent_type: 'web-harness:developer', prompt: 'p'}, tool_response: 'done'}).status, 0)
    const rows = rowsOf(root)
    assert.deepEqual(rows.map(row => row.target), ['script:run-quality-gates', '_workspace/01_plan/feature-plan.md#70+48', 'agent:web-harness:developer'])
    assert.ok(rows[0].bytes > 190)
    assert.doesNotMatch(readFileSync(join(root, '_workspace/04_qa/context-telemetry.jsonl'), 'utf8'), /SECRET-CONTENT/)
  })
})

test('서브에이전트·비하네스 프로젝트는 기록하지 않고, 어떤 경우에도 막지 않는다', () => {
  withProject(root => {
    assert.equal(run(root, {tool_name: 'Bash', agent_type: 'developer', tool_input: {command: 'ls'}, tool_response: 'a'}).status, 0)
    assert.equal(existsSync(join(root, '_workspace/04_qa/context-telemetry.jsonl')), false)
  })
  withProject(root => {
    assert.equal(run(root, {tool_name: 'Bash', tool_input: {command: 'ls'}, tool_response: 'a'}).status, 0)
    assert.equal(existsSync(join(root, '_workspace')), false, '하네스가 아닌 프로젝트에 _workspace를 만들었다')
  }, {harness: false})
  assert.equal(spawnSync(process.execPath, [hook], {input: '{', encoding: 'utf8'}).status, 0, '깨진 입력에 도구 흐름을 막았다')
})

test('기록 자리가 심링크면 따라 쓰지 않는다', () => {
  withProject(root => {
    const outside = join(root, 'outside.txt')
    writeFileSync(outside, 'keep\n')
    symlinkSync(outside, join(root, '_workspace/04_qa/context-telemetry.jsonl'))
    assert.equal(run(root, {tool_name: 'Bash', tool_input: {command: 'ls'}, tool_response: 'a'}).status, 0)
    assert.equal(readFileSync(outside, 'utf8'), 'keep\n')
  })
})

test('집계: 도구·대상별 바이트 합을 보여 준다', () => {
  withProject(root => {
    run(root, {tool_name: 'Bash', tool_input: {command: 'cat big.md'}, tool_response: 'y'.repeat(5000)})
    run(root, {tool_name: 'Bash', tool_input: {command: 'cat big.md'}, tool_response: 'y'.repeat(5000)})
    const result = spawnSync(process.execPath, [report, '--project', root], {encoding: 'utf8'})
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /메인 세션 도구 결과: 2회/)
    assert.match(result.stdout, /Bash bash:cat: 2회/)
  })
})

test('env 할당·명령 원문은 남지 않고, 하네스 문서·소스 읽기는 분류된다', () => {
  withProject(root => {
    run(root, {tool_name: 'Bash', tool_input: {command: 'API_TOKEN=tok-9912 node x.js'}, tool_response: 'a'})
    run(root, {tool_name: 'Bash', tool_input: {command: 'sed -n 1,80p /plugin/.claude/scripts/run-quality-gates.mjs'}, tool_response: 'a'})
    run(root, {tool_name: 'Bash', tool_input: {command: 'cat _workspace/.contracts/skills/web-orchestrator/references/x.md'}, tool_response: 'a'})
    run(root, {tool_name: 'Read', tool_input: {file_path: '/plugin/.claude/skills/wh/SKILL.md'}, tool_response: 'a'})
    const text = readFileSync(join(root, '_workspace/04_qa/context-telemetry.jsonl'), 'utf8')
    assert.doesNotMatch(text, /tok-9912/)
    assert.deepEqual(rowsOf(root).map(row => row.target), ['bash:(env)', 'bash:sed:harness-source', 'bash:cat:harness-source', '(outside:harness-source)'])
  })
})

test('agent_id만 있는 서브에이전트 호출도 기록하지 않는다', () => {
  withProject(root => {
    run(root, {tool_name: 'Bash', agent_id: 'a1', tool_input: {command: 'ls'}, tool_response: 'a'})
    assert.equal(existsSync(join(root, '_workspace/04_qa/context-telemetry.jsonl')), false)
  })
})

test('기록 디렉터리가 링크면 따라가 쓰지 않는다', () => {
  withProject(root => {
    const outside = join(root, 'outside-dir')
    mkdirSync(outside)
    rmSync(join(root, '_workspace/04_qa'), {recursive: true})
    symlinkSync(outside, join(root, '_workspace/04_qa'))
    assert.equal(run(root, {tool_name: 'Bash', tool_input: {command: 'ls'}, tool_response: 'a'}).status, 0)
    assert.equal(existsSync(join(outside, 'context-telemetry.jsonl')), false, '링크 너머 디렉터리에 기록했다')
  })
})

test('cd 접두는 벗기고 실제 명령으로 분류한다', () => {
  withProject(root => {
    run(root, {tool_name: 'Bash', tool_input: {command: 'cd /tmp/proj && node .claude/scripts/spec.mjs --project-root .'}, tool_response: 'a'})
    run(root, {tool_name: 'Bash', tool_input: {command: 'cd "/tmp/a b"; cd sub && cat _workspace/.contracts/skills/x/references/y.md'}, tool_response: 'a'})
    run(root, {tool_name: 'Bash', tool_input: {command: 'cd /tmp && git status'}, tool_response: 'a'})
    assert.deepEqual(rowsOf(root).map(row => row.target), ['script:spec', 'bash:cat:harness-source', 'bash:git'])
  })
})
