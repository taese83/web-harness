// flow-log.mjs — 팀 흐름 명령(pickup·link·create)의 결과를 개발자 로컬에 한 줄씩 남긴다(기록, 게이트 아님).
//
// 멈춘 이유는 화면에만 나오고 어디에도 남지 않아 「하네스가 어디서 막았는가」를 사후에 셀 수 없었다.
// 로컬 파일(git 제외)이며 어디로도 보내지 않는다. 본문·코멘트 같은 티켓 내용은 싣지 않는다. 쓰기 실패는 흐름을 바꾸지 않는다.
import {appendFileSync, existsSync, mkdirSync, readFileSync} from 'node:fs'
import {dirname, join} from 'node:path'

export const FLOW_LOG_PATH = '_workspace/03_dev/flow-log.jsonl'

const text = value => (typeof value === 'string' && value ? value.slice(0, 120) : null)

/** 명령 결과 → 기록 한 줄(순수). 결과의 모양만 옮기고 내용은 옮기지 않는다. */
export function flowEntry({command, ticketKey = null, developer = null, result = {}, at = new Date().toISOString()}) {
  const reason = result?.bounce?.reason ?? result?.blocked ?? null
  return {
    at, command, ticketKey: ticketKey === null ? null : String(ticketKey), developer: text(developer),
    outcome: text(result?.outcome) ?? (result?.ok === true ? 'ok' : result?.ok === false ? 'stopped' : null),
    phase: text(result?.phase), reason: text(reason),
    ...(result?.ticketWork?.registered ? {registered: true} : {}),
    ...(typeof result?.verdict === 'string' ? {verdict: result.verdict} : {}),
    ...(Array.isArray(result?.created) ? {created: result.created.map(item => String(item.ticketKey))} : {}),
  }
}

/** git이 이 파일을 제외하는가(순수 근사) — 개발 준비 검사(team-sharing)와 같은 줄 대조다. */
const ignoredByGit = root => {
  try {
    return readFileSync(join(root, '.gitignore'), 'utf8').split(/\r?\n/).map(line => line.trim()).includes(FLOW_LOG_PATH)
  } catch {
    return false
  }
}

/**
 * 한 줄을 덧붙인다 — 실패해도 던지지 않는다(기록이 흐름을 막지 않는다). `{recorded, reason}`을 돌려 부른 쪽이 실패를 보이게 한다.
 * git 제외가 안 된 클론에는 쓰지 않는다 — 로컬 기록이 다음 커밋에 딸려 가면 「전송 없음」이 깨진다.
 */
export function recordFlow(root, entry) {
  if (!ignoredByGit(root)) return {recorded: false, reason: 'not-gitignored'}
  try {
    const path = join(root, FLOW_LOG_PATH)
    mkdirSync(dirname(path), {recursive: true})
    appendFileSync(path, `${JSON.stringify(entry)}\n`)
    return {recorded: true}
  } catch (error) {
    return {recorded: false, reason: String(error?.code ?? error?.message ?? error).slice(0, 60)}
  }
}

/** 기록하지 못했을 때 결과에 싣는 한 줄(순수) — 흐름은 그대로이고 실측에서 빠진다는 사실만 알린다. */
export const flowRecordNote = written => (written.recorded ? {} : {flowRecorded: false,
  flowGuidance: written.reason === 'not-gitignored'
    ? '실측 기록을 남기지 않았습니다 — .gitignore에 흐름 로그 줄이 없습니다. 개발 준비 검사를 --fix로 한 번 돌리세요.'
    : `실측 기록을 남기지 못했습니다(${written.reason}). 흐름에는 영향이 없습니다.`})

/** 기록 읽기 — 깨진 줄은 건너뛰고 몇 줄인지 센다. */
export function readFlowLog(root) {
  const path = join(root, FLOW_LOG_PATH)
  if (!existsSync(path)) return {entries: [], broken: 0}
  let broken = 0
  const entries = readFileSync(path, 'utf8').split('\n').filter(Boolean).flatMap(line => {
    try { return [JSON.parse(line)] } catch { broken += 1; return [] }
  })
  return {entries, broken}
}
