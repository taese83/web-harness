#!/usr/bin/env node
// test-ticket-completion.mjs — 티켓 완료 조건 판정의 회귀.
//
// PR을 티켓에 연결하는 것은 **완료를 주장하는 것**이다. 그런데 그 자리에서 "이 FEAT의
// 수용 기준이 실제로 검증됐는가"를 묻는 것이 없었다 — 지켜진 것은 개발자가 잘한 것이지
// 게이트가 지킨 것이 아니었다(2026-08-30 실측: track의 머지된 6개 FEAT는 TC 100%
// 인용이었으나 그것을 확인한 기계는 하나도 없었다).
import assert from 'node:assert/strict'
import test from 'node:test'
import {deferredTestCases, evaluateTicketCompletion, formatCompletion, testCaseIdsOf} from './ticket/completion.mjs'

const PLAN = [
  '### FEAT-002 — 파싱',
  '- TC-002-1: 정상 문법이면 132개 피스가 나온다.',
  '- TC-002-2: 손상 문자열이면 **실행 불가** 안내를 띄운다.',
  '- TC-002-5: compat=true fixture가 필요하다. [유예: 별도 fixture 확보 전까지 skip]',
  '### FEAT-003 — 순서 복원',
  '- TC-003-1: 끝점 매칭으로 순서를 복원한다.',
].join('\n')

test('자기 번호의 TC만 모은다 — 남의 것을 끌어오지 않는다', () => {
  assert.deepEqual(testCaseIdsOf('FEAT-002', PLAN), ['TC-002-1', 'TC-002-2', 'TC-002-5'])
  assert.deepEqual(testCaseIdsOf('FEAT-003', PLAN), ['TC-003-1'])
})

test('전부 인용되면 통과한다', () => {
  const result = evaluateTicketCompletion({
    featureId: 'FEAT-003', planText: PLAN, citedIds: ['TC-003-1'],
  })
  assert.equal(result.ok, true)
  assert.equal(result.cited.length, 1)
})

test('인용되지 않은 TC가 있으면 완료를 막는다 — 무엇이 빠졌는지 이름을 댄다', () => {
  const result = evaluateTicketCompletion({
    featureId: 'FEAT-002', planText: PLAN, citedIds: ['TC-002-1'],
  })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'uncited-test-cases')
  assert.deepEqual(result.missing, ['TC-002-2'])
})

// 유예는 **계획 문서**가 하는 것이지 개발자가 PR에서 선언하는 것이 아니다 — 그러면
// 완료 조건을 스스로 낮추는 경로가 된다.
test('계획이 유예한 TC는 미인용이어도 막지 않는다', () => {
  const result = evaluateTicketCompletion({
    featureId: 'FEAT-002', planText: PLAN, citedIds: ['TC-002-1', 'TC-002-2'],
  })
  assert.equal(result.ok, true)
  assert.deepEqual(result.deferred, ['TC-002-5'])
  assert.match(formatCompletion(result), /유예 1건/, '유예는 통과와 구분해 보고한다')
})

test('유예 마커는 그 TC와 같은 줄에 있어야 한다 — 문서 어딘가에 있는 것으로는 안 된다', () => {
  const loose = ['- TC-004-1: 폐곡선을 검증한다.', '', '[유예: 뒤에 몰아서 적음]'].join('\n')
  assert.equal(deferredTestCases(loose).has('TC-004-1'), false)
  const tight = '- TC-004-1: 폐곡선을 검증한다. [유예: fixture 확보 전까지]'
  assert.equal(deferredTestCases(tight).has('TC-004-1'), true)
})

// 산문 표현으로 유예를 판정하던 판이 **내용어와 충돌**했다(2026-08-30 리뷰 MEDIUM):
// `실행 불가 안내를 띄운다`는 정상 수용 기준인데 유예로 분류돼 미인용인 채 통과했다.
test('내용어를 유예로 읽지 않는다 — 정상 TC가 조용히 통과하면 안 된다', () => {
  const prose = [
    '- TC-004-1: 손상 입력이면 **실행 불가** 안내를 띄운다.',
    '- TC-004-2: 폐곡선이 아니면 검증 불가 배지를 노출한다.',
    '- TC-004-3: 네트워크가 확보되기 전까지 재시도한다.',
  ].join('\n')
  assert.equal(deferredTestCases(prose).size, 0)
})

// 사유 없는 토큰은 그냥 무료 통과권이다.
test('사유 없는 유예 마커는 유예가 아니다', () => {
  assert.equal(deferredTestCases('- TC-004-1: 폐곡선. [유예]').size, 0)
  assert.equal(deferredTestCases('- TC-004-1: 폐곡선. [유예: ]').size, 0)
})

// 단위(units.json)는 testCaseIds를 구조 필드로 갖는다 — 산문 파싱보다 그것이 정확하다.
test('구조 필드 testCaseIds가 있으면 그것을 쓴다', () => {
  const result = evaluateTicketCompletion({
    featureId: 'FEAT-001', planText: '본문에 TC 표기가 없다', testCaseIds: ['TC-001-1', 'TC-001-2'],
    citedIds: ['TC-001-1'],
  })
  assert.equal(result.total, 2)
  assert.deepEqual(result.missing, ['TC-001-2'])
})

// TC가 없는 FEAT를 통과시키면 "완료 조건 없음"이 곧 "완료"가 된다.
test('TC가 하나도 없으면 통과가 아니라 판정 불가다', () => {
  const result = evaluateTicketCompletion({featureId: 'FEAT-099', planText: PLAN, citedIds: []})
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'no-test-cases')
  assert.match(formatCompletion(result), /근거가 없다/)
})

test('보고가 인용·유예·미인용을 각각 센다 — 셋을 뭉치지 않는다', () => {
  const result = evaluateTicketCompletion({featureId: 'FEAT-002', planText: PLAN, citedIds: ['TC-002-1']})
  const line = formatCompletion(result)
  assert.match(line, /TC 1\/3 인용/)
  assert.match(line, /유예 1건/)
  assert.match(line, /미인용 1건/)
})
