// design-binding-lib.mjs — **이 기획 단위의 이 조건은 어느 디자인 근거를 갖는가.**
//
// 배경: 공급된 시안·Figma 노드는 `00_source/`에 스냅샷으로 남고, 시각 검증은
// `visual-qa-contract.json`의 `targets[].referenceId`로 근거를 묶는다. 두 끝은 있는데
// **가운데가 산문이었다** — 어느 프레임이 어느 PAGE의 어느 조건인지가 `## Source Trace`
// 문장에만 있어 기계가 승계하지 못했다. 그래서 조건 분기(권한 없음·빈 상태·모바일)는
// 구현 단계에서 즉흥으로 결정됐다.
//
// 이 파일이 고정하는 것은 하나다: **사람이 한 번 선언하고 기계가 승계한다.**
//   - `declaredBy` 어휘에 `inferred`가 없다 — 이름 유사도로 묶은 결과를 적을 자리가 없다(I1).
//     추론은 `gap-report.md`의 후보 제시까지이고, `bindings[]` 행이 되려면 사람을 거친다.
//   - `figma-node`에 `sha256`을 금지한다 — 이 경로에는 해시를 낼 수단이 없고(ingestor에
//     Bash가 없다), 계산하지 않은 해시를 적는 것은 위조다. 스키마가 그 칸을 문법으로 막는다.
//     로컬 원본(`image`·`specification`)은 반대로 **적으면 실물과 대조한다**. 필수로 두었다가
//     적대 리뷰(2026-09-03)에서 되돌렸다 — 쓰는 주체(ingestor)에 해시 계산 수단이 없는데
//     필수로 만들면 그 칸은 **지어내야만 채워진다.** 못 내는 값을 요구하는 것이 위조의 유인이다.
//   - 같은 `(pageGroup, condition)`이 두 번 나오면 거부한다 — 조건 병존(둘 다 정본)과
//     택일(하나만 정본)이 한 배열에 섞이는 것을 막는다. 택일은 design-approval의 승인 절차다.
//
// **범위(정직)**: 이 검사는 *선언이 있었고 끝까지 이어졌는가*를 본다. 선언이 **옳은가**는
// 보지 못한다 — PAGE-002에 엉뚱한 프레임을 적어도 여기서는 통과한다. 그 판정은 승인
// 체크포인트의 사람 몫이며 `docs/protected-core.md` §4에 프록시로 등록한다.
//
// 조건 커버리지(기획이 선언한 조건 중 근거 없는 것)는 지금 **정보성 보고**다. 분모인
// ux-brief 「화면별 정보 위계」 표의 상태 칸이 비어 있어도 통과하기 때문이며, 그 칸을
// 강제하는 것은 plan-reviewer 강화(후속 커밋)의 몫이다. 분모가 서기 전에 게이트로 올리면
// 조건을 **안 적는 것이 통과하는 길**이 된다(I5).
import {existsSync} from 'node:fs'
import {join} from 'node:path'
import {readProjectRegularFile} from './safe-project-file-lib.mjs'
import {sha256} from './evidence-lib.mjs'

export const DESIGN_BINDING_PATH = '_workspace/00_source/design-binding.json'

