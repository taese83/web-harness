// work-link-run.mjs — `link --work <티켓키> <PR>`와 `link --reopen`의 실행부.
//
// 연결·완료 회수는 티켓 코멘트로 남긴다(원장에 쓰지 않는다). PR 호스트는 PR URL의 호스트다 — 트래커가 Jira여도
// PR은 GitHub에 있다. 머지는 기록하지 않고 읽는 쪽이 PR 상태에서 계산한다(work-state-run.mjs).
import {existsSync, readFileSync, rmSync} from 'node:fs'
import {join} from 'node:path'
import {canonicalDigest, WORK_ANALYSIS_PATH} from './work-analysis.mjs'
import {WORK_PLAN_PATH} from './work-plan.mjs'
import {foldWorkState, readWorkEvents, WORK_EVENTS_PATH} from './work-events.mjs'
import {layerPattern} from '../agent-registry.mjs'
import {renderLinkRecord, renderReopenRecord} from './work-records.mjs'
import {resolveCommentLanguage} from './readiness.mjs'
import {readDeclaredLanguage} from './ticket-config.mjs'
import {collectCitedTestCaseIds, evaluateWorkCompletion, findMixedCommits, findOutsideScope, planWorkLink, projectPathExists, projectRefDigest, readCommitLog} from './work-link.mjs'
import {renderCloseReference} from './provider-github.mjs'
import {titleStartsWithKey} from './work-provider.mjs'

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

/**
 * 원장에 없는 키면 티켓에서 사람 티켓 작업의 등록을 읽어 메모리 상태에 겹친다 — **티켓이 등록 기록이다**. provider가 없거나
 * 등록이 아니면 원장만으로 간다.
 */
async function withTicketFromTracker({state, ticketKey, io}) {
  const {workForTicket} = await import('./work-link.mjs')
  const found = workForTicket(state, ticketKey)
  if (found.workId || !io.provider || typeof io.provider.resolveIssue !== 'function') return {state, found}
  const {readTicketRegistration, withTicketRegistrations} = await import('./ticket-work-run.mjs')
  const issue = await io.provider.resolveIssue(ticketKey)
  const registration = readTicketRegistration({issue, providerName: io.provider.name, ticketKey, state})
  if (!registration) return {state, found}
  if (registration.error) return {state, found: {error: 'ticket-body-unreadable', detail: registration.error}}
  const next = withTicketRegistrations(state, [registration])
  return {state: next, found: workForTicket(next, ticketKey)}
}

/** 이 티켓의 지금 상태(PR 연결 기록·완료 회수·머지·끝남)를 트래커에서 읽어 겹친다. provider가 없으면 원장만 본다. */
async function withTrackerState({root, state, ticketKey, io}) {
  if (!io.provider) return state
  const {readTrackerWorkState} = await import('./work-state-run.mjs')
  const plan = readJson(root, WORK_PLAN_PATH)
  return (await readTrackerWorkState({provider: io.provider, state, root, plan, config: io.ticketConfig ?? null, io, keys: [String(ticketKey)]})).state
}

