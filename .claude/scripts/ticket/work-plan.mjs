// work-plan.mjs — WORK 분해 계획(P1)의 검증과 실행 가능 집합 계산(순수).
//
// FEAT·TC는 요구사항·수용 기준으로 **그대로 둔다**(정본은 feature-plan). 기술 작업은 `WORK-<UUID>`로
// 따로 추적한다 — 기반 작업을 FEAT로 만들면 요구사항 ID 공간에 기술 작업이 섞이고, TC가 없으면 완료
// 판정이 `no-test-cases`로 막혀 가짜 TC를 만들거나 탈출구를 쓰게 된다(completion.mjs, 2026-09-11 대조).
// 기반 작업은 TC 대신 **실제 기술 검증(checks)**을 갖는다.
//
// 이 모듈이 막는 것: TC 책임 누락·중복(T04) · 이전에 검토한 작업의 조용한 삭제(T05) · 순환과 미선언
// 의존(T06·T07) · 순서 없는 같은 경로 동시 수정(T08) · 가짜 TC(T02) · 고아 작업 · 분석과 어긋난
// 계획(T42) · 근거 없는 작업(분석→WORK 연결) · 제공 계약을 쓰는데 선행 의존이 없음 · 디자인 참조의
// 부재·오대응(T50·T52·T54). **우선순위는 실행 가능 집합 안에서만** 순서를 정한다(T37).
import {canonicalDigest, safeRelativePath, safeRelativeScope} from './work-analysis.mjs'
import {conditionKey} from '../design-binding-lib.mjs'

/** 경로 a가 경로/디렉터리 b를 포함하는가(경계 안전 — `src/feature` ≠ `src/features`). */
const covers = (a, b) => a === b || b.startsWith(a.endsWith('/') ? a : `${a}/`)
/** 두 경로 집합이 겹치는가(접두 경계 인식, 순수). */
export const pathsOverlap = (pathsA = [], pathsB = []) => pathsA.some(a => pathsB.some(b => covers(a, b) || covers(b, a)))

export const WORK_PLAN_PATH = '_workspace/03_dev/work-plan.json'
export const WORK_KINDS = ['foundation', 'implementation', 'integration']
export const LIFECYCLES = ['active', 'cancelled', 'superseded']
export const DESIGN_APPLICABILITY = ['direct-ui', 'behavior-context', 'not-applicable']
export const SELECTION_PURPOSE = ['implementation', 'context', 'verification']

// 키 집합의 정본 — `team-flow/references/work-plan-contract.md` 표와 회귀가 양방향으로 대조한다.
export const WORK_PLAN_KEYS = {
  document: ['schemaVersion', 'planId', 'sourceRevision', 'baseBranch', 'analysisRef', 'designBindingRef', 'featureBindings', 'workItems'],
  ref: ['path', 'digest'],
  binding: ['featureId', 'sourceDigest', 'requiredWorkIds', 'acceptanceOwners'],
  owner: ['testCaseId', 'workId'],
  work: ['workId', 'title', 'kind', 'objective', 'nonGoals', 'dependsOn', 'readPaths', 'writePaths', 'contractRefs',
    'provides', 'consumes', 'designContext', 'basisRefs', 'priorityRefs', 'blockerRefs', 'contributesTo', 'checks',
    'lifecycle', 'supersededBy'],
  contract: ['path', 'anchor'],
  design: ['applicability', 'rationaleRef', 'selections', 'contextRefs', 'unresolvedRefs'],
  selection: ['featureIds', 'testCaseIds', 'pageGroup', 'condition', 'referenceIds', 'purpose'],
  check: ['checkId', 'kind', 'targetRefs', 'expectedOutcome'],
}
const KEYS = WORK_PLAN_KEYS
const WORK_ID = /^WORK-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const list = value => (Array.isArray(value) ? value : [])
const contractKey = ref => `${ref?.path}#${ref?.anchor ?? ''}`
const rejectUnknown = (value, allowed, label, errors) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  const unknown = Object.keys(value).filter(key => !allowed.includes(key))
  if (unknown.length > 0) errors.push(`${label}: 알 수 없는 키 ${unknown.sort().join(', ')} — 조용히 버리지 않는다`)
}

