// work-events.mjs — WORK 이벤트 원장(append-only)의 파싱·검증·접기.
//
// 기존 `identity-ledger.jsonl`(v1)은 `featureId`별 최신 상태로 접힌다 — WORK는 `(planId, workId)`로
// 접어야 하고, 발행 시도/확정/불확실을 구분해야 하며(응답 유실·부분 발행 복구), 픽업·PR도 같은 축에
// 남아야 한다. 그래서 v1을 재작성하지 않고 **별도 이벤트 파일**을 둔다(설계 §8).
//
// 이 파일이 지키는 것:
//   - **조용히 버리지 않는다.** 파손 줄·모르는 스키마 버전·알 수 없는 eventType은 실패다 — 버리면
//     상태가 이전 완료로 되돌아간 것처럼 보인다.
//   - **같은 eventId가 다른 내용이면 실패다.** 재실행이 같은 이벤트를 다시 쓰는 것은 허용(같은 내용),
//     내용이 다르면 둘 중 하나가 위조이거나 사고다.
//   - **순서의 정본은 파일 순서다.** `at`은 정보이지 불변식이 아니다 — 두 프로세스가 겹쳐 append하면
//     시각을 먼저 찍은 쪽이 나중에 쓰는 인터리빙이 정상이고, 공유 워크스페이스는 기계 간 시계 편차도 있다.
//     시각 단조를 강제하면 정상 실행이 원장을 **읽을 수 없게** 만들고 복구가 손편집뿐이 된다(2026-09-14 적대 리뷰).
//   - 상태는 접어서 계산한다 — 어떤 줄도 뒤에서 고쳐 쓰지 않는다.
import {existsSync, readFileSync} from 'node:fs'
import {appendEvidenceLine} from '../evidence-log-lib.mjs'
import {DIGEST, UUID, WORK_ID} from './work-refs.mjs'

export const WORK_EVENTS_PATH = '_workspace/03_dev/work-item-events.jsonl'
// **소비자와 함께 늘린다.** 여기 있는 것은 지금 생산자와 소비자가 모두 있는 종류뿐이다.
export const EVENT_TYPES = ['plan-reviewed', 'publish-attempted', 'publish-confirmed', 'publish-unknown', 'relation-linked',
  'work-linked', 'work-completed', 'aggregate-attempted', 'aggregate-confirmed', 'aggregate-unknown', 'aggregate-refreshed']
// 소비자가 있는 키만 둔다. `operationId`는 **외부 쓰기 시도의 단위**이며 발행 이벤트에서만 쓴다(P2-c).
const KEYS = ['schemaVersion', 'eventId', 'operationId', 'planId', 'workId', 'featureId', 'eventType', 'at', 'planDigest', 'payload']

