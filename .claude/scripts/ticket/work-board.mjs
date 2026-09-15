// work-board.mjs — 「지금 무엇을 집을 수 있나」(순수).
//
// 보드는 **픽업과 같은 판정을 써야 한다**. 종전 legacy에서 보드가 blocked라고 해도 픽업이
// 그대로 집히던 시기가 있었다(2026-08-30) — 표시와 게이트가 갈라지면 표시는 장식이 된다.
// 그래서 `pickupable`은 픽업이 실제로 막는 것(등록·미해결 결정·선행 등록·소유)과 같은 축이다.
//
// 선행은 **머지로 끝났을 때만** 끝난 것이다(원장 `work-completed`) — 링크는 완료의 주장이라 세지 않는다.
const list = value => (Array.isArray(value) ? value : [])

/**
 * @param {{plan: object, view: object, state: object, issuesByWork?: Map<string, object>|null,
 *          developer?: string|null, lookupComplete?: boolean}} args
 *   issuesByWork: workId → {ticketKey, assignees}(assignees `null` = 트래커가 주지 않음)
 *   lookupComplete: 트래커 목록이 완결인가 — 아니면 「미배정」이라 말하지 않는다
 * @returns {{rows: object[], notes: string[]}}
 */
export function buildWorkBoard({plan, view, state, planDigest = null, issuesByWork = null, developer = null, lookupComplete = false}) {
  const notes = []
  const registrationOf = workId => state?.works?.get(workId) ?? null
  const featuresOf = workId => list(plan.featureBindings).filter(binding => list(binding.requiredWorkIds).includes(workId))
    .map(binding => binding.featureId)
  const rows = list(view?.rows).map(row => {
    const work = list(plan.workItems).find(entry => entry.workId === row.workId) ?? {}
    const registered = registrationOf(row.workId)
    const registration = registered?.status ?? 'unpublished'
    const issue = issuesByWork?.get(row.workId) ?? null
    // **배정을 모르는 것과 미배정은 다르다.** 목록이 잘렸거나 트래커가 배정을 주지 않으면 `null`이다.
    const assignees = issue?.assignees ?? null
    const mine = developer && assignees ? assignees.includes(developer) : null
    const takenByOther = assignees ? assignees.length > 0 && !assignees.includes(developer) : null
    const incompleteDeps = list(work.dependsOn).filter(dep => !registrationOf(dep)?.completed)
    // 조회를 **완전히** 했는데 등록된 티켓이 목록에 없다 = 트래커에서 사라졌거나 권한 밖이다.
    // 「배정을 모른다」와 다르므로 다른 이름으로 말한다.
    const missingFromTracker = issuesByWork !== null && lookupComplete && registration === 'published' && !issue
    // **잴 수 있는데 안 재면 그것도 접는 것이다.** 발행 시점 계획과 지금 계획이 다르면 픽업이 막는다 —
    // 보드가 그 축을 빼면 「집을 수 있다」고 해놓고 픽업에서 되돌려 보낸다.
    const publishedWith = registered?.planDigest ?? null
    const staleness = registration !== 'published' ? null
      : publishedWith === null ? 'plan-digest-unknown'
        : planDigest && publishedWith !== planDigest ? 'stale-plan' : null
    const blockedReason = registration !== 'published' ? `not-registered:${registration}`
      : staleness ? staleness
        : row.status === 'blocked-decision' ? 'decision-unresolved'
          : incompleteDeps.length > 0 ? 'dependency-incomplete'
            : missingFromTracker ? 'ticket-not-found'
              : !developer ? 'no-developer'
                : takenByOther === true ? 'assigned-to-other'
                  : takenByOther === null ? 'assignment-unknown' : null
    return {
      workId: row.workId, title: row.title, kind: row.kind, order: row.order ?? null, rank: row.rank,
      featureIds: featuresOf(row.workId),
      registration, ticketKey: registered?.ticketKey ?? issue?.ticketKey ?? null, publishedWith,
      assignees, mine,
      // `assignment-unknown`은 **막는 이유가 아니라 재지 못한 표시**다 — 집을 수 있는지 사람이 판단한다.
      pickupable: blockedReason === null,
      blockedReason,
      incompleteDeps,
      linked: registered?.link?.prUrl ?? null,
      completed: Boolean(registered?.completed),
      unlocks: row.unlocks ?? 0,
    }
  })
  if (issuesByWork === null) {
    notes.push('트래커를 조회하지 않았다 — 아래는 로컬 계획·원장 기준이며 배정은 반영되지 않았다(미배정이라는 뜻이 아니다)')
  } else if (!lookupComplete) {
    notes.push('트래커 목록이 완결이 아니다(절단·색인 지연) — 못 본 작업의 배정은 `null`이며 「미배정」으로 읽지 않는다')
  }
  const linkedNotMerged = rows.filter(row => row.linked && !row.completed).length
  if (linkedNotMerged > 0) {
    notes.push(`PR이 연결됐지만 머지가 관측되지 않은 작업 ${linkedNotMerged}건 — \`link --sync\`로 머지를 확인해야 후속이 열린다`)
  }
  const stale = rows.filter(row => row.blockedReason === 'stale-plan').map(row => row.workId)
  if (stale.length > 0) {
    notes.push(`발행 뒤 계획이 바뀐 작업 ${stale.length}건 — 바뀐 안을 다시 검토·발행해야 집을 수 있다(픽업도 같은 이유로 막는다)`)
  }
  if (!developer) notes.push('`--developer <나>`가 없으면 누가 집을 수 있는지 판정할 수 없다 — 픽업도 같은 이유로 막는다')
  const lost = rows.filter(row => row.blockedReason === 'ticket-not-found').map(row => row.workId)
  if (lost.length > 0) {
    notes.push(`원장은 발행됐다는데 트래커 목록에 없는 작업 ${lost.length}건 — 지워졌거나 권한 밖이다(사람이 확인한다)`)
  }
  // 발행해도 **건너뛸** 작업(미해결 결정과 그 후손)을 「발행하면 된다」로 안내하지 않는다 — 발행 판정과 같은 축으로 나눈다.
  const unpublishedIds = new Set(rows.filter(row => row.registration !== 'published').map(row => row.workId))
  const withheld = new Set(list(view?.rows).filter(row => row.status === 'blocked-decision' && unpublishedIds.has(row.workId)).map(row => row.workId))
  for (let grown = true; grown;) {
    grown = false
    for (const work of list(plan.workItems)) {
      if (!unpublishedIds.has(work.workId) || withheld.has(work.workId)) continue
      if (list(work.dependsOn).some(dep => withheld.has(dep))) { withheld.add(work.workId); grown = true }
    }
  }
  const publishable = unpublishedIds.size - withheld.size
  if (publishable > 0) notes.push(`발행되지 않은 작업 ${publishable}건 — \`claim --publish\`로 등록해야 집을 수 있다`)
  if (withheld.size > 0) notes.push(`결정이 안 나 발행하지 않는 작업 ${withheld.size}건(후손 포함) — 결정을 먼저 닫는다(발행해도 건너뛴다)`)
  return {rows, notes}
}

