import assert from 'node:assert/strict'
import {mkdtempSync, mkdirSync, readFileSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test from 'node:test'
import {listImplementationVerifications, recordImplementationVerification, summarizeImplementationVerification} from '../src/change-request-implementation.mjs'

const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'web-harness-impl-verify-'))
  mkdirSync(join(root, '_workspace', '01_plan'), {recursive: true})
  const approvedRequest = {
    id: 'CHG-20260811-001',
    latestReviewDecision: {
      decision: 'APPROVED',
      featureLinks: {affectedFeatureIds: ['FEAT-202'], affectedTestCaseIds: ['TC-202-1', 'TC-202-2', 'TC-202-3', 'TC-202-4']},
    },
  }
  return {root, approvedRequest}
}

test('implementation verification enforces approval and the approved TC scope (원칙 4)', t => {
  const {root, approvedRequest} = fixture()
  t.after(() => rmSync(root, {recursive: true, force: true}))
  const base = {evidence: 'vitest run 2/2 passed, 2026-08-11'}

  // 미승인 CR 거부
  assert.throws(() => recordImplementationVerification(root, {id: 'CHG-20260811-002', latestReviewDecision: null},
    {...base, testCaseIds: ['TC-202-1']}, {idempotencyKey: '019fcf35-48fe-7d93-bb95-3304a2732980'}),
  error => error.code === 'IMPLEMENTATION_NOT_APPROVED')
  // 승인 범위 밖 TC 거부 — 같은 TC ID 강제
  assert.throws(() => recordImplementationVerification(root, approvedRequest,
    {...base, testCaseIds: ['TC-202-1', 'TC-999-1']}, {idempotencyKey: '019fcf35-48fe-7d93-bb95-3304a2732981'}),
  error => error.code === 'IMPLEMENTATION_SCOPE_MISMATCH')
  // 증거 없는 기록 거부
  assert.throws(() => recordImplementationVerification(root, approvedRequest,
    {testCaseIds: ['TC-202-1'], evidence: ''}, {idempotencyKey: '019fcf35-48fe-7d93-bb95-3304a2732982'}),
  error => error.code === 'INVALID_IMPLEMENTATION_VERIFICATION')

  // 부분 기록 → 커버리지 파생
  const first = recordImplementationVerification(root, approvedRequest,
    {...base, testCaseIds: ['TC-202-1', 'TC-202-2']}, {idempotencyKey: '019fcf35-48fe-7d93-bb95-3304a2732983'})
  assert.equal(first.created, true)
  let summary = summarizeImplementationVerification(root, approvedRequest)
  assert.equal(summary.complete, false)
  assert.deepEqual(summary.missingTestCaseIds, ['TC-202-3', 'TC-202-4'])

  // idempotent 재전송
  const replay = recordImplementationVerification(root, approvedRequest,
    {...base, testCaseIds: ['TC-202-1', 'TC-202-2']}, {idempotencyKey: '019fcf35-48fe-7d93-bb95-3304a2732983'})
  assert.equal(replay.created, false)

  // 잔여 기록 → 완전 검증
  recordImplementationVerification(root, approvedRequest,
    {testCaseIds: ['TC-202-3', 'TC-202-4'], evidence: 'vitest run 4/4 passed, 2026-08-11', command: 'pnpm test'},
    {idempotencyKey: '019fcf35-48fe-7d93-bb95-3304a2732984'})
  summary = summarizeImplementationVerification(root, approvedRequest)
  assert.equal(summary.complete, true)
  assert.equal(summary.events.length, 2)
  assert.equal(listImplementationVerifications(root, approvedRequest.id).length, 2)
  const raw = readFileSync(join(root, '_workspace', '03_dev', 'change-request-implementation', 'CHG-20260811-001.jsonl'), 'utf8')
  assert.equal(raw.trim().split('\n').length, 2)

  // 미승인 CR의 요약은 null (파생 표시 없음)
  assert.equal(summarizeImplementationVerification(root, {id: 'CHG-20260811-003', latestReviewDecision: null}), null)
})
