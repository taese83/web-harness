// work-provider.mjs — WORK 티켓의 조회·관계·목록을 트래커 뒤로 감추는 **순수부**.
//
// 설계 §7.2: 기존 `findByFeature`를 WORK 조회에 재사용하지 않는다(축이 다르다 — FEAT가 아니라
// `(planId, workId)`다). 여기서 지키는 것 셋:
//   1. **절단을 성공으로 세지 않는다.** 목록·검색이 일부만 왔으면 `complete: false`이고, 호출자는 그것을
//      「없음」으로 읽지 않는다(부재를 단정해 재발행하면 중복 티켓이 생긴다 — 설계 §8-5).
//   2. **미지원을 성공으로 위장하지 않는다.** 관계 표현 능력이 없거나 설정이 없으면 `unsupported`와
//      **무엇을 설정해야 하는지**를 돌려준다. 링크뿐이면 `link-only`이고 계층이라 부르지 않는다.
//   3. **하드코딩하지 않는다.** Jira의 이슈 링크 타입·프로젝트·전이 id는 전부 설정이 든다(I3).
import {WORK_ID} from './work-refs.mjs'

// WORK 조회는 **라벨을 쓰지 않는다**(2026-09-15 사용자 결정 — 라벨은 개발자가 거르는 축(fe·be)과 팀 라벨만).
// 결과를 모르는 발행은 시도 시각 이후의 이슈를 끝까지 읽어 본문의 작업 ID·마커로 찾는다(provider 실행부).

/** 키 목록 조회 JQL(순수). 페이지 순회는 실행부가 `startAt`으로 돈다. */
export function workKeysJql(keys) {
  const requested = [...new Set((keys ?? []).map(key => String(key)))]
  // **형식이 아닌 키를 조용히 버리지 않는다.** 버리면 그 키를 「조회했는데 없다」로 읽어 재발행한다.
  const bad = requested.filter(key => !/^[A-Z][A-Z0-9_]*-\d+$/.test(key))
  if (bad.length > 0) throw new Error(`INVALID_WORK_KEY: 트래커 키 형식이 아니다 — ${bad.join(', ')}`)
  if (requested.length === 0) throw new Error('EMPTY_WORK_KEYS: 조회할 티켓 키가 없다')
  return `key in (${requested.join(', ')}) ORDER BY created ASC`
}

/**
 * Jira 검색 응답 → `{matches, complete}`(순수). **`total`이 받은 수보다 크면 불완전이다** —
 * 페이지가 남았는데 완전하다고 적으면 호출자가 「없음」이나 「전부」를 잘못 읽는다.
 */
export function parseWorkSearch(payload, {fetched = null} = {}) {
  const issues = Array.isArray(payload?.issues) ? payload.issues : []
  const total = Number.isInteger(payload?.total) ? payload.total : null
  const seen = (fetched ?? 0) + issues.length
  // **전진하지 않는 커서를 주지 않는다.** 0건 페이지인데 남았다고 하면(total 드리프트·권한 필터·서버
  // 클램프) 같은 커서를 되돌려 무한히 같은 페이지를 읽는다 — 진행 불가를 `stalled`로 말한다.
  const stalled = total !== null && seen < total && issues.length === 0
  return {
    matches: issues.map(issue => ({ticketKey: issue.key, summary: issue.fields?.summary ?? null,
      labels: issue.fields?.labels ?? [], statusCategory: issue.fields?.status?.statusCategory?.key ?? null,
      // **배정을 안 물었으면 `null`이다** — 「미배정」과 「안 물어봤다」를 섞으면 보드가 남이
      // 잡고 있는 작업을 「집을 수 있다」로 보여준다. 신원을 **무엇으로 부르는가**는 트래커의
      // 어휘라 여기서 고르지 않는다 — 실행부가 `assigneeIdentity`로 한 번만 고른다.
      resolution: issue.fields?.resolution?.name ?? null, doneAt: issue.fields?.resolutiondate ?? null,
      assigneeRequested: Boolean(issue.fields && 'assignee' in issue.fields),
      assigneeUser: issue.fields?.assignee ?? null})),
    total,
    complete: total === null ? false : seen >= total,
    nextCursor: total !== null && seen < total && !stalled ? String(seen) : null,
    ...(stalled ? {stalled: true} : {}),
  }
}

