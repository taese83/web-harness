#!/usr/bin/env node
// test-subagent-telemetry.mjs — 서브에이전트 소요 시간·턴 기록(막지 않는다)과 집계, 배선.
import assert from 'node:assert/strict'
import test from 'node:test'
import {spawnSync} from 'node:child_process'
import {existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'
import {summarizeTranscript} from './record-subagent-telemetry.mjs'

const hook = fileURLToPath(new URL('./record-subagent-telemetry.mjs', import.meta.url))
const report = fileURLToPath(new URL('./report-execution-telemetry.mjs', import.meta.url))
const withProject = (fn, {harness = true} = {}) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wh-sub-')))
  try {
    if (harness) mkdirSync(join(root, '_workspace/04_qa'), {recursive: true})
    return fn(root)
  } finally { rmSync(root, {recursive: true, force: true}) }
}
const run = (root, input) => spawnSync(process.execPath, [hook], {input: JSON.stringify({cwd: root, session_id: 's1', ...input}), encoding: 'utf8', env: {...process.env, CLAUDE_PROJECT_DIR: root}})
const rowsOf = root => readFileSync(join(root, '_workspace/04_qa/context-telemetry.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line))

// 런타임 transcript 모양: 한 assistant 메시지가 내용 블록마다 줄을 나눠 같은 id를 싣는다. 끝에 이어받은(SendMessage) 구간이 붙는다.
const line = row => JSON.stringify(row)
// 훅의 직전 기록 시각은 실제 현재 시각이다 — 첫 구간은 과거, 이어받은 구간은 그 뒤(미래)에 둔다.
const BASE = Date.now() - 10 * 60_000
const at = seconds => new Date(BASE + seconds * 1000).toISOString()
const firstRun = [
  {type: 'user', timestamp: at(0), message: {role: 'user', content: 'SECRET-PROMPT-4411'}},
  {type: 'assistant', timestamp: at(30), message: {id: 'm1', content: [{type: 'text', text: 'x'}]}},
  {type: 'assistant', timestamp: at(31), message: {id: 'm1', content: [{type: 'tool_use', name: 'Read', input: {}}]}},
  {type: 'user', timestamp: at(60), message: {content: [{type: 'tool_result', content: 'SECRET-FILE'}]}},
  {type: 'assistant', timestamp: at(180), message: {id: 'm2', content: [{type: 'tool_use', name: 'Read'}, {type: 'tool_use', name: 'Write'}]}},
].map(line)
// 50분 뒤 이어받음(대기) → 작업 20초. 런타임 재지시가 멈춤 기록보다 먼저 써질 수 있다.
const resumed = [
  {type: 'user', isMeta: true, timestamp: at(3180), message: {content: 'answer: SECRET-ANSWER'}},
  {type: 'assistant', timestamp: at(3200), message: {id: 'm3', content: [{type: 'tool_use', name: 'Edit'}]}},
].map(line)
const transcript = [...firstRun, 'not json'].join('\n')

test('transcript 요약: 간격의 합·메시지 id 수·도구별 수, 지시를 기다린 간격은 빼고 직전 기록 이후만 센다', () => {
  assert.deepEqual(summarizeTranscript(transcript), {durationMs: 180000, turns: 2, toolUses: {Read: 2, Write: 1}})
  const whole = [...firstRun, ...resumed].join('\n')
  const firstStop = BASE + 181_000
  assert.deepEqual(summarizeTranscript(whole, {since: firstStop}), {durationMs: 20000, turns: 1, toolUses: {Edit: 1}}, '이어받은 구간에 대기 50분이나 앞 구간을 섞었다')
  assert.equal(summarizeTranscript(whole).durationMs, 200000, '창이 없을 때도 지시 대기를 소요로 셌다')
  assert.equal(summarizeTranscript(whole, {since: BASE + 4000_000}), null, '창이 비었는데 숫자를 지어냈다')
  assert.equal(summarizeTranscript('garbage\n{}'), null, '시각이 없는데 숫자를 지어냈다')
})

test('훅: 멈춤마다 한 줄 — 이어받은 스폰은 직전 기록 이후만 기록하고 내용은 남기지 않는다', () => {
  withProject(root => {
    const path = join(root, 'agent.jsonl')
    writeFileSync(path, firstRun.join('\n'))
    assert.equal(run(root, {agent_type: 'web-harness:system-architect', agent_id: 'a1', agent_transcript_path: path}).status, 0)
    writeFileSync(path, [...firstRun, ...resumed].join('\n'))
    assert.equal(run(root, {agent_type: 'web-harness:system-architect', agent_id: 'a1', agent_transcript_path: path}).status, 0)
    const rows = rowsOf(root)
    assert.deepEqual(rows.map(row => [row.kind, row.agent, row.resumed, row.durationMs, row.turns]),
      [['subagent', 'system-architect', false, 180000, 2], ['subagent', 'system-architect', true, 20000, 1]])
    assert.doesNotMatch(readFileSync(join(root, '_workspace/04_qa/context-telemetry.jsonl'), 'utf8'), /SECRET/)
  })
})

test('훅: transcript가 링크면 따라 읽지 않는다', () => {
  withProject(root => {
    writeFileSync(join(root, 'real.jsonl'), transcript)
    symlinkSync(join(root, 'real.jsonl'), join(root, 'link.jsonl'))
    assert.equal(run(root, {agent_type: 'developer', agent_id: 'a2', agent_transcript_path: join(root, 'link.jsonl')}).status, 0)
    assert.equal(rowsOf(root)[0].durationMs, null)
  })
})

test('훅: transcript가 없으면 null로 남기고, 비하네스 프로젝트·깨진 입력은 아무것도 막지 않는다', () => {
  withProject(root => {
    assert.equal(run(root, {agent_type: 'developer', agent_transcript_path: join(root, 'missing.jsonl')}).status, 0)
    assert.equal(rowsOf(root)[0].durationMs, null)
  })
  withProject(root => {
    assert.equal(run(root, {agent_type: 'developer'}).status, 0)
    assert.equal(existsSync(join(root, '_workspace')), false, '하네스가 아닌 프로젝트에 _workspace를 만들었다')
  }, {harness: false})
  assert.equal(spawnSync(process.execPath, [hook], {input: '{', encoding: 'utf8'}).status, 0, '깨진 입력에 종료를 막았다')
})

test('집계: 스폰(agentId)별로 접어 에이전트별 소요를 보이고, 서브에이전트 행을 메인 도구 결과에 섞지 않는다', () => {
  withProject(root => {
    const path = join(root, 'agent.jsonl')
    writeFileSync(path, firstRun.join('\n'))
    run(root, {agent_type: 'web-harness:system-architect', agent_id: 'a1', agent_transcript_path: path})
    writeFileSync(path, [...firstRun, ...resumed].join('\n'))
    run(root, {agent_type: 'web-harness:system-architect', agent_id: 'a1', agent_transcript_path: path})
    run(root, {agent_type: 'web-harness:system-architect', agent_id: 'a9'})
    const out = spawnSync(process.execPath, [report, '--project', root], {encoding: 'utf8'}).stdout
    assert.match(out, /서브에이전트 실측: 스폰 2 · 멈춤 3/)
    assert.match(out, /system-architect: 스폰 2 · 멈춤 3 · 합 3\.3min · 평균 3\.3min · 최대 3\.3min · 평균 턴 3\.0 · 평균 도구 4\.0 \(미계측 1\)/)
    assert.match(out, /메인 세션 도구 결과: 0회/)
  })
})

test('배선: 저장소 설정과 플러그인 배포본 둘 다 SubagentStop에 건다', () => {
  const settings = JSON.parse(readFileSync(fileURLToPath(new URL('../settings.json', import.meta.url)), 'utf8'))
  const stopCommands = (settings.hooks?.SubagentStop ?? []).flatMap(entry => entry.hooks ?? []).map(hookEntry => hookEntry.command)
  assert.ok(stopCommands.some(command => command.includes('record-subagent-telemetry.mjs')), '저장소 설정의 SubagentStop에 없다')
  const build = readFileSync(fileURLToPath(new URL('./build-plugin.mjs', import.meta.url)), 'utf8')
  assert.match(build, /PLUGIN_SUBAGENT_STOP_HOOKS = \[[^\]]*'record-subagent-telemetry\.mjs'[^\]]*\]/, '플러그인 배포 목록에 없다')
})
