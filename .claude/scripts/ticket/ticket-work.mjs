// ticket-work.mjs — 사람이 만든 개발 티켓을 **판정해 WORK로 완성**한다(순수).
//
// 0.27에서 사람이 쓴 개발 티켓의 입구를 닫자, 기획 없이 운영하는 팀은 티켓으로 개발을 시작할 경로가 없었다
// (기획 없이 운영하는 팀의 요청, 2026-09-15). 이 모듈은 그 입구를 다시 열되 게이트를 약하게 하지 않는다:
//   - **판단은 에이전트, 검증은 CLI** — 에이전트가 판정서를 쓰고 여기서 형식·근거·일관성을 잰다(claim P0/P1과 같은 분업)
//   - **지어내지 않는다** — 티켓 출처 완료 조건은 원문에 그 문장이 있어야 하고, AI 제안은 개발자 확인 전에는 기준이 아니다.
//     테스트 항목은 기획 TC(`TC-…`)와 섞이지 않게 `TT-<티켓키>-<n>`로 따로 센다. 기획 없는 프로젝트의 specTier는 그대로다
//   - **계획 WORK와 같은 모양** — 확정된 판정서를 WORK 정의로 옮겨 픽업·편집 대조·링크·머지 관측을 그대로 재사용한다
//   - **원문 보존** — 완성한 본문 맨 아래 「원문」 섹션에 사람 본문을 그대로 두고, 파서는 그 아래를 읽지 않는다
import {createHash} from 'node:crypto'
import {canonicalDigest, safeRelativeScope} from './work-analysis.mjs'
import {pathsOverlap, ROLE} from './work-plan.mjs'
import {buildWorkDoc, formatWorkDoc, normalizeDocItem, ORIGINAL_TITLES} from './work-ticket-doc.mjs'
import {stripWorkMarker} from './work-refs.mjs'
import {normalizeLayerPath} from '../agent-registry.mjs'

const list = value => (Array.isArray(value) ? value : [])

export const TICKET_ASSESSMENTS_DIR = '_workspace/03_dev/ticket-assessments'
export const VERDICTS = ['startable', 'needs-planning', 'needs-design', 'undecidable']
export const LANES = ['fix', 'change']
// `/wh` fix 자기검사(request-type-contract.md)와 같은 다섯 항목 — 하나라도 「예」면 fix가 아니다.
export const SELF_CHECK_IDS = ['new-route', 'new-data-contract', 'new-auth-path', 'new-external-dependency', 'public-contract-change']
const ANSWERS = ['yes', 'no', 'unknown']
const ASSESSMENT_KEYS = ['schemaVersion', 'ticket', 'verdict', 'lane', 'objective', 'roles', 'selfCheck', 'planningNeeds', 'designNeeds',
  'reasons', 'writePaths', 'nonGoals', 'acceptance', 'testItems', 'dependsOn']

/** 판정서 파일 경로(순수). 키는 파일 이름으로 쓸 수 있게만 바꾼다. */
export const assessmentPath = ticketKey => `${TICKET_ASSESSMENTS_DIR}/${String(ticketKey).replace(/[^A-Za-z0-9_-]/g, '_')}.json`
/** 판정할 에이전트가 읽는 격리 스냅샷 — CLI만 쓴다(에이전트 소유 패턴은 `.json`뿐이다). */
export const assessmentSnapshotPath = ticketKey => `${TICKET_ASSESSMENTS_DIR}/${String(ticketKey).replace(/[^A-Za-z0-9_-]/g, '_')}.ticket.md`

/** 티켓에서 결정적으로 만든 UUID 모양 ID(순수) — 쓰기 도중 실패해도 재시도가 같은 ID를 쓴다. */
const derivedUuid = seed => {
  const hex = createHash('sha256').update(seed).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}
export const ticketWorkId = (provider, ticketKey) => `WORK-${derivedUuid(`web-harness:ticket-work:${provider}:${ticketKey}`)}`
export const ticketPlanId = (provider, ticketKey) => derivedUuid(`web-harness:ticket-plan:${provider}:${ticketKey}`)
/** 테스트 항목 ID 접두(순수) — 기획 TC와 다른 공간이다. */
export const testItemPrefix = ticketKey => `TT-${String(ticketKey).replace(/[^A-Za-z0-9]+/g, '-')}-`
export const TEST_ITEM_ID = /\bTT-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*-\d+\b/g

