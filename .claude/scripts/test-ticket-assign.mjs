// 통합 빌드 — 청구≠픽업 분리(소유권 판정 + 가용성 보드) 회귀.
//
// 고정하는 사실: (1) computeAssignmentPlan이 미배정/내것/남의것/개발자없음을 판정(남의 것은
// 훔치지 않음), (2) pickupWithOwnership이 소유권 게이트 후에만 change-scope 파생(taken 차단),
// (3) buildAvailabilityBoard가 청구된 것/아직인 것을 한 뷰로(unclaimed/pickupable/mine/
// in-progress)·stale 표시, (4) 실행부 assignArgs 구조 고정.
import assert from 'node:assert/strict'
import test from 'node:test'
import {computeAssignmentPlan, pickupWithOwnership, buildAvailabilityBoard} from './ticket/assign.mjs'
import {buildIssueFields} from './ticket/provider-github.mjs'
import {buildTicketDraft, unitContentHash} from './ticket/emit.mjs'
import {ledgerState} from './ticket/ledger.mjs'
import {assignArgs} from './ticket/provider-github-exec.mjs'

const unit = {featureId: 'FEAT-007', title: '모터 상세', body: '모터 선택 시 상세 표시', testCaseIds: ['TC-007-1', 'TC-007-2'], type: 'feature'}
const issueBody = buildIssueFields(buildTicketDraft(unit)).body

test('computeAssignmentPlan: 미배정/내것/남의것/개발자없음', () => {
  assert.equal(computeAssignmentPlan({issue: {assignees: []}, developer: 'me'}).status, 'assignable')
  assert.equal(computeAssignmentPlan({issue: {assignees: ['me']}, developer: 'me'}).status, 'already-mine')
  const taken = computeAssignmentPlan({issue: {assignees: ['other']}, developer: 'me'})
  assert.equal(taken.status, 'taken')      // 남의 것 — 훔치지 않음
  assert.deepEqual(taken.by, ['other'])
  assert.equal(computeAssignmentPlan({issue: {assignees: []}, developer: ''}).status, 'no-developer')
})

test('pickupWithOwnership: 소유권 게이트 통과 후에만 change-scope', () => {
  // 미배정 이슈를 내가 픽업 → 소유권 확보(self-assign 필요) + change-scope
  const ok = pickupWithOwnership({issue: {number: 3, title: '모터 상세', body: issueBody, assignees: []}, developer: 'me', planUnits: [unit], allowedPathsSeed: ['src/features/motor/']})
  assert.equal(ok.ok, true)
  assert.equal(ok.assignment.action, 'self-assign')
  assert.equal(ok.changeScope.featureId, 'FEAT-007')
  // 남이 배정한 이슈 → 차단(중복 개발 방지), change-scope 미발급
  const taken = pickupWithOwnership({issue: {number: 4, title: 't', body: issueBody, assignees: ['other']}, developer: 'me', planUnits: [unit]})
  assert.equal(taken.ok, false)
  assert.equal(taken.bounce.reason, 'assigned-to-other')
  assert.deepEqual(taken.bounce.by, ['other'])
  assert.equal(taken.changeScope, undefined)
})

test('buildAvailabilityBoard: 이미 청구된 것/아직인 것 한 뷰로 + stale', () => {
  const unit2 = {featureId: 'FEAT-008', title: '주행 기록', body: 'x', testCaseIds: ['TC-008-1'], type: 'feature'}
  const unit3 = {featureId: 'FEAT-009', title: '설정', body: 'y', testCaseIds: ['TC-009-1'], type: 'feature'}
  const ledger = ledgerState([
    {schemaVersion: 1, featureId: 'FEAT-007', ticketKey: '3', contentHash: unitContentHash(unit), createdAt: 't'},
    {schemaVersion: 1, featureId: 'FEAT-008', ticketKey: '4', contentHash: 'old-hash', createdAt: 't'}, // 상류 변경 → stale
  ])
  const issues = new Map([
    ['FEAT-007', {number: 3, assignees: []}],       // 청구됨·미배정 → pickupable
    ['FEAT-008', {number: 4, assignees: ['other']}], // 남이 진행 중
    // FEAT-009는 이슈 없음 → unclaimed
  ])
  const board = buildAvailabilityBoard({units: [unit, unit2, unit3], ledgerState: ledger, issuesByFeature: issues, developer: 'me'})
  const byId = Object.fromEntries(board.map(r => [r.featureId, r]))
  assert.equal(byId['FEAT-007'].status, 'pickupable')
  assert.equal(byId['FEAT-007'].stale, false)
  assert.equal(byId['FEAT-008'].status, 'in-progress')
  assert.deepEqual(byId['FEAT-008'].assignees, ['other'])
  assert.equal(byId['FEAT-008'].stale, true)         // 원장 해시 ≠ 현재 단위 → 낡음
  assert.equal(byId['FEAT-009'].status, 'unclaimed') // 아직 청구 안 됨
})

test('실행부 argv: assignArgs 구조 고정', () => {
  assert.deepEqual(assignArgs('o/r', 3, 'me'), ['issue', 'edit', '3', '--repo', 'o/r', '--add-assignee', 'me'])
})
