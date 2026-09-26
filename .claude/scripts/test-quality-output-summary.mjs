#!/usr/bin/env node
// test-quality-output-summary.mjs — 테스트·커버리지 출력에서 숫자만 뽑는 파서.
//
// 고정하는 사실:
//   - vitest·jest 단위 요약과 playwright 브라우저 요약의 통과·실패·스킵 수를 읽는다(색 코드가 섞여도)
//   - istanbul·v8 텍스트 표의 `All files` 행에서 네 가지 백분율을 읽는다
//   - 형식을 모르면 null이다 — 추측한 숫자를 쓰지 않는다
import assert from 'node:assert/strict'
import test from 'node:test'
import {spawnSync} from 'node:child_process'
import {cpSync, existsSync, mkdtempSync, readFileSync, rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'
import {parseCoverageSummary, parseFailureLocations, parseTestSummary} from './quality-output-summary-lib.mjs'

test('단위 테스트 요약: vitest·jest, 마지막 요약을 쓴다', () => {
  assert.deepEqual(parseTestSummary(' Test Files  2 passed (2)\n      Tests  5 passed (5)\n   Duration  1s'),
    {runner: 'vitest', passed: 5, failed: 0, skipped: 0, todo: 0, total: 5})
  assert.deepEqual(parseTestSummary('\x1b[31m Test Files  1 failed | 1 passed (2)\x1b[0m\n      Tests  \x1b[31m1 failed\x1b[0m | 3 passed | 1 skipped (5)'),
    {runner: 'vitest', passed: 3, failed: 1, skipped: 1, todo: 0, total: 5})
  assert.equal(parseTestSummary('      Tests  1 failed (1)\n      Tests  2 passed (2)').passed, 2, '첫 요약을 썼다')
  assert.deepEqual(parseTestSummary('Test Suites: 1 failed, 1 passed, 2 total\nTests:       1 failed, 2 skipped, 4 passed, 7 total'),
    {runner: 'jest', passed: 4, failed: 1, skipped: 2, todo: 0, total: 7})
})

test('브라우저 요약: playwright, flaky는 실패로 센다', () => {
  assert.deepEqual(parseTestSummary('Running 6 tests\n  5 passed (3.2s)\n  1 flaky', 'browser'),
    {runner: 'playwright', passed: 5, failed: 1, skipped: 0, todo: 0, total: 6})
})

test('커버리지 표: All files 행의 네 백분율', () => {
  const table = ['----|', 'File       | % Stmts | % Branch | % Funcs | % Lines | Uncovered', 'All files  |   85.71 |       75 |     100 |   85.71 |', ' app.ts    |      10 |       10 |      10 |      10 | 3'].join('\n')
  assert.deepEqual(parseCoverageSummary(table), {statements: 85.71, branches: 75, functions: 100, lines: 85.71})
})

test('테스트를 하나도 찾지 못한 출력은 실행 0개다 — 모름이 아니다', () => {
  assert.equal(parseTestSummary('\nNo test files found, exiting with code 1\n').total, 0)
  assert.equal(parseTestSummary('No tests found, exiting with code 1.\nRun with `--passWithNoTests`').total, 0)
})

test('모르는 형식은 null — 숫자를 지어내지 않는다', () => {
  assert.equal(parseTestSummary('all good'), null)
  assert.equal(parseTestSummary('3 passed', 'unit'), null, '단위 요약이 아닌 줄을 수로 읽었다')
  assert.equal(parseTestSummary('nothing', 'browser'), null)
  assert.equal(parseCoverageSummary('All files | 85 | 75 |'), null, '머리글 없는 표를 읽었다')
  assert.equal(parseCoverageSummary('File | % Stmts | % Branch | % Funcs | % Lines |\nAll files | x | 75 | 100 | 85 |'), null)
})

// 수정 스폰 입력 — 실패 위치만(이름·파일·줄·규칙). 실행된 코드가 정하는 본문·메시지는 싣지 않는다.
test('실패 위치: vitest·jest·playwright 테스트 이름, tsc·eslint 파일:줄·규칙 — 본문·메시지는 없다', () => {
  const vitest = ' FAIL  src/api/auth.test.ts > auth > refreshes once\nAssertionError: expected secret-body to be 1\n'
  assert.deepEqual(parseFailureLocations(vitest), [{kind: 'test', file: 'src/api/auth.test.ts', name: 'auth > refreshes once'}])
  assert.deepEqual(parseFailureLocations('  ● suite › does x\n\n    expect(received).toBe(expected)\n'), [{kind: 'test', name: 'suite › does x'}])
  assert.deepEqual(parseFailureLocations('  1) [chromium] › e2e/a.spec.ts:12:5 › logs in\n'), [{kind: 'test', file: 'e2e/a.spec.ts', line: 12, name: 'logs in'}])
  assert.deepEqual(parseFailureLocations('src/a.ts(12,5): error TS2322: Type secret\nsrc/b.ts:3:1 - error TS2304: Cannot find\n'),
    [{kind: 'type', file: 'src/a.ts', line: 12, rule: 'TS2322'}, {kind: 'type', file: 'src/b.ts', line: 3, rule: 'TS2304'}])
  const eslint = '/work/p/src/c.ts\n  7:3  error  Unexpected any secret-msg  @typescript-eslint/no-explicit-any\n'
  assert.deepEqual(parseFailureLocations(eslint, {projectRoot: '/work/p'}), [{kind: 'lint', file: 'src/c.ts', line: 7, rule: '@typescript-eslint/no-explicit-any'}])
  const all = JSON.stringify([vitest, eslint].map(output => parseFailureLocations(output)))
  assert.doesNotMatch(all, /secret-body|secret-msg|AssertionError/, '본문·메시지가 실렸다')
})

test('실패 위치: 토큰 모양 문자열은 가리고 건수는 상한이 있다', () => {
  assert.deepEqual(parseFailureLocations(' FAIL  src/a.test.ts > uses sk-abcdefghijklmnopqrst\n'), [{kind: 'test', file: 'src/a.test.ts', name: 'uses <redacted>'}])
  const many = Array.from({length: 80}, (_, index) => ` FAIL  src/a.test.ts > case ${index}`).join('\n')
  assert.equal(parseFailureLocations(many).length, 50)
})

const runner = fileURLToPath(new URL('./run-quality-gates.mjs', import.meta.url))
const fixture = fileURLToPath(new URL('../../golden/vite-serverless-hybrid', import.meta.url))
test('실제 러너: --failure-summary는 --check에서만, 통과하지 못한 check의 위치 목록을 evidence/ 밖에 쓴다', () => {
  const root = mkdtempSync(join(tmpdir(), 'wh-failure-summary-'))
  const project = join(root, 'p')
  try {
    cpSync(fixture, project, {recursive: true, filter: source => !source.includes('/node_modules')})
    const env = {...process.env, WEB_HARNESS_ISOLATED_EXECUTION: '1'}
    const withAll = spawnSync(process.execPath, [runner, '--project', project, '--all', '--failure-summary'], {encoding: 'utf8', env})
    assert.equal(withAll.status, 2)
    assert.match(withAll.stderr, /--check only/)
    spawnSync(process.execPath, [runner, '--project', project, '--check', 'typecheck', '--failure-summary'], {encoding: 'utf8', env})
    const summaryPath = join(project, '_workspace/04_qa/failure-summary.json')
    assert.ok(existsSync(summaryPath), '통과하지 못한 check의 위치 목록을 쓰지 않았다')
    const summary = JSON.parse(readFileSync(summaryPath, 'utf8'))
    assert.deepEqual(summary.checks.map(check => check.check), ['typecheck'])
    assert.ok(!existsSync(join(project, '_workspace/04_qa/evidence/failure-summary.json')), '영수증 폴더에 썼다')
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})
