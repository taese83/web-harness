#!/usr/bin/env node
// test-dependency-pins.mjs — validate-dependency-pins.mjs 순수 코어 회귀 테스트.
// seminar-booking 실증에서 새어든 두 결함 클래스를 픽스처로 고정한다.
import assert from 'node:assert/strict'
import test from 'node:test'
import {analyzePins, satisfies, compareVersion, parseVersion} from './validate-dependency-pins.mjs'

test('satisfies: >=A <B (typescript-eslint peer 형태)', () => {
  assert.equal(satisfies('5.9.3', '>=4.8.4 <6.0.0'), 'yes')
  assert.equal(satisfies('7.0.2', '>=4.8.4 <6.0.0'), 'no')   // 실제 결함: TS7이 범위 밖
  assert.equal(satisfies('4.8.3', '>=4.8.4 <6.0.0'), 'no')
})

test('satisfies: caret/tilde/exact', () => {
  assert.equal(satisfies('19.2.8', '^19.0.0'), 'yes')
  assert.equal(satisfies('20.0.0', '^19.0.0'), 'no')
  assert.equal(satisfies('5.9.3', '~5.9.0'), 'yes')
  assert.equal(satisfies('5.10.0', '~5.9.0'), 'no')
  assert.equal(satisfies('7.0.2', '7.0.2'), 'yes')
})

test('satisfies: tilde 부분 자릿수별 상한 (npm 시맨틱)', () => {
  // ~5 (마이너 미지정) = >=5.0.0 <6.0.0 (= ^5)
  assert.equal(satisfies('5.9.9', '~5'), 'yes')
  assert.equal(satisfies('6.0.0', '~5'), 'no')
  // ~5.9 (마이너 지정) = >=5.9.0 <5.10.0
  assert.equal(satisfies('5.9.9', '~5.9'), 'yes')
  assert.equal(satisfies('5.10.0', '~5.9'), 'no')
})

test('satisfies: OR(||) 과 any(*)', () => {
  assert.equal(satisfies('18.0.0', '^18.0.0 || ^19.0.0'), 'yes')
  assert.equal(satisfies('19.5.0', '^18.0.0 || ^19.0.0'), 'yes')
  assert.equal(satisfies('17.0.0', '^18.0.0 || ^19.0.0'), 'no')
  assert.equal(satisfies('1.2.3', '*'), 'yes')
})

test('satisfies: 파싱 불가 범위는 unknown(false-fail 금지)', () => {
  assert.equal(satisfies('1.2.3', '>=1.0.0-beta.custom+meta weirdrange'), 'unknown')
})

test('compareVersion/parseVersion 기본', () => {
  assert.deepEqual(parseVersion('v7.0.2'), [7, 0, 2])
  assert.equal(compareVersion([5, 9, 3], [7, 0, 2]), -1)
})

test('analyzePins: 존재하지 않는 버전 → NONEXISTENT (TS 6.0.0 실측)', () => {
  const pinned = {typescript: '6.0.0'}
  const meta = {typescript: {exists: false, availableLatest: '7.0.2'}}
  const {violations} = analyzePins(pinned, meta)
  assert.equal(violations.length, 1)
  assert.equal(violations[0].kind, 'NONEXISTENT')
  assert.equal(violations[0].name, 'typescript')
})

test('analyzePins: peer 비호환 → PEER_INCOMPAT (typescript-eslint↔TS7 실측)', () => {
  const pinned = {typescript: '7.0.2', 'typescript-eslint': '8.57.0'}
  const meta = {
    typescript: {exists: true, peerDependencies: {}},
    'typescript-eslint': {exists: true, peerDependencies: {typescript: '>=4.8.4 <6.0.0'}},
  }
  const {violations} = analyzePins(pinned, meta)
  assert.equal(violations.length, 1)
  assert.equal(violations[0].kind, 'PEER_INCOMPAT')
  assert.match(violations[0].detail, /typescript-eslint@8\.57\.0.*peer typescript.*위반/)
})

test('analyzePins: 호환 집합 → 위반 0 (TS 5.9.3 해소본)', () => {
  const pinned = {typescript: '5.9.3', 'typescript-eslint': '8.57.0'}
  const meta = {
    typescript: {exists: true, peerDependencies: {}},
    'typescript-eslint': {exists: true, peerDependencies: {typescript: '>=4.8.4 <6.0.0'}},
  }
  const {violations} = analyzePins(pinned, meta)
  assert.equal(violations.length, 0)
})

test('analyzePins: pin 집합 밖 peer는 검사 안 함(install이 해결)', () => {
  const pinned = {'typescript-eslint': '8.57.0'} // typescript는 pin 안 함
  const meta = {'typescript-eslint': {exists: true, peerDependencies: {typescript: '>=4.8.4 <6.0.0'}}}
  const {violations, skipped} = analyzePins(pinned, meta)
  assert.equal(violations.length, 0)
  assert.equal(skipped.length, 0)
})

test('analyzePins: 파싱 불가 peer 범위는 skip(false-fail 금지)', () => {
  const pinned = {a: '1.0.0', b: '2.0.0'}
  const meta = {
    a: {exists: true, peerDependencies: {b: 'weird-nonsemver-range'}},
    b: {exists: true, peerDependencies: {}},
  }
  const {violations, skipped} = analyzePins(pinned, meta)
  assert.equal(violations.length, 0)
  assert.ok(skipped.some(s => /파싱 불가/.test(s.reason)))
})
