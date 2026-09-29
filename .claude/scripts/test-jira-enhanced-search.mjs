#!/usr/bin/env node
// test-jira-enhanced-search.mjs — Jira Cloud는 옛 검색(`/search`)을 v2·v3 모두 지웠다(410). provider가 Cloud에서 강화 검색
// (`/search/jql`, nextPageToken·isLast, total 없음, 한 쪽 50건)으로 끝까지 읽고, 끝을 모르면 완결이라 하지 않는지 고정한다.
// 스텁은 Cloud 사이트에서 관측한 형태로 답한다 — 옛 주소 410, fields 없으면 id만, 한 쪽 50건.
import assert from 'node:assert/strict'
import test from 'node:test'
import {createJiraStub} from './ticket/jira-memory-stub.mjs'
import {createJiraProvider, usesEnhancedSearch} from './ticket/provider-jira-exec.mjs'
import {classifyJiraError} from './ticket/provider-jira.mjs'

const axis = {jira: {componentAxis: {DEVELOP: '개발 티켓'}}}
const cloudConfigs = [
  {baseUrl: 'https://team.atlassian.net', projectKey: 'PF', issueType: 'Task', apiVersion: '3', assigneeField: 'accountId'},
  // Cloud에서 판본을 2로 적어도 옛 검색은 410이다 — 호스트로 Cloud를 알아본다.
  {baseUrl: 'https://team.atlassian.net', projectKey: 'PF', issueType: 'Task', apiVersion: '2', assigneeField: 'accountId'},
]
const withCloud = config => {
  const jira = createJiraStub({cloud: true})
  const urls = []
  const fetchImpl = async (url, init) => { urls.push(String(url)); return jira.fetchImpl(url, init) }
  return {jira, urls, provider: createJiraProvider({config, fetchImpl, env: {JIRA_TOKEN: 't'}})}
}
const legacyCalls = urls => urls.filter(url => /\/rest\/api\/[23]\/search\?/.test(url))

test('판별: 판본 3 또는 *.atlassian.net이면 강화 검색, 서버(v2)는 옛 검색', () => {
  assert.equal(usesEnhancedSearch(cloudConfigs[0]), true)
  assert.equal(usesEnhancedSearch(cloudConfigs[1]), true)
  assert.equal(usesEnhancedSearch({baseUrl: 'https://jira.example.com', apiVersion: '2'}), false)
})

for (const config of cloudConfigs) {
  test(`Cloud(v${config.apiVersion}) 열린 개발 티켓 — 50건 넘게 토큰으로 끝까지 읽고 완결이다(같은 제목 검사가 설 수 있다)`, async () => {
    const {jira, urls, provider} = withCloud(config)
    for (let index = 0; index < 120; index += 1) jira.humanTicket({summary: `티켓 ${index}`, components: ['DEVELOP'], description: 'x'})
    const listed = await provider.listDevTickets({config: axis})
    assert.equal(listed.complete, true)
    assert.equal(listed.items.length, 120)
    assert.ok(listed.items.every(item => typeof item.summary === 'string' && item.summary.startsWith('티켓 ')), 'fields를 빠뜨리면 강화 검색은 id만 준다')
    assert.deepEqual(legacyCalls(urls), [], '지워진 옛 검색을 불렀다')
    assert.ok(urls.filter(url => url.includes('/search/jql')).length >= 3, '한 쪽 50건 상한으로 여러 쪽을 넘겨야 한다')
  })

  test(`Cloud(v${config.apiVersion}) 끝난 개발 티켓·작업 ID 조회·WORK 키 목록도 강화 검색으로 완결을 판정한다`, async () => {
    const {jira, urls, provider} = withCloud(config)
    const keys = []
    for (let index = 0; index < 70; index += 1) {
      keys.push(jira.humanTicket({summary: `작업 ${index}`, components: ['DEVELOP'], description: index === 65 ? '작업 ID: WORK-abc' : 'y'}))
    }
    for (const key of keys.slice(0, 3)) jira.issues.get(key).fields.status = {name: 'Done', statusCategory: {key: 'done'}}
    const done = await provider.listDoneDevTickets({config: axis, limit: 20})
    assert.equal(done.items.length, 3)
    assert.equal(done.complete, true)
    const cut = await provider.listDoneDevTickets({config: axis, limit: 2})
    assert.equal(cut.items.length, 2)
    assert.equal(cut.complete, false, '한 쪽에 다 담지 못했는데 완결이라 했다')
    const found = await provider.findByWorkId({workId: 'WORK-abc', since: new Date(Date.now() - 60_000).toISOString()})
    assert.deepEqual(found.matches.map(item => item.ticketKey), [keys[65]])
    assert.equal(found.complete, true)
    // WORK 조회 — 커서는 불투명한 토큰이다(정수로 파싱하지 않는다). 호출자(work-state-run)처럼 끝까지 돈다.
    let listed = await provider.listWorkIssues({keys})
    const seen = [...listed.items]
    for (let guard = 0; listed.nextCursor && !listed.stalled && guard < 10; guard++) {
      assert.doesNotMatch(listed.nextCursor, /^\d+$/)
      listed = await provider.listWorkIssues({keys, cursor: listed.nextCursor})
      seen.push(...listed.items)
    }
    assert.equal(listed.complete, true)
    assert.equal(seen.length, 70)
    // 한 쪽에 다 들어오면 요청했는데 못 본 키를 단정할 수 있다
    const single = await provider.listWorkIssues({keys: [keys[0], keys[1], 'PF-9999']})
    assert.equal(single.complete, true)
    assert.deepEqual(single.missing, ['PF-9999'])
    assert.deepEqual(legacyCalls(urls), [])
  })
}