// 스키마와 짝을 이루는 수기 미러(무의존 저장소 — ajv를 돌리지 않는다).
// 값이 갈라지면 validate-schema-parity가 잡는다.
export const REFERENCE_KINDS = ['figma-node', 'image', 'specification']
export const DECLARED_BY = ['user', 'carried']
const ID = /^[a-z0-9][a-z0-9-]*$/
const PAGE_GROUP = /^PAGE-[0-9]{3,}$/
const SHA256 = /^[0-9a-f]{64}$/
const RESOLUTION = /^(?:derive|pending|reuse:[a-z0-9][a-z0-9-]*)$/
// figma-node의 locator는 **node ID**다. 형식을 안 보면 스냅샷 경로를 여기에 덮어써도 통과하고,
// 그러면 원격 근거의 식별자가 사라진다(교차 모델 리뷰 2026-09-03). URL 표기(`412-9037`)와
// 앱 표기(`412:9037`)를 모두 받고 `node-id=` 접두는 선택이다.
const FIGMA_NODE_ID = /^(?:node-id=)?[0-9]+[:-][0-9]+$/
const CONDITION_KEYS = ['state', 'modeId', 'variant']
const LOCAL_KINDS = ['image', 'specification']
const REFERENCE_KEYS = ['id', 'kind', 'locator', 'capturedAt', 'snapshot', 'sha256']
const BINDING_KEYS = ['pageGroup', 'condition', 'referenceIds', 'resolution', 'declaredBy', 'declaredAt', 'note']
const DOCUMENT_KEYS = ['schemaVersion', 'references', 'bindings', 'unbound']
const UNBOUND_KEYS = ['references', 'pageGroups']
const safeRelativePath = value =>
  typeof value === 'string' &&
  !value.includes('\0') &&
  !value.includes('\\') &&
  !value.startsWith('/') &&
  !value.split('/').some(segment => !segment || segment === '..')

// 조건의 정규 키. 같은 조건을 키 순서만 바꿔 두 번 적는 우회를 막는다.
// **구분자로 잇지 않는다** — `{state: 'a&variant=b'}`와 `{state:'a', variant:'b'}`가 같은 키가 되어
// 서로 다른 유효 조건이 중복으로 거부됐다(교차 모델 리뷰 2026-09-03). JSON이 이스케이프한다.
export const conditionKey = condition =>
  JSON.stringify(CONDITION_KEYS.filter(key => condition?.[key] !== undefined).map(key => [key, condition[key]]))

// 사람이 읽는 표기. 판정에 쓰지 않는다 — 위 충돌이 여기서는 무해하다.
export const conditionLabel = condition =>
  CONDITION_KEYS.filter(key => condition?.[key] !== undefined).map(key => `${key}=${condition[key]}`).join('&')

// 정규식은 인자를 문자열로 강제한다 — `ID.test(7)`은 참이다. 타입을 함께 본다.
const matches = (pattern, value) => typeof value === 'string' && pattern.test(value)

const isIsoInstant = value => typeof value === 'string' && value !== '' && Number.isFinite(Date.parse(value))

// 스키마는 네 수준에서 `additionalProperties: false`인데 수기 미러가 그것을 안 보면 미지 키가
// **조용히 버려진다.** 이 저장소가 `testLayers`에서 이미 물린 클래스이며 그때의 해법(loud reject)을
// 그대로 쓴다 — 오타 하나가 조건 하나를 통째로 없애는 자리다(`condition.varient`).
const rejectUnknownKeys = (value, allowed, label, push) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  const unknown = Object.keys(value).filter(key => !allowed.includes(key))
  if (unknown.length > 0) push(`${label}: 알 수 없는 키 ${unknown.sort().join(', ')} — 조용히 버리지 않는다`)
}

