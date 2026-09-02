// 티켓 provider — Jira 실행부(REST). 순수부는 `provider-jira.mjs`.
//
// gh CLI를 쓰는 GitHub과 달리 Jira는 **CLI를 전제할 수 없어** REST를 직접 부른다. 그래서
// 인증이 이쪽 관심사가 된다 — **토큰은 환경변수에서만 읽는다**(`ticket-config.mjs` JIRA_AUTH_ENV).
// 설정 파일은 repo에 커밋될 수 있으므로 거기에 비밀을 두지 않는다.
//
// `fetch`는 주입 가능하다 — 테스트가 네트워크 없이 전 경로를 돌 수 있어야 한다(GitHub provider의
// `exec` 주입과 같은 규율).

import {
  buildIssueFieldsFor, classifyJiraError, closeReference, featureJql,
  isClosed, parseCreateResponse, parseSearchResponse, requireJiraConfig, resolveTransitionId,
  supportedTransitions,
} from './provider-jira.mjs'

/** 인증 헤더. Cloud는 email:token basic, Data Center는 bearer가 일반적이다. */
export function authHeader(env = process.env) {
  const token = env.JIRA_TOKEN
  if (!token) {
    throw new Error('JIRA_AUTH_MISSING: JIRA_TOKEN 환경변수가 없다 — 토큰은 설정 파일이 아니라 환경변수로 준다')
  }
  const email = env.JIRA_EMAIL
  if (email) return `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`
  return `Bearer ${token}`
}

/** REST 호출 1회. 실패는 상태코드를 담아 던진다 — `classifyJiraError`가 그것을 읽는다. */
async function call(config, path, {method = 'GET', body = null, fetchImpl = null, env = process.env} = {}) {
  const doFetch = fetchImpl ?? globalThis.fetch
  if (typeof doFetch !== 'function') throw new Error('JIRA_FETCH_UNAVAILABLE: fetch를 쓸 수 없다')
  const version = String(config.apiVersion ?? '3')
  const url = `${String(config.baseUrl).replace(/\/+$/, '')}/rest/api/${version}${path}`
  const response = await doFetch(url, {
    method,
    headers: {Authorization: authHeader(env), 'Content-Type': 'application/json', Accept: 'application/json'},
    ...(body ? {body: JSON.stringify(body)} : {}),
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`JIRA_HTTP_${response.status}: ${text.slice(0, 300)}`)
  }
  if (response.status === 204) return null
  return response.json().catch(() => null)
}

/**
 * Jira TicketProvider를 만든다. `ticket-provider.mjs` 계약을 만족한다.
 *
 * **전이 능력은 설정이 정한다** — `transitions` 매핑이 없으면 `transition`을 **노출하지 않는다**.
 * 없는 능력을 노출하고 내부에서 no-op하면 호출자는 전이했다고 보고한다.
 *
 * @param {{config: Object, fetchImpl?: Function, env?: Object}} args
 */
export function createJiraProvider({config, fetchImpl = null, env = process.env}) {
  requireJiraConfig(config)
  const options = {fetchImpl, env}
  const phases = supportedTransitions(config)

  const provider = {
    // ── TicketProvider 필수부 ──
    name: 'jira',
    buildFields: (draft, opts = {}) => buildIssueFieldsFor(config, draft, opts),
    async findByFeature(featureId) {
      const jql = featureJql(config, featureId)
      const payload = await call(config, `/search?jql=${encodeURIComponent(jql)}&maxResults=1&fields=summary,labels,status`, options)
      return parseSearchResponse(payload)
    },
    async createIssue(fields) {
      const payload = await call(config, '/issue', {...options, method: 'POST', body: fields})
      const created = parseCreateResponse(payload)
      if (!created) throw new Error(`JIRA_CREATE_NO_KEY: 생성 응답에 key가 없다 — ${JSON.stringify(payload).slice(0, 200)}`)
      return created
    },
    // ── 선택부 ──
    isClosed,
    classifyError: classifyJiraError,
    // **null을 돌려준다** — Jira는 PR 본문 언급으로 자동 닫히지 않는다. 호출자는 이 값이
    // null이면 머지 후 `transition`을 능동 호출해야 함을 안다.
    closeReference,
    /** 현재 이슈에서 가능한 전이 목록(설정값이 실제 워크플로우에 있는지 대조하는 근거). */
    async availableTransitions(key) {
      const payload = await call(config, `/issue/${encodeURIComponent(key)}/transitions`, options)
      return payload?.transitions ?? []
    },
    async assign(key, assignee) {
      const body = config.assigneeField === 'name' ? {name: assignee} : {accountId: assignee}
      await call(config, `/issue/${encodeURIComponent(key)}/assignee`, {...options, method: 'PUT', body})
      return {ticketKey: key, assignee}
    },
  }

  // 전이 매핑이 있는 phase가 하나라도 있을 때만 능력을 노출한다.
  if (phases.length > 0) {
    /**
     * 상태 전이. **의도(phase)만 받는다** — 실제 status 이름·id는 설정이 들고 있다.
     * 설정값이 현재 워크플로우에 없으면 `resolveTransitionId`가 loud하게 던진다.
     */
    provider.transition = async (key, phase) => {
      if (!phases.includes(phase)) {
        return {ticketKey: key, transitioned: false, reason: `no-mapping:${phase}`}
      }
      const available = await provider.availableTransitions(key)
      const id = resolveTransitionId(config, phase, available)
      await call(config, `/issue/${encodeURIComponent(key)}/transitions`, {
        ...options, method: 'POST', body: {transition: {id}},
      })
      return {ticketKey: key, transitioned: true, phase, transitionId: id}
    }
    provider.transitionPhases = phases
  }

  // 되살리기는 Jira에서 별도 API가 아니라 전이다 — 그 phase 매핑이 있을 때만 노출한다.
  if (phases.includes('reopen')) {
    provider.reopenIssue = async (key, comment = null) => {
      if (comment) await call(config, `/issue/${encodeURIComponent(key)}/comment`, {...options, method: 'POST', body: {body: comment}})
      return provider.transition(key, 'reopen')
    }
  }

  return provider
}
