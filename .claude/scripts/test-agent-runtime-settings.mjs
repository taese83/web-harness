#!/usr/bin/env node
// test-agent-runtime-settings.mjs — 에이전트·스킬 프런트매터의 model·effort 값 검사와 그 배선.
//
// 고정하는 사실:
//   - 에이전트는 effort를 반드시 적는다(없으면 세션 노력 수준을 물려받는다) — 값은 low|medium|high|xhigh|max
//   - model은 별칭(opus|sonnet|haiku|fable|inherit)이나 모델 ID만 받는다 — 오타는 Claude Code가 조용히 무시한다
//   - 스킬의 model·effort는 선택이지만 적었다면 같은 값 집합이어야 한다
//   - validate-harness가 이 검사를 부르고, 실제 저장소의 에이전트·스킬은 전부 통과한다
import assert from 'node:assert/strict'
import test from 'node:test'
import {readdirSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {agentRuntimeSettingFailures, skillRuntimeSettingFailures} from './validators/validate-agent-runtime-settings.mjs'

const CLAUDE = fileURLToPath(new URL('..', import.meta.url))
const frontmatterOf = source => Object.fromEntries((source.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? '')
  .split('\n').map(line => line.match(/^([\w-]+):\s*(.*)$/)).filter(Boolean).map(([, key, value]) => [key, value.trim()]))

test('에이전트: effort가 없거나 모르는 값이면, model이 모르는 값이면 잡는다', () => {
  assert.deepEqual(agentRuntimeSettingFailures('a.md', {model: 'opus', effort: 'xhigh'}), [])
  assert.deepEqual(agentRuntimeSettingFailures('a.md', {model: 'claude-opus-5-5', effort: 'low'}), [])
  assert.deepEqual(agentRuntimeSettingFailures('a.md', {model: 'claude-opus-5-5[1m]', effort: 'max'}), [])
  assert.match(agentRuntimeSettingFailures('a.md', {model: 'sonnet'}).join(), /effort must be explicit/)
  assert.match(agentRuntimeSettingFailures('a.md', {model: 'sonnet', effort: 'extra'}).join(), /effort "extra"/)
  assert.match(agentRuntimeSettingFailures('a.md', {model: 'opus5', effort: 'high'}).join(), /model "opus5"/)
  assert.match(agentRuntimeSettingFailures('a.md', {model: 'Sonnet', effort: 'high'}).join(), /model "Sonnet"/)
})

test('스킬: model·effort는 선택이지만 적었다면 허용 값이다', () => {
  assert.deepEqual(skillRuntimeSettingFailures('s.md', {}), [])
  assert.deepEqual(skillRuntimeSettingFailures('s.md', {effort: 'xhigh'}), [])
  assert.match(skillRuntimeSettingFailures('s.md', {effort: 'x-high'}).join(), /effort "x-high"/)
  assert.match(skillRuntimeSettingFailures('s.md', {model: 'gpt'}).join(), /model "gpt"/)
})

test('배선: validate-harness가 에이전트와 스킬 양쪽에서 검사를 부른다', () => {
  const harness = readFileSync(join(CLAUDE, 'scripts/validate-harness.mjs'), 'utf8')
  assert.match(harness, /for \(const failure of agentRuntimeSettingFailures\(relativePath, frontmatter\)\) fail\(failure\)/)
  assert.match(harness, /for \(const failure of skillRuntimeSettingFailures\(relativePath, frontmatter\)\) fail\(failure\)/)
})

test('실제 저장소: 에이전트 전부가 effort를 적고 모든 값이 허용 집합이다', () => {
  const agents = readdirSync(join(CLAUDE, 'agents')).filter(name => name.endsWith('.md'))
  assert.ok(agents.length > 0)
  for (const name of agents) {
    assert.deepEqual(agentRuntimeSettingFailures(name, frontmatterOf(readFileSync(join(CLAUDE, 'agents', name), 'utf8'))), [])
  }
  for (const skill of readdirSync(join(CLAUDE, 'skills'))) {
    let source
    try { source = readFileSync(join(CLAUDE, 'skills', skill, 'SKILL.md'), 'utf8') } catch { continue }
    assert.deepEqual(skillRuntimeSettingFailures(skill, frontmatterOf(source)), [])
  }
})
