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
import {mkdtempSync, readFileSync, rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
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

test('computeEmitPlan: 멱등 — 무변경 건너뜀, 변경은 대체 발행, 사라짐 닫기', () => {
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
  // 갱신이 아니라 **대체 발행**이다 — 이미 발행된 티켓의 본문을 고쳐 쓰지 않는다(2026-08-30 결정).
  assert.deepEqual(plan2.supersede.map(x => x.priorTicketKey), ['PROJ-1'])
  assert.equal(plan2.supersede[0].ticketKey, undefined, '새 티켓 번호는 발행 전이라 없다')
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
  assert.match(formatEmitPreview(computeEmitPlan([unit()])), /생성 1 · 대체 0/)
})

// ── 대체 발행(재바인딩) — 2026-08-30 ────────────────────────────────────────
// 계획이 바뀌면 이미 발행된 티켓은 **갱신하지 않고 새로 낸다.** 본문을 고쳐 쓰면 그것을 읽고
// 작업 중인 개발자 밑에서 계약이 조용히 바뀐다. 종전에는 이 경로가 아예 배선되지 않아
// (batch-claim이 update를 alreadyClaimed로 접었다) 계획이 바뀌면 티켓이 영원히 낡은 채였다.
test('batch-claim: 형상이 바뀐 FEAT를 alreadyClaimed로 접지 않는다', async () => {
  const {computeBatchClaimPlan} = await import('./ticket/batch-claim.mjs')
  const unit = {featureId: 'FEAT-001', title: '검색', body: 'v1', testCaseIds: ['TC-001-1'], type: 'feature'}
  const ledgerState = new Map([['FEAT-001', {ticketKey: 'PROJ-1', contentHash: unitContentHash(unit)}]])
  const same = computeBatchClaimPlan({units: [unit], ledgerState, branch: 'feature/x'})
  assert.equal(same.supersede.length, 0)
  assert.deepEqual(same.alreadyClaimed.map(i => i.featureId), ['FEAT-001'])

  const changed = computeBatchClaimPlan({units: [{...unit, body: 'v2'}], ledgerState, branch: 'feature/x'})
  assert.equal(changed.alreadyClaimed.length, 0, '바뀐 것을 이미청구로 접으면 영원히 낡는다')
  assert.deepEqual(changed.supersede.map(i => i.priorTicketKey), ['PROJ-1'])
})

test('원장: 대체 기록은 무엇을 대체하는지 없으면 거부한다', async () => {
  const {appendSupersedeRecord} = await import('./ticket/ledger-writer.mjs')
  const dir = mkdtempSync(join(tmpdir(), 'wh-supersede-'))
  try {
    const path = join(dir, 'ledger.jsonl')
    assert.throws(() => appendSupersedeRecord(path, {featureId: 'FEAT-001', ticketKey: '2', contentHash: 'h', createdAt: 't'}),
      /LEDGER_SUPERSEDE_WITHOUT_PRIOR/, '근거 없는 재바인드는 여전히 막는다')
    assert.throws(() => appendSupersedeRecord(path, {featureId: 'FEAT-001', ticketKey: '2', contentHash: 'h', createdAt: 't', supersedes: '2'}),
      /LEDGER_SUPERSEDE_SELF/)
    appendSupersedeRecord(path, {featureId: 'FEAT-001', ticketKey: '2', contentHash: 'h', createdAt: 't', supersedes: '1'})
    const rows = readFileSync(path, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
    assert.equal(rows.at(-1).supersedes, '1', '무엇을 무엇이 대체했는지 히스토리에 남아야 한다')
  } finally { rmSync(dir, {recursive: true, force: true}) }
})
