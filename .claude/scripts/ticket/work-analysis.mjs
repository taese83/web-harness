// work-analysis.mjs — WORK 분해 전 **선행 분석**(P0)의 형식·참조 검증(순수).
//
// 계기(2026-09-11 WORK 설계 · P0 확장안): 분해 계획의 `dependsOn`·`contractRefs`가 **무엇을 조사하고
// 어떤 판단을 거쳐 생겼는지**가 어디에도 남지 않았다. 분석 파일은 출처·코드 관찰·판정·미결의
// **연결 정본**이다 — 원문 설계·API 스키마·상태 계약 본문은 복제하지 않는다(그것은 00_source·02_design
// 소유). 작성자는 `system-architect` 하나다(소유 레지스트리). 이 모듈은 산문의 의미를 이해하는 척하지
// 않는다 — 참조·상태·집합을 대조할 뿐이며, 판정의 **의미 품질**은 개발 검토의 몫이다.
//
// 막는 것(각각 인수 시나리오 번호):
//   - 범위의 FEAT가 목록에서 빠지거나 모르는 FEAT가 섞임(T44) · 유예 사유 구분 없음(§4.5)
//   - 읽지 못한 자료에 내용 지문을 지어냄(T32) · 초안을 승인된 결정의 근거로 씀(T30)
//   - 조사가 절단됐는데 「없으니 새로 만든다」(create)로 확정(T35) · 근거 없는 재사용(T33)
//   - 받은 자료·판정이 어디에도 반영/제외되지 않음(T41)
import {createHash} from 'node:crypto'

export const WORK_ANALYSIS_PATH = '_workspace/03_dev/work-analysis.json'
export const FEATURE_STATUS = ['planned', 'deferred', 'blocked']
// **후속 상세화 예정**과 **제품 범위 유예**는 다르다 — 전자는 완료 분모를 줄이지 않는다(§4.5).
export const DEFERRAL_KINDS = ['follow-up-detail', 'product-deferral']
export const SOURCE_INTENTS = ['current', 'target', 'reference']
export const SOURCE_DECISION = ['approved', 'draft', 'undecided']
export const ACCESS_STATES = ['read', 'partial', 'unreadable']
export const DECISION_STATUS = ['confirmed', 'draft', 'open']
export const DISPOSITIONS = ['reuse', 'extend', 'adapt', 'create', 'exclude', 'unknown']
export const TEST_STATES = ['exists-not-run', 'ran-passed', 'ran-failed', 'absent', 'unknown']
export const RESOLUTIONS = ['consumed', 'excluded']

// 키 집합의 정본 — `team-flow/references/work-plan-contract.md` 표와 회귀가 양방향으로 대조한다.
export const WORK_ANALYSIS_KEYS = {
  document: ['schemaVersion', 'analysisId', 'scope', 'sourceRefs', 'codeEvidence', 'scanCoverage', 'decisions',
    'findings', 'unresolved', 'priorityInputs', 'resolutionLinks'],
  scope: ['featureIds', 'targetRoots', 'sourceRevision', 'dirty', 'inventoryRef', 'inventoryComplete',
    'incompleteReasons', 'featureDisposition'],
  disposition: ['featureId', 'status', 'deferral', 'reasonRef'],
  sourceRef: ['id', 'snapshotRef', 'digest', 'locator', 'intent', 'decisionStatus', 'scopeRefs', 'accessState', 'note'],
  codeEvidence: ['id', 'path', 'symbol', 'digest', 'observation', 'method', 'testState'],
  scanCoverage: ['roots', 'methods', 'exclusions', 'incompleteReasons'],
  decision: ['id', 'subjectRef', 'status', 'chosenValue', 'authorityRef', 'evidenceRefs', 'scopeRefs'],
  finding: ['id', 'capability', 'evidenceRefs', 'disposition', 'gap', 'consumerRefs', 'decisionRefs'],
  unresolved: ['id', 'topic', 'ownerRole', 'scopeRefs', 'blockingReason'],
  priorityInput: ['id', 'scopeRefs', 'preference', 'rank', 'sourceRef'],
  resolutionLink: ['analysisItemId', 'targetRefs', 'resolution', 'reason'],
}
const KEYS = WORK_ANALYSIS_KEYS
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const FEAT = /^FEAT-\d{3,}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const SHA256 = /^[0-9a-f]{64}$/