/**
 * 사람이 만든 개발 티켓 절(순수). 픽업과 같은 축으로만 「집을 수 있다」고 말한다 — 등록된 티켓 작업은 선행·배정으로,
 * 판정만 된 티켓은 판정으로, 트래커에만 있는 개발 티켓은 「판정 전」으로 그린다(착수 가능으로 보이지 않는다).
 * @param {{state: object, issuesByKey?: Map<string, object>|null, devTickets?: object[]|null, developer?: string|null, lookupComplete?: boolean}} args
 */
export function buildTicketBoard({state, issuesByKey = null, devTickets = null, developer = null, lookupComplete = false}) {
  const rows = []
  const works = [...(state?.works?.entries() ?? [])]
  const seen = new Set()
  for (const [workId, item] of works.filter(([, entry]) => entry.origin === 'ticket')) {
    seen.add(String(item.ticketKey))
    const issue = issuesByKey?.get(String(item.ticketKey)) ?? null
    const assignees = issue?.assignees ?? null
    const takenByOther = assignees ? assignees.length > 0 && !assignees.includes(developer) : null
    const incompleteDeps = list(item.definition?.dependsOn).filter(dep => !state.works.get(dep)?.completed)
    const blockedReason = item.completed ? 'completed'
      : item.withdrawn ? `ticket-${item.withdrawn.verdict}`
      : incompleteDeps.length > 0 ? 'dependency-incomplete'
        : !developer ? 'no-developer'
          : takenByOther === true ? 'assigned-to-other'
            : takenByOther === null && lookupComplete ? 'ticket-not-found' : takenByOther === null ? 'assignment-unknown' : null
    rows.push({ticketKey: item.ticketKey, workId, title: item.definition?.title ?? null, stage: 'registered', lane: item.definition?.lane ?? null,
      roles: list(item.definition?.roles), linked: item.link?.prUrl ?? null, completed: Boolean(item.completed), assignees,
      // 계획 작업 행과 같은 축이다 — `assignment-unknown`은 재지 못한 표시이지 집을 수 있다는 뜻이 아니다.
      pickupable: blockedReason === null, blockedReason, incompleteDeps, ...(item.withdrawn ? {withdrawn: item.withdrawn} : {})})
  }
  for (const [ticketKey, ticket] of state?.tickets?.entries() ?? []) {
    if (seen.has(ticketKey)) continue
    seen.add(ticketKey)
    const startable = ticket.verdict === 'startable'
    rows.push({ticketKey, workId: ticket.workId ?? null, title: devTickets?.find(item => String(item.ticketKey) === ticketKey)?.summary ?? null,
      stage: 'assessed', verdict: ticket.verdict, pickupable: false,
      blockedReason: startable ? 'awaiting-confirmation' : `ticket-${ticket.verdict}`, needs: ticket.needs ?? null})
  }
  for (const item of list(devTickets)) {
    if (seen.has(String(item.ticketKey))) continue
    rows.push({ticketKey: String(item.ticketKey), workId: null, title: item.summary ?? null, stage: 'unassessed', pickupable: false,
      blockedReason: 'assessment-required', assignees: item.assignees ?? null})
  }
  const notes = []
  const waiting = rows.filter(row => row.stage === 'unassessed').length
  if (waiting > 0) notes.push(`판정 전 개발 티켓 ${waiting}건 — \`pickup <키>\`가 판정부터 시작한다`)
  if (devTickets === null) notes.push('트래커의 개발 티켓 목록을 읽지 않았다 — 판정 전 티켓은 이 보드에 없다(분류 설정이나 트래커 조회를 확인한다)')
  return {rows, notes}
}

