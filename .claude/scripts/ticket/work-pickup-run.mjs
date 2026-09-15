// work-pickup-run.mjs — `pickup --work <티켓키>`: WORK 티켓을 개발에 넘기는 **실행부**.
//
// legacy 픽업과 **같은 것을 쓰고 같은 것을 쓰지 않는다**(I2·I6): 소유권 판정과 배정 직전
// 재조회(TOCTOU)는 같은 함수, 트래커 쓰기는 배정·`in-progress` 전이·되돌림 알림 셋뿐이고
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
import {resolveCurrentBranch, resolveWorktreeStatus} from './git-origin.mjs'

const readJson = (root, relative) => {
  const path = join(root, relative)
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null
}

/**
 * @param {{root: string, ticketKey: string, developer: string, flags: object,
 *          io: {provider: object, resolveIssue?: Function, currentBranch?: Function, worktree?: Function}}} args
 */
export async function runWorkPickup({root, ticketKey, developer, flags = {}, io = {}}) {
  const cli = await import('./cli.mjs')
  if (!ticketKey) return {ok: false, mode: 'work', bounce: {reason: 'ticket-key-required'}, guidance: '어느 WORK 티켓인지 키를 준다: `pickup --work <티켓키> --developer <나>`'}
  if (!developer) return {ok: false, mode: 'work', bounce: {reason: 'no-developer'}, guidance: '--developer <login> 필요(소유권 판정 주체)'}
  const plan = readJson(root, WORK_PLAN_PATH)
  const analysis = readJson(root, WORK_ANALYSIS_PATH)
  if (!plan || !analysis) {
    return {ok: false, mode: 'work', bounce: {reason: 'plan-required'},
      guidance: 'WORK 계획이 없다 — `claim`로 분석·계획을 만들고 검토·발행한 뒤 픽업한다'}
  }
  // **판정 전에 origin 스냅샷을 갱신한다** — 로컬 계획·로컬 원장만 보면 남이 고친 계획을 못 보고
  // 「최신」이라 판정한다. 못 가져오면 막지 않고 `basis: local-snapshot`으로 **적는다**(legacy와 같다).
  const freshness = await cli.ensureRemoteFreshness({root, flags, io})
  const planDigest = canonicalDigest(plan)
  const state = foldWorkState(readWorkEvents(join(root, WORK_EVENTS_PATH)))
  const provider = io.provider
  const fetchIssue = key => (io.resolveIssue ? io.resolveIssue({number: key}) : provider.resolveIssue(key))
  const issue = await fetchIssue(ticketKey)
  // **기본값은 실물이다.** 주입이 없을 때 빈 값을 쓰면 컨플릭 게이트가 영원히 발화하지 않는다
  // (적대 리뷰 2026-09-14: 「같은 함수를 쓴다」가 참이어도 입력이 비면 게이트는 없는 것과 같다).
  const currentBranch = await (io.currentBranch ?? resolveCurrentBranch)({repoRoot: root})
  const working = await (io.worktree ?? resolveWorktreeStatus)({repoRoot: root})

  // 소유권이 먼저다 — 남이 잡고 있으면 판정을 더 돌 이유가 없다(legacy와 같은 순서·같은 함수).
  const assignment = computeAssignmentPlan({issue, developer})
  if (assignment.status === 'taken') return {ok: false, mode: 'work', assignment, bounce: {reason: 'assigned-to-other', by: assignment.by}}

  const view = computeWorkView(plan, analysis)
  // TC 문장은 발행 때와 같은 곳(feature-plan)에서 읽는다 — 본문 항목 대조가 같은 문장을 기대해야 한다.
  const units = (() => { try { return parseFeaturePlanUnits(readFileSync(join(root, '_workspace/01_plan/feature-plan.md'), 'utf8')) } catch { return [] } })()
  const pick = pickupWorkTicket({issue, plan, planDigest, state, view, currentBranch, working,
    testCaseTexts: testCaseTexts(units), declaredLanguage: readDeclaredLanguage(root)})
  if (!pick.ok) {
    // 막힌 사실은 티켓으로 돌아간다 — 개발자 터미널에서 끝나면 계획을 고칠 사람이 모른다.
    const notify = io.notifyPlanner ?? cli.notifyPlanner
    const notified = await notify({provider, ticketKey, featureId: pick.changeScope?.featureId ?? null,
      bounce: pick.bounce, io, dryRun: flags['dry-run'],
      readinessLanguage: resolveCommentLanguage({declared: readDeclaredLanguage(root), text: `${issue?.title ?? ''}\n${issue?.body ?? ''}`})})
    return {...notified, ok: false, mode: 'work', bounce: pick.bounce, injection: pick.injection, assignment, freshness}
  }
  if (flags['dry-run']) return {ok: true, mode: 'work', dryRun: true, assignment, changeScope: pick.changeScope, freshness}

  // 진행 중인 다른 범위를 조용히 덮지 않는다 — 그 작업의 STALE 앵커가 사라진다(legacy와 같은 규율).
  const existing = cli.readChangeScopeFile(root)
  const existingId = existing?.workId ?? existing?.featureId ?? null
  if (existing && existingId !== pick.changeScope.workId && !flags['replace-scope']) {
    return {ok: false, mode: 'work', bounce: {reason: 'active-change-scope', active: existingId},
      guidance: `${existingId} 픽업이 진행 중이다 — 끝내거나 --replace-scope로 명시 교체한다(그 범위의 STALE 앵커가 사라진다)`}
  }
  if (assignment.action === 'self-assign') {
    // 판정 뒤 남이 먼저 잡았을 수 있다 — 배정 **직전에** 다시 조회해 양보한다(CAS가 없다).
    const fresh = await fetchIssue(ticketKey)
    if (computeAssignmentPlan({issue: fresh, developer}).status === 'taken') {
      return {ok: false, mode: 'work', bounce: {reason: 'assigned-to-other', by: fresh.assignees?.[0] ?? null},
        guidance: '판정 이후 다른 개발자가 먼저 배정했다 — 다른 작업을 고른다'}
    }
    await provider.assign(ticketKey, developer)
    const after = await fetchIssue(ticketKey)
    const assignees = after.assignees ?? []
    if (!assignees.includes(developer)) {
      return {ok: false, mode: 'work', bounce: {reason: 'assign-lost', assignees},
        guidance: '배정 직후 다른 개발자가 배정을 가져갔다 — 팀과 조율한다(자동 판정하지 않는다)'}
    }
    // GitHub의 배정은 **덧붙임**이라 동시에 집으면 둘 다 자기 이름을 본다 — 소유가 하나인지도 본다.
    if (assignees.length > 1) {
      return {ok: false, mode: 'work', bounce: {reason: 'multi-assign-detected', assignees},
        guidance: '동시 배정이 감지됐다 — 한 명이 양보하도록 팀과 조율한다(자동 판정하지 않는다)'}
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
  pick.changeScope.checks = pick.changeScope.checks.map(check => ({...check,
    baseline: Object.fromEntries(check.targetRefs.map(ref => [ref, digestOf(ref)]))}))
  const written = cli.writeChangeScopeFile(root, pick.changeScope)
  // 무엇을 보고 판정했는지 결과에 남긴다 — 재지 못한 것(`statusUnknown`)을 「깨끗하다」로 접지 않는다.
  return {ok: true, mode: 'work', dryRun: false, assignment, transition, changeScope: pick.changeScope, changeScopePath: written, freshness, worktree: working}
}
