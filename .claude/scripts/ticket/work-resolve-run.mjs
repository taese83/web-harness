// work-resolve-run.mjs — `claim --publish --resolve <WORK-ID|FEAT-ID> --ticket <키>`: 결과를 모르는 발행을 **확정**한다.
//
// 발행 응답이 유실되면 `unknown`으로 남고, 조회가 불완전한 트래커(GitHub 색인 지연)나 조회 능력이 없는 집계는
// 자동으로 풀리지 않는다. 사람이 트래커에서 티켓을 찾았을 때 그것을 원장에 잇는 입구다 — 원장 줄을 손으로
// 쓰게 두면 형식·operationId를 틀려 원장이 깨진다.
//
// **사람의 말만 믿지 않는다.** 준 키로 티켓을 조회해 본문에 **그 작업(또는 FEAT 집계)의 마커**가 있을 때만
// 확정한다. 확인 없이는 미리보기다(원장 쓰기도 쓰기다).
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {existsSync, readFileSync} from 'node:fs'
import {canonicalDigest} from './work-analysis.mjs'
import {WORK_PLAN_PATH} from './work-plan.mjs'
import {appendWorkEvent, foldWorkState, readWorkEvents, WORK_EVENTS_PATH} from './work-events.mjs'
import {buildAggregateMarker, parseWorkMarker, WORK_ID} from './work-refs.mjs'

export async function runPublishResolve({root, flags = {}, io = {}}) {
  const target = String(flags.resolve ?? '')
  const ticketKey = typeof flags.ticket === 'string' ? flags.ticket : null
  // 트래커를 바꿔 부르면 원장에 엉뚱한 provider가 남는다 — 확정은 설정된 트래커로만 한다.
  if (flags['ticket-provider']) return {ok: false, mode: 'work', phase: 'RESOLVE_BLOCKED', errors: ['확정은 설정된 트래커로만 한다 — --ticket-provider와 함께 쓰지 않는다']}
  const planPath = join(root, WORK_PLAN_PATH)
  if (!existsSync(planPath)) return {ok: false, mode: 'work', phase: 'PLAN_REQUIRED'}
  const plan = JSON.parse(readFileSync(planPath, 'utf8'))
  if (!ticketKey) return {ok: false, mode: 'work', phase: 'RESOLVE_BLOCKED', errors: ['`--ticket <키>`가 필요하다 — 트래커에서 찾은 티켓의 키']}
  const eventsPath = join(root, WORK_EVENTS_PATH)
  const state = foldWorkState(readWorkEvents(eventsPath))
  const isWork = WORK_ID.test(target)
  const isFeature = /^FEAT-\d{3,}$/.test(target)
  if (!isWork && !isFeature) return {ok: false, mode: 'work', phase: 'RESOLVE_BLOCKED', errors: [`WORK-<UUID> 또는 FEAT-NNN이 아니다: ${target}`]}
  const current = isWork ? state.works.get(target) : state.aggregates.get(target)
  // 이미 확정된 것·시도한 적 없는 것은 풀 대상이 아니다 — 새 발행을 여기로 우회시키지 않는다.
  if (!current || !['attempted', 'unknown'].includes(current.status)) {
    return {ok: false, mode: 'work', phase: 'RESOLVE_BLOCKED', errors: [`${target}는 결과를 모르는 발행이 아니다(상태: ${current?.status ?? 'unpublished'})`]}
  }
  const provider = io.provider
  if (typeof provider?.resolveIssue !== 'function') return {ok: false, mode: 'work', phase: 'PROVIDER_NOT_READY', missing: ['provider.resolveIssue']}
  let issue
  try { issue = await provider.resolveIssue(ticketKey) } catch (error) {
    return {ok: false, mode: 'work', phase: 'RESOLVE_BLOCKED', errors: [`${ticketKey}를 조회하지 못했다 — ${String(error?.message ?? error).slice(0, 160)}`]}
  }
  const body = String(issue?.body ?? '')
  const matches = isWork
    // 마커의 발행 판본(`rev`)도 이 시도의 판본이어야 한다 — 옛 시도의 티켓을 최신 판본으로 확정하면 픽업 STALE이 속는다.
    ? (() => { const marker = parseWorkMarker(body); return marker.workId === target && marker.planId === plan.planId && marker.planDigest === current.planDigest })()
    : (() => { try { return body.includes(buildAggregateMarker({planId: plan.planId, featureId: target})) } catch { return false } })()
  if (!matches) {
    return {ok: false, mode: 'work', phase: 'RESOLVE_BLOCKED',
      errors: [`${ticketKey} 본문에 ${target}의 마커가 없다 — 이 계획이 낸 그 티켓이라는 근거가 없어 확정하지 않는다`]}
  }
  const event = {schemaVersion: 1, eventId: randomUUID(), operationId: current.operationId ?? randomUUID(), planId: plan.planId,
    ...(isWork ? {workId: target, eventType: 'publish-confirmed'} : {featureId: target, eventType: 'aggregate-confirmed'}),
    at: new Date().toISOString(), planDigest: current.planDigest ?? canonicalDigest(plan),
    payload: {ticketKey: String(ticketKey), via: 'manual-resolve', ...(isWork ? {provider: provider.name} : {})}}
  if (!flags.confirm) return {ok: true, mode: 'work', phase: 'RESOLVE_PREVIEW', target, ticketKey, verified: 'marker-present',
    guidance: '이 티켓으로 확정하려면 같은 요청에 --confirm을 붙인다'}
  appendWorkEvent(eventsPath, event)
  return {ok: true, mode: 'work', phase: 'RESOLVED', target, ticketKey}
}
