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
import {buildWorkMarker, normalizeDocBody} from './work-refs.mjs'
import {planPublish, payloadDigest, reconcileAttempt, workContentDigest, workIssueFields} from './work-publish.mjs'
import {workProviderReadiness, workRelationMode} from './work-provider.mjs'
import {buildWorkDoc, compareWorkDoc, formatWorkDoc, renderWorkContext, testCaseTexts, workContextName} from './work-ticket-doc.mjs'
import {parseFeaturePlanUnits} from './plan-units.mjs'
import {ticketKeyOf} from './ticket-provider.mjs'
import {resolveCommentLanguage} from './readiness.mjs'
import {readDeclaredLanguage} from './ticket-config.mjs'

const list = value => (Array.isArray(value) ? value : [])
const SYNC_NOTICE = {
  ko: '계획이 바뀌어 이 티켓의 소비 FEAT·책임 TC를 갱신했습니다(작업 내용은 그대로입니다). 이미 픽업했다면 다시 픽업하세요 — 옛 change-scope로는 link가 막힙니다. 이 코멘트는 하네스가 남깁니다.',
  en: 'The plan changed, so the consuming FEATs and owned TCs on this ticket were updated (the work itself is unchanged). If you already picked it up, pick it up again — link blocks the old change-scope. Posted by web-harness.',
}
// 계획에서 빠진(대체·취소) 작업의 티켓 — 트래커에서 보고 집는 사람이 없게 한 번 알린다.
const RETIRE_NOTICE = {
  ko: ({superseded, replacedBy}) => `이 작업은 계획에서 ${superseded ? '다른 작업으로 대체' : '취소'}됐습니다${replacedBy.length ? `(이어서 할 티켓: ${replacedBy.join(', ')})` : ''}. 이 티켓으로 개발하지 마세요. 이 코멘트는 하네스가 남깁니다.`,
  en: ({superseded, replacedBy}) => `This work was ${superseded ? 'replaced by another work' : 'cancelled'} in the plan${replacedBy.length ? ` (continue in: ${replacedBy.join(', ')})` : ''}. Do not develop on this ticket. Posted by web-harness.`,
}
// 사람이 본문을 고쳐 덮어쓰지 않았을 때 — 계획이 요구하는 항목 중 본문에 없는 것을 사람에게 넘긴다.
const PRESERVED_NOTICE = {
  ko: ({missing, stale}) => `계획이 바뀌었는데 이 티켓 본문은 사람이 고쳐서 덮어쓰지 않았습니다. 본문의 완료 조건·테스트 항목을 아래처럼 맞춰 주세요(맞추기 전에는 픽업이 계획 반영을 요구합니다).${missing.length ? `\n\n더할 항목:\n${missing.map(item => `- ${item.text}`).join('\n')}` : ''}${stale.length ? `\n\n지울 항목(이제 이 작업의 것이 아니다):\n${stale.map(item => `- ${item.text}`).join('\n')}` : ''}\n\n이 코멘트는 하네스가 남깁니다.`,
  en: ({missing, stale}) => `The plan changed, but this ticket's description was edited by a person, so it was not overwritten. Please align the acceptance criteria / test items (pickup asks for this until then).${missing.length ? `\n\nAdd:\n${missing.map(item => `- ${item.text}`).join('\n')}` : ''}${stale.length ? `\n\nRemove (no longer this work's):\n${stale.map(item => `- ${item.text}`).join('\n')}` : ''}\n\nPosted by web-harness.`,
}
export const FEATURE_PLAN_PATH = '_workspace/01_plan/feature-plan.md'
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
  let state = foldWorkState(readWorkEvents(eventsPath))
  // 끝난 작업(라벨만 맞춤·대체 알림 제외)은 트래커에서 계산한다 — 원장에는 완료가 없다.
  if (io.provider) state = (await (await import('./work-state-run.mjs')).readTrackerWorkState({provider: io.provider, state, root, plan, config: io.ticketConfig ?? null, io})).state
  const provider = io.provider
  // 설정의 모양은 provider가 정한다 — 중립 실행부가 `jira`만 아는 것이 I3 위반이었다.
  const stored = io.ticketConfig ?? {}
  const config = stored[provider?.name] ?? stored
  const readiness = workProviderReadiness(provider, config)
  const view = computeWorkView(plan, analysis)
  const blocked = new Set(view.rows.filter(row => row.status === 'blocked-decision').map(row => row.workId))
  const selection = flags['work-ids'] ? String(flags['work-ids']).split(',').map(value => value.trim()).filter(Boolean) : null
  const decision = planPublish({plan, planDigest, state, selection, blockedWorkIds: blocked, reviewed: state.lastReviewed})

  const byWorkId = new Map(list(plan.workItems).map(work => [work.workId, work]))
  const featuresOf = workId => list(plan.featureBindings).filter(binding => list(binding.requiredWorkIds).includes(workId)).map(binding => binding.featureId)
  const ownedTcs = workId => list(plan.featureBindings).flatMap(binding => list(binding.acceptanceOwners).filter(owner => owner.workId === workId).map(owner => owner.testCaseId))
  const relation = workRelationMode(provider?.name, config)
  // 사람이 읽는 본문의 재료 — FEAT 제목과 TC 문장은 feature-plan에서 온다(없으면 ID만 적는다).
  const units = (() => { try { return parseFeaturePlanUnits(readFileSync(join(root, FEATURE_PLAN_PATH), 'utf8')) } catch { return [] } })()
  const tcTexts = testCaseTexts(units)
  const featureTitles = new Map(units.map(unit => [unit.featureId, unit.title]))
  const declaredLanguage = readDeclaredLanguage(root)
  const keysNow = new Map([...state.works.entries()].filter(([, item]) => item.status === 'published').map(([workId, item]) => [workId, item.ticketKey]))
  /** 한 작업의 발행 요청(순수) — 새 발행과 동기화가 **같은 빌더**를 쓴다(둘로 만들면 갈라진다). */
  const draftOf = (work, parentKey) => {
    const featureIds = featuresOf(work.workId)
    const testCases = ownedTcs(work.workId).map(id => ({id, text: tcTexts.get(id) ?? ''}))
    const lang = resolveCommentLanguage({declared: declaredLanguage, text: work.title})
    const dependsOn = list(work.dependsOn).map(dep => ({workId: dep, title: byWorkId.get(dep)?.title ?? null, ticketKey: keysNow.get(dep) ?? null}))
    const contextName = workContextName(work.workId)
    const doc = buildWorkDoc({work, featureIds, features: featureTitles, testCases, dependsOn, parentKey, relationMode: relation.mode, contextName, lang})
    const body = formatWorkDoc(doc, provider.docFormat ?? 'markdown')
    const marker = buildWorkMarker({planId: plan.planId, workId: work.workId, featureIds, testCaseIds: ownedTcs(work.workId), planDigest})
    // 라벨은 **사람이 거르는 축**뿐이다 — 누가 집는가(roles)와 팀 라벨. 조회 키는 라벨에 두지 않는다(2026-09-15).
    const draft = workIssueFields({work, body, labels: [...list(work.roles), ...list(config.labels)], components: list(config.components)})
    // 소비 메타데이터 지문 — 개발자가 읽는 것(소비 FEAT·책임 TC·부모)이 바뀌었는가. 판본 표지만 바뀐 동기화는 알리지 않는다.
    const consumerDigest = canonicalDigest({featureIds, testCaseIds: ownedTcs(work.workId), parentKey: parentKey ?? null})
    const context = renderWorkContext({work, plan, planDigest, featureIds, testCases, dependsOn})
    return {featureIds, draft, marker, consumerDigest, testCases, lang, docDigest: canonicalDigest(normalizeDocBody(body)),
      context: {name: contextName, content: context, digest: canonicalDigest(context)},
      fields: provider.buildWorkFields({title: draft.title, body: draft.body, marker, labels: draft.labels, components: draft.components})}
  }
  // ── 동기화(T47): 이미 발행한 작업이 **다른 판본으로** 나가 있으면 본문(마커·소비 FEAT·TC)과 라벨을 맞춘다 ──
  // 맞추지 않으면 계획 개정 뒤 그 티켓은 픽업·보드에서 영영 `stale-plan`이고, 새로 소비하는 FEAT의 라벨도 없다.
  // 떼는 라벨은 **원장이 기록한 우리 라벨** 중 빠진 것뿐이다 — 사람이 단 라벨은 모르므로 건드리지 않는다.
  //
  // **제자리로 고치는 것은 소비 메타데이터뿐이다**(소비 FEAT·책임 TC·판본 표지·우리 라벨). 작업 **내용**이 바뀌었으면
  // 쓰지 않는다 — 읽고 작업 중인 개발자 밑에서 계약이 조용히 바뀌므로 대체(`superseded` + 새 WORK)로 간다(2026-08-30
  // 사용자 결정의 WORK 판). 원장이 기록한 트래커가 지금 provider가 아니면 쓰지 않는다 — 같은 키가 다른 트래커의 무관한 이슈다.
  const syncs = readiness.ok ? decision.reuse.map(item => {
    const registered = state.works.get(item.workId)
    const work = byWorkId.get(item.workId)
    const drafted = draftOf(work, registered.relation?.parentKey ?? null)
    const {featureIds, draft, fields, consumerDigest} = drafted
    const digest = payloadDigest(fields)
    if (registered.planDigest === planDigest && registered.payloadDigest === digest && registered.context?.digest === drafted.context.digest) return null
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
    // 알림은 **소비 메타데이터가 바뀌었을 때만**(기록이 없으면 바뀐 것으로 본다) — 무관한 개정마다 모든 티켓에 코멘트가 붙으면
    // 아무도 읽지 않게 된다(실 GitHub·Jira 왕복 2026-09-15). 판본 표지만 바뀐 경우 개발자는 link STALE로 알게 된다.
    const notify = !labelsOnly && registered.consumerDigest !== consumerDigest
    return {...base, featureIds, body: labelsOnly ? null : draft.body, marker: drafted.marker, docDigest: drafted.docDigest, previousDocDigest: registered.docDigest ?? null,
      testCases: drafted.testCases, lang: drafted.lang, work, context: drafted.context, previousContext: registered.context ?? null,
      foreignTestCaseIds: list(plan.featureBindings).flatMap(binding => list(binding.acceptanceOwners)).filter(owner => owner.workId !== item.workId).map(owner => owner.testCaseId),
      labels: draft.labels, digest, contentDigest, consumerDigest, labelsOnly, notify,
      add: draft.labels.filter(label => !list(previous).includes(label)),
      remove: previous ? previous.filter(label => !draft.labels.includes(label)) : [],
      previousLabelsKnown: previous !== null}
  }).filter(Boolean) : []

  // 발행했지만 계획에서 빠진 작업(끝나지 않은 것만) — 티켓에 한 번 알린다.
  const retiring = list(plan.workItems).filter(work => ['cancelled', 'superseded'].includes(work.lifecycle))
    .map(work => ({work, registered: state.works.get(work.workId)}))
    .filter(({registered}) => registered?.status === 'published' && !registered.retired && !registered.completed)
    .map(({work, registered}) => ({workId: work.workId, ticketKey: registered.ticketKey, lifecycle: work.lifecycle, supersededBy: list(work.supersededBy), title: work.title}))
  const preview = {
    mode: 'work', phase: 'PUBLISH_PREVIEW', externalWrites: 0, planDigest,
    provider: {name: provider?.name ?? null, ready: readiness.ok, missing: readiness.missing, relation: readiness.relation},
    publish: decision.publish.map(work => ({workId: work.workId, title: work.title, labels: [...list(work.roles), ...list(config.labels)]})),
    resume: decision.resume, reuse: decision.reuse, skipped: decision.skipped, errors: decision.errors,
    sync: syncs.map(({body, digest, contentDigest, consumerDigest, marker, docDigest, previousDocDigest, testCases, lang, work, context, previousContext, foreignTestCaseIds, ...rest}) => rest),
    retire: retiring.map(({workId, ticketKey, lifecycle}) => ({workId, ticketKey, lifecycle})),
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
        + (retiring.length > 0 ? ` · \`retire\` ${retiring.length}건은 계획에서 빠진 작업의 티켓에 개발하지 말라고 알린다` : '')
        + (syncs.some(item => !item.refused) ? ` · \`sync\` ${syncs.filter(item => !item.refused).length}건은 이미 발행한 티켓의 본문·라벨·AI 맥락을 새 판본에 맞춘다(사람이 고친 본문은 덮어쓰지 않는다 · 소비 FEAT·TC가 바뀐 ${syncs.filter(item => item.notify).length}건만 코멘트로 알린다)` : '')}
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
    try { lookup = await provider.findByWorkId({planId: plan.planId, workId: item.workId, since: item.state.attemptedAt ? new Date(Date.parse(item.state.attemptedAt) - 5 * 60000).toISOString() : null}) } catch (error) {
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
    const drafted = draftOf(work, flags.parent ? String(flags.parent) : null)
    const {featureIds, draft, fields, consumerDigest} = drafted
    const operationId = randomUUID()
    const attemptFailed = record({operationId, workId: work.workId, eventType: 'publish-attempted',
      payload: {payloadDigest: payloadDigest(fields), title: draft.title, labels: draft.labels, workDigest: workContentDigest(work), consumerDigest, docDigest: drafted.docDigest}})
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
    keysNow.set(work.workId, ticketKey) // 같은 실행의 후속 작업 본문이 이 키를 「선행 작업」으로 적는다
    // AI 작업 맥락 — 티켓은 이미 있다. 실패해도 발행을 되돌리지 않고 보류로 올린다(다음 발행이 다시 붙인다).
    try {
      externalWrites += 1
      const attached = await provider.attachContext(ticketKey, {name: drafted.context.name, content: drafted.context.content})
      const contextFailed = record({operationId: randomUUID(), workId: work.workId, eventType: 'context-attached',
        payload: {ticketKey, ref: attached.ref, contentDigest: drafted.context.digest, name: drafted.context.name}})
      if (contextFailed) results.push({workId: work.workId, outcome: 'hold', ticketKey, reason: `AI 맥락은 붙였는데 원장에 남기지 못했다 — ${contextFailed}`})
    } catch (error) {
      results.push({workId: work.workId, outcome: 'hold', ticketKey, reason: `AI 맥락 첨부 실패 — 다음 발행이 다시 붙인다: ${String(error?.message ?? error).slice(0, 120)}`})
    }
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
    // 본문: 우리가 마지막으로 쓴 본문 그대로면 교체하고, **사람이 고쳤으면 본문은 두고 판본 표지만** 옮긴다.
    let docDigest = item.previousDocDigest
    let preserved = null
    try {
      if (item.body !== null) {
        const current = await provider.resolveIssue(item.ticketKey)
        // 지문 기록이 없는 발행분(0.27.x)은 **이관으로 교체한다** — 옛 본문은 이 모양이 아니라 대조할 섹션이 없다(문서에 예외로 적었다).
        const untouched = item.previousDocDigest === null || canonicalDigest(normalizeDocBody(current?.body)) === item.previousDocDigest
        if (untouched) {
          externalWrites += 1
          await provider.updateBody(item.ticketKey, item.body, {marker: item.marker})
          docDigest = item.docDigest
        } else {
          externalWrites += 1
          await provider.updateMarker(item.ticketKey, item.marker, {currentBody: current?.body ?? ''})
          preserved = compareWorkDoc({body: current?.body, work: item.work, testCases: item.testCases, lang: item.lang, foreignTestCaseIds: item.foreignTestCaseIds})
        }
      }
      if (item.add.length > 0 || item.remove.length > 0) {
        externalWrites += 1
        await provider.updateLabels(item.ticketKey, {add: item.add, remove: item.remove})
      }
      if (item.previousContext?.digest !== item.context.digest) {
        externalWrites += 1
        const attached = await provider.attachContext(item.ticketKey, {name: item.context.name, content: item.context.content, previous: item.previousContext?.ref ?? null})
        const contextFailed = record({operationId: randomUUID(), workId: item.workId, eventType: 'context-attached',
          payload: {ticketKey: String(item.ticketKey), ref: attached.ref, contentDigest: item.context.digest, name: item.context.name}})
        if (contextFailed) throw new Error(`AI 맥락은 붙였는데 원장에 남기지 못했다 — ${contextFailed}`)
      }
    } catch (error) {
      results.push({workId: item.workId, outcome: 'hold', ticketKey: item.ticketKey,
        reason: `동기화 실패 — 원장은 옛 판본 그대로다(픽업은 계속 막힌다): ${String(error?.message ?? error).slice(0, 120)}`})
      continue
    }
    const failed = record({operationId: randomUUID(), workId: item.workId, eventType: 'publish-synced',
      payload: {ticketKey: String(item.ticketKey), payloadDigest: item.digest, labels: item.labels, workDigest: item.contentDigest,
        consumerDigest: item.consumerDigest, docDigest: docDigest ?? undefined, bodyPreserved: preserved !== null,
        scope: item.labelsOnly ? 'labels-only' : preserved ? 'marker-and-labels' : 'body-and-labels', fromPlanDigest: item.from ?? null}})
    // **조용히 바꾸지 않는다** — 본문을 바꿨으면 티켓에 한 줄 남긴다. 못 남겨도 동기화는 이미 됐다(보고만 한다).
    let notice = null
    // 사람이 고친 본문에 계획 항목이 빠져 있으면 **그 항목을 넘긴다**(덮어쓰지 않았으니 사람이 반영해야 한다).
    const handOver = preserved && (preserved.missing.length > 0 || preserved.stale.length > 0)
    if (!failed && (item.notify || handOver)) {
      if (typeof provider.comment === 'function') {
        externalWrites += 1
        try {
          await provider.comment(item.ticketKey, handOver ? PRESERVED_NOTICE[item.lang](preserved) : SYNC_NOTICE[item.lang])
        } catch (error) { notice = `알림 코멘트 실패: ${String(error?.message ?? error).slice(0, 120)}` }
      } else notice = 'provider에 코멘트 능력이 없어 알리지 못했다'
    }
    results.push(failed
      ? {workId: item.workId, outcome: 'hold', ticketKey: item.ticketKey, reason: `동기화는 됐는데 원장에 남기지 못했다 — ${failed}`}
      : {workId: item.workId, outcome: 'synced', ticketKey: item.ticketKey, scope: item.labelsOnly ? 'labels-only' : preserved ? 'marker-and-labels' : 'body-and-labels',
        notified: (item.notify || Boolean(handOver)) && !notice, ...(preserved ? {bodyPreserved: true, handOver: preserved.missing, toRemove: preserved.stale} : {}),
        added: item.add, removed: item.remove, ...(notice ? {notice} : {}),
        ...(item.previousLabelsKnown ? {} : {note: '이전 라벨 기록이 없어 떼지 않았다'})})
  }

  // ── 계획에서 빠진 작업의 티켓에 알린다 — 대체 작업의 키는 이번 발행분까지 본다 ──
  const keyAfter = workId => results.find(item => item.workId === workId && item.ticketKey && ['published', 'confirmed'].includes(item.outcome))?.ticketKey
    ?? keysNow.get(workId) ?? null
  for (const item of retiring) {
    if (typeof provider.comment !== 'function') {
      results.push({workId: item.workId, outcome: 'hold', ticketKey: item.ticketKey, reason: 'provider에 코멘트 능력이 없어 계획에서 빠진 사실을 티켓에 알리지 못했다'})
      continue
    }
    const replacedBy = item.supersededBy.map(keyAfter).filter(Boolean).map(String)
    // 대체 작업이 아직 발행되지 않았으면 알리지 않는다 — 한 번만 알리므로 「이어서 할 티켓」 없이 남기면 다시 못 알린다.
    if (item.lifecycle === 'superseded' && replacedBy.length < item.supersededBy.length) {
      results.push({workId: item.workId, outcome: 'hold', ticketKey: item.ticketKey, reason: '대체 작업을 아직 발행하지 않아 옛 티켓에 알리지 않았다 — 대체 작업을 함께 발행한다'})
      continue
    }
    const lang = resolveCommentLanguage({declared: declaredLanguage, text: item.title})
    externalWrites += 1
    try {
      await provider.comment(item.ticketKey, RETIRE_NOTICE[lang]({superseded: item.lifecycle === 'superseded', replacedBy}))
    } catch (error) {
      results.push({workId: item.workId, outcome: 'hold', ticketKey: item.ticketKey, reason: `계획에서 빠진 사실을 알리지 못했다: ${String(error?.message ?? error).slice(0, 120)}`})
      continue
    }
    const failed = record({workId: item.workId, eventType: 'work-retired', payload: {ticketKey: String(item.ticketKey), lifecycle: item.lifecycle, replacedBy}})
    results.push(failed ? {workId: item.workId, outcome: 'hold', ticketKey: item.ticketKey, reason: `알렸는데 원장에 남기지 못했다 — ${failed}`}
      : {workId: item.workId, outcome: 'retired', ticketKey: item.ticketKey, replacedBy})
  }

  const published = results.filter(item => item.outcome === 'published' || item.outcome === 'confirmed')
  const pending = results.filter(item => ['unknown', 'hold'].includes(item.outcome))
  // 보류 사유에 맞는 안내 — 조회 대기와 대체 필요는 할 일이 다르다.
  const supersede = pending.filter(item => item.refused === 'supersede-required')
  const pendingGuidance = [
    supersede.length > 0 ? `작업 내용이 바뀐 ${supersede.length}건은 제자리로 고치지 않습니다. 계획에서 옛 작업을 superseded로 두고 새 작업으로 대체하세요.` : null,
    pending.length > supersede.length ? '나머지 보류는 다음 실행이 조회로 확인합니다(다시 발행하지 않습니다).' : null,
  ].filter(Boolean).join(' ')
  return {
    ok: pending.length === 0, mode: 'work', phase: pending.length === 0 ? 'PUBLISHED' : 'PUBLISHED_WITH_PENDING',
    planDigest, externalWrites, results, reuse: decision.reuse, skipped: decision.skipped,
    synced: results.filter(item => item.outcome === 'synced').map(item => ({workId: item.workId, ticketKey: item.ticketKey})),
    published: published.map(item => ({workId: item.workId, ticketKey: item.ticketKey})),
    pending: pending.map(item => ({workId: item.workId, reason: item.reason})),
    events: WORK_EVENTS_PATH,
    retired: results.filter(item => item.outcome === 'retired').map(item => ({workId: item.workId, ticketKey: item.ticketKey, replacedBy: item.replacedBy})),
    ...(pending.length > 0 ? {guidance: pendingGuidance} : {}),
  }
}
