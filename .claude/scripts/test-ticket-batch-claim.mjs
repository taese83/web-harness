// 통합 빌드 — 일괄 청구 planner 회귀(기획자 진입점).
// 고정: (1) create 집합을 청구 순서로(foundation 먼저·의존 위상), (2) 원장 기청구분은
// alreadyClaimed로 분리(재발행 안 함), (3) 경로 충돌·순환을 발행 전 경고로 노출.
import assert from 'node:assert/strict'
import test from 'node:test'
import {computeBatchClaimPlan, formatBatchClaimPreview} from './ticket/batch-claim.mjs'
import {ledgerState} from './ticket/ledger.mjs'
import {unitContentHash} from './ticket/emit.mjs'

const roots = {foundationRoots: ['src/shared/']}
const units = [
  {featureId: 'FEAT-002', title: '설정', body: 'y', testCaseIds: ['TC-002-1'], type: 'feature', paths: ['src/features/settings/'], dependsOn: ['FEAT-001']},
  {featureId: 'FEAT-000', title: '공유 인프라', body: 'z', testCaseIds: ['TC-000-1'], type: 'feature', paths: ['src/shared/api/'], layer: 'foundation'},
  {featureId: 'FEAT-001', title: '모터 상세', body: 'x', testCaseIds: ['TC-001-1'], type: 'feature', paths: ['src/features/motor/']},
]

test('computeBatchClaimPlan: create를 청구 순서로(foundation 먼저·의존 위상)', () => {
  const plan = computeBatchClaimPlan({units, ledgerState: ledgerState([]), opts: roots, branch: 'feature/dash'})
  assert.equal(plan.branch, 'feature/dash')
  const ids = plan.claim.map(c => c.featureId)
  assert.equal(ids[0], 'FEAT-000')                       // foundation 먼저
  assert.ok(ids.indexOf('FEAT-001') < ids.indexOf('FEAT-002')) // 의존 선행
  assert.equal(plan.claim.find(c => c.featureId === 'FEAT-000').layer, 'foundation')
})

test('computeBatchClaimPlan: 원장 기청구분은 alreadyClaimed로 분리', () => {
  const ledger = ledgerState([{schemaVersion: 1, featureId: 'FEAT-001', ticketKey: '5', contentHash: unitContentHash(units[2]), createdAt: 't'}])
  const plan = computeBatchClaimPlan({units, ledgerState: ledger, opts: roots})
  assert.ok(!plan.claim.some(c => c.featureId === 'FEAT-001'))         // 재발행 안 함
  assert.ok(plan.alreadyClaimed.some(a => a.featureId === 'FEAT-001')) // 기청구로 분리
})

test('computeBatchClaimPlan: 경로 충돌·순환 발행 전 경고', () => {
  const colliding = [
    {featureId: 'FEAT-010', title: 'a', testCaseIds: ['TC-010-1'], paths: ['src/features/x/']},
    {featureId: 'FEAT-011', title: 'b', testCaseIds: ['TC-011-1'], paths: ['src/features/x/detail/']},
  ]
  const plan = computeBatchClaimPlan({units: colliding, ledgerState: ledgerState([]), opts: roots})
  assert.deepEqual(plan.collisions, [{a: 'FEAT-010', b: 'FEAT-011'}])
  assert.match(formatBatchClaimPreview(plan), /경로 충돌/)
})
