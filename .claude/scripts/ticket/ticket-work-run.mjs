// ticket-work-run.mjs — 사람이 만든 개발 티켓의 픽업 실행부. `pickup`이 부른다(입구는 하나다).
//
// 순서: 개발 티켓인가(팀이 선언한 분류) → 계획 WORK가 아닌가 → 인젝션 스캔(fail-closed) → 판정서가 있는가 → CLI 검증 → 착수 불가면 판정 라벨·요청 코멘트 →
// 착수 가능이면 **미리보기**(외부 쓰기 0) → 개발자가 판정서 지문으로 확인 → 티켓 완성(원문 보존·작업 마커) · 역할 라벨 → 기존 WORK 픽업으로 이어진다.
// **티켓이 등록 기록이다** — 원장에 쓰지 않는다. 다른 클론도 같은 티켓을 읽어 같은 등록을 본다. 확인 전에는 트래커에 쓰지 않는다.
import {existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {buildWorkMarker, classifyTicketKind, parseWorkMarker, stripWorkMarker} from './work-refs.mjs'
import {quarantineExcerpt, scanUntrustedIssue} from './pickup.mjs'
import {classifyByComponent, DEV_TICKET} from './intake.mjs'
import {computeAssignmentPlan} from './assign.mjs'
import {normalizeDocItem, parseWorkDocSections} from './work-ticket-doc.mjs'
import {resolveCommentLanguage} from './readiness.mjs'
import {readDeclaredLanguage} from './ticket-config.mjs'
import {assessmentDigest, assessmentPath, assessmentSnapshotPath, originalBodyOf, parseTicketWorkBody, renderTicketWorkBody, ticketPlanId, ticketVirtualPlan,
  ticketWorkDefinition, ticketWorkId, validateTicketAssessment, VERDICT_LABELS} from './ticket-work.mjs'

const list = value => (Array.isArray(value) ? value : [])
const readJson = (root, relative) => {
  const path = join(root, relative)
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null
}
const keyOf = issue => issue?.ticketKey ?? issue?.key ?? (issue?.number != null ? String(issue.number) : null)

/** 팀이 선언한 분류로 개발 티켓인가(순수) — Jira 컴포넌트 축, GitHub 라벨 축. 선언이 없으면 판단하지 않는다. */
export function isDevTicket(issue, config) {
  const byComponent = classifyByComponent(issue?.components ?? [], config?.jira?.componentAxis ?? config?.componentAxis ?? null)
  if (byComponent?.role === DEV_TICKET) return {dev: true, by: byComponent.by}
  const byLabel = classifyByComponent(issue?.labels ?? [], config?.github?.labelAxis ?? config?.labelAxis ?? null)
  if (byLabel?.role === DEV_TICKET) return {dev: true, by: byLabel.by.replace(/^component:/, 'label:')}
  return {dev: false}
}

/** 개발 티켓 분류가 선언돼 있는가(순수) — 없으면 사람 티켓 경로를 쓸 수 없다. */
export function hasDevTicketAxis(config) {
  const axes = [config?.jira?.componentAxis, config?.componentAxis, config?.github?.labelAxis, config?.labelAxis]
  return axes.some(axis => axis && typeof axis === 'object' && Object.values(axis).includes(DEV_TICKET))
}

/** 티켓 작업의 픽업 문맥(순수) — 계획 WORK 픽업과 같은 코드가 탄다. */
export function ticketPickupContext(registered) {
  const definition = registered.definition
  return {plan: ticketVirtualPlan(definition, registered.planId), planDigest: registered.planDigest, view: null,
    testCaseTexts: new Map(list(definition.testCases).map(item => [item.id, item.text]))}
}

/**
 * 티켓에서 사람 티켓 작업의 등록을 읽는다(순수) — 이 키에서 나온 작업 마커가 있으면 등록된 것이고, 정의는 본문이다.
 * 착수 불가 판정 라벨이 붙어 있으면 거둔 작업이다. 등록이 아니면 `null`, 마커는 맞는데 본문을 못 읽으면 `error`.
 */
export function readTicketRegistration({issue, providerName, ticketKey, state = null}) {
  const workId = ticketWorkId(providerName, ticketKey)
  const marker = parseWorkMarker(issue?.body ?? '')
  if (!marker?.workId || marker.workId !== workId) return null
  const byKey = new Map([...(state?.works?.entries() ?? [])].filter(([, item]) => item.ticketKey).map(([id, item]) => [String(item.ticketKey), id]))
  const parsed = parseTicketWorkBody({body: issue.body, ticketKey, provider: providerName, title: issue?.title,
    depWorkIdOf: key => byKey.get(String(key)) ?? ticketWorkId(providerName, key)})
  if (parsed.error) return {workId, ticketKey: String(ticketKey), error: parsed.error}
  const verdict = VERDICT_LABELS.find(label => list(issue?.labels).includes(label)) ?? null
  return {workId, ticketKey: String(ticketKey), provider: providerName, planId: marker.planId, planDigest: marker.planDigest, definition: parsed.definition,
    dependsOnKeys: parsed.dependsOnKeys, withdrawn: verdict ? {verdict} : null}
}

/**
 * 트래커에서 읽은 등록·판정을 **메모리의** 상태에 겹친다(순수) — 원장에는 쓰지 않는다. 보드·겹침·선행·link가 계획 작업과 같은 코드를 탄다.
 * 선행 키만 아는 작업은 그 키로 트래커 끝남을 겹칠 수 있게 자리만 둔다.
 */
export function withTicketRegistrations(state, registrations = [], verdicts = []) {
  const works = new Map(state?.works ?? [])
  const tickets = new Map(state?.tickets ?? [])
  for (const registration of registrations.filter(item => item && !item.error)) {
    works.set(registration.workId, {...(works.get(registration.workId) ?? {}), status: 'published', origin: 'ticket', ticketKey: registration.ticketKey,
      provider: registration.provider ?? null,
      planId: registration.planId, planDigest: registration.planDigest, definition: registration.definition,
      ...(registration.withdrawn ? {withdrawn: registration.withdrawn} : {})})
    registration.definition.dependsOn.forEach((dep, index) => {
      const key = registration.dependsOnKeys[index]
      if (key && !dep.startsWith('UNRESOLVED:') && !works.has(dep)) works.set(dep, {status: 'published', origin: 'ticket', ticketKey: key, placeholder: true})
    })
  }
  for (const {ticketKey, verdict, workId} of verdicts) if (!tickets.has(String(ticketKey))) tickets.set(String(ticketKey), {verdict, workId})
  return {...(state ?? {}), works, tickets}
}

/** 수정 범위가 겹치는지 볼 진행 중 작업(순수) — 발행·등록됐고 머지로 끝나지 않은 계획·티켓 작업. */
export function activeWorksFrom({plan, state, exceptWorkId}) {
  const planWorks = new Map(list(plan?.workItems).map(work => [work.workId, work]))
  return [...(state?.works?.entries() ?? [])]
    .filter(([workId, item]) => workId !== exceptWorkId && item.status === 'published' && !item.completed && !item.withdrawn)
    .map(([workId, item]) => ({workId, writePaths: list(item.origin === 'ticket' ? item.definition?.writePaths : planWorks.get(workId)?.writePaths)}))
    .filter(work => work.writePaths.length > 0)
}

/**
 * 트래커의 개발 티켓에서 사람 티켓 작업의 등록과 착수 불가 판정을 읽는다. 티켓이 등록 기록이므로 모든 클론이 같은 것을 본다.
 * 못 읽으면 `checked: false`와 이유 — 부른 쪽이 막지 않고 알린다.
 */
export async function readTrackerTicketRegistrations({provider, config, io = {}, state = null, exceptKey = null, onlyAssigned = false}) {
  if (typeof provider?.listDevTickets !== 'function') return {checked: false, reason: 'provider가 개발 티켓 목록을 주지 않는다', registrations: [], verdicts: [], items: []}
  try {
    const listed = await provider.listDevTickets({config})
    const items = list(listed.items)
    const candidates = items.filter(item => String(item.ticketKey) !== String(exceptKey) && (!onlyAssigned || list(item.assignees).length > 0))
    // 한 티켓을 못 읽었다고 나머지를 버리지 않는다 — 못 읽은 것은 건별로 알린다.
    const issues = new Map()
    const registrations = (await Promise.allSettled(candidates.map(async item => {
      const issue = await (io.resolveIssue ? io.resolveIssue({number: item.ticketKey}) : provider.resolveIssue(item.ticketKey))
      issues.set(String(item.ticketKey), issue)
      return readTicketRegistration({issue, providerName: provider.name, ticketKey: item.ticketKey, state})
    }))).map((outcome, index) => (outcome.status === 'fulfilled' ? outcome.value
      : {workId: ticketWorkId(provider.name, candidates[index].ticketKey), ticketKey: String(candidates[index].ticketKey), error: `티켓을 읽지 못했다: ${String(outcome.reason?.message ?? outcome.reason).slice(0, 120)}`}))
      .filter(Boolean)
    const registered = new Set(registrations.map(item => item.ticketKey))
    const verdicts = items.filter(item => !registered.has(String(item.ticketKey)))
      .map(item => ({ticketKey: String(item.ticketKey), verdict: VERDICT_LABELS.find(label => list(item.labels).includes(label)) ?? null,
        workId: ticketWorkId(provider.name, item.ticketKey)}))
      .filter(item => item.verdict)
    return {checked: listed.complete !== false, ...(listed.complete === false ? {reason: '개발 티켓 목록이 잘렸다'} : {}), registrations, verdicts, items, issues}
  } catch (error) {
    return {checked: false, reason: String(error?.message ?? error).slice(0, 120), registrations: [], verdicts: [], items: []}
  }
}

/** 남이 집은 진행 중 사람 티켓 작업의 수정 범위 — 겹침 판정의 입력이다(배정된 것만). */
export async function trackerActiveTicketWorks(args) {
  const read = await readTrackerTicketRegistrations({...args, onlyAssigned: true})
  // 못 읽은 티켓의 수정 범위는 대조하지 못했다 — 대조했다고 접지 않는다.
  const unreadable = read.registrations.filter(item => item.error).map(item => item.ticketKey)
  const reason = read.reason ?? (unreadable.length > 0 ? `티켓 ${unreadable.join(', ')}을(를) 읽지 못했다` : null)
  const registrations = read.registrations.filter(item => !item.error && !item.withdrawn && item.definition.writePaths.length > 0)
  return {checked: read.checked && unreadable.length === 0, ...(reason ? {reason} : {}), ...(unreadable.length ? {unreadable} : {}),
    registrations, issues: read.issues ?? new Map(),
    works: registrations.filter(item => !args.state?.works?.get(item.workId)?.completed)
      .map(item => ({workId: item.workId, ticketKey: item.ticketKey, writePaths: item.definition.writePaths, source: 'tracker'}))}
}

/**
 * @returns {Promise<{result?: object, context?: object, issue?: object, extra?: object, registration?: object}>}
 *   result: 여기서 끝났다(판정 요구·검증 실패·착수 불가·미리보기·쓰기 실패) · context: 계획 WORK 픽업으로 이어간다 · 둘 다 없으면 이 경로가 아니다
 *   registration: 이 티켓의 등록(메모리 상태에 겹칠 것)
 */
export async function resolveTicketPickup({root, ticketKey, developer, issue, state, plan, flags = {}, io = {}}) {
  const provider = io.provider
  const config = io.ticketConfig ?? {}
  const providerName = provider?.name
  const works = [...(state?.works?.entries() ?? [])]
  const kind = classifyTicketKind(issue?.body ?? '')
  const marker = kind.kind === 'work' ? parseWorkMarker(issue.body) : null
  const registered = readTicketRegistration({issue, providerName, ticketKey, state})
  if (registered?.error) {
    return {result: {ok: false, mode: 'work', phase: 'TICKET_BODY_UNREADABLE', ticketKey, externalWrites: 0,
      bounce: {reason: 'ticket-body-unreadable', detail: registered.error},
      guidance: '등록된 티켓의 완료 조건·수정 범위 섹션을 읽지 못했습니다. 섹션 제목을 되돌리거나 다시 판정하세요.'}}
  }
  if (!registered && marker?.workId) return {} // 다른 작업의 마커 — 계획 WORK다
  const dev = isDevTicket(issue, config)
  if (!registered && !dev.dev) return {}
  // **하네스가 만든 다른 모델의 티켓**(집계·공급 원문·옛 FEAT·마커 충돌)은 개발 분류가 붙어도 판정하지 않는다 —
  // 흘려보내면 집계 본문이 WORK로 덮이고 다음 발행이 다시 덮는다(intake가 같은 경우를 막는 것과 같은 축).
  const foreignKind = kind.error ? kind.kind : ['aggregate', 'source', 'legacy', 'conflict'].includes(kind.kind) ? kind.kind : null
  const aggregateKey = [...(state?.aggregates?.values() ?? [])].some(item => item.ticketKey && String(item.ticketKey) === String(ticketKey))
  if (!registered && (foreignKind || aggregateKey)) {
    return {result: {ok: false, mode: 'work', phase: 'TICKET_NOT_DEV_WORK', ticketKey, externalWrites: 0,
      bounce: {reason: `${foreignKind ?? 'aggregate'}-ticket-not-dev`, ...(kind.error ? {detail: kind.error} : {})}}}
  }
  // **마커를 못 읽은 계획 WORK**(속성 읽기 실패·사람이 지운 마커)에 개발 분류가 붙어 있어도 사람 티켓으로 다시 등록하지 않는다 —
  // 원장은 이 키를 계획 작업으로 발행했다고 안다. 여기서 흘려보내면 계획 WORK 본문이 판정서로 덮인다.
  const planWork = works.find(([, item]) => item.status === 'published' && item.origin !== 'ticket' && String(item.ticketKey) === String(ticketKey))
  if (planWork) {
    return {result: {ok: false, mode: 'work', phase: 'TICKET_IS_PLAN_WORK', ticketKey, externalWrites: 0,
      bounce: {reason: 'work-marker-missing', workId: planWork[0], ticketKey: String(ticketKey)}}}
  }
  // 남이 맡은 티켓이면 판정부터 하지 않는다 — 판정 에이전트를 헛되이 띄우고 확인 단계에서야 막히던 것을 앞당긴다.
  if (computeAssignmentPlan({issue, developer}).status === 'taken') {
    return {result: {ok: false, mode: 'work', phase: 'TICKET_ASSIGNED_TO_OTHER', ticketKey, externalWrites: 0,
      bounce: {reason: 'assigned-to-other', by: issue?.assignees?.[0] ?? null}, guidance: '다른 개발자가 맡은 티켓입니다. 다른 작업을 고르세요.'}}
  }
  // **비신뢰 원문 스캔이 먼저다** — 판정 요청 스냅샷·미리보기·트래커 쓰기 모두 이 뒤에 온다(fail-closed).
  const injection = scanUntrustedIssue(issue)
  if (injection.injectionSuspect) {
    return {result: {ok: false, mode: 'work', phase: 'TICKET_INJECTION_SUSPECT', ticketKey, externalWrites: 0, injection,
      bounce: {reason: 'injection-suspect', markers: injection.markers, sources: injection.sources}}}
  }

  const path = assessmentPath(ticketKey)
  let assessment = null
  try { assessment = readJson(root, path) } catch (error) {
    // 등록된 작업은 판정서 없이도 이어간다 — 파손된 판정서 파일이 확인된 작업의 픽업까지 막지 않는다.
    if (registered && !registered.withdrawn) return {registration: registered, context: ticketPickupContext(registered), extra: {ticketWork: {note: `판정서를 읽지 못해 등록된 판정으로 이어간다: ${String(error?.message ?? error).slice(0, 120)}`}}}
    return {result: {ok: false, mode: 'work', phase: 'TICKET_ASSESSMENT_INVALID', ticketKey, path, errors: [`판정서를 읽지 못했다: ${String(error?.message ?? error).slice(0, 160)}`]}}
  }
  // 등록된 작업이고 판정서가 그대로면(또는 없으면) 계획 WORK처럼 이어서 픽업한다. 판정으로 거둔 작업은 다시 판정을 탄다.
  if (registered && !registered.withdrawn && (!assessment || assessmentDigest(assessment) === registered.planDigest)) {
    return {registration: registered, context: ticketPickupContext(registered)}
  }
  if (!assessment) {
    // 판정할 에이전트에게 원문을 **격리 스냅샷**으로 준다 — 트래커 본문을 지시로 읽지 않게(에이전트가 쓸 수 없는 자리).
    const snapshot = assessmentSnapshotPath(ticketKey)
    if (!flags['dry-run']) {
      mkdirSync(dirname(join(root, snapshot)), {recursive: true})
      writeFileSync(join(root, snapshot), `${quarantineExcerpt({...issue, body: stripWorkMarker(issue?.body ?? '')})}\n`)
    }
    return {result: {ok: false, mode: 'work', phase: 'TICKET_ASSESSMENT_REQUIRED', ticketKey, externalWrites: 0,
      bounce: {reason: 'ticket-assessment-required', by: registered?.withdrawn ? 'withdrawn' : dev.by},
      next: {agent: 'system-architect', mode: 'ticket-assessment', writes: path,
        contract: '.claude/skills/team-flow/references/ticket-work-contract.md',
        reads: [flags['dry-run'] ? '(dry-run — 격리 스냅샷을 쓰지 않았다)' : snapshot, '_workspace/03_dev/spec.json', '현재 코드', '_workspace/03_dev/work-plan.json(있으면)']},
      guidance: `사람이 만든 개발 티켓입니다(${dev.by ?? '등록된 티켓 작업'}). 기획이나 디자인이 더 필요한지 먼저 판정합니다. system-architect가 ${path}를 쓴 뒤 다시 pickup을 부르세요.`}}
  }

  const workId = ticketWorkId(providerName, ticketKey)
  const planWorkIds = list(plan?.workItems).map(work => work.workId)
  const ticketIds = works.filter(([, item]) => item.origin === 'ticket').map(([id]) => id)
  const originalBody = originalBodyOf(issue?.body ?? '', {completed: Boolean(registered) || kind.kind === 'work'})
  const spec = (() => { try { return readJson(root, '_workspace/03_dev/spec.json') } catch { return null } })()
  // 착수할 판정일 때만 트래커를 더 읽는다 — 남이 다른 클론에서 방금 등록한 작업과 경계가 겹치는지.
  const remote = assessment?.verdict === 'startable' ? await trackerActiveTicketWorks({provider, config, state, exceptKey: ticketKey, io}) : null
  // 머지로 끝난 작업은 트래커에 열려 있어도(하네스는 완료 전이를 하지 않는다) 수정 범위를 쥐지 않는다 — 완료는 원장에 없으니
  // 발행한 계획 작업과 남의 티켓 작업 전부에 트래커·PR에서 읽은 완료를 겹친다.
  let active = {local: state, remote: remote?.works ?? []}
  if (remote) {
    const {readTrackerWorkState} = await import('./work-state-run.mjs')
    const read = await readTrackerWorkState({provider, state: withTicketRegistrations(state, remote.registrations), root, plan,
      config: io.ticketConfig ?? null, io, issues: remote.issues})
    active = {local: {...read.state, works: new Map([...read.state.works].filter(([id]) => state?.works?.has(id)))},
      remote: remote.works.filter(work => !read.state.works.get(work.workId)?.completed)}
  }
  const checked = validateTicketAssessment({assessment, ticketKey, provider: providerName, originalBody, spec,
    activeWorks: [...activeWorksFrom({plan, state: active.local, exceptWorkId: workId}), ...active.remote], knownWorkIds: new Set([...planWorkIds, ...ticketIds])})
  if (!checked.ok) return {result: {ok: false, mode: 'work', phase: 'TICKET_ASSESSMENT_INVALID', ticketKey, path, errors: checked.errors}}
  // 격리 사본은 판정 한 번을 위한 것이다 — 판정서가 검증을 통과하면 지운다(실패하면 다시 판정해야 하므로 남긴다).
  if (!flags['dry-run']) rmSync(join(root, assessmentSnapshotPath(ticketKey)), {force: true})
  const digest = checked.digest
  // 겹침은 판정보다 먼저 본다 — 착수할 수 없는 판정으로 티켓을 채우지 않는다.
  if (assessment.verdict === 'startable' && checked.bounce) {
    return {result: {ok: false, mode: 'work', phase: 'TICKET_NOT_STARTABLE', ticketKey, externalWrites: 0, bounce: checked.bounce}}
  }
  if (assessment.verdict !== 'startable') {
    // 착수 불가 — **판정 라벨이 트래커의 판정 기록**이고, 무엇이 왜 필요한지는 코멘트로 남긴다(기획·디자인하는 사람이 본다).
    // 같은 판정서로 다시 부르면 코멘트를 쌓지 않는다 — 코멘트 마커의 판정서 지문(`asm=`)으로 가린다.
    const needs = assessment.verdict === 'needs-planning' ? list(assessment.planningNeeds)
      : assessment.verdict === 'needs-design' ? list(assessment.designNeeds) : list(assessment.reasons).map(reason => ({what: reason, why: ''}))
    const short = digest.slice(0, 12)
    const newJudgment = !list(issue?.comments).some(comment => String(comment?.body ?? '').includes(`asm=${short}`))
    let externalWrites = 0
    let labelNote = null
    const staleLabels = VERDICT_LABELS.filter(label => label !== assessment.verdict && list(issue?.labels).includes(label))
    if (!flags['dry-run'] && (!list(issue?.labels).includes(assessment.verdict) || staleLabels.length > 0)) {
      if (typeof provider?.updateLabels === 'function') {
        try { externalWrites += 1; await provider.updateLabels(ticketKey, {add: [assessment.verdict], remove: staleLabels}) } catch (error) { labelNote = `판정 라벨을 달지 못했습니다: ${String(error?.message ?? error).slice(0, 120)}` }
      } else labelNote = 'provider에 라벨 능력이 없어 판정을 티켓에 표시하지 못했습니다.'
    }
    return {result: {ok: false, mode: 'work', phase: 'TICKET_NOT_STARTABLE', ticketKey, verdict: assessment.verdict, assessmentDigest: digest, externalWrites,
      bounce: {reason: `ticket-${assessment.verdict}`, workId, assessment: short,
        // 티켓 코멘트는 `needs`를 번호 목록으로 적는다. `missing`은 한 줄 요약으로 남긴다.
        needs: needs.map(item => ({what: item.what, why: item.why ?? ''})),
        missing: needs.map(item => (item.why ? `${item.what} — ${item.why}` : item.what))},
      guidance: '정해야 할 것을 이 티켓에 적은 뒤 다시 pickup을 부르면 새 내용으로 다시 판정합니다. 같은 내용을 다시 부르면 판정 결과만 보여 줍니다.',
      // 거둠은 판정 라벨이다 — 라벨을 못 달았으면 다른 클론은 이 작업을 계속 활성으로 본다(거뒀다고 말하지 않는다).
      ...(registered ? {withdrawn: !flags['dry-run'] && !labelNote} : {}), ...(labelNote ? {labelNote} : {}),
      notify: newJudgment, ...(newJudgment ? {} : {notified: {done: false, reason: 'same-assessment-already-notified'}})}}
  }

  // ── 보강안(외부 쓰기 전) ──
  const definition = ticketWorkDefinition({assessment, ticketKey, provider: providerName, title: issue?.title})
  const lang = resolveCommentLanguage({declared: readDeclaredLanguage(root), text: definition.title})
  const keys = new Map(works.filter(([, item]) => item.status === 'published').map(([id, item]) => [id, item.ticketKey]))
  const dependsOn = definition.dependsOn.map(dep => ({workId: dep, ticketKey: keys.get(dep) ?? null,
    title: list(plan?.workItems).find(work => work.workId === dep)?.title ?? state?.works?.get(dep)?.definition?.title ?? null}))
  const format = provider?.docFormat ?? 'markdown'
  const body = renderTicketWorkBody({definition, originalBody, format, lang, dependsOn})
  // **재등록은 본문을 새 판정서로 다시 쓴다** — 지금 티켓에 있는 완료 조건·테스트 항목(사람이 더한 것 포함)이 새 판정서에 없으면
  // 멈춘다(덮어써 잃지 않는다).
  if (registered) {
    const sections = parseWorkDocSections(body)
    const kept = new Set([...list(sections.acceptance), ...list(sections.tests), ...list(sections.tests).map(text => text.replace(/^TT-\S+\s+/, ''))].map(normalizeDocItem))
    const current = [...registered.definition.checks.map(check => check.expectedOutcome), ...registered.definition.testCases.map(item => item.text)]
    const dropped = current.filter(text => !kept.has(normalizeDocItem(text)))
    if (dropped.length > 0) {
      return {result: {ok: false, mode: 'work', phase: 'TICKET_EDITS_NOT_IN_ASSESSMENT', ticketKey, externalWrites: 0,
        bounce: {reason: 'ticket-edits-not-in-assessment', workId, missing: dropped},
        guidance: '티켓에 있는 항목이 새 판정서에 없습니다. 티켓 내용을 다시 쓰면 그 항목이 사라지니, 판정서에 옮긴 뒤 다시 확인하세요.'}}
    }
  }
  const planId = ticketPlanId(providerName, ticketKey)
  const markerText = buildWorkMarker({planId, workId, featureIds: [], testCaseIds: definition.testCases.map(item => item.id), planDigest: digest})
  const labelsToAdd = definition.roles.filter(role => !list(issue?.labels).includes(role))
  const labelsToRemove = VERDICT_LABELS.filter(label => list(issue?.labels).includes(label))
  // 미리보기에는 **비신뢰 원문을 싣지 않는다** — 쓸 때 그대로 보존한다는 사실과 크기만 적는다.
  const withheld = lang === 'en' ? `(original description preserved verbatim on write — ${originalBody.length} chars, not shown: untrusted)`
    : `(원문 ${originalBody.length}자를 쓸 때 그대로 보존한다 — 비신뢰 원문이라 미리보기에 싣지 않는다)`
  // 사용자가 판단할 것만 따로 묶는다 — AI가 **제안한** 항목·수정 범위·레인·추가될 라벨. 원문에서 옮긴 항목과 본문은 접는다.
  const review = {lane: assessment.lane, specApproval: definition.specApproval, writePaths: definition.writePaths, labels: labelsToAdd,
    nonGoals: definition.nonGoals, designDebt: definition.designDebt.map(item => ({what: item.what, why: item.why ?? ''})),
    proposed: [...list(assessment.acceptance).filter(item => item?.source === 'proposed').map(item => ({kind: 'acceptance', text: item.text})),
      ...list(assessment.testItems).filter(item => item?.source === 'proposed').map(item => ({kind: 'test', id: item.id, text: item.text}))]}
  const preview = {mode: 'work', ticketKey, workId, lane: assessment.lane, assessmentDigest: digest, writePaths: definition.writePaths,
    ...(remote && !remote.checked ? {overlapCheck: {tracker: false, reason: remote.reason, guidance: `다른 사람이 방금 집은 티켓과 겹치는지 트래커에서 확인하지 못했습니다: ${remote.reason}.`}} : {}),
    specApproval: definition.specApproval, review, confirmWith: {flag: '--assessment', value: digest},
    acceptance: assessment.acceptance, testItems: assessment.testItems, labels: {add: labelsToAdd, remove: labelsToRemove},
    body: renderTicketWorkBody({definition, originalBody: withheld, format, lang, dependsOn}),
    reregister: Boolean(registered), externalWrites: 0}
  if (!flags.assessment || flags['dry-run']) {
    return {result: {...preview, ok: true, phase: 'TICKET_WORK_PREVIEW', ...(flags['dry-run'] ? {dryRun: true} : {}),
      guidance: '확인하면 이 판정대로 티켓을 채우고 착수합니다. 확인 전에는 티켓을 고치지 않습니다.'
        + (definition.specApproval === 'required' ? ' 새 계약이 걸린 작업이라 구현 전에 /wh change로 스팩 승인을 한 번 더 받습니다.' : '')}}
  }
  if (String(flags.assessment) !== digest) {
    return {result: {ok: false, mode: 'work', phase: 'TICKET_ASSESSMENT_MISMATCH', ticketKey, expected: digest,
      guidance: '확인한 판정서가 지금 판정서와 다릅니다. 미리보기를 다시 보고 확인하세요.'}}
  }
  const missing = ['updateBody', 'updateLabels'].filter(name => typeof provider?.[name] !== 'function')
  if (missing.length > 0) return {result: {ok: false, mode: 'work', phase: 'PROVIDER_NOT_READY', missing: missing.map(name => `provider.${name}`)}}
  // 남이 잡고 있으면 티켓을 고치지 않는다 — 착수할 수 없는 사람이 남의 티켓 모양을 바꾸면 안 된다.
  if (computeAssignmentPlan({issue, developer}).status === 'taken') {
    return {result: {ok: false, mode: 'work', bounce: {reason: 'assigned-to-other', by: issue.assignees?.[0] ?? null}}}
  }

  // ── 티켓 완성 = 등록 ── 본문(정의)·작업 마커·역할 라벨을 쓰고 판정 라벨을 뗀다. 원장에는 쓰지 않는다.
  let externalWrites = 0
  try {
    externalWrites += 1
    await provider.updateBody(ticketKey, body, {marker: markerText})
    if (labelsToAdd.length > 0 || labelsToRemove.length > 0) { externalWrites += 1; await provider.updateLabels(ticketKey, {add: labelsToAdd, remove: labelsToRemove}) }
  } catch (error) {
    return {result: {ok: false, mode: 'work', phase: 'TICKET_WORK_WRITE_FAILED', ticketKey, externalWrites,
      guidance: `티켓을 고치지 못했습니다. 다시 부르면 같은 작업으로 재시도합니다: ${String(error?.message ?? error).slice(0, 160)}`}}
  }
  const fresh = await (io.resolveIssue ? io.resolveIssue({number: ticketKey}) : provider.resolveIssue(ticketKey))
  const registration = {workId, ticketKey: String(ticketKey), provider: providerName, planId, planDigest: digest, definition,
    dependsOnKeys: dependsOn.map(dep => dep.ticketKey ?? null), withdrawn: null}
  return {registration, context: ticketPickupContext(registration), issue: fresh,
    extra: {ticketWork: {registered: true, reregistered: Boolean(registered), workId, assessmentDigest: digest, lane: assessment.lane,
      ...(remote && !remote.checked ? {overlapCheck: {tracker: false, reason: remote.reason}} : {}), externalWrites}}}
}

export {keyOf}
