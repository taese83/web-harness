// 통합 빌드 4단계 회귀 — claim runner (mock provider + 인메모리 원장, 실 GitHub 무접촉).
//
// 고정하는 사실: (1) 신규 청구는 이슈 생성 + assignee 반영 + 원장 append + 왕복 정본 기록,
// (2) 이미 청구된 FEAT(트래커에 이슈 존재)는 재발행 안 함(멱등, alreadyClaimed),
// (3) 스펙 미완 단위도 청구는 성공하되 specWarning 반환(파서/발행 미게이트 — pickup 몫),
// (4) 잘못된 featureId는 loud-fail, (5) assignee 미지정 시 원장에 assignee 필드 없음(분배 무관).
import assert from 'node:assert/strict'
import test from 'node:test'
import {claimFeature} from './ticket/runner.mjs'

// mock provider: findByLabel이 미리 심은 이슈를 반환, createIssue는 호출 기록 + 가짜 번호.
const mockProvider = (existing = null) => {
  const created = []
  return {
    created,
    findByLabel: async () => existing,
    createIssue: async fields => { created.push(fields); return {number: 101, ...fields} },
  }
}
const mockLedger = () => { const records = []; return {records, append: rec => { records.push(rec) }} }
const unit = (over = {}) => ({featureId: 'FEAT-042', title: '레이스 기록', body: '레이스를 기록한다', testCaseIds: ['TC-008-1'], ...over})

test('신규 청구: 이슈 생성 + assignee + 원장 append', async () => {
  const provider = mockProvider()
  const ledger = mockLedger()
  const result = await claimFeature({unit: unit(), provider, ledger, assignee: 'devX', now: () => '2026-08-21T00:00:00Z'})
  assert.equal(result.claimed, true)
  assert.equal(result.alreadyClaimed, false)
  assert.equal(provider.created.length, 1)
  assert.equal(provider.created[0].assignee, 'devX')
  assert.deepEqual(ledger.records, [{featureId: 'FEAT-042', ticketKey: '101', contentHash: result.record.contentHash, createdAt: '2026-08-21T00:00:00Z', assignee: 'devX'}])
  assert.equal(result.specWarning, null)
})

test('이미 청구된 FEAT: 재발행 안 함(멱등)', async () => {
  const provider = mockProvider({number: 55, title: '기존 이슈'})
  const ledger = mockLedger()
  const result = await claimFeature({unit: unit(), provider, ledger})
  assert.equal(result.claimed, false)
  assert.equal(result.alreadyClaimed, true)
  assert.equal(result.issue.number, 55)
  assert.equal(provider.created.length, 0) // 생성 안 함
  assert.equal(ledger.records.length, 0)   // 원장 불변
})

test('스펙 미완 단위: 청구는 성공하되 specWarning(파서 미게이트 — pickup 몫)', async () => {
  const provider = mockProvider()
  const ledger = mockLedger()
  const result = await claimFeature({unit: {featureId: 'FEAT-007', title: 't'}, provider, ledger})
  assert.equal(result.claimed, true)
  assert.deepEqual(result.specWarning, ['behavior', 'testCaseIds'])
})

test('잘못된 featureId: loud-fail', async () => {
  await assert.rejects(() => claimFeature({unit: {featureId: 'nope'}, provider: mockProvider(), ledger: mockLedger()}), /INVALID_FEATURE_ID/)
})

test('assignee 미지정: 원장에 assignee 필드 없음(분배 무관)', async () => {
  const ledger = mockLedger()
  await claimFeature({unit: unit(), provider: mockProvider(), ledger})
  assert.equal('assignee' in ledger.records[0], false)
})
