// work-pickup-run.mjs — `pickup --work <티켓키>`: WORK 티켓을 개발에 넘기는 **실행부**.
//
// legacy 픽업과 **같은 것을 쓰고 같은 것을 쓰지 않는다**(I2·I6): 소유권 판정과 배정 직전
// 재조회(TOCTOU)는 같은 함수, 트래커 쓰기는 배정·경합 시 자기 배정 회수·`in-progress` 전이·되돌림 알림뿐이고
// 머지·완료 전이는 여기서도 하지 않는다. change-scope는 같은 파일·같은 키 집합으로 나간다.
import {existsSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {computeAssignmentPlan} from './assign.mjs'
import {canonicalDigest, WORK_ANALYSIS_PATH} from './work-analysis.mjs'
import {computeWorkView, WORK_PLAN_PATH} from './work-plan.mjs'
import {foldWorkState, readWorkEvents, WORK_EVENTS_PATH} from './work-events.mjs'
import {pickupWorkTicket} from './work-pickup.mjs'
import {resolveCommentLanguage} from './readiness.mjs'
import {readDeclaredLanguage} from './ticket-config.mjs'
import {parseFeaturePlanUnits} from './plan-units.mjs'
import {testCaseTexts} from './work-ticket-doc.mjs'
import {providerCapabilities} from './ticket-provider.mjs'
import {planRevisionsOnRemote, resolveCurrentBranch, resolveWorktreeStatus} from './git-origin.mjs'
import {readSpecAt, withinScope} from '../validate-spawn-plan.mjs'
import {normalizeLayerPath, testLayerPaths} from '../agent-registry.mjs'

const readJson = (root, relative) => {
  const path = join(root, relative)
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null
}

/**
 * @param {{root: string, ticketKey: string, developer: string, flags: object,
 *          io: {provider: object, resolveIssue?: Function, currentBranch?: Function, worktree?: Function}}} args
 */
/**
 * 사용자에게 보고할 결과 한 갈래(순수) — 결과 코드는 여러 개지만 사용자가 할 일은 넷뿐이다.
 * `assessing`은 스킬이 같은 턴에서 판정을 이어 가는 중간 상태라 사용자에게 보고하지 않는다.
 * @returns {'started'|'confirm'|'stopped'|'assessing'|'dry-run'}
 */
export function pickupOutcome(result) {
  if (result?.dryRun) return 'dry-run'
  if (result?.phase === 'TICKET_ASSESSMENT_REQUIRED') return 'assessing'
  if (result?.phase === 'TICKET_WORK_PREVIEW') return 'confirm'
  return result?.ok ? 'started' : 'stopped'
}

/**
 * 완료 조건은 이 작업의 TC를 인용하는 테스트다 — 소스와 **따로 둔** 테스트 레이어는 범위에 넣는다. 넣지 않으면
 * 소유권 훅이 범위와 교집합을 내 테스트 파일 쓰기를 막는다. 소스와 겹치는 레이어(테스트를 소스 옆에 둠)는 넣지
 * 않는다 — 넣으면 범위가 소스 전체로 넓어진다. 그때 테스트는 작업 경로 안에 둔다.
 */
export function separateTestLayers(spec) {
  // 양쪽을 정규화해 비교한다 — 끝 슬래시 하나로 같은 경로를 다르다고 읽으면 범위가 소스 전체로 넓어진다.
  const sources = Object.values(spec?.layerMap ?? {}).filter(path => typeof path === 'string' && path.trim()).map(normalizeLayerPath)
  return testLayerPaths(spec).map(normalizeLayerPath)
    .filter(test => !sources.some(source => withinScope(source, test) || withinScope(test, source)))
}

/** 이 티켓과 그 선행 작업의 트래커 끝남을 읽는다. 못 읽으면 원장만으로 판정한다(막지 않는다). */
async function readTrackerDone({provider, state, plan, ticketKey, config, root, io = {}}) {
  const {completedResolutionsOf, withTrackerCompletion} = await import('./work-provider.mjs')
  const entry = [...(state?.works?.entries() ?? [])].find(([, item]) => String(item.ticketKey) === String(ticketKey))
  const work = entry ? (plan?.workItems ?? []).find(item => item.workId === entry[0]) ?? entry[1].definition : null
  const keys = [ticketKey, ...(work?.dependsOn ?? []).map(dep => state.works.get(dep)?.ticketKey).filter(Boolean)].map(String)
  if (typeof provider?.listWorkIssues !== 'function') return {apply: value => value, read: {checked: false, reason: 'provider가 목록 조회를 주지 않는다'}}
  try {
    const listed = await provider.listWorkIssues({keys})
    const {readMergeEvidence} = await import('./work-board.mjs')
    const merged = await readMergeEvidence({provider, root, base: plan?.baseBranch ?? null, keys, io})
    const options = {completedResolutions: completedResolutionsOf(config, provider.name), mergeEvidence: merged.evidence}
    return {apply: value => withTrackerCompletion(value, listed.items, options),
      read: {checked: true, mergeEvidence: merged.checked, ...(merged.note ? {guidance: merged.note} : {})}}
  } catch (error) {
    const reason = String(error?.message ?? error).slice(0, 120)
    return {apply: value => value, read: {checked: false, reason, guidance: `트래커에서 이 티켓과 선행 작업이 끝났는지 확인하지 못해 원장만 봤습니다: ${reason}.`}}
  }
}

export async function runWorkPickup({root, ticketKey, developer, flags = {}, io = {}}) {
  const cli = await import('./cli.mjs')
  if (!ticketKey) return {ok: false, mode: 'work', bounce: {reason: 'ticket-key-required'}, guidance: '어느 티켓인지 키가 필요합니다. `pickup <티켓키> --developer <내 아이디>`로 부르세요.'}
  if (!developer) return {ok: false, mode: 'work', bounce: {reason: 'no-developer'}, guidance: '누가 집는지 알아야 합니다. `--developer <내 아이디>`를 붙여 주세요.'}
  const plan = readJson(root, WORK_PLAN_PATH)
  const analysis = readJson(root, WORK_ANALYSIS_PATH)
  // **판정 전에 origin 스냅샷을 갱신한다** — 로컬 계획·로컬 원장만 보면 남이 고친 계획을 못 보고
  // 「최신」이라 판정한다. 못 가져오면 막지 않고 `basis: local-snapshot`으로 **적는다**(legacy와 같다).
  const freshness = await cli.ensureRemoteFreshness({root, flags, io})
  // 받지 않은 계획 개정이 원격에 있으면 로컬 계획으로 판정하지 않는다 — 대체된 작업을 집을 수 있다.
  if (plan) {
    const remotePlan = await (io.planRemote ?? planRevisionsOnRemote)({repoRoot: root, base: plan.baseBranch ?? null})
    if (remotePlan.checked && remotePlan.commits.length > 0) {
      return {ok: false, mode: 'work', bounce: {reason: 'plan-behind-remote', ref: remotePlan.ref, commits: remotePlan.commits},
        guidance: `${remotePlan.ref}에 받지 않은 계획 개정이 있습니다. 받은 뒤 다시 집으세요.`, freshness}
    }
  }
  let state = foldWorkState(readWorkEvents(join(root, WORK_EVENTS_PATH)))
  const provider = io.provider
  // 계획이 없고 사람 티켓 경로도 쓸 수 없으면 **트래커를 부르기 전에** 멈춘다(읽기라도 부를 이유가 없다).
  const {hasDevTicketAxis} = await import('./ticket-work-run.mjs')
  if ((!plan || !analysis) && !hasDevTicketAxis(io.ticketConfig) && ![...state.works.values()].some(item => item.origin === 'ticket')) {
    return {ok: false, mode: 'work', bounce: {reason: 'plan-required'},
      guidance: '개발 계획이 아직 없습니다. `claim`으로 계획을 만들어 검토하고 발행한 뒤 집으세요. '
        + '사람이 트래커에 직접 만든 개발 티켓을 바로 집고 싶으면, 트래커 설정에서 어떤 분류가 개발 티켓인지 먼저 정하세요.'}
  }
  const fetchIssue = key => (io.resolveIssue ? io.resolveIssue({number: key}) : provider.resolveIssue(key))
  let issue = await fetchIssue(ticketKey)
  // 사람 티켓 작업은 **티켓이 등록 기록**이다 — 원장이 아니라 티켓에서 읽어 메모리 상태에 겹친다(선행 자리까지).
  const {readTicketRegistration, withTicketRegistrations} = await import('./ticket-work-run.mjs')
  const early = readTicketRegistration({issue, providerName: provider?.name, ticketKey, state})
  if (early && !early.error) state = withTicketRegistrations(state, [early])
  // 트래커의 끝남(완료·취소)을 이 티켓과 선행 작업에 겹친다 — 원장만 보면 트래커에서 끝난 선행을 기다리거나 취소된 작업을 집는다.
  let trackerDone = await readTrackerDone({provider, state, plan, ticketKey, config: io.ticketConfig, root, io})
  state = trackerDone.apply(state)
  // **사람이 만든 개발 티켓**이면 판정·확인·완성을 거쳐 같은 픽업으로 이어진다(ticket-work-run.mjs). 계획 WORK면 그대로 아래로 간다.
  const {resolveTicketPickup} = await import('./ticket-work-run.mjs')
  const ticket = await resolveTicketPickup({root, ticketKey, developer, issue, state, plan, flags, io})
  if (ticket.result) {
    if (ticket.result.notify) {
      const notify = io.notifyPlanner ?? cli.notifyPlanner
      const notified = await notify({provider, ticketKey, featureId: null, bounce: ticket.result.bounce, io, dryRun: flags['dry-run'],
        readinessLanguage: resolveCommentLanguage({declared: readDeclaredLanguage(root), text: issue?.title ?? ''})})
      const {notify: _flag, ...rest} = ticket.result
      return {...rest, ...notified, freshness}
    }
    const {notify: _unused, ...rest} = ticket.result
    return {...rest, freshness}
  }
  if (!ticket.context && (!plan || !analysis)) {
    return {ok: false, mode: 'work', bounce: {reason: 'plan-required'},
      guidance: '개발 계획이 아직 없습니다. `claim`으로 계획을 만들어 검토하고 발행한 뒤 집으세요. '
        + '사람이 트래커에 직접 만든 개발 티켓을 바로 집고 싶으면, 트래커 설정에서 어떤 분류가 개발 티켓인지 먼저 정하세요.'}
  }
  if (ticket.issue) issue = ticket.issue
  // 방금 등록했으면 원장을 다시 접는다 — 등록 전 상태로 판정하면 「원장에 없는 작업」으로 되돌린다.
  if (ticket.registration && !early) {
    // 방금 등록했다 — 선행 자리가 생겼으니 트래커 끝남을 다시 읽는다(등록 전 상태로 판정하면 선행을 모른다).
    state = withTicketRegistrations(state, [ticket.registration])
    trackerDone = await readTrackerDone({provider, state, plan, ticketKey, config: io.ticketConfig, root, io})
    state = trackerDone.apply(state)
  } else if (ticket.registration) state = trackerDone.apply(withTicketRegistrations(state, [ticket.registration]))
  const planDigest = ticket.context?.planDigest ?? canonicalDigest(plan)
  // **기본값은 실물이다.** 주입이 없을 때 빈 값을 쓰면 컨플릭 게이트가 영원히 발화하지 않는다
  // (적대 리뷰 2026-09-14: 「같은 함수를 쓴다」가 참이어도 입력이 비면 게이트는 없는 것과 같다).
  const currentBranch = await (io.currentBranch ?? resolveCurrentBranch)({repoRoot: root})
  const working = await (io.worktree ?? resolveWorktreeStatus)({repoRoot: root})

  // 소유권이 먼저다 — 남이 잡고 있으면 판정을 더 돌 이유가 없다(legacy와 같은 순서·같은 함수).
  const assignment = computeAssignmentPlan({issue, developer})
  if (assignment.status === 'taken') return {ok: false, mode: 'work', assignment, bounce: {reason: 'assigned-to-other', by: assignment.by}}
  // 나와 다른 사람이 함께 배정돼 있으면 내 것이라고 보지 않는다 — 회수하지 못한 경합 잔재와 사람이 둔 2인 배정은 구별되지 않는다.
  if (assignment.status === 'already-mine' && (issue?.assignees ?? []).length > 1) {
    return {ok: false, mode: 'work', assignment, bounce: {reason: 'multi-assign-detected', assignees: issue.assignees},
      guidance: '이 티켓에 여러 사람이 배정돼 있습니다. 한 사람만 남긴 뒤 다시 집으세요.'}
  }

  // TC 문장은 발행 때와 같은 곳(feature-plan)에서 읽는다 — 본문 항목 대조가 같은 문장을 기대해야 한다. 티켓 작업은 정의가 들고 있다.
  const units = ticket.context ? [] : (() => { try { return parseFeaturePlanUnits(readFileSync(join(root, '_workspace/01_plan/feature-plan.md'), 'utf8')) } catch { return [] } })()
  const pick = pickupWorkTicket({issue, plan: ticket.context?.plan ?? plan, planDigest, state,
    view: ticket.context ? null : computeWorkView(plan, analysis), currentBranch, working,
    testCaseTexts: ticket.context?.testCaseTexts ?? testCaseTexts(units), declaredLanguage: readDeclaredLanguage(root)})
  if (!pick.ok) {
    // 막힌 사실은 티켓으로 돌아간다 — 개발자 터미널에서 끝나면 계획을 고칠 사람이 모른다.
    const notify = io.notifyPlanner ?? cli.notifyPlanner
    const notified = await notify({provider, ticketKey, featureId: pick.changeScope?.featureId ?? null,
      bounce: pick.bounce, io, dryRun: flags['dry-run'],
      readinessLanguage: resolveCommentLanguage({declared: readDeclaredLanguage(root), text: `${issue?.title ?? ''}\n${issue?.body ?? ''}`})})
    return {...notified, ok: false, mode: 'work', bounce: pick.bounce, injection: pick.injection, assignment, freshness, trackerRead: trackerDone.read, ...(ticket.extra ?? {})}
  }
  if (flags['dry-run']) return {ok: true, mode: 'work', dryRun: true, assignment, changeScope: pick.changeScope, freshness, trackerRead: trackerDone.read, ...(ticket.extra ?? {})}

  // 진행 중인 다른 범위를 조용히 덮지 않는다 — 그 작업의 STALE 앵커가 사라진다(legacy와 같은 규율).
  const existing = cli.readChangeScopeFile(root)
  const existingId = existing?.workId ?? existing?.featureId ?? null
  // PR을 연결했거나 머지로 끝난 작업의 범위는 더 지킬 것이 없다 — STALE 대조는 link 때 끝나 원장에 남았다.
  // 이것을 「진행 중」으로 보면 개발자마다 두 번째 픽업부터 막힌다.
  const settled = existingId ? Boolean(state?.works?.get(existingId)?.link?.prUrl || state?.works?.get(existingId)?.completed) : false
  if (existing && existingId !== pick.changeScope.workId && !settled && !flags['replace-scope']) {
    return {ok: false, mode: 'work', bounce: {reason: 'active-change-scope', active: existingId},
      guidance: `${existingId} 작업을 이미 집어 둔 상태입니다. 그 작업을 끝내거나, 바꾸려면 --replace-scope를 붙이세요.`}
  }
  if (assignment.action === 'self-assign') {
    // 판정 뒤 남이 먼저 잡았을 수 있다 — 배정 **직전에** 다시 조회해 양보한다(CAS가 없다).
    const fresh = await fetchIssue(ticketKey)
    if (computeAssignmentPlan({issue: fresh, developer}).status === 'taken') {
      return {ok: false, mode: 'work', bounce: {reason: 'assigned-to-other', by: fresh.assignees?.[0] ?? null},
        guidance: '그 사이 다른 개발자가 이 티켓을 가져갔습니다. 다른 작업을 고르세요.'}
    }
    await provider.assign(ticketKey, developer)
    const after = await fetchIssue(ticketKey)
    const assignees = after.assignees ?? []
    if (!assignees.includes(developer)) {
      return {ok: false, mode: 'work', bounce: {reason: 'assign-lost', assignees},
        guidance: '배정 직후 다른 개발자도 이 티켓을 가져갔습니다. 누가 할지 팀과 정하세요.'}
    }
    // GitHub의 배정은 **덧붙임**이라 동시에 집으면 둘 다 자기 이름을 본다 — 소유가 하나인지도 본다.
    // 남이 먼저 혼자 보고 시작했을 수 있으므로 **남을 본 쪽이 물러난다**. 동시에 보면 둘 다 물러나고 다시 집으면 된다.
    // 그대로 두면 둘 다 「내 배정」으로 읽혀 보드와 재픽업에서 같은 작업을 둘이 시작한다.
    if (assignees.length > 1) {
      let unassignError = null
      const released = typeof provider.unassign === 'function'
        ? await provider.unassign(ticketKey, developer).then(() => true, error => { unassignError = String(error?.message ?? error).slice(0, 200); return false }) : false
      if (released) {
        return {ok: false, mode: 'work', bounce: {reason: 'assigned-to-other', by: assignees.find(login => login !== developer) ?? null},
          guidance: '같은 때 다른 개발자도 이 티켓을 집어 물러났습니다. 다른 작업을 고르거나 잠시 뒤 다시 집으세요.'}
      }
      return {ok: false, mode: 'work', bounce: {reason: 'multi-assign-detected', assignees,
        ...(unassignError ? {unassign: {attempted: true, error: unassignError}} : {})},
        guidance: '두 사람이 같은 티켓에 배정돼 있습니다. 누가 할지 팀과 정하세요.'}
    }
  }
  // 전이는 **능력이 있을 때만**. 없으면 조용히 넘기지 않고 표시한다 — 안 한 것과 못 한 것은 다르다.
  const caps = providerCapabilities(provider)
  let transition = {supported: caps.transition, done: false}
  if (caps.transition) {
    try {
      const result = await provider.transition(ticketKey, 'in-progress')
      transition = {supported: true, done: Boolean(result?.transitioned), ...(result?.reason ? {reason: result.reason} : {})}
    } catch (error) {
      transition = {supported: true, done: false, error: String(error?.message ?? error).slice(0, 200)}
    }
  }
  // 개정은 우리가 한 배정·전이 **뒤에** 다시 잰다 — 그 전 값을 적으면 우리 쓰기가 나중에
  // 「픽업 뒤 티켓이 바뀌었다」로 읽힌다. 못 재면 이유를 적고 픽업 전 값을 그대로 둔다.
  try {
    const settled = await fetchIssue(ticketKey)
    if (!settled?.revision) throw new Error('settle-fetch-empty')
    pick.changeScope.ticket = {...pick.changeScope.ticket, revision: settled.revision, revisionStage: 'settled-at-pickup'}
  } catch (error) {
    pick.changeScope.ticket = {...pick.changeScope.ticket, revisionError: String(error?.message ?? error).slice(0, 200)}
  }
  // **대상 지문을 찍어 둔다.** 완료를 주장할 때 check 대상이 그대로면 이 작업의 결과가 아니다 —
  // 이미 있던 경로를 대상으로 적은 기반 작업이 아무것도 하지 않고 통과하는 것을 막는 앵커다.
  const {projectRefDigest} = await import('./work-link.mjs')
  const digestOf = io.refDigest ?? projectRefDigest(root)
  // 같은 작업을 다시 집으면(계획 개정 뒤 등) **처음 찍은 지문을 잇는다** — 이미 고친 대상을 새 기준선으로 찍으면
  // 한 일이 「대상이 그대로다」로 읽혀 연결이 막힌다.
  // 되돌린(reopen) 작업은 잇지 않는다 — 되돌림이 대상을 다 지우지 못했으면 옛 지문 때문에 빈 PR이 「바뀌었다」로 읽힌다.
  const earlier = existing?.workId === pick.changeScope.workId && !state?.works?.get(pick.changeScope.workId)?.reopened
    ? new Map((Array.isArray(existing.checks) ? existing.checks : []).filter(check => check.checkId && check.baseline).map(check => [check.checkId, check.baseline])) : new Map()
  pick.changeScope.checks = pick.changeScope.checks.map(check => ({...check,
    // 없던 대상의 지문은 null이다 — 「기록 없음」과 구별해 키가 있으면 그 값을 잇는다.
    baseline: Object.fromEntries(check.targetRefs.map(ref => [ref, Object.hasOwn(earlier.get(check.checkId) ?? {}, ref) ? earlier.get(check.checkId)[ref] : digestOf(ref)]))}))
  pick.changeScope.ALLOWED_PATHS = [...new Set([...pick.changeScope.ALLOWED_PATHS, ...separateTestLayers(readSpecAt(root))])]
  // 사람 티켓 작업은 **본문이 정의**다 — 집을 때의 정의 지문을 적어 두면, 그 뒤 본문을 고쳤을 때 link가 STALE로 알아본다.
  const ticketDefinition = state?.works?.get(pick.changeScope.workId)?.origin === 'ticket' ? state.works.get(pick.changeScope.workId).definition : null
  if (ticketDefinition) pick.changeScope.definitionDigest = (await import('./ticket-work.mjs')).ticketDefinitionDigest(ticketDefinition)
  const written = cli.writeChangeScopeFile(root, pick.changeScope)
  // 무엇을 보고 판정했는지 결과에 남긴다 — 재지 못한 것(`statusUnknown`)을 「깨끗하다」로 접지 않는다.
  return {ok: true, mode: 'work', dryRun: false, assignment, transition, changeScope: pick.changeScope, changeScopePath: written, freshness, trackerRead: trackerDone.read, worktree: working, ...(ticket.extra ?? {})}
}
