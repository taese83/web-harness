// 통합 빌드 — 청구 범위 planner(FSD 슬라이스 번들) 회귀.
// 고정: (1) classifyLayer 명시/경로/기본, (2) pathsOverlap 경계 안전, (3) findPathCollisions
// feature 간 경로 충돌, (4) computeClaimOrder foundation 선행+의존 위상+순환 보고,
// (5) claimScopeReadiness foundation/deps/collision 게이트.
import assert from 'node:assert/strict'
import test from 'node:test'
import {classifyLayer, pathsOverlap, findPathCollisions, computeClaimOrder, claimScopeReadiness, annotateBoardScope, uncheckedForCollision} from './ticket/claim-scope.mjs'
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
  // 충돌 → 차단 (dependsOn을 명시적으로 선언해야 충돌 판정까지 내려온다)
  assert.equal(claimScopeReadiness({unit: {featureId: 'C', dependsOn: []}, foundationComplete: true, collisions: [{a: 'C', b: 'D'}], opts}).blockedReason, 'path-collision')
  // 전부 OK → pickupable
  assert.equal(claimScopeReadiness({unit: {featureId: 'E', dependsOn: ['A']}, foundationComplete: true, mergedFeatureIds: ['A'], opts}).pickupable, true)
})

// 2026-08-30 실측: track 11건이 전부 pickupable로 보였는데 실제로는 4건이었다. 의존 순서가
// data-model.md의 **산문**에만 있고 기계가 읽을 선언이 없었기 때문이다. 종전 구현은
// `dependsOn ?? []`라 미선언을 곧바로 "의존 없음"으로 읽었다 — 선행 기능이 안 끝났는데도
// 집을 수 있게 보인다. 미선언은 없음이 아니다.
test('의존 선언이 없으면 pickupable이 아니다 — 미선언을 "없음"으로 읽지 않는다', () => {
  const result = claimScopeReadiness({unit: {featureId: 'X'}, foundationComplete: true, opts: roots})
  assert.equal(result.pickupable, false)
  assert.equal(result.blockedReason, 'deps-undeclared')
})

test('명시적 없음(dependsOn: [])은 통과한다 — 선언과 부재를 가른다', () => {
  const result = claimScopeReadiness({unit: {featureId: 'X', dependsOn: []}, foundationComplete: true, opts: roots})
  assert.equal(result.pickupable, true)
})

test('막힌 의존을 이름으로 돌려준다 — 무엇을 기다리는지 말한다', () => {
  const result = claimScopeReadiness({
    unit: {featureId: 'FEAT-006', dependsOn: ['FEAT-004', 'FEAT-005']},
    foundationComplete: true, mergedFeatureIds: ['FEAT-004'], opts: roots,
  })
  assert.equal(result.blockedReason, 'deps-incomplete')
  assert.deepEqual(result.unmetDeps, ['FEAT-005'])
})

// 충돌 판정이 묻는 것은 "둘이 **동시에** 열릴 수 있는가"다. 한쪽이 다른 쪽에 의존하면
// 구조적으로 순차라 같은 파일을 건드려도 동시에 건드리지 않는다. 이 구분이 없으면
// **정직하게 paths를 적을수록 더 막히는** 역설이 된다(2026-08-30 실측).
test('의존으로 순서가 잡힌 쌍은 경로가 겹쳐도 충돌이 아니다', () => {
  const units = [
    {featureId: 'FEAT-002', paths: ['src/widgets/canvas/'], dependsOn: []},
    {featureId: 'FEAT-006', paths: ['src/widgets/canvas/'], dependsOn: ['FEAT-002']},
  ]
  assert.deepEqual(findPathCollisions(units, roots), [])
})

test('전이 의존도 순차로 본다 — 한 다리 건너도 동시가 아니다', () => {
  const units = [
    {featureId: 'A', paths: ['src/x/'], dependsOn: []},
    {featureId: 'B', paths: ['src/y/'], dependsOn: ['A']},
    {featureId: 'C', paths: ['src/x/'], dependsOn: ['B']},
  ]
  assert.deepEqual(findPathCollisions(units, roots), [], 'C는 A에 전이 의존하므로 동시에 열리지 않는다')
})

test('같은 웨이브에서 겹치면 여전히 충돌이다 — 진짜 동시 후보만 남는다', () => {
  const units = [
    {featureId: 'FEAT-006', paths: ['src/widgets/canvas/'], dependsOn: ['FEAT-005']},
    {featureId: 'FEAT-008', paths: ['src/widgets/canvas/'], dependsOn: ['FEAT-005']},
  ]
  assert.deepEqual(findPathCollisions(units, roots), [{a: 'FEAT-006', b: 'FEAT-008'}])
})

test('의존 순환이 있어도 무한 재귀하지 않는다', () => {
  const units = [
    {featureId: 'A', paths: ['src/x/'], dependsOn: ['B']},
    {featureId: 'B', paths: ['src/x/'], dependsOn: ['A']},
  ]
  assert.deepEqual(findPathCollisions(units, roots), [], '순환 자체는 computeClaimOrder가 보고한다')
})

test('충돌 검사가 돌지 않은 unit을 보고한다 — "충돌 없음"과 "검사 못 함"을 가른다', () => {
  const units = [
    {featureId: 'FEAT-001', paths: ['src/a/']},
    {featureId: 'FEAT-002'},
    {featureId: 'FEAT-003'},
  ]
  assert.deepEqual(uncheckedForCollision(units, roots), ['FEAT-002', 'FEAT-003'])
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
