// work-link.mjs — WORK의 PR 연결(완료 주장)과 머지 관측(완료)을 판정한다.
//
// legacy `link`의 게이트를 **옮긴다**(I2):
//   STALE 대조      → change-scope가 이 작업의 것이면 계획 digest로 대조, 아니면 미수행을 loud하게
//                     (`--accept-unverified-scope` 명시 인수는 원장에 남는다)
//   멱등            → 이미 연결된 작업의 재실행은 지나간 판정을 다시 심판하지 않는다
//   완료 조건        → 수용 기준이 없으면 판정 불가, 있으면 **아예 없는 것**을 잡는다
//                     (`--accept-incomplete` 명시 인수는 원장에 남는다)
//   close 대상 정합 → 원장이 이 작업에 등록한 티켓 키로만 닫는 줄을 만든다
//
// WORK에서 달라지는 것: 수용 기준은 TC(소유한 것) **와** `checks`다. TC는 legacy와 같은 프록시
// (소스·테스트에 ID가 인용되는가)로, check는 **대상 경로가 실재하는가**로 잰다 — 둘 다 「아예 없음」의
// 하한이지 의미 검증이 아니다(§4 등록). 완료(`work-completed`)는 **머지를 관측했을 때만** 쓴다 —
// 링크는 완료의 주장이지 완료가 아니다.
import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs'
import {join, relative as relativePath, resolve, sep} from 'node:path'
import {createHash, randomUUID} from 'node:crypto'

const list = value => (Array.isArray(value) ? value : [])
// 기획 TC(`TC-…`)와 사람 티켓의 테스트 항목(`TT-<티켓키>-<n>`, ticket-work.mjs) — 둘 다 테스트 코드 인용으로 잰다.
const TC_ID = /\b(?:TC-\d+-\d+|TT-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*-\d+)\b/g
const CITATION_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|svelte|vue|astro)$/
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '_workspace', 'coverage', 'playwright-report'])

/** 소스 트리에서 인용된 TC ID(순수에 가까운 읽기). `_workspace`는 계획 자신이라 세지 않는다. */
export function collectCitedTestCaseIds(root, dir = root, found = new Set(), depth = 0) {
  if (depth > 8) return found
  let entries
  try { entries = readdirSync(dir, {withFileTypes: true}) } catch { return found }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) collectCitedTestCaseIds(root, path, found, depth + 1)
    else if (CITATION_EXTENSIONS.test(entry.name)) {
      try { for (const id of readFileSync(path, 'utf8').match(TC_ID) ?? []) found.add(id) } catch { /* 못 읽으면 미인용 — 지어내지 않는다 */ }
    }
  }
  return found
}

/** 프로젝트 안의 경로인가(순수). 계획이 `../`로 밖을 가리키면 실재를 세지 않는다. */
export const insideProject = (root, relative) => {
  const absolute = resolve(root, String(relative))
  return absolute === resolve(root) || absolute.startsWith(resolve(root) + sep)
}

/**
 * 완료 조건(순수).
 * @param {{work: object, ownedTestCaseIds: string[], citedIds: Set<string>|string[], pathExists: (p: string) => boolean}} args
 * @returns {{ok: boolean, reason?: string, testCases: object, checks: object}}
 */
