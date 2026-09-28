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

test('기본은 정의 행만 — 여러 곳에 언급돼도 표 행·제목 하나를 낸다, --all은 모든 언급', () => {
  withPlan(root => {
    writeFileSync(join(root, '_workspace/01_plan/trace.md'), '추적: TC-002-1은 REQ-001을 덮는다\n| REQ-001 | TC-002-1 |\n')
    const defined = run(root, '--id', 'TC-002-1')
    assert.equal(defined.stdout.trim().split('\n').length, 2, defined.stdout)
    assert.match(defined.stdout, /feature-plan\.md:2: \| TC-002-1 \|/)
    assert.match(defined.stdout, /언급 3곳 — 전부 보려면 --all/)
    const all = run(root, '--id', 'TC-002-1', '--all')
    assert.match(all.stdout, /trace\.md:1:/)
    assert.match(all.stdout, /trace\.md:2:/)
  })
})

test('출력은 16KB 상한이고 넘으면 멈춘다고 말한다', () => {
  withPlan(root => {
    const ids = Array.from({length: 120}, (_, index) => `TC-900-${index + 1}`)
    writeFileSync(join(root, '_workspace/01_plan/bulk.md'), ids.map(id => `| ${id} | ${'가'.repeat(80)} |`).join('\n'))
    const result = run(root, '--id', ids.join(','))
    assert.ok(Buffer.byteLength(result.stdout) <= 16 * 1024 + 200, `${Buffer.byteLength(result.stdout)}B`)
    assert.match(result.stdout, /출력 상한/)
  })
})

test('목록 항목으로 정의된 ID(REQ)는 그 항목이 정의 행이다 — 다른 파일의 언급이 대신 나오지 않는다', () => {
  withPlan(root => {
    writeFileSync(join(root, '_workspace/01_plan/decision-log.md'), '## PC-001 연장\n- 대상: REQ-F-001\n')
    writeFileSync(join(root, '_workspace/01_plan/requirements.md'), '# 요구사항\n- [ ] REQ-F-001 사용자는 예약을 연장할 수 있다\n')
    const result = run(root, '--id', 'REQ-F-001')
    assert.match(result.stdout, /requirements\.md:2: - \[ \] REQ-F-001/)
    assert.doesNotMatch(result.stdout, /decision-log\.md:2/)
  })
})
