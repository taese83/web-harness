// ticket-reassess.mjs — 티켓 본문을 고친 뒤 **바뀐 절만** 다시 판정하게 한다(`pickup --reassess`).
//
// 판정서를 손으로 옆에 치우고 판정 에이전트가 처음부터 다시 쓰던 것을 대신한다:
//   - 확인을 통과한 판정의 원문(격리 사본)을 `<키>.assessed.md`로 남긴다 — 다음 재판정의 비교 기준이다
//   - `--reassess`는 지금 판정서를 `history/`로 옮기고(지우지 않는다), 절 단위로 무엇이 바뀌었는지 판정 에이전트에게 넘긴다
//   - 절을 읽을 수 없는 본문(양식 밖 손 티켓)이면 `changedSections: null` — 전체를 다시 본다
// 형식 검증은 어느 경로든 그대로다(validateTicketAssessment). 파일 쓰기는 CLI만 한다(에이전트 소유 패턴은 `<키>.json`뿐).
import {existsSync, mkdirSync, readdirSync, readFileSync, renameSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {TICKET_ASSESSMENTS_DIR} from './ticket-work.mjs'

const safeKey = ticketKey => String(ticketKey).replace(/[^A-Za-z0-9_-]/g, '_')
/** 확인을 통과한 판정이 기댄 원문(격리 사본). */
export const assessedBodyPath = ticketKey => `${TICKET_ASSESSMENTS_DIR}/${safeKey(ticketKey)}.assessed.md`
export const ASSESSMENT_HISTORY_DIR = `${TICKET_ASSESSMENTS_DIR}/history`

// 개발 티켓 양식의 절 제목 — markdown(`### 목적`), Jira 위키(`h3. 목적`), 평문(`[목적]`) 모두 읽는다.
const SECTION_TITLES = ['목적', '수정 범위', '작업 내용', '하지 않는 것', '완료 조건', '선행·협의']
const HEADING = new RegExp(`^\\s*(?:#{2,4}\\s+|h[2-4]\\.\\s+|\\[)(${SECTION_TITLES.map(title => title.replace(/\s+/g, '\\s*')).join('|')})\\]?\\s*$`)

/** 본문 → {절 제목: 본문}(순수). 절을 하나도 못 찾으면 null. */
export function ticketSections(body) {
  const sections = {}
  let current = null
  // 격리 사본이면 펜스 안의 본문만 본다 — 펜스 뒤의 맥락(개정 시각·코멘트)은 절이 아니고 매번 바뀐다.
  const fenced = String(body ?? '').match(/```text untrusted-ticket-body\n([\s\S]*?)\n```/)
  for (const line of (fenced ? fenced[1] : String(body ?? '')).split(/\r?\n/)) {
    const match = line.match(HEADING)
    if (match) { current = match[1].replace(/\s+/g, ' '); sections[current] = []; continue }
    if (current) sections[current].push(line.trim())
  }
  const titles = Object.keys(sections)
  if (titles.length === 0) return null
  return Object.fromEntries(titles.map(title => [title, sections[title].filter(Boolean).join('\n')]))
}

/** 두 본문의 바뀐 절(순수). 어느 한쪽이 양식 밖이면 null(전체를 다시 본다). */
export function changedTicketSections(previousBody, currentBody) {
  const before = ticketSections(previousBody)
  const after = ticketSections(currentBody)
  if (!before || !after) return null
  const titles = [...new Set([...Object.keys(before), ...Object.keys(after)])]
  return titles.filter(title => (before[title] ?? null) !== (after[title] ?? null))
    .map(title => ({section: title, change: !(title in before) ? 'added' : !(title in after) ? 'removed' : 'modified'}))
}

/** 지금 판정서를 이력으로 옮긴다(지우지 않는다). 옮긴 경로를 돌려준다. */
export function archiveAssessment(root, assessmentRelative, ticketKey) {
  const dir = join(root, ASSESSMENT_HISTORY_DIR)
  mkdirSync(dir, {recursive: true})
  const prefix = `${safeKey(ticketKey)}.`
  const next = readdirSync(dir).filter(name => name.startsWith(prefix) && name.endsWith('.json')).length + 1
  const target = `${ASSESSMENT_HISTORY_DIR}/${safeKey(ticketKey)}.${next}.json`
  mkdirSync(dirname(join(root, target)), {recursive: true})
  renameSync(join(root, assessmentRelative), join(root, target))
  return target
}

export const readAssessedBody = (root, ticketKey) => {
  const path = join(root, assessedBodyPath(ticketKey))
  return existsSync(path) ? readFileSync(path, 'utf8') : null
}