export function evaluateWorkCompletion({work, ownedTestCaseIds, citedIds, pathExists, baseline = null, currentDigest = null}) {
  const cited = citedIds instanceof Set ? citedIds : new Set(citedIds)
  const tcs = [...new Set(list(ownedTestCaseIds))].sort()
  const checks = list(work?.checks)
  if (tcs.length === 0 && checks.length === 0) {
    // 기준이 없으면 통과가 아니라 **판정 불가**다(legacy `no-test-cases`와 같은 자리).
    return {ok: false, reason: 'no-acceptance', testCases: {total: 0, cited: [], missing: []}, checks: {total: 0, satisfied: [], missing: []}}
  }
  const missingTcs = tcs.filter(id => !cited.has(id))
  const checkResults = checks.map(check => {
    const refs = list(check.targetRefs)
    // 대상이 없는 check는 **잴 수 없다** — 통과로 접지 않는다.
    const missingRefs = refs.length === 0 ? ['(대상 경로 없음)'] : refs.filter(ref => !pathExists(ref))
    // 픽업 때 찍은 기준선이 있으면 **대상이 하나라도 바뀌었는가**를 본다. 전부 그대로면 이 check는
    // 이 작업이 만든 결과가 아니다(이미 있던 경로를 대상으로 적은 경우).
    const recorded = baseline?.[check.checkId] ?? null
    const unchanged = recorded && currentDigest && missingRefs.length === 0
      && refs.every(ref => Object.hasOwn(recorded, ref) && recorded[ref] === currentDigest(ref))
    return {checkId: check.checkId ?? null, kind: check.kind ?? null, missingRefs, unchanged: Boolean(unchanged)}
  })
  const missingChecks = checkResults.filter(item => item.missingRefs.length > 0)
  const unchangedChecks = checkResults.filter(item => item.unchanged)
  const reason = missingTcs.length > 0 ? 'uncited-test-cases'
    : missingChecks.length > 0 ? 'check-targets-missing'
      : unchangedChecks.length > 0 ? 'check-targets-unchanged' : null
  return {
    ok: reason === null,
    ...(reason ? {reason} : {}),
    testCases: {total: tcs.length, cited: tcs.filter(id => cited.has(id)), missing: missingTcs},
    checks: {total: checks.length,
      satisfied: checkResults.filter(item => item.missingRefs.length === 0 && !item.unchanged).map(item => item.checkId),
      missing: [...missingChecks, ...unchangedChecks.map(item => ({...item, missingRefs: ['(픽업 뒤 바뀌지 않음)']}))],
      // 기준선이 없으면 그렇게 적는다 — 「바뀌었다」를 잰 것이 아니다.
      baselineCheck: baseline && currentDigest ? 'verified' : 'not-performed'},
  }
}

/** 원장에서 티켓 키로 작업을 찾는다(순수). 둘 이상이면 모호하다 — 고르지 않는다. */
export function workForTicket(state, ticketKey) {
  const hits = [...(state?.works?.entries() ?? [])]
    .filter(([, item]) => item.status === 'published' && String(item.ticketKey) === String(ticketKey))
  if (hits.length === 1) return {workId: hits[0][0], registered: hits[0][1]}
  return hits.length === 0 ? {error: 'work-not-registered'} : {error: 'ticket-registered-twice', workIds: hits.map(([id]) => id)}
}

/**
 * 연결 판정(순수) — 게이트를 통과하면 원장에 쓸 이벤트를 만든다.
 * @param {{plan: object, planDigest: string, state: object, changeScope: object|null, ticketKey: string,
 *          prUrl: string, completion: object|null, flags?: object, now?: string}} args
 */