/** 의존 그래프의 순환(순수). 발견한 순환의 한 경로씩 돌려준다. */
export function findDependencyCycles(works) {
  const byId = new Map(works.map(work => [work.workId, work]))
  const state = new Map()
  const cycles = []
  const visit = (id, trail) => {
    if (state.get(id) === 'done') return
    if (state.get(id) === 'open') { cycles.push([...trail.slice(trail.indexOf(id)), id]); return }
    state.set(id, 'open')
    for (const dep of list(byId.get(id)?.dependsOn)) if (byId.has(dep)) visit(dep, [...trail, id])
    state.set(id, 'done')
  }
  for (const id of byId.keys()) visit(id, [])
  return cycles
}

/** id → 그 작업이 (전이적으로) 기다리는 작업들. */
const ancestorsOf = works => {
  const byId = new Map(works.map(work => [work.workId, work]))
  const memo = new Map()
  const walk = (id, seen = new Set()) => {
    if (memo.has(id)) return memo.get(id)
    const result = new Set()
    for (const dep of list(byId.get(id)?.dependsOn)) {
      if (seen.has(dep)) continue
      result.add(dep)
      for (const up of walk(dep, new Set([...seen, dep]))) result.add(up)
    }
    memo.set(id, result)
    return result
  }
  return id => walk(id)
}

/**
 * 계획을 검증한다(순수).
 * @param {object} plan
 * @param {{analysis: object, analysisIds: object, units: Array, deferredTcs?: Set<string>, unitDigest: (unit: object) => string,
 *   designBinding?: object|null, designBindingDigest?: string|null, knownWorkIds?: Set<string>, io?: {exists?: (path: string) => boolean}}} context
 *   knownWorkIds: 지금까지 검토한 판본들에 한 번이라도 있었던 작업 ID(계보) — 취소 뒤 배열에서 지우는 2단 삭제도 잡는다
 */