/** 스팩의 소유 경계(순수) — `layerMap` 값들. 없으면 null(경계를 모르면 착수시키지 않는다). */
export function specWritableRoots(spec) {
  const map = spec?.layerMap
  if (!map || typeof map !== 'object') return null
  return Object.values(map).flatMap(value => (Array.isArray(value) ? value : [value])).filter(value => typeof value === 'string' && value)
}

/** 판정서 지문(순수) — 개발자 확인이 결박하는 대상. */
export const assessmentDigest = assessment => canonicalDigest(assessment)

/** 원문 추출(순수). 이미 완성한 본문이면 「원문」 섹션만, 아니면 사람 본문 전체(기계 마커 제외). */
export function originalBodyOf(body, {completed = /<!-- web-harness:work\b/.test(String(body ?? ''))} = {}) {
  const text = stripWorkMarker(String(body ?? ''))
  // **하네스가 완성한 본문일 때만** 「원문」 제목에서 자른다 — 사람이 처음 쓴 본문에 같은 제목이 있으면 앞부분이 사라진다.
  if (!completed) return text.trim()
  const lines = text.split(/\r?\n/)
  const index = lines.findIndex(line => ORIGINAL_TITLES.some(title => new RegExp(`^\\s*(?:#{1,6}\\s+|h[1-6]\\.\\s+)${title}\\s*#*\\s*$`).test(line)))
  return index < 0 ? text.trim() : lines.slice(index + 1).join('\n').trim()
}

/**
 * 판정서 검증(순수).
 * @param {{assessment: object, ticketKey: string, provider: string, originalBody: string, spec: object|null,
 *          activeWorks: {workId: string, writePaths: string[]}[], knownWorkIds?: Set<string>}} args
 *   activeWorks: 발행됐고 머지로 끝나지 않은 다른 작업(계획·티켓) — 수정 범위가 겹치면 착수시키지 않는다
 * @returns {{ok: boolean, errors: string[], verdict: string|null, digest: string|null, bounce?: object}}
 */
