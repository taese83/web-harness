// 통합 빌드 — 청구 범위 planner(FSD 슬라이스 번들) 회귀.
// 고정: (1) classifyLayer 명시/경로/기본, (2) pathsOverlap 경계 안전, (3) findPathCollisions
// feature 간 경로 충돌, (4) computeClaimOrder foundation 선행+의존 위상+순환 보고,
// (5) claimScopeReadiness foundation/deps/collision 게이트.
import assert from 'node:assert/strict'
import test from 'node:test'
import {classifyLayer, pathsOverlap, findPathCollisions, computeClaimOrder, claimScopeReadiness, annotateBoardScope} from './ticket/claim-scope.mjs'
import {buildAvailabilityBoard} from './ticket/assign.mjs'
import {ledgerState} from './ticket/ledger.mjs'

const roots = {foundationRoots: ['src/shared/', 'src/app/']}

test('classifyLayer: 명시 우선, 경로 폴백, 기본 feature', () => {
  assert.equal(classifyLayer({layer: 'foundation'}), 'foundation')
  assert.equal(classifyLayer({paths: ['src/shared/api/']}, roots), 'foundation')
  assert.equal(classifyLayer({paths: ['src/features/motor/']}, roots), 'feature')
  assert.equal(classifyLayer({}, roots), 'feature') // 정보 없음 → 병렬 기본
})

test('pathsOverlap: 경계 안전(src/feature ≠ src/features)', () => {
  assert.equal(pathsOverlap(['src/features/a/'], ['src/features/a/model/']), true) // 조상-자손
  assert.equal(pathsOverlap(['src/features/a/'], ['src/features/b/']), false)
  assert.equal(pathsOverlap(['src/feature/'], ['src/features/']), false) // 경계 오탐 아님
  assert.equal(pathsOverlap(['src/x.ts'], ['src/x.ts']), true) // 동일 파일
})

test('findPathCollisions: feature 간 경로 충돌만', () => {
  const units = [
    {featureId: 'FEAT-001', paths: ['src/features/motor/']},
    {featureId: 'FEAT-002', paths: ['src/features/motor/detail/']}, // FEAT-001과 겹침
    {featureId: 'FEAT-003', paths: ['src/features/log/']},          // 독립
    {featureId: 'FEAT-000', layer: 'foundation', paths: ['src/shared/']}, // foundation 제외
  ]
  const cols = findPathCollisions(units, roots)
  assert.deepEqual(cols, [{a: 'FEAT-001', b: 'FEAT-002'}])
})

test('computeClaimOrder: foundation 선행 + 의존 위상 + 순환 보고', () => {
  const units = [
    {featureId: 'FEAT-000', layer: 'foundation'},
    {featureId: 'FEAT-002', dependsOn: ['FEAT-001']},
    {featureId: 'FEAT-001'},
  ]
  const order = computeClaimOrder(units, roots)
  assert.deepEqual(order.foundation, ['FEAT-000'])
  assert.equal(order.order[0], 'FEAT-000')          // foundation 먼저
  assert.ok(order.features.indexOf('FEAT-001') < order.features.indexOf('FEAT-002')) // 의존 선행
  // 순환 감지
  const cyc = computeClaimOrder([{featureId: 'A', dependsOn: ['B']}, {featureId: 'B', dependsOn: ['A']}], roots)
  assert.ok(cyc.cycles.length > 0)
})

test('claimScopeReadiness: foundation/deps/collision 게이트', () => {
  const opts = roots
  // foundation은 항상 pickupable
  assert.equal(claimScopeReadiness({unit: {featureId: 'F', layer: 'foundation'}, opts}).pickupable, true)
  // foundation 미완 → feature 차단
  assert.equal(claimScopeReadiness({unit: {featureId: 'A'}, foundationComplete: false, opts}).blockedReason, 'foundation-incomplete')
  // 의존 미머지 → 차단
  assert.equal(claimScopeReadiness({unit: {featureId: 'B', dependsOn: ['A']}, foundationComplete: true, mergedFeatureIds: [], opts}).blockedReason, 'deps-incomplete')
  // 충돌 → 차단
  assert.equal(claimScopeReadiness({unit: {featureId: 'C'}, foundationComplete: true, collisions: [{a: 'C', b: 'D'}], opts}).blockedReason, 'path-collision')
  // 전부 OK → pickupable
  assert.equal(claimScopeReadiness({unit: {featureId: 'E', dependsOn: ['A']}, foundationComplete: true, mergedFeatureIds: ['A'], opts}).pickupable, true)
})

test('annotateBoardScope: foundation 미완이면 feature를 blocked로 강등', () => {
  const units = [
    {featureId: 'FEAT-000', layer: 'foundation'},
    {featureId: 'FEAT-001', paths: ['src/features/motor/'], dependsOn: []},
  ]
  // FEAT-001은 청구됨·미배정(pickupable)이지만 foundation 미완 → blocked
  const board = buildAvailabilityBoard({
    units,
    ledgerState: ledgerState([]),
    issuesByFeature: new Map([['FEAT-001', {number: 5, assignees: []}]]),
    developer: 'me',
  })
  const annotated = annotateBoardScope(board, units, {foundationComplete: false, opts: roots})
  const byId = Object.fromEntries(annotated.map(r => [r.featureId, r]))
  assert.equal(byId['FEAT-001'].status, 'blocked')
  assert.equal(byId['FEAT-001'].blockedReason, 'foundation-incomplete')
  assert.equal(byId['FEAT-001'].layer, 'feature')
  assert.equal(byId['FEAT-000'].layer, 'foundation')
  // foundation 완료면 pickupable 복원
  const done = annotateBoardScope(board, units, {foundationComplete: true, opts: roots})
  assert.equal(Object.fromEntries(done.map(r => [r.featureId, r]))['FEAT-001'].status, 'pickupable')
})
