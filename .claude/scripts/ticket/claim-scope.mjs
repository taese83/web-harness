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
 * feature 계층 unit들 사이의 경로 충돌을 찾는다(순수). 병렬 청구 안전성 — 겹치면 하나로 묶거나
 * 공유분을 foundation으로 승격해야 한다. paths 없는 unit은 검사 대상에서 제외(정보 없음).
 * @param {Array} units
 * @param {{foundationRoots?: string[]}} [opts]
 * @returns {Array<{a: string, b: string}>}  충돌 FEAT 쌍
 */
export function findPathCollisions(units, opts = {}) {
  const feats = (units ?? []).filter(u => classifyLayer(u, opts) === 'feature' && (u.paths?.length ?? 0) > 0)
  const collisions = []
  for (let i = 0; i < feats.length; i++) {
    for (let j = i + 1; j < feats.length; j++) {
      if (pathsOverlap(feats[i].paths, feats[j].paths)) {
        collisions.push({a: feats[i].featureId, b: feats[j].featureId})
      }
    }
  }
  return collisions
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
 *  - feature: foundation 완료 && 모든 dependsOn 머지 && 활성 충돌 없음 → pickupable
 * @param {Object} args {unit, foundationComplete, mergedFeatureIds?, collisions?, opts?}
 * @returns {{pickupable: boolean, blockedReason: string|null}}
 */
export function claimScopeReadiness({unit, foundationComplete = true, mergedFeatureIds = [], collisions = [], opts = {}}) {
  if (classifyLayer(unit, opts) === 'foundation') return {pickupable: true, blockedReason: null}
  if (!foundationComplete) return {pickupable: false, blockedReason: 'foundation-incomplete'}
  const merged = new Set(mergedFeatureIds)
  const unmetDeps = (unit.dependsOn ?? []).filter(d => !merged.has(d))
  if (unmetDeps.length > 0) return {pickupable: false, blockedReason: 'deps-incomplete'}
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
