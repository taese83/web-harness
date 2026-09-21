// pilot-report.mjs — 팀 흐름 실측을 티켓별 표 하나로 모은다(`pilot-report`). 읽기만 한다.
//
// 새로 재는 것은 없다 — 이미 남는 기록(흐름 로그·판정서·등록·연결 기록, 트래커 상태·코멘트, 머지된 PR)을 티켓 단위로 잇는다.
// 판정의 참이나 생산성은 재지 않는다: 표본이 작고 비교군이 없어 이 표는 **막힌 지점과 설계 결함을 찾는 도구**다.
import {existsSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {readFlowLog} from './flow-log.mjs'
import {assessmentPath, registrationPath} from './ticket-work.mjs'
import {readLocalLinks} from './work-state-run.mjs'

const list = value => (Array.isArray(value) ? value : [])
const count = (values, key = value => value) => values.reduce((map, value) => map.set(key(value), (map.get(key(value)) ?? 0) + 1), new Map())
const hours = (from, to) => (from && to && Number.isFinite(Date.parse(from)) && Number.isFinite(Date.parse(to))
  ? Math.round((Date.parse(to) - Date.parse(from)) / 36e5 * 10) / 10 : null)
const median = values => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (sorted.length === 0) return null
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2 * 10) / 10
}
// 가정 알림 코멘트의 첫 문장(ticket-work-run.mjs assumptionNoticeComment) — 그 뒤 다른 사람의 코멘트를 정정 신호로 센다.
const ASSUMPTION_NOTICE = /^(아래 미정 사항을 가정하고 진행합니다|Proceeding with the following undecided details assumed)/

// 자동화 계정은 정정이 아니다 — GitHub `[bot]` 접미·Jira Automation.
const BOT_AUTHOR = /\[bot\]$|^automation for jira$|^jira automation$/i

/** 가정 알림 뒤에 다른 사람이 단 코멘트 수(순수). 알림이 없거나, 코멘트를 못 읽었거나, 일부만 받았으면 null(미측정). */
export function repliesAfterAssumption(comments, {omitted = 0} = {}) {
  if (!Array.isArray(comments) || omitted > 0) return null
  const index = comments.findIndex(comment => ASSUMPTION_NOTICE.test(String(comment?.body ?? '').trim()))
  if (index < 0) return null
  const notifier = comments[index].author
  return comments.slice(index + 1).filter(comment => comment?.author && comment.author !== notifier && !BOT_AUTHOR.test(comment.author)).length
}

/**
 * 티켓별 행과 요약(순수).
 * @param {{keys: string[], flow: object[], assessments: Map, registrations: Map, links: Map, tracker: Map|null, replies: Map}} input
 *   tracker: 키 → `{statusCategory, resolution, completed}`(못 읽었으면 null) · replies: 키 → 가정 알림 뒤 다른 사람 코멘트 수
 */
