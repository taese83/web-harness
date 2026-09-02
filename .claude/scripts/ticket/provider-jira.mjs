// 티켓 provider — Jira (순수부). 실행(REST)은 `provider-jira-exec.mjs`가 담당한다.
//
// 교차 형태 전제: **티켓은 Jira, 코드는 GHE.** 그래서 이 파일에는 PR·머지·브랜치가 없다 —
// 그것은 VCS 축이고 `git-origin.mjs`·`claim-guard.mjs`가 이미 트래커를 모른 채 담당한다.
//
// GitHub과 다른 것 셋 — 이 셋이 `transition`이 필요한 이유다:
//  1. **상태가 open/closed가 아니다.** 워크플로우 status는 팀마다 다르고 이름도 다르다.
//     그래서 이 파일은 `'In Progress'`·`'Done'` 같은 이름을 **말하지 않는다** — 의도(phase)만
//     받고 실제 transition id는 설정이 들고 있다. 하드코딩하면 그 팀에서만 도는 계약이 된다.
//  2. **PR 본문의 키 언급으로 자동 닫히지 않는다.** `closeReference`가 null인 이유다 —
//     머지 뒤 `transition`을 능동 호출해야 하고, 그 자리는 청구 브랜치의 close 워크플로우다.
//  3. **라벨 조회가 1급이 아니다.** JQL로 찾는다.
//
// 왕복 마커(`<!-- web-harness:refs ... -->`)는 `refs.mjs` 소유이고 트래커 무관이다. Jira
// 본문에서는 HTML 주석이 숨겨지지 않아 **평문으로 보인다** — 보기 좋지는 않지만 마커 형식을
// 트래커별로 가르지 않는 쪽을 택했다(가르면 왕복 파서가 둘이 된다).

import {buildRefsMarker} from './refs.mjs'

/** FEAT 고유 라벨. Jira 라벨은 공백을 못 넣고 콜론이 버전에 따라 불안정해 하이픈을 쓴다. */
export const featLabel = featureId => `feat-${featureId}`

/** 브랜치 스탬프 라벨(GitHub의 `branch:`와 같은 역할, 문자셋만 Jira 규칙). */
export const branchLabel = branch => {
  if (!branch) return null
  const label = `branch-${String(branch).replace(/[^\w.-]/g, '-')}`
  return label.length <= 255 ? label : null // Jira 라벨 상한
}

/** 라벨 배열에서 브랜치 스탬프를 되읽는다(순수). */
export function parseBranchFromLabels(labels) {
  const found = (labels ?? []).find(l => typeof l === 'string' && l.startsWith('branch-'))
  return found ? (found.slice('branch-'.length) || null) : null
}

/**
 * 설정 검증(순수). **이름을 지어내지 않는다** — 없으면 loud하게 막고 무엇이 없는지 말한다.
 * 여기서 막지 않으면 나중에 "전이했다"고 보고하면서 아무 일도 일어나지 않는다.
 * @param {Object} config
 * @returns {Object} 검증된 설정
 */
export function requireJiraConfig(config) {
  const missing = []
  if (!config?.baseUrl) missing.push('baseUrl')
  if (!config?.projectKey) missing.push('projectKey')
  if (!config?.issueType) missing.push('issueType')
  // 전이 매핑은 **선택이다** — 없으면 `transition` 능력을 노출하지 않고 그 사실을 표시한다.
  // 있는 척하는 것보다 없다고 말하는 쪽이 낫다(`ticket-provider.mjs` 선택 메서드 규율).
  if (missing.length > 0) {
    throw new Error(`JIRA_CONFIG_INCOMPLETE: 없는 항목 — ${missing.join(', ')}. 설정은 사용자에게 받는다(팀마다 다르다).`)
  }
  return config
}

/** 설정이 어떤 phase 전이를 지원하는지(순수). 매핑이 없으면 그 phase는 없는 것이다. */
export function supportedTransitions(config) {
  const map = config?.transitions ?? {}
  return Object.keys(map).filter(phase => map[phase] !== null && map[phase] !== undefined && map[phase] !== '')
}

/**
 * FEAT로 기존 티켓을 찾는 JQL(순수). 라벨이 기본이고, 팀이 커스텀 필드를 쓰면 그쪽을 쓴다.
 * @param {Object} config  {projectKey, featureField?}
 * @param {string} featureId
 */
export function featureJql(config, featureId) {
  const project = `project = "${config.projectKey}"`
  if (config.featureField) return `${project} AND "${config.featureField}" ~ "${featureId}" ORDER BY created ASC`
  return `${project} AND labels = "${featLabel(featureId)}" ORDER BY created ASC`
}

/** Jira 본문 텍스트 — 동작 명세 + AC + 왕복 마커. 트래커 무관 마커를 평문으로 싣는다. */
export function buildDescriptionText(draft, {branch = null, designRefs = []} = {}) {
  const lines = [draft.body ?? '']
  const criteria = draft.acceptanceCriteria ?? []
  if (criteria.length > 0) {
    lines.push('', '수용 기준', ...criteria.map(item => `- ${item}`))
  }
  if (designRefs.length > 0) {
    lines.push('', '참고 정본 (게이트가 아니라 포인터다)', ...designRefs.map(ref => `- ${ref}`))
  }
  const refs = draft.harnessRefs ?? {}
  lines.push('', buildRefsMarker(refs.featureIds, refs.testCaseIds, {branch}))
  return lines.join('\n')
}

