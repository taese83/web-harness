// work-aggregate-run.mjs — `board --by-feature`(부모 FEAT 집계 보기)와 `claim --publish --aggregate`(집계 티켓)의 실행부.
//
// 집계 티켓은 **개발 대상이 아니다** — FEAT 단위로 WORK 진행을 트래커에 보여주는 요약이다. 발행 규율은 WORK와 같다:
// 확인한 판본만, 쓰기 전에 시도를 남기고, 결과를 모르면 `unknown`으로 둔다. 집계 티켓을 찾는 조회 능력은 아직 없어서
// `unknown`은 **자동으로 풀지 않고 사람에게 넘긴다**(재발행하면 FEAT마다 집계가 둘이 된다).
import {existsSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {canonicalDigest, WORK_ANALYSIS_PATH} from './work-analysis.mjs'
import {WORK_PLAN_PATH} from './work-plan.mjs'
import {appendWorkEvent, foldWorkState, readWorkEvents, WORK_EVENTS_PATH} from './work-events.mjs'
import {aggregateFeatures, renderAggregateBody} from './work-aggregate.mjs'
import {buildAggregateMarker} from './work-refs.mjs'
import {payloadDigest} from './work-publish.mjs'
import {planLabel} from './work-provider.mjs'
import {ticketKeyOf} from './ticket-provider.mjs'

const list = value => (Array.isArray(value) ? value : [])
const readJson = (root, relative) => {
  const path = join(root, relative)
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null
}

async function loadInputs(root, flags) {
  const plan = readJson(root, WORK_PLAN_PATH)
  const analysis = readJson(root, WORK_ANALYSIS_PATH)
  if (!plan || !analysis) return null
  const {loadPlanText, loadUnits} = await import('./cli.mjs')
  let planUnits = []
  let planText = ''
  // 계획 문서가 없으면 TC 대조를 **하지 못한다** — 빈 목록을 「책임 누락 없음」으로 읽지 않게 결과에 적는다.
  try { planUnits = loadUnits(root, flags); planText = loadPlanText(root, flags) } catch { planUnits = null }
  const state = foldWorkState(readWorkEvents(join(root, WORK_EVENTS_PATH)))
  return {plan, analysis, planUnits, planText, state, planDigest: canonicalDigest(plan)}
}

export async function runFeatureBoard({root, flags = {}}) {
  const inputs = await loadInputs(root, flags)
  if (!inputs) return {ok: false, mode: 'work', phase: 'PLAN_REQUIRED', guidance: 'WORK 계획이 없다 — `claim`부터 한다'}
  const result = aggregateFeatures(inputs)
  return {ok: true, mode: 'work', view: 'by-feature', planId: inputs.plan.planId, ...result,
    notes: [
      '`works-merged`는 **인수 완료가 아니다** — 필수 작업이 머지됐다는 뜻이며 통합 revision의 TC 증거는 아직 연결되지 않았다',
      ...(inputs.planUnits === null ? ['feature-plan을 읽지 못해 TC 책임 대조를 하지 못했다 — 해당 FEAT는 `merged-tc-unchecked`로 남는다(누락 없음으로 읽지 않는다)'] : []),
      ...(result.denominator.excluded.length > 0 ? [`제품 유예로 분모에서 뺀 FEAT: ${result.denominator.excluded.join(', ')}`] : []),
    ]}
}

/**
 * @param {{root: string, flags: object, io: {provider: object}}} args
 *   flags: `--features a,b`(선택) · `--confirm`
 */
export async function runAggregatePublish({root, flags = {}, io = {}}) {
  const inputs = await loadInputs(root, flags)
  if (!inputs) return {ok: false, mode: 'work', phase: 'PLAN_REQUIRED', externalWrites: 0}
  const {plan, planDigest, state} = inputs
  // **확인한 판본만** — 검토 뒤 계획이 바뀌었으면 요약도 확인받지 않은 안의 것이다.
  const reviewed = state.lastReviewed
  // 분석이 곧 분모다(유예 종류) — 계획 digest만 보면 검토 뒤 분석만 고친 집계가 나간다.
  const analysisChanged = reviewed?.analysisDigest && reviewed.analysisDigest !== canonicalDigest(inputs.analysis)
  if (!reviewed || reviewed.planId !== plan.planId || reviewed.planDigest !== planDigest || analysisChanged) {
    return {ok: false, mode: 'work', phase: 'PUBLISH_BLOCKED', externalWrites: 0,
      errors: ['검토 기록이 없거나 검토 뒤 계획이 바뀌었다 — `claim`으로 다시 검토한 뒤 발행한다']}
  }
  const provider = io.provider
  const missing = ['buildWorkFields', 'createIssue', 'updateBody'].filter(name => typeof provider?.[name] !== 'function')
  if (missing.length > 0) {
    return {ok: false, mode: 'work', phase: 'PROVIDER_NOT_READY', externalWrites: 0, missing: missing.map(name => `provider.${name}`)}
  }
  // TC 책임을 대조하지 못한 채 트래커에 요약을 내면 대조하지 않은 상태가 사실처럼 남는다.
  if (inputs.planUnits === null) {
    return {ok: false, mode: 'work', phase: 'PUBLISH_BLOCKED', externalWrites: 0,
      errors: ['feature-plan을 읽지 못해 TC 책임 대조를 하지 못했다 — 계획 문서를 복구한 뒤 발행한다']}
  }
  const {features} = aggregateFeatures(inputs)
  const selection = flags.features ? String(flags.features).split(',').map(value => value.trim()).filter(Boolean) : null
  const unknownSelection = list(selection).filter(id => !features.some(feature => feature.featureId === id))
  if (unknownSelection.length > 0) {
    return {ok: false, mode: 'work', phase: 'PUBLISH_BLOCKED', externalWrites: 0, errors: [`계획에 없는 FEAT를 골랐다: ${unknownSelection.join(', ')}`]}
  }
  const plans = features.filter(feature => !selection || selection.includes(feature.featureId)).map(feature => {
    if (!feature.works) return {featureId: feature.featureId, action: 'skip', reason: feature.status}
    const marker = buildAggregateMarker({planId: plan.planId, featureId: feature.featureId})
    const body = renderAggregateBody({feature, plan, marker})
    const fields = provider.buildWorkFields({title: `[집계] ${feature.featureId}`, body,
      labels: [planLabel(plan.planId), ...(typeof provider.featLabel === 'function' ? [provider.featLabel(feature.featureId)] : []), 'work-aggregate']})
    const digest = payloadDigest({body})
    const current = state.aggregates.get(feature.featureId) ?? null
    if (current?.status === 'attempted' || current?.status === 'unknown') {
      return {featureId: feature.featureId, action: 'hold', reason: '이전 발행 결과를 모른다 — 트래커를 사람이 확인한다(재발행하면 집계가 둘이 된다)'}
    }
    if (current?.status === 'published') {
      return current.bodyDigest === digest
        ? {featureId: feature.featureId, action: 'unchanged', ticketKey: current.ticketKey}
        : {featureId: feature.featureId, action: 'refresh', ticketKey: current.ticketKey, body, digest}
    }
    return {featureId: feature.featureId, action: 'create', fields, digest}
  })
  const preview = {mode: 'work', phase: 'PUBLISH_PREVIEW', externalWrites: 0,
    aggregates: plans.map(({fields, body, ...rest}) => rest)}
  if (!flags.confirm) return {...preview, ok: true, guidance: '이 목록으로 발행·갱신하려면 같은 요청에 --confirm을 붙인다'}

  const record = event => {
    try { appendWorkEvent(join(root, WORK_EVENTS_PATH), {schemaVersion: 1, eventId: randomUUID(), planId: plan.planId, planDigest, at: new Date().toISOString(), ...event}); return null }
    catch (error) { return String(error?.message ?? error).slice(0, 160) }
  }
  const results = []
  let externalWrites = 0
  for (const item of plans) {
    if (item.action === 'skip' || item.action === 'unchanged' || item.action === 'hold') { results.push(item); continue }
    const operationId = randomUUID()
    if (item.action === 'refresh') {
      // 쓰기를 **시도한 순간** 센다 — 던져도 트래커에 닿았을 수 있다.
      externalWrites += 1
      try {
        await provider.updateBody(item.ticketKey, item.body)
      } catch (error) {
        results.push({featureId: item.featureId, action: 'hold', reason: `본문 갱신 실패: ${String(error?.message ?? error).slice(0, 120)}`}); continue
      }
      const failed = record({operationId, featureId: item.featureId, eventType: 'aggregate-refreshed', payload: {ticketKey: item.ticketKey, payloadDigest: item.digest}})
      results.push(failed ? {featureId: item.featureId, action: 'hold', ticketKey: item.ticketKey, reason: `갱신은 됐는데 원장에 남기지 못했다 — ${failed}`}
        : {featureId: item.featureId, action: 'refreshed', ticketKey: item.ticketKey})
      continue
    }
    // 생성 — 쓰기 **전에** 시도를 남긴다.
    const attemptFailed = record({operationId, featureId: item.featureId, eventType: 'aggregate-attempted', payload: {payloadDigest: item.digest}})
    if (attemptFailed) { results.push({featureId: item.featureId, action: 'hold', reason: `원장에 시도를 남기지 못해 발행하지 않는다 — ${attemptFailed}`}); continue }
    externalWrites += 1
    let created = null
    try { created = await provider.createIssue(item.fields) } catch (error) {
      record({operationId, featureId: item.featureId, eventType: 'aggregate-unknown', payload: {reason: String(error?.message ?? error).slice(0, 200)}})
      results.push({featureId: item.featureId, action: 'unknown', reason: '발행 결과를 모른다 — 사람이 트래커를 확인한다'}); continue
    }
    const ticketKey = ticketKeyOf(created)
    if (!ticketKey) {
      record({operationId, featureId: item.featureId, eventType: 'aggregate-unknown', payload: {reason: '생성 응답에 키가 없다'}})
      results.push({featureId: item.featureId, action: 'unknown', reason: '생성 응답에 키가 없다'}); continue
    }
    const failed = record({operationId, featureId: item.featureId, eventType: 'aggregate-confirmed', payload: {ticketKey, payloadDigest: item.digest}})
    results.push(failed ? {featureId: item.featureId, action: 'hold', ticketKey, reason: `발행은 됐는데(${ticketKey}) 원장에 남기지 못했다 — ${failed}`}
      : {featureId: item.featureId, action: 'created', ticketKey})
  }
  const pending = results.filter(item => ['hold', 'unknown'].includes(item.action))
  return {ok: pending.length === 0, mode: 'work', phase: pending.length === 0 ? 'PUBLISHED' : 'PUBLISHED_WITH_PENDING', externalWrites, results}
}
