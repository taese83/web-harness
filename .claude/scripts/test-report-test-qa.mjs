#!/usr/bin/env node
// test-report-test-qa.mjs — 테스트 QA 판정 스크립트(옛 test-executor 에이전트의 일).
//
// 고정하는 사실:
//   - 영수증 판정: 무결성·최신성 오류는 BLOCKED, 명령 실패는 FAIL(상태·종료 코드 오류는 FAIL로만 센다)
//   - 실패 테스트는 FAIL, 실행 테스트 0개는 BLOCKED, 수를 못 읽으면 WARN, 커버리지 lines 70% 미만·미상은 WARN
//   - cut되지 않은 Must 기능을 어떤 테스트도 FEAT·TC ID로 인용하지 않으면 BLOCKED — 스팩 등급과 무관하다
//   - 보고서는 릴리스 게이트가 읽는 형식(## Result, 명령 표)이고 판정 기록과 digest가 같다
//   - 실제 품질 실행기 영수증을 게이트와 같은 검증으로 읽는다(진단용 --check 영수증은 --all 요건으로 BLOCKED)
import assert from 'node:assert/strict'
import test from 'node:test'
import {createHash} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import {mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'
import {citeMustFeatures, classifyReceipt, evaluateTestQa, mustFeatures, renderTestQa} from './report-test-qa.mjs'
import {checkVerdictBinding} from './verdict-record-lib.mjs'

const SCRIPTS = fileURLToPath(new URL('.', import.meta.url))
const PLAN = [
  '| ID | Feature | User Value | Priority | Page Group | Screen | Scope |',
  '|---|---|---|---|---|---|---|',
  '| FEAT-001 | Login | x | Must | PAGE-001 | login | keep |',
  '| FEAT-002 | Legacy | x | Must | PAGE-001 | login | cut |',
  '| FEAT-003 | Nice | x | Should | PAGE-001 | login | keep |',
  '', '### TC-001-1 로그인 성공', '',
].join('\n')

const withProject = (files, run) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wh-test-qa-')))
  try {
    for (const [path, body] of Object.entries(files)) {
      mkdirSync(join(root, path, '..'), {recursive: true})
      writeFileSync(join(root, path), body)
    }
    run(root)
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
}
const receipts = ({test = {}, coverage = {}, testErrors = [], coverageErrors = []} = {}) => ({
  test: {raw: {status: 'PASS', exitCode: 0, command: 'pnpm test', discoveredTestFiles: ['src/a.test.ts'],
    testSummary: {runner: 'vitest', passed: 3, failed: 0, skipped: 0, todo: 0, total: 3}, ...test}, errors: testErrors},
  coverage: {raw: {status: 'PASS', exitCode: 0, command: 'pnpm test:coverage',
    coverageSummary: {statements: 85, branches: 80, functions: 90, lines: 85}, ...coverage}, errors: coverageErrors},
})
const judge = (root, options) => evaluateTestQa(root, {mutationSample: false, receipts: receipts(options)})

test('영수증 판정: 없으면·낡으면 BLOCKED, 명령 실패는 FAIL로만 센다', () => {
  assert.equal(classifyReceipt('test', null, ['Required machine receipt is missing: x']).status, 'BLOCKED')
  assert.equal(classifyReceipt('test', {status: 'PASS', exitCode: 0}, []).status, 'PASS')
  const failed = classifyReceipt('test', {status: 'FAIL', exitCode: 1}, ['t.json: status is FAIL', 't.json: exit code must be 0'])
  assert.equal(failed.status, 'FAIL')
  assert.equal(failed.findings.length, 1, '상태·종료 코드 오류를 무결성 오류로 이중 집계했다')
  assert.equal(classifyReceipt('test', {status: 'PASS', exitCode: 0}, ['t.json: source fingerprint is stale']).status, 'BLOCKED')
  assert.match(classifyReceipt('test', {status: 'BLOCKED', exitCode: null, blockedReason: 'no script'}, []).findings.join(), /environment-scaffolder/)
})

test('Must 기능: cut·비-Must는 빼고, FEAT·TC ID 인용을 경계 있게 찾는다', () => {
  const {features, rows} = mustFeatures([PLAN])
  assert.equal(rows, 3)
  assert.deepEqual([...features.keys()], ['FEAT-001'])
  assert.deepEqual(features.get('FEAT-001'), ['TC-001-1'])
  assert.deepEqual([...mustFeatures(['| ID | Feature | Scope |\n|---|---|---|\n| FEAT-004 | A | keep |\n| FEAT-005 | B | cut |']).features.keys()], ['FEAT-004'],
    '우선순위 열이 없으면 cut되지 않은 기능 전부다')
  const read = file => ({'a.test.ts': '// TC-001-1', 'b.test.ts': '// FEAT-0010', 'c.test.ts': 'FEAT-001 works'})[file]
  assert.deepEqual(citeMustFeatures(features, ['a.test.ts', 'b.test.ts'], read), [{feat: 'FEAT-001', files: ['a.test.ts']}])
  assert.deepEqual(citeMustFeatures(features, ['b.test.ts'], read), [{feat: 'FEAT-001', files: []}], 'FEAT-0010을 FEAT-001로 셌다')
  assert.deepEqual(citeMustFeatures(features, ['c.test.ts'], read)[0].files, ['c.test.ts'])
})

test('판정 경로: PASS·WARN·FAIL·BLOCKED가 영수증과 기획서에서 계산된다', () => withProject({
  '_workspace/01_plan/feature-plan.md': PLAN, 'src/a.test.ts': '// TC-001-1 로그인\n', 'src/b.test.ts': 'export {}\n',
}, root => {
  const pass = judge(root)
  assert.equal(pass.status, 'PASS', pass.findings.join('\n'))
  const report = renderTestQa(pass)
  assert.match(report, /^## Result\nPASS$/m)
  assert.match(report, /^\| test \| `pnpm test` \| 0 \| PASS \|$/m)
  assert.match(report, /^\| coverage \| `pnpm test:coverage` \| 0 \| PASS \|$/m)
  const low = judge(root, {coverage: {coverageSummary: {statements: 50, branches: 50, functions: 50, lines: 50}}})
  assert.equal(low.status, 'WARN')
  assert.match(renderTestQa(low), /^\| coverage \| `pnpm test:coverage` \| 0 \| WARN \|$/m, '게이트는 coverage 행만 WARN을 받는다')
  assert.equal(judge(root, {coverage: {coverageSummary: null}}).status, 'WARN', '커버리지 수를 모르는데 PASS였다')
  assert.equal(judge(root, {test: {testSummary: null}}).status, 'WARN', '실행 수를 모르는데 PASS였다')
  assert.equal(judge(root, {test: {status: 'FAIL', exitCode: 1, testSummary: {passed: 2, failed: 1, skipped: 0, todo: 0, total: 3}},
    testErrors: ['t: status is FAIL', 't: exit code must be 0']}).status, 'FAIL')
  assert.equal(judge(root, {test: {testSummary: {passed: 2, failed: 1, skipped: 0, todo: 0, total: 3}}}).status, 'FAIL',
    '영수증이 PASS여도 실패 수가 있으면 FAIL이다')
  assert.equal(judge(root, {test: {testSummary: {passed: 0, failed: 0, skipped: 0, todo: 0, total: 0}}}).status, 'BLOCKED')
  const uncited = judge(root, {test: {discoveredTestFiles: ['src/b.test.ts']}})
  assert.equal(uncited.status, 'BLOCKED', '인용 없는 Must 기능을 통과시켰다')
  assert.match(uncited.findings.join('\n'), /FEAT-001/)
  assert.equal(judge(root, {testErrors: ['t: source fingerprint is stale']}).status, 'BLOCKED')
}))

test('기획서가 있는데 기능 표를 못 읽으면 BLOCKED — Must 인용 검사가 조용히 꺼지지 않는다', () => withProject({
  '_workspace/01_plan/feature-plan.md': '# 기능\n- FEAT-001 로그인 (Must)\n', 'src/a.test.ts': '// FEAT-001\n',
}, root => {
  const result = judge(root)
  assert.equal(result.status, 'BLOCKED')
  assert.match(result.findings.join('\n'), /기능 표/)
}))


test('실제 실행기 영수증: 게이트와 같은 검증으로 읽고, 보고서·판정 기록을 함께 남긴다', () => withProject({
  'package.json': `${JSON.stringify({name: 'qa-fixture', engines: {node: '>=22.22.0'}, packageManager: 'pnpm@11.18.0',
    scripts: {test: 'node scripts/t.mjs', 'test:coverage': 'node scripts/c.mjs'}})}\n`,
  'pnpm-lock.yaml': "lockfileVersion: '9.0'\n\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\n\nimporters:\n\n  .: {}\n",
  'scripts/t.mjs': "console.log(' Test Files  1 passed (1)')\nconsole.log('      Tests  3 passed (3)')\n",
  'scripts/c.mjs': "console.log('File | % Stmts | % Branch | % Funcs | % Lines |')\nconsole.log('All files | 85 | 80 | 90 | 85 |')\n",
  'src/app.ts': 'export const x = 1\n', 'src/app.test.ts': '// FEAT-001 TC-001-1\n',
  '_workspace/01_plan/feature-plan.md': PLAN,
}, root => {
  for (const check of ['test', 'coverage']) {
    const run = spawnSync(process.execPath, [join(SCRIPTS, 'run-quality-gates.mjs'), '--project', root, '--check', check, '--allow-host-execution'], {encoding: 'utf8'})
    assert.equal(run.status, 0, `${check} 실행기 실패: ${run.stderr}`)
  }
  const cli = spawnSync(process.execPath, [join(SCRIPTS, 'report-test-qa.mjs'), '--project', root, '--skip-mutation-sample'], {encoding: 'utf8'})
  assert.equal(cli.status, 0, cli.stderr)
  const report = readFileSync(join(root, '_workspace/04_qa/qa-test.md'), 'utf8')
  assert.match(report, /^## Result\nBLOCKED$/m, '진단용 --check 영수증을 릴리스 증거로 받았다')
  assert.match(report, /one --all run/, '게이트와 같은 영수증 검증을 쓰지 않는다')
  assert.match(report, /^- passed: 3$/m, '영수증의 실행 수가 보고서에 없다')
  assert.match(report, /lines 85%/, '영수증의 커버리지가 보고서에 없다')
  const records = readFileSync(join(root, '_workspace/04_qa/evidence/verdicts/test.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line))
  assert.equal(records.at(-1).status, 'BLOCKED')
  assert.equal(records.at(-1).digest, createHash('sha256').update(report).digest('hex'))
  assert.deepEqual(checkVerdictBinding(root, 'test', 'BLOCKED').error, undefined)
  assert.match(checkVerdictBinding(root, 'test', 'PASS').error ?? '', /다르다/, '손으로 PASS로 고친 보고서를 게이트가 잡지 못한다')
  assert.equal(checkVerdictBinding(root, 'test', 'BLOCKED', report).error, undefined)
  assert.match(checkVerdictBinding(root, 'test', 'BLOCKED', report.replace('## Findings', '## Findings\n- 없음')).error ?? '', /바뀌었다/,
    '판정 줄을 안 건드린 편집을 게이트가 잡지 못한다')
}))
