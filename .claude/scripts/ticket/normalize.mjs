// 팀 워크플로우 통합 빌드 1단계 — NormalizedTicket 스키마 + ManualPaste provider.
// docs/team-workflow-integration-design.md 공유 척추의 정규화된 티켓을 형식화한다.
//
// 이 모듈은 **순수 파서/검증기**다 — 실행·네트워크·파일쓰기 없음. 티켓 본문은 데이터로만
// 다루며 지시로 실행하지 않는다(비신뢰 콘텐츠 격리·request-type 대조는 pickup(단계 3) 몫).
// 파서는 티켓을 "정규화"만 하고, 개발 진입 준비도(스펙 완결성) 판정은 specCompleteness로
// 노출해 pickup이 되돌림 여부를 결정하게 한다 — 파서가 스펙을 만들거나 게이트하지 않는다.

const FEAT_ID = /\bFEAT-\d{3,}\b/g
const TC_ID = /\bTC-\d{3,}-\d+\b/g
const FEAT_ID_ONE = /^FEAT-\d{3,}$/       // 단일 값 검증용(비-global — lastIndex 상태 없음)
const TC_ID_ONE = /^TC-\d{3,}-\d+$/
const unique = values => [...new Set(values)]

/**
 * @typedef {Object} NormalizedTicket
 * @property {string} ticketId                외부 트래커 식별자 (예: "WHC-QA-1")
 * @property {'manual'} provider              이 provider 종류
 * @property {string} title
 * @property {string} body                    동작 명세(TARGET_BEHAVIOR 소스)
 * @property {string[]} acceptanceCriteria    AC 줄 목록
 * @property {string|null} type               request-type 후보(대조는 pickup) — 없으면 null
 * @property {{featureIds: string[], testCaseIds: string[]}} harnessRefs  스탬프된 ID(왕복)
 * @property {{ready: boolean, missing: string[]}} specCompleteness       개발 진입 준비도
 */

/**
 * 사람이 붙여넣은 티켓 텍스트를 NormalizedTicket으로 파싱한다.
 * 라벨 형식: "LABEL: value" (대소문자 무관). AC는 "AC:" 이후 "- "/"* " 목록.
 * @param {string} text
 * @returns {{ok: true, ticket: NormalizedTicket} | {ok: false, errors: string[]}}
 */
export function parseManualTicket(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return {ok: false, errors: ['빈 티켓 텍스트']}
  }
  const lines = text.split(/\r?\n/)
  const field = name => {
    const re = new RegExp(`^\\s*${name}\\s*:\\s*(.+)$`, 'i')
    for (const line of lines) {
      const match = line.match(re)
      if (match) return match[1].trim()
    }
    return ''
  }

  // AC 블록 — "AC:" 라인 이후, "- "/"* " 불릿 또는 들여쓴 줄. 다음 라벨(대문자:)에서 종료.
  const acceptanceCriteria = []
  let inAc = false
  for (const line of lines) {
    if (/^\s*AC\s*:/i.test(line)) {
      inAc = true
      const rest = line.replace(/^\s*AC\s*:/i, '').trim()
      if (rest) acceptanceCriteria.push(rest)
      continue
    }
    if (!inAc) continue
    if (/^\s*[-*]\s+/.test(line)) acceptanceCriteria.push(line.replace(/^\s*[-*]\s+/, '').trim())
    else if (/^\s*[A-Za-z][\w-]*\s*:/.test(line)) inAc = false // 다음 라벨에서 AC 블록 종료
    else if (line.trim()) acceptanceCriteria.push(line.trim())
  }

  const ticketId = field('TICKET') || field('TICKET-ID') || field('ID')
  const title = field('TITLE')
  const type = field('TYPE') // request-type 대조는 pickup 몫 — 여기선 캡처만
  const body = field('BEHAVIOR') || field('DESCRIPTION')

  // 하드 오류: 티켓을 식별조차 못 하는 경우만 실패. 나머지 부족은 specCompleteness로 보고.
  const errors = []
  if (!ticketId) errors.push('TICKET(id) 누락 — 티켓을 식별할 수 없음')
  if (!title) errors.push('TITLE 누락')
  if (errors.length > 0) return {ok: false, errors}

  // harnessRefs — 전체 텍스트에서 스탬프된 ID 추출(왕복). 없으면 빈 배열(맨몸 티켓).
  const featureIds = unique(text.match(FEAT_ID) ?? [])
  const testCaseIds = unique(text.match(TC_ID) ?? [])

  // 개발 진입 준비도 — pickup(단계 3)이 이 판정으로 되돌림 여부를 결정한다.
  // 파서는 게이트하지 않는다: 준비 안 됐어도 파싱은 성공하고, 무엇이 빠졌는지만 알린다.
  const missing = []
  if (!body) missing.push('behavior')
  if (acceptanceCriteria.length === 0) missing.push('acceptanceCriteria')
  if (testCaseIds.length === 0) missing.push('testCaseIds')

  return {
    ok: true,
    ticket: {
      ticketId,
      provider: 'manual',
      title,
      body,
      acceptanceCriteria,
      type: type || null,
      harnessRefs: {featureIds, testCaseIds},
      specCompleteness: {ready: missing.length === 0, missing},
    },
  }
}

/**
 * NormalizedTicket 형태 검증 — provider 산출물이 스키마를 지키는지 확인(다른 provider가
 * 채운 객체에도 쓸 수 있게 파싱과 분리). 반환은 문제 목록(빈 배열이면 유효).
 * @param {unknown} ticket
 * @returns {string[]}
 */
export function validateNormalizedTicket(ticket) {
  const problems = []
  if (!ticket || typeof ticket !== 'object') return ['ticket이 객체가 아님']
  const t = /** @type {Record<string, unknown>} */ (ticket)
  if (typeof t.ticketId !== 'string' || !t.ticketId.trim()) problems.push('ticketId 문자열 필요')
  if (typeof t.provider !== 'string' || !t.provider.trim()) problems.push('provider 문자열 필요')
  if (typeof t.title !== 'string' || !t.title.trim()) problems.push('title 문자열 필요')
  if (typeof t.body !== 'string') problems.push('body 문자열 필요')
  if (!Array.isArray(t.acceptanceCriteria)) problems.push('acceptanceCriteria 배열 필요')
  if (t.type !== null && typeof t.type !== 'string') problems.push('type은 문자열 또는 null')
  const refs = t.harnessRefs
  if (!refs || typeof refs !== 'object' || !Array.isArray(refs.featureIds) || !Array.isArray(refs.testCaseIds)) {
    problems.push('harnessRefs.{featureIds,testCaseIds} 배열 필요')
  } else {
    if (refs.featureIds.some(id => typeof id !== 'string' || !FEAT_ID_ONE.test(id))) problems.push('featureIds는 FEAT-NNN 형식')
    if (refs.testCaseIds.some(id => typeof id !== 'string' || !TC_ID_ONE.test(id))) problems.push('testCaseIds는 TC-NNN-N 형식')
  }
  const spec = t.specCompleteness
  if (!spec || typeof spec !== 'object' || typeof spec.ready !== 'boolean' || !Array.isArray(spec.missing)) {
    problems.push('specCompleteness.{ready,missing} 필요')
  }
  return problems
}
