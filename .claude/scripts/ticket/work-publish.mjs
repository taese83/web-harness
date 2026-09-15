// work-publish.mjs — WORK 발행의 **계획과 재개 판정**(순수). 외부 쓰기는 호출자(CLI)가 한다.
//
// 설계 §8이 요구하는 것을 그대로 판정한다:
//   - **확인한 판본만 발행한다.** 검토 이벤트의 계획 digest와 지금 계획이 다르면 발행하지 않는다 —
//     `--confirm` 하나가 아직 작성되지 않은 미래 분해안의 승인이 되지 않는다.
//   - **선행이 함께 있어야 한다.** 선택한 작업의 모든 선행은 이번 발행에 포함되거나 이미 등록돼 있어야
//     한다. 미등록 선행을 자동 완료로 취급하지 않는다(§4.5).
//   - **이미 발행된 것을 다시 내지 않는다.** 같은 기반을 배치마다 재발행하면 공유 WORK가 복제된다.
//   - **불확실을 부재로 읽지 않는다.** 시도했는데 결과를 모르면 조회로 확인하고, 조회가 불완전하면
//     재발행하지 않고 사람에게 조정을 맡긴다(§8-5).
import {createHash} from 'node:crypto'
import {WORK_ID} from './work-refs.mjs'
import {canonicalDigest} from './work-analysis.mjs'

const list = value => (Array.isArray(value) ? value : [])
const canonical = input => Array.isArray(input) ? input.map(canonical)
  : input && typeof input === 'object' ? Object.fromEntries(Object.keys(input).sort().map(key => [key, canonical(input[key])])) : input

/** 발행 요청 본문의 지문 — 같은 시도 id로 **다른 요청**을 보내지 않기 위한 결박(§8-3). */
export const payloadDigest = fields => createHash('sha256').update(JSON.stringify(canonical(fields))).digest('hex')

/**
 * 발행 대상을 정한다(순수).
 * @param {{plan: object, planDigest: string, state: object, selection?: string[]|null, blockedWorkIds?: Set<string>, reviewed?: object|null}} args
 *   state: `foldWorkState` 결과 · selection: 고른 workId(없으면 착수 가능 + 이미 시도된 것 전부)
 * @returns {{ok: boolean, publish: object[], resume: object[], reuse: object[], skipped: object[], errors: string[]}}
 */
export function planPublish({plan, planDigest, state, selection = null, blockedWorkIds = new Set(), reviewed = null}) {
  const errors = []
  // 1) **검토한 판본인가.** 계획이 검토 뒤 바뀌었으면 그 안은 아직 확인받지 않았다.
  if (!reviewed) errors.push('이 계획을 검토한 기록이 없다 — `claim`로 검토표를 먼저 만든다')
  else if (reviewed.planId !== plan.planId) errors.push(`검토 기록이 다른 계획이다(${reviewed.planId})`)
  else if (reviewed.planDigest !== planDigest) errors.push('검토 뒤 계획이 바뀌었다 — 바뀐 안을 다시 검토한 뒤 발행한다(사전 승인은 새 안의 승인이 아니다)')

  const active = list(plan.workItems).filter(work => (work.lifecycle ?? 'active') === 'active')
  const byId = new Map(active.map(work => [work.workId, work]))
  const stateOf = workId => state.works?.get(workId) ?? {status: 'unpublished'}
  const unknownSelection = list(selection).filter(workId => !byId.has(workId))
  if (unknownSelection.length > 0) errors.push(`계획에 없는(또는 취소된) 작업을 골랐다: ${unknownSelection.join(', ')}`)

  // blocked도 루프에 넣는다 — 미리 거르면 **뺀 사실 자체가 사라져** 사람이 목록에서 그 작업을 찾지 못한다.
  const chosen = selection ? active.filter(work => selection.includes(work.workId)) : active
  const publish = []
  const reuse = []
  const resume = []
  const skipped = []
  for (const work of chosen) {
    const current = stateOf(work.workId)
    if (blockedWorkIds.has(work.workId)) {
      // 고른 것을 조용히 빼면 「등록됐다」고 오해한다 — 이름을 댄 요청은 거절로 답한다.
      if (selection) errors.push(`${work.title ?? work.workId}: 미해결 결정이 남아 있다 — 결정을 먼저 닫는다(발행하지 않는다)`)
      skipped.push({workId: work.workId, reason: 'blocked-unresolved'})
      continue
    }
    if (current.status === 'published') { reuse.push({workId: work.workId, ticketKey: current.ticketKey}); continue }
    if (current.status === 'attempted' || current.status === 'unknown') { resume.push({workId: work.workId, state: current}); continue }
    publish.push(work)
  }
  // 2) **선행 닫힘.** 이번 발행 집합 ∪ 이미 등록된 집합이 의존에 대해 닫혀 있어야 한다.
  const willExist = () => new Set([...publish, ...resume.map(item => byId.get(item.workId)), ...reuse.map(item => byId.get(item.workId))]
    .filter(Boolean).map(work => work.workId))
  const missingDeps = (work, exists) => list(work.dependsOn).filter(dep => !exists.has(dep) && stateOf(dep).status !== 'published')
  if (selection) {
    // **고른 것은 거절로 답한다.** 사람이 이름을 대고 요청했는데 조용히 빼면 「등록됐다」고 오해한다.
    const exists = willExist()
    for (const work of [...publish, ...resume.map(item => byId.get(item.workId))].filter(Boolean)) {
      const missing = missingDeps(work, exists)
      if (missing.length > 0) {
        errors.push(`${work.title ?? work.workId}: 선행이 이번 발행에도 없고 등록되지도 않았다 — ${missing.join(', ')}. 미등록 선행을 완료로 치지 않는다`)
      }
    }
  } else {
    // **전체 발행은 막히지 않는다.** 결정이 안 난 작업 하나가 배치 전체를 세우면 아무것도 등록되지
    // 않는다 — 그 후손만 이유와 함께 빼고 나머지는 낸다(빼는 것을 조용히 하지 않는다).
    for (let settled = false; !settled;) {
      settled = true
      const exists = willExist()
      for (const work of [...publish]) {
        const missing = missingDeps(work, exists)
        if (missing.length === 0) continue
        publish.splice(publish.indexOf(work), 1)
        skipped.push({workId: work.workId, reason: `blocked-predecessor: ${missing.join(', ')}`})
        settled = false
      }
    }
  }
  return {ok: errors.length === 0, publish, resume, reuse, skipped, errors}
}

