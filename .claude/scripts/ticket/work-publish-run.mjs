// work-publish-run.mjs — `claim --publish`: 검토한 판본을 트래커에 발행하는 **실행부**.
//
// 외부 쓰기의 규율(설계 §8): 쓰기 **전에** 시도를 원장에 남기고(operationId + 요청 지문), 성공하면 확정을
// 남긴다. 응답 유실·원장 실패는 `publish-unknown`으로 남겨 다음 실행이 **조회로 확인**한다 — 부재를
// 단정해 재발행하지 않는다. 일부만 발행된 배치는 성공분을 유지하고 나머지만 재개한다.
import {existsSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {canonicalDigest} from './work-analysis.mjs'
import {computeWorkView, WORK_PLAN_PATH} from './work-plan.mjs'
import {WORK_ANALYSIS_PATH} from './work-analysis.mjs'
import {appendWorkEvent, foldWorkState, readWorkEvents, WORK_EVENTS_PATH} from './work-events.mjs'
import {buildWorkMarker} from './work-refs.mjs'
import {planPublish, payloadDigest, reconcileAttempt, renderWorkBody, workContentDigest, workIssueFields} from './work-publish.mjs'
import {planLabel, workLabel, workProviderReadiness, workRelationMode} from './work-provider.mjs'
import {ticketKeyOf} from './ticket-provider.mjs'

const list = value => (Array.isArray(value) ? value : [])
const readJson = (root, relative) => {
  const path = join(root, relative)
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null
}

/**
 * @param {{root: string, flags: object, io: {provider: object, ticketConfig?: object}}} args
 *   flags: `--work-ids a,b` 선택 발행 · `--parent <KEY>` 관계를 걸 부모 티켓 · `--confirm` 실제 발행
 */
export async function runWorkPublish({root, flags = {}, io = {}}) {
  const plan = readJson(root, WORK_PLAN_PATH)
  const analysis = readJson(root, WORK_ANALYSIS_PATH)
  if (!plan || !analysis) {
    return {ok: false, mode: 'work', phase: 'PLAN_REQUIRED', externalWrites: 0,
      guidance: '발행할 계획이 없다 — `claim`로 분석·계획을 만들고 검토한 뒤 발행한다'}
  }
  const planDigest = canonicalDigest(plan)
  const eventsPath = join(root, WORK_EVENTS_PATH)
  const state = foldWorkState(readWorkEvents(eventsPath))
  const provider = io.provider
  // 설정의 모양은 provider가 정한다 — 중립 실행부가 `jira`만 아는 것이 I3 위반이었다.
  const stored = io.ticketConfig ?? {}
  const config = stored[provider?.name] ?? stored
  const readiness = workProviderReadiness(provider, config)
  const view = computeWorkView(plan, analysis)
  const blocked = new Set(view.rows.filter(row => row.status === 'blocked-decision').map(row => row.workId))
  const selection = flags['work-ids'] ? String(flags['work-ids']).split(',').map(value => value.trim()).filter(Boolean) : null
  const decision = planPublish({plan, planDigest, state, selection, blockedWorkIds: blocked, reviewed: state.lastReviewed})

  const featuresOf = workId => list(plan.featureBindings).filter(binding => list(binding.requiredWorkIds).includes(workId)).map(binding => binding.featureId)
  const ownedTcs = workId => list(plan.featureBindings).flatMap(binding => list(binding.acceptanceOwners).filter(owner => owner.workId === workId).map(owner => owner.testCaseId))
  const relation = workRelationMode(provider?.name, config)
  /** 한 작업의 발행 요청(순수) — 새 발행과 동기화가 **같은 빌더**를 쓴다(둘로 만들면 갈라진다). */
  const draftOf = (work, parentKey) => {
    const featureIds = featuresOf(work.workId)
    const marker = buildWorkMarker({planId: plan.planId, workId: work.workId, featureIds, testCaseIds: ownedTcs(work.workId), planDigest})
    const body = renderWorkBody({work, plan, featureIds, testCaseIds: ownedTcs(work.workId), marker,
      parentKey, relationMode: relation.mode})
    const draft = workIssueFields({work, plan, featureIds, body, featLabel: provider.featLabel,
      labels: [workLabel(work.workId), planLabel(plan.planId), ...list(config.labels)], components: list(config.components)})
    return {featureIds, draft, fields: provider.buildWorkFields({title: draft.title, body: draft.body, labels: draft.labels, components: draft.components})}
  }
  // ── 동기화(T47): 이미 발행한 작업이 **다른 판본으로** 나가 있으면 본문(마커·소비 FEAT·TC)과 라벨을 맞춘다 ──
  // 맞추지 않으면 계획 개정 뒤 그 티켓은 픽업·보드에서 영영 `stale-plan`이고, 새로 소비하는 FEAT의 라벨도 없다.
  // 떼는 라벨은 **원장이 기록한 우리 라벨** 중 빠진 것뿐이다 — 사람이 단 라벨은 모르므로 건드리지 않는다.
  const byWorkId = new Map(list(plan.workItems).map(work => [work.workId, work]))
  //
  // **제자리로 고치는 것은 소비 메타데이터뿐이다**(소비 FEAT·책임 TC·판본 표지·우리 라벨). 작업 **내용**이 바뀌었으면
  // 쓰지 않는다 — 읽고 작업 중인 개발자 밑에서 계약이 조용히 바뀌므로 대체(`superseded` + 새 WORK)로 간다(2026-08-30
  // 사용자 결정의 WORK 판). 원장이 기록한 트래커가 지금 provider가 아니면 쓰지 않는다 — 같은 키가 다른 트래커의 무관한 이슈다.
  const syncs = readiness.ok ? decision.reuse.map(item => {
    const registered = state.works.get(item.workId)
    const work = byWorkId.get(item.workId)
    const {featureIds, draft, fields} = draftOf(work, registered.relation?.parentKey ?? null)
    const digest = payloadDigest(fields)
    if (registered.planDigest === planDigest && registered.payloadDigest === digest) return null
    const base = {workId: item.workId, ticketKey: registered.ticketKey, from: registered.planDigest}
    if (registered.provider !== provider.name) {
      return {...base, refused: 'provider-mismatch', reason: `원장은 ${registered.provider ?? '(기록 없음)'}에 냈다고 한다 — 지금 트래커(${provider.name})에 같은 키로 쓰지 않는다`}
    }
    const contentDigest = workContentDigest(work)
    if (registered.workDigest !== contentDigest) {
      return {...base, refused: registered.workDigest ? 'supersede-required' : 'work-digest-unknown',
        reason: registered.workDigest
          ? '발행한 뒤 작업 내용이 바뀌었다 — 제자리로 고치지 않는다. 옛 작업을 superseded로 두고 새 WORK로 대체한다'
          : '발행 때의 작업 내용 지문이 원장에 없어 내용이 그대로인지 모른다 — 제자리로 고치지 않는다'}
    }
    const previous = Array.isArray(registered.labels) ? registered.labels : null
    // 머지로 끝난 작업은 **라벨만** 맞춘다 — 닫힌 티켓의 본문을 그 PR이 구현하지 않은 판본으로 바꾸지 않는다.
    const labelsOnly = Boolean(registered.completed)
    return {...base, featureIds, body: labelsOnly ? null : draft.body, labels: draft.labels, digest, contentDigest, labelsOnly,
      add: draft.labels.filter(label => !list(previous).includes(label)),
      remove: previous ? previous.filter(label => !draft.labels.includes(label)) : [],
      previousLabelsKnown: previous !== null}
  }).filter(Boolean) : []

  const preview = {
    mode: 'work', phase: 'PUBLISH_PREVIEW', externalWrites: 0, planDigest,
    provider: {name: provider?.name ?? null, ready: readiness.ok, missing: readiness.missing, relation: readiness.relation},
    publish: decision.publish.map(work => ({workId: work.workId, title: work.title, labels: [workLabel(work.workId), planLabel(plan.planId)]})),
    resume: decision.resume, reuse: decision.reuse, skipped: decision.skipped, errors: decision.errors,
    sync: syncs.map(({body, digest, contentDigest, ...rest}) => rest),
  }
  if (!decision.ok) return {...preview, ok: false, phase: 'PUBLISH_BLOCKED'}
  if (!readiness.ok) {
    return {...preview, ok: false, phase: 'PROVIDER_NOT_READY',
      guidance: `발행 전에 필요한 것: ${readiness.missing.join(' · ')} — \`configure\`로 기록한다`}
  }
  // 확인 전에는 **무엇을 어디에 쓸지**만 보여준다. 이것이 발행 승인의 대상이다.
  if (!flags.confirm) {
    return {...preview, ok: true,
      guidance: '이 목록으로 발행하려면 같은 요청에 --confirm을 붙인다'
        + (decision.resume.length > 0 ? ' · `resume` 항목은 조회 결과에 따라 확정되거나 새로 생성될 수 있다' : '')
        + (syncs.some(item => !item.refused) ? ` · \`sync\` ${syncs.filter(item => !item.refused).length}건은 이미 발행한 티켓의 본문·라벨을 바꾸고 코멘트로 알린다(사람이 본문에 적은 것은 덮어쓴다)` : '')}
  }

  const results = []
  let externalWrites = 0
  /** 원장 기록은 발행의 일부다 — 못 남기면 **쓰지 않는다**(쓰고 잊으면 다음 실행이 중복을 만든다). */
  const record = event => {
    try { appendWorkEvent(eventsPath, {schemaVersion: 1, eventId: randomUUID(), planId: plan.planId, planDigest, at: new Date().toISOString(), ...event}); return null }
    catch (error) { return String(error?.message ?? error).slice(0, 160) }
  }

  // ── 재개: 시도했는데 결과를 모르는 것부터 ──
  for (const item of decision.resume) {
    const work = plan.workItems.find(entry => entry.workId === item.workId)
    let lookup = null
    try { lookup = await provider.findByWorkId({planId: plan.planId, workId: item.workId}) } catch (error) {
      results.push({workId: item.workId, outcome: 'hold', reason: `조회 실패: ${String(error?.message ?? error).slice(0, 120)}`})
      continue
    }
    const verdict = reconcileAttempt({lookup})
    if (verdict.action === 'confirm') {
      const failed = record({operationId: item.state.operationId ?? randomUUID(), workId: item.workId, eventType: 'publish-confirmed',
        payload: {ticketKey: verdict.ticketKey, via: 'reconcile', provider: provider.name}})
      if (failed) { results.push({workId: item.workId, outcome: 'hold', ticketKey: verdict.ticketKey, reason: `원장에 확정을 남기지 못했다(${verdict.ticketKey}) — ${failed}`}); continue }
      results.push({workId: item.workId, outcome: 'confirmed', ticketKey: verdict.ticketKey, reason: verdict.reason})
    } else if (verdict.action === 'republish') {
      decision.publish.push(work)
      results.push({workId: item.workId, outcome: 'republish-queued', reason: verdict.reason})
    } else {
      results.push({workId: item.workId, outcome: 'hold', reason: verdict.reason})
    }
  }

  // 결과를 모르는 작업(보류·불확실)의 **후손은 이번에 내지 않는다** — 없는 선행을 있는 것처럼
  // 만든다. 한 겹만 보면 손자가 새어 나가므로 **선행부터 처리하도록 위상 정렬**하고, 루프가
  // 돌면서 집합을 키운다(전이 닫힘이 진행 중 결과까지 덮는다).
  const unresolved = new Set(results.filter(item => item.outcome === 'hold' || item.outcome === 'unknown').map(item => item.workId))
  const ordered = []
  const placed = new Set()
  const place = work => {
    if (placed.has(work.workId)) return
    placed.add(work.workId)
    for (const dep of list(work.dependsOn)) {
      const predecessor = decision.publish.find(entry => entry.workId === dep)
      if (predecessor) place(predecessor)
    }
    ordered.push(work)
  }
  for (const work of [...decision.publish]) place(work)

  // ── 발행: 쓰기 전에 시도를 남기고, 결과를 확정·불확실로 나눈다 ──
  for (const work of ordered) {
    const blockedBy = list(work.dependsOn).filter(dep => unresolved.has(dep))
    if (blockedBy.length > 0) {
      // 선행의 결과를 모른다 — 후손도 모르는 것으로 둔다(사유와 함께).
      unresolved.add(work.workId)
      decision.skipped.push({workId: work.workId, reason: `unresolved-predecessor: ${blockedBy.join(', ')}`})
      results.push({workId: work.workId, outcome: 'hold', reason: `선행의 발행 결과를 모른다 — ${blockedBy.join(', ')}`})
      continue
    }
    const {featureIds, draft, fields} = draftOf(work, flags.parent ? String(flags.parent) : null)
    const operationId = randomUUID()
    const attemptFailed = record({operationId, workId: work.workId, eventType: 'publish-attempted',
      payload: {payloadDigest: payloadDigest(fields), title: draft.title, labels: draft.labels, workDigest: workContentDigest(work)}})
    if (attemptFailed) {
      unresolved.add(work.workId)
      results.push({workId: work.workId, outcome: 'hold', reason: `원장에 시도를 남기지 못해 발행하지 않는다 — ${attemptFailed}`})
      continue
    }
    externalWrites += 1
    let created = null
    try {
      created = await provider.createIssue(fields)
    } catch (error) {
      // 생성이 실패했는지 **응답만 유실됐는지** 여기서 알 수 없다 — 없음으로 읽지 않는다.
      const ledgerFailed = record({operationId, workId: work.workId, eventType: 'publish-unknown',
        payload: {reason: String(error?.message ?? error).slice(0, 200)}})
      unresolved.add(work.workId)
      results.push({workId: work.workId, outcome: 'unknown', ledgerWriteFailed: ledgerFailed,
        reason: `발행 결과를 확인하지 못했다 — 다음 실행이 조회로 확인한다${ledgerFailed ? ` · 원장에 그 사실도 남기지 못했다: ${ledgerFailed}` : ''}`})
      continue
    }
    const ticketKey = ticketKeyOf(created)
    if (!ticketKey) {
      const ledgerFailed = record({operationId, workId: work.workId, eventType: 'publish-unknown', payload: {reason: '생성 응답에 키가 없다'}})
      unresolved.add(work.workId)
      results.push({workId: work.workId, outcome: 'unknown', ledgerWriteFailed: ledgerFailed,
        reason: `생성 응답에 키가 없다 — 재발행하지 않고 조회로 확인한다${ledgerFailed ? ` · 원장에 그 사실도 남기지 못했다: ${ledgerFailed}` : ''}`})
      continue
    }
    const confirmFailed = record({operationId, workId: work.workId, eventType: 'publish-confirmed',
      // 어느 트래커에 냈는가 — 닫는 줄·재조회가 지금 설정이 아니라 이것을 따른다.
      payload: {ticketKey, url: created.url ?? null, provider: provider.name}})
    if (confirmFailed) {
      // 티켓은 **이미 만들어졌다.** 키를 결과에 실어 사람에게 보인다 — 원장이 모른다고 없는 일이 아니다.
      unresolved.add(work.workId)
      results.push({workId: work.workId, outcome: 'hold', ticketKey,
        reason: `발행은 됐는데(${ticketKey}) 원장에 확정을 남기지 못했다 — 원장을 고친 뒤 다시 실행한다: ${confirmFailed}`})
      continue
    }
    results.push({workId: work.workId, outcome: 'published', ticketKey, featureIds})
    // 관계: 부모를 준 경우에만 건다. `link-only`는 관계 API가 아니라 본문 참조라는 사실을 그대로 적는다.
    if (flags.parent) {
      const linked = relation.mode === 'issue-link'
        ? await provider.linkRelated({parentKey: flags.parent, childKey: ticketKey})
        : {applied: false, mode: relation.mode}
      if (relation.mode === 'issue-link') externalWrites += 1
      const ledgerFailed = record({operationId, workId: work.workId, eventType: 'relation-linked',
        payload: {mode: linked.mode ?? relation.mode, applied: linked.applied === true, parentKey: String(flags.parent)}})
      results.push({workId: work.workId, outcome: ledgerFailed ? 'hold' : 'relation', mode: linked.mode ?? relation.mode,
        applied: linked.applied === true,
        ...(ledgerFailed ? {reason: `관계는 걸었는데 원장에 남기지 못했다 — ${ledgerFailed}`} : {})})
    }
  }
  // ── 동기화 실행 ── 본문·라벨 교체는 멱등이라 시도 기록 없이 쓰고, **둘 다 된 뒤에만** 원장을 새 판본으로 옮긴다.
  // 중간에 실패하면 원장은 옛 판본 그대로라 픽업이 계속 막고, 다음 실행이 같은 동기화를 다시 한다.
  for (const item of syncs) {
    if (item.refused) { results.push({workId: item.workId, outcome: 'hold', ticketKey: item.ticketKey, refused: item.refused, reason: item.reason}); continue }
    try {
      if (item.body !== null) {
        externalWrites += 1
        await provider.updateBody(item.ticketKey, item.body)
      }
      if (item.add.length > 0 || item.remove.length > 0) {
        externalWrites += 1
        await provider.updateLabels(item.ticketKey, {add: item.add, remove: item.remove})
      }
    } catch (error) {
      results.push({workId: item.workId, outcome: 'hold', ticketKey: item.ticketKey,
        reason: `동기화 실패 — 원장은 옛 판본 그대로다(픽업은 계속 막힌다): ${String(error?.message ?? error).slice(0, 120)}`})
      continue
    }
    const failed = record({operationId: randomUUID(), workId: item.workId, eventType: 'publish-synced',
      payload: {ticketKey: String(item.ticketKey), payloadDigest: item.digest, labels: item.labels, workDigest: item.contentDigest,
        scope: item.labelsOnly ? 'labels-only' : 'body-and-labels', fromPlanDigest: item.from ?? null}})
    // **조용히 바꾸지 않는다** — 본문을 바꿨으면 티켓에 한 줄 남긴다. 못 남겨도 동기화는 이미 됐다(보고만 한다).
    let notice = null
    if (!failed && item.body !== null) {
      if (typeof provider.comment === 'function') {
        externalWrites += 1
        try {
          await provider.comment(item.ticketKey, '계획 판본이 바뀌어 이 티켓의 소비 FEAT·책임 TC·판본 표지를 갱신했다(작업 내용은 그대로다). 이미 픽업했다면 다시 픽업한다 — 옛 change-scope로는 link가 막힌다.')
        } catch (error) { notice = `알림 코멘트 실패: ${String(error?.message ?? error).slice(0, 120)}` }
      } else notice = 'provider에 코멘트 능력이 없어 알리지 못했다'
    }
    results.push(failed
      ? {workId: item.workId, outcome: 'hold', ticketKey: item.ticketKey, reason: `동기화는 됐는데 원장에 남기지 못했다 — ${failed}`}
      : {workId: item.workId, outcome: 'synced', ticketKey: item.ticketKey, scope: item.labelsOnly ? 'labels-only' : 'body-and-labels',
        added: item.add, removed: item.remove, ...(notice ? {notice} : {}),
        ...(item.previousLabelsKnown ? {} : {note: '이전 라벨 기록이 없어 떼지 않았다'})})
  }

  const published = results.filter(item => item.outcome === 'published' || item.outcome === 'confirmed')
  const pending = results.filter(item => ['unknown', 'hold'].includes(item.outcome))
  return {
    ok: pending.length === 0, mode: 'work', phase: pending.length === 0 ? 'PUBLISHED' : 'PUBLISHED_WITH_PENDING',
    planDigest, externalWrites, results, reuse: decision.reuse, skipped: decision.skipped,
    synced: results.filter(item => item.outcome === 'synced').map(item => ({workId: item.workId, ticketKey: item.ticketKey})),
    published: published.map(item => ({workId: item.workId, ticketKey: item.ticketKey})),
    pending: pending.map(item => ({workId: item.workId, reason: item.reason})),
    events: WORK_EVENTS_PATH,
    ...(pending.length > 0 ? {guidance: '불확실한 항목은 다음 실행이 조회로 확인한다 — 재발행하지 않는다(중복 방지)'} : {}),
  }
}