export const DEFAULT_COMPLETED_RESOLUTIONS = ['Fixed', 'Done']
/**
 * 트래커가 말하는 끝남(순수) — `completed`(한 일로 끝남) · `cancelled`(안 하기로 끝남) · `unresolved`(끝났는데 해결 사유가
 * 없다 — 해결 화면 없는 워크플로우. 완료로도 취소로도 세지 않는다) · `null`(열려 있거나 모름).
 * Jira는 상태 범주 `done`만으로는 모른다(Won't Fix·Duplicate도 done이다) — 해결 사유를 팀 설정과 대조한다.
 * GitHub은 닫힌 이유로 가른다. 닫힌 이유가 없는 옛 이슈는 GitHub 기본값(완료)으로 본다.
 */
export function classifyTrackerDone(item, {completedResolutions = DEFAULT_COMPLETED_RESOLUTIONS} = {}) {
  if (!item) return null
  if (item.statusCategory !== undefined && item.statusCategory !== null) {
    if (item.statusCategory !== 'done') return null
    if (!item.resolution) return 'unresolved'
    return completedResolutions.includes(item.resolution) ? 'completed' : 'cancelled'
  }
  if (String(item.state ?? '').toUpperCase() !== 'CLOSED') return null
  const reason = String(item.stateReason ?? '').toUpperCase()
  return reason === '' || reason === 'COMPLETED' ? 'completed' : 'cancelled'
}

/**
 * 계획·등록 상태에 **지금의 끝남**을 겹친다(순수). 완료는 기록하지 않고 여기서 계산한다 — 기대 base에 머지된 PR(제목의 티켓 키)
 * · 머지된 커밋(Jira Git Integration) · 트래커의 끝남 중 하나. 사람이 트래커에서 티켓을 **다시 열면**(`reopenedAt`) 그 뒤의
 * 근거만 센다. 되돌림 PR(`Revert "[키] …"`)이 머지됐으면 그 전의 머지·커밋은 세지 않는다. 트래커에서 취소된 작업은
 * 취소 뒤의 머지만 취소를 이긴다(시각을 모르면 취소를 지킨다). `links`는 이 클론의 연결 기록(로컬) — 멱등·표시용이다.
 */
export function withTrackerCompletion(state, items, {completedResolutions = DEFAULT_COMPLETED_RESOLUTIONS, mergeEvidence = new Map(),
  prEvidence = new Map(), links = new Map()} = {}) {
  const byKey = new Map((Array.isArray(items) ? items : []).map(item => [String(item.ticketKey),
    {done: classifyTrackerDone(item, {completedResolutions}), doneAt: item.doneAt ?? null, reopenedAt: item.reopenedAt ?? null}]))
  const after = (date, at) => Boolean(date) && Date.parse(date) > Date.parse(at)
  const works = new Map([...(state?.works?.entries() ?? [])].map(([workId, entry]) => {
    const key = entry.ticketKey ? String(entry.ticketKey) : null
    let item = entry
    const tracker = key ? byKey.get(key) : null
    const pr = key ? prEvidence.get(key) : null
    // 내 연결 기록 — 그 뒤에 다시 열었거나 되돌림 PR이 머지됐으면 끝난 연결이다(다시 집은 뒤 새 PR을 연결할 수 있게).
    const link = key ? links.get(key) : null
    if (link && !after(tracker?.reopenedAt, link.at) && !after(pr?.revertedAt, link.at)) item = {...item, link: {...link}}
    // 사람이 트래커에서 다시 연 작업 — 그 뒤의 근거만 센다(되돌린 머지 위에서 후속이 열리지 않게).
    if (tracker?.reopenedAt) item = {...item, reopened: {at: tracker.reopenedAt}}
    if (pr?.revertedAt) item = {...item, reverted: {at: pr.revertedAt}}
    if (item.completed) return [workId, item]
    // 근거가 유효한가 — 재오픈·되돌림 뒤, 취소면 취소 뒤여야 한다.
    const counts = date => Boolean(date) && !(item.reopened && !after(date, item.reopened.at)) && !(pr?.revertedAt && !after(date, pr.revertedAt))
      && !(tracker?.done === 'cancelled' && !(tracker.doneAt && after(date, tracker.doneAt)))
    // 기대 base에 머지된 PR이 먼저다 — 코드가 base에 있으면 선행은 끝났다(팀의 Done은 QA·배포를 기다릴 수 있다).
    if (pr?.mergedAt && counts(pr.mergedAt)) {
      return [workId, {...item, completed: {via: 'merge', prUrl: pr.url ?? null, at: pr.mergedAt}}]
    }
    const evidence = key ? mergeEvidence.get(key) : null
    if (evidence && counts(evidence.date)) {
      return [workId, {...item, completed: {via: 'commit', at: evidence.date, commit: evidence.commit, pr: evidence.pr, branch: evidence.branch}}]
    }
    if (!tracker?.done) return [workId, item]
    if (item.reopened && !(tracker.doneAt && after(tracker.doneAt, item.reopened.at))) return [workId, item]
    if (tracker.done === 'completed') return [workId, {...item, completed: {via: 'tracker', at: tracker.doneAt}}]
    if (tracker.done === 'cancelled') return [workId, {...item, trackerCancelled: true}]
    return [workId, {...item, trackerUnresolved: true}]
  }))
  return {...state, works}
}