/** 한 이벤트의 형식 검증(순수). 오류 메시지 배열을 돌려준다. */
export function validateWorkEvent(event) {
  const errors = []
  if (!event || typeof event !== 'object' || Array.isArray(event)) return ['이벤트가 객체가 아니다']
  const unknown = Object.keys(event).filter(key => !KEYS.includes(key))
  if (unknown.length > 0) errors.push(`알 수 없는 키 ${unknown.sort().join(', ')} — 조용히 버리지 않는다`)
  if (event.schemaVersion !== 1) errors.push('schemaVersion은 1이어야 한다')
  if (!UUID.test(String(event.eventId ?? ''))) errors.push('eventId는 UUID여야 한다')
  if (!UUID.test(String(event.planId ?? ''))) errors.push('planId는 UUID여야 한다')
  if (!EVENT_TYPES.includes(event.eventType)) errors.push(`eventType은 ${EVENT_TYPES.join('|')} — 소비자 없는 종류를 미리 늘리지 않는다`)
  if (typeof event.at !== 'string' || !Number.isFinite(Date.parse(event.at))) errors.push('at이 시각이 아니다')
  if (event.workId !== undefined && !WORK_ID.test(String(event.workId))) errors.push('workId 형식 오류')
  if (event.featureId !== undefined && !/^FEAT-\d{3,}$/.test(String(event.featureId))) errors.push('featureId 형식 오류')
  if (event.planDigest !== undefined && !DIGEST.test(String(event.planDigest))) errors.push('planDigest 형식 오류')
  if (event.payload !== undefined && (typeof event.payload !== 'object' || event.payload === null || Array.isArray(event.payload))) {
    errors.push('payload는 객체여야 한다')
  }
  if (event.operationId !== undefined && !UUID.test(String(event.operationId))) errors.push('operationId는 UUID여야 한다')
  // 발행 이벤트는 **어느 작업을 어느 시도로** 썼는지가 요체다 — 그것이 없으면 재개가 무엇을 이어야 할지 모른다.
  if (event.eventType.startsWith('publish-') || event.eventType === 'relation-linked') {
    if (!WORK_ID.test(String(event.workId ?? ''))) errors.push(`${event.eventType}에는 workId가 필요하다`)
    if (!UUID.test(String(event.operationId ?? ''))) errors.push(`${event.eventType}에는 operationId(외부 쓰기 시도 단위)가 필요하다`)
    if (!DIGEST.test(String(event.planDigest ?? ''))) errors.push(`${event.eventType}에는 planDigest가 필요하다 — 어느 판본을 발행했는지`)
  }
  if (event.eventType === 'publish-attempted' && !DIGEST.test(String(event.payload?.payloadDigest ?? ''))) {
    errors.push('publish-attempted에는 payload.payloadDigest가 필요하다 — 같은 시도 id로 다른 요청을 보내지 않기 위해서다')
  }
  if (event.eventType === 'publish-confirmed' && !event.payload?.ticketKey) {
    errors.push('publish-confirmed에는 payload.ticketKey가 필요하다')
  }
  if (event.eventType === 'publish-confirmed' && event.payload?.provider !== undefined && !/^[a-z][a-z0-9-]*$/.test(String(event.payload.provider))) {
    errors.push('publish-confirmed의 payload.provider 형식 오류')
  }
  // PR 연결·완료는 **어느 작업의 어느 PR**인가가 요체다. 완료 판정 요약이 없으면 「의식적 인수」로
  // 넘긴 링크와 전부 충족한 링크가 사후에 구별되지 않는다(legacy 원장이 같은 이유로 남기던 것).
  if (event.eventType === 'work-linked' || event.eventType === 'work-completed') {
    if (!WORK_ID.test(String(event.workId ?? ''))) errors.push(`${event.eventType}에는 workId가 필요하다`)
    if (typeof event.payload?.prUrl !== 'string' || event.payload.prUrl.length === 0) errors.push(`${event.eventType}에는 payload.prUrl이 필요하다`)
  }
  if (event.eventType === 'work-linked') {
    if (!DIGEST.test(String(event.planDigest ?? ''))) errors.push('work-linked에는 planDigest가 필요하다 — 어느 판본으로 완료를 주장했는지')
    const completion = event.payload?.completion
    if (!completion || typeof completion !== 'object' || typeof completion.ok !== 'boolean') {
      errors.push('work-linked에는 payload.completion(판정 요약)이 필요하다')
    }
    if (typeof event.payload?.staleCheck !== 'string') errors.push('work-linked에는 payload.staleCheck가 필요하다')
  }
  if (event.eventType === 'work-completed' && event.payload?.via !== 'pr-merged') {
    errors.push('work-completed의 payload.via는 pr-merged여야 한다 — 머지를 관측하지 않은 완료를 기록하지 않는다')
  }
  // 집계 티켓은 **FEAT 단위**다 — 어느 FEAT의 집계를 어느 시도로 썼는지가 요체다(발행 규율은 WORK와 같다).
  if (event.eventType.startsWith('aggregate-')) {
    if (!/^FEAT-\d{3,}$/.test(String(event.featureId ?? ''))) errors.push(`${event.eventType}에는 featureId가 필요하다`)
    if (event.workId !== undefined) errors.push(`${event.eventType}에는 workId를 두지 않는다 — 집계는 작업이 아니다`)
    if (!UUID.test(String(event.operationId ?? ''))) errors.push(`${event.eventType}에는 operationId가 필요하다`)
    if (!DIGEST.test(String(event.planDigest ?? ''))) errors.push(`${event.eventType}에는 planDigest가 필요하다`)
    if (['aggregate-attempted', 'aggregate-refreshed'].includes(event.eventType) && !DIGEST.test(String(event.payload?.payloadDigest ?? ''))) {
      errors.push(`${event.eventType}에는 payload.payloadDigest가 필요하다`)
    }
    if (['aggregate-confirmed', 'aggregate-refreshed'].includes(event.eventType) && !event.payload?.ticketKey) {
      errors.push(`${event.eventType}에는 payload.ticketKey가 필요하다`)
    }
  }
  // 종류별 필수: 계보 이벤트의 요체는 어느 판본의 어느 작업들인가다 — 손상되면 조용히 건너뛰지 않고 막는다.
  if (event.eventType === 'plan-reviewed') {
    if (!DIGEST.test(String(event.planDigest ?? ''))) errors.push('plan-reviewed에는 planDigest가 필요하다')
    const workIds = event.payload?.workIds
    if (!Array.isArray(workIds) || workIds.length === 0) errors.push('plan-reviewed에는 payload.workIds(검토한 작업 ID)가 필요하다')
    else if (!workIds.every(id => WORK_ID.test(String(id)))) errors.push('plan-reviewed의 payload.workIds에 WORK-<UUID>가 아닌 값이 있다')
    if (event.payload?.analysisDigest !== undefined && !DIGEST.test(String(event.payload.analysisDigest))) errors.push('plan-reviewed의 analysisDigest 형식 오류')
  }
  return errors
}

