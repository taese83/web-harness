// work-board.mjs — 「지금 무엇을 집을 수 있나」(순수).
//
// 보드는 **픽업과 같은 판정을 써야 한다**. 종전 legacy에서 보드가 blocked라고 해도 픽업이
// 그대로 집히던 시기가 있었다(2026-08-30) — 표시와 게이트가 갈라지면 표시는 장식이 된다.
// 그래서 `pickupable`은 픽업이 실제로 막는 것(등록·미해결 결정·선행 등록·소유)과 같은 축이다.
//
// 완료는 아직 원장에 없다(P3). 그래서 「선행이 끝났나」가 아니라 **「선행이 등록됐나」**까지만
// 착수 조건으로 쓰고, 통합 대기는 정보로만 싣는다 — 없는 것을 있다고 하지 않는다.
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
    const unregisteredDeps = list(work.dependsOn).filter(dep => (registrationOf(dep)?.status ?? 'unpublished') !== 'published')
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
          : unregisteredDeps.length > 0 ? 'dependency-not-registered'
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
      unregisteredDeps,
      waitingIntegration: list(row.waiting),
      unlocks: row.unlocks ?? 0,
    }
  })
  if (issuesByWork === null) {
    notes.push('트래커를 조회하지 않았다 — 아래는 로컬 계획·원장 기준이며 배정은 반영되지 않았다(미배정이라는 뜻이 아니다)')
  } else if (!lookupComplete) {
    notes.push('트래커 목록이 완결이 아니다(절단·색인 지연) — 못 본 작업의 배정은 `null`이며 「미배정」으로 읽지 않는다')
  }
  if (rows.some(row => list(row.waitingIntegration).length > 0)) {
    notes.push('통합 대기는 **정보**다 — 선행의 완료는 아직 기록되지 않는다(P3). 착수 조건은 선행의 **등록**까지다')
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
  const unpublished = rows.filter(row => row.registration !== 'published').length
  if (unpublished > 0) notes.push(`발행되지 않은 작업 ${unpublished}건 — \`claim --work --publish\`로 등록해야 집을 수 있다`)
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
  if (!plan || !analysis) {
    return {ok: false, mode: 'work', phase: 'PLAN_REQUIRED', guidance: 'WORK 계획이 없다 — `claim --work`로 먼저 만든다'}
  }
  const state = foldWorkState(readWorkEvents(join(root, WORK_EVENTS_PATH)))
  const view = computeWorkView(plan, analysis)
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
  const board = buildWorkBoard({plan, view, state, planDigest: canonicalDigest(plan), issuesByWork, developer, lookupComplete})
  return {ok: true, mode: 'work', planId: plan.planId, planDigest: canonicalDigest(plan),
    rows: board.rows, ready: board.rows.filter(row => row.pickupable).map(row => row.workId),
    notes: [...trackerNotes, ...board.notes]}
}
