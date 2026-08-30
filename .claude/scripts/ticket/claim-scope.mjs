// 팀 워크플로우 통합 — 청구 범위 planner (FSD 슬라이스 번들, 순수).
// docs/team-workflow-integration-design.md: 청구 단위는 "독립 개발·PR 가능한, 경로가 겹치지
// 않는 작업 단위"다(단순 FEAT 아님). 세 축으로 판정한다:
//  1. 계층(layer): foundation(공유 인프라 — 직렬·선행) vs feature(슬라이스 — 병렬)
//  2. 경로 소유(disjoint ALLOWED_PATHS): 병렬 청구는 경로가 서로소여야 함(겹치면 컨플릭)
//  3. 의존 순서: foundation 먼저, feature는 의존 FEAT 준비 후
// 이 모듈은 순수하다. unit은 {featureId, title, layer?, paths?, dependsOn?}를 선택적으로 실을 수
// 있고, 없으면 해당 축 판정을 안전하게 생략한다(하위호환 — 없는 정보를 지어내지 않음).

/** 경로 a가 경로/디렉토리 b를 포함하는가(경계 안전 — src/feature ≠ src/features). */
function covers(a, b) {
  if (a === b) return true
  const prefix = a.endsWith('/') ? a : `${a}/`
  return b.startsWith(prefix)
}

/** 두 경로 집합이 겹치는가(prefix 경계 인식). */
export function pathsOverlap(pathsA = [], pathsB = []) {
  return pathsA.some(a => pathsB.some(b => covers(a, b) || covers(b, a)))
}

/**
 * unit의 계층을 판정한다(순수). 명시 layer가 있으면 우선, 없으면 foundationRoots에 걸리는
 * 경로가 있으면 foundation. 경로·layer 둘 다 없으면 feature로 본다(보수적 — 병렬 기본).
 * foundationRoots는 caller가 준다(FSD 경로를 하드코딩하지 않음 — I3).
 * @param {{layer?: string, paths?: string[]}} unit
 * @param {{foundationRoots?: string[]}} [opts]
 * @returns {'foundation'|'feature'}
 */
export function classifyLayer(unit, {foundationRoots = []} = {}) {
  if (unit.layer === 'foundation' || unit.layer === 'feature') return unit.layer
  const paths = unit.paths ?? []
  const isFoundation = paths.some(p => foundationRoots.some(root => covers(root, p) || p === root))
  return isFoundation ? 'foundation' : 'feature'
}

/**
 * 의존 그래프에서 `from`이 `to`에 (전이적으로) 의존하는가. 순환은 방문 집합으로 끊는다
 * (순환 자체는 computeClaimOrder가 별도로 보고한다 — 여기서 판단하지 않는다).
 */
const dependsTransitively = (from, to, dependencyMap, seen = new Set()) => {
  for (const next of dependencyMap.get(from) ?? []) {
    if (next === to) return true
    if (seen.has(next)) continue
    seen.add(next)
    if (dependsTransitively(next, to, dependencyMap, seen)) return true
  }
  return false
}

/**
 * feature 계층 unit들 사이의 경로 충돌을 찾는다(순수). 병렬 청구 안전성 — 겹치면 하나로 묶거나
 * 공유분을 foundation으로 승격해야 한다. paths 없는 unit은 검사 대상에서 제외(정보 없음).
 *
 * **의존으로 이미 순서가 잡힌 쌍은 충돌이 아니다.** 충돌 판정이 묻는 것은 "둘이 **동시에**
 * 열릴 수 있는가"이고, 한쪽이 다른 쪽에 (전이적으로) 의존하면 둘은 구조적으로 순차다 —
 * 같은 파일을 건드려도 동시에 건드리지 않는다. 이 구분이 없으면 웨이브가 다른 쌍까지 전부
 * 충돌로 잡혀 **정직하게 paths를 적을수록 더 막히는** 역설이 된다(2026-08-30 실측: track에서
 * 경계가 겹치는 파이프라인·캔버스 계열이 통째로 봉쇄됐다). 남는 것은 **진짜 동시 후보**뿐이다.
 * @param {Array} units
 * @param {{foundationRoots?: string[]}} [opts]
 * @returns {Array<{a: string, b: string}>}  충돌 FEAT 쌍
 */
export function findPathCollisions(units, opts = {}) {
  const dependencyMap = new Map((units ?? []).map(u => [u.featureId, u.dependsOn ?? []]))
  const feats = (units ?? []).filter(u => classifyLayer(u, opts) === 'feature' && (u.paths?.length ?? 0) > 0)
  // paths 미선언 unit은 검사에서 빠진다 — 그 사실을 caller가 볼 수 있어야 "충돌 0건"과
  // "검사 0건"이 구분된다(unreportedCollisionCheck). 종전에는 둘이 같아 보였다.
  const collisions = []
  for (let i = 0; i < feats.length; i++) {
    for (let j = i + 1; j < feats.length; j++) {
      const [a, b] = [feats[i].featureId, feats[j].featureId]
      // 순서가 이미 잡힌 쌍은 동시에 열리지 않는다 — 충돌이 아니다.
      if (dependsTransitively(a, b, dependencyMap) || dependsTransitively(b, a, dependencyMap)) continue
      if (pathsOverlap(feats[i].paths, feats[j].paths)) collisions.push({a, b})
    }
  }
  return collisions
}

