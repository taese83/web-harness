#!/usr/bin/env node
// test-plugin-eval-cases.mjs — 배포본 평가 사례(`claude plugin eval` 형식)를 실행 없이 검사한다.
//
// 고정하는 사실:
//   - 알 수 없는 머리말 키·짧은 턴·시간 상한·이름공간 없는 진입·채점기 없음·없는 scaffold를 잡는다
//   - regression 사례에 한 일을 보는 채점기·사후 검사가 없으면 잡는다(음성 채점기만 있으면 무작업 실행이 통과한다) — 목록형 tags도 읽는다
//   - 시드에 이미 있는 파일을 보는 file-exists 사후 검사는 공허하다고 잡는다 — 시드에 없는 산출물만 한 일의 증거다
//   - 하네스의 사례는 전부 통과하고 regression 태그 사례가 하나 이상 있다
import assert from 'node:assert/strict'
import test from 'node:test'
import {mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'
import {pluginEvalCaseProblems} from './validators/validate-workflows-and-evals.mjs'

test('형식이 어긋난 사례를 잡는다', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wh-plugin-cases-')))
  try {
    const write = (path, text) => { mkdirSync(join(root, path, '..'), {recursive: true}); writeFileSync(join(root, path), text) }
    write('good/prompt.md', '---\ntags: [regression]\nmax_turns: 60\ntimeout_seconds: 900\n---\n/web-harness:wh fix 무언가\n')
    write('good/graders/ok.md', '---\ntype: regex\npattern: "x"\n---\n')
    write('bad/prompt.md', '---\nmax_turn: 60\ntimeout_seconds: 120\n---\n/wh fix 무언가\n')
    write('bad/graders/odd.md', '---\ntype: vibes\n---\n')
    write('bad/case.yaml', 'schema_version: "1.1"\nname: bad\ncontext:\n  scaffold_script: missing.sh\n')
    write('vacuous/prompt.md', '---\ntags:\n  - regression\nmax_turns: 60\ntimeout_seconds: 900\n---\n/web-harness:wh change 무언가\n')
    write('vacuous/graders/no-write.md', '---\ntype: tool_used\ntool: Write\nmin: 0\nmax: 0\n---\n')
    write('vacuous/graders/no-dev.md', '---\ntype: regex\ntarget: trace\npattern: "developer"\nmatch: not_contains\n---\n')
    const problems = pluginEvalCaseProblems(root)
    for (const expected of [/bad: 알 수 없는 키 max_turn/, /bad: max_turns가/, /bad: timeout_seconds가/, /bad: 진입이 배포본 이름공간/, /bad\/graders\/odd\.md: 알 수 없는 채점기 type vibes/, /bad: scaffold_script missing\.sh가 없다/, /vacuous: 한 일을 보는 채점기·사후 검사가 없다/]) {
      assert.ok(problems.some(problem => expected.test(problem)), `놓쳤다: ${expected} — ${JSON.stringify(problems)}`)
    }
    assert.ok(!problems.some(problem => problem.startsWith('good')), `정상 사례를 문제로 잡았다: ${JSON.stringify(problems)}`)
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})

test('시드에 이미 있는 파일을 보는 file-exists는 공허하다고 잡는다', () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'wh-plugin-cases-seed-')))
  try {
    const write = (path, text) => { mkdirSync(join(base, path, '..'), {recursive: true}); writeFileSync(join(base, path), text) }
    write('seeds/s/_workspace/web-harness.md', 'marker\n')
    for (const [name, path] of [['vacuous', '_workspace/web-harness.md'], ['real', '_workspace/01_plan/feature-plan.md']]) {
      write(`plugin/${name}/prompt.md`, '---\ntags: [regression]\nmax_turns: 60\ntimeout_seconds: 900\n---\n/web-harness:wh change 무언가\n')
      write(`plugin/${name}/graders/no-write.md`, '---\ntype: tool_used\ntool: Write\nmin: 0\nmax: 0\n---\n')
      write(`plugin/${name}/checks.json`, JSON.stringify({seed: 's', checks: [{type: 'file-exists', path}]}))
    }
    const problems = pluginEvalCaseProblems(join(base, 'plugin'))
    assert.ok(problems.some(problem => /^vacuous: file-exists _workspace\/web-harness\.md가 시드에 이미 있다/.test(problem)), JSON.stringify(problems))
    assert.ok(!problems.some(problem => problem.startsWith('real')), `시드에 없는 산출물 검사를 문제로 잡았다: ${JSON.stringify(problems)}`)
  } finally {
    rmSync(base, {recursive: true, force: true})
  }
})

test('하네스의 배포본 평가 사례는 형식을 지킨다', () => {
  assert.deepEqual(pluginEvalCaseProblems(fileURLToPath(new URL('../evals/plugin', import.meta.url))), [])
})