/** 문서 자체의 유효성. 파일 읽기와 무관한 순수 함수다. */
export const validateDesignBinding = document => {
  const errors = []
  const push = message => errors.push(`${DESIGN_BINDING_PATH}: ${message}`)
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    push('문서는 객체여야 한다')
    return {errors, referenceIds: new Set(), boundPageGroups: new Set(), coverage: null}
  }
  if (document.schemaVersion !== 1) push('schemaVersion은 1이어야 한다')
  rejectUnknownKeys(document, DOCUMENT_KEYS, '문서', push)
  rejectUnknownKeys(document.unbound, UNBOUND_KEYS, 'unbound', push)

  const references = Array.isArray(document.references) ? document.references : (push('references는 배열이어야 한다'), [])
  const bindings = Array.isArray(document.bindings) ? document.bindings : (push('bindings는 배열이어야 한다'), [])
  const unbound = document.unbound
  if (!unbound || typeof unbound !== 'object' || Array.isArray(unbound) ||
      !Array.isArray(unbound.references) || !Array.isArray(unbound.pageGroups)) {
    push('unbound.references와 unbound.pageGroups는 배열로 반드시 있어야 한다 — 비어 있음과 적지 않음은 다르다')
  }

  const referenceIds = new Set()
  for (const reference of references) {
    const id = reference?.id
    if (!matches(ID, id)) { push(`reference id가 유효하지 않다: ${String(id)}`); continue }
    if (referenceIds.has(id)) push(`reference id가 중복이다: ${id}`)
    referenceIds.add(id)
    rejectUnknownKeys(reference, REFERENCE_KEYS, `reference ${id}`, push)
    if (!REFERENCE_KINDS.includes(reference?.kind)) push(`reference ${id}: kind는 ${REFERENCE_KINDS.join('|')} 중 하나여야 한다`)
    if (typeof reference?.locator !== 'string' || reference.locator === '') push(`reference ${id}: locator가 없다`)
    if (!isIsoInstant(reference?.capturedAt)) push(`reference ${id}: capturedAt이 없거나 시각이 아니다 — figma-node는 해시가 없어 이것이 재현성의 정본이다`)
    if (reference?.kind === 'figma-node') {
      if (!matches(FIGMA_NODE_ID, reference?.locator)) push(`reference ${id}: figma-node의 locator는 node ID여야 한다(예 node-id=412:9037) — 파일 URL이나 스냅샷 경로를 여기 적으면 원격 근거의 식별자가 사라진다`)
      if (!safeRelativePath(reference?.snapshot)) push(`reference ${id}: figma-node는 프로젝트 상대 경로의 텍스트 스냅샷이 필요하다 — 추적성의 정본은 원격 URL이 아니다`)
      if (reference?.sha256 !== undefined) push(`reference ${id}: figma-node에 sha256을 적을 수 없다 — 이 경로에는 해시를 계산할 수단이 없고 계산하지 않은 해시는 위조다`)
    } else if (LOCAL_KINDS.includes(reference?.kind)) {
      // 로컬 원본은 locator가 곧 실물이다 — 경로가 정본이고 해시는 그 위의 보강이다.
      if (!safeRelativePath(reference?.locator)) push(`reference ${id}: ${reference.kind}의 locator는 프로젝트 상대 경로여야 한다 — 실물과 대조할 수 없으면 기록이 자기보고가 된다`)
      if (reference?.sha256 !== undefined && !matches(SHA256, reference.sha256)) push(`reference ${id}: sha256 형식이 아니다`)
      // 스냅샷은 원격 노드를 로컬에 고정하는 장치다. 원본이 이미 로컬이면 locator가 그 일을
      // 하므로 사본을 하나 더 두면 어느 것이 정본인지 갈린다(스키마도 같은 이유로 금지한다).
      if (reference?.snapshot !== undefined) push(`reference ${id}: ${reference.kind}에는 snapshot을 적지 않는다 — 로컬 원본의 정본은 locator다`)
    }
  }

  const seenConditions = new Set()
  const boundPageGroups = new Set()
  const usedReferenceIds = new Set()
  const resolutions = {derive: 0, pending: 0, reuse: 0, supplied: 0}
  for (const binding of bindings) {
    const label = `${String(binding?.pageGroup)}[${conditionLabel(binding?.condition) || '조건 없음'}]`
    rejectUnknownKeys(binding, BINDING_KEYS, `binding ${label}`, push)
    if (!matches(PAGE_GROUP, binding?.pageGroup)) push(`binding ${label}: pageGroup은 PAGE-NNN이어야 한다`)
    const condition = binding?.condition
    if (!condition || typeof condition !== 'object' || Array.isArray(condition)) {
      push(`binding ${label}: condition이 객체가 아니다`)
    } else {
      const keys = Object.keys(condition)
      if (keys.length === 0) push(`binding ${label}: condition은 state·modeId·variant 중 최소 하나를 가져야 한다`)
      for (const key of keys) {
        if (!CONDITION_KEYS.includes(key)) push(`binding ${label}: 알 수 없는 조건 키 ${key}`)
        else if (typeof condition[key] !== 'string' || condition[key] === '') push(`binding ${label}: 조건 ${key}가 비었다`)
        else if (key === 'modeId' && !matches(ID, condition[key])) push(`binding ${label}: modeId는 visual-qa modes[].id와 같은 형식이어야 한다`)
      }
      const key = `${binding?.pageGroup} ${conditionKey(condition)}`
      if (seenConditions.has(key)) {
        push(`binding ${label}: 같은 PAGE의 같은 조건이 두 번 선언됐다 — 조건이 같은데 근거가 둘이면 그것은 병존이 아니라 택일이고, 택일은 design-approval-contract의 승인 절차가 소유한다`)
      }
      seenConditions.add(key)
    }
    if (matches(PAGE_GROUP, binding?.pageGroup)) boundPageGroups.add(binding.pageGroup)
    if (!DECLARED_BY.includes(binding?.declaredBy)) push(`binding ${label}: declaredBy는 ${DECLARED_BY.join('|')}여야 한다 — 추론 결과를 적을 어휘는 없다`)
    if (binding?.note !== undefined && typeof binding.note !== 'string') push(`binding ${label}: note는 문자열이어야 한다`)
    if (!isIsoInstant(binding?.declaredAt)) push(`binding ${label}: declaredAt이 없거나 시각이 아니다`)

    const ids = Array.isArray(binding?.referenceIds) ? binding.referenceIds : (push(`binding ${label}: referenceIds는 배열이어야 한다`), [])
    for (const id of ids) {
      if (!referenceIds.has(id)) push(`binding ${label}: 알 수 없는 referenceId ${String(id)}`)
      usedReferenceIds.add(id)
    }
    if (ids.length === 0) {
      const resolution = binding?.resolution
      if (!matches(RESOLUTION, resolution)) {
        push(`binding ${label}: 근거가 없는 조건은 resolution(derive|pending|reuse:<referenceId>)을 명시해야 한다 — 빈 칸은 결정이 아니다`)
      } else if (resolution.startsWith('reuse:')) {
        const target = resolution.slice('reuse:'.length)
        if (!referenceIds.has(target)) push(`binding ${label}: reuse가 알 수 없는 referenceId ${target}를 가리킨다`)
        resolutions.reuse += 1
      } else {
        resolutions[resolution] += 1
      }
    } else {
      if (binding?.resolution !== undefined) push(`binding ${label}: 근거가 있는 조건에는 resolution을 적지 않는다`)
      resolutions.supplied += 1
    }
  }

  // `unbound.references`는 파생 가능한 값이지만 선언하게 한다. 계산해서 채우면
  // "알고도 안 붙였다"와 "빠뜨렸다"가 같은 모양이 된다. 어긋나면 거부한다.
  if (Array.isArray(unbound?.references)) {
    for (const id of unbound.references) {
      // 타입을 함께 본다 — 정규식은 숫자를 문자열로 강제해 `7`을 통과시킨다.
      if (!matches(ID, id)) push(`unbound.references 항목이 reference id 형식이 아니다: ${String(id)}`)
    }
    const declared = new Set(unbound.references)
    const actual = [...referenceIds].filter(id => !usedReferenceIds.has(id))
    const missing = actual.filter(id => !declared.has(id))
    const extra = [...declared].filter(id => !referenceIds.has(id) || usedReferenceIds.has(id))
    if (missing.length > 0) push(`unbound.references에 빠진 미바인딩 근거: ${missing.sort().join(', ')}`)
    if (extra.length > 0) push(`unbound.references가 실제로는 바인딩된(또는 없는) 근거를 가리킨다: ${extra.sort().join(', ')}`)
  }
  for (const pageGroup of Array.isArray(unbound?.pageGroups) ? unbound.pageGroups : []) {
    if (!matches(PAGE_GROUP, pageGroup)) push(`unbound.pageGroups 항목이 PAGE-NNN이 아니다: ${String(pageGroup)}`)
    if (boundPageGroups.has(pageGroup)) push(`unbound.pageGroups가 이미 바인딩된 ${pageGroup}을 가리킨다`)
  }

  return {
    errors: [...new Set(errors)].sort(),
    referenceIds,
    boundPageGroups,
    coverage: {
      references: referenceIds.size,
      bindings: bindings.length,
      pageGroups: boundPageGroups.size,
      resolutions,
      unboundReferences: Array.isArray(unbound?.references) ? unbound.references.length : null,
      unboundPageGroups: Array.isArray(unbound?.pageGroups) ? unbound.pageGroups.length : null,
    },
  }
}

