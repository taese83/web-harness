// 통합 빌드 3단계 회귀 — GitHub Issues provider 순수 부분.
//
// 고정하는 사실: (1) buildIssueFields가 draft→gh 이슈 필드(본문에 왕복 마커·AC 체크박스,
// FEAT 고유 라벨), (2) assignee 미지정 시 null(혼자 개발/나중 분배), (3) parseIssueRefs가
// 왕복 마커에서 FEAT/TC 되읽기·마커 없으면 본문 폴백, (4) ghCreateArgs가 gh 인자 구성(실행 아님),
// (5) featLabel이 FEAT당 고유 라벨(claim 경쟁 키).
import assert from 'node:assert/strict'
import test from 'node:test'
import {parseIssueRefs, ghCreateArgs, featLabel, parseCreatedIssueUrl, buildWorkIssueFields} from './ticket/provider-github.mjs'

test('parseIssueRefs: 마커 없는 맨몸 이슈 → 본문 폴백(형식 엄격)', () => {
  const refs = parseIssueRefs('사람이 쓴 이슈. FEAT-005 관련, TC-005-1을 만족해야 함. (TC-QA는 비규격이라 미추출)')
  assert.deepEqual(refs, {featureIds: ['FEAT-005'], testCaseIds: ['TC-005-1'], branch: null})
  assert.deepEqual(parseIssueRefs(null), {featureIds: [], testCaseIds: [], branch: null})
})

test('featLabel: FEAT당 고유 라벨(claim 경쟁 키)', () => {
  assert.equal(featLabel('FEAT-042'), 'feat:FEAT-042')
  assert.notEqual(featLabel('FEAT-042'), featLabel('FEAT-043'))
})

test('parseCreatedIssueUrl: gh issue create URL에서 번호 추출', () => {
  assert.deepEqual(parseCreatedIssueUrl('https://github.com/taese83/harness-ticket-test/issues/42\n'), {number: 42, url: 'https://github.com/taese83/harness-ticket-test/issues/42'})
  assert.equal(parseCreatedIssueUrl('출력 없음'), null)
})

