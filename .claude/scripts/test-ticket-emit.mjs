// 통합 빌드 2단계 회귀 — 아웃바운드 emit 코어 + 식별자 원장 + lazy-claim 뷰.
//
// 고정하는 사실: (1) buildTicketDraft가 unit→TicketDraft(ticketId:null, AC=TC, 준비도),
// (2) unitContentHash가 내용 안정(순서·중복 무관)·변경 민감, (3) computeEmitPlan 멱등 diff
// (신규→생성·변경→갱신·무변경→건너뜀·사라짐→닫기·재개→생성) + 중복 featureId loud-fail,
// (4) 원장 파싱이 손상/스키마 위반 줄 제외·최신-이김, (5) 분배(assignee) 코어 무관,
// (6) draft에 ticketId 부여하면 NormalizedTicket 검증 통과(교차 모듈 정합 — 리뷰 조건 1),
// (7) claimView가 create=청구가능·나머지=잡힘으로 나눔(lazy-claim).
import assert from 'node:assert/strict'
import test from 'node:test'
import {buildTicketDraft, unitContentHash, computeEmitPlan, formatEmitPreview, claimView} from './ticket/emit.mjs'
import {parseLedger, ledgerState, serializeLedgerRecord} from './ticket/ledger.mjs'
import {validateNormalizedTicket} from './ticket/normalize.mjs'

const unit = (over = {}) => ({featureId: 'FEAT-001', title: '검색', body: '질의를 검색한다', testCaseIds: ['TC-001-1', 'TC-001-2'], type: 'feature', ...over})

test('buildTicketDraft: unit → draft(AC=TC, 준비도, ticketId:null)', () => {
  const d = buildTicketDraft(unit())
  assert.equal(d.ticketId, null) // 사전-발행 draft
  assert.equal(d.sourceKey, 'FEAT-001')
  assert.deepEqual(d.acceptanceCriteria, ['TC-001-1', 'TC-001-2'])
  assert.deepEqual(d.harnessRefs, {featureIds: ['FEAT-001'], testCaseIds: ['TC-001-1', 'TC-001-2']})
  assert.equal(d.specCompleteness.ready, true)
  const bare = buildTicketDraft({featureId: 'FEAT-002', title: 't'})
  assert.deepEqual(bare.specCompleteness.missing, ['behavior', 'testCaseIds'])
})

test('리뷰 조건 1: draft는 그 자체로 NormalizedTicket 검증 실패(ticketId null), 발행 후 통과', () => {
  const d = buildTicketDraft(unit())
  // draft 자체는 검증 불통과 — 의도된 사전-발행 상태 구분
  assert.ok(validateNormalizedTicket(d).includes('ticketId 문자열 필요'))
  // provider가 ticketId 부여 → 완전한 NormalizedTicket → 검증 통과
  const published = {...d, ticketId: '42', provider: 'github'}
  assert.deepEqual(validateNormalizedTicket(published), [])
})

test('unitContentHash: 순서·중복 무관 안정, 변경 민감', () => {
  assert.equal(unitContentHash(unit({testCaseIds: ['TC-001-2', 'TC-001-1', 'TC-001-1']})), unitContentHash(unit()))
  assert.notEqual(unitContentHash(unit()), unitContentHash(unit({title: '다른 제목'})))
})

test('computeEmitPlan: 빈 원장 → 전부 생성', () => {
  const plan = computeEmitPlan([unit(), unit({featureId: 'FEAT-002', testCaseIds: []})])
  assert.equal(plan.create.length, 2)
  assert.equal(plan.create[1].payload.specCompleteness.ready, false)
})

test('computeEmitPlan: 멱등 — 무변경 건너뜀, 변경 갱신, 사라짐 닫기', () => {
  const u = unit()
  const state = new Map([
    ['FEAT-001', {ticketKey: 'PROJ-1', contentHash: unitContentHash(u)}],
    ['FEAT-009', {ticketKey: 'PROJ-9', contentHash: 'old'}],
  ])
  const plan = computeEmitPlan([u, unit({featureId: 'FEAT-002'})], state)
  assert.deepEqual(plan.unchanged.map(x => x.featureId), ['FEAT-001'])
  assert.deepEqual(plan.create.map(x => x.featureId), ['FEAT-002'])
  assert.deepEqual(plan.close.map(x => x.featureId), ['FEAT-009'])
  const plan2 = computeEmitPlan([unit({title: '검색 개선'})], new Map([['FEAT-001', {ticketKey: 'PROJ-1', contentHash: unitContentHash(u)}]]))
  assert.deepEqual(plan2.update.map(x => x.ticketKey), ['PROJ-1'])
})

test('computeEmitPlan: 닫힌 FEAT 재등장 → 재개(생성), 이중 닫기 없음', () => {
  const plan = computeEmitPlan([unit()], new Map([['FEAT-001', {ticketKey: 'PROJ-1', contentHash: 'old', closed: true}]]))
  assert.equal(plan.create[0].reopen, true)
  assert.equal(plan.close.length, 0)
})

test('리뷰 조건 3: 중복 featureId 입력은 loud-fail(멱등성 보호)', () => {
  assert.throws(() => computeEmitPlan([unit(), unit()]), /DUPLICATE_FEATURE_ID: FEAT-001/)
})

test('claimView: create=청구가능, 나머지=잡힘 (lazy-claim)', () => {
  const u = unit()
  const plan = computeEmitPlan([u, unit({featureId: 'FEAT-002'})], new Map([['FEAT-001', {ticketKey: '#7', contentHash: unitContentHash(u)}]]))
  const view = claimView(plan)
  assert.deepEqual(view.claimable.map(x => x.featureId), ['FEAT-002']) // 아직 이슈 없음
  assert.deepEqual(view.taken, [{featureId: 'FEAT-001', ticketKey: '#7'}]) // 이미 이슈 있음
})

test('원장: 파싱이 손상/스키마 위반 줄 제외·최신-이김, 분배 무관', () => {
  const text = [
    JSON.stringify({schemaVersion: 1, featureId: 'FEAT-001', ticketKey: '#1', contentHash: 'h1', createdAt: '2026-08-21T00:00:00Z'}),
    '{broken',
    JSON.stringify({schemaVersion: 2, featureId: 'FEAT-002', ticketKey: 'X', contentHash: 'h', createdAt: 'now'}),
    JSON.stringify({schemaVersion: 1, featureId: 'FEAT-001', ticketKey: '#1', contentHash: 'h2', createdAt: '2026-08-21T01:00:00Z'}),
  ].join('\n')
  const state = ledgerState(parseLedger(text))
  assert.equal(state.size, 1)
  assert.equal(state.get('FEAT-001').contentHash, 'h2')
  const [rec] = parseLedger(serializeLedgerRecord({featureId: 'FEAT-001', ticketKey: '#1', contentHash: 'h', createdAt: '2026-08-21T00:00:00Z'}))
  assert.equal(rec.assignee, undefined) // 분배는 코어 무관
  assert.match(formatEmitPreview(computeEmitPlan([unit()])), /생성 1 · 갱신 0/)
})