export function validateTicketAssessment({assessment, ticketKey, provider, originalBody, spec, activeWorks = [], knownWorkIds = new Set()}) {
  const errors = []
  const a = assessment
  if (!a || typeof a !== 'object' || Array.isArray(a)) return {ok: false, errors: ['판정서가 객체가 아니다'], verdict: null, digest: null}
  const unknownKeys = Object.keys(a).filter(key => !ASSESSMENT_KEYS.includes(key))
  if (unknownKeys.length > 0) errors.push(`판정서에 알 수 없는 키: ${unknownKeys.join(', ')}`)
  if (a.schemaVersion !== 1) errors.push('schemaVersion은 1이어야 한다')
  if (String(a.ticket?.key) !== String(ticketKey)) errors.push(`판정서의 ticket.key(${a.ticket?.key})가 이 티켓(${ticketKey})이 아니다`)
  if (a.ticket?.provider !== provider) errors.push(`판정서의 ticket.provider(${a.ticket?.provider})가 지금 트래커(${provider})가 아니다`)
  if (!VERDICTS.includes(a.verdict)) errors.push(`verdict는 ${VERDICTS.join('|')}`)

  // 자기검사는 **다섯 항목 전부**, 항목마다 근거가 있어야 한다 — 빠진 항목을 「아니오」로 읽지 않는다.
  const checks = new Map(list(a.selfCheck).map(item => [item?.id, item]))
  for (const id of SELF_CHECK_IDS) {
    const item = checks.get(id)
    if (!item) { errors.push(`selfCheck에 ${id}가 없다 — 빠진 항목을 「아니오」로 읽지 않는다`); continue }
    if (!ANSWERS.includes(item.answer)) errors.push(`selfCheck ${id}의 answer는 ${ANSWERS.join('|')}`)
    if (list(item.evidence).filter(value => typeof value === 'string' && value.trim()).length === 0) errors.push(`selfCheck ${id}에 근거(evidence)가 없다`)
  }
  const answer = id => checks.get(id)?.answer

  if (a.verdict === 'needs-planning' && list(a.planningNeeds).filter(item => item?.what && item?.why).length === 0) {
    errors.push('needs-planning이면 planningNeeds(what·why)가 하나 이상이어야 한다 — 무엇을 정해야 하는지 없이는 요청할 수 없다')
  }
  if (a.verdict === 'needs-design' && list(a.designNeeds).filter(item => item?.what && item?.why).length === 0) {
    errors.push('needs-design이면 designNeeds(what·why)가 하나 이상이어야 한다')
  }
  if (a.verdict === 'undecidable' && list(a.reasons).filter(value => typeof value === 'string' && value.trim()).length === 0) {
    errors.push('undecidable이면 reasons가 하나 이상이어야 한다')
  }

  let bounce = null
  if (a.verdict === 'startable') {
    if (!LANES.includes(a.lane)) errors.push(`착수 가능이면 lane은 ${LANES.join('|')}`)
    const unknown = SELF_CHECK_IDS.filter(id => answer(id) === 'unknown')
    if (unknown.length > 0) errors.push(`자기검사에 「모름」이 있으면 착수 가능이 아니다: ${unknown.join(', ')} — undecidable로 둔다`)
    if (a.lane === 'fix') {
      const yes = SELF_CHECK_IDS.filter(id => answer(id) === 'yes')
      if (yes.length > 0) errors.push(`fix인데 자기검사에 「예」가 있다: ${yes.join(', ')} — change로 승격한다(재량이 아니다)`)
    }
    // 새 화면·route는 모양이 정해져야 한다 — 티켓만으로 착수시키지 않는다(결정 3).
    if (answer('new-route') === 'yes') errors.push('새 route·화면이면 착수 가능이 아니다 — needs-design으로 둔다')
    if (list(a.planningNeeds).length > 0 || list(a.designNeeds).some(item => item?.blocking !== false)) {
      errors.push('착수 가능인데 막는 기획·디자인 필요가 남아 있다 — verdict를 고치거나 비차단(blocking:false) 부채로 적는다')
    }
    if (typeof a.objective !== 'string' || !a.objective.trim()) errors.push('objective가 없다 — 이 작업이 무엇을 이루는지 한 문장')
    if (!Array.isArray(a.roles) || a.roles.length === 0 || a.roles.some(role => !ROLE.test(String(role)))) {
      errors.push('roles는 소문자 식별자(fe·be …) 하나 이상 — 트래커 라벨로 쓰인다')
    }
    // 수정 범위: 프로젝트 상대 경로 + **스팩 소유 경계 안**. 스팩이 없으면 경계를 모른다.
    const roots = specWritableRoots(spec)
    const writePaths = list(a.writePaths)
    if (writePaths.length === 0) errors.push('writePaths가 비었다 — 어디까지 고칠지 모르면 착수시키지 않는다')
    for (const path of writePaths) {
      if (!safeRelativeScope(path)) errors.push(`writePaths의 ${JSON.stringify(path)}는 프로젝트 상대 경로가 아니다`)
    }
    if (roots === null) errors.push('스팩(layerMap)이 없어 소유 경계를 모른다 — 스팩을 확정한 뒤 판정한다(undecidable)')
    else {
      // 경로 모양(`./`·글롭 꼬리·파일/디렉터리)은 소유권 훅과 **같은 정규화**로 읽는다 — 따로 구현하면 「판정은 통과, 훅은 거부」가 난다.
      // 다만 앱 접두(모노레포 `apps/x/`)는 붙이지 않는다 — 판정서의 수정 범위는 스팩과 같은 기준 경로로 적는다.
      const shape = path => normalizeLayerPath(String(path).replace(/\/\*{1,2}$/, '/'))
      const covers = (root, path) => (root.endsWith('/') ? path.startsWith(root) : path === root)
      const outside = writePaths.filter(path => !roots.some(root => covers(shape(root), shape(path))))
      if (outside.length > 0) errors.push(`writePaths가 스팩 소유 경계 밖이다: ${outside.join(', ')}`)
    }
    // 완료 조건: 티켓 출처는 원문에 그 문장이 있어야 한다 — 판정서가 조건을 지어내지 못한다.
    const original = normalizeDocItem(originalBody).toLowerCase()
    const acceptance = list(a.acceptance)
    if (acceptance.length === 0) errors.push('acceptance가 비었다 — 무엇으로 끝났다고 할지 없다')
    for (const item of acceptance) {
      if (!['ticket', 'proposed'].includes(item?.source)) errors.push('acceptance.source는 ticket|proposed')
      if (typeof item?.text !== 'string' || !item.text.trim()) { errors.push('acceptance.text가 없다'); continue }
      if (item.source === 'ticket' && !original.includes(normalizeDocItem(item.text).toLowerCase())) {
        errors.push(`티켓 출처라는 완료 조건이 원문에 없다: ${JSON.stringify(item.text)} — 제안이면 source:proposed로 적는다`)
      }
    }
    const prefix = testItemPrefix(ticketKey)
    const items = list(a.testItems)
    items.forEach((item, index) => {
      if (item?.id !== `${prefix}${index + 1}`) errors.push(`testItems[${index}].id는 ${prefix}${index + 1}이어야 한다 — 기획 TC와 다른 공간이고 순번이다`)
      if (typeof item?.text !== 'string' || !item.text.trim()) errors.push(`testItems[${index}].text가 없다`)
      if (!['ticket', 'proposed'].includes(item?.source)) errors.push(`testItems[${index}].source는 ticket|proposed`)
    })
    if (a.lane === 'change' && items.length === 0) errors.push('change면 testItems가 하나 이상이어야 한다 — 새 동작을 무엇으로 확인할지')
    if (!Array.isArray(a.dependsOn)) errors.push('dependsOn이 없다 — 없으면 []로 명시한다(미선언은 「의존 없음」이 아니다)')
    for (const dep of list(a.dependsOn)) if (!knownWorkIds.has(dep)) errors.push(`dependsOn ${dep}가 원장·계획에 없는 작업이다`)
    // 진행 중인 다른 작업과 수정 범위가 겹치면 착수시키지 않는다 — 계획 WORK의 경계를 사람 티켓이 가로지르지 않게.
    const overlaps = activeWorks.filter(work => pathsOverlap(list(work.writePaths), writePaths))
    if (errors.length === 0 && overlaps.length > 0) {
      bounce = {reason: 'ticket-overlaps-active-work', overlaps: overlaps.map(work => ({workId: work.workId, writePaths: work.writePaths}))}
    }
  }
  const ok = errors.length === 0
  return {ok, errors, verdict: ok ? a.verdict : null, digest: ok ? assessmentDigest(a) : null, ...(bounce ? {bounce} : {})}
}

