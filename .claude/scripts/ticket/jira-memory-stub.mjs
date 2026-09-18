// jira-memory-stub.mjs — 메모리 Jira(REST v2의 쓰는 부분만). e2e 테스트들이 실제 `createJiraProvider`를 붙여 쓴다.
// 모르는 요청은 던진다 — 조용히 200을 주면 회귀가 거짓 green이 된다. 테스트 전용이며 런타임 코드가 부르지 않는다.
/**
 * @param {{gitIntegration?: boolean}} [options] gitIntegration: Jira Git Integration 애드온이 있는 인스턴스처럼 티켓 키 커밋을 돌려준다.
 *   없으면 그 경로는 404다(애드온 없는 인스턴스).
 */
export function createJiraStub({gitIntegration = false} = {}) {
  const commits = new Map()
  const issues = new Map()
  const writes = []
  let clock = 0
  let sequence = 100
  const touch = issue => { issue.fields.updated = `2026-09-14T00:00:${String(++clock).padStart(2, '0')}.000+0000` }
  const respond = (status, json) => ({ok: status < 400, status, json: async () => json, text: async () => JSON.stringify(json ?? '')})
  // 코멘트 시각은 실제 시각이다(뒤로 가지 않는다) — 기록 코멘트의 앞뒤를 시각으로 가린다.
  let lastCommentAt = 0
  const commentTime = () => { lastCommentAt = Math.max(Date.now(), lastCommentAt + 1); return new Date(lastCommentAt).toISOString() }
  const humanComment = (key, author, body) => {
    const issue = issues.get(key)
    issue.fields.comment.comments.push({author: {displayName: author}, created: commentTime(), body})
    issue.fields.comment.total += 1
    touch(issue)
  }
  const select = (issue, wanted) => (wanted
    ? {key: issue.key, fields: Object.fromEntries(wanted.split(',').filter(name => name in issue.fields).map(name => [name, structuredClone(issue.fields[name])]))}
    : structuredClone(issue))
  const fetchImpl = async (url, {method = 'GET', body = null} = {}) => {
    const parsed = new URL(url)
    const path = parsed.pathname.replace(/^\/rest\/api\/2/, '')
    const multipart = typeof FormData !== 'undefined' && body instanceof FormData
    const data = body && !multipart ? JSON.parse(body) : null
    if (method !== 'GET') writes.push({method, path, body: data})
    let match
    if ((match = path.match(/^\/rest\/gitplugin\/1\.0\/issues\/([^/]+)\/commits$/))) {
      if (!gitIntegration) return respond(404, {message: 'HTTP 404 Not Found'})
      const list = commits.get(decodeURIComponent(match[1])) ?? []
      return respond(200, {success: true, total: list.length, count: list.length, commits: structuredClone(list)})
    }
    if (method === 'GET' && path === '/search') {
      const jql = parsed.searchParams.get('jql')
      const wanted = parsed.searchParams.get('fields')
      let hits
      if ((match = jql.match(/^key in \(([^)]+)\)/))) {
        const keys = new Set(match[1].split(',').map(key => key.trim()))
        hits = [...issues.values()].filter(issue => keys.has(issue.key))
      } else if ((match = jql.match(/component in \(([^)]+)\)/))) {
        const names = new Set(match[1].split(',').map(name => name.trim().replace(/^"|"$/g, '')))
        hits = [...issues.values()].filter(issue => issue.fields.components.some(component => names.has(component.name)) && issue.fields.status.statusCategory.key !== 'done')
      } else if (/AND created >= -\d+m/.test(jql)) {
        hits = [...issues.values()]
      } else if ([...jql.matchAll(/labels = "([^"]+)"/g)].length > 0) {
        const labels = [...jql.matchAll(/labels = "([^"]+)"/g)].map(item => item[1])
        hits = [...issues.values()].filter(issue => labels.every(label => issue.fields.labels.includes(label)))
      } else {
        // 실 Jira는 깨진 JQL에 400을 준다 — 빈 결과로 답하면 「없음 → 재발행」으로 조용히 지나간다.
        return respond(400, {errorMessages: [`stub이 모르는 JQL: ${jql}`]})
      }
      const startAt = Number(parsed.searchParams.get('startAt') ?? 0)
      const max = Number(parsed.searchParams.get('maxResults') ?? 50)
      return respond(200, {startAt, maxResults: max, total: hits.length, issues: hits.slice(startAt, startAt + max).map(issue => select(issue, wanted))})
    }
    if (method === 'POST' && path === '/issue') {
      const key = `PF-${++sequence}`
      const issue = {key, fields: {labels: [], components: [], issuelinks: [], comment: {total: 0, comments: []},
        assignee: null, status: {name: 'Open', statusCategory: {key: 'new'}}, resolution: null, ...data.fields},
        properties: Object.fromEntries((data.properties ?? []).map(item => [item.key, item.value])), attachments: []}
      touch(issue)
      issues.set(key, issue)
      return respond(201, {key, self: `https://jira.test/rest/api/2/issue/${key}`})
    }
    if ((match = path.match(/^\/issue\/([^/]+)$/)) && method === 'GET') {
      const issue = issues.get(decodeURIComponent(match[1]))
      if (!issue) return respond(404, {errorMessages: ['없는 이슈']})
      return respond(200, select(issue, parsed.searchParams.get('fields')))
    }
    if ((match = path.match(/^\/issue\/([^/]+)\/assignee$/)) && method === 'PUT') {
      if (typeof data?.name !== 'string') return respond(400, {errorMessages: ['assignee에는 name이 필요하다(DC)']})
      const issue = issues.get(match[1]); issue.fields.assignee = {name: data.name}; touch(issue); return respond(204, null)
    }
    if ((match = path.match(/^\/issue\/([^/]+)\/transitions$/))) {
      const issue = issues.get(match[1])
      if (method === 'GET') return respond(200, {transitions: [{id: '31', name: '진행'}, {id: '41', name: '완료'}]})
      const done = data.transition.id === '41'
      issue.fields.status = {name: data.transition.id, statusCategory: {key: done ? 'done' : 'indeterminate'}}
      // 실측(DC 10.3): 해결 사유 필수 전이에서 사유를 빼면 Fixed가 채워지고, 완료가 아닌 전이는 사유를 비운다.
      issue.fields.resolution = done ? {name: data.fields?.resolution?.name ?? 'Fixed'} : null
      issue.fields.resolutiondate = done ? new Date().toISOString() : null
      touch(issue)
      return respond(204, null)
    }
    if ((match = path.match(/^\/issue\/([^/]+)\/properties\/([^/]+)$/))) {
      const issue = issues.get(decodeURIComponent(match[1]))
      if (!issue) return respond(404, {errorMessages: ['없는 이슈']})
      if (method === 'GET') return issue.properties[match[2]] ? respond(200, {key: match[2], value: issue.properties[match[2]]}) : respond(404, {errorMessages: ['속성 없음']})
      if (method === 'PUT') { issue.properties[match[2]] = data; return respond(200, {}) }
    }
    if ((match = path.match(/^\/issue\/([^/]+)\/attachments$/)) && method === 'POST') {
      if (!multipart) return respond(415, {errorMessages: ['첨부는 multipart여야 한다']})
      const file = body.get('file')
      const issue = issues.get(decodeURIComponent(match[1]))
      const id = String(1000 + issue.attachments.length)
      issue.attachments.push({id, filename: file.name, content: await file.text()})
      return respond(200, [{id, filename: file.name}])
    }
    if ((match = path.match(/^\/issue\/([^/]+)$/)) && method === 'PUT') {
      const issue = issues.get(decodeURIComponent(match[1]))
      if (data.fields?.description !== undefined) issue.fields.description = data.fields.description
      for (const op of data.update?.labels ?? []) {
        if (op.add && !issue.fields.labels.includes(op.add)) issue.fields.labels.push(op.add)
        if (op.remove) issue.fields.labels = issue.fields.labels.filter(label => label !== op.remove)
      }
      touch(issue)
      return respond(204, null)
    }
    if ((match = path.match(/^\/issue\/([^/]+)\/comment$/)) && method === 'POST') {
      humanComment(match[1], 'web-harness', data.body)
      return respond(201, {})
    }
    throw new Error(`jira stub: 모르는 요청 ${method} ${path}`)
  }
  /** 사람이 트래커에 직접 만든 티켓(하네스 쓰기가 아니다 — writes에 세지 않는다). */
  const humanTicket = ({summary, description, components = []}) => {
    const key = `PF-${++sequence}`
    const issue = {key, fields: {summary, description, labels: [], components: components.map(name => ({name})), issuelinks: [],
      comment: {total: 0, comments: []}, assignee: null, status: {name: 'Open', statusCategory: {key: 'new'}}, resolution: null}, properties: {}, attachments: []}
    touch(issue)
    issues.set(key, issue)
    return key
  }
  /** 애드온이 색인한 커밋처럼 — 메시지에 키가 든 커밋을 그 티켓에 붙인다. */
  const indexCommit = (key, commit) => { commits.set(key, [...(commits.get(key) ?? []), {mergeCommit: false, notes: {}, ...commit}]) }
  return {issues, writes, humanComment, humanTicket, indexCommit, fetchImpl}
}
