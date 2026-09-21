// work-state-run.mjs — 작업의 **지금 상태를 트래커와 PR에서** 읽어 계획·등록 상태에 겹친다(읽기 전용). 보드·픽업·link·발행·집계가 같은 입구를 쓴다.
//
// 원장(git)에는 리드의 계획·발행 기록만 있고, 개발자의 판정·연결 기록은 그 사람의 로컬에만 있다(git 제외). 팀이 함께 보는 사실은
// 트래커와 PR이 원래 가진 것에서 읽는다 — 배정·끝남(상태·해결 사유)·다시 연 시각, 기대 base에 머지된 PR(제목의 티켓 키)·되돌림 PR,
// Jira Git Integration의 머지된 커밋. 완료는 기록하지 않고 여기서 계산한다.
// 못 읽은 것은 막지 않고 `notes`로 알린다 — 읽지 못한 것을 「안 끝났다」·「미배정」으로 접지 않는다.
import {existsSync, readdirSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {classifyTrackerDone, completedResolutionsOf, prEvidenceFromPrs, withTrackerCompletion} from './work-provider.mjs'

/** 이 개발자의 연결 기록(로컬, git 제외) — 어느 PR을 어느 base로 연결했고 무엇을 인수했는지. 팀은 PR 제목의 키로 안다. */
export const WORK_LINKS_DIR = '_workspace/03_dev/work-links'
export const linkRecordPath = ticketKey => `${WORK_LINKS_DIR}/${String(ticketKey).replace(/[^A-Za-z0-9_-]/g, '_')}.json`
export function readLocalLinks(root) {
  const dir = join(root, WORK_LINKS_DIR)
  if (!existsSync(dir)) return new Map()
  const links = new Map()
  for (const name of readdirSync(dir).filter(file => file.endsWith('.json'))) {
    try {
      const record = JSON.parse(readFileSync(join(dir, name), 'utf8'))
      if (record?.ticketKey && record.prUrl) links.set(String(record.ticketKey), record)
    } catch { /* 깨진 로컬 기록은 연결이 없는 것으로 본다 — link를 다시 부르면 새로 쓴다 */ }
  }
  return links
}

const MERGED_PR_LIMIT = 300

/**
 * 기대 base에 머지된 PR 목록(읽기). 저장소 원격(`owner/name`)을 모르거나 gh를 못 부르면 근거 없이 간다 — 막지 않고 알린다.
 * @returns {Promise<{prs: object[], checked: boolean, note?: string}>}
 */
export async function readMergedPrs({context, io = {}}) {
  if (io.mergedPrs) return {prs: await io.mergedPrs({base: context?.baseBranch ?? null}), checked: true}
  if (!context?.slug || !context.baseBranch) return {prs: [], checked: false, note: '저장소 원격을 알 수 없어 머지된 PR을 확인하지 않았습니다.'}
  try {
    const {runGh, mergedPrListArgs} = await import('./provider-github-exec.mjs')
    const prs = JSON.parse(await runGh(mergedPrListArgs(context.slug, context.baseBranch, MERGED_PR_LIMIT), {host: context.host}))
    return {prs: Array.isArray(prs) ? prs : [], checked: true,
      ...(Array.isArray(prs) && prs.length >= MERGED_PR_LIMIT ? {note: `머지된 PR이 ${MERGED_PR_LIMIT}건을 넘어 그보다 먼저 만든 PR의 머지는 확인하지 않았습니다.`} : {})}
  } catch (error) {
    return {prs: [], checked: false, note: `머지된 PR을 확인하지 못했습니다: ${String(error?.message ?? error).slice(0, 120)}.`}
  }
}

/**
 * 머지된 커밋을 읽는다(Jira Git Integration). 애드온이 없거나 저장소 문맥을 모르면 근거 없이 간다 — 막지 않고 알린다.
 * @returns {Promise<{evidence: Map, checked: boolean, note?: string}>}
 */
export async function readMergeEvidence({provider, context, keys}) {
  if (typeof provider?.listMergeEvidence !== 'function' || keys.length === 0) return {evidence: new Map(), checked: false}
  if (!context) return {evidence: new Map(), checked: false, note: '저장소의 기본 브랜치를 알 수 없어 머지된 커밋을 확인하지 않았습니다.'}
  try {
    const result = await provider.listMergeEvidence({keys, baseBranch: context.baseBranch, repoName: context.repoName})
    if (!result.available) return {evidence: new Map(), checked: false}
    return {evidence: result.evidence, checked: true,
      ...(result.errors?.length ? {note: `티켓 ${result.errors.length}건은 머지된 커밋을 확인하지 못했습니다.`} : {})}
  } catch (error) {
    return {evidence: new Map(), checked: false, note: `머지된 커밋을 확인하지 못했습니다: ${String(error?.message ?? error).slice(0, 120)}.`}
  }
}

/**
 * @param {{provider: object, state: object, root: string, plan?: object|null, config?: object|null, io?: object, keys?: string[]|null}} args
 *   keys: 읽을 티켓 키(기본: 상태의 발행·등록된 작업 전부)
 * @returns {Promise<{state: object, items: object[]|null, lookupComplete: boolean, notes: string[], checked: boolean}>}
 */
export async function readTrackerWorkState({provider, state, root, plan = null, config = null, io = {}, keys = null}) {
  const wanted = [...new Set((keys ?? [...(state?.works?.values() ?? [])].filter(item => item.status === 'published' && item.ticketKey).map(item => item.ticketKey))
    .map(String))]
  const notes = []
  const links = readLocalLinks(root)
  if (!provider || wanted.length === 0) return {state: withTrackerCompletion(state, [], {links}), items: null, lookupComplete: false, notes, checked: false}
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
  // 2. 머지 — 기대 base에 머지된 PR(제목의 티켓 키)과, 애드온이 있으면 머지된 커밋.
  const context = await (io.repoContext ?? (await import('./git-origin.mjs')).resolveRepoContext)({repoRoot: root, base: plan?.baseBranch ?? null})
  const merged = await readMergedPrs({context, io})
  if (merged.note) notes.push(merged.note)
  const prEvidence = new Map(wanted.map(key => [key, prEvidenceFromPrs(merged.prs, {ticketKey: key})]).filter(([, evidence]) => evidence))
  const commits = await readMergeEvidence({provider, context, keys: wanted})
  if (commits.note) notes.push(commits.note)
  // 커밋 근거는 되돌림을 모른다 — 되돌림 PR은 PR 목록에만 있으니 그 목록을 못 읽었으면 알린다.
  if (!merged.checked && commits.evidence.size > 0) notes.push('되돌림 PR을 확인하지 못해 머지된 커밋을 그대로 완료로 셉니다.')
  // 3. 다시 연 시각 — 머지 근거가 있는데 트래커에서 열려 있는 티켓만 읽는다(되돌림을 사람이 다시 열어 알린다).
  const completedResolutions = completedResolutionsOf(config, provider.name)
  const byKey = new Map((items ?? []).map(item => [String(item.ticketKey), item]))
  const suspects = wanted.filter(key => (prEvidence.get(key)?.mergedAt || commits.evidence.get(key)) && !classifyTrackerDone(byKey.get(key), {completedResolutions}))
  if (suspects.length > 0 && typeof provider.listReopens === 'function') {
    try {
      const reopened = await provider.listReopens({keys: suspects})
      for (const [key, at] of reopened.reopens) byKey.set(key, {...(byKey.get(key) ?? {ticketKey: key}), reopenedAt: at})
      if (reopened.errors?.length) notes.push(`티켓 ${reopened.errors.length}건은 다시 연 기록을 확인하지 못했습니다. 그 작업은 머지를 완료로 셉니다.`)
    } catch (error) {
      notes.push(`다시 연 기록을 확인하지 못했습니다: ${String(error?.message ?? error).slice(0, 120)}.`)
    }
  }
  // 선행으로만 아는 티켓(자리표시)이 조회를 끝까지 했는데도 없으면 키가 틀렸을 수 있다 — 「아직 안 끝남」과 구별해 알린다.
  if (lookupComplete) {
    const unknownKeys = [...new Set([...(state?.works?.values() ?? [])].filter(item => item.placeholder && item.ticketKey && wanted.includes(String(item.ticketKey))
      && !byKey.has(String(item.ticketKey))).map(item => String(item.ticketKey)))]
    if (unknownKeys.length > 0) notes.push(`선행 티켓 ${unknownKeys.length}건을 트래커에서 찾지 못했습니다(${unknownKeys.join(', ')}) — 키가 맞는지 확인하세요. 찾을 때까지 선행 대기로 둡니다.`)
  }
  const next = withTrackerCompletion(state, [...byKey.values()], {completedResolutions, mergeEvidence: commits.evidence, prEvidence, links})
  // `checked`는 트래커를 읽었는가다 — 머지 근거를 못 읽은 것은 `notes`가 따로 말한다(섞지 않는다).
  return {state: next, items, lookupComplete, notes, checked: items !== null}
}