export function buildPilotReport({keys, flow, assessments = new Map(), registrations = new Map(), links = new Map(), tracker = null, replies = new Map()}) {
  const rows = keys.map(key => {
    const entries = flow.filter(entry => String(entry.ticketKey) === String(key))
    const pickups = entries.filter(entry => entry.command === 'pickup')
    const started = pickups.find(entry => entry.outcome === 'started') ?? null
    const assessment = assessments.get(key) ?? null
    const registration = registrations.get(key) ?? null
    const done = tracker?.get(key) ?? null
    return {
      ticketKey: key,
      verdict: assessment?.verdict ?? null,
      lane: assessment?.lane ?? null,
      assumptions: list(assessment?.assumptions).length,
      planningNeeds: list(assessment?.planningNeeds).map(item => item?.what).filter(Boolean),
      pickups: pickups.length,
      confirmWaits: pickups.filter(entry => entry.outcome === 'confirm').length,
      stops: pickups.filter(entry => entry.outcome === 'stopped').map(entry => entry.reason ?? entry.phase ?? 'unknown'),
      linkStops: entries.filter(entry => entry.command === 'link' && entry.outcome === 'stopped').map(entry => entry.reason ?? entry.phase ?? 'unknown'),
      startedAt: started?.at ?? null,
      dependsOn: list(registration?.dependsOnKeys).filter(Boolean),
      acceptedOverlaps: list(registration?.acceptedOverlaps).length,
      linkedAt: links.get(key)?.at ?? null,
      tracker: done ? {statusCategory: done.statusCategory ?? null, resolution: done.resolution ?? null} : null,
      completedAt: done?.completed?.at ?? null,
      completedVia: done?.completed?.via ?? null,
      leadTimeHours: hours(started?.at, done?.completed?.at),
      repliesAfterAssumption: replies.has(key) ? replies.get(key) : null,
    }
  })
  const withAssumptions = rows.filter(row => row.assumptions > 0)
  // 분모는 **측정한** 티켓뿐이다 — 못 읽은 것을 0으로 접으면 「정정 없음」으로 오독한다.
  const measured = withAssumptions.filter(row => row.repliesAfterAssumption !== null)
  const replied = measured.filter(row => row.repliesAfterAssumption > 0)
  const summary = {
    tickets: rows.length,
    started: rows.filter(row => row.startedAt).length,
    completed: rows.filter(row => row.completedAt).length,
    completedVia: Object.fromEntries(count(rows.filter(row => row.completedVia).map(row => row.completedVia))),
    verdicts: Object.fromEntries(count(rows.map(row => row.verdict ?? '(판정 없음)'))),
    stopReasons: Object.fromEntries(count(rows.flatMap(row => row.stops))),
    linkStopReasons: Object.fromEntries(count(rows.flatMap(row => row.linkStops))),
    ticketsWithAssumptions: withAssumptions.length,
    assumptionRepliesMeasured: measured.length,
    // 정정 신호다 — 답글이 정정인지 동의인지는 사람이 읽어 가른다.
    assumptionReplyRate: measured.length ? Math.round(replied.length / measured.length * 100) / 100 : null,
    // 판정·등록은 있는데 흐름 기록이 없는 티켓 — 기록 실패이거나 다른 클론에서 진행했다.
    unrecorded: rows.filter(row => row.pickups === 0 && (row.verdict || row.dependsOn.length > 0 || row.acceptedOverlaps > 0)).map(row => row.ticketKey),
    acceptedOverlaps: rows.reduce((sum, row) => sum + row.acceptedOverlaps, 0),
    medianLeadTimeHours: median(rows.map(row => row.leadTimeHours)),
  }
  return {rows, summary}
}

/** 사람이 읽는 표(순수). */
export function renderPilotReport({rows, summary}, {notes = []} = {}) {
  const cell = value => (value === null || value === undefined || (Array.isArray(value) && value.length === 0) ? '-'
    : Array.isArray(value) ? value.join(', ') : String(value))
  const lines = [
    `# 팀 흐름 실측 — 티켓 ${summary.tickets}건`, '',
    `- 착수 ${summary.started} · 완료 ${summary.completed}(${Object.entries(summary.completedVia ?? {}).map(([key, value]) => `${key} ${value}`).join(' · ') || '-'}) · 판정 ${Object.entries(summary.verdicts).map(([key, value]) => `${key} ${value}`).join(' · ') || '-'}`,
    `- 멈춤 사유: ${Object.entries(summary.stopReasons).map(([key, value]) => `${key} ${value}`).join(' · ') || '없음'}`,
    `- link 멈춤: ${Object.entries(summary.linkStopReasons).map(([key, value]) => `${key} ${value}`).join(' · ') || '없음'}`,
    `- 가정 사용 ${summary.ticketsWithAssumptions}건 · 가정 뒤 답글 비율 ${summary.assumptionReplyRate ?? '-'}(측정 ${summary.assumptionRepliesMeasured ?? 0}/${summary.ticketsWithAssumptions}, 정정인지 사람이 확인) · 겹친 채 확인 ${summary.acceptedOverlaps}건`,
    `- 착수→완료 중앙값 ${summary.medianLeadTimeHours ?? '-'}시간(착수 시각은 이 클론의 기록, 완료에는 머지 없는 트래커 끝남 포함)`,
    ...(summary.unrecorded?.length ? [`- 흐름 기록이 없는 티켓: ${summary.unrecorded.join(', ')} — 기록 실패이거나 다른 클론에서 진행했다`] : []),
    ...notes.map(note => `- 참고: ${note}`), '',
    '| 티켓 | 판정 | 가정 | 멈춤 | 선행 | 겹침 확인 | 착수 | 완료 | 걸린 시간(h) | 가정 뒤 답글 |',
    '|---|---|---|---|---|---|---|---|---|---|',
    ...rows.map(row => `| ${row.ticketKey} | ${cell(row.verdict)}${row.lane ? `/${row.lane}` : ''} | ${row.assumptions} | ${cell(row.stops)} | ${cell(row.dependsOn)} | ${row.acceptedOverlaps} | ${cell(row.startedAt?.slice(0, 16))} | ${cell(row.completedAt?.slice(0, 16))}${row.completedVia ? `(${row.completedVia})` : ''} | ${cell(row.leadTimeHours)} | ${cell(row.repliesAfterAssumption)} |`),
  ]
  return `${lines.join('\n')}\n`
}