/**
 * 이벤트 파일을 파싱한다(순수). **파손은 예외다** — 버리고 진행하면 지나간 상태로 되돌아간다.
 * @returns {Array<object>}
 */
export function parseWorkEvents(text) {
  const events = []
  const seen = new Map()
  for (const [index, raw] of String(text ?? '').split(/\r?\n/).entries()) {
    const line = raw.trim()
    if (line === '') continue
    let event
    try { event = JSON.parse(line) } catch (error) { throw new Error(`WORK_EVENTS_CORRUPT: ${index + 1}번째 줄을 읽지 못했다 — ${error.message}`) }
    const errors = validateWorkEvent(event)
    if (errors.length > 0) throw new Error(`WORK_EVENTS_INVALID: ${index + 1}번째 줄 — ${errors.join(' · ')}`)
    const canonical = JSON.stringify(event, Object.keys(event).sort())
    if (seen.has(event.eventId)) {
      if (seen.get(event.eventId) !== canonical) throw new Error(`WORK_EVENTS_CONFLICT: 같은 eventId ${event.eventId}가 다른 내용으로 두 번 있다`)
      continue // 같은 내용의 재기록은 재실행의 정상 결과다
    }
    seen.set(event.eventId, canonical)
    events.push(event)
  }
  return events
}

/** 파일에서 읽는다(없으면 빈 배열). 파손은 그대로 던진다. */
export function readWorkEvents(path) {
  return existsSync(path) ? parseWorkEvents(readFileSync(path, 'utf8')) : []
}

/**
 * 상태로 접는다(순수). 지금 접는 것: 계획별 검토 이력과 **한 번이라도 검토된 작업 ID 계보**.
 * 계보는 취소 뒤 배열에서 지우는 2단 삭제를 잡는 입력이며, 로컬 포인터보다 지우기 어렵다(append-only).
 */