export async function runWorkLink({root, ticketKey, prUrl, flags = {}, io = {}}) {
  const eventsPath = join(root, WORK_EVENTS_PATH)
  // 완료 판정은 등록된 작업에 대해서만 의미가 있다 — 먼저 찾고(원장, 없으면 티켓), 없으면 판정 없이 막는다.
  const located = await withTicketFromTracker({state: foldWorkState(readWorkEvents(eventsPath)), ticketKey, io})
  const found = located.found
  // 지난 연결(멱등)·완료 회수는 티켓 코멘트에 있다 — 원장이 아니라 트래커에서 읽는다.
  const state = found.workId ? await withTrackerState({root, state: located.state, ticketKey, io}) : located.state
  if (found.workId && state.works.get(found.workId)) found.registered = state.works.get(found.workId)
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
  const baseline = changeScope && found.workId && changeScope.workId === found.workId
    ? Object.fromEntries(list(changeScope.checks).filter(check => check.checkId && check.baseline).map(check => [check.checkId, check.baseline]))
    : null
  const completion = work ? evaluateWorkCompletion({work, ownedTestCaseIds: owned,
    citedIds: io.citedIds ?? collectCitedTestCaseIds(root), pathExists: io.pathExists ?? projectPathExists(root),
    baseline: baseline && Object.keys(baseline).length > 0 ? baseline : null, currentDigest: io.refDigest ?? projectRefDigest(root)}) : null
  // 기대 base: 운영자가 준 `--base`가 이긴다. 없으면 PR을 읽는다(쓰기 없음). 못 읽으면 판정이 막는다.
  let baseRef = typeof flags.base === 'string' ? flags.base : null
  let baseNote = baseRef ? 'operator' : null
  let prTitle = null
  if (!baseRef && found.workId && typeof prUrl === 'string' && /^https?:\/\//.test(prUrl)) {
    const info = io.prInfo ? await io.prInfo(prUrl) : (await resolvePrStates([prUrl])).get(prUrl)
    baseRef = info?.baseRefName ?? null
    prTitle = info?.title ?? null
    baseNote = baseRef ? 'pr' : `unreadable: ${info?.error ?? 'no base'}`
  }
  // 받지 않은 계획 개정이 원격 base에 있으면 로컬 계획으로 STALE를 재지 않는다 — 대체된 작업을 끝낼 수 있다.
  let freshness = null
  if (!ticketWork) {
    freshness = await cli.ensureRemoteFreshness({root, flags, io})
    const remotePlan = await (io.planRemote ?? (await import('./git-origin.mjs')).planRevisionsOnRemote)({repoRoot: root, base: baseRef ?? plan.baseBranch ?? null})
    if (remotePlan.checked && remotePlan.commits.length > 0) {
      return {ok: false, mode: 'work', blocked: 'plan-behind-remote', ref: remotePlan.ref, commits: remotePlan.commits, freshness,
        guidance: `${remotePlan.ref}에 받지 않은 계획 개정이 있습니다. 브랜치에 받은 뒤 다시 집고 연결하세요.`}
    }
  }
  // 사람 티켓 작업은 본문이 정의다 — 집은 뒤 본문(완료 조건·테스트 항목·수정 범위)이 바뀌었으면 그 정의로 끝났다고 말하지 않는다.
  const {ticketDefinitionDigest} = await import('./ticket-work.mjs')
  const definitionChanged = Boolean(ticketWork && changeScope?.workId === found.workId && changeScope.definitionDigest
    && changeScope.definitionDigest !== ticketDefinitionDigest(ticketWork.definition))
  if (definitionChanged && !flags['accept-unverified-scope'] && !flags['dry-run']) {
    return {ok: false, mode: 'work', blocked: 'stale-change-scope', staleCheck: 'stale', workId: found.workId,
      guidance: '집은 뒤 티켓의 작업 정의(완료 조건·테스트 항목·수정 범위)가 바뀌었습니다. 다시 집은 뒤 연결하세요.'}
  }
  const decision = planWorkLink({plan, planDigest, state, changeScope, ticketKey, prUrl, completion, baseRef, flags})
  // 연결 기록은 **티켓 코멘트**다(원장에 쓰지 않는다) — 어느 PR을 어느 base로, 어느 정의로 끝났다고 했는지, 무엇을 인수했는지.
  const payload = decision.ok ? decision.event?.payload ?? null : null
  const accepted = payload ? [payload.acceptedIncomplete && 'incomplete', payload.acceptedUnverifiedScope && 'unverified-scope',
    definitionChanged && 'definition-change'].filter(Boolean) : []
  const lang = resolveCommentLanguage({declared: readDeclaredLanguage(root), text: work?.title ?? ''})
  const summary = completion ? (lang === 'en' ? `acceptance ${completion.checks.satisfied.length}/${completion.checks.total} · tests ${completion.testCases.cited.length}/${completion.testCases.total}`
    : `완료 조건 ${completion.checks.satisfied.length}/${completion.checks.total} · 테스트 ${completion.testCases.cited.length}/${completion.testCases.total}`) : null
  const record = payload ? renderLinkRecord({prUrl, baseRef: payload.baseRef, accepted, summary, lang, revision: payload.ticket?.revision ?? null,
    definitionDigest: ticketWork ? ticketDefinitionDigest(ticketWork.definition) : null}) : null
  if (!decision.ok) return {mode: 'work', ...decision, ...(baseNote ? {baseSource: baseNote} : {})}
  if (decision.idempotent) {
    return {ok: true, mode: 'work', idempotent: true, workId: decision.workId, existing: decision.existing,
      staleCheck: decision.staleCheck, closeLine: workCloseLine(decision.provider, ticketKey)}
  }
  const closeLine = workCloseLine(decision.provider, decision.closes)
  // 트래커가 머지를 티켓에 잇는 근거는 **커밋 제목의 티켓 키**다(스쿼시 머지면 PR 제목이 곧 커밋 제목). GitHub 이슈는 닫는 줄이 잇는다.
  const prTitleCheck = !decision.provider || decision.provider === 'github' ? null
    : prTitle === null ? {checked: false}
      : titleStartsWithKey(prTitle, decision.closes ?? ticketKey) ? {checked: true, ok: true}
        : {checked: true, ok: false, guidance: `PR 제목을 티켓 키로 시작하세요(예: [${decision.closes ?? ticketKey}] …). 스쿼시 머지 커밋이 티켓에 연결되는 근거입니다.`}
  const ticketAcceptance = decision.ticketAcceptance ? {ticketAcceptance: decision.ticketAcceptance} : {}
  // 형상 규율: 하네스 산출물(`_workspace/`)과 코드는 따로 커밋한다 — 섞였으면 알린다(막지 않는다).
  const logText = baseRef ? (io.commitLog ? await io.commitLog(baseRef) : readCommitLog(root, baseRef)) : null
  // 점검하지 못한 것과 비교할 커밋이 없는 것은 「깨끗함」이 아니다 — 그렇게 적는다.
  const scanned = logText === null ? null : findMixedCommits(logText)
  const split = scanned === null ? {checked: false, reason: baseRef ? 'git log를 읽지 못했습니다' : 'PR의 base를 모릅니다'}
    : scanned.commits === 0 ? {checked: false, reason: 'base 이후 커밋이 없습니다(base 브랜치에서 실행했거나 origin이 오래됐습니다)'}
      : {checked: true, ...scanned}
  const commitSplit = !split.checked ? {...split, guidance: `커밋 구성을 점검하지 못했습니다: ${split.reason}.`}
    : split.mixed.length > 0 ? {...split, guidance: `하네스 산출물(_workspace)과 코드가 한 커밋에 섞인 커밋이 ${split.mixed.length}개 있습니다. PR 전에 나눠 커밋하세요.`}
      : split
  // 작업 범위 밖 파일 — 병렬 작업과 머지에서 충돌할 수 있는 곳을 PR 전에 보인다(막지 않는다).
  const ownScope = changeScope && found.workId && changeScope.workId === found.workId ? changeScope : null
  const outside = split.checked && ownScope
    ? findOutsideScope(logText, ownScope.ALLOWED_PATHS, layerPattern) : null
  const driftReason = !split.checked ? split.reason : '이 작업의 change-scope가 없습니다'
  const scopeDrift = outside === null ? {checked: false, reason: driftReason, guidance: `작업 범위 밖 파일을 점검하지 못했습니다: ${driftReason}.`}
    : outside.length > 0 ? {checked: true, outside, guidance: `작업 범위 밖 파일을 고쳤습니다(${outside.join(', ')}). 다른 작업과 충돌할 수 있으니 PR에 적어 두세요.`}
      : {checked: true, outside}
  if (flags['dry-run']) return {ok: true, mode: 'work', dryRun: true, record, completion, staleCheck: decision.staleCheck, closeLine, commitSplit, scopeDrift, ...(prTitleCheck ? {prTitle: prTitleCheck} : {}), ...ticketAcceptance}
  if (typeof io.provider?.comment !== 'function') {
    return {ok: false, mode: 'work', blocked: 'tracker-required', completion, closeLine,
      guidance: '연결은 티켓에 남깁니다 — 트래커 설정(`configure`)과 코멘트 권한이 필요합니다.'}
  }
  try {
    await io.provider.comment(String(decision.closes ?? ticketKey), record)
  } catch (error) {
    return {ok: false, mode: 'work', blocked: 'tracker-write-failed', completion, closeLine,
      guidance: `티켓에 연결을 남기지 못했습니다. 다시 부르세요: ${String(error?.message ?? error).slice(0, 160)}`}
  }
  // 연결한 사람 티켓 작업의 판정서는 더 읽을 곳이 없다 — 정의는 티켓에 있다(다시 집어도 등록으로 이어간다).
  if (ticketWork) rmSync(join(root, (await import('./ticket-work.mjs')).assessmentPath(ticketKey)), {force: true})
  // 성공 경로에서도 판정을 돌려준다 — 인수로 넘긴 미충족이 사용자에게 보이지 않으면 침묵이다.
  return {ok: true, mode: 'work', dryRun: false, workId: decision.workId, completion, staleCheck: decision.staleCheck, closeLine, commitSplit, scopeDrift, freshness, ...(prTitleCheck ? {prTitle: prTitleCheck} : {}), ...ticketAcceptance,
    ...(closeLine === null ? {note: '원장이 이 티켓을 어느 트래커에 냈는지 모른다 — 닫는 줄을 만들지 않았다(닫는 시늉을 하지 않는다)'} : {})}
}