const readJson = path => { try { return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null } catch { return null } }

/** 실행부 — 로컬 기록을 읽고, 트래커·PR은 있으면 읽기만 한다(못 읽으면 그렇다고 적는다). */
export async function runPilotReport({root, flags = {}, io = {}}) {
  const {entries, broken} = readFlowLog(root)
  const keys = typeof flags.keys === 'string' && flags.keys.trim()
    ? flags.keys.split(',').map(key => key.trim()).filter(Boolean)
    : [...new Set(entries.map(entry => entry.ticketKey).filter(Boolean))]
  const invalid = keys.filter(key => !/^(?:[A-Za-z][A-Za-z0-9_]*-\d+|#?\d+)$/.test(key))
  if (invalid.length > 0) return {ok: false, mode: 'pilot-report', phase: 'INVALID_KEYS', externalWrites: 0, guidance: `티켓 키 모양이 아니다: ${invalid.join(', ')}`}
  const notes = []
  if (broken > 0) notes.push(`흐름 로그의 깨진 줄 ${broken}개를 건너뛰었다`)
  if (keys.length === 0) {
    return {ok: true, mode: 'pilot-report', report: {rows: [], summary: {tickets: 0}}, markdown: '# 팀 흐름 실측 — 기록 없음\n',
      guidance: '흐름 로그가 비어 있다 — pickup·link를 실행하면 자동으로 쌓인다. 대상 티켓을 정하려면 --keys로 준다.'}
  }
  const assessments = new Map(keys.map(key => [key, readJson(join(root, assessmentPath(key)))]).filter(([, value]) => value))
  const registrations = new Map(keys.map(key => [key, readJson(join(root, registrationPath(key)))]).filter(([, value]) => value))
  const links = readLocalLinks(root)
  let tracker = null
  const replies = new Map()
  const provider = io.provider ?? null
  if (provider && flags['no-tracker'] !== true) {
    const {readTrackerWorkState} = await import('./work-state-run.mjs')
    const state = {works: new Map(keys.map(key => [key, {status: 'published', ticketKey: key, placeholder: true}]))}
    const read = await readTrackerWorkState({provider, state, root, config: io.ticketConfig ?? null, io, keys})
    // 자리로 읽었으니 「선행 대기」 안내는 이 문맥이 아니다 — 못 찾은 키로 옮겨 적는다.
    notes.push(...read.notes.map(note => note.replace(/^선행 티켓 (\d+)건을 트래커에서 찾지 못했습니다\(([^)]*)\).*$/, '티켓 $1건을 트래커에서 찾지 못했다($2) — 키를 확인한다')))
    if (read.checked) {
      const items = new Map(list(read.items).map(item => [String(item.ticketKey), item]))
      tracker = new Map(keys.map(key => [key, {statusCategory: items.get(key)?.statusCategory ?? null, resolution: items.get(key)?.resolution ?? null,
        completed: read.state.works.get(key)?.completed ?? null}]))
    } else notes.push('트래커를 읽지 못해 완료·걸린 시간은 비어 있다')
    // 가정을 쓴 티켓만 코멘트를 읽는다(티켓마다 호출 한 번).
    for (const key of keys.filter(key => list(assessments.get(key)?.assumptions).length > 0)) {
      try {
        const issue = io.resolveIssue ? await io.resolveIssue({number: key}) : await provider.resolveIssue(key)
        const omitted = Number(issue?.commentsOmitted ?? 0)
        if (omitted > 0) notes.push(`${key} 코멘트 ${omitted}개를 트래커가 주지 않아 가정 뒤 답글을 재지 않았다`)
        replies.set(key, repliesAfterAssumption(issue?.comments ?? null, {omitted}))
      } catch { notes.push(`${key} 코멘트를 읽지 못했다`) }
    }
  } else notes.push('트래커를 읽지 않았다 — 완료·걸린 시간·가정 뒤 답글은 비어 있다')
  notes.push('티켓별 토큰 비용은 이 표에 없다 — execution-telemetry(run 단위)를 따로 본다')
  const report = buildPilotReport({keys, flow: entries, assessments, registrations, links, tracker, replies})
  return {ok: true, mode: 'pilot-report', report, markdown: renderPilotReport(report, {notes}), notes, externalWrites: 0}
}