/**
 * 평문 → ADF(Atlassian Document Format). Cloud REST v3가 description을 문서 객체로 받는다.
 * Data Center(v2)는 평문이라 이 변환이 필요 없다 — `apiVersion`이 그것을 가른다.
 */
export function toAdf(text) {
  return {
    type: 'doc',
    version: 1,
    content: String(text).split('\n').map(line => ({
      type: 'paragraph',
      content: line.length > 0 ? [{type: 'text', text: line}] : [],
    })),
  }
}

/**
 * TicketDraft → Jira 이슈 필드(순수). `TicketProvider.buildFields` 구현체.
 * @param {Object} config  requireJiraConfig 통과분
 */
export function buildIssueFieldsFor(config, draft, {assignee = null, branch = null, designRefs = []} = {}) {
  const text = buildDescriptionText(draft, {branch, designRefs})
  const labels = [featLabel(draft.sourceKey), branchLabel(branch)].filter(Boolean)
  const fields = {
    project: {key: config.projectKey},
    issuetype: {name: config.issueType},
    summary: draft.title,
    description: String(config.apiVersion ?? '3') === '2' ? text : toAdf(text),
    labels,
  }
  // assignee 표기는 배포마다 다르다(Cloud=accountId, DC=name) — 설정이 정하고 여기서 고르지 않는다.
  if (assignee) fields.assignee = config.assigneeField === 'name' ? {name: assignee} : {accountId: assignee}
  return {fields}
}

/**
 * 닫힘 판정. **status 이름이 아니라 statusCategory로 본다** — 이름은 팀마다 다르고 번역도 된다.
 * Jira의 statusCategory는 `new`·`indeterminate`·`done` 셋으로 고정이라 이름보다 안정적이다.
 */
export function isClosed(issue) {
  const category = issue?.fields?.status?.statusCategory ?? issue?.statusCategory
  const key = String(category?.key ?? category ?? '').toLowerCase()
  return key === 'done'
}

/** Jira 검색 응답 → 호출자가 쓰는 이슈 형태(순수). 없으면 null. */
export function parseSearchResponse(payload) {
  const issues = payload?.issues ?? []
  const first = issues[0]
  if (!first) return null
  return {
    ticketKey: first.key,
    key: first.key,
    url: first.self ?? null,
    summary: first.fields?.summary ?? null,
    labels: first.fields?.labels ?? [],
    statusCategory: first.fields?.status?.statusCategory ?? null,
  }
}

/** 생성 응답 → 이슈 형태(순수). */
export function parseCreateResponse(payload) {
  if (!payload?.key) return null
  return {ticketKey: payload.key, key: payload.key, url: payload.self ?? null}
}

/**
 * 전이 목록에서 phase에 해당하는 transition id를 고른다(순수).
 * 설정이 id를 직접 주면 그것을 쓰고, 이름을 주면 목록에서 찾는다 — **여기서 이름을 지어내지 않는다.**
 */
export function resolveTransitionId(config, phase, available = []) {
  const configured = config?.transitions?.[phase]
  if (configured === null || configured === undefined || configured === '') return null
  const asString = String(configured)
  if (available.some(t => String(t.id) === asString)) return asString
  const byName = available.find(t => String(t.name).toLowerCase() === asString.toLowerCase())
  if (byName) return String(byName.id)
  // 설정에 적힌 것이 현재 워크플로우에 없다 — 조용히 건너뛰면 "전이했다"는 거짓 보고가 된다.
  throw new Error(
    `JIRA_TRANSITION_NOT_AVAILABLE: phase=${phase} 설정값="${asString}" — 현재 가능한 전이: ` +
    (available.map(t => `${t.id}:${t.name}`).join(', ') || '(없음)'),
  )
}

/** Jira REST 오류 분류 — `TicketProvider.classifyError` 구현체. */
export function classifyJiraError(message = '') {
  const text = String(message)
  if (/\b401\b|Unauthorized|AUTHENTICATED_FAILED/i.test(text)) {
    return {kind: 'auth', hint: 'Jira 인증 실패 — 토큰 환경변수를 확인하세요'}
  }
  if (/\b403\b|Forbidden/i.test(text)) {
    return {kind: 'forbidden', hint: 'Jira 권한 부족 — 프로젝트에 이슈 생성 권한이 필요합니다'}
  }
  if (/\b404\b|does not exist|Not Found/i.test(text)) {
    return {kind: 'not-found', hint: 'Jira 프로젝트·이슈를 찾을 수 없습니다 — projectKey를 확인하세요'}
  }
  return {kind: 'unknown', hint: text.slice(0, 200)}
}

/**
 * Jira는 PR 본문 언급으로 자동 닫히지 않는다. **null을 돌려주는 것이 정직한 답이다** —
 * 호출자는 이 값이 null이면 머지 후 `transition`을 능동 호출해야 함을 안다.
 */
export const closeReference = () => null
