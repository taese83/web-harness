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