/** 프로젝트에서 읽는다. 파일이 없으면 present:false — 디자인 generated·absent의 정상 상태다. */
export const collectDesignBinding = projectRoot => {
  if (!existsSync(join(projectRoot, DESIGN_BINDING_PATH))) {
    return {present: false, errors: [], document: null, coverage: null, referenceIds: new Set(), boundPageGroups: new Set()}
  }
  let document
  try {
    document = JSON.parse(readProjectRegularFile(projectRoot, DESIGN_BINDING_PATH, {maxBytes: 2 * 1024 * 1024}).toString('utf8'))
  } catch (error) {
    return {
      present: true,
      errors: [`${DESIGN_BINDING_PATH}: ${error instanceof Error ? error.message : String(error)}`],
      document: null, coverage: null, referenceIds: new Set(), boundPageGroups: new Set(),
    }
  }
  const result = validateDesignBinding(document)
  return {present: true, document, ...result, errors: [...result.errors, ...verifyReferenceFiles(projectRoot, document)]}
}

// **적은 경로는 실재해야 한다.** 문자열 존재만 보면 없는 스냅샷·없는 시안이 통과하고, 그러면
// 이 계약이 "추적성의 정본"이라 부르는 것이 이름뿐인 값이 된다. 두 종류를 같은 규칙으로 본다:
//   - `figma-node`의 `snapshot` — 해시가 없으므로 이 파일이 재현성의 전부다. 없으면 근거가 없다.
//   - `image`·`specification`의 `locator` — 실물이 정본이고, `sha256`은 적혔을 때만 대조한다
//     (없는 것은 허용한다 — 쓰는 주체에 계산 수단이 없을 수 있다).
export const verifyReferenceFiles = (projectRoot, document) => {
  const errors = []
  for (const reference of Array.isArray(document?.references) ? document.references : []) {
    const path = reference?.kind === 'figma-node' ? reference?.snapshot
      : LOCAL_KINDS.includes(reference?.kind) ? reference?.locator : null
    if (path === null || !safeRelativePath(path)) continue
    let source
    try {
      source = readProjectRegularFile(projectRoot, path, {maxBytes: 64 * 1024 * 1024})
    } catch (error) {
      errors.push(`${path}: 디자인 근거를 읽을 수 없다: ${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    if (reference.sha256 !== undefined && sha256(source) !== reference.sha256) {
      errors.push(`${path}: 적힌 sha256이 실물과 다르다 — 계산하지 않은 해시이거나 원본이 바뀌었다`)
    }
  }
  return errors
}

// 두 파일이 같은 id를 쓰면 같은 것을 가리켜야 한다. 부분집합을 요구하지 않는다 —
// visual-qa는 critical/brand/layout-risk target만 고르므로(render-matrix: 전체 조합 금지)
// 공급된 근거 전부가 시각 검증에 오르는 것이 정상이 아니다. 그러나 같은 이름이 서로 다른
// 것을 가리키면 정본이 둘이 되고, 그것은 어느 쪽도 근거가 아니게 된다.
export const crossCheckVisualReferences = (bindingDocument, visualReferences) => {
  const errors = []
  const byId = new Map()
  for (const reference of Array.isArray(visualReferences) ? visualReferences : []) {
    if (typeof reference?.id === 'string') byId.set(reference.id, reference)
  }
  for (const reference of Array.isArray(bindingDocument?.references) ? bindingDocument.references : []) {
    const counterpart = byId.get(reference?.id)
    if (counterpart === undefined) continue
    if (counterpart.kind !== reference.kind || counterpart.locator !== reference.locator) {
      errors.push(`${DESIGN_BINDING_PATH}: reference ${reference.id}가 visual-qa-contract의 같은 id와 다른 것을 가리킨다 (${reference.kind}:${reference.locator} vs ${String(counterpart.kind)}:${String(counterpart.locator)})`)
    }
  }
  return errors
}
