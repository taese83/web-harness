#!/usr/bin/env node
// test-subagent-telemetry.mjs — 서브에이전트 소요·턴·토큰 기록(막지 않는다)과 run 집계·execution-telemetry 생성, 배선.
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
const NO_TOKENS = {contextTokens: null, processedTokens: null, outputTokens: null}

// 토큰: 한 메시지가 같은 id로 여러 줄에 스트리밍되고 output_tokens는 줄마다 자란다 — id마다 마지막 줄 하나만 센다.
const usage = (input, cacheCreation, cacheRead, output) =>
  ({input_tokens: input, cache_creation_input_tokens: cacheCreation, cache_read_input_tokens: cacheRead, output_tokens: output})
const tokenRun = [
  {type: 'user', timestamp: at(0), message: {content: 'SECRET-PROMPT'}},
  {type: 'assistant', timestamp: at(10), message: {id: 't1', usage: usage(2, 1000, 0, 8), content: [{type: 'thinking'}]}},
  {type: 'assistant', timestamp: at(11), message: {id: 't1', usage: usage(2, 1000, 0, 8), content: [{type: 'text', text: 'x'}]}},
  {type: 'assistant', timestamp: at(12), message: {id: 't1', usage: usage(2, 1000, 0, 186), content: [{type: 'tool_use', name: 'Read'}]}},
  {type: 'user', timestamp: at(20), message: {content: [{type: 'tool_result', content: 'SECRET-FILE'}]}},
  {type: 'assistant', timestamp: at(30), message: {id: 't2', usage: usage(2, 200, 1000, 16), content: [{type: 'thinking'}]}},
  {type: 'assistant', timestamp: at(31), message: {id: 't2', usage: usage(2, 200, 1000, 300), content: [{type: 'text', text: 'done'}]}},
].map(line)
const tokenResumed = [
  {type: 'user', timestamp: at(3000), message: {content: 'next'}},
  {type: 'assistant', timestamp: at(3010), message: {id: 't3', usage: usage(2, 50, 1200, 40), content: [{type: 'text', text: 'ok'}]}},
].map(line)

test('transcript 요약: 간격의 합·메시지 id 수·도구별 수, 지시를 기다린 간격은 빼고 직전 기록 이후만 센다', () => {
  assert.deepEqual(summarizeTranscript(transcript), {durationMs: 180000, turns: 2, toolUses: {Read: 2, Write: 1}, ...NO_TOKENS}, 'usage가 없는데 토큰을 지어냈다')
  const whole = [...firstRun, ...resumed].join('\n')
  const firstStop = BASE + 181_000
  assert.deepEqual(summarizeTranscript(whole, {since: firstStop}), {durationMs: 20000, turns: 1, toolUses: {Edit: 1}, ...NO_TOKENS}, '이어받은 구간에 대기 50분이나 앞 구간을 섞었다')
  assert.equal(summarizeTranscript(whole).durationMs, 200000, '창이 없을 때도 지시 대기를 소요로 셌다')
  assert.equal(summarizeTranscript(whole, {since: BASE + 4000_000}), null, '창이 비었는데 숫자를 지어냈다')
  assert.equal(summarizeTranscript('garbage\n{}'), null, '시각이 없는데 숫자를 지어냈다')
})