export function planWorkLink({plan, planDigest, state, changeScope, ticketKey, prUrl, completion, baseRef = null, flags = {}, now = new Date().toISOString()}) {
  if (!ticketKey) return {ok: false, blocked: 'ticket-key-required'}
  // PR URL은 **정규형**만 받는다 — `/pull/42/files` 같은 변형으로 기록하면 자동 닫기·머지 관측이 영원히 불일치한다.
  if (typeof prUrl !== 'string' || !/^https?:\/\/[^/\s]+\/[^/\s]+\/[^/\s]+\/pull\/\d+$/.test(prUrl)) return {ok: false, blocked: 'pr-url-required'}
  if (typeof baseRef === 'string') baseRef = baseRef.replace(/^refs\/heads\//, '').replace(/^origin\//, '')
  const found = workForTicket(state, ticketKey)
  if (found.error) return {ok: false, blocked: found.error, ...(found.workIds ? {workIds: found.workIds} : {})}
  const {workId, registered} = found
  const work = list(plan.workItems).find(entry => entry.workId === workId) ?? null
  if (!work) return {ok: false, blocked: 'unknown-work', workId}
  if ((work.lifecycle ?? 'active') !== 'active') return {ok: false, blocked: 'work-cancelled', workId}

  // STALE — **미수행은 침묵 스킵이 아니다.** 대조할 수 없으면 그렇게 적고, 명시 인수 없이는 막는다.
  let staleCheck = null
  if (changeScope?.workId === workId && changeScope.ticketKey != null && String(changeScope.ticketKey) !== String(ticketKey)) {
    // 같은 작업을 다른 키로 다시 낸 뒤 옛 범위가 남은 경우 — 원장에 남길 개정 정보가 이 티켓의 것이 아니다.
    staleCheck = 'not-performed:different-ticket'
    if (!flags['dry-run'] && !flags['accept-unverified-scope']) {
      return {ok: false, blocked: 'stale-check-unavailable', staleCheck, workId,
        guidance: `change-scope는 ${changeScope.ticketKey}의 것이다 — 이 티켓(${ticketKey})으로 다시 픽업하거나 --accept-unverified-scope로 명시 인수한다`}
    }
  } else if (changeScope?.workId === workId) {
    if (changeScope.sourceDigest !== planDigest) {
      return {ok: false, blocked: 'stale-change-scope', staleCheck: 'stale', workId,
        guidance: '픽업 뒤 WORK 계획이 바뀌었다 — 바뀐 안을 검토·발행하고 다시 픽업한 뒤 완료한다'}
    }
    staleCheck = 'verified'
  } else {
    staleCheck = changeScope == null ? 'not-performed:no-change-scope' : 'not-performed:different-work'
    if (!flags['dry-run'] && !flags['accept-unverified-scope']) {
      return {ok: false, blocked: 'stale-check-unavailable', staleCheck, workId,
        guidance: 'change-scope가 없거나 다른 작업의 것이라 STALE 대조를 못 했다 — 픽업으로 발급하거나 --accept-unverified-scope로 명시 인수한다'}
    }
  }
  // 멱등 — 지나간 완료 주장을 다시 심판하지 않는다(재실행 결과가 소스 상태에 따라 달라지면 안 된다).
  // 기대 base 없이 남은 옛 링크는 **같은 PR에 한해** 다시 기록한다 — 그렇지 않으면 영원히 완료·닫기가 되지 않는다.
  // 다시 기록할 때도 아래 판정을 전부 다시 지난다(지나간 판정을 물려받지 않는다).
  const relinkForBase = registered.link?.prUrl === prUrl && !registered.link.baseRef && typeof baseRef === 'string'
  if (registered.link?.prUrl && !relinkForBase) return {ok: true, idempotent: true, workId, existing: registered.link.prUrl, staleCheck, provider: registered.provider ?? null}

  // **어느 브랜치에 머지돼야 끝나는가**를 링크 때 정한다 — 머지 관측·자동 닫기가 그것과 대조한다(설계 §10.2).
  // 모르면 링크하지 않는다: 기대 base 없이 남긴 링크는 아무 브랜치에 머지돼도 완료가 된다.
  if (typeof baseRef !== 'string' || !/^[\w./-]+$/.test(baseRef)) {
    return {ok: false, blocked: 'pr-base-unknown', workId, staleCheck,
      guidance: 'PR의 base 브랜치를 알 수 없다 — PR을 읽지 못했으면 `--base <브랜치>`로 기대 base를 준다'}
  }
  if (!completion?.ok && !flags['accept-incomplete']) {
    const guidance = {
      'no-acceptance': '이 작업에 수용 기준(TC·checks)이 없다 — 완료를 주장할 근거가 없다. 계획에 적는다',
      'uncited-test-cases': `소유 TC가 소스·테스트에 인용되지 않았다: ${list(completion?.testCases?.missing).join(', ')} — 그 TC를 검증하는 테스트에 ID를 적는다`,
      'check-targets-missing': `check 대상이 없다: ${list(completion?.checks?.missing).map(item => `${item.checkId}(${item.missingRefs.join(', ')})`).join(' · ')} — 작업 산출물이 그 경로에 있어야 한다`,
      'check-targets-unchanged': `check 대상이 픽업 뒤 바뀌지 않았다: ${list(completion?.checks?.missing).map(item => item.checkId).join(', ')} — 이 작업이 만든 결과가 아니다`,
    }[completion?.reason] ?? '완료 판정을 할 수 없다'
    // 개발자가 PR에서 기준을 낮추는 경로는 두지 않는다 — 넘기려면 의식적으로 인수하고 그 사실이 원장에 남는다.
    return {ok: false, blocked: `completion:${completion?.reason ?? 'unknown'}`, completion, workId, staleCheck,
      guidance: `${guidance}. 의식적으로 넘기려면 --accept-incomplete(원장에 남는다)`}
  }
  const event = {
    schemaVersion: 1, eventId: randomUUID(), planId: plan.planId, workId, eventType: 'work-linked', at: now, planDigest,
    payload: {
      prUrl, ticketKey: String(ticketKey), staleCheck, baseRef,
      completion: {ok: completion.ok, ...(completion.reason ? {reason: completion.reason} : {}),
        testCases: {total: completion.testCases.total, cited: completion.testCases.cited.length, missing: completion.testCases.missing},
        checks: {total: completion.checks.total, satisfied: completion.checks.satisfied.length,
          missing: completion.checks.missing.map(item => item.checkId)}},
      ...(completion.ok ? {} : {acceptedIncomplete: true}),
      ...(flags['accept-unverified-scope'] && staleCheck !== 'verified' ? {acceptedUnverifiedScope: true} : {}),
      // 이 PR이 **어느 티켓 개정**을 보고 개발됐는가 — 대조한 범위일 때만 싣는다.
      ...(staleCheck === 'verified' && changeScope?.ticket ? {ticket: changeScope.ticket} : {}),
    },
  }
  // 닫는 줄의 트래커는 **발행한 원장**이 정한다 — 지금 설정을 읽으면 설정이 바뀐 뒤 닫는 시늉이 나간다.
  const provider = registered.provider ?? (staleCheck === 'verified' ? changeScope?.ticket?.provider ?? null : null)
  // 사람이 티켓에 더한 조건은 **자동으로 검증하지 못한다** — 결과에 싣고 그 사실을 적는다(통과로 접지 않는다).
  const added = staleCheck === 'verified' ? list(changeScope?.ticketAcceptance?.added) : []
  return {ok: true, workId, event, staleCheck, completion, closes: String(registered.ticketKey), provider,
    ...(added.length > 0 ? {ticketAcceptance: {items: added, verification: 'not-automated', guidance: '티켓에서 사람이 더한 조건이다 — PR 리뷰에서 충족을 확인한다'}} : {})}
}

/**
 * 머지 관측(순수) — 연결됐고 아직 완료가 아닌 작업 중 PR이 **머지로 확인된 것**만 완료 이벤트로 만든다.
 * 조회 실패·미상은 완료가 아니다(보수). 무엇을 못 쟀는지 함께 돌려준다.
 * @param {{plan: object, state: object, prStates: Map<string, {state?: string, error?: string}>, now?: string}} args
 */
export function planMergeSync({plan, state, prStates, now = new Date().toISOString()}) {
  const events = []
  const unknown = []
  const open = []
  const baseMismatch = []
  for (const [workId, item] of state?.works?.entries() ?? []) {
    if (!item.link?.prUrl || item.completed) continue
    const observed = prStates.get(item.link.prUrl) ?? null
    if (!observed || observed.error) { unknown.push({workId, prUrl: item.link.prUrl, error: observed?.error ?? 'not-queried'}); continue }
    if (observed.state !== 'MERGED') { open.push({workId, prUrl: item.link.prUrl, state: observed.state ?? null}); continue }
    // **기대한 base에 머지됐을 때만** 끝난 것이다. 다른 브랜치에 머지된 PR·base를 모르는 링크는 완료로 쓰지 않는다.
    if (!item.link.baseRef || observed.baseRefName !== item.link.baseRef) {
      baseMismatch.push({workId, prUrl: item.link.prUrl, expected: item.link.baseRef ?? null, observed: observed.baseRefName ?? null}); continue
    }
    // 사람 티켓 작업은 자기 계획 ID(티켓에서 만든 ID)를 쓴다 — 계획이 없는 프로젝트에서도 머지를 관측한다.
    const planId = item.origin === 'ticket' ? item.planId : plan?.planId
    if (!planId) { unknown.push({workId, prUrl: item.link.prUrl, error: 'plan-unknown'}); continue }
    events.push({schemaVersion: 1, eventId: randomUUID(), planId, workId, eventType: 'work-completed', at: now,
      payload: {prUrl: item.link.prUrl, via: 'pr-merged', baseRef: observed.baseRefName}})
  }
  return {events, unknown, open, baseMismatch}
}

/**
 * 대상의 지문(읽기). 파일은 내용, 디렉터리는 **하위 파일 경로·내용 전부**(깊이 상한)의 해시다.
 * 없으면 `null`. 픽업 때 찍어 두고 링크 때 다시 찍어 「대상이 바뀌었는가」를 본다 — 이미 있는 경로를
 * 대상으로 적은 기반 작업이 **아무것도 하지 않고** 완료로 통과하는 것을 막는 앵커다.
 */
export const projectRefDigest = root => ref => {
  if (!insideProject(root, ref)) return null
  const absolute = resolve(root, String(ref))
  if (!existsSync(absolute)) return null
  const hash = createHash('sha256')
  const walk = (path, depth) => {
    const stat = statSync(path)
    if (stat.isFile()) { hash.update(`${relativePath(absolute, path)}\0`).update(readFileSync(path)); return }
    if (!stat.isDirectory() || depth > 8) return
    for (const name of readdirSync(path).sort()) {
      if (SKIP_DIRS.has(name)) continue
      walk(join(path, name), depth + 1)
    }
  }
  walk(absolute, 0)
  return hash.digest('hex')
}

/** 파일 존재 확인기 — 프로젝트 밖을 가리키면 없는 것으로 센다. */
export const projectPathExists = root => relative => insideProject(root, relative) && existsSync(resolve(root, String(relative)))