/** 프로젝트 상대 경로인가 — 절대·상위 탈출·백슬래시·빈 세그먼트를 거부한다. */
export const safeRelativePath = value => typeof value === 'string' && value !== '' && !value.includes('\0')
  && !value.includes('\\') && !value.startsWith('/') && !value.split('/').some(segment => segment === '..' || segment === '')

/** 디렉터리 경계(끝의 `/` 하나 허용) 또는 파일 경로 — 쓰기·읽기 경계에 쓴다. */
export const safeRelativeScope = value => typeof value === 'string' && safeRelativePath(value.endsWith('/') ? value.slice(0, -1) : value)

/** 키 순서와 무관한 정규 JSON의 sha256 — 분석·계획 digest의 유일한 정의. */
export function canonicalDigest(value) {
  const canonical = input => Array.isArray(input) ? input.map(canonical)
    : input && typeof input === 'object'
      ? Object.fromEntries(Object.keys(input).sort().map(key => [key, canonical(input[key])]))
      : input
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}

const rejectUnknown = (value, allowed, label, errors) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  const unknown = Object.keys(value).filter(key => !allowed.includes(key))
  if (unknown.length > 0) errors.push(`${label}: 알 수 없는 키 ${unknown.sort().join(', ')} — 조용히 버리지 않는다`)
}
const list = value => (Array.isArray(value) ? value : [])
const uniqueIds = (items, label, errors) => {
  const ids = new Set()
  for (const item of items) {
    if (!ID.test(String(item?.id ?? ''))) errors.push(`${label}: id가 없거나 형식이 틀렸다 (${JSON.stringify(item?.id)})`)
    else if (ids.has(item.id)) errors.push(`${label}: id ${item.id}가 중복됐다`)
    else ids.add(item.id)
  }
  return ids
}

/**
 * 분석 문서를 검증한다(순수). 파일 실재·코드 지문 대조는 호출자가 `io`로 준다.
 * @param {object} analysis
 * @param {{scopeFeatureIds: string[], io?: {exists?: (path: string) => boolean, digestOf?: (path: string) => string|null}}} context
 * @returns {{errors: string[], warnings: string[], scopeBlocked: string[], ids: object}}
 */
