// 티켓 provider — Jira 실행부(REST). 순수부는 `provider-jira.mjs`.
//
// gh CLI를 쓰는 GitHub과 달리 Jira는 **CLI를 전제할 수 없어** REST를 직접 부른다. 그래서
// 인증이 이쪽 관심사가 된다 — **토큰은 환경변수에서만 읽는다**(`ticket-config.mjs` JIRA_AUTH_ENV).
// 설정 파일은 repo에 커밋될 수 있으므로 거기에 비밀을 두지 않는다.
//
// `fetch`는 주입 가능하다 — 테스트가 네트워크 없이 전 경로를 돌 수 있어야 한다(GitHub provider의
// `exec` 주입과 같은 규율).

import {toAdf, toJiraWikiText, assigneeIdentity, buildWorkIssueFieldsFor, classifyJiraError, closeReference, fromAdf, isClosed, parseCreateResponse, parseIssueResponse, requireJiraConfig, resolveTransitionId, supportedTransitions, WORK_PROPERTY_KEY} from './provider-jira.mjs'
import {issueLinkBody, parseCursor, parseWorkSearch, workKeysJql, workRelationMode} from './work-provider.mjs'
import {withWorkMarker} from './work-refs.mjs'
import {DEV_TICKET} from './intake.mjs'

