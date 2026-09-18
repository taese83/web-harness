// jira-memory-stub.mjs — 메모리 Jira(REST v2의 쓰는 부분만). e2e 테스트들이 실제 `createJiraProvider`를 붙여 쓴다.
// 모르는 요청은 던진다 — 조용히 200을 주면 회귀가 거짓 green이 된다. 테스트 전용이며 런타임 코드가 부르지 않는다.
export function createJiraStub() {
  const issues = new Map()
  const writes = []
  let clock = 0
  let sequence = 100
  const touch = issue => { issue.fields.updated = `2026-09-14T00:00:${String(++clock).padStart(2, '0')}.000+0000` }
  const respond = (status, json) => ({ok: status < 400, status, json: async () => json, text: async () => JSON.stringify(json ?? '')})
  const humanComment = (key, author, body) => {
    const issue = issues.get(key)
    issue.fields.comment.comments.push({author: {displayName: author}, created: `c${clock}`, body})
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
        assignee: null, status: {name: 'Open', statusCategory: {key: 'new'}}, ...data.fields},
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
      issue.fields.status = {name: data.transition.id, statusCategory: {key: data.transition.id === '41' ? 'done' : 'indeterminate'}}
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
      comment: {total: 0, comments: []}, assignee: null, status: {name: 'Open', statusCategory: {key: 'new'}}}, properties: {}, attachments: []}
    touch(issue)
    issues.set(key, issue)
    return key
  }
  return {issues, writes, humanComment, humanTicket, fetchImpl}
}