export function validateWorkAnalysis(analysis, {scopeFeatureIds, io = {}}) {
  const errors = []
  const warnings = []
  const scopeBlocked = []
  if (!analysis || typeof analysis !== 'object') return {errors: ['분석 문서가 객체가 아니다'], warnings, scopeBlocked, ids: {}}
  rejectUnknown(analysis, KEYS.document, 'work-analysis', errors)
  if (analysis.schemaVersion !== 1) errors.push('schemaVersion은 1이어야 한다')
  if (!UUID.test(String(analysis.analysisId ?? ''))) errors.push('analysisId는 UUID여야 한다')

  // ── 범위: 선택한 전달 범위의 FEAT **전부**가 목록에 있어야 한다 ──
  const scope = analysis.scope ?? {}
  rejectUnknown(scope, KEYS.scope, 'scope', errors)
  const declared = new Set(list(scope.featureIds))
  const expected = new Set(scopeFeatureIds)
  const missing = [...expected].filter(id => !declared.has(id))
  const foreign = [...declared].filter(id => !expected.has(id))
  if (missing.length > 0) errors.push(`scope.featureIds에 범위의 FEAT가 빠졌다: ${missing.join(', ')} — 우연히 읽힌 몇 개를 전체로 취급하지 않는다`)
  if (foreign.length > 0) errors.push(`scope.featureIds에 계획에 없는 FEAT가 있다: ${foreign.join(', ')}`)
  const dispositions = new Map()
  for (const entry of list(scope.featureDisposition)) {
    rejectUnknown(entry, KEYS.disposition, `featureDisposition ${entry?.featureId}`, errors)
    if (!FEAT.test(String(entry?.featureId ?? ''))) { errors.push(`featureDisposition: featureId 형식 오류 (${entry?.featureId})`); continue }
    if (dispositions.has(entry.featureId)) errors.push(`featureDisposition: ${entry.featureId}가 두 번 분류됐다`)
    dispositions.set(entry.featureId, entry)
    if (!FEATURE_STATUS.includes(entry.status)) errors.push(`featureDisposition ${entry.featureId}: status는 ${FEATURE_STATUS.join('|')}`)
    if (entry.status === 'deferred' && !DEFERRAL_KINDS.includes(entry.deferral)) {
      errors.push(`featureDisposition ${entry.featureId}: 유예는 사유 종류(${DEFERRAL_KINDS.join('|')})가 필요하다 — 후속 상세화와 제품 범위 유예는 다르다`)
    }
    if (entry.status !== 'planned' && !entry.reasonRef) errors.push(`featureDisposition ${entry.featureId}: ${entry.status}에는 reasonRef가 필요하다`)
  }
  for (const id of declared) if (!dispositions.has(id)) errors.push(`featureDisposition에 ${id}의 분류가 없다 — planned/deferred/blocked 중 하나로 남긴다`)
  if (scope.inventoryComplete !== true) {
    scopeBlocked.push(`범위 목록이 완전하지 않다(${list(scope.incompleteReasons).join(' · ') || '사유 미기재'}) — 초안 조사는 되지만 전체 범위 확정·검토는 막는다`)
  }
  if (typeof scope.sourceRevision !== 'string' || scope.sourceRevision === '') errors.push('scope.sourceRevision이 없다 — 어느 커밋의 코드를 읽었는지 모른다')
  if (scope.dirty === true) warnings.push('분석이 dirty 트리에서 작성됐다 — codeEvidence의 파일 지문이 기준선이다')

  // ── 원문 ──
  const sourceRefs = list(analysis.sourceRefs)
  const sourceIds = uniqueIds(sourceRefs, 'sourceRefs', errors)
  const approvedSources = new Set()
  for (const ref of sourceRefs) {
    rejectUnknown(ref, KEYS.sourceRef, `sourceRef ${ref?.id}`, errors)
    if (!SOURCE_INTENTS.includes(ref?.intent)) errors.push(`sourceRef ${ref?.id}: intent는 ${SOURCE_INTENTS.join('|')} — 현재 설명과 목표 설계를 섞지 않는다`)
    if (!SOURCE_DECISION.includes(ref?.decisionStatus)) errors.push(`sourceRef ${ref?.id}: decisionStatus는 ${SOURCE_DECISION.join('|')} — 미표기는 undecided다`)
    if (!ACCESS_STATES.includes(ref?.accessState)) errors.push(`sourceRef ${ref?.id}: accessState는 ${ACCESS_STATES.join('|')}`)
    if (ref?.accessState === 'unreadable' && ref.digest !== undefined) {
      errors.push(`sourceRef ${ref.id}: 읽지 못한 자료에 digest가 있다 — 내용 지문을 지어내지 않는다`)
    }
    if (ref?.digest !== undefined && !SHA256.test(String(ref.digest))) errors.push(`sourceRef ${ref?.id}: digest 형식 오류`)
    if (ref?.snapshotRef !== undefined) {
      if (!safeRelativePath(ref.snapshotRef)) errors.push(`sourceRef ${ref.id}: snapshotRef는 프로젝트 상대 경로여야 한다`)
      else if (io.exists && !io.exists(ref.snapshotRef)) errors.push(`sourceRef ${ref.id}: snapshotRef ${ref.snapshotRef}가 없다`)
    }
    // 읽었다(read)면 원문이 00_source에 보존돼 있어야 한다 — 부분만 읽은 원격 자료(partial)만 locator를 허용한다.
    if (ref?.accessState === 'read' && ref?.snapshotRef === undefined) errors.push(`sourceRef ${ref?.id}: read인데 보존된 원문(snapshotRef)이 없다 — 먼저 00_source에 보존한다`)
    if (ref?.accessState === 'partial' && ref?.snapshotRef === undefined && ref?.locator === undefined) errors.push(`sourceRef ${ref?.id}: partial에는 snapshotRef나 locator가 필요하다`)
    if (ref?.decisionStatus === 'approved') approvedSources.add(ref.id)
  }

  // ── 코드 관찰 · 조사 범위 ──
  const evidence = list(analysis.codeEvidence)
  const evidenceIds = uniqueIds(evidence, 'codeEvidence', errors)
  for (const item of evidence) {
    rejectUnknown(item, KEYS.codeEvidence, `codeEvidence ${item?.id}`, errors)
    if (!safeRelativePath(item?.path)) { errors.push(`codeEvidence ${item?.id}: path는 프로젝트 상대 경로여야 한다`); continue }
    if (!TEST_STATES.includes(item.testState)) errors.push(`codeEvidence ${item.id}: testState는 ${TEST_STATES.join('|')} — 실행하지 않은 테스트는 exists-not-run이다`)
    if (io.exists && !io.exists(item.path)) errors.push(`codeEvidence ${item.id}: ${item.path}가 없다`)
    // 분석 기준선의 지문이 지금과 다르면 그 관찰은 낡았다(T39) — 조용히 재사용하지 않는다.
    if (item.digest !== undefined && io.digestOf) {
      const now = io.digestOf(item.path)
      if (now && now !== item.digest) warnings.push(`codeEvidence ${item.id}: ${item.path}가 분석 뒤 바뀌었다 — 연결된 판정·WORK를 재검토한다(stale)`)
    }
  }
  const coverage = analysis.scanCoverage ?? {}
  rejectUnknown(coverage, KEYS.scanCoverage, 'scanCoverage', errors)
  if (list(coverage.roots).length === 0) errors.push('scanCoverage.roots가 비었다 — 어디를 조사했는지 모르면 「없음」도 말할 수 없다')
  const scanIncomplete = list(coverage.incompleteReasons).length > 0
  if (scanIncomplete) warnings.push(`조사가 완전하지 않다: ${coverage.incompleteReasons.join(' · ')}`)

  // ── 결정 · 판정 · 미결 · 우선순위 ──
  const decisions = list(analysis.decisions)
  const decisionIds = uniqueIds(decisions, 'decisions', errors)
  for (const decision of decisions) {
    rejectUnknown(decision, KEYS.decision, `decision ${decision?.id}`, errors)
    if (!DECISION_STATUS.includes(decision?.status)) errors.push(`decision ${decision?.id}: status는 ${DECISION_STATUS.join('|')}`)
    // 자료를 받았다고 승인된 것이 아니다 — confirmed는 승인된 원문에서만 나온다(T30).
    if (decision?.status === 'confirmed' && !approvedSources.has(decision.authorityRef)) {
      errors.push(`decision ${decision.id}: confirmed인데 근거(authorityRef)가 승인된 원문이 아니다 — 초안·현재 설명은 목표 결정으로 승격하지 않는다`)
    }
  }
  const findings = list(analysis.findings)
  const findingIds = uniqueIds(findings, 'findings', errors)
  for (const finding of findings) {
    rejectUnknown(finding, KEYS.finding, `finding ${finding?.id}`, errors)
    if (!DISPOSITIONS.includes(finding?.disposition)) { errors.push(`finding ${finding?.id}: disposition은 ${DISPOSITIONS.join('|')}`); continue }
    const refs = list(finding.evidenceRefs)
    for (const ref of refs) if (!evidenceIds.has(ref) && !sourceIds.has(ref)) errors.push(`finding ${finding.id}: evidenceRef ${ref}가 codeEvidence·sourceRefs에 없다`)
    if (finding.disposition === 'reuse' && !refs.some(ref => evidenceIds.has(ref))) {
      errors.push(`finding ${finding.id}: reuse인데 코드 관찰 근거가 없다 — 이름만으로 재사용을 판정하지 않는다(T33)`)
    }
    // 「찾지 못함」은 조사한 범위 안의 결과다 — 조사가 절단됐으면 create로 확정하지 않는다(T35).
    if (finding.disposition === 'create' && scanIncomplete) {
      errors.push(`finding ${finding.id}: 조사가 완전하지 않은데 create로 확정했다 — unknown으로 두고 필요한 조사를 표시한다`)
    }
    if (['extend', 'adapt', 'create'].includes(finding.disposition) && !finding.gap) errors.push(`finding ${finding.id}: ${finding.disposition}에는 gap(무엇이 부족한가)이 필요하다`)
    for (const ref of list(finding.decisionRefs)) if (!decisionIds.has(ref)) errors.push(`finding ${finding.id}: decisionRef ${ref}가 없다`)
  }
  const unresolved = list(analysis.unresolved)
  const unresolvedIds = uniqueIds(unresolved, 'unresolved', errors)
  for (const item of unresolved) {
    rejectUnknown(item, KEYS.unresolved, `unresolved ${item?.id}`, errors)
    for (const key of ['topic', 'ownerRole', 'blockingReason']) if (!item?.[key]) errors.push(`unresolved ${item?.id}: ${key}가 없다 — 누가 무엇을 풀면 되는지 적는다`)
  }
  const priorities = list(analysis.priorityInputs)
  const priorityIds = uniqueIds(priorities, 'priorityInputs', errors)
  for (const item of priorities) {
    rejectUnknown(item, KEYS.priorityInput, `priorityInput ${item?.id}`, errors)
    if (!sourceIds.has(item?.sourceRef)) errors.push(`priorityInput ${item?.id}: sourceRef가 원문에 없다 — 우선순위의 출처를 지어내지 않는다`)
    if (item?.rank !== undefined && !(Number.isInteger(item.rank) && item.rank >= 1)) errors.push(`priorityInput ${item.id}: rank는 1 이상의 정수`)
  }
  for (const entry of dispositions.values()) {
    if (entry.reasonRef && ![sourceIds, decisionIds, unresolvedIds].some(ids => ids.has(entry.reasonRef))) {
      errors.push(`featureDisposition ${entry.featureId}: reasonRef ${entry.reasonRef}가 분석에 없다`)
    }
    if (entry.status === 'blocked' && !unresolvedIds.has(entry.reasonRef)) errors.push(`featureDisposition ${entry.featureId}: blocked는 미결(unresolved)을 가리켜야 한다`)
  }

  // ── 반영 연결: 받은 자료·판정이 어디에 쓰였는지 또는 왜 제외됐는지(T41) ──
  const links = new Map()
  const analysisIds = new Set([...sourceIds, ...findingIds, ...decisionIds, ...unresolvedIds, ...priorityIds, ...evidenceIds])
  for (const link of list(analysis.resolutionLinks)) {
    rejectUnknown(link, KEYS.resolutionLink, `resolutionLink ${link?.analysisItemId}`, errors)
    if (!analysisIds.has(link?.analysisItemId)) errors.push(`resolutionLink ${link?.analysisItemId}: 분석에 없는 항목이다(고아 링크)`)
    // 반영처는 WORK(계획이 실재를 대조한다) 또는 분석 항목뿐이다 — 임의 문자열로 반영을 주장하지 않는다.
    for (const target of list(link?.targetRefs)) {
      if (!/^WORK-/.test(String(target)) && !analysisIds.has(target)) errors.push(`resolutionLink ${link.analysisItemId}: 반영처 ${target}는 WORK도 분석 항목도 아니다`)
    }
    if (!RESOLUTIONS.includes(link?.resolution)) errors.push(`resolutionLink ${link?.analysisItemId}: resolution은 ${RESOLUTIONS.join('|')}`)
    if (link?.resolution === 'excluded' && !link.reason) errors.push(`resolutionLink ${link.analysisItemId}: 제외에는 reason이 필요하다`)
    if (link?.resolution === 'consumed' && list(link.targetRefs).length === 0) errors.push(`resolutionLink ${link.analysisItemId}: consumed인데 targetRefs가 비었다`)
    links.set(link?.analysisItemId, link)
  }
  for (const id of [...sourceIds, ...findingIds]) {
    if (!links.has(id)) errors.push(`resolutionLinks에 ${id}가 없다 — 받은 자료·판정은 반영처나 제외 사유를 남긴다`)
  }
  return {errors, warnings, scopeBlocked, ids: {sourceIds, evidenceIds, decisionIds, findingIds, unresolvedIds, priorityIds, links, dispositions}}
}