/** `resolveIssue`가 가져오는 필드. 빠진 필드는 응답에서 `undefined`로 와 「없다」와 구별되지 않는다. */
export const ISSUE_FIELDS = Object.freeze([
  'summary', 'description', 'labels', 'assignee', 'status',
  'components', 'issuetype', // 분류 근거 — 빠지면 인테이크가 축을 못 본다(AOA-3)
  'comment', 'issuelinks', 'updated', // 티켓 맥락 — 기획자의 답·선행 티켓·개정 시점(2026-09-11)
])

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
  // 애드온 API(`/rest/gitplugin/…`)는 표준 API 판본 경로 밖에 있다 — `/rest/`로 시작하면 그대로 붙인다.
  const url = `${String(config.baseUrl).replace(/\/+$/, '')}${path.startsWith('/rest/') ? path : `/rest/api/${version}${path}`}`
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
    // Data Center(v2)는 위키 서식을 렌더하고, Cloud(v3)는 평문을 ADF로 옮긴다 — 마크다운 기호는 글자로 남는다.
    docFormat: String(config.apiVersion ?? '3') === '2' ? 'jira-wiki' : 'markdown',
    buildWorkFields: draft => buildWorkIssueFieldsFor(config, draft),
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
    /** 이슈 조회 — pickup의 소유권 판정 입력. GitHub `resolveIssue`와 같은 형태로 돌려준다. */
    async resolveIssue(key) {
      // **`components`·`issuetype`을 빠뜨리면 인테이크가 축을 못 본다.** 필드를 제한하는
      // 것은 응답 크기 때문인데, 목록에서 빠진 필드는 `undefined`로 와서 「없다」와
      // 구별되지 않는다 — 실측(2026-09-09 AOA-3): 티켓에 `PLAN` 컴포넌트가 있는데
      // 인테이크가 `미분류`를 냈다. 주입 stub을 쓰는 회귀는 이 경로를 타지 않는다.
      // `comment`·`issuelinks`·`updated`는 티켓 맥락이다(2026-09-11) — 기획자의 답과 선행 티켓이
      // 본문 밖에 있어 개발 에이전트에 닿지 않았다.
      const payload = await call(config, `/issue/${encodeURIComponent(key)}`
        + `?fields=${ISSUE_FIELDS.join(',')}`, options)
      const issue = parseIssueResponse(payload)
      if (!issue) throw new Error(`JIRA_ISSUE_NOT_FOUND: ${key}`)
      // WORK 마커는 이슈 속성에 산다 — 읽는 쪽(종류 판정·픽업·확정)은 본문 마커를 보므로 **본문 끝에 붙여** 돌려준다.
      // 속성이 없거나 읽지 못하면 붙이지 않는다(원장이 그 키를 알면 픽업이 `work-marker-missing`으로 막는다).
      const marker = await call(config, `/issue/${encodeURIComponent(key)}/properties/${WORK_PROPERTY_KEY}`, options)
        .then(result => result?.value?.marker ?? null).catch(() => null)
      return marker ? {...issue, body: withWorkMarker(issue.body, marker), markerSource: 'property'} : issue
    },
    // ── WORK 축(P2-b) ── FEAT 조회를 재사용하지 않는다. 절단·미지원을 성공으로 세지 않는다.
    /** 계획·작업 라벨로 WORK 티켓을 찾는다. `complete:false`면 더 있을 수 있다 — 부재를 단정하지 않는다. */
    // 라벨 없이 찾는다: 시도 시각 이후 만들어진 이슈를 끝까지 읽고 본문의 작업 ID로 대조한다. 시각이 없으면 범위를
    // 좁힐 수 없어 부재를 단정하지 않는다(`complete: false`). **보고자로 좁히지 않는다** — 원장은 팀이 공유하고 다른 계정이
    // 재개할 수 있다(보고자로 좁히면 그 계정에서 「완전·0건」이 되어 재발행한다 — 적대 리뷰 2026-09-15).
    async findByWorkId({workId, since = null}) {
      if (!since) return {matches: [], complete: false, total: null, nextCursor: null, reason: 'attempt-time-unknown'}
      const minutes = Math.max(1, Math.ceil((Date.now() - Date.parse(since)) / 60000)) + 10
      const jql = `project = "${config.projectKey}" AND created >= -${minutes}m ORDER BY created ASC`
      const matches = []
      let startAt = 0
      for (let guard = 0; guard < 20; guard++) {
        const payload = await call(config, `/search?jql=${encodeURIComponent(jql)}&startAt=${startAt}&maxResults=50&fields=summary,description`, options)
        const issues = Array.isArray(payload?.issues) ? payload.issues : []
        for (const issue of issues) {
          // Cloud(v3)는 설명을 ADF 객체로 준다 — 문자열로 대조하면 늘 불일치라 「완전·0건」→재발행이 된다.
          if (fromAdf(issue?.fields?.description ?? '').includes(workId)) matches.push({ticketKey: issue.key, summary: issue.fields?.summary ?? null})
        }
        startAt += issues.length
        const total = Number(payload?.total)
        if (!Number.isFinite(total)) return {matches, complete: false, total: null, nextCursor: null}
        if (startAt >= total) return {matches, complete: true, total, nextCursor: null}
        if (issues.length === 0) return {matches, complete: false, total, nextCursor: null, stalled: true}
      }
      return {matches, complete: false, total: null, nextCursor: null, truncated: true}
    },
    /**
     * 사람이 만든 개발 티켓 목록(보드의 「판정 전」). 팀이 `개발 티켓`으로 선언한 컴포넌트의 열린 이슈를 끝까지 읽는다.
     * 선언이 없으면 조회하지 않는다 — 무엇이 개발 티켓인지 추측하지 않는다.
     */
    async listDevTickets({config: teamConfig = {}} = {}) {
      const axis = teamConfig?.jira?.componentAxis ?? config.componentAxis ?? {}
      const components = Object.entries(axis).filter(([, role]) => role === DEV_TICKET).map(([name]) => name)
      if (components.length === 0) return {items: [], complete: true, reason: 'no-dev-ticket-axis'}
      const quoted = components.map(name => `"${String(name).replace(/"/g, '\\"')}"`).join(', ')
      const jql = `project = "${config.projectKey}" AND component in (${quoted}) AND statusCategory != Done ORDER BY created DESC`
      const items = []
      let startAt = 0
      for (let guard = 0; guard < 10; guard++) {
        const payload = await call(config, `/search?jql=${encodeURIComponent(jql)}&startAt=${startAt}&maxResults=50&fields=summary,assignee,labels,status`, options)
        const issues = Array.isArray(payload?.issues) ? payload.issues : []
        for (const issue of issues) {
          items.push({ticketKey: issue.key, summary: issue.fields?.summary ?? null, labels: issue.fields?.labels ?? [], status: issue.fields?.status?.name ?? null,
            assignees: issue.fields?.assignee ? [assigneeIdentity(issue.fields.assignee, config.assigneeField)].filter(Boolean) : []})
        }
        startAt += issues.length
        const total = Number(payload?.total)
        if (!Number.isFinite(total)) return {items, complete: false}
        if (startAt >= total) return {items, complete: true}
        if (issues.length === 0) return {items, complete: false, stalled: true}
      }
      return {items, complete: false, truncated: true}
    },
    /** 최근 끝난 개발 티켓(한 페이지) — 새 개발 티켓 초안이 이미 끝난 작업과 겹치는지 사람이 보게 한다. */
    async listDoneDevTickets({config: teamConfig = {}, limit = 20} = {}) {
      const axis = teamConfig?.jira?.componentAxis ?? config.componentAxis ?? {}
      const components = Object.entries(axis).filter(([, role]) => role === DEV_TICKET).map(([name]) => name)
      if (components.length === 0) return {items: [], complete: true, reason: 'no-dev-ticket-axis'}
      const quoted = components.map(name => `"${String(name).replace(/"/g, '\\"')}"`).join(', ')
      const jql = `project = "${config.projectKey}" AND component in (${quoted}) AND statusCategory = Done ORDER BY updated DESC`
      const payload = await call(config, `/search?jql=${encodeURIComponent(jql)}&startAt=0&maxResults=${limit}&fields=summary,status`, options)
      const issues = Array.isArray(payload?.issues) ? payload.issues : []
      return {items: issues.map(issue => ({ticketKey: issue.key, summary: issue.fields?.summary ?? null, status: issue.fields?.status?.name ?? null})),
        complete: Number(payload?.total) <= issues.length}
    },
    /** 키 목록을 페이지로 돈다. `cursor`는 다음 `startAt`이며 없으면 처음부터. */
    /**
     * 머지 근거 — Jira Git Integration 애드온이 티켓 키로 모은 커밋에서 기대 base의 커밋을 고른다(읽기 전용).
     * 애드온이 없으면(모든 조회가 404) `available: false` — 호출자는 다른 근거로 간다. 키마다의 실패는 `errors`다.
     */
    async listMergeEvidence({keys, baseBranch, repoName = null}) {
      const {mergeEvidenceFromCommits} = await import('./work-provider.mjs')
      const settled = await Promise.all(keys.map(async key => {
        try {
          const payload = await call(config, `/rest/gitplugin/1.0/issues/${encodeURIComponent(key)}/commits`, options)
          return {key: String(key), evidence: mergeEvidenceFromCommits(payload?.commits, {ticketKey: String(key), baseBranch, repoName})}
        } catch (error) {
          return {key: String(key), error: String(error?.message ?? error).slice(0, 120)}
        }
      }))
      const failed = settled.filter(item => item.error)
      if (settled.length > 0 && failed.length === settled.length && failed.every(item => /JIRA_HTTP_404/.test(item.error))) {
        return {available: false, reason: 'Git Integration 애드온이 없다(커밋 조회 경로 404)', evidence: new Map()}
      }
      return {available: true, evidence: new Map(settled.filter(item => item.evidence).map(item => [item.key, item.evidence])),
        errors: failed.map(item => ({ticketKey: item.key, error: item.error}))}
    },
    /** 사람이 다시 연 시각 — 변경 이력에서 해결 사유가 비워진 가장 최근 때. 키마다 한 번 읽는다(머지 근거가 있고 열린 티켓만 부른다). */
    async listReopens({keys}) {
      const {reopenedAtFromJiraChangelog} = await import('./work-provider.mjs')
      const settled = await Promise.all(keys.map(async key => {
        try {
          const payload = await call(config, `/issue/${encodeURIComponent(key)}?fields=resolution&expand=changelog`, options)
          return {key: String(key), at: reopenedAtFromJiraChangelog(payload)}
        } catch (error) {
          return {key: String(key), error: String(error?.message ?? error).slice(0, 120)}
        }
      }))
      return {reopens: new Map(settled.filter(item => item.at).map(item => [item.key, item.at])),
        errors: settled.filter(item => item.error).map(item => ({ticketKey: item.key, error: item.error}))}
    },
    async listWorkIssues({keys, cursor = null, pageSize = 50}) {
      const startAt = parseCursor(cursor) // 손상된 커서를 0으로 접지 않는다 — 1페이지를 다시 읽고 완결을 잘못 계산한다
      const jql = workKeysJql(keys)
      const payload = await call(config, `/search?jql=${encodeURIComponent(jql)}&startAt=${startAt}&maxResults=${pageSize}&fields=summary,labels,status,resolution,resolutiondate,assignee`, options)
      const parsed = parseWorkSearch(payload, {fetched: startAt})
      // 요청한 키 중 **못 본 것**을 함께 돌려준다 — 「조회했는데 없다」와 「이 페이지에 없다」는 다르다.
      const observed = new Set(parsed.matches.map(item => item.ticketKey))
      // 배정 신원은 **쓰는 어휘와 같은 함수**로 고른다(픽업의 소유 판정과 갈라지지 않게).
      const items = parsed.matches.map(item => ({...item,
        assignees: item.assigneeRequested ? [assigneeIdentity(item.assigneeUser, config.assigneeField)].filter(Boolean) : null}))
      return {items, nextCursor: parsed.nextCursor, complete: parsed.complete, total: parsed.total,
        requested: keys.map(String), missing: parsed.complete ? keys.map(String).filter(key => !observed.has(key)) : null,
        ...(parsed.stalled ? {stalled: true} : {})}
    },
    /** 부모-자식 관계. **설정이 정한다** — 능력이 없으면 무엇을 설정해야 하는지 돌려주고 성공을 위장하지 않는다. */
    async linkRelated({parentKey, childKey}) {
      const relation = workRelationMode('jira', config)
      // `link-only`도 여기서 적용되지 않는다 — 본문 참조는 발행(P2-c)이 본문에 남기는 것이지 관계 API가 아니다.
      if (relation.mode !== 'issue-link') return {applied: false, mode: relation.mode, needsConfig: relation.needsConfig}
      try {
        await call(config, '/issueLink', {...options, method: 'POST',
          body: issueLinkBody({parentKey, childKey, linkType: relation.linkType, parentSide: relation.parentSide})})
        return {applied: true, mode: 'issue-link', linkType: relation.linkType, parentSide: relation.parentSide}
      } catch (error) {
        // 실패를 삼키지 않는다 — 무엇이 막혔는지 분류해 올린다(권한·설정·링크 타입 부재).
        return {applied: false, mode: 'unknown', error: String(error?.message ?? error).slice(0, 200), classified: classifyJiraError(String(error?.message ?? error))}
      }
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

  // 되돌림 알림 — Jira는 코멘트가 별도 엔드포인트라 전이 능력과 무관하게 항상 있다.
  //
  // **본문 형식은 REST 버전이 가른다.** Cloud(v3)는 ADF 문서를 요구하고 평문을 보내면 400이다.
  // description은 이미 그렇게 가르는데(`provider-jira.mjs`) 코멘트는 안 갈랐다 — 기본 설정이
  // `apiVersion: '3'`이라 **기본값에서 「되돌아가는 길」이 매번 실패**했다(적대 리뷰 2026-09-09).
  // 사내 배포가 DC(v2)라 파일럿에서는 드러나지 않는 형태다.
  const commentBody = text => (String(config.apiVersion ?? '3') === '2' ? String(text) : toAdf(String(text)))
  provider.comment = async (key, text) => {
    // 하네스 코멘트는 사람이 읽는 평문이다 — 위키 서식(v2)에서는 인라인 코드·대괄호가 깨지지 않게 옮긴다(본문 서식은 따로다).
    const readable = String(config.apiVersion ?? '3') === '2' ? toJiraWikiText(text) : text
    await call(config, `/issue/${encodeURIComponent(key)}/comment`, {...options, method: 'POST', body: {body: commentBody(readable)}})
    return {ticketKey: String(key), commented: true}
  }

  // 본문 교체 — 역방향 인테이크의 스탬프 경로. description은 코멘트와 같은 버전 분기를 탄다.
  // 라벨 증감 — `update.labels`의 add/remove만 보낸다(`fields.labels` 교체는 사람이 단 라벨까지 지운다).
  provider.updateLabels = async (key, {add = [], remove = []}) => {
    const ops = [...add.map(label => ({add: label})), ...remove.map(label => ({remove: label}))]
    if (ops.length > 0) await call(config, `/issue/${encodeURIComponent(key)}`, {...options, method: 'PUT', body: {update: {labels: ops}}})
    return {ticketKey: String(key), added: add, removed: remove}
  }

  provider.updateBody = async (key, body, {marker = null} = {}) => {
    await call(config, `/issue/${encodeURIComponent(key)}`, {...options, method: 'PUT',
      body: {fields: {description: commentBody(body)}}})
    if (marker) await provider.updateMarker(key, marker)
    return {ticketKey: String(key), updated: true}
  }

  // 마커는 속성이다 — 사람이 고친 설명을 건드리지 않고 판본만 옮긴다.
  provider.updateMarker = async (key, marker) => {
    await call(config, `/issue/${encodeURIComponent(key)}/properties/${WORK_PROPERTY_KEY}`, {...options, method: 'PUT', body: {marker}})
    return {ticketKey: String(key), updated: true, scope: 'marker'}
  }

  // AI 작업 맥락 첨부. 새 파일을 올린 **뒤** 옛 첨부를 지운다(올리기 실패로 맥락이 사라지지 않게). 지우기 실패는 보고만 한다.
  provider.attachContext = async (key, {name, content, previous = null}) => {
    const doFetch = options.fetchImpl ?? globalThis.fetch
    const form = new FormData()
    form.append('file', new Blob([String(content)], {type: 'text/markdown'}), name)
    const url = `${String(config.baseUrl).replace(/\/+$/, '')}/rest/api/${String(config.apiVersion ?? '3')}/issue/${encodeURIComponent(key)}/attachments`
    const response = await doFetch(url, {method: 'POST', headers: {Authorization: authHeader(options.env), 'X-Atlassian-Token': 'no-check', Accept: 'application/json'}, body: form})
    if (!response.ok) throw new Error(`JIRA_HTTP_${response.status}: ${(await response.text().catch(() => '')).slice(0, 300)}`)
    const uploaded = await response.json().catch(() => null)
    const ref = Array.isArray(uploaded) && uploaded[0]?.id ? String(uploaded[0].id) : null
    if (!ref) throw new Error('JIRA_ATTACH_NO_ID: 첨부 응답에 id가 없다')
    let previousRemoved = null
    if (previous && String(previous) !== ref) {
      previousRemoved = await call(config, `/attachment/${encodeURIComponent(previous)}`, {...options, method: 'DELETE'}).then(() => true).catch(() => false)
    }
    return {ref, replaced: Boolean(previous), previousRemoved}
  }

  return provider
}
