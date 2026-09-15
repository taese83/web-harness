// work-link-run.mjs — `link --work <티켓키> <PR>`와 `link --work --sync`의 실행부.
//
// 트래커는 부르지 않는다 — 연결은 로컬 원장의 사실 기록이고(legacy와 같다), 머지 관측만 PR 호스트를
// 읽는다(쓰기 없음). PR 호스트는 PR URL의 호스트다 — 트래커가 Jira여도 PR은 GitHub에 있다.
import {existsSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {canonicalDigest, WORK_ANALYSIS_PATH} from './work-analysis.mjs'
import {WORK_PLAN_PATH} from './work-plan.mjs'
import {appendWorkEvent, foldWorkState, readWorkEvents, WORK_EVENTS_PATH} from './work-events.mjs'
import {collectCitedTestCaseIds, evaluateWorkCompletion, planMergeSync, planWorkLink, projectPathExists, projectRefDigest} from './work-link.mjs'
import {renderCloseReference} from './provider-github.mjs'

const list = value => (Array.isArray(value) ? value : [])
const readJson = (root, relative) => {
  const path = join(root, relative)
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null
}

/** 닫는 줄은 트래커가 정한다 — GitHub만 머지로 닫힌다. 트래커를 모르면 닫는다고 적지 않는다. */
export function workCloseLine(providerName, ticketKey) {
  if (!providerName) return null
  if (providerName === 'github') return renderCloseReference({ok: true, verified: true, closes: String(ticketKey)})
  return `Relates to ${ticketKey}\n\n> ⚠️ ${providerName} 티켓은 PR 머지로 자동 닫히지 않는다 — 머지 뒤 상태 전이가 필요하다`
}

export async function runWorkLink({root, ticketKey, prUrl, flags = {}, io = {}}) {
  const eventsPath = join(root, WORK_EVENTS_PATH)
  const state = foldWorkState(readWorkEvents(eventsPath))
  // 완료 판정은 원장이 이 키로 등록한 작업에 대해서만 의미가 있다 — 먼저 찾고, 없으면 판정 없이 막는다.
  const {workForTicket} = await import('./work-link.mjs')
  const found = workForTicket(state, ticketKey)
  // 사람 티켓 작업은 원장이 정의를 들고 있다 — 계획 파일 없이 같은 판정을 탄다(가상 계획).
  const ticketWork = found.registered?.origin === 'ticket' ? found.registered : null
  const {ticketVirtualPlan} = await import('./ticket-work.mjs')
  // 다시 판정해 거둔 티켓 작업은 취소된 작업이다 — 가상 계획에서도 `active`가 아니다(`work-cancelled`).
  const plan = ticketWork ? ticketVirtualPlan(ticketWork.withdrawn ? {...ticketWork.definition, lifecycle: 'withdrawn'} : ticketWork.definition, ticketWork.planId)
    : readJson(root, WORK_PLAN_PATH)
  if (!ticketWork && (!plan || !readJson(root, WORK_ANALYSIS_PATH))) {
    return {ok: false, mode: 'work', blocked: 'plan-required', guidance: 'WORK 계획이 없다 — `claim`부터 한다'}
  }
  const planDigest = ticketWork ? ticketWork.planDigest : canonicalDigest(plan)
  const cli = await import('./cli.mjs')
  const changeScope = cli.readChangeScopeFile(root)
  const work = found.workId ? list(plan.workItems).find(entry => entry.workId === found.workId) ?? null : null
  const owned = found.workId ? list(plan.featureBindings).flatMap(binding =>
    list(binding.acceptanceOwners).filter(owner => owner.workId === found.workId).map(owner => owner.testCaseId)) : []
  // 기준선은 **이 작업의 범위**에서만 쓴다 — 다른 작업의 지문과 비교하면 판정이 뜻을 잃는다.
  const baseline = changeScope?.workId === found.workId
    ? Object.fromEntries(list(changeScope.checks).filter(check => check.checkId && check.baseline).map(check => [check.checkId, check.baseline]))
    : null
  const completion = work ? evaluateWorkCompletion({work, ownedTestCaseIds: owned,
    citedIds: io.citedIds ?? collectCitedTestCaseIds(root), pathExists: io.pathExists ?? projectPathExists(root),
    baseline: baseline && Object.keys(baseline).length > 0 ? baseline : null, currentDigest: io.refDigest ?? projectRefDigest(root)}) : null
  // 기대 base: 운영자가 준 `--base`가 이긴다. 없으면 PR을 읽는다(쓰기 없음). 못 읽으면 판정이 막는다.
  let baseRef = typeof flags.base === 'string' ? flags.base : null
  let baseNote = baseRef ? 'operator' : null
  if (!baseRef && found.workId && typeof prUrl === 'string' && /^https?:\/\//.test(prUrl)) {
    const info = io.prInfo ? await io.prInfo(prUrl) : (await resolvePrStates([prUrl])).get(prUrl)
    baseRef = info?.baseRefName ?? null
    baseNote = baseRef ? 'pr' : `unreadable: ${info?.error ?? 'no base'}`
  }
  const decision = planWorkLink({plan, planDigest, state, changeScope, ticketKey, prUrl, completion, baseRef, flags})
  if (!decision.ok) return {mode: 'work', ...decision, ...(baseNote ? {baseSource: baseNote} : {})}
  if (decision.idempotent) {
    return {ok: true, mode: 'work', idempotent: true, workId: decision.workId, existing: decision.existing,
      staleCheck: decision.staleCheck, closeLine: workCloseLine(decision.provider, ticketKey)}
  }
  const closeLine = workCloseLine(decision.provider, decision.closes)
  const ticketAcceptance = decision.ticketAcceptance ? {ticketAcceptance: decision.ticketAcceptance} : {}
  if (flags['dry-run']) return {ok: true, mode: 'work', dryRun: true, event: decision.event, completion, staleCheck: decision.staleCheck, closeLine, ...ticketAcceptance}
  appendWorkEvent(eventsPath, decision.event)
  // 성공 경로에서도 판정을 돌려준다 — 인수로 넘긴 미충족이 사용자에게 보이지 않으면 침묵이다.
  return {ok: true, mode: 'work', dryRun: false, workId: decision.workId, completion, staleCheck: decision.staleCheck, closeLine, ...ticketAcceptance,
    ...(closeLine === null ? {note: '원장이 이 티켓을 어느 트래커에 냈는지 모른다 — 닫는 줄을 만들지 않았다(닫는 시늉을 하지 않는다)'} : {})}
}

/** PR 상태 조회기 — PR URL의 호스트로 `gh pr view`를 부른다. 실패는 미상으로 돌려준다. */
export async function resolvePrStates(prUrls, {exec = null} = {}) {
  const {runGh, prStateArgs} = await import('./provider-github-exec.mjs')
  const states = new Map()
  for (const url of new Set(prUrls)) {
    try {
      const host = new URL(url).host
      const out = exec ? await exec(prStateArgs(url), {host}) : await runGh(prStateArgs(url), {host})
      const parsed = JSON.parse(typeof out === 'string' ? out : out?.out ?? '')
      states.set(url, {state: parsed?.state ?? null, baseRefName: parsed?.baseRefName ?? null})
    } catch (error) {
      states.set(url, {error: String(error?.message ?? error).slice(0, 160)})
    }
  }
  return states
}

export async function runWorkMergeSync({root, flags = {}, io = {}}) {
  const plan = readJson(root, WORK_PLAN_PATH)
  const eventsPath = join(root, WORK_EVENTS_PATH)
  const state = foldWorkState(readWorkEvents(eventsPath))
  if (!plan && ![...state.works.values()].some(item => item.origin === 'ticket')) return {ok: false, mode: 'work', blocked: 'plan-required'}
  const pending = [...state.works.values()].filter(item => item.link?.prUrl && !item.completed).map(item => item.link.prUrl)
  const prStates = io.prStates ? await io.prStates(pending) : await resolvePrStates(pending)
  const sync = planMergeSync({plan, state, prStates})
  if (!flags['dry-run']) for (const event of sync.events) appendWorkEvent(eventsPath, event)
  return {ok: sync.unknown.length === 0 && sync.baseMismatch.length === 0, mode: 'work', dryRun: Boolean(flags['dry-run']),
    completed: sync.events.map(event => event.workId), open: sync.open, unknown: sync.unknown, baseMismatch: sync.baseMismatch,
    ...(sync.baseMismatch.length > 0 ? {baseGuidance: '기대한 base와 다른 브랜치에 머지됐다 — 완료로 쓰지 않는다. 기대 base로 다시 머지하거나 계획·링크를 확인한다'} : {}),
    ...(sync.unknown.length > 0 ? {guidance: 'PR 상태를 확인하지 못한 작업은 완료로 치지 않는다 — gh 인증·네트워크를 확인하고 다시 돌린다'} : {})}
}