test('Cloud에서 끝을 알 수 없는 응답(isLast 없음·토큰 없음)은 완결이 아니다 — 「못 읽음」을 「없음」으로 접지 않는다', async () => {
  const provider = createJiraProvider({config: cloudConfigs[0], env: {JIRA_TOKEN: 't'},
    fetchImpl: async () => ({ok: true, status: 200, json: async () => ({issues: [{key: 'PF-1', fields: {summary: 's'}}]}), text: async () => ''})})
  assert.equal((await provider.listDevTickets({config: axis})).complete, false)
  assert.equal((await provider.listDoneDevTickets({config: axis})).complete, false)
  const work = await provider.listWorkIssues({keys: ['PF-1', 'PF-2']})
  assert.equal(work.complete, false)
  assert.equal(work.missing, null, '완결이 아닌데 「못 찾음」을 단정했다')
})

test('삭제된 API(410)는 api-removed — Cloud면 apiVersion 3, 그래도 나면 업데이트라고 안내한다', () => {
  const classified = classifyJiraError('JIRA_HTTP_410: {"errorMessages":["The requested API has been removed."]}')
  assert.equal(classified.kind, 'api-removed')
  assert.match(classified.hint, /apiVersion을 3/)
  assert.match(classified.hint, /업데이트/)
})

test('Cloud 끝 모름은 세 메서드 모두 같은 규칙으로 정체(stalled)다', async () => {
  const provider = createJiraProvider({config: cloudConfigs[0], env: {JIRA_TOKEN: 't'},
    fetchImpl: async () => ({ok: true, status: 200, json: async () => ({issues: [{key: 'PF-1', fields: {summary: 's', description: 'x'}}]}), text: async () => ''})})
  assert.equal((await provider.listDevTickets({config: axis})).stalled, true)
  assert.equal((await provider.findByWorkId({workId: 'W', since: new Date().toISOString()})).stalled, true)
  assert.equal((await provider.listWorkIssues({keys: ['PF-1']})).stalled, true)
})

test('서버(v2) — total이 없는 응답은 완결이 아니다(옛 코드는 0으로 읽어 완결로 접었다)', async () => {
  const provider = createJiraProvider({config: {baseUrl: 'https://jira.example.com', projectKey: 'PF', issueType: 'Task', apiVersion: '2'},
    env: {JIRA_TOKEN: 't'}, fetchImpl: async () => ({ok: true, status: 200, json: async () => ({issues: [{key: 'PF-1', fields: {summary: 's'}}]}), text: async () => ''})})
  assert.equal((await provider.listDevTickets({config: axis})).complete, false)
  assert.equal((await provider.listDoneDevTickets({config: axis})).complete, false)
})