/**
 * 보드 실행부 — 트래커 목록을 붙여 판정한다. 조회 실패·절단을 **통과로 접지 않는다**.
 * @param {{root: string, developer?: string|null, flags?: object, io: {provider?: object}}} args
 */
export async function runWorkBoard({root, developer = null, flags = {}, io = {}}) {
  const {existsSync, readFileSync} = await import('node:fs')
  const {join} = await import('node:path')
  const {canonicalDigest, WORK_ANALYSIS_PATH} = await import('./work-analysis.mjs')
  const {computeWorkView, WORK_PLAN_PATH} = await import('./work-plan.mjs')
  const {foldWorkState, readWorkEvents, WORK_EVENTS_PATH} = await import('./work-events.mjs')
  const readJson = relative => {
    const path = join(root, relative)
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null
  }
  const plan = readJson(WORK_PLAN_PATH)
  const analysis = readJson(WORK_ANALYSIS_PATH)
  const state = foldWorkState(readWorkEvents(join(root, WORK_EVENTS_PATH)))
  const {hasDevTicketAxis} = await import('./ticket-work-run.mjs')
  const ticketCapable = hasDevTicketAxis(io.ticketConfig) || [...state.works.values()].some(item => item.origin === 'ticket')
  if ((!plan || !analysis) && !ticketCapable) {
    return {ok: false, mode: 'work', phase: 'PLAN_REQUIRED', guidance: 'WORK 계획이 없다 — `claim`로 먼저 만든다(사람이 만든 개발 티켓을 보려면 개발 티켓 분류를 설정한다)'}
  }
  const view = plan && analysis ? computeWorkView(plan, analysis) : {rows: []}
  const provider = io.provider ?? null
  let issuesByWork = null
  let lookupComplete = false
  const trackerNotes = []
  const keys = [...state.works.entries()].filter(([, item]) => item.status === 'published' && item.ticketKey).map(([, item]) => item.ticketKey)
  if (provider && typeof provider.listWorkIssues === 'function' && keys.length > 0 && flags['no-tracker'] !== true) {
    try {
      // **커서를 따라간다.** 한 번만 부르고 「불완전」이라 적으면 원인이 절단인지 미순회인지 섞인다.
      const items = []
      let listed = await provider.listWorkIssues({keys})
      items.push(...listed.items)
      for (let guard = 0; listed.nextCursor && !listed.stalled && guard < 50; guard++) {
        listed = await provider.listWorkIssues({keys, cursor: listed.nextCursor})
        items.push(...listed.items)
      }
      lookupComplete = listed.complete === true
      issuesByWork = new Map()
      const byKey = new Map(items.map(item => [String(item.ticketKey), item]))
      for (const [workId, item] of state.works.entries()) {
        const found = item.ticketKey ? byKey.get(String(item.ticketKey)) : null
        if (found) issuesByWork.set(workId, {ticketKey: found.ticketKey, assignees: found.assignees ?? null})
      }
      if (listed.truncated) trackerNotes.push('트래커 목록이 상한에 닿았다 — 넘은 분은 반영되지 않았다')
      if (listed.stalled) trackerNotes.push('트래커 커서가 전진하지 않았다 — 목록이 불완전하다')
    } catch (error) {
      // 조회 실패를 「배정 없음」으로 접지 않는다 — 로컬 기준임을 적고 배정은 미상으로 둔다.
      trackerNotes.push(`트래커 조회 실패 — 로컬 계획·원장 기준이다(배정 미상): ${String(error?.message ?? error).slice(0, 160)}`)
    }
  }
  const board = plan && analysis ? buildWorkBoard({plan, view, state, planDigest: canonicalDigest(plan), issuesByWork, developer, lookupComplete})
    : {rows: [], notes: ['WORK 계획이 없다 — 사람이 만든 개발 티켓 절만 그린다']}
  // 사람이 만든 개발 티켓 절 — 트래커의 개발 티켓 목록은 분류 설정과 조회 능력이 있을 때만 읽는다(못 읽으면 그렇게 적는다).
  let devTickets = null
  if (ticketCapable && provider && typeof provider.listDevTickets === 'function' && flags['no-tracker'] !== true) {
    try {
      const listed = await provider.listDevTickets({config: io.ticketConfig ?? {}})
      devTickets = listed.items
      if (listed.complete !== true) trackerNotes.push('개발 티켓 목록이 완결이 아니다 — 판정 전 티켓 일부가 빠졌을 수 있다')
    } catch (error) {
      trackerNotes.push(`개발 티켓 목록 조회 실패 — 판정 전 티켓은 보이지 않는다: ${String(error?.message ?? error).slice(0, 120)}`)
    }
  }
  const issuesByKey = issuesByWork ? new Map([...issuesByWork.values()].map(item => [String(item.ticketKey), item])) : null
  const tickets = ticketCapable ? buildTicketBoard({state, issuesByKey, devTickets, developer, lookupComplete}) : {rows: [], notes: []}
  return {ok: true, mode: 'work', planId: plan?.planId ?? null, planDigest: plan ? canonicalDigest(plan) : null,
    rows: board.rows, ready: board.rows.filter(row => row.pickupable).map(row => row.workId),
    ...(ticketCapable ? {tickets: tickets.rows, readyTickets: tickets.rows.filter(row => row.pickupable).map(row => row.ticketKey)} : {}),
    notes: [...trackerNotes, ...board.notes, ...tickets.notes]}
}
