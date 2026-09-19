// work-link-run.mjs — `link <티켓키> <PR>`의 실행부.
//
// 연결은 **이 개발자의 로컬 기록**이다(git 제외 — `work-state-run.mjs` `linkRecordPath`). 티켓에는 쓰지 않는다. 팀은 PR 제목의 티켓 키로
// 연결을 알고, 머지를 기록하지 않고 읽는다. 리뷰어가 봐야 할 주장(인수한 미충족·사람이 더한 조건)은 PR 본문 문단(`prBody`)으로 돌려준다.
// PR 호스트는 PR URL의 호스트다 — 트래커가 Jira여도 PR은 GitHub에 있다.
import {existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {canonicalDigest, WORK_ANALYSIS_PATH} from './work-analysis.mjs'
import {WORK_PLAN_PATH} from './work-plan.mjs'
import {foldWorkState, readWorkEvents, WORK_EVENTS_PATH} from './work-events.mjs'
import {layerPattern} from '../agent-registry.mjs'
import {resolveCommentLanguage} from './readiness.mjs'
import {readDeclaredLanguage} from './ticket-config.mjs'
import {collectCitedTestCaseIds, evaluateWorkCompletion, findMixedCommits, findOutsideScope, planWorkLink, projectPathExists, projectRefDigest, readCommitLog} from './work-link.mjs'
import {renderCloseReference} from './provider-github.mjs'
import {prNamesKey, titleStartsWithKey, withTrackerCompletion} from './work-provider.mjs'
import {linkRecordPath, readLocalLinks} from './work-state-run.mjs'

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

/** 원장에 없는 키면 이 개발자의 로컬 등록(사람 티켓 작업)을 메모리 상태에 겹친다. 등록이 없으면 원장만으로 간다. */
async function withLocalTicket({root, state, ticketKey}) {
  const {workForTicket} = await import('./work-link.mjs')
  const found = workForTicket(state, ticketKey)
  if (found.workId) return {state, found, registration: null}
  const {readTicketRegistration, withTicketRegistrations} = await import('./ticket-work-run.mjs')
  const registration = readTicketRegistration({root, ticketKey})
  if (!registration) return {state, found, registration: null}
  if (registration.error) return {state, found: {error: 'ticket-registration-unreadable', detail: registration.error}, registration: null}
  const next = withTicketRegistrations(state, [registration])
  return {state: next, found: workForTicket(next, ticketKey), registration}
}

/** 이 티켓의 지금 상태(끝남·머지·다시 연 시각)와 내 연결 기록을 겹친다. provider가 없으면 내 연결 기록만 본다. */
async function withTrackerState({root, state, ticketKey, io}) {
  if (!io.provider) return withTrackerCompletion(state, [], {links: readLocalLinks(root)})
  const {readTrackerWorkState} = await import('./work-state-run.mjs')
  const plan = readJson(root, WORK_PLAN_PATH)
  return (await readTrackerWorkState({provider: io.provider, state, root, plan, config: io.ticketConfig ?? null, io, keys: [String(ticketKey)]})).state
}

export async function runWorkLink({root, ticketKey, prUrl, flags = {}, io = {}}) {
  const eventsPath = join(root, WORK_EVENTS_PATH)
  // 완료 판정은 등록된 작업에 대해서만 의미가 있다 — 먼저 찾고(원장, 없으면 내 로컬 등록), 없으면 판정 없이 막는다.
  const located = await withLocalTicket({root, state: foldWorkState(readWorkEvents(eventsPath)), ticketKey})
  const found = located.found
  // 지난 연결(멱등)은 내 로컬 기록에, 끝남·다시 연 시각은 트래커와 PR에 있다.
  const state = found.workId ? await withTrackerState({root, state: located.state, ticketKey, io}) : located.state
  if (found.workId && state.works.get(found.workId)) found.registered = state.works.get(found.workId)
  // 사람 티켓 작업은 내 등록 기록이 정의를 들고 있다 — 계획 파일 없이 같은 판정을 탄다(가상 계획).
  const ticketWork = found.registered?.origin === 'ticket' ? found.registered : null
  const {ticketVirtualPlan} = await import('./ticket-work.mjs')
  const plan = ticketWork ? ticketVirtualPlan(ticketWork.definition, ticketWork.planId)
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
  let prBranch = null
  // PR은 `--base`가 있어도 읽는다 — 제목·브랜치의 티켓 키가 완료의 근거라 건너뛰면 키 없는 PR이 연결된다.
  if (found.workId && typeof prUrl === 'string' && /^https?:\/\//.test(prUrl)) {
    const info = io.prInfo ? await io.prInfo(prUrl) : (await resolvePrStates([prUrl])).get(prUrl)
    prTitle = info?.title ?? null
    prBranch = info?.headRefName ?? null
    if (!baseRef) {
      baseRef = info?.baseRefName ?? null
      baseNote = baseRef ? 'pr' : `unreadable: ${info?.error ?? 'no base'}`
    }
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
  // 사람 티켓 작업 — 집은 뒤 판정을 다시 확인했거나(정의 지문), 확인한 뒤 티켓 원문이 바뀌었으면(원문 지문) 그 정의로 끝났다고 말하지 않는다.
  const {ticketBodyDigest, ticketDefinitionDigest} = await import('./ticket-work.mjs')
  const definitionChanged = Boolean(ticketWork && changeScope?.workId === found.workId && changeScope.definitionDigest
    && changeScope.definitionDigest !== ticketDefinitionDigest(ticketWork.definition))
  let bodyCheck = null
  if (ticketWork && located.registration) {
    const current = typeof io.provider?.resolveIssue === 'function' ? await io.provider.resolveIssue(String(ticketKey)).catch(() => null) : null
    bodyCheck = !current ? {checked: false, guidance: '티켓 원문이 확인한 뒤 바뀌었는지 읽지 못했습니다.'}
      : {checked: true, changed: Boolean(located.registration.bodyDigest) && ticketBodyDigest(current.body ?? '') !== located.registration.bodyDigest}
  }
  const bodyChanged = Boolean(bodyCheck?.changed)
  // 대조하지 못한 것은 통과가 아니다 — 계획 작업의 STALE 미수행과 같이 명시 인수 없이는 막는다.
  if (bodyCheck && !bodyCheck.checked && !flags['accept-unverified-scope'] && !flags['dry-run']) {
    return {ok: false, mode: 'work', blocked: 'stale-check-unavailable', staleCheck: 'not-performed:ticket-unreadable', workId: found.workId,
      guidance: '판정을 확인한 뒤 티켓 원문이 바뀌었는지 읽지 못했습니다. 트래커를 읽을 수 있을 때 다시 부르거나 --accept-unverified-scope로 명시 인수하세요.'}
  }
  if ((definitionChanged || bodyChanged) && !flags['accept-unverified-scope'] && !flags['dry-run']) {
    return {ok: false, mode: 'work', blocked: 'stale-change-scope', staleCheck: 'stale', workId: found.workId,
      guidance: bodyChanged ? '판정을 확인한 뒤 티켓 원문이 바뀌었습니다. 다시 판정·확인한 뒤 연결하세요.'
        : '집은 뒤 판정을 다시 확인해 작업 정의가 바뀌었습니다. 다시 집은 뒤 연결하세요.'}
  }
  const decision = planWorkLink({plan, planDigest, state, changeScope, ticketKey, prUrl, completion, baseRef, flags})
  // 연결 기록은 **내 로컬**에 둔다 — 무엇을 인수했는지는 리뷰어가 보도록 PR 본문 문단으로 돌려준다.
  const payload = decision.ok ? decision.event?.payload ?? null : null
  const accepted = payload ? [payload.acceptedIncomplete && 'incomplete', payload.acceptedUnverifiedScope && 'unverified-scope',
    (definitionChanged || bodyChanged) && 'definition-change', bodyCheck && !bodyCheck.checked && 'unverified-scope'].filter(Boolean) : []
  const lang = resolveCommentLanguage({declared: readDeclaredLanguage(root), text: work?.title ?? ''})
  if (!decision.ok) return {mode: 'work', ...decision, ...(baseNote ? {baseSource: baseNote} : {})}
  if (decision.idempotent) {
    return {ok: true, mode: 'work', idempotent: true, workId: decision.workId, existing: decision.existing,
      staleCheck: decision.staleCheck, closeLine: workCloseLine(decision.provider, ticketKey)}
  }
  const closeLine = workCloseLine(decision.provider, decision.closes)
  // **완료의 근거는 PR 제목이나 브랜치 이름의 티켓 키다** — 보드·픽업이 머지된 PR을 그 키로 찾는다. 둘 다 없으면 머지돼도 끝난 줄 모른다.
  const titleKey = decision.closes ?? ticketKey
  const prTitleCheck = prTitle === null ? {checked: false, guidance: `PR을 읽지 못했습니다. 제목이 티켓 키로 시작하거나 브랜치 이름에 키가 있는지 확인하세요(예: [${titleKey}] … 또는 feature/${titleKey}-…).`}
    : prNamesKey({title: prTitle, branch: prBranch}, titleKey) ? {checked: true, ok: true, by: titleStartsWithKey(prTitle, titleKey) ? 'title' : 'branch'}
      : {checked: true, ok: false, guidance: `PR 제목을 티켓 키로 시작하거나 브랜치 이름에 키를 넣으세요(예: [${titleKey}] … 또는 feature/${titleKey}-…). 머지된 PR을 그 키로 찾아 완료로 봅니다.`}
  if (prTitleCheck.ok === false && !flags['dry-run']) {
    return {ok: false, mode: 'work', blocked: 'pr-title-key-required', workId: decision.workId, completion, prTitle: prTitleCheck, guidance: prTitleCheck.guidance}
  }
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
  // 리뷰어가 볼 문단 — 닫는 줄, 인수한 미충족, 사람이 더한 조건(자동 검증 아님). 개발자가 PR 본문에 넣는다.
  const summary = completion ? (lang === 'en' ? `Acceptance ${completion.checks.satisfied.length}/${completion.checks.total} · tests cited ${completion.testCases.cited.length}/${completion.testCases.total}`
    : `완료 조건 ${completion.checks.satisfied.length}/${completion.checks.total} · 테스트 인용 ${completion.testCases.cited.length}/${completion.testCases.total}`) : null
  const acceptedText = {incomplete: lang === 'en' ? 'accepted unmet acceptance (--accept-incomplete)' : '완료 조건 미충족을 인수했습니다(--accept-incomplete)',
    'unverified-scope': lang === 'en' ? 'accepted without the plan/scope check (--accept-unverified-scope)' : '범위 대조 없이 인수했습니다(--accept-unverified-scope)',
    'definition-change': lang === 'en' ? 'the ticket definition changed after pickup' : '집은 뒤 티켓 정의가 바뀌었습니다'}
  const prBody = [closeLine, summary, ...accepted.map(item => `- ${acceptedText[item]}`),
    ...list(decision.ticketAcceptance?.items).map(item => `- ${lang === 'en' ? 'Added on the ticket (verify in review)' : '티켓에서 더한 조건(리뷰에서 확인)'}: ${item.text ?? item}`)]
    .filter(Boolean).join('\n')
  if (flags['dry-run']) return {ok: true, mode: 'work', dryRun: true, prBody, completion, staleCheck: decision.staleCheck, closeLine, commitSplit, scopeDrift, prTitle: prTitleCheck, ...(bodyCheck ? {ticketBodyCheck: bodyCheck} : {}), ...ticketAcceptance}
  const record = {schemaVersion: 1, ticketKey: String(titleKey), workId: decision.workId, prUrl, baseRef: payload.baseRef, accepted,
    // 이 PR이 **어느 티켓 개정**을 보고 개발됐는가 — 대조한 범위일 때만 싣는다.
    ...(payload.ticket?.revision ? {ticketRevision: payload.ticket.revision} : {}),
    ...(ticketWork ? {definitionDigest: ticketDefinitionDigest(ticketWork.definition)} : {}), summary, at: new Date().toISOString()}
  mkdirSync(dirname(join(root, linkRecordPath(titleKey))), {recursive: true})
  writeFileSync(join(root, linkRecordPath(titleKey)), `${JSON.stringify(record, null, 2)}\n`)
  // 연결한 사람 티켓 작업의 판정서는 더 읽을 곳이 없다 — 확인한 정의는 등록 기록에 있다.
  if (ticketWork) rmSync(join(root, (await import('./ticket-work.mjs')).assessmentPath(ticketKey)), {force: true})
  // 성공 경로에서도 판정을 돌려준다 — 인수로 넘긴 미충족이 사용자에게 보이지 않으면 침묵이다.
  return {ok: true, mode: 'work', dryRun: false, workId: decision.workId, completion, staleCheck: decision.staleCheck, closeLine, prBody, commitSplit, scopeDrift, freshness,
    prTitle: prTitleCheck, ...(bodyCheck ? {ticketBodyCheck: bodyCheck} : {}), ...ticketAcceptance,
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
      states.set(url, {state: parsed?.state ?? null, baseRefName: parsed?.baseRefName ?? null, headRefName: parsed?.headRefName ?? null, title: parsed?.title ?? null, mergedAt: parsed?.mergedAt ?? null})
    } catch (error) {
      states.set(url, {error: String(error?.message ?? error).slice(0, 160)})
    }
  }
  return states
}