/**
 * `link --reopen <키> --reason <이유>`: 머지를 되돌렸을 때 그 작업의 완료를 거둔다 — **티켓 코멘트**로 남긴다(원장에 쓰지 않는다).
 * 이 기록 뒤의 근거(머지·머지된 커밋·트래커 끝남)만 완료로 센다. 같은 작업을 다시 집을 수 있고, 이 작업을 선행으로 둔 작업은
 * 다시 기다린다. 닫힌 티켓을 다시 여는 것은 사람 몫이다.
 */
export async function runWorkReopen({root, ticketKey, flags = {}, io = {}}) {
  const eventsPath = join(root, WORK_EVENTS_PATH)
  const located = await withTicketFromTracker({state: foldWorkState(readWorkEvents(eventsPath)), ticketKey, io})
  const found = located.found
  if (!found.workId) return {ok: false, mode: 'work', blocked: found.error, guidance: '등록된 작업의 티켓이 아닙니다.'}
  const reason = typeof flags.reason === 'string' ? flags.reason.trim() : ''
  if (!reason) return {ok: false, mode: 'work', blocked: 'reason-required', guidance: '`--reason "<왜 되돌렸는지>"`를 붙여 다시 실행하세요.'}
  const state = await withTrackerState({root, state: located.state, ticketKey, io})
  const item = state.works.get(found.workId) ?? found.registered
  const prUrl = item.completed?.prUrl ?? item.link?.prUrl ?? null
  // 이 작업을 선행으로 둔 작업 — 이미 끝난 것은 되돌린 코드 위에서 끝났을 수 있다. 사람이 확인한다.
  const dependents = [...state.works.entries()]
    .filter(([, entry]) => list(entry.definition?.dependsOn).includes(found.workId))
    .map(([workId, entry]) => ({workId, ticketKey: entry.ticketKey ?? null}))
  const planned = list(readJson(root, WORK_PLAN_PATH)?.workItems).filter(work => list(work.dependsOn).includes(found.workId))
    .map(work => ({workId: work.workId, ticketKey: state.works.get(work.workId)?.ticketKey ?? null}))
  const affected = [...planned, ...dependents].map(entry => ({...entry, completed: Boolean(state.works.get(entry.workId)?.completed)}))
  const lang = resolveCommentLanguage({declared: readDeclaredLanguage(root), text: item.definition?.title ?? ''})
  const record = renderReopenRecord({prUrl, reason, lang})
  if (!flags['dry-run']) {
    if (typeof io.provider?.comment !== 'function') {
      return {ok: false, mode: 'work', blocked: 'tracker-required', guidance: '완료 회수는 티켓에 남깁니다 — 트래커 설정(`configure`)과 코멘트 권한이 필요합니다.'}
    }
    try { await io.provider.comment(String(ticketKey), record) } catch (error) {
      return {ok: false, mode: 'work', blocked: 'tracker-write-failed', guidance: `티켓에 남기지 못했습니다. 다시 부르세요: ${String(error?.message ?? error).slice(0, 160)}`}
    }
  }
  const done = affected.filter(entry => entry.completed).map(entry => entry.ticketKey ?? entry.workId)
  return {ok: true, mode: 'work', dryRun: Boolean(flags['dry-run']), workId: found.workId, reopened: {prUrl, reason}, affected, record,
    guidance: `이제 ${ticketKey} 작업을 다시 집을 수 있습니다. 트래커에서 티켓이 닫혀 있으면 다시 여세요.`
      + (done.length > 0 ? ` 이 작업 위에서 끝난 작업(${done.join(', ')})은 되돌린 코드에서도 맞는지 확인하세요.` : '')}
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
      states.set(url, {state: parsed?.state ?? null, baseRefName: parsed?.baseRefName ?? null, title: parsed?.title ?? null, mergedAt: parsed?.mergedAt ?? null})
    } catch (error) {
      states.set(url, {error: String(error?.message ?? error).slice(0, 160)})
    }
  }
  return states
}