// 작업의 **내용**(무엇을 어디까지 만드는가) — 소비 FEAT·근거·우선순위처럼 계획의 다른 곳에서 파생되는 것은 뺀다.
export const WORK_CONTENT_KEYS = ['title', 'kind', 'objective', 'nonGoals', 'dependsOn', 'readPaths', 'writePaths',
  'contractRefs', 'provides', 'consumes', 'designContext', 'checks']
/** 작업 내용 지문(순수). 발행 뒤 이것이 바뀐 작업은 제자리로 고치지 않고 대체(`superseded`)로 간다. */
export const workContentDigest = work => canonicalDigest(Object.fromEntries(WORK_CONTENT_KEYS.filter(key => key in work).map(key => [key, work[key]])))

/**
 * 재개 판정(순수) — 시도했는데 결과를 모르는 작업을 조회 결과와 대조한다.
 * @param {{found: {matches: Array, complete: boolean}}} lookup  provider 조회 결과
 * @returns {{action: 'confirm'|'republish'|'hold', ticketKey?: string, reason: string}}
 */
export function reconcileAttempt({lookup}) {
  const matches = list(lookup?.matches)
  if (matches.length === 1) return {action: 'confirm', ticketKey: String(matches[0].ticketKey), reason: 'tracker-has-one'}
  if (matches.length > 1) {
    return {action: 'hold', reason: `DUPLICATE_REMOTE: 같은 작업의 티켓이 ${matches.length}건이다 — 사람이 정리한다`}
  }
  // 조회가 불완전하면 **없다고 단정할 수 없다.** 색인 지연·페이지 절단에서 재발행하면 중복이 생긴다.
  if (lookup?.complete !== true) return {action: 'hold', reason: 'UNKNOWN_REMOTE_RESULT: 조회가 불완전해 부재를 확인하지 못했다 — 재발행하지 않는다'}
  return {action: 'republish', reason: '조회가 완전하고 결과가 없다 — 발행이 트래커에 닿지 않았다'}
}

/**
 * 발행 필드(순수). **공유 작업도 티켓 하나다**(T43·T48) — 소비 FEAT는 본문 「참고」와 마커에 적고 라벨로 복제하지 않는다.
 * 라벨은 호출자가 준 것(역할·팀 라벨)뿐이다(2026-09-15 사용자 결정 — 개발자가 fe·be로 거른다).
 */
export function workIssueFields({work, body, labels = [], components = []}) {
  if (!WORK_ID.test(String(work.workId))) throw new Error(`INVALID_WORK_ID: ${work.workId}`)
  return {title: work.title ?? work.workId, body, labels: [...new Set(labels.filter(Boolean))], components}
}