/**
 * 머지된 PR에서 티켓의 근거를 고른다(순수). 제목이 티켓 키로 시작하거나(`[AOA-19] …`·`#12 …`) 브랜치 이름에 키가 있는
 * (`feature/AOA-19-login`) PR이고, 되돌림 PR(`Revert "…"`)이 머지됐으면 그 뒤의 PR만 센다. 둘 다 없으면 어느 티켓의 것인지 모른다.
 * @param {{number?: number, title: string, headRefName?: string, mergedAt: string, url?: string}[]} prs 기대 base에 머지된 PR
 * @returns {{url: string|null, number: number|null, mergedAt: string|null, revertedAt: string|null}|null}
 */
export function prEvidenceFromPrs(prs, {ticketKey}) {
  // `Revert "…"`를 벗겨 몇 겹인지 센다 — 홀수 겹은 되돌림, 짝수 겹(`Revert "Revert "…""`)은 되돌림을 되돌린 재착륙이다.
  const unwrap = title => {
    let text = String(title ?? '').trim()
    let depth = 0
    for (let match = text.match(/^Revert "(.*)"\s*$/); match; match = text.match(/^Revert "(.*)"\s*$/)) { text = match[1]; depth += 1 }
    return {text, depth}
  }
  // 되돌림 PR의 브랜치(`revert-17-feature/AOA-19-login`)도 키를 품는다 — 겹 수는 제목이 정한다.
  // 브랜치의 `revert-<번호>-` 접두도 겹으로 센다 — 되돌림 PR의 제목을 고쳐도 되돌림으로 읽는다(둘 중 큰 겹).
  const branchDepth = branch => { let text = String(branch ?? ''); let depth = 0; while (/^revert-\d+-/.test(text)) { text = text.replace(/^revert-\d+-/, ''); depth += 1 } return {branch: text, depth} }
  const dated = (Array.isArray(prs) ? prs : []).filter(pr => Number.isFinite(Date.parse(pr?.mergedAt)))
    .map(pr => { const byTitle = unwrap(pr.title); const byBranch = branchDepth(pr.headRefName); return {pr, text: byTitle.text, branch: byBranch.branch, depth: Math.max(byTitle.depth, byBranch.depth)} })
    .filter(item => prNamesKey({title: item.text, branch: item.branch}, ticketKey))
  const reverts = dated.filter(item => item.depth % 2 === 1).map(item => item.pr)
  const revertedAt = reverts.map(pr => pr.mergedAt).sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null
  // 되돌림보다 앞선 머지를 세지 않는 것은 부르는 쪽(`withTrackerCompletion`)이 `revertedAt`으로 한 번만 가린다.
  const hits = dated.filter(item => item.depth % 2 === 0).map(item => item.pr)
    .sort((a, b) => Date.parse(b.mergedAt) - Date.parse(a.mergedAt))
  if (hits.length === 0 && !revertedAt) return null
  const hit = hits[0] ?? null
  return {url: hit?.url ?? null, number: hit?.number ?? null, mergedAt: hit?.mergedAt ?? null, revertedAt}
}

/** Jira 변경 이력에서 **다시 연** 가장 최근 시각(순수) — 해결 사유가 있다가 비워진 때(워크플로우가 재오픈에서 해결을 지운다). */
export function reopenedAtFromJiraChangelog(payload) {
  const histories = Array.isArray(payload?.changelog?.histories) ? payload.changelog.histories : []
  return histories.filter(history => (Array.isArray(history?.items) ? history.items : [])
    .some(item => item?.field === 'resolution' && (item.from || item.fromString) && !(item.to || item.toString)))
    .map(history => history.created).filter(at => Number.isFinite(Date.parse(at)))
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null
}

