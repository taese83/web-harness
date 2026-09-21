// work-refs.mjs — WORK 티켓의 마커와 **티켓 종류 선판정**.
//
// 계기(설계 §7.3): 기존 `parseIssueRefs`는 마커가 없으면 **본문 전체에서 FEAT를 찾는다**. WORK 티켓
// 본문에는 부모 FEAT가 적히므로, 새 마커만 추가하면 WORK 티켓이 legacy FEAT 티켓으로 오인된다 —
// 그러면 개발 티켓 하나가 두 모델에 동시에 속한다. 그래서 **모든 판독 입구에서 종류를 먼저 판정**하고
// work/aggregate는 legacy 폴백에서 제외한다.
//
// 마커는 사람의 설명을 복제하지 않는다: 계획·작업·부모 FEAT·TC와 그 계획 판본만 담는다.
export const WORK_MARKER_BEGIN = '<!-- web-harness:work'
export const AGGREGATE_MARKER_BEGIN = '<!-- web-harness:aggregate'
const MARKER_END = '-->'
const SOURCE_MARKER = 'web-harness:source'
const REFS_MARKER = 'web-harness:refs'
// ID 형식의 **단일 소유**. 원장·마커·계획이 각자 복제하면 한쪽만 고쳐져 서로 다른 ID를 받아들인다.
export const WORK_ID = /^WORK-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
export const DIGEST = /^[0-9a-f]{64}$/
const FIELD = (name, scope) => scope.match(new RegExp(`\\b${name}=([^\\s]+)`))?.[1] ?? null
const list = value => (value ? value.split(',').filter(Boolean) : [])

/** WORK 티켓 본문에 넣을 마커(순수). 손상시키는 값은 loud 거부한다 — 정본 주장을 유지하려면 시끄러워야 한다. */
export function buildWorkMarker({planId, workId, featureIds = [], testCaseIds = [], planDigest}) {
  if (!UUID.test(String(planId))) throw new Error(`INVALID_PLAN_ID: ${planId}`)
  if (!WORK_ID.test(String(workId))) throw new Error(`INVALID_WORK_ID: ${workId}`)
  if (!/^[0-9a-f]{64}$/.test(String(planDigest))) throw new Error(`INVALID_PLAN_DIGEST: ${planDigest}`)
  const ids = [...featureIds, ...testCaseIds]
  if (ids.some(value => /\s|-->/.test(String(value)))) throw new Error('INVALID_MARKER_FIELD: 공백이나 -->가 마커를 절단한다')
  return `${WORK_MARKER_BEGIN} plan=${planId} work=${workId} feat=${featureIds.join(',')} tc=${testCaseIds.join(',')} rev=${planDigest} ${MARKER_END}`
}

/** 본문에서 WORK 마커를 떼어낸다(순수) — 사람이 읽는 본문의 지문·교체에 쓴다. */
export const stripWorkMarker = body => String(body ?? '').replace(/\s*<!-- web-harness:work\b[\s\S]*?-->\s*/g, '\n').trim()
/** 마커를 본문 끝에 둔다(순수) — 기존 WORK 마커는 교체한다. 사람이 고친 본문은 그대로 둔다. */
export const withWorkMarker = (body, marker) => `${stripWorkMarker(body)}\n\n${marker}`
/** 사람이 읽는 본문의 지문 입력(순수) — 트래커가 줄 끝·공백을 바꿔 돌려줘도 같은 본문으로 본다. */
export const normalizeDocBody = body => stripWorkMarker(body).replace(/\r\n/g, '\n').split('\n').map(line => line.trimEnd()).join('\n').trim()

/** 집계 티켓 마커(순수) — 어느 계획의 어느 FEAT를 묶는가만 담는다. 작업 목록은 본문 표가 사람에게 보여준다. */
export function buildAggregateMarker({planId, featureId}) {
  if (!UUID.test(String(planId))) throw new Error(`INVALID_PLAN_ID: ${planId}`)
  if (!/^FEAT-\d{3,}$/.test(String(featureId))) throw new Error(`INVALID_FEATURE_ID: ${featureId}`)
  return `${AGGREGATE_MARKER_BEGIN} plan=${planId} feat=${featureId} ${MARKER_END}`
}

