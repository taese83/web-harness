#!/usr/bin/env node
// test-eval-trace-metrics.mjs — 평가 트레이스에서 실행 비용 지표를 뽑는다.
//
// 고정하는 사실:
//   - 최대 컨텍스트는 한 요청의 입력(입력 + 캐시 읽기 + 캐시 생성) 최댓값이다 — 합계가 아니다
//   - 메인 스레드만 센다 — 서브에이전트 메시지(`parent_tool_use_id`)는 턴·컨텍스트·도구 수에 섞지 않는다
//   - 도구별 호출 수와 에이전트 스폰을 세고, 하네스 스크립트 **소스**를 연 호출(셸·Read·Grep)만 센다 — 실행은 세지 않는다
//   - 깨진 줄은 건너뛰고, result 줄이 없으면 assistant 줄 수를 턴으로 쓴다
//   - 디스패처를 셸이 못 찾은 결과는 메인·서브에이전트 모두 센다 — 이름이 다른 명령(오타)은 세지 않는다
import assert from 'node:assert/strict'
import test from 'node:test'
import {traceMetrics} from './eval-trace-metrics.mjs'

const line = value => JSON.stringify(value)
const assistant = (usage, content = [], parent = null) => line({type: 'assistant', parent_tool_use_id: parent, message: {role: 'assistant', usage, content}})
const bash = command => ({type: 'tool_use', name: 'Bash', input: {command}})

test('메인 스레드의 최대 컨텍스트·도구 수·스폰·스크립트 소스 읽기를 센다', () => {
  const trace = [
    line({type: 'system', subtype: 'init', model: 'claude-opus-5-5'}),
    assistant({input_tokens: 2, cache_read_input_tokens: 10000, cache_creation_input_tokens: 5000}, [{...bash('web-harness-script spec --check'), id: 'b1'}]),
    line({type: 'user', parent_tool_use_id: null, message: {role: 'user', content: [{type: 'tool_result', tool_use_id: 'b1', is_error: true, content: 'exit 2'}]}}),
    assistant({input_tokens: 3, cache_read_input_tokens: 40000, cache_creation_input_tokens: 2000}, [
      {type: 'tool_use', name: 'Agent', input: {subagent_type: 'web-harness:system-architect'}},
      bash('sed -n 1,80p /plugin/.claude/scripts/validate-spawn-plan.mjs'),
      {type: 'tool_use', name: 'Read', input: {file_path: '/plugin/.claude/scripts/ticket/ticket-create.mjs'}},
    ]),
    assistant({input_tokens: 1, cache_read_input_tokens: 900000}, [bash('cat /plugin/.claude/scripts/spec.mjs')], 'toolu_parent'),
    '{ 깨진 줄',
    line({type: 'result', num_turns: 7, usage: {output_tokens: 900, cache_read_input_tokens: 50000}}),
  ].join('\n')
  const metrics = traceMetrics(trace)
  assert.equal(metrics.peakContextTokens, 42003, '서브에이전트 요청을 메인 컨텍스트로 셌다')
  assert.equal(metrics.turns, 7)
  assert.equal(metrics.outputTokens, 900)
  assert.deepEqual(metrics.toolUses, {Bash: 2, Agent: 1, Read: 1})
  assert.equal(metrics.bashErrors, 1, '메인 스레드 Bash 오류를 세지 않았다')
  assert.deepEqual(metrics.agentSpawns, {'web-harness:system-architect': 1})
  assert.equal(metrics.scriptSourceReads, 2, '스크립트 실행을 소스 읽기로 셌거나 Read 도구의 소스 읽기를 놓쳤다')
})

test('result 줄이 없으면 assistant 줄 수가 턴이다', () => {
  assert.equal(traceMetrics(assistant({input_tokens: 1})).turns, 1)
})

test('디스패처를 셸이 못 찾은 결과를 메인·서브에이전트 모두 세고, 이름이 다른 명령은 세지 않는다', () => {
  const result = (text, parent = null) => line({type: 'user', parent_tool_use_id: parent, message: {role: 'user', content: [{type: 'tool_result', tool_use_id: 'x', is_error: true, content: [{type: 'text', text}]}]}})
  const trace = [
    result('(eval):1: command not found: web-harness-script'),
    result('bash: web-harness-script: command not found', 'toolu_parent'),
    result('(eval):1: command not found: web-harness-scripts'),
  ].join('\n')
  assert.equal(traceMetrics(trace).dispatcherNotFound, 2)
})
