// work-provider.mjs — WORK 티켓의 조회·관계·목록을 트래커 뒤로 감추는 **순수부**.
//
// 설계 §7.2: 기존 `findByFeature`를 WORK 조회에 재사용하지 않는다(축이 다르다 — FEAT가 아니라
// `(planId, workId)`다). 여기서 지키는 것 셋:
//   1. **절단을 성공으로 세지 않는다.** 목록·검색이 일부만 왔으면 `complete: false`이고, 호출자는 그것을
//      「없음」으로 읽지 않는다(부재를 단정해 재발행하면 중복 티켓이 생긴다 — 설계 §8-5).
//   2. **미지원을 성공으로 위장하지 않는다.** 관계 표현 능력이 없거나 설정이 없으면 `unsupported`와
//      **무엇을 설정해야 하는지**를 돌려준다. 링크뿐이면 `link-only`이고 계층이라 부르지 않는다.
//   3. **하드코딩하지 않는다.** Jira의 이슈 링크 타입·프로젝트·전이 id는 전부 설정이 든다(I3).
import {UUID, WORK_ID} from './work-refs.mjs'

/** WORK 조회 키로 쓰는 라벨. 트래커 라벨은 공백을 못 넣으므로 UUID 부분만 쓴다(41자, 하이픈 허용). */
export function workLabel(workId) {
  if (!WORK_ID.test(String(workId))) throw new Error(`INVALID_WORK_ID: ${workId}`)
  return `work-${String(workId).slice('WORK-'.length)}`
}

/** 계획 라벨 — 한 계획의 티켓을 함께 조회한다. */
export function planLabel(planId) {
  if (!UUID.test(String(planId))) throw new Error(`INVALID_PLAN_ID: ${planId}`)
  return `plan-${planId}`
}

/** `workId`로 찾는 JQL(순수). 프로젝트는 설정이 든다 — 키를 하드코딩하지 않는다. */
export function workJql(config, {planId, workId}) {
  const clauses = [`project = "${config.projectKey}"`, `labels = "${workLabel(workId)}"`]
  if (planId) clauses.push(`labels = "${planLabel(planId)}"`)
  return `${clauses.join(' AND ')} ORDER BY created ASC`
}

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
      labels: issue.fields?.labels ?? [], statusCategory: issue.fields?.status?.statusCategory?.key ?? null})),
    total,
    complete: total === null ? false : seen >= total,
    nextCursor: total !== null && seen < total && !stalled ? String(seen) : null,
    ...(stalled ? {stalled: true} : {}),
  }
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
  '--json', 'number,title,labels,state,body', '--limit', String(limit)]

/** gh 결과 해석(순수). 반환 수가 상한과 같으면 `complete: false` — 「전부」라고 말하지 않는다. */
export function parseGithubWorkList(json, {limit = GITHUB_PAGE_LIMIT, indexLag = false} = {}) {
  const items = Array.isArray(json) ? json : []
  return {
    matches: items.map(item => ({ticketKey: String(item.number), summary: item.title ?? null,
      labels: (item.labels ?? []).map(label => label?.name ?? label), state: item.state ?? null, body: item.body ?? null})),
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
    createIssue: typeof provider?.createIssue === 'function',
    findByWorkId: typeof provider?.findByWorkId === 'function',
    listWorkIssues: typeof provider?.listWorkIssues === 'function',
    linkRelated: typeof provider?.linkRelated === 'function',
    updateBody: typeof provider?.updateBody === 'function',
  }
  const relation = workRelationMode(name, config)
  const missing = Object.entries(capabilities).filter(([, present]) => !present).map(([key]) => `provider.${key}`)
  // `ok`의 뜻은 「관계가 있다」가 아니라 **「선언된 방식으로 발행할 수 있다」**이다. `link-only`는 관계가
  // 아니라 본문 참조이며, 그 사실을 사람이 명시 선언(opt-in)해야 통과한다 — 트래커 이름으로 면제되지 않는다.
  if (relation.mode === 'unsupported') missing.push(...relation.needsConfig.map(item => `config.${item}`))
  return {ok: missing.length === 0, missing, relation, provider: name, capabilities}
}