/**
 * 충돌 검사가 **돌지 않은** feature unit들. "충돌 없음"과 "검사 못 함"을 가른다 —
 * 둘이 같아 보이면 미선언 계획에서 병렬 충돌이 조용히 통과한다(2026-08-30 실측).
 * @param {Array} units
 * @param {{foundationRoots?: string[]}} [opts]
 * @returns {string[]}  paths 미선언 FEAT ID
 */
export function uncheckedForCollision(units, opts = {}) {
  return (units ?? [])
    .filter(u => classifyLayer(u, opts) === 'feature' && u.paths === undefined)
    .map(u => u.featureId)
}

/**
 * 청구 순서를 계산한다(순수): foundation 먼저, feature는 dependsOn 위상정렬. 순환은 보고만.
 * @param {Array} units
 * @param {{foundationRoots?: string[]}} [opts]
 * @returns {{foundation: string[], features: string[], order: string[], cycles: string[]}}
 */
export function computeClaimOrder(units, opts = {}) {
  const layerOf = u => classifyLayer(u, opts)
  const foundation = (units ?? []).filter(u => layerOf(u) === 'foundation')
  const features = (units ?? []).filter(u => layerOf(u) === 'feature')
  const byId = new Map(features.map(u => [u.featureId, u]))
  const ordered = []
  const visited = new Set()
  const temp = new Set()
  const cycles = []
  const visit = u => {
    if (visited.has(u.featureId)) return
    if (temp.has(u.featureId)) { cycles.push(u.featureId); return }
    temp.add(u.featureId)
    for (const dep of u.dependsOn ?? []) {
      const du = byId.get(dep)
      if (du) visit(du) // feature 간 의존만 정렬(foundation 의존은 계층으로 이미 선행)
    }
    temp.delete(u.featureId)
    visited.add(u.featureId)
    ordered.push(u.featureId)
  }
  features.forEach(visit)
  return {
    foundation: foundation.map(u => u.featureId),
    features: ordered,
    order: [...foundation.map(u => u.featureId), ...ordered],
    cycles,
  }
}

/**
 * 한 unit이 지금 픽업 가능한지 범위 판정(순수). 동적 상태(foundation 완료·의존 머지·충돌)를 받는다.
 *  - foundation: 항상 pickupable(직렬 실행은 소유권 가드가 담당 — 여기선 계층만)
 *  - feature: **dependsOn 선언됨** && foundation 완료 && 모든 dependsOn 머지 && 활성 충돌 없음
 *    → pickupable. 선언 자체가 없으면 `deps-undeclared`로 막는다 — 미선언은 "없음"이 아니다.
 * @param {Object} args {unit, foundationComplete, mergedFeatureIds?, collisions?, opts?}
 * @returns {{pickupable: boolean, blockedReason: string|null}}
 */
export function claimScopeReadiness({unit, foundationComplete = true, mergedFeatureIds = [], collisions = [], opts = {}}) {
  if (classifyLayer(unit, opts) === 'foundation') return {pickupable: true, blockedReason: null}
  if (!foundationComplete) return {pickupable: false, blockedReason: 'foundation-incomplete'}
  // **미선언을 "의존 없음"으로 읽지 않는다.** 종전에는 `dependsOn ?? []`라 선언이 없으면
  // 곧바로 pickupable이었다 — 실제 순서가 산문에만 있는 계획에서 **선행 기능이 안 끝났는데도
  // 집을 수 있게** 보였다(2026-08-30 실측: track 11건이 전부 pickupable, 실제로는 4건).
  // 명시적 없음은 `dependsOn=none`이다. 축이 없으면 통과가 아니다.
  if (unit.dependsOn === undefined) return {pickupable: false, blockedReason: 'deps-undeclared'}
  const merged = new Set(mergedFeatureIds)
  const unmetDeps = unit.dependsOn.filter(d => !merged.has(d))
  if (unmetDeps.length > 0) return {pickupable: false, blockedReason: 'deps-incomplete', unmetDeps}
  const inCollision = collisions.some(c => c.a === unit.featureId || c.b === unit.featureId)
  if (inCollision) return {pickupable: false, blockedReason: 'path-collision'}
  return {pickupable: true, blockedReason: null}
}

/**
 * 가용성 보드(assign.buildAvailabilityBoard)에 범위 판정을 얹는다(순수). 각 행에 layer를 달고,
 * scope가 막으면(foundation 미완·의존 미머지·충돌) pickupable/unclaimed를 'blocked'로 강등한다.
 * 이미 진행 중(mine/in-progress)인 행은 상태 유지(강등은 아직 안 집은 것에만).
 * @param {Array} board  buildAvailabilityBoard 결과
 * @param {Array} units
 * @param {{foundationComplete?: boolean, mergedFeatureIds?: string[], collisions?: Array, opts?: Object}} ctx
 * @returns {Array}
 */
export function annotateBoardScope(board, units, {foundationComplete = true, mergedFeatureIds = [], collisions = [], opts = {}} = {}) {
  const byId = new Map((units ?? []).map(u => [u.featureId, u]))
  return (board ?? []).map(row => {
    const unit = byId.get(row.featureId) ?? {featureId: row.featureId}
    const layer = classifyLayer(unit, opts)
    const readiness = claimScopeReadiness({unit, foundationComplete, mergedFeatureIds, collisions, opts})
    const downgrade = !readiness.pickupable && (row.status === 'pickupable' || row.status === 'unclaimed')
    return {...row, layer, ...(downgrade ? {status: 'blocked', blockedReason: readiness.blockedReason} : {})}
  })
}