test('토큰: 메시지 id마다 마지막 줄 usage 하나 — 문맥은 마지막 메시지, 처리는 합, 출력은 출력 합이고 이어받은 창은 그 뒤만 센다', () => {
  // t1 = 2+1000+0+186 = 1188, t2 = 2+200+1000+300 = 1502. 줄마다 더하면 1010+1010+1188+1218+1502 = 5928.
  const first = summarizeTranscript(tokenRun.join('\n'))
  assert.deepEqual([first.contextTokens, first.processedTokens, first.outputTokens, first.turns], [1502, 2690, 486, 2],
    '스트리밍 줄을 중복으로 세었거나 출력 중간값을 썼다')
  const whole = [...tokenRun, ...tokenResumed].join('\n')
  const resumedWindow = summarizeTranscript(whole, {since: BASE + 32_000})
  assert.deepEqual([resumedWindow.contextTokens, resumedWindow.processedTokens, resumedWindow.outputTokens], [1292, 1292, 40],
    '이어받은 창에 앞 구간의 토큰을 섞었다')
  const all = summarizeTranscript(whole)
  assert.equal(all.processedTokens, 2690 + 1292)
  assert.equal(all.contextTokens, 1292, '문맥은 마지막 메시지의 값이다')
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

test('훅: 토큰과 런타임 meta의 설명을 남기고 프롬프트·결과 내용은 남기지 않는다', () => {
  withProject(root => {
    const path = join(root, 'agent-a5.jsonl')
    writeFileSync(path, tokenRun.join('\n'))
    writeFileSync(join(root, 'agent-a5.meta.json'), JSON.stringify({agentType: 'web-harness:developer', description: 'R2 fix spacing'}))
    assert.equal(run(root, {agent_type: 'web-harness:developer', agent_id: 'a5', agent_transcript_path: path}).status, 0)
    const [row] = rowsOf(root)
    assert.deepEqual([row.description, row.contextTokens, row.processedTokens, row.outputTokens], ['R2 fix spacing', 1502, 2690, 486])
    assert.doesNotMatch(readFileSync(join(root, '_workspace/04_qa/context-telemetry.jsonl'), 'utf8'), /SECRET/)
  })
  withProject(root => {
    const path = join(root, 'agent-a6.jsonl')
    writeFileSync(path, tokenRun.join('\n'))
    writeFileSync(join(root, 'real.meta.json'), JSON.stringify({description: 'linked'}))
    symlinkSync(join(root, 'real.meta.json'), join(root, 'agent-a6.meta.json'))
    run(root, {agent_type: 'developer', agent_id: 'a6', agent_transcript_path: path})
    assert.equal(rowsOf(root)[0].description, null, 'meta 링크를 따라 읽었다')
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

const contextRows = rows => rows.map(row => JSON.stringify({kind: 'subagent', resumed: false, toolUses: {}, ...row})).join('\n') + '\n'

test('집계: run(세션)별 스폰·토큰 합과 runaway(문맥 >120k 또는 >20분)를 보이고, --emit은 execution-telemetry 형식을 쓴다', () => {
  withProject(root => {
    writeFileSync(join(root, '_workspace/04_qa/context-telemetry.jsonl'), contextRows([
      {at: '2026-10-16T01:00:00.000Z', session: 'sessionA-1234', agent: 'developer', agentId: 'd1', description: 'R1 impl', durationMs: 60_000, turns: 3, toolUses: {Read: 2}, contextTokens: 50_000, processedTokens: 400_000, outputTokens: 9_000},
      {at: '2026-10-16T01:30:00.000Z', session: 'sessionA-1234', agent: 'developer', agentId: 'd1', resumed: true, durationMs: 30_000, turns: 1, toolUses: {Edit: 1}, contextTokens: 130_000, processedTokens: 130_000, outputTokens: 1_000},
      {at: '2026-10-16T01:05:00.000Z', session: 'sessionA-1234', agent: 'code-reviewer', agentId: 'r1', durationMs: 21 * 60_000, turns: 2, contextTokens: 40_000, processedTokens: 80_000, outputTokens: 2_000},
      {at: '2026-10-16T02:00:00.000Z', session: 'sessionB-5678', agent: 'developer', agentId: 'd2', durationMs: null, turns: null, toolUses: null, contextTokens: null, processedTokens: null, outputTokens: null},
    ]))
    const out = spawnSync(process.execPath, [report, '--project', root], {encoding: 'utf8'}).stdout
    assert.match(out, /run: 2026-10-16T01:00:00\.000Z\+sessionA — 스폰 2 · 멈춤 3 · 이어받기 1/)
    assert.match(out, /토큰: 문맥 합 170,000 · 처리 합 610,000 · 출력 합 12,000 \(2\/2 스폰 계측\)/, '스폰 문맥은 멈춤 중 최대, 처리·출력은 합이다')
    assert.match(out, /runaway 스폰 2개/)
    assert.match(out, /developer 「R1 impl」: 문맥 130,000 tokens · 1\.5min/)
    assert.match(out, /code-reviewer: 문맥 40,000 tokens · 21\.0min/)
    assert.match(out, /run: 2026-10-16T02:00:00\.000Z\+sessionB — 스폰 1[^\n]*\n  토큰: 미계측/, '미계측 run에 숫자를 지어냈다')

    const target = join(root, 'execution-telemetry.json')
    const emitted = spawnSync(process.execPath, [report, '--project', root, '--emit', target, '--run-suffix', '+gatesOn'], {encoding: 'utf8'})
    assert.equal(emitted.status, 0, emitted.stderr)
    const file = JSON.parse(readFileSync(target, 'utf8'))
    assert.equal(file.schemaVersion, 1)
    assert.deepEqual(file.spawns.map(spawn => [spawn.run, spawn.agent, spawn.tokens, spawn.durationMs, spawn.toolUses, spawn.stops, spawn.resumes]), [
      ['2026-10-16T01:00:00.000Z+sessionA+gatesOn', 'developer', 130_000, 90_000, 3, 2, 1],
      ['2026-10-16T01:00:00.000Z+sessionA+gatesOn', 'code-reviewer', 40_000, 21 * 60_000, 0, 1, 0],
      ['2026-10-16T02:00:00.000Z+sessionB+gatesOn', 'developer', null, null, null, 1, 0],
    ])
    assert.ok(file.spawns.every(spawn => ['outcome', 'retry', 'mode', 'phase'].every(field => !(field in spawn))), '재지 않은 outcome·retry·mode·phase를 지어냈다')

    symlinkSync(join(root, 'elsewhere.json'), join(root, 'link.json'))
    assert.equal(spawnSync(process.execPath, [report, '--project', root, '--emit', join(root, 'link.json')], {encoding: 'utf8'}).status, 1, '링크에 썼다')
    assert.equal(existsSync(join(root, 'elsewhere.json')), false)
    assert.equal(spawnSync(process.execPath, [report, '--project', root, '--emit', target, '--run-suffix', 'gatesOn; rm'], {encoding: 'utf8'}).status, 2)
    assert.equal(spawnSync(process.execPath, [report, '--project', join(root, '_workspace'), '--emit', target], {encoding: 'utf8'}).status, 1, '프로젝트 밖에 썼다')
  })
})

test('eval 실행기: 암 라벨은 실행 모델에 맡기지 않고 실행 뒤 --emit으로 붙인다', () => {
  const executor = readFileSync(fileURLToPath(new URL('./run-eval-executor.mjs', import.meta.url)), 'utf8')
  assert.match(executor, /'--emit', join\(fixture, '_workspace\/04_qa\/execution-telemetry\.json'\), '--run-suffix', arm === 'off' \? '\+gatesOff' : '\+gatesOn'/)
  assert.doesNotMatch(executor, /execution-telemetry\.json의 `run` 라벨/, '실행 모델에게 라벨을 손으로 쓰라고 지시한다')
})

test('계약: 오케스트레이터에게 스폰 usage를 손으로 옮기라고 지시하지 않는다', () => {
  const skill = fileURLToPath(new URL('../skills/web-orchestrator/', import.meta.url))
  for (const file of ['SKILL.md', 'references/iterate-lane-card.md', 'references/execution-budget-contract.md']) {
    assert.doesNotMatch(readFileSync(join(skill, file), 'utf8'), /execution-telemetry\.json|telemetry 1행|append한다:/, `${file}에 수기 기록 지시가 남았다`)
  }
})

test('배선: 저장소 설정과 플러그인 배포본 둘 다 SubagentStop에 건다', () => {
  const settings = JSON.parse(readFileSync(join(fileURLToPath(new URL('../..', import.meta.url)), '.claude/settings.json'), 'utf8'))
  const stopCommands = (settings.hooks?.SubagentStop ?? []).flatMap(entry => entry.hooks ?? []).map(hookEntry => hookEntry.command)
  assert.ok(stopCommands.some(command => command.includes('record-subagent-telemetry.mjs')), '저장소 설정의 SubagentStop에 없다')
  const build = readFileSync(fileURLToPath(new URL('./build-plugin.mjs', import.meta.url)), 'utf8')
  assert.match(build, /PLUGIN_SUBAGENT_STOP_HOOKS = \[[^\]]*'record-subagent-telemetry\.mjs'[^\]]*\]/, '플러그인 배포 목록에 없다')
})
