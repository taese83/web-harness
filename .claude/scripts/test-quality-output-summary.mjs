#!/usr/bin/env node
// test-quality-output-summary.mjs — 테스트·커버리지 출력에서 숫자만 뽑는 파서.
//
// 고정하는 사실:
//   - vitest·jest 단위 요약과 playwright 브라우저 요약의 통과·실패·스킵 수를 읽는다(색 코드가 섞여도)
//   - istanbul·v8 텍스트 표의 `All files` 행에서 네 가지 백분율을 읽는다
//   - 형식을 모르면 null이다 — 추측한 숫자를 쓰지 않는다
import assert from 'node:assert/strict'
import test from 'node:test'
import {parseCoverageSummary, parseTestSummary} from './quality-output-summary-lib.mjs'

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
