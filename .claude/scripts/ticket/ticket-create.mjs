// ticket-create.mjs — 기획 없이 기능만 구현하는 **개발 티켓**을 초안에서 만든다(순수).
//
// 손으로 만든 개발 티켓과 **같은 것**을 만든다 — 네 절 양식(목적·작업 내용·완료 조건·선행·협의, 선택 절 수정 범위·하지 않는 것), 팀이 선언한
// 개발 티켓 분류(Jira 컴포넌트 · GitHub 라벨), WORK 마커 없음. 그래서 생성 뒤에는 손 티켓과 똑같이 `pickup`이 판정한다.
// 초안은 에이전트나 사람이 쓰고, 여기서는 형식과 중복만 잰다 — 착수할 수 있는지는 판정의 몫이다.
import {DEV_TICKET} from './intake.mjs'
import {scanUntrustedBody} from './pickup.mjs'

const list = value => (Array.isArray(value) ? value : [])

/** 개발 티켓 양식의 절 — 손 티켓과 하네스 티켓이 같은 양식이다. */
export const TICKET_SECTIONS = [
  {id: 'purpose', title: '목적'},
  {id: 'work', title: '작업 내용'},
  {id: 'acceptance', title: '완료 조건'},
  {id: 'coordination', title: '선행·협의'},
]
// 선택 절 — 손 티켓이 경로와 비목표를 따로 떼어 쓰는 형식을 그대로 받는다. 판정서의 `writePaths`·`nonGoals`와 같은 것이다.
export const OPTIONAL_TICKET_SECTIONS = [
  {id: 'scope', title: '수정 범위'},
  {id: 'nonGoals', title: '하지 않는 것'},
]
// 본문 순서 — 목적 → 수정 범위 → 작업 내용 → 하지 않는 것 → 완료 조건 → 선행·협의. 선택 절은 있을 때만 싣는다.
const BODY_ORDER = ['purpose', 'scope', 'work', 'nonGoals', 'acceptance', 'coordination']
const SECTION_BY_TITLE = new Map([...TICKET_SECTIONS, ...OPTIONAL_TICKET_SECTIONS].map(section => [section.title.replace(/\s+/g, ''), section.id]))
const TITLE_OF = new Map([...TICKET_SECTIONS, ...OPTIONAL_TICKET_SECTIONS].map(section => [section.id, section.title]))
// 기획 요구사항(FEAT/TC)은 계획이 발행하는 WORK의 몫이다 — 개발 티켓이 그 ID를 달면 두 모델이 섞인다.
const PLAN_ID = /\b(?:FEAT|TC)-\d+(?:-\d+)?\b/
const LIST_ITEM = /^\s*[-*]\s+\S/

/**
 * 초안 markdown → 티켓 초안들(순수). `## 제목`이 티켓 하나, 그 아래 `### 절`이 네 절(과 선택 절)이다.
 * 첫 `##` 앞의 글은 무시한다(설명·메모 자리).
 */