/**
 * 본문에서 WORK 마커를 되읽는다(순수). 마커 구획 **안에서만** 읽는다 — 산문의 언급을 줍지 않는다.
 * 마커가 둘 이상이거나 필드가 깨졌으면 `{error}` — 조용히 첫 번째를 고르지 않는다.
 * @returns {{present: boolean, planId?: string, workId?: string, featureIds?: string[], testCaseIds?: string[], planDigest?: string, error?: string}}
 */
export function parseWorkMarker(body) {
  const text = typeof body === 'string' ? body : ''
  const starts = [...text.matchAll(/<!-- web-harness:work\b/g)].map(match => match.index)
  if (starts.length === 0) return {present: false}
  if (starts.length > 1) return {present: true, error: 'WORK 마커가 둘 이상이다 — 어느 것이 정본인지 추측하지 않는다'}
  const end = text.indexOf(MARKER_END, starts[0])
  if (end < 0) return {present: true, error: 'WORK 마커가 닫히지 않았다'}
  const scope = text.slice(starts[0], end + MARKER_END.length)
  const planId = FIELD('plan', scope)
  const workId = FIELD('work', scope)
  const planDigest = FIELD('rev', scope)
  if (!UUID.test(String(planId))) return {present: true, error: `WORK 마커의 plan이 UUID가 아니다: ${planId}`}
  if (!WORK_ID.test(String(workId))) return {present: true, error: `WORK 마커의 work가 WORK-<UUID>가 아니다: ${workId}`}
  if (!/^[0-9a-f]{64}$/.test(String(planDigest))) return {present: true, error: `WORK 마커의 rev가 계획 digest가 아니다: ${planDigest}`}
  return {present: true, planId, workId, planDigest,
    featureIds: list(FIELD('feat', scope)), testCaseIds: list(FIELD('tc', scope))}
}

/**
 * 티켓 종류 선판정(순수) — 모든 판독 입구가 **먼저** 부른다.
 *  - `work`      WORK 마커가 있다 → legacy FEAT 폴백에서 제외한다
 *  - `aggregate` 여러 작업을 묶는 큰 개발 티켓 → 자체를 작업으로 다시 발행하지 않는다
 *  - `source`    기획 출처(사람이 쓴 기획 티켓)
 *  - `legacy`    기존 왕복 마커(FEAT 개발 티켓)
 *  - `unknown`   마커가 없다 — 본문에서 추측하지 않는다(intake·adopt가 근거로 판정한다)
 * 마커가 여럿이면 `conflict`다 — 같은 티켓이 두 모델에 속할 수 없다.
 * @returns {{kind: string, error?: string, marker?: object}}
 */
export function classifyTicketKind(body) {
  const text = typeof body === 'string' ? body : ''
  const marker = parseWorkMarker(text)
  const hasAggregate = text.includes(AGGREGATE_MARKER_BEGIN)
  const hasSource = text.includes(SOURCE_MARKER)
  const hasRefs = text.includes(REFS_MARKER)
  const kinds = [marker.present && 'work', hasAggregate && 'aggregate', hasSource && 'source', hasRefs && 'legacy'].filter(Boolean)
  if (kinds.length > 1) return {kind: 'conflict', error: `한 티켓에 마커가 둘 이상이다(${kinds.join(', ')}) — 같은 티켓이 두 모델에 속할 수 없다`}
  if (marker.present) return marker.error ? {kind: 'work', error: marker.error} : {kind: 'work', marker}
  if (hasAggregate) return {kind: 'aggregate'}
  if (hasSource) return {kind: 'source'}
  if (hasRefs) return {kind: 'legacy'}
  return {kind: 'unknown'}
}

// 선행을 **티켓 키**로 적는 자리(사람이 만든 개발 티켓) — Jira 키 · GitHub 번호(`#` 생략 가능). WORK ID와 겹치지 않는다.
const TICKET_KEY_REF = /^(?:[A-Za-z][A-Za-z0-9_]*-\d+|#?\d+)$/
// 하네스 내부 ID(기획 FEAT·TC)는 티켓 키 모양이어도 키가 아니다 — 받으면 「계획에 없다」가 무기한 선행 대기로 바뀐다.
const INTERNAL_ID = /^(?:WORK|FEAT|TC)-/
export const isTicketKeyRef = dep => typeof dep === 'string' && !INTERNAL_ID.test(dep) && TICKET_KEY_REF.test(dep)
export const normalizeTicketKeyRef = dep => String(dep).replace(/^#/, '')