/** GitHub 이슈 이벤트에서 다시 연 가장 최근 시각(순수). */
export const reopenedAtFromGithubEvents = events => (Array.isArray(events) ? events : [])
  .filter(event => event?.event === 'reopened' && Number.isFinite(Date.parse(event.created_at)))
  .map(event => event.created_at).sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null

const escapeRegex = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/**
 * 브랜치 이름에 티켓 키가 한 토큰으로 있는가(순수) — `feature/AOA-19-login`·`AOA-19`·`fix/aoa-19`. 문자가 있는 트래커 키만 본다 —
 * 숫자뿐인 GitHub 이슈 번호는 브랜치의 버전·날짜 숫자와 구별되지 않아 세지 않는다(제목으로만 잇는다).
 */
export const branchHasKey = (branch, ticketKey) => /[A-Za-z]/.test(String(ticketKey ?? ''))
  && new RegExp(`(?:^|[/_.-])${escapeRegex(ticketKey)}(?![0-9A-Za-z])`, 'i').test(String(branch ?? ''))
/**
 * PR이 이 티켓의 것인가(순수) — 제목이 키로 시작하거나 브랜치 이름에 키가 있다. **제목이 우선이다** — 제목이 다른 트래커 키로
 * 시작하면 브랜치는 보지 않는다(오래 쓰는 브랜치를 다른 티켓에 재사용해도 한 PR이 두 티켓을 끝내지 않게). 브랜치는 대소문자를
 * 가리지 않는다(`fix/aoa-19` 관습), 제목은 트래커 표기 그대로 본다.
 */
