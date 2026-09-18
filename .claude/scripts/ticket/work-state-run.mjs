// work-state-run.mjs — 작업의 **지금 상태를 트래커에서** 읽어 원장 상태에 겹친다(읽기 전용). 보드·픽업·link·발행·집계가 같은 입구를 쓴다.
//
// 원장(git)에는 리드의 계획·발행 기록만 있다. 개발 쪽 사실은 트래커에 있다 — 배정·끝남(상태·해결 사유)·PR 연결과 완료 회수
// (티켓 코멘트 `work-records.mjs`)·머지(연결한 PR의 상태, Jira Git Integration의 머지된 커밋). 완료는 기록하지 않고 여기서 계산한다.
// 못 읽은 것은 막지 않고 `notes`로 알린다 — 읽지 못한 것을 「안 끝났다」·「미배정」으로 접지 않는다.
import {completedResolutionsOf, withTrackerCompletion} from './work-provider.mjs'
import {parseWorkRecords} from './work-records.mjs'

/**
 * 머지된 커밋을 읽는다(Jira Git Integration). 애드온이 없거나 저장소 문맥을 모르면 근거 없이 간다 — 막지 않고 알린다.
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
 * @param {{provider: object, state: object, root: string, plan?: object|null, config?: object|null, io?: object,
 *          keys?: string[]|null, issues?: Map<string, object>}} args
 *   keys: 읽을 티켓 키(기본: 상태의 발행·등록된 작업 전부) · issues: 이미 읽은 티켓(코멘트 포함) — 다시 부르지 않는다
 * @returns {Promise<{state: object, items: object[]|null, lookupComplete: boolean, notes: string[], checked: boolean}>}
 */
export async function readTrackerWorkState({provider, state, root, plan = null, config = null, io = {}, keys = null, issues = new Map()}) {
  const wanted = [...new Set((keys ?? [...(state?.works?.values() ?? [])].filter(item => item.status === 'published' && item.ticketKey).map(item => item.ticketKey))
    .map(String))]
  const notes = []
  if (!provider || wanted.length === 0) return {state, items: null, lookupComplete: false, notes, checked: false}
  // 1. 배정·끝남 — 목록은 커서를 끝까지 따라간다(절단과 미순회를 섞지 않는다).
  let items = null
  let lookupComplete = false
  if (typeof provider.listWorkIssues === 'function') {
    try {
      items = []
      let listed = await provider.listWorkIssues({keys: wanted})
      items.push(...listed.items)
      for (let guard = 0; listed.nextCursor && !listed.stalled && guard < 50; guard++) {
        listed = await provider.listWorkIssues({keys: wanted, cursor: listed.nextCursor})
        items.push(...listed.items)
      }
      lookupComplete = listed.complete === true
      if (listed.truncated) notes.push('트래커 목록이 최대 개수에 닿았습니다. 그 뒤 작업은 반영되지 않았습니다.')
      if (listed.stalled) notes.push('트래커 목록을 더 읽지 못하고 멈췄습니다. 목록이 완전하지 않습니다.')
    } catch (error) {
      items = null
      notes.push(`트래커 조회 실패 — 로컬 계획·원장 기준이다(배정 미상): ${String(error?.message ?? error).slice(0, 160)}`)
    }
  }
  // 2. 머지된 커밋(애드온이 있으면)
  const merged = await readMergeEvidence({provider, root, base: plan?.baseBranch ?? null, keys: wanted, io})
  if (merged.note) notes.push(merged.note)
  // 3. 티켓 코멘트의 작업 기록 — 한 티켓을 못 읽어도 나머지는 쓴다(못 읽은 것은 알린다).
  const records = new Map()
  const unread = []
  let partial = 0
  if (typeof provider.resolveIssue === 'function') {
    const settled = await Promise.allSettled(wanted.map(async key => [key, issues.get(key) ?? await provider.resolveIssue(key)]))
    settled.forEach((outcome, index) => {
      if (outcome.status === 'fulfilled' && Array.isArray(outcome.value[1]?.comments)) {
        records.set(outcome.value[0], parseWorkRecords(outcome.value[1].comments))
        // 코멘트를 다 받지 못했으면 가장 최근 기록이 빠졌을 수 있다 — 읽은 것은 쓰되 알린다.
        if (outcome.value[1].commentsOmitted > 0) partial += 1
      } else unread.push(wanted[index])
    })
  }
  if (unread.length > 0) notes.push(`티켓 ${unread.length}건은 PR 연결 기록을 읽지 못했습니다. 그 작업의 머지 여부는 반영되지 않았습니다.`)
  if (partial > 0) notes.push(`티켓 ${partial}건은 코멘트를 다 받지 못해 최근 PR 연결 기록이 빠졌을 수 있습니다.`)
  // 4. 연결한 PR의 상태 — 머지·base·머지 시각
  const prUrls = [...new Set([...records.values()].map(record => record.link?.prUrl).filter(Boolean))]
  let prStates = new Map()
  if (prUrls.length > 0) {
    try {
      prStates = io.prStates ? await io.prStates(prUrls) : await (await import('./work-link-run.mjs')).resolvePrStates(prUrls)
      const failed = [...prStates.values()].filter(item => item?.error).length
      if (failed > 0) notes.push(`PR ${failed}건의 상태를 읽지 못했습니다. 그 작업의 머지 여부는 반영되지 않았습니다.`)
    } catch (error) {
      notes.push(`PR 상태를 읽지 못했습니다: ${String(error?.message ?? error).slice(0, 120)}.`)
    }
  }
  const next = withTrackerCompletion(state, items ?? [], {completedResolutions: completedResolutionsOf(config, provider.name),
    mergeEvidence: merged.evidence, records, prStates})
  return {state: next, items, lookupComplete, notes, checked: items !== null && unread.length === 0 && typeof provider.resolveIssue === 'function'}
}