export function validateWorkPlan(plan, context) {
  const {analysis, analysisIds, units, deferredTcs = new Set(), unitDigest, designBinding = null, designBindingDigest = null,
    knownWorkIds = new Set(), io = {}} = context
  const errors = []
  const warnings = []
  if (!plan || typeof plan !== 'object') return {errors: ['계획 문서가 객체가 아니다'], warnings}
  rejectUnknown(plan, KEYS.document, 'work-plan', errors)
  if (plan.schemaVersion !== 1) errors.push('schemaVersion은 1이어야 한다')
  if (!UUID.test(String(plan.planId ?? ''))) errors.push('planId는 UUID여야 한다')
  if (typeof plan.sourceRevision !== 'string' || !plan.sourceRevision) errors.push('sourceRevision이 없다 — 어느 커밋의 기획·코드를 읽었는지 모른다')
  // 분석과 계획이 **같은 판본**을 가리켜야 한다(T42) — 분석이 바뀌었는데 옛 판단으로 발행하지 않는다.
  rejectUnknown(plan.analysisRef, KEYS.ref, 'analysisRef', errors)
  const analysisDigest = canonicalDigest(analysis)
  if (plan.analysisRef?.digest !== analysisDigest) {
    errors.push(`analysisRef.digest가 현재 분석과 다르다(계획 ${String(plan.analysisRef?.digest).slice(0, 12)} · 분석 ${analysisDigest.slice(0, 12)}) — 분석이 바뀌었으면 계획을 다시 검토한다`)
  }
  if (plan.designBindingRef) {
    rejectUnknown(plan.designBindingRef, KEYS.ref, 'designBindingRef', errors)
    if (designBindingDigest && plan.designBindingRef.digest !== designBindingDigest) {
      warnings.push('디자인 연결(design-binding)의 판본이 계획 작성 뒤 바뀌었다 — direct-ui 선택이 있는 WORK를 재검토한다(원격 Figma 변경은 재수집 없이 알 수 없다)')
    }
  }

  // ── 작업 ──
  const works = list(plan.workItems)
  const byId = new Map()
  for (const work of works) {
    if (!WORK_ID.test(String(work?.workId ?? ''))) { errors.push(`workItems: workId 형식 오류 (${JSON.stringify(work?.workId)}) — WORK-<UUID>`); continue }
    if (byId.has(work.workId)) errors.push(`workItems: ${work.workId}가 중복됐다`)
    byId.set(work.workId, work)
  }
  const active = works.filter(work => (work?.lifecycle ?? 'active') === 'active' && byId.get(work.workId) === work)
  const activeIds = new Set(active.map(work => work.workId))

  // ── 기능 바인딩: 분석이 planned로 분류한 FEAT 전부 ──
  const unitById = new Map(units.map(unit => [unit.featureId, unit]))
  const planned = [...(analysisIds.dispositions?.values() ?? [])].filter(entry => entry.status === 'planned').map(entry => entry.featureId)
  const bindings = new Map()
  for (const binding of list(plan.featureBindings)) {
    rejectUnknown(binding, KEYS.binding, `featureBinding ${binding?.featureId}`, errors)
    if (bindings.has(binding?.featureId)) errors.push(`featureBindings: ${binding.featureId}가 중복됐다`)
    bindings.set(binding?.featureId, binding)
  }
  for (const id of planned) if (!bindings.has(id)) errors.push(`featureBindings에 planned FEAT ${id}가 없다 — 분해 대상인데 작업이 없다`)
  const tcOwnerOf = new Map()
  const featureOfWork = new Map()
  for (const [featureId, binding] of bindings) {
    const unit = unitById.get(featureId)
    if (!unit) { errors.push(`featureBinding ${featureId}: 계획(feature-plan)에 없는 FEAT다`); continue }
    if (!planned.includes(featureId)) errors.push(`featureBinding ${featureId}: 분석에서 planned가 아닌 FEAT에 작업을 묶었다`)
    // 기능 입력이 바뀌었으면(TC·정책) 이 FEAT의 분해는 낡았다(T21) — 조용히 그대로 쓰지 않는다.
    if (binding.sourceDigest !== unitDigest(unit)) errors.push(`featureBinding ${featureId}: 기능 명세가 계획 작성 뒤 바뀌었다(sourceDigest 불일치) — 영향받은 WORK를 재검토한다`)
    const required = list(binding.requiredWorkIds)
    if (required.length === 0) errors.push(`featureBinding ${featureId}: requiredWorkIds가 비었다`)
    for (const workId of required) {
      if (!activeIds.has(workId)) errors.push(`featureBinding ${featureId}: 필수 작업 ${workId}가 활성 작업에 없다`)
      if (!featureOfWork.has(workId)) featureOfWork.set(workId, new Set())
      featureOfWork.get(workId).add(featureId)
    }
    // TC 분모는 **현재 feature-plan**에서 온다 — 계획에 복사한 목록을 새 분모로 삼지 않는다.
    const requiredTcs = list(unit.testCaseIds).filter(tc => !deferredTcs.has(tc))
    const owners = new Map()
    for (const owner of list(binding.acceptanceOwners)) {
      rejectUnknown(owner, KEYS.owner, `acceptanceOwner ${featureId}`, errors)
      if (!list(unit.testCaseIds).includes(owner?.testCaseId)) { errors.push(`featureBinding ${featureId}: ${owner?.testCaseId}는 이 FEAT의 TC가 아니다 — TC를 지어내지 않는다`); continue }
      if (owners.has(owner.testCaseId)) errors.push(`featureBinding ${featureId}: ${owner.testCaseId}의 최종 검증 책임이 둘이다`)
      owners.set(owner.testCaseId, owner.workId)
      if (!required.includes(owner.workId)) errors.push(`featureBinding ${featureId}: ${owner.testCaseId}의 책임 작업 ${owner.workId}가 이 FEAT의 필수 작업이 아니다`)
      tcOwnerOf.set(owner.testCaseId, owner.workId)
    }
    const unowned = requiredTcs.filter(tc => !owners.has(tc))
    if (unowned.length > 0) errors.push(`featureBinding ${featureId}: 최종 검증 책임이 없는 TC — ${unowned.join(', ')}(T04). 유예는 기획의 명시적 결정으로만 뺀다`)
  }

  // ── 작업별 규칙 ──
  const findingOrDecision = new Set([...(analysisIds.findingIds ?? []), ...(analysisIds.decisionIds ?? [])])
  const bindingByCondition = new Map()
  for (const entry of list(designBinding?.bindings)) bindingByCondition.set(`${entry.pageGroup} ${conditionKey(entry.condition)}`, entry)
  for (const work of works) {
    if (!byId.has(work?.workId) || byId.get(work.workId) !== work) continue
    const label = `WORK ${work.workId.slice(5, 13)}(${work.title ?? '?'})`
    rejectUnknown(work, KEYS.work, label, errors)
    const lifecycle = work.lifecycle ?? 'active'
    if (!LIFECYCLES.includes(lifecycle)) errors.push(`${label}: lifecycle은 ${LIFECYCLES.join('|')}`)
    if (lifecycle === 'superseded' && !list(work.supersededBy).every(id => byId.has(id))) errors.push(`${label}: supersededBy가 계획에 없는 작업을 가리킨다`)
    if (lifecycle === 'superseded' && list(work.supersededBy).length === 0) errors.push(`${label}: 대체됐으면 무엇으로 대체됐는지 적는다`)
    if (lifecycle !== 'active') continue
    if (!WORK_KINDS.includes(work.kind)) errors.push(`${label}: kind는 ${WORK_KINDS.join('|')}`)
    if (!work.objective) errors.push(`${label}: objective가 없다`)
    if (!Array.isArray(work.dependsOn)) errors.push(`${label}: dependsOn이 없다 — 미선언은 「의존 없음」이 아니다. 없으면 []로 명시한다(T07)`)
    for (const dep of list(work.dependsOn)) {
      if (dep === work.workId) errors.push(`${label}: 자기 자신에 의존한다`)
      else if (!byId.has(dep)) errors.push(`${label}: 의존 ${dep}가 계획에 없다`)
      else if (!activeIds.has(dep)) errors.push(`${label}: 취소·대체된 작업 ${dep}에 의존한다`)
    }
    for (const key of ['readPaths', 'writePaths']) {
      for (const path of list(work[key])) if (!safeRelativeScope(path)) errors.push(`${label}: ${key}의 ${JSON.stringify(path)}는 프로젝트 상대 경로가 아니다`)
    }
    if (list(work.writePaths).length === 0) errors.push(`${label}: writePaths가 비었다 — 수정 경계가 없으면 충돌 검사를 할 수 없다`)
    for (const key of ['contractRefs', 'provides', 'consumes']) {
      for (const ref of list(work[key])) {
        rejectUnknown(ref, KEYS.contract, `${label} ${key}`, errors)
        if (!safeRelativePath(ref?.path)) errors.push(`${label}: ${key}의 경로가 프로젝트 상대 경로가 아니다`)
        else if (key === 'contractRefs' && io.exists && !io.exists(ref.path)) errors.push(`${label}: contractRef ${ref.path}가 없다`)
      }
    }
    // 분석 → WORK 연결: 근거 없는 작업은 「공통이니까 먼저」의 산물이다.
    if (list(work.basisRefs).length === 0) errors.push(`${label}: basisRefs가 비었다 — 이 작업이 어떤 분석 판정·결정에서 나왔는지 연결한다`)
    for (const ref of list(work.basisRefs)) if (!findingOrDecision.has(ref)) errors.push(`${label}: basisRef ${ref}가 분석의 판정·결정에 없다`)
    for (const ref of list(work.priorityRefs)) if (!analysisIds.priorityIds?.has(ref)) errors.push(`${label}: priorityRef ${ref}가 분석의 우선순위 입력에 없다`)
    for (const ref of list(work.blockerRefs)) if (!analysisIds.unresolvedIds?.has(ref)) errors.push(`${label}: blockerRef ${ref}가 분석의 미결에 없다`)
    if (!featureOfWork.has(work.workId)) errors.push(`${label}: 어떤 FEAT의 필수 작업도 아니다(고아) — 소비하는 FEAT에 연결하거나 취소한다`)
    // 기반 작업은 사용자 TC가 없어도 된다 — 대신 실제 기술 검증이 있어야 한다(T02).
    const checks = list(work.checks)
    if (checks.length === 0) errors.push(`${label}: checks가 비었다 — 기반 작업도 실제 기술 검증 기준을 갖는다(가짜 TC 대신)`)
    for (const check of checks) {
      rejectUnknown(check, KEYS.check, `${label} check`, errors)
      if (!check?.checkId || !check.kind || !check.expectedOutcome) errors.push(`${label}: check에 checkId·kind·expectedOutcome이 필요하다`)
    }
    const ownFeatures = featureOfWork.get(work.workId) ?? new Set()
    const ownTcs = new Set([...ownFeatures].flatMap(featureId => list(unitById.get(featureId)?.testCaseIds)))
    for (const tc of list(work.contributesTo)) if (!ownTcs.has(tc)) errors.push(`${label}: contributesTo ${tc}가 이 작업이 속한 FEAT의 TC가 아니다`)
    validateDesignContext(work, {label, ownFeatures, ownTcs, designBinding, bindingByCondition, analysisIds, errors, io})
  }

  // ── 그래프 규칙 ──
  for (const cycle of findDependencyCycles(active)) errors.push(`의존 순환: ${cycle.map(id => id.slice(5, 13)).join(' → ')}(T06) — 종류(foundation 포함)와 무관하게 막는다`)
  const ancestors = ancestorsOf(active)
  const ordered = (a, b) => ancestors(a.workId).has(b.workId) || ancestors(b.workId).has(a.workId)
  for (let i = 0; i < active.length; i += 1) {
    for (let j = i + 1; j < active.length; j += 1) {
      const [a, b] = [active[i], active[j]]
      if (pathsOverlap(list(a.writePaths), list(b.writePaths)) && !ordered(a, b)) {
        errors.push(`경로 충돌: ${a.title ?? a.workId}와 ${b.title ?? b.workId}가 같은 경로를 쓰는데 순서가 없다(T08) — 소유자를 정하거나 의존으로 순서를 정한다`)
      }
    }
  }
  // 제공 계약을 쓰면 그 제공자를 기다려야 한다 — 선언 없이 병렬로 두면 통합에서 맞춘다.
  const providers = new Map()
  for (const work of active) for (const ref of list(work.provides)) providers.set(contractKey(ref), work)
  for (const work of active) {
    for (const ref of list(work.consumes)) {
      const provider = providers.get(contractKey(ref))
      if (provider && provider !== work && !ancestors(work.workId).has(provider.workId)) {
        errors.push(`${work.title ?? work.workId}: ${ref.path}${ref.anchor ? `#${ref.anchor}` : ''}를 소비하는데 제공 작업(${provider.title ?? provider.workId})에 의존하지 않는다`)
      }
    }
  }

  // ── 검토 계보 대조: 한 번 검토한 작업은 배열에서 사라지지 않는다(T05) — 취소 뒤 지우는 2단 삭제도 막는다 ──
  for (const workId of knownWorkIds) {
    if (!byId.has(workId)) {
      errors.push(`검토한 판본에 있던 작업 ${workId}가 사라졌다 — 삭제가 아니라 cancelled/superseded로 남기고 TC 책임을 재배치한다`)
    }
  }
  // ── 분석의 반영 연결이 가리키는 작업이 실재하는가(T41) ──
  for (const link of analysisIds.links?.values() ?? []) {
    if (link?.resolution !== 'consumed') continue
    for (const target of list(link.targetRefs)) {
      if (String(target).startsWith('WORK-') && !byId.has(target)) errors.push(`분석 resolutionLink ${link.analysisItemId}: 반영처 ${target}가 계획에 없다`)
    }
  }
  return {errors, warnings, activeIds, featureOfWork, tcOwnerOf, analysisDigest}
}

function validateDesignContext(work, {label, ownFeatures, ownTcs, designBinding, bindingByCondition, analysisIds, errors, io}) {
  const context = work.designContext
  if (!context) { errors.push(`${label}: designContext가 없다 — UI를 직접 바꾸는지·동작 참고인지·해당 없는지를 근거와 함께 적는다`); return }
  rejectUnknown(context, KEYS.design, `${label} designContext`, errors)
  if (!DESIGN_APPLICABILITY.includes(context.applicability)) { errors.push(`${label}: designContext.applicability는 ${DESIGN_APPLICABILITY.join('|')}`); return }
  const selections = list(context.selections)
  // not-applicable로 필수 디자인 조건을 우회하지 못하게 근거를 요구한다(T54).
  if (context.applicability === 'not-applicable') {
    if (!context.rationaleRef) errors.push(`${label}: not-applicable에는 rationaleRef(분석 판정·결정)가 필요하다`)
    if (selections.length > 0) errors.push(`${label}: not-applicable인데 디자인 선택이 있다`)
  }
  if (context.rationaleRef && ![analysisIds.findingIds, analysisIds.decisionIds].some(ids => ids?.has(context.rationaleRef))) {
    errors.push(`${label}: designContext.rationaleRef ${context.rationaleRef}가 분석에 없다`)
  }
  // direct-ui는 「UI를 직접 바꾼다」다. 디자인 연결(design-binding)이 있으면 그 조건을 고르고, 없으면(generated/
  // absent) 화면 명세를 contextRefs로 잇는다 — 어느 쪽도 없으면 인계할 근거가 없다.
  const contextRefs = list(context.contextRefs)
  if (context.applicability === 'direct-ui' && selections.length === 0 && contextRefs.length === 0 && list(context.unresolvedRefs).length === 0) {
    errors.push(`${label}: direct-ui인데 화면·조건 선택도 명세 참조(contextRefs)도 미결도 없다 — 링크 없이 인계 완료로 두지 않는다`)
  }
  for (const ref of contextRefs) {
    if (!safeRelativePath(ref?.path)) errors.push(`${label}: designContext.contextRefs의 경로가 프로젝트 상대 경로가 아니다`)
    else if (io.exists && !io.exists(ref.path)) errors.push(`${label}: designContext.contextRef ${ref.path}가 없다`)
  }
  if (selections.length > 0 && !designBinding) {
    errors.push(`${label}: 디자인 선택이 있는데 design-binding이 없다 — generated/absent면 contextRefs로 명세를 잇는다`)
  }
  for (const selection of designBinding ? selections : []) {
    rejectUnknown(selection, KEYS.selection, `${label} selection`, errors)
    if (!SELECTION_PURPOSE.includes(selection?.purpose)) errors.push(`${label}: selection.purpose는 ${SELECTION_PURPOSE.join('|')}`)
    for (const featureId of list(selection?.featureIds)) if (!ownFeatures.has(featureId)) errors.push(`${label}: 선택의 ${featureId}는 이 작업이 속한 FEAT가 아니다`)
    for (const tc of list(selection?.testCaseIds)) if (!ownTcs.has(tc)) errors.push(`${label}: 선택의 ${tc}는 이 작업의 FEAT TC가 아니다`)
    // 기존 연결은 (pageGroup, condition)이 정체성이다 — 배열 index나 이름 유사도로 짓지 않는다.
    const entry = bindingByCondition.get(`${selection?.pageGroup} ${conditionKey(selection?.condition)}`)
    if (!entry) { errors.push(`${label}: ${selection?.pageGroup} 조건이 design-binding에 없다 — 연결 후보는 미결로 남기고 선언을 지어내지 않는다(T50)`); continue }
    const bound = new Set(list(entry.referenceIds))
    for (const id of list(selection.referenceIds)) if (!bound.has(id)) errors.push(`${label}: reference ${id}는 그 조건에 묶인 근거가 아니다`)
    if (entry.resolution === 'pending' && selection.purpose === 'implementation' && list(context.unresolvedRefs).length === 0) {
      errors.push(`${label}: 구현 근거로 고른 조건이 pending이다 — 미결로 연결해 이 작업만 막는다(T52)`)
    }
  }
  for (const ref of list(context.unresolvedRefs)) if (!analysisIds.unresolvedIds?.has(ref)) errors.push(`${label}: designContext.unresolvedRef ${ref}가 분석의 미결에 없다`)
}

/**
 * 실행 가능 집합과 순서 제안(순수). **의존은 제약, 우선순위는 그 안의 선택이다** — 우선순위로
 * 미충족 선행·미결을 우회하지 않는다(T37). 상위 작업의 우선순위는 그것을 여는 선행 작업에도 전달된다.
 * 기간·가중치를 지어내지 않는다: 동률은 여는 후속 작업 수(보조 정보) → ID 순이다.
 * @param {object} plan  검증을 통과한 계획
 * @param {object} analysis
 * @param {{integrated?: Set<string>}} [state]  통합 완료된 작업(P2 이후 이벤트가 채운다 — 지금은 비어 있다)
 */
export function computeWorkView(plan, analysis, {integrated = new Set()} = {}) {
  const works = list(plan.workItems).filter(work => (work.lifecycle ?? 'active') === 'active')
  const ranks = new Map(list(analysis.priorityInputs).map(item => [item.id, item.rank]))
  const unresolved = new Set(list(analysis.unresolved).map(item => item.id))
  const ancestors = ancestorsOf(works)
  const ownRank = work => Math.min(Infinity, ...list(work.priorityRefs).map(ref => ranks.get(ref) ?? Infinity))
  const dependents = new Map(works.map(work => [work.workId, works.filter(other => ancestors(other.workId).has(work.workId))]))
  const rows = works.map(work => {
    // 승계 근거: 가장 높은 우선순위(작은 rank)를 가진 후속 작업과 그 priorityRefs를 함께 싣는다.
    const source = [work, ...dependents.get(work.workId)].reduce((best, candidate) => (ownRank(candidate) < ownRank(best) ? candidate : best), work)
    const rank = ownRank(source)
    const blockers = [...new Set([...list(work.blockerRefs), ...list(work.designContext?.unresolvedRefs)])].filter(ref => unresolved.has(ref))
    const waiting = list(work.dependsOn).filter(dep => !integrated.has(dep))
    const status = blockers.length > 0 ? 'blocked-decision' : waiting.length > 0 ? 'waiting-deps' : 'ready'
    return {workId: work.workId, title: work.title, kind: work.kind, status, waiting, blockers,
      rank: Number.isFinite(rank) ? rank : null, priorityRefs: Number.isFinite(rank) ? list(source.priorityRefs) : [],
      rankInheritedFrom: Number.isFinite(rank) && source !== work ? source.workId : null,
      unlocks: dependents.get(work.workId).length}
  })
  const ready = rows.filter(row => row.status === 'ready')
    .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || b.unlocks - a.unlocks || a.workId.localeCompare(b.workId))
  ready.forEach((row, index) => { row.order = index + 1 })
  return {rows, ready: ready.map(row => row.workId)}
}