export function parseTicketDrafts(markdown) {
  const drafts = []
  let current = null
  let section = null
  for (const line of String(markdown ?? '').split(/\r?\n/)) {
    const ticket = line.match(/^##\s+(.+?)\s*$/)
    if (ticket && !line.startsWith('###')) {
      current = {title: ticket[1].trim(), sections: {}, unknownSections: []}
      drafts.push(current)
      section = null
      continue
    }
    const heading = line.match(/^###\s+(.+?)\s*$/)
    if (heading && current) {
      const id = SECTION_BY_TITLE.get(heading[1].replace(/\s+/g, ''))
      if (id) { section = id; current.sections[id] = current.sections[id] ?? [] } else { section = null; current.unknownSections.push(heading[1].trim()) }
      continue
    }
    if (current && section) current.sections[section].push(line)
  }
  return drafts.map(draft => ({title: draft.title, unknownSections: draft.unknownSections,
    sections: Object.fromEntries(Object.entries(draft.sections).map(([id, lines]) => [id, trimBlock(lines)]))}))
}
const trimBlock = lines => {
  const copy = [...lines]
  while (copy.length > 0 && !copy[0].trim()) copy.shift()
  while (copy.length > 0 && !copy[copy.length - 1].trim()) copy.pop()
  return copy.join('\n')
}

/**
 * 초안 검증(순수). openTickets: 트래커의 열린 개발 티켓 `{ticketKey, summary}` — 같은 제목이면 만들지 않고 그 키를 알려 준다
 * (응답이 끊겨 다시 실행해도 두 번 만들지 않는다).
 * @returns {{ok: boolean, errors: string[], create: object[], existing: object[]}}
 */
export function validateTicketDrafts({drafts, openTickets = [], titlePrefix = ''}) {
  const errors = []
  const create = []
  const existing = []
  if (list(drafts).length === 0) errors.push('초안에 티켓이 없다 — `## 제목` 아래 네 절(목적·작업 내용·완료 조건·선행·협의, 선택: 수정 범위·하지 않는 것)을 쓴다')
  const seen = new Set()
  const openByTitle = new Map(list(openTickets).filter(item => item?.summary).map(item => [normalizeTitle(item.summary), item.ticketKey]))
  for (const draft of list(drafts)) {
    const label = draft.title ? `「${draft.title}」` : '(제목 없음)'
    const before = errors.length
    if (!draft.title) errors.push('제목이 없는 티켓이 있다')
    else if (draft.title.length > 200) errors.push(`${label}: 제목이 너무 길다(200자 이내)`)
    for (const {id, title} of TICKET_SECTIONS) {
      if (!String(draft.sections?.[id] ?? '').trim()) errors.push(`${label}: 「${title}」 절이 없거나 비었다`)
    }
    if (list(draft.unknownSections).length > 0) errors.push(`${label}: 양식에 없는 절 ${draft.unknownSections.map(name => `「${name}」`).join(', ')} — 네 절(선택: 수정 범위·하지 않는 것) 안에 적는다`)
    for (const {id, title} of OPTIONAL_TICKET_SECTIONS) {
      if (Object.hasOwn(draft.sections ?? {}, id) && !String(draft.sections[id]).trim()) errors.push(`${label}: 「${title}」 절이 비었다 — 쓰지 않으면 절을 뺀다`)
    }
    const acceptance = String(draft.sections?.acceptance ?? '').split('\n').filter(line => LIST_ITEM.test(line))
    if (draft.sections?.acceptance && acceptance.length === 0) errors.push(`${label}: 「완료 조건」은 확인할 수 있는 문장을 목록(- …)으로 적는다`)
    const text = [draft.title, ...Object.values(draft.sections ?? {})].join('\n')
    if (PLAN_ID.test(text)) errors.push(`${label}: 기획 요구사항 ID(FEAT·TC)는 개발 티켓에 달지 않는다 — 그건 계획이 발행하는 WORK의 몫이다`)
    // 초안도 비신뢰 텍스트다 — 트래커에 실린 뒤 pickup이 잡으면 팀 전체가 보는 티켓이 이미 만들어진 뒤다.
    const injection = scanUntrustedBody(text)
    if (injection.injectionSuspect) errors.push(`${label}: 지시문으로 읽힐 수 있는 문장이 있다(${injection.markers.join(', ')}) — 티켓에 싣지 않는다`)
    // 같은 제목 대조는 **트래커에 실릴 제목**으로 한다 — 접두어를 붙여 만든 티켓을 다시 실행에서 못 알아보면 두 번 만든다.
    const key = normalizeTitle(applyTitlePrefix(draft.title, titlePrefix))
    if (draft.title && seen.has(key)) errors.push(`${label}: 초안 안에 같은 제목이 두 번 있다`)
    seen.add(key)
    if (errors.length > before) continue
    if (openByTitle.has(key)) existing.push({title: draft.title, ticketKey: openByTitle.get(key)})
    else create.push(draft)
  }
  return {ok: errors.length === 0, errors, create, existing}
}
const normalizeTitle = title => String(title ?? '').replace(/\s+/g, ' ').trim().toLowerCase()

/** 팀이 선언한 제목 접두어(순수) — 이미 그 접두어로 시작하면 다시 붙이지 않는다. */
export function applyTitlePrefix(title, prefix = '') {
  const head = String(prefix ?? '').trim()
  const body = String(title ?? '').trim()
  if (!head || !body || body.startsWith(head)) return body
  return `${head} ${body}`
}

/**
 * 본문(순수) — 네 절(과 있는 선택 절)을 트래커 서식의 제목으로 잇는다. Jira 위키 서식은 목록 기호를 `*`로 바꾼다.
 * `plain`은 서식을 해석하지 않는 본문(Jira Cloud의 평문→ADF)이다 — `###`가 글자로 남지 않게 절 이름만 적는다.
 */
export function renderDevTicketBody(draft, {format = 'markdown'} = {}) {
  const heading = title => (format === 'jira-wiki' ? `h3. ${title}` : format === 'plain' ? `[${title}]` : `### ${title}`)
  const block = text => (format === 'jira-wiki' ? String(text).replace(/^(\s*)-\s+/gm, '$1* ') : String(text))
  return BODY_ORDER.filter(id => String(draft.sections?.[id] ?? '').trim())
    .map(id => `${heading(TITLE_OF.get(id))}\n${block(draft.sections[id])}`).join('\n\n')
}

/** 팀이 선언한 개발 티켓 분류(순수) — Jira 컴포넌트 이름 · GitHub 라벨 이름. 없으면 만들지 않는다. */
export function devTicketClassification(config) {
  const axisOf = axis => Object.entries(axis ?? {}).filter(([, role]) => role === DEV_TICKET).map(([name]) => name)
  const components = axisOf(config?.jira?.componentAxis ?? config?.componentAxis)
  const labels = axisOf(config?.github?.labelAxis ?? config?.labelAxis)
  return {components, labels}
}
