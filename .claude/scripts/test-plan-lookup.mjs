#!/usr/bin/env node
// test-plan-lookup.mjs — 기획·설계 산출물에서 ID 행만 꺼낸다(문서를 통째로 읽지 않는다).
import assert from 'node:assert/strict'
import test from 'node:test'
import {spawnSync} from 'node:child_process'
import {mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'

const script = fileURLToPath(new URL('./plan-lookup.mjs', import.meta.url))
const withPlan = fn => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wh-lookup-')))
  try {
    mkdirSync(join(root, '_workspace/01_plan'), {recursive: true})
    mkdirSync(join(root, '_workspace/02_design/api-schema'), {recursive: true})
    writeFileSync(join(root, '_workspace/01_plan/feature-plan.md'),
      '# Feature Plan\n| TC-002-1 | 목록 렌더 |\n| TC-002-10 | 다른 것 |\n## FEAT-002 취소\n본문 1\n본문 2\n본문 3\n')
    writeFileSync(join(root, '_workspace/02_design/api-schema/cancel.md'), '| SD-008 | 대화상자 |\n')
    return fn(root)
  } finally { rmSync(root, {recursive: true, force: true}) }
}
const run = (root, ...args) => spawnSync(process.execPath, [script, '--project', root, ...args], {encoding: 'utf8'})

test('ID는 토큰 단위로 맞춘다 — TC-002-1이 TC-002-10을 끌어오지 않는다', () => {
  withPlan(root => {
    const result = run(root, '--id', 'TC-002-1,SD-008')
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /_workspace\/01_plan\/feature-plan\.md:2: \| TC-002-1 \|/)
    assert.doesNotMatch(result.stdout, /TC-002-10/)
    assert.match(result.stdout, /_workspace\/02_design\/api-schema\/cancel\.md:1: \| SD-008/, '샤드 디렉터리를 보지 않았다')
  })
})

test('제목 행은 --context만큼 뒤 행을 함께 낸다', () => {
  withPlan(root => {
    const result = run(root, '--id', 'FEAT-002', '--context', '2')
    assert.match(result.stdout, /:4: ## FEAT-002 취소\n.*:5: 본문 1\n.*:6: 본문 2\n/)
    assert.doesNotMatch(result.stdout, /본문 3/)
  })
})

test('못 찾은 ID는 exit 1과 목록, 형식이 아니면 exit 2', () => {
  withPlan(root => {
    const missing = run(root, '--id', 'TC-999-1')
    assert.equal(missing.status, 1)
    assert.match(missing.stderr, /TC-999-1/)
    assert.equal(run(root, '--id', 'tc; rm -rf /').status, 2)
  })
})

test('심링크 문서는 따라가지 않는다', () => {
  withPlan(root => {
    writeFileSync(join(root, 'outside.md'), '| TC-777-1 | 밖 |\n')
    symlinkSync(join(root, 'outside.md'), join(root, '_workspace/01_plan/linked.md'))
    assert.equal(run(root, '--id', 'TC-777-1').status, 1)
  })
})