const TITLE_TRACKER_KEY = /^(?:\[#?)?[A-Za-z][A-Za-z0-9]*-\d+(?![0-9A-Za-z])/
export const prNamesKey = ({title, branch}, ticketKey) => titleStartsWithKey(title, ticketKey)
  || (!TITLE_TRACKER_KEY.test(String(title ?? '').trim()) && branchHasKey(branch, ticketKey))
/** 제목이 티켓 키로 시작하는가(순수) — `[AOA-19] …`·`#AOA-19 …`·`AOA-19 …`. `AOA-1`은 `AOA-19`로 시작하는 제목에 맞지 않는다. */
export const titleStartsWithKey = (subject, ticketKey) =>
  new RegExp(`^(?:\\[#?${escapeRegex(ticketKey)}\\]|#?${escapeRegex(ticketKey)}(?![\\w-]))`).test(String(subject ?? '').trim())
/**
 * 머지 근거(순수) — 티켓에 연결된 커밋(Jira Git Integration) 중 **GitHub 스쿼시 머지 커밋**: 기대 base 브랜치에 있고,
 * 제목이 티켓 키로 시작하고 `(#PR번호)`로 끝나며, 머지 커밋이 아닌 것(`[AOA-19] … (#17)`). base에 직접 푸시·체리픽한 커밋,
 * 키를 본문에서 언급만 한 커밋, 다른 저장소의 커밋, 되돌림 커밋, 시각 없는 커밋은 세지 않는다. 머지 커밋 방식과 되돌림
 * 판정은 실측 전이라 쓰지 않는다(protected-core §4).
 * @returns {{commit: string, date: string, branch: string, pr: string|null}|null} 가장 최근 근거
 */
export function mergeEvidenceFromCommits(commits, {ticketKey, baseBranch, repoName = null}) {
  if (!ticketKey || !baseBranch) return null
  const hits = (Array.isArray(commits) ? commits : []).map(commit => ({commit, subject: String(commit?.message ?? '').split(/\r?\n/)[0].trim()}))
    .filter(({commit, subject}) => !commit.mergeCommit && titleStartsWithKey(subject, ticketKey) && /\(#\d+\)$/.test(subject)
      && !/^Revert "/.test(subject) && Number.isFinite(Date.parse(commit.date))
      && (repoName === null || commit.repository?.name === repoName) && (commit.branches ?? []).includes(baseBranch))
    .sort((a, b) => Date.parse(b.commit.date) - Date.parse(a.commit.date))
  if (hits.length === 0) return null
  const {commit, subject} = hits[0]
  return {commit: commit.commitId ?? null, date: commit.date ?? null, branch: baseBranch, pr: subject.match(/\(#(\d+)\)\s*$/)?.[1] ?? null}
}

/** 설정에서 완료로 볼 해결 사유(순수) — provider 이름 아래 설정을 본다. */
export const completedResolutionsOf = (config, providerName) => {
  const value = config?.[providerName]?.completedResolutions
  return Array.isArray(value) && value.length > 0 ? value : DEFAULT_COMPLETED_RESOLUTIONS
}

/** 커서 해석(순수). 손상된 커서를 0으로 접으면 1페이지를 다시 읽고 그 위에서 완결을 계산한다 — loud하게 막는다. */
export function parseCursor(cursor) {
  if (cursor === null || cursor === undefined || cursor === '') return 0
  if (!/^\d+$/.test(String(cursor))) throw new Error(`INVALID_CURSOR: 정수가 아닌 커서 — ${cursor}`)
  return Number.parseInt(String(cursor), 10)
}

/**
 * 관계 표현 능력(순수). **설정이 정한다** — 코어가 Jira의 이슈 타입·링크 타입을 추측하지 않는다.
 * @returns {{mode: 'issue-link'|'link-only'|'unsupported', linkType?: string, needsConfig: string[]}}
 */
export function workRelationMode(providerName, config) {
  const declared = config?.workLink ?? null
  // **관계 방식은 트래커 이름이 아니라 선언이 정한다.** 한쪽 트래커만 기본 통과를 주면 게이트 강도가
  // provider 이름으로 갈린다 — GitHub 팀은 면제, Jira 팀은 설정 의무가 된다(적대 리뷰 2026-09-14).
  // 본문 참조(`link-only`)도 **명시 opt-in**이다. 그것은 관계가 아니라 참조라는 사실을 사람이 받아들이는 것이다.
  const available = providerName === 'jira' ? ['issue-link', 'link-only'] : providerName === 'github' ? ['link-only'] : []
  if (available.length === 0) return {mode: 'unsupported', needsConfig: [`workLink.mode — ${providerName}의 관계 능력을 아직 모른다`]}
  if (!declared?.mode) {
    return {mode: 'unsupported', needsConfig: [`workLink.mode(${available.join('|')})`,
      ...(available.includes('issue-link') ? ['issue-link면 workLink.linkType(프로젝트에 실재하는 링크 타입 이름)'] : [])]}
  }
  if (!available.includes(declared.mode)) {
    // 하위 작업(subtask)은 **발행 시점의 부모 필드**라 연결 시점에 붙일 수 없다 — 지원한다고 말하지 않는다.
    const why = declared.mode === 'subtask'
      ? 'subtask는 발행 시점의 부모 필드라 연결 시점에 붙일 수 없다(미구현)'
      : `${providerName}에서 알 수 없는 workLink.mode: ${declared.mode}`
    return {mode: 'unsupported', needsConfig: [why, `workLink.mode(${available.join('|')})`]}
  }
  if (declared.mode === 'issue-link' && !declared.linkType) return {mode: 'unsupported', needsConfig: ['workLink.linkType']}
  // `parentSide`는 **가정**이다 — 어느 쪽이 부모로 읽히는지는 링크 타입의 설명문(프로젝트 설정)이 정한다.
  return {mode: declared.mode, linkType: declared.linkType ?? null, parentSide: declared.parentSide ?? 'outward', needsConfig: []}
}

/** Jira 이슈 링크 생성 요청 본문(순수). 부모가 outward다 — 방향을 뒤집으면 관계가 거꾸로 보인다. */
export function issueLinkBody({parentKey, childKey, linkType, parentSide = 'outward'}) {
  if (!parentKey || !childKey || !linkType) throw new Error('INVALID_LINK_REQUEST: parentKey·childKey·linkType이 필요하다')
  if (!['outward', 'inward'].includes(parentSide)) throw new Error(`INVALID_PARENT_SIDE: ${parentSide}`)
  const parent = {key: String(parentKey)}
  const child = {key: String(childKey)}
  return parentSide === 'outward'
    ? {type: {name: linkType}, outwardIssue: parent, inwardIssue: child}
    : {type: {name: linkType}, inwardIssue: parent, outwardIssue: child}
}

/** GitHub 검색 인자(순수). 본문 검색은 **색인 지연**이 있어 결과 부재를 단정할 수 없다. */
export const GITHUB_PAGE_LIMIT = 100
export const workSearchArgs = (repo, workId, limit = GITHUB_PAGE_LIMIT) => {
  if (!WORK_ID.test(String(workId))) throw new Error(`INVALID_WORK_ID: ${workId}`)
  return ['issue', 'list', '--repo', repo, '--state', 'all', '--search', `${workId} in:body`,
    '--json', 'number,title,labels,state', '--limit', String(limit)]
}

/** GitHub 목록 인자(순수). `limit`에 닿으면 잘렸을 수 있다 — 그 사실을 호출자가 받는다. */
export const workListArgs = (repo, limit = GITHUB_PAGE_LIMIT) => ['issue', 'list', '--repo', repo, '--state', 'all',
  '--json', 'number,title,labels,state,stateReason,closedAt,body,assignees', '--limit', String(limit)]

/** gh 결과 해석(순수). 반환 수가 상한과 같으면 `complete: false` — 「전부」라고 말하지 않는다. */
export function parseGithubWorkList(json, {limit = GITHUB_PAGE_LIMIT, indexLag = false} = {}) {
  const items = Array.isArray(json) ? json : []
  return {
    matches: items.map(item => ({ticketKey: String(item.number), summary: item.title ?? null,
      labels: (item.labels ?? []).map(label => label?.name ?? label), state: item.state ?? null, stateReason: item.stateReason ?? null, doneAt: item.closedAt ?? null, body: item.body ?? null,
      assignees: 'assignees' in item ? (item.assignees ?? []).map(person => person?.login ?? person) : null})),
    complete: items.length < limit && !indexLag,
    truncated: items.length >= limit,
    indexLag,
  }
}

/**
 * WORK 모드가 **발행 전에** 확인하는 능력(순수). 없는 능력을 있다고 말하지 않고, 무엇을 설정해야
 * 하는지 돌려준다 — 설계 §7.2 「관계 방식이 정해지지 않으면 발행 전에 필요한 설정을 반환한다」.
 * @returns {{ok: boolean, missing: string[], relation: object, provider: string, capabilities: object}}
 */
export function workProviderReadiness(provider, config) {
  const name = provider?.name ?? 'unknown'
  const capabilities = {
    // **WORK 전용 필드 빌더가 있어야 한다.** FEAT 빌더는 `sourceKey`를 FEAT로 보고 `feat-<키>` 라벨과
    // `web-harness:refs` 마커를 덧붙인다 — WORK에 쓰면 조회 축(`work-…` 라벨)이 통째로 사라져
    // 재개 조회가 「완전·0건」을 돌려주고, 부재로 읽혀 중복 발행이 된다. 존재만 보는 검사라는
    // 한계는 그대로다(§4 프록시) — 의미는 provider별 conformance 회귀가 잰다.
    buildWorkFields: typeof provider?.buildWorkFields === 'function',
    createIssue: typeof provider?.createIssue === 'function',
    findByWorkId: typeof provider?.findByWorkId === 'function',
    listWorkIssues: typeof provider?.listWorkIssues === 'function',
    linkRelated: typeof provider?.linkRelated === 'function',
    updateBody: typeof provider?.updateBody === 'function',
    // 이미 발행한 작업의 **소비 FEAT·판본 동기화**(T47)에 쓴다 — 없으면 계획 개정 뒤 티켓이 영영 낡는다.
    updateLabels: typeof provider?.updateLabels === 'function',
    // 사람이 고친 본문을 덮지 않고 판본 표지만 옮기는 능력 · AI 작업 맥락을 본문 밖에 두는 능력(2026-09-15).
    updateMarker: typeof provider?.updateMarker === 'function',
    attachContext: typeof provider?.attachContext === 'function',
  }
  const relation = workRelationMode(name, config)
  const missing = Object.entries(capabilities).filter(([, present]) => !present).map(([key]) => `provider.${key}`)
  // `ok`의 뜻은 「관계가 있다」가 아니라 **「선언된 방식으로 발행할 수 있다」**이다. `link-only`는 관계가
  // 아니라 본문 참조이며, 그 사실을 사람이 명시 선언(opt-in)해야 통과한다 — 트래커 이름으로 면제되지 않는다.
  if (relation.mode === 'unsupported') missing.push(...relation.needsConfig.map(item => `config.${item}`))
  return {ok: missing.length === 0, missing, relation, provider: name, capabilities}
}