test('배선: 두 provider가 본문을 교체할 수 있고 능력으로 표시된다', async () => {
  const {createGithubProvider} = await import('./ticket/provider-github-exec.mjs')
  const {createJiraProvider} = await import('./ticket/provider-jira-exec.mjs')
  const {providerCapabilities} = await import('./ticket/ticket-provider.mjs')

  // GitHub: 본문은 **stdin**으로 넘긴다 — argv는 인자 길이 한계와 셸 인용에 걸린다.
  const calls = []
  const gh = createGithubProvider({repo: 'o/r', exec: async (args, options) => { calls.push({args, stdin: options?.stdin}); return '' }})
  await gh.updateBody(42, '본문 + 마커')
  assert.deepEqual(calls[0].args, ['issue', 'edit', '42', '--repo', 'o/r', '--body-file', '-'])
  assert.equal(calls[0].stdin, '본문 + 마커', '본문이 argv로 새어나갔다')
  assert.equal(providerCapabilities(gh).updateBody, true)
  // 라벨 증감(T47): 붙일 라벨을 먼저 보장하고, 준 것만 붙이고 뗀다(전체 교체가 아니다).
  calls.length = 0
  await gh.updateLabels(42, {add: ['feat-FEAT-004'], remove: ['team-a']})
  assert.deepEqual(calls.map(call => call.args), [
    ['label', 'create', 'feat-FEAT-004', '--repo', 'o/r', '--color', 'ededed', '--force'],
    ['issue', 'edit', '42', '--repo', 'o/r', '--add-label', 'feat-FEAT-004', '--remove-label', 'team-a']])

  // AI 작업 맥락: 파일 첨부 API가 없어 접힌 코멘트 하나로 두고, 동기화는 그 코멘트를 고친다(지워졌으면 새로 단다).
  calls.length = 0
  const ghApi = createGithubProvider({repo: 'o/r', exec: async (args, options) => {
    calls.push({args, stdin: options?.stdin})
    if (args.includes('PATCH') && args.some(arg => arg.endsWith('/comments/404'))) throw new Error('gh exit 1: HTTP 404: Not Found')
    return args.includes('POST') ? JSON.stringify({id: 555}) : '{}'
  }})
  assert.deepEqual(await ghApi.attachContext(42, {name: 'ctx.md', content: '# ctx'}), {ref: '555', replaced: false})
  assert.ok(calls[0].args.includes('repos/o/r/issues/42/comments') && /<details>[\s\S]*# ctx/.test(JSON.parse(calls[0].stdin).body))
  assert.equal((await ghApi.attachContext(42, {name: 'ctx.md', content: '# v2', previous: '777'})).replaced, true)
  assert.equal((await ghApi.attachContext(42, {name: 'ctx.md', content: '# v3', previous: '404'})).ref, '555', '지워진 코멘트를 고치려다 멈췄다')
  // 마커만 교체 — 사람이 고친 본문은 그대로 두고 끝의 주석만 바꾼다.
  calls.length = 0
  const oldMarker = '<!-- web-harness:work plan=p work=w rev=old -->'
  await gh.updateMarker(42, '<!-- web-harness:work plan=p work=w rev=new -->', {currentBody: `사람이 고친 본문\n\n${oldMarker}`})
  assert.equal(calls[0].stdin, '사람이 고친 본문\n\n<!-- web-harness:work plan=p work=w rev=new -->')

  // Jira: description은 코멘트와 같은 버전 분기를 탄다(Cloud v3는 ADF, DC v2는 평문).
  const seen = []
  const capture = async (url, init) => {
    seen.push({url, method: init.method, body: JSON.parse(init.body)})
    return {ok: true, status: 200, json: async () => ({}), text: async () => '{}'}
  }
  const base = {baseUrl: 'https://j.example.com', projectKey: 'P', issueType: 'Task'}
  const cloud = createJiraProvider({config: {...base, apiVersion: '3'}, fetchImpl: capture, env: {JIRA_TOKEN: 't'}})
  await cloud.updateBody('PF-1', '본문')
  assert.equal(seen[0].method, 'PUT')
  assert.match(seen[0].url, /\/rest\/api\/3\/issue\/PF-1$/)
  assert.equal(seen[0].body.fields.description.type, 'doc', 'Cloud에 평문을 보냈다 — 400이 난다')

  const dc = createJiraProvider({config: {...base, apiVersion: '2'}, fetchImpl: capture, env: {JIRA_TOKEN: 't'}})
  await dc.updateBody('PF-1', '본문')
  assert.equal(seen[1].body.fields.description, '본문')
  await dc.updateLabels('PF-1', {add: ['feat-FEAT-004'], remove: ['team-a']})
  assert.deepEqual(seen[2].body, {update: {labels: [{add: 'feat-FEAT-004'}, {remove: 'team-a'}]}}, '`fields.labels` 교체는 사람이 단 라벨까지 지운다')
  // 마커는 이슈 속성이다 — 본문 교체와 함께 속성도 옮기고, 조회는 속성을 본문 끝에 붙여 돌려준다.
  seen.length = 0
  await dc.updateBody('PF-1', '본문', {marker: '<!-- web-harness:work m -->'})
  assert.deepEqual(seen.map(call => `${call.method} ${new URL(call.url).pathname}`), ['PUT /rest/api/2/issue/PF-1', 'PUT /rest/api/2/issue/PF-1/properties/web-harness.work'])
  assert.deepEqual(seen[1].body, {marker: '<!-- web-harness:work m -->'})
  const withProperty = createJiraProvider({config: {...base, apiVersion: '2'}, env: {JIRA_TOKEN: 't'}, fetchImpl: async url => {
    const json = String(url).includes('/properties/') ? {key: 'web-harness.work', value: {marker: '<!-- web-harness:work m -->'}} : {key: 'PF-1', fields: {summary: 's', description: '사람용 본문'}}
    return {ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json)}
  }})
  const resolved = await withProperty.resolveIssue('PF-1')
  assert.equal(resolved.body, '사람용 본문\n\n<!-- web-harness:work m -->')
  // 첨부: multipart로 올리고, 새 파일이 올라간 **뒤** 옛 첨부를 지운다.
  const attachCalls = []
  const attacher = createJiraProvider({config: {...base, apiVersion: '2'}, env: {JIRA_TOKEN: 't'}, fetchImpl: async (url, init) => {
    attachCalls.push({method: init.method, path: new URL(url).pathname, token: init.headers?.['X-Atlassian-Token'], multipart: init.body instanceof FormData})
    const json = init.method === 'POST' ? [{id: '9001'}] : null
    return {ok: true, status: init.method === 'DELETE' ? 204 : 200, json: async () => json, text: async () => ''}
  }})
  const attached = await attacher.attachContext('PF-1', {name: 'ctx.md', content: '# ctx', previous: '9000'})
  assert.deepEqual(attached, {ref: '9001', replaced: true, previousRemoved: true})
  assert.deepEqual(attachCalls.map(call => `${call.method} ${call.path}`), ['POST /rest/api/2/issue/PF-1/attachments', 'DELETE /rest/api/2/attachment/9000'])
  assert.equal(attachCalls[0].token, 'no-check', 'XSRF 헤더 없이 올리면 Jira가 거부한다')
  assert.equal(attachCalls[0].multipart, true)
})

test('parseIssueRefs: 옛 왕복 마커에서 FEAT/TC를 되읽는다 — 분해된 FEAT 티켓을 WORK로 안내하는 입력', () => {
  const body = '레이스를 기록한다\n\n<!-- web-harness:refs feat=FEAT-042 tc=TC-008-1,TC-008-2 -->'
  assert.deepEqual(parseIssueRefs(body).featureIds, ['FEAT-042'])
  assert.deepEqual(parseIssueRefs(body).testCaseIds, ['TC-008-1', 'TC-008-2'])
})

test('ghCreateArgs: gh 인자 구성(실행 아님)', () => {
  const args = ghCreateArgs(buildWorkIssueFields({title: '레이스 기록', body: 'b', labels: ['feat:FEAT-042']}))
  assert.deepEqual(args.slice(0, 2), ['issue', 'create'])
  assert.ok(args.includes('--title') && args.includes('레이스 기록'))
  assert.ok(args.includes('--label') && args.includes('feat:FEAT-042'))
})