export function foldWorkState(events) {
  const knownWorkIds = new Set()
  const works = new Map()
  const aggregates = new Map()
  let lastReviewed = null
  const workState = workId => works.get(workId) ?? {workId, status: 'unpublished', ticketKey: null, operationId: null,
    payloadDigest: null, planDigest: null, relation: null, link: null, completed: null}
  for (const event of events) {
    // 형식은 파서가 이미 막았다 — 여기서 건너뛰는 값은 없다(조용한 스킵은 이 모듈의 원칙과 반대다).
    if (event.eventType.startsWith('aggregate-')) {
      const current = aggregates.get(event.featureId) ?? {featureId: event.featureId, status: 'unpublished', ticketKey: null}
      const status = {'aggregate-attempted': current.status === 'published' ? 'published' : 'attempted',
        'aggregate-confirmed': 'published', 'aggregate-unknown': current.status === 'published' ? 'published' : 'unknown',
        'aggregate-refreshed': 'published'}[event.eventType]
      aggregates.set(event.featureId, {...current, status, operationId: event.operationId, planDigest: event.planDigest,
        ticketKey: event.payload?.ticketKey ? String(event.payload.ticketKey) : current.ticketKey,
        ...(event.eventType === 'aggregate-refreshed' || event.eventType === 'aggregate-confirmed' ? {bodyDigest: event.payload?.payloadDigest ?? current.bodyDigest ?? null} : {})})
      continue
    }
    if (event.eventType === 'plan-reviewed') {
      for (const workId of event.payload.workIds) knownWorkIds.add(workId)
      lastReviewed = {planId: event.planId, planDigest: event.planDigest, analysisDigest: event.payload.analysisDigest ?? null, at: event.at}
      continue
    }
    const state = workState(event.workId)
    knownWorkIds.add(event.workId)
    if (event.eventType === 'publish-attempted') {
      // 시도는 **확정이 아니다.** 다음 실행이 이 자리를 이어야 한다 — 응답이 유실됐을 수 있다.
      works.set(event.workId, {...state, status: 'attempted', operationId: event.operationId,
        payloadDigest: event.payload.payloadDigest, planDigest: event.planDigest})
    } else if (event.eventType === 'publish-confirmed') {
      works.set(event.workId, {...state, status: 'published', ticketKey: String(event.payload.ticketKey),
        operationId: event.operationId, planDigest: event.planDigest, provider: event.payload.provider ?? null})
    } else if (event.eventType === 'publish-unknown') {
      // 외부 결과를 모른다 — **부재로 읽지 않는다.** 재개가 조회로 확인할 자리다.
      works.set(event.workId, {...state, status: 'unknown', operationId: event.operationId,
        planDigest: event.planDigest, reason: event.payload?.reason ?? null})
    } else if (event.eventType === 'work-linked') {
      // 완료 **주장**이다 — 머지를 본 것이 아니다. 선행 조건은 이것이 아니라 `completed`를 본다.
      works.set(event.workId, {...state, link: {prUrl: event.payload.prUrl, planDigest: event.planDigest,
        completion: event.payload.completion, staleCheck: event.payload.staleCheck, baseRef: event.payload.baseRef ?? null,
        acceptedIncomplete: event.payload.acceptedIncomplete === true, acceptedUnverifiedScope: event.payload.acceptedUnverifiedScope === true}})
    } else if (event.eventType === 'work-completed') {
      works.set(event.workId, {...state, completed: {prUrl: event.payload.prUrl, at: event.at}})
    } else if (event.eventType === 'relation-linked') {
      works.set(event.workId, {...state, relation: {mode: event.payload?.mode ?? null, applied: event.payload?.applied === true,
        parentKey: event.payload?.parentKey ?? null}})
    }
  }
  return {knownWorkIds, lastReviewed, works, aggregates}
}

/** append. 형식 검증을 통과한 이벤트만 파일에 닿는다(파서가 되읽을 수 있는 줄만 쓴다). */
export function appendWorkEvent(path, event) {
  const errors = validateWorkEvent(event)
  if (errors.length > 0) throw new Error(`WORK_EVENT_REJECTED: ${errors.join(' · ')}`)
  appendEvidenceLine(path, event, {
    validate: line => { if (parseWorkEvents(line).length !== 1) throw new Error('WORK_EVENT_REJECTED: 파서가 되읽지 못하는 줄') },
  })
  return event
}
