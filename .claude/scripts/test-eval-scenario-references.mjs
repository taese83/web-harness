#!/usr/bin/env node
// test-eval-scenario-references.mjs — 평가 시나리오가 실재하는 스킬로 들어가고 실재하는 에이전트를 기대한다.
//
// 고정하는 사실:
//   - 없는 스킬로 들어가는 시나리오와, 제거된 에이전트(역할 어휘로 끝나는 이름)를 기대하는 단언을 잡는다
//   - 하네스의 시나리오에는 그런 참조가 없다
import assert from 'node:assert/strict'
import test from 'node:test'
import {existsSync, readdirSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {staleScenarioReferences} from './validators/validate-workflows-and-evals.mjs'

test('없는 스킬과 제거된 에이전트를 잡고, 실재 이름과 일반 하이픈 단어는 통과시킨다', () => {
  const problems = staleScenarioReferences({
    scenarios: [
      {id: 'gone-skill', entrySkill: '/dev-orchestrator', assertions: ['anything']},
      {id: 'gone-agent', entrySkill: '/wh new', assertions: ['realtime-data-builder runs', 'developer implements a read-only view', 'timeseries-verifier passes']},
    ],
    skillNames: new Set(['wh']),
    agentNames: ['developer', 'timeseries-verifier', 'design-preview-builder'],
  })
  assert.deepEqual(problems.map(({id, problem}) => `${id}: ${problem}`), [
    'gone-skill: entrySkill /dev-orchestrator은 없는 스킬이다',
    'gone-agent: 단언이 없는 에이전트 realtime-data-builder를 기대한다',
  ])
})

test('하네스 평가 시나리오에는 없는 스킬·에이전트 참조가 없다', () => {
  const claudeDirectory = fileURLToPath(new URL('..', import.meta.url))
  const scenarios = JSON.parse(readFileSync(join(claudeDirectory, 'evals', 'scenarios.json'), 'utf8'))
  const skillNames = new Set(readdirSync(join(claudeDirectory, 'skills')).filter(name => existsSync(join(claudeDirectory, 'skills', name, 'SKILL.md'))))
  const agentNames = readdirSync(join(claudeDirectory, 'agents')).filter(name => name.endsWith('.md')).map(name => name.slice(0, -'.md'.length))
  assert.deepEqual(staleScenarioReferences({scenarios, skillNames, agentNames}), [])
})
