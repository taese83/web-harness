// ticket-work-run.mjs — 사람이 만든 개발 티켓의 픽업 실행부. `pickup`이 부른다(입구는 하나다).
//
// 순서: 개발 티켓인가(팀이 선언한 분류) → 계획 WORK가 아닌가 → 인젝션 스캔(fail-closed) → **배정 먼저**(남이 맡았으면 멈춘다) →
// 판정서가 있는가 → CLI 검증 → 착수 불가면 요청 코멘트 미리보기 → 확인하면 코멘트 → 착수 가능이면 미리보기 → 확인하면 로컬 등록
// (임의 디자인·기획 미정 가정이면 알림 코멘트) → 기존 WORK 픽업으로 이어진다.
// **티켓 원본은 고치지 않는다** — 확인한 판정은 이 개발자의 로컬 등록 기록이다(git 제외). 다른 클론은 배정·상태로 안다.
import {existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {buildWorkMarker, classifyTicketKind, parseWorkMarker, stripWorkMarker, withWorkMarker} from './work-refs.mjs'
import {quarantineExcerpt, scanUntrustedIssue} from './pickup.mjs'
import {classifyByComponent, DEV_TICKET} from './intake.mjs'
import {computeAssignmentPlan} from './assign.mjs'
import {bounceComment, resolveCommentLanguage} from './readiness.mjs'
import {readDeclaredLanguage} from './ticket-config.mjs'
import {assessmentDigest, assessmentPath, assessmentSnapshotPath, notifiedPath, originalBodyOf, registrationPath, renderTicketWorkBody,
  TICKET_ASSESSMENTS_DIR, ticketBodyDigest, ticketPlanId, ticketVirtualPlan, ticketWorkDefinition, ticketWorkId, validateTicketAssessment} from './ticket-work.mjs'

const list = value => (Array.isArray(value) ? value : [])
const readJson = (root, relative) => {
  const path = join(root, relative)
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null
}
const writeJson = (root, relative, value) => {
  mkdirSync(dirname(join(root, relative)), {recursive: true})
  writeFileSync(join(root, relative), `${JSON.stringify(value, null, 2)}\n`)
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
 * 이 개발자의 등록 기록(로컬)을 읽는다. 없으면 `null`, 파일이 깨졌으면 `error` — 깨진 기록을 「등록 없음」으로 접지 않는다.
 */
export function readTicketRegistration({root, ticketKey}) {
  const path = registrationPath(ticketKey)
  try {
    const value = readJson(root, path)
    if (!value) return null
    if (String(value.ticketKey) !== String(ticketKey) || !value.workId || !value.definition) return {ticketKey: String(ticketKey), error: `${path}의 모양이 맞지 않는다`}
    return value
  } catch (error) {
    return {ticketKey: String(ticketKey), error: `${path}를 읽지 못했다: ${String(error?.message ?? error).slice(0, 120)}`}
  }
}

/** 이 개발자의 등록 기록 전부와 착수 불가 판정(로컬). 보드가 내 사람 티켓 작업을 그린다. */
export function readLocalTicketWork(root) {
  const dir = join(root, TICKET_ASSESSMENTS_DIR)
  let names = []
  try { names = readdirSync(dir) } catch { return {registrations: [], verdicts: []} }
  const registrations = names.filter(name => name.endsWith('.registered.json'))
    .map(name => { try { return JSON.parse(readFileSync(join(dir, name), 'utf8')) } catch { return {error: `${name}를 읽지 못했다`} } })
  const registered = new Set(registrations.filter(item => !item.error).map(item => String(item.ticketKey)))
  const verdicts = names.filter(name => /^[^.]+\.json$/.test(name))
    .map(name => { try { return JSON.parse(readFileSync(join(dir, name), 'utf8')) } catch { return null } })
    .filter(item => item?.ticket?.key && item.verdict && item.verdict !== 'startable' && !registered.has(String(item.ticket.key)))
    .map(item => ({ticketKey: String(item.ticket.key), verdict: item.verdict, workId: ticketWorkId(item.ticket.provider, item.ticket.key)}))
  return {registrations, verdicts}
}

/**
 * 등록·판정을 **메모리의** 상태에 겹친다(순수) — 원장에는 쓰지 않는다. 보드·겹침·선행·link가 계획 작업과 같은 코드를 탄다.
 * 선행 키만 아는 작업은 그 키로 트래커 끝남을 겹칠 수 있게 자리만 둔다.
 */
export function withTicketRegistrations(state, registrations = [], verdicts = []) {
  const works = new Map(state?.works ?? [])
  const tickets = new Map(state?.tickets ?? [])
  for (const registration of registrations.filter(item => item && !item.error)) {
    works.set(registration.workId, {...(works.get(registration.workId) ?? {}), status: 'published', origin: 'ticket', ticketKey: registration.ticketKey,
      provider: registration.provider ?? null,
      planId: registration.planId, planDigest: registration.planDigest, definition: registration.definition})
    list(registration.definition?.dependsOn).forEach((dep, index) => {
      const key = list(registration.dependsOnKeys)[index]
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
    .filter(([workId, item]) => workId !== exceptWorkId && item.status === 'published' && !item.completed)
    .map(([workId, item]) => ({workId, ticketKey: item.ticketKey ?? null, writePaths: list(item.origin === 'ticket' ? item.definition?.writePaths : planWorks.get(workId)?.writePaths)}))
    .filter(work => work.writePaths.length > 0)
}

/**
 * 트래커의 개발 티켓 목록(분류·배정만). 사람 티켓의 판정·등록은 각 개발자의 로컬에 있다 — 다른 클론은 배정으로만 안다.
 * 못 읽으면 `checked: false`와 이유 — 부른 쪽이 막지 않고 알린다.
 */
export async function readDevTickets({provider, config}) {
  if (typeof provider?.listDevTickets !== 'function') return {checked: false, reason: 'provider가 개발 티켓 목록을 주지 않는다', items: []}
  try {
    const listed = await provider.listDevTickets({config})
    return {checked: listed.complete !== false, ...(listed.complete === false ? {reason: '개발 티켓 목록이 잘렸다'} : {}), items: list(listed.items)}
  } catch (error) {
    return {checked: false, reason: String(error?.message ?? error).slice(0, 120), items: []}
  }
}

/** 사람에게 남기는 코멘트(확인 뒤에만) — 요청 코멘트는 되돌림 코멘트와 같은 문안, 임의 디자인 알림은 한 줄 + 목록. */
function designNoticeComment({designDebt, lang}) {
  const items = designDebt.map((item, index) => `${index + 1}. ${item.what}${item.why ? ` — ${item.why}` : ''}`)
  return lang === 'en'
    ? ['Implementing the feature first without a design (implementer-decided design). Once a design is ready, align it in a separate ticket.', '', 'Decided by the implementer:', ...items].join('\n')
    : ['디자인 없이 기능을 먼저 구현합니다(임의 디자인). 디자인이 나오면 별도 티켓으로 맞춥니다.', '', '임의로 정하는 것:', ...items].join('\n')
}

/** 기획 미정을 가정으로 두고 진행한다는 알림 — 기획자가 가정을 보고 바로잡을 수 있게 한다. */
function assumptionNoticeComment({assumptions, lang}) {
  const items = assumptions.map((item, index) => `${index + 1}. ${item.what} → ${item.assumed}${item.why ? ` (${item.why})` : ''}`)
  return lang === 'en'
    ? ['Proceeding with the following undecided details assumed. If an assumption is wrong, say so here and it will be corrected in a follow-up.', '', 'Assumptions:', ...items].join('\n')
    : ['아래 미정 사항을 가정하고 진행합니다. 가정이 틀렸으면 여기에 알려 주세요 — 후속으로 바로잡습니다.', '', '가정:', ...items].join('\n')
}

/** 이미 남긴 코멘트인가(로컬) — 같은 판정으로 다시 확인해도 코멘트를 쌓지 않는다. */
const alreadyNotified = (root, ticketKey, id) => { try { return list(readJson(root, notifiedPath(ticketKey))?.ids).includes(id) } catch { return false } }
const rememberNotified = (root, ticketKey, id) => {
  let ids = []
  try { ids = list(readJson(root, notifiedPath(ticketKey))?.ids) } catch { /* 깨졌으면 새로 쓴다 */ }
  writeJson(root, notifiedPath(ticketKey), {ids: [...new Set([...ids, id])]})
}
async function postOnce({root, provider, ticketKey, id, text, io}) {
  if (alreadyNotified(root, ticketKey, id)) return {done: false, reason: 'already-posted'}
  const post = io.comment ?? (typeof provider?.comment === 'function' ? provider.comment.bind(provider) : null)
  if (!post) return {done: false, supported: false}
  try {
    await post(ticketKey, text)
    rememberNotified(root, ticketKey, id)
    return {done: true}
  } catch (error) {
    return {done: false, error: String(error?.message ?? error).slice(0, 200)}
  }
}

/**
 * **배정 먼저** — 판정하기 전에 나로 배정한다. 남이 맡았으면 판정도 배정도 하지 않는다. 배정은 비교·교체가 아니라
 * 배정 직후 다시 읽어 남도 보이면 물러난다(동시에 보면 둘 다 물러나고 다시 집는다). 미리보기(dry-run)는 배정하지 않는다.
 * @returns {Promise<{issue: object}|{result: object}>}
 */
export async function claimBeforeAssessment({provider, ticketKey, developer, issue, dryRun, fetchIssue}) {
  const plan = computeAssignmentPlan({issue, developer})
  if (plan.status === 'taken') {
    return {result: {ok: false, mode: 'work', phase: 'TICKET_ASSIGNED_TO_OTHER', ticketKey, externalWrites: 0,
      bounce: {reason: 'assigned-to-other', by: issue?.assignees?.[0] ?? null}, guidance: '다른 개발자가 맡은 티켓입니다. 다른 작업을 고르세요.'}}
  }
  if (plan.status === 'already-mine' && list(issue?.assignees).length > 1) {
    return {result: {ok: false, mode: 'work', bounce: {reason: 'multi-assign-detected', assignees: issue.assignees},
      guidance: '이 티켓에 여러 사람이 배정돼 있습니다. 한 사람만 남긴 뒤 다시 집으세요.'}}
  }
  if (plan.action !== 'self-assign' || dryRun) return {issue}
  if (typeof provider?.assign !== 'function') return {result: {ok: false, mode: 'work', phase: 'PROVIDER_NOT_READY', missing: ['provider.assign']}}
  // 처음 읽은 뒤 남이 먼저 맡았을 수 있다 — 배정 **직전에** 다시 읽고 양보한다(오래된 읽기로 남의 배정을 덮지 않는다).
  const fresh = await fetchIssue(ticketKey)
  if (computeAssignmentPlan({issue: fresh, developer}).status === 'taken') {
    return {result: {ok: false, mode: 'work', phase: 'TICKET_ASSIGNED_TO_OTHER', ticketKey, externalWrites: 0,
      bounce: {reason: 'assigned-to-other', by: fresh?.assignees?.[0] ?? null}, guidance: '그 사이 다른 개발자가 이 티켓을 가져갔습니다. 다른 작업을 고르세요.'}}
  }
  await provider.assign(ticketKey, developer)
  const after = await fetchIssue(ticketKey)
  const assignees = list(after?.assignees)
  if (!assignees.includes(developer)) {
    return {result: {ok: false, mode: 'work', bounce: {reason: 'assign-lost', assignees}, guidance: '배정 직후 다른 개발자가 이 티켓을 가져갔습니다. 다른 작업을 고르세요.'}}
  }
  if (assignees.length > 1) {
    const released = typeof provider.unassign === 'function' ? await provider.unassign(ticketKey, developer).then(() => true, () => false) : false
    return {result: {ok: false, mode: 'work', bounce: released ? {reason: 'assigned-to-other', by: assignees.find(login => login !== developer) ?? null}
      : {reason: 'multi-assign-detected', assignees},
    guidance: released ? '같은 때 다른 개발자도 이 티켓을 집어 물러났습니다. 다른 작업을 고르거나 잠시 뒤 다시 집으세요.' : '두 사람이 같은 티켓에 배정돼 있습니다. 누가 할지 팀과 정하세요.'}}
  }
  return {issue: after, assigned: true}
}

/** 등록된 작업을 계획 WORK 픽업 코드에 넘길 티켓 모양(메모리 전용) — 정의 섹션 + 원문 + 작업 마커. 트래커에는 쓰지 않는다. */
export function virtualTicketIssue(issue, registration, {format = 'markdown', lang = 'ko'} = {}) {
  const marker = buildWorkMarker({planId: registration.planId, workId: registration.workId, featureIds: [],
    testCaseIds: list(registration.definition.testCases).map(item => item.id), planDigest: registration.planDigest})
  const body = renderTicketWorkBody({definition: registration.definition, originalBody: originalBodyOf(issue?.body ?? ''), format, lang,
    dependsOn: list(registration.definition.dependsOn).map((workId, index) => ({workId, ticketKey: list(registration.dependsOnKeys)[index] ?? null}))})
  return {...issue, body: withWorkMarker(body, marker)}
}

/**
 * @returns {Promise<{result?: object, context?: object, issue?: object, extra?: object, registration?: object}>}
 *   result: 여기서 끝났다(판정 요구·검증 실패·착수 불가·미리보기·쓰기 실패) · context: 계획 WORK 픽업으로 이어간다 · 둘 다 없으면 이 경로가 아니다
 *   registration: 이 티켓의 등록(메모리 상태에 겹칠 것) · issue: 계획 WORK 픽업이 읽을 티켓 모양(메모리 전용)
 */
export async function resolveTicketPickup({root, ticketKey, developer, issue, state, plan, flags = {}, io = {}}) {
  const provider = io.provider
  const config = io.ticketConfig ?? {}
  const providerName = provider?.name
  const works = [...(state?.works?.entries() ?? [])]
  const kind = classifyTicketKind(issue?.body ?? '')
  const marker = kind.kind === 'work' ? parseWorkMarker(issue.body) : null
  const registered = readTicketRegistration({root, ticketKey})
  if (registered?.error) {
    return {result: {ok: false, mode: 'work', phase: 'TICKET_REGISTRATION_UNREADABLE', ticketKey, externalWrites: 0,
      bounce: {reason: 'ticket-registration-unreadable', detail: registered.error},
      guidance: `이 티켓의 로컬 등록 기록을 읽지 못했습니다. ${registrationPath(ticketKey)}를 지우고 다시 판정하세요.`}}
  }
  if (!registered && marker?.workId) return {} // 계획이 발행한 WORK다
  const dev = isDevTicket(issue, config)
  if (!registered && !dev.dev) return {}
  // **하네스가 만든 다른 모델의 티켓**(집계·공급 원문·옛 FEAT·마커 충돌)은 개발 분류가 붙어도 판정하지 않는다.
  const foreignKind = kind.error ? kind.kind : ['aggregate', 'source', 'legacy', 'conflict'].includes(kind.kind) ? kind.kind : null
  const aggregateKey = [...(state?.aggregates?.values() ?? [])].some(item => item.ticketKey && String(item.ticketKey) === String(ticketKey))
  if (!registered && (foreignKind || aggregateKey)) {
    return {result: {ok: false, mode: 'work', phase: 'TICKET_NOT_DEV_WORK', ticketKey, externalWrites: 0,
      bounce: {reason: `${foreignKind ?? 'aggregate'}-ticket-not-dev`, ...(kind.error ? {detail: kind.error} : {})}}}
  }
  // **마커를 못 읽은 계획 WORK**(속성 읽기 실패·사람이 지운 마커)에 개발 분류가 붙어 있어도 사람 티켓으로 판정하지 않는다.
  const planWork = works.find(([, item]) => item.status === 'published' && item.origin !== 'ticket' && String(item.ticketKey) === String(ticketKey))
  if (planWork) {
    return {result: {ok: false, mode: 'work', phase: 'TICKET_IS_PLAN_WORK', ticketKey, externalWrites: 0,
      bounce: {reason: 'work-marker-missing', workId: planWork[0], ticketKey: String(ticketKey)}}}
  }
  // **비신뢰 원문 스캔이 먼저다** — 배정·판정 요청 스냅샷·미리보기·코멘트 모두 이 뒤에 온다(fail-closed).
  const injection = scanUntrustedIssue(issue)
  if (injection.injectionSuspect) {
    return {result: {ok: false, mode: 'work', phase: 'TICKET_INJECTION_SUSPECT', ticketKey, externalWrites: 0, injection,
      bounce: {reason: 'injection-suspect', markers: injection.markers, sources: injection.sources}}}
  }
  // **배정 먼저** — 판정은 시간이 걸린다. 그동안 다른 사람이 같은 티켓을 판정하지 않게 먼저 맡는다. 착수 불가로 판정돼도 배정은 남긴다
  // (판정한 사람이 필요하면 직접 푼다).
  const fetchIssue = key => (io.resolveIssue ? io.resolveIssue({number: key}) : provider.resolveIssue(key))
  const claimed = await claimBeforeAssessment({provider, ticketKey, developer, issue, dryRun: flags['dry-run'], fetchIssue})
  if (claimed.result) return claimed
  const current = claimed.issue ?? issue
  const claimedNote = claimed.assigned ? {assignedBeforeAssessment: true} : {}

  const path = assessmentPath(ticketKey)
  let assessment = null
  try { assessment = readJson(root, path) } catch (error) {
    // 등록된 작업은 판정서 없이도 이어간다 — 파손된 판정서 파일이 확인된 작업의 픽업까지 막지 않는다.
    if (registered) return {registration: registered, context: ticketPickupContext(registered), issue: virtualTicketIssue(current, registered, {format: provider?.docFormat}),
      extra: {ticketWork: {note: `판정서를 읽지 못해 등록된 판정으로 이어간다: ${String(error?.message ?? error).slice(0, 120)}`}}}
    return {result: {ok: false, mode: 'work', phase: 'TICKET_ASSESSMENT_INVALID', ticketKey, path, errors: [`판정서를 읽지 못했다: ${String(error?.message ?? error).slice(0, 160)}`]}}
  }
  // 등록된 작업이고 판정서가 그대로면(또는 없으면) 계획 WORK처럼 이어서 픽업한다. 판정서를 새로 썼으면 다시 확인을 탄다.
  if (registered && (!assessment || assessmentDigest(assessment) === registered.planDigest)) {
    return {registration: registered, context: ticketPickupContext(registered), issue: virtualTicketIssue(current, registered, {format: provider?.docFormat})}
  }
  if (!assessment) {
    // 판정할 에이전트에게 원문을 **격리 스냅샷**으로 준다 — 트래커 본문을 지시로 읽지 않게(에이전트가 쓸 수 없는 자리).
    const snapshot = assessmentSnapshotPath(ticketKey)
    if (!flags['dry-run']) {
      mkdirSync(dirname(join(root, snapshot)), {recursive: true})
      writeFileSync(join(root, snapshot), `${quarantineExcerpt({...current, body: stripWorkMarker(current?.body ?? '')})}\n`)
    }
    return {result: {ok: false, mode: 'work', phase: 'TICKET_ASSESSMENT_REQUIRED', ticketKey, externalWrites: claimed.assigned ? 1 : 0, ...claimedNote,
      bounce: {reason: 'ticket-assessment-required', by: registered ? 'reassess' : dev.by},
      next: {agent: 'system-architect', mode: 'ticket-assessment', writes: path,
        contract: '.claude/skills/team-flow/references/ticket-work-contract.md',
        reads: [flags['dry-run'] ? '(dry-run — 격리 스냅샷을 쓰지 않았다)' : snapshot, '_workspace/03_dev/spec.json', '현재 코드', '_workspace/03_dev/work-plan.json(있으면)']},
      guidance: `사람이 만든 개발 티켓입니다(${dev.by ?? '등록된 티켓 작업'}).${claimed.assigned ? ' 먼저 나로 배정했습니다.' : ''} 기획이나 디자인이 더 필요한지 판정합니다. system-architect가 ${path}를 쓴 뒤 다시 pickup을 부르세요.`}}
  }

  const workId = ticketWorkId(providerName, ticketKey)
  const planWorkIds = list(plan?.workItems).map(work => work.workId)
  const local = readLocalTicketWork(root)
  const ticketIds = [...works.filter(([, item]) => item.origin === 'ticket').map(([id]) => id), ...local.registrations.filter(item => !item.error).map(item => item.workId)]
  const originalBody = originalBodyOf(current?.body ?? '')
  const spec = (() => { try { return readJson(root, '_workspace/03_dev/spec.json') } catch { return null } })()
  // 겹침은 이 클론이 아는 진행 중 작업(발행한 계획 작업 + 내가 등록한 티켓 작업)으로 잰다 — 남의 사람 티켓은 배정으로만 안다.
  // 머지로 끝난 작업은 트래커에 열려 있어도 수정 범위를 쥐지 않는다 — 완료는 기록이 아니라 트래커·PR에서 읽는다.
  let activeState = withTicketRegistrations(state, local.registrations.filter(item => String(item.ticketKey) !== String(ticketKey)))
  let overlapNote = null
  if (assessment?.verdict === 'startable' && provider) {
    const {readTrackerWorkState} = await import('./work-state-run.mjs')
    const read = await readTrackerWorkState({provider, state: activeState, root, plan, config: io.ticketConfig ?? null, io})
    activeState = read.state
    if (read.notes.length > 0) overlapNote = read.notes.join(' ')
  }
  const checked = validateTicketAssessment({assessment, ticketKey, provider: providerName, originalBody, spec,
    activeWorks: activeWorksFrom({plan, state: activeState, exceptWorkId: workId}), knownWorkIds: new Set([...planWorkIds, ...ticketIds])})
  if (!checked.ok) return {result: {ok: false, mode: 'work', phase: 'TICKET_ASSESSMENT_INVALID', ticketKey, path, errors: checked.errors}}
  // 격리 사본은 판정 한 번을 위한 것이다 — 판정서가 검증을 통과하면 지운다(실패하면 다시 판정해야 하므로 남긴다).
  if (!flags['dry-run']) rmSync(join(root, assessmentSnapshotPath(ticketKey)), {force: true})
  const digest = checked.digest
  if (assessment.verdict === 'startable' && checked.bounce) {
    return {result: {ok: false, mode: 'work', phase: 'TICKET_NOT_STARTABLE', ticketKey, externalWrites: 0, bounce: checked.bounce}}
  }
  const lang = resolveCommentLanguage({declared: readDeclaredLanguage(root), text: current?.title ?? ''})
  const confirmed = Boolean(flags.assessment) && !flags['dry-run']
  if (flags.assessment && String(flags.assessment) !== digest) {
    return {result: {ok: false, mode: 'work', phase: 'TICKET_ASSESSMENT_MISMATCH', ticketKey, expected: digest,
      guidance: '확인한 판정서가 지금 판정서와 다릅니다. 미리보기를 다시 보고 확인하세요.'}}
  }

  if (assessment.verdict !== 'startable') {
    // 착수 불가 — 무엇이 왜 필요한지를 **먼저 로컬에서 보여 주고**, 개발자가 확인하면 그 내용을 티켓 코멘트로 남긴다(라벨은 달지 않는다).
    // 배정은 그대로 둔다 — 판정한 사람이 계속 맡고, 필요하면 직접 푼다.
    const needs = assessment.verdict === 'needs-planning' ? list(assessment.planningNeeds)
      : assessment.verdict === 'needs-design' ? list(assessment.designNeeds) : list(assessment.reasons).map(reason => ({what: reason, why: ''}))
    const text = bounceComment({reason: `ticket-${assessment.verdict}`, items: needs.map(item => ({what: item.what, why: item.why ?? ''})), outputLanguage: lang})
    const bounce = {reason: `ticket-${assessment.verdict}`, workId, assessment: digest.slice(0, 12),
      needs: needs.map(item => ({what: item.what, why: item.why ?? ''})), missing: needs.map(item => (item.why ? `${item.what} — ${item.why}` : item.what))}
    // 등록했던 작업을 다시 판정해 착수 불가가 나왔다 — 로컬 등록을 거둔다(이 클론의 보드·겹침에서 빠진다).
    if (registered && confirmed) rmSync(join(root, registrationPath(ticketKey)), {force: true})
    if (!confirmed) {
      return {result: {ok: false, mode: 'work', phase: 'TICKET_NOT_STARTABLE', ticketKey, verdict: assessment.verdict, assessmentDigest: digest, externalWrites: 0,
        ...claimedNote, bounce, requestComment: text, confirmWith: {flag: '--assessment', value: digest},
        guidance: '티켓에 남길 요청 코멘트입니다. 내용을 확인하고 고칠 것이 있으면 판정서를 고친 뒤 다시 부르세요. 확인하면 이 코멘트를 남깁니다(배정은 그대로 둡니다).'}}
    }
    const notified = await postOnce({root, provider, ticketKey, id: `request:${digest}`, text, io})
    return {result: {ok: false, mode: 'work', phase: 'TICKET_NOT_STARTABLE', ticketKey, verdict: assessment.verdict, assessmentDigest: digest,
      externalWrites: notified.done ? 1 : 0, bounce, notified, ...(registered ? {withdrawn: true} : {}),
      guidance: notified.done || notified.reason === 'already-posted' ? '정해야 할 것을 티켓에 남겼습니다. 채워지면 다시 pickup을 부르세요. 배정은 그대로 두었습니다.'
        : `요청 코멘트를 티켓에 남기지 못했습니다${notified.error ? `: ${notified.error}` : ''}. 아래 내용을 기획자에게 직접 전하세요. 배정은 그대로 두었습니다.`,
      ...(notified.done || notified.reason === 'already-posted' ? {} : {requestComment: text})}}
  }

  // ── 착수 가능: 미리보기(외부 쓰기 0) → 확인 → 로컬 등록 ──
  const definition = ticketWorkDefinition({assessment, ticketKey, provider: providerName, title: current?.title})
  const keys = new Map([...activeState.works.entries()].filter(([, item]) => item.status === 'published').map(([id, item]) => [id, item.ticketKey]))
  const dependsOn = definition.dependsOn.map(dep => ({workId: dep, ticketKey: keys.get(dep) ?? null,
    title: list(plan?.workItems).find(work => work.workId === dep)?.title ?? activeState.works.get(dep)?.definition?.title ?? null}))
  const designNotice = assessment.designByImplementer ? designNoticeComment({designDebt: definition.designDebt, lang}) : null
  const assumptionNotice = list(definition.assumptions).length > 0 ? assumptionNoticeComment({assumptions: definition.assumptions, lang}) : null
  // 사용자가 판단할 것만 묶는다 — AI가 **제안한** 항목·수정 범위·레인·임의 디자인. 티켓에는 임의 디자인 알림 외에는 쓰지 않는다.
  const review = {lane: assessment.lane, specApproval: definition.specApproval, writePaths: definition.writePaths,
    nonGoals: definition.nonGoals, designDebt: definition.designDebt.map(item => ({what: item.what, why: item.why ?? ''})),
    ...(assessment.designByImplementer ? {designByImplementer: {source: assessment.designByImplementer.source,
      ...(assessment.designByImplementer.quote ? {quote: assessment.designByImplementer.quote} : {}), comment: designNotice}} : {}),
    ...(assumptionNotice ? {assumptions: {items: definition.assumptions, comment: assumptionNotice}} : {}),
    proposed: [...list(assessment.acceptance).filter(item => item?.source === 'proposed').map(item => ({kind: 'acceptance', text: item.text})),
      ...list(assessment.testItems).filter(item => item?.source === 'proposed').map(item => ({kind: 'test', id: item.id, text: item.text}))]}
  if (!confirmed) {
    return {result: {ok: true, mode: 'work', phase: 'TICKET_WORK_PREVIEW', ticketKey, workId, lane: assessment.lane, assessmentDigest: digest,
      writePaths: definition.writePaths, specApproval: definition.specApproval, review, confirmWith: {flag: '--assessment', value: digest},
      acceptance: assessment.acceptance, testItems: assessment.testItems, reregister: Boolean(registered), externalWrites: 0, ...claimedNote,
      ...(overlapNote ? {overlapCheck: {guidance: `끝난 작업을 모두 확인하지 못했습니다: ${overlapNote}`}} : {}), ...(flags['dry-run'] ? {dryRun: true} : {}),
      guidance: '확인하면 이 판정으로 착수합니다. 판정은 내 컴퓨터에만 기록하고 티켓 본문은 고치지 않습니다.'
        + (designNotice ? ' 임의 디자인으로 진행한다는 코멘트를 티켓에 남깁니다.' : '')
        + (assumptionNotice ? ' 미정 사항을 가정하고 진행한다는 코멘트를 티켓에 남깁니다.' : '')
        + (definition.specApproval === 'required' ? ' 새 계약이 걸린 작업이라 구현 전에 /wh change로 스팩 승인을 한 번 더 받습니다.' : '')}}
  }
  // ── 확인 = 로컬 등록 ──
  const registration = {schemaVersion: 1, ticketKey: String(ticketKey), provider: providerName, workId, planId: ticketPlanId(providerName, ticketKey),
    planDigest: digest, definition, dependsOnKeys: dependsOn.map(dep => dep.ticketKey ?? null), bodyDigest: ticketBodyDigest(current?.body ?? ''),
    confirmedAt: new Date().toISOString()}
  writeJson(root, registrationPath(ticketKey), registration)
  const designNotified = designNotice ? await postOnce({root, provider, ticketKey, id: `design:${digest}`, text: designNotice, io}) : null
  const assumptionNotified = assumptionNotice ? await postOnce({root, provider, ticketKey, id: `assume:${digest}`, text: assumptionNotice, io}) : null
  const unposted = [
    ...(designNotified && !designNotified.done && designNotified.reason !== 'already-posted' ? ['임의 디자인으로 진행한다는 코멘트'] : []),
    ...(assumptionNotified && !assumptionNotified.done && assumptionNotified.reason !== 'already-posted' ? ['미정 사항을 가정한다는 코멘트'] : []),
  ]
  return {registration, context: ticketPickupContext(registration), issue: virtualTicketIssue(current, registration, {format: provider?.docFormat, lang}),
    extra: {ticketWork: {registered: true, reregistered: Boolean(registered), workId, assessmentDigest: digest, lane: assessment.lane, ...claimedNote,
      ...(designNotified ? {designNotice: designNotified} : {}), ...(assumptionNotified ? {assumptionNotice: assumptionNotified} : {}),
      externalWrites: (claimed.assigned ? 1 : 0) + (designNotified?.done ? 1 : 0) + (assumptionNotified?.done ? 1 : 0),
      ...(unposted.length > 0 ? {guidance: `${unposted.join('·')}를 티켓에 남기지 못했습니다. 디자이너·기획자에게 직접 알리세요.`} : {})}}}
}

export {keyOf}
