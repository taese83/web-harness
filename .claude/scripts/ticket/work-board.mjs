// work-board.mjs — 「지금 무엇을 집을 수 있나」(순수).
//
// 보드는 **픽업과 같은 판정을 써야 한다**. 종전 legacy에서 보드가 blocked라고 해도 픽업이
// 그대로 집히던 시기가 있었다(2026-08-30) — 표시와 게이트가 갈라지면 표시는 장식이 된다.
// 그래서 `pickupable`은 픽업이 실제로 막는 것(등록·미해결 결정·선행 등록·소유)과 같은 축이다.
//
// 선행이 끝났다는 것은 머지 관측(원장 `work-completed`) 또는 트래커의 끝남이다(계약 「완료」 절) — 링크는 완료의 주장이라 세지 않는다.
const list = value => (Array.isArray(value) ? value : [])
/** 완료의 근거 — merge(원장의 머지 관측) · commit(기대 base의 티켓 키 커밋) · tracker(트래커의 끝남). */
const viaOf = completed => (completed ? (['tracker', 'commit'].includes(completed.via) ? completed.via : 'merge') : null)

/**
 * 머지 근거를 읽는다(Jira Git Integration). 애드온이 없거나 저장소 문맥을 모르면 근거 없이 간다 — 막지 않고 알린다.
 * @returns {Promise<{evidence: Map, checked: boolean, note?: string}>}
 */
export async function readMergeEvidence({provider, root, base, keys, io = {}}) {
  if (typeof provider?.listMergeEvidence !== 'function' || keys.length === 0) return {evidence: new Map(), checked: false}
  const {resolveRepoContext} = await import('./git-origin.mjs')
  const context = await (io.repoContext ?? resolveRepoContext)({repoRoot: root, base})
  if (!context) return {evidence: new Map(), checked: false, note: '저장소의 기본 브랜치를 알 수 없어 머지된 커밋을 확인하지 않았습니다.'}
  try {
    const result = await provider.listMergeEvidence({keys, ...context})
    if (!result.available) return {evidence: new Map(), checked: false}
    return {evidence: result.evidence, checked: true,
      ...(result.errors?.length ? {note: `티켓 ${result.errors.length}건은 머지된 커밋을 확인하지 못했습니다.`} : {})}
  } catch (error) {
    return {evidence: new Map(), checked: false, note: `머지된 커밋을 확인하지 못했습니다: ${String(error?.message ?? error).slice(0, 120)}.`}
  }
}

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
    // 나 말고도 배정돼 있으면 집을 수 없다 — 픽업이 multi-assign-detected로 멈춘다(같은 축).
    const shared = Boolean(assignees && assignees.length > 1 && assignees.includes(developer))
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
      : registered?.completed ? 'completed'
      : registered?.trackerCancelled ? 'cancelled-in-tracker'
      : staleness ? staleness
        : row.status === 'blocked-decision' ? 'decision-unresolved'
          : incompleteDeps.length > 0 ? 'dependency-incomplete'
            : missingFromTracker ? 'ticket-not-found'
              : !developer ? 'no-developer'
                : takenByOther === true ? 'assigned-to-other'
                  : shared ? 'multi-assigned'
                    : takenByOther === null ? 'assignment-unknown' : null
    return {
      workId: row.workId, title: row.title, kind: row.kind, roles: list(work.roles), order: row.order ?? null, rank: row.rank,
      featureIds: featuresOf(row.workId),
      registration, ticketKey: registered?.ticketKey ?? issue?.ticketKey ?? null, publishedWith,
      assignees, mine,
      // `assignment-unknown`은 **막는 이유가 아니라 재지 못한 표시**다 — 집을 수 있는지 사람이 판단한다.
      pickupable: blockedReason === null,
      blockedReason,
      incompleteDeps,
      linked: registered?.link?.prUrl ?? null,
      completed: Boolean(registered?.completed), completedVia: viaOf(registered?.completed),
      unlocks: row.unlocks ?? 0,
    }
  })
  if (issuesByWork === null) {
    notes.push('트래커를 읽지 않았습니다. 아래는 내 컴퓨터의 계획 기준이고, 담당자는 비어 있어도 담당자가 없다는 뜻이 아닙니다.')
  } else if (!lookupComplete) {
    notes.push('트래커 목록을 끝까지 읽지 못했습니다. 못 읽은 작업의 담당자는 비어 있게 나오지만 담당자가 없다는 뜻은 아닙니다.')
  }
  const linkedNotMerged = rows.filter(row => row.linked && (!row.completed || row.completedVia === 'tracker')).length
  if (linkedNotMerged > 0) {
    notes.push(`PR은 연결됐지만 아직 머지를 확인하지 못한 작업이 ${linkedNotMerged}건 있습니다. \`link --sync\`로 머지를 확인하세요.`)
  }
  const unresolved = rows.filter(row => registrationOf(row.workId)?.trackerUnresolved).length
  if (unresolved > 0) notes.push(`트래커에서 끝났지만 해결 사유가 없는 작업 ${unresolved}건은 완료로 세지 않았습니다.`)
  const stale = rows.filter(row => row.blockedReason === 'stale-plan').map(row => row.workId)
  if (stale.length > 0) {
    notes.push(`티켓을 만든 뒤 계획이 바뀐 작업이 ${stale.length}건 있습니다. 바뀐 계획을 검토하고 다시 발행해야 집을 수 있습니다.`)
  }
  if (!developer) notes.push('누가 보는지 몰라 집을 수 있는지 판단하지 못했습니다. `--developer <내 아이디>`를 붙여 주세요.')
  const lost = rows.filter(row => row.blockedReason === 'ticket-not-found').map(row => row.workId)
  if (lost.length > 0) {
    notes.push(`발행했다고 기록됐지만 트래커에서 찾을 수 없는 작업이 ${lost.length}건 있습니다. 티켓이 지워졌거나 볼 권한이 없습니다.`)
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
  if (publishable > 0) notes.push(`아직 티켓으로 발행하지 않은 작업이 ${publishable}건 있습니다. \`claim --publish\`로 발행해야 집을 수 있습니다.`)
  if (withheld.size > 0) notes.push(`아직 정해지지 않은 결정 때문에 발행을 미룬 작업이 ${withheld.size}건 있습니다. 그 결정을 먼저 내려 주세요.`)
  return {rows, notes}
}

