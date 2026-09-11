#!/usr/bin/env node
// test-eval-covers.mjs — `maturity: eval-covered`의 근거는 시나리오의 **명시적 `covers`**다.
//
// 계기(2026-09-11 실측): 판정이 scenarios.json 전체에서 스킬 이름을 문자열로 찾았다. 그래서
// 13개 중 10개의 `eval-covered`가 `entrySkill` 한 칸에만 기대고 있었고, 진입점을 `/wh`로 옮기는
// 순간 근거가 사라지는 구조였다. 이름이 부정 단언에 적혀 있기만 해도 커버로 셌다.
//
// 여기서 고정하는 사실:
//   (1) 텍스트 언급은 커버가 아니다 — covers에 선언된 것만 센다
//   (2) 실제 저장소에서 covers를 빼면 **실제 판정 줄**이 그 스킬을 잡는다(배선)
//   (3) 실제 저장소는 통과한다
import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {coveredSkillsFrom, validateContractHygiene} from './validators/validate-contract-hygiene.mjs'

const repositoryRoot = new URL('../..', import.meta.url).pathname
const realScenarios = () => JSON.parse(readFileSync(join(repositoryRoot, '.claude/evals/scenarios.json'), 'utf8'))
const run = scenarios => {
  const calls = {pass: [], fail: []}
  validateContractHygiene({repositoryRoot, evalScenarios: scenarios,
    pass: message => calls.pass.push(message), fail: message => calls.fail.push(message)})
  return calls
}

test('텍스트 언급은 커버가 아니다 — covers에 선언된 것만 센다', () => {
  const covered = coveredSkillsFrom([
    {covers: ['web-plan'], assertions: ['does not route to web-verify']},
    {assertions: ['mentions timeseries-dashboard only in prose']},
  ])
  assert.deepEqual([...covered], ['web-plan'], '부정 단언이나 서술 속 이름을 커버로 셌다')
})

test('실제 저장소에서 covers를 빼면 실제 판정 줄이 그 스킬을 잡는다 — 배선', () => {
  // web-plan의 covers만 지운다. 텍스트 언급을 세지 않는다는 속성은 위 순수 테스트가 증명한다 —
  // 이 테스트는 **실제 판정 줄**이 covers 부재를 잡는지(배선)만 본다.
  const scenarios = realScenarios().map(item => ({...item, covers: (item.covers ?? []).filter(skill => skill !== 'web-plan')}))
  const {fail} = run(scenarios)
  assert.ok(fail.some(message => message.includes("'web-plan'") && message.includes('covers')),
    `covers에서 뺐는데 잡지 못했다 — 판정이 여전히 텍스트 언급을 본다\n${fail.join('\n')}`)
})

test('실제 저장소는 통과한다 — 이관 뒤에도 eval-covered 근거가 남아 있다', () => {
  const {fail} = run(realScenarios())
  const maturity = fail.filter(message => message.includes('covers'))
  assert.deepEqual(maturity, [], `eval-covered 근거가 사라졌다:\n${maturity.join('\n')}`)
})