/**
 * 확정된 판정서 → WORK 정의(순수). 완료 조건은 check로 옮긴다(대상 = 수정 범위 — 픽업 뒤 바뀌었는가를 잰다),
 * 테스트 항목은 TC 자리에 둔다(링크가 테스트 코드 인용을 잰다).
 */
export function ticketWorkDefinition({assessment, ticketKey, provider, title}) {
  const workId = ticketWorkId(provider, ticketKey)
  return {
    workId, title: title || String(ticketKey), kind: 'implementation', origin: 'ticket', lane: assessment.lane,
    roles: list(assessment.roles), objective: assessment.objective, nonGoals: list(assessment.nonGoals),
    dependsOn: list(assessment.dependsOn), readPaths: [], writePaths: list(assessment.writePaths), contractRefs: [],
    checks: list(assessment.acceptance).map((item, index) => ({checkId: `ACC-${index + 1}`, kind: 'acceptance', expectedOutcome: item.text,
      targetRefs: list(assessment.writePaths), source: item.source})),
    testCases: list(assessment.testItems).map(item => ({id: item.id, text: item.text, source: item.source})),
    designDebt: list(assessment.designNeeds).filter(item => item?.blocking === false),
    lifecycle: 'active',
  }
}

/** 티켓 작업의 가상 계획(순수) — 픽업·링크·편집 대조가 계획 WORK와 같은 코드를 탄다. */
export function ticketVirtualPlan(definition, planId) {
  return {planId, workItems: [definition],
    featureBindings: [{featureId: null, requiredWorkIds: [], acceptanceOwners: definition.testCases.map(item => ({testCaseId: item.id, workId: definition.workId}))}]}
}

/** 완성한 본문(순수) — WORK 문서 섹션 + 맨 아래 「원문」(사람 본문 그대로). 서식은 트래커가 정한다. */
export function renderTicketWorkBody({definition, originalBody, format = 'markdown', lang = 'ko', contextName = null, dependsOn = []}) {
  const doc = buildWorkDoc({work: definition, testCases: definition.testCases, dependsOn, contextName, lang})
  const heading = format === 'jira-wiki' ? `h3. ${ORIGINAL_TITLES[lang === 'en' ? 1 : 0]}` : `### ${ORIGINAL_TITLES[lang === 'en' ? 1 : 0]}`
  return `${formatWorkDoc(doc, format)}\n\n${heading}\n${String(originalBody ?? '').trim() || (lang === 'en' ? '(empty)' : '(비어 있음)')}`
}

