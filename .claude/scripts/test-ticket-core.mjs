#!/usr/bin/env node
// test-ticket-core.mjs — WORK 경로가 쓰는 공용 판정의 회귀.
//
// FEAT 개발 티켓 경로를 지우며(2026-09-14) 그 경로의 테스트 파일들도 지웠다. 그 안에 섞여 있던,
// **지금도 WORK가 쓰는** 판정의 회귀만 여기로 옮겼다 — 지운 파일과 함께 결박이 사라지지 않게.
//   unitContentHash   FEAT 명세 지문(WORK 계획의 featureBindings.sourceDigest)
//   computeAssignmentPlan  픽업의 소유 판정(남의 것은 훔치지 않는다)
//   deferredTestCases 계획의 유예 마커(분석의 유예와 대조) — 산문 표현을 유예로 읽지 않는다
import assert from 'node:assert/strict'
import test from 'node:test'
import {unitContentHash} from './ticket/emit.mjs'
import {computeAssignmentPlan} from './ticket/assign.mjs'
import {deferredTestCases} from './ticket/completion.mjs'
import {assignArgs} from './ticket/provider-github-exec.mjs'

const unit = (over = {}) => ({featureId: 'FEAT-001', title: '검색', body: '질의를 검색한다', testCaseIds: ['TC-001-1', 'TC-001-2'], type: 'feature', ...over})

test('unitContentHash: 순서·중복 무관 안정, 변경 민감', () => {
  assert.equal(unitContentHash(unit({testCaseIds: ['TC-001-2', 'TC-001-1', 'TC-001-1']})), unitContentHash(unit()))
  assert.notEqual(unitContentHash(unit()), unitContentHash(unit({title: '다른 제목'})))
})

test('computeAssignmentPlan: 미배정/내것/남의것/개발자없음', () => {
  assert.equal(computeAssignmentPlan({issue: {assignees: []}, developer: 'me'}).status, 'assignable')
  assert.equal(computeAssignmentPlan({issue: {assignees: ['me']}, developer: 'me'}).status, 'already-mine')
  const taken = computeAssignmentPlan({issue: {assignees: ['other']}, developer: 'me'})
  assert.equal(taken.status, 'taken') // 남의 것 — 훔치지 않는다
  assert.deepEqual(taken.by, ['other'])
  assert.equal(computeAssignmentPlan({issue: {assignees: []}, developer: ''}).status, 'no-developer')
})

test('실행부 argv: assignArgs 구조 고정', () => {
  assert.deepEqual(assignArgs('o/r', 3, 'me'), ['issue', 'edit', '3', '--repo', 'o/r', '--add-assignee', 'me'])
})

test('유예 마커는 그 TC와 같은 줄에 있어야 한다 — 문서 어딘가에 있는 것으로는 안 된다', () => {
  const loose = ['- TC-004-1: 폐곡선을 검증한다.', '', '[유예: 뒤에 몰아서 적음]'].join('\n')
  assert.equal(deferredTestCases(loose).has('TC-004-1'), false)
  const tight = '- TC-004-1: 폐곡선을 검증한다. [유예: fixture 확보 전까지]'
  assert.equal(deferredTestCases(tight).has('TC-004-1'), true)
})

// 산문 표현으로 유예를 판정하던 판이 **내용어와 충돌**했다(2026-08-30 리뷰 MEDIUM).
test('내용어를 유예로 읽지 않는다 — 정상 TC가 조용히 통과하면 안 된다', () => {
  const prose = [
    '- TC-004-1: 손상 입력이면 **실행 불가** 안내를 띄운다.',
    '- TC-004-2: 폐곡선이 아니면 검증 불가 배지를 노출한다.',
    '- TC-004-3: 네트워크가 확보되기 전까지 재시도한다.',
  ].join('\n')
  assert.equal(deferredTestCases(prose).size, 0)
})

test('사유 없는 유예 마커는 유예가 아니다', () => {
  assert.equal(deferredTestCases('- TC-004-1: 폐곡선. [유예]').size, 0)
  assert.equal(deferredTestCases('- TC-004-1: 폐곡선. [유예: ]').size, 0)
})