/**
 * 사람이 만든 개발 티켓 절(순수). 픽업과 같은 축으로만 「집을 수 있다」고 말한다 — 등록된 티켓 작업은 선행·배정으로,
 * 판정만 된 티켓은 판정으로, 트래커에만 있는 개발 티켓은 「판정 전」으로 그린다(착수 가능으로 보이지 않는다).
 * @param {{state: object, issuesByKey?: Map<string, object>|null, devTickets?: object[]|null, developer?: string|null,
 *          lookupComplete?: boolean, specBoundary?: boolean|null}} args
 *   specBoundary: 스팩(layerMap)이 있는가 — 판정이 수정 범위를 대조할 경계다(기획·specTier는 이 경로의 조건이 아니다)
 */
// 담당자가 있고 내가 아니면 남의 티켓이다. 담당자를 모르면(null) 막지 않는다 — 픽업이 배정 직전에 다시 본다.
const takenBySomeoneElse = (assignees, developer) => Array.isArray(assignees) && assignees.length > 0 && !assignees.includes(developer)

export function buildTicketBoard({state, issuesByKey = null, devTickets = null, developer = null, lookupComplete = false, specBoundary = null}) {
  const rows = []
  const works = [...(state?.works?.entries() ?? [])]
  const seen = new Set()
  for (const [workId, item] of works.filter(([, entry]) => entry.origin === 'ticket' && !entry.placeholder)) {
    seen.add(String(item.ticketKey))
    const issue = issuesByKey?.get(String(item.ticketKey)) ?? null
    const assignees = issue?.assignees ?? null
    const takenByOther = assignees ? assignees.length > 0 && !assignees.includes(developer) : null
    const shared = Boolean(assignees && assignees.length > 1 && assignees.includes(developer))
    const incompleteDeps = list(item.definition?.dependsOn).filter(dep => !state.works.get(dep)?.completed)
    const blockedReason = item.completed ? 'completed'
      : item.trackerCancelled ? 'cancelled-in-tracker'
      : item.withdrawn ? `ticket-${item.withdrawn.verdict}`
      : incompleteDeps.length > 0 ? 'dependency-incomplete'
        : !developer ? 'no-developer'
          : takenByOther === true ? 'assigned-to-other'
            : shared ? 'multi-assigned'
            : takenByOther === null && lookupComplete ? 'ticket-not-found' : takenByOther === null ? 'assignment-unknown' : null
    const next = item.completed ? '끝났습니다.'
      : item.link?.prUrl ? '연결한 PR이 머지되면 `link --sync`로 확인합니다.'
      : blockedReason === null ? `\`pickup ${item.ticketKey}\`로 이어서 개발합니다.`
        : blockedReason === 'dependency-incomplete' ? '먼저 끝나야 할 작업이 남아 있습니다.'
          : blockedReason === 'no-developer' ? '`--developer <내 아이디>`를 붙여 다시 보면 집을 수 있는지 알 수 있습니다.'
            : blockedReason === 'assigned-to-other' ? '다른 개발자가 맡고 있습니다.'
              : blockedReason === 'multi-assigned' ? '여러 사람이 배정돼 있습니다. 한 사람만 남기세요.'
              : blockedReason === 'assignment-unknown' ? '트래커에서 담당자를 읽지 못했습니다. 티켓에서 직접 확인하세요.'
                : blockedReason === 'ticket-not-found' ? '트래커에서 이 티켓을 찾지 못했습니다.'
                  : '다시 판정해 착수할 수 있는지 확인합니다.'
    rows.push({ticketKey: item.ticketKey, workId, title: item.definition?.title ?? null, stage: 'registered', lane: item.definition?.lane ?? null,
      roles: list(item.definition?.roles), linked: item.link?.prUrl ?? null, completed: Boolean(item.completed),
      completedVia: viaOf(item.completed), assignees,
      // 계획 작업 행과 같은 축이다 — `assignment-unknown`은 재지 못한 표시이지 집을 수 있다는 뜻이 아니다.
      pickupable: blockedReason === null, blockedReason, next, incompleteDeps, ...(item.withdrawn ? {withdrawn: item.withdrawn} : {})})
  }
  for (const [ticketKey, ticket] of state?.tickets?.entries() ?? []) {
    if (seen.has(ticketKey)) continue
    seen.add(ticketKey)
    const startable = ticket.verdict === 'startable'
    const listed = devTickets?.find(item => String(item.ticketKey) === ticketKey) ?? null
    const othersTicket = takenBySomeoneElse(listed?.assignees, developer)
    rows.push({ticketKey, workId: ticket.workId ?? null, title: listed?.summary ?? null,
      stage: 'assessed', verdict: ticket.verdict, pickupable: false, assignees: listed?.assignees ?? null,
      // 착수 가능 판정은 **막힌 것이 아니다** — 개발자가 미리보기를 확인하면 바로 시작한다.
      blockedReason: othersTicket ? 'assigned-to-other' : startable ? null : `ticket-${ticket.verdict}`,
      next: othersTicket ? '다른 개발자가 맡고 있습니다.'
        : startable ? `\`pickup ${ticketKey}\`로 미리보기를 보고 확인하면 시작합니다.`
        : ticket.verdict === 'needs-design' ? '디자인이 정해져야 시작할 수 있습니다. 필요한 것은 티켓 코멘트에 적혀 있습니다.'
          : '먼저 정해야 할 것이 있습니다. 필요한 것은 티켓 코멘트에 적혀 있습니다.',
      needs: ticket.needs ?? null})
  }
  for (const item of list(devTickets)) {
    if (seen.has(String(item.ticketKey))) continue
    // 판정 전은 **막힌 상태가 아니다.** `pickup`이 판정부터 시작하므로, 여기에 이유를 적으면 할 수 없는 일처럼 읽힌다.
    const othersTicket = takenBySomeoneElse(item.assignees, developer)
    rows.push({ticketKey: String(item.ticketKey), workId: null, title: item.summary ?? null, stage: 'unassessed', pickupable: false,
      blockedReason: othersTicket ? 'assigned-to-other' : null,
      next: othersTicket ? '다른 개발자가 맡고 있습니다.' : `\`pickup ${item.ticketKey}\`로 판정부터 시작합니다.`, assignees: item.assignees ?? null})
  }
  const notes = []
  const waiting = rows.filter(row => row.stage === 'unassessed' && row.blockedReason === null).length
  if (waiting > 0) {
    notes.push(`아직 판정하지 않은 개발 티켓이 ${waiting}건 있습니다. \`pickup <티켓키>\`를 부르면 판정부터 시작합니다. 기획이 없어도 됩니다.`)
    // 판정은 수정 범위를 **스팩 소유 경계**로 대조한다 — 없으면 전부 undecidable로 돌아간다. 판정을 돌린 뒤에 알면 늦다.
    if (specBoundary === false) notes.push('다만 프로젝트 구조 정의(`_workspace/03_dev/spec.json`의 `layerMap`)가 없습니다. 어디까지 고쳐도 되는지 댈 기준이 없어 판정이 모두 되돌아옵니다.')
  }
  if (devTickets === null) notes.push('트래커에서 개발 티켓 목록을 읽지 않았습니다. 아직 판정하지 않은 티켓은 이 목록에 보이지 않습니다.')
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
  let state = foldWorkState(readWorkEvents(join(root, WORK_EVENTS_PATH)))
  const {hasDevTicketAxis} = await import('./ticket-work-run.mjs')
  const ticketCapable = hasDevTicketAxis(io.ticketConfig) || [...state.works.values()].some(item => item.origin === 'ticket')
  if ((!plan || !analysis) && !ticketCapable) {
    return {ok: false, mode: 'work', phase: 'PLAN_REQUIRED', guidance: '개발 계획이 없습니다. `claim`으로 계획을 만드세요. 사람이 만든 개발 티켓을 보려면 트래커 설정에서 어떤 분류가 개발 티켓인지 정하세요.'}
  }
  const view = plan && analysis ? computeWorkView(plan, analysis) : {rows: []}
  const provider = io.provider ?? null
  // 보드는 fetch하지 않는다 — 마지막으로 받은 원격 참조 기준으로 받지 않은 계획 개정을 알린다.
  const remotePlan = plan ? await (io.planRemote ?? (await import('./git-origin.mjs')).planRevisionsOnRemote)({repoRoot: root, base: plan.baseBranch ?? null}) : null
  let issuesByWork = null
  let lookupComplete = false
  const trackerNotes = []
  // 사람 티켓 — **티켓이 등록 기록이다**. 개발 티켓을 읽어 등록(마커·본문)과 착수 불가 판정(라벨)을 메모리 상태에 겹친다.
  let devTickets = null
  if (ticketCapable && provider && typeof provider.listDevTickets === 'function' && flags['no-tracker'] !== true) {
    const {readTrackerTicketRegistrations, withTicketRegistrations} = await import('./ticket-work-run.mjs')
    const read = await readTrackerTicketRegistrations({provider, config: io.ticketConfig ?? {}, io, state})
    if (read.checked || read.items.length > 0) devTickets = read.items
    state = withTicketRegistrations(state, read.registrations, read.verdicts)
    if (!read.checked) trackerNotes.push(read.items.length > 0 ? '개발 티켓 목록을 끝까지 읽지 못했습니다. 아직 판정하지 않은 티켓 일부가 빠졌을 수 있습니다.'
      : `개발 티켓 목록 조회 실패 — 사람이 만든 티켓은 보이지 않는다: ${read.reason ?? ''}`)
    const unreadable = read.registrations.filter(item => item.error).length
    if (unreadable > 0) trackerNotes.push(`등록된 티켓 ${unreadable}건은 본문 섹션을 읽지 못했습니다.`)
  }
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
      // 트래커에서 끝난 작업(완료·취소)을 겹친다 — 원장만 보면 Jira에서 끝낸 선행을 계속 기다린다.
      const {completedResolutionsOf, withTrackerCompletion} = await import('./work-provider.mjs')
      const merged = await readMergeEvidence({provider, root, base: plan?.baseBranch ?? null, keys, io})
      if (merged.note) trackerNotes.push(merged.note)
      state = withTrackerCompletion(state, items, {completedResolutions: completedResolutionsOf(io.ticketConfig, provider.name), mergeEvidence: merged.evidence})
      issuesByWork = new Map()
      const byKey = new Map(items.map(item => [String(item.ticketKey), item]))
      for (const [workId, item] of state.works.entries()) {
        const found = item.ticketKey ? byKey.get(String(item.ticketKey)) : null
        if (found) issuesByWork.set(workId, {ticketKey: found.ticketKey, assignees: found.assignees ?? null})
      }
      if (listed.truncated) trackerNotes.push('트래커 목록이 최대 개수에 닿았습니다. 그 뒤 작업은 반영되지 않았습니다.')
      if (listed.stalled) trackerNotes.push('트래커 목록을 더 읽지 못하고 멈췄습니다. 목록이 완전하지 않습니다.')
    } catch (error) {
      // 조회 실패를 「배정 없음」으로 접지 않는다 — 로컬 기준임을 적고 배정은 미상으로 둔다.
      trackerNotes.push(`트래커 조회 실패 — 로컬 계획·원장 기준이다(배정 미상): ${String(error?.message ?? error).slice(0, 160)}`)
    }
  }
  const board = plan && analysis ? buildWorkBoard({plan, view, state, planDigest: canonicalDigest(plan), issuesByWork, developer, lookupComplete})
    : {rows: [], notes: ['개발 계획이 없어 사람이 만든 개발 티켓만 보여 줍니다. 이 티켓들을 집는 데 계획은 필요 없습니다.']}
  // 사람이 만든 개발 티켓 절 — 트래커의 개발 티켓 목록은 분류 설정과 조회 능력이 있을 때만 읽는다(못 읽으면 그렇게 적는다).
  const issuesByKey = issuesByWork ? new Map([...issuesByWork.values()].map(item => [String(item.ticketKey), item])) : null
  const specBoundary = (() => { const spec = readJson('_workspace/03_dev/spec.json'); return spec ? Boolean(spec.layerMap && Object.keys(spec.layerMap).length > 0) : false })()
  const tickets = ticketCapable ? buildTicketBoard({state, issuesByKey, devTickets, developer, lookupComplete, specBoundary}) : {rows: [], notes: []}
  return {ok: true, mode: 'work', planId: plan?.planId ?? null, planDigest: plan ? canonicalDigest(plan) : null,
    rows: board.rows, ready: board.rows.filter(row => row.pickupable).map(row => row.workId),
    ...(ticketCapable ? {tickets: tickets.rows, readyTickets: tickets.rows.filter(row => row.pickupable).map(row => row.ticketKey)} : {}),
    notes: [...(remotePlan?.checked && remotePlan.commits.length > 0 ? [`${remotePlan.ref}에 받지 않은 계획 개정이 있습니다. 받은 뒤 다시 보세요.`] : []),
      ...trackerNotes, ...board.notes, ...tickets.notes]}
}
