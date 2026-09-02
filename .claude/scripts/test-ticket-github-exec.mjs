// 통합 빌드 4·5단계 회귀 — side-effect 경계(gh 실행부)의 argv·순서·오류 경로 (리뷰 조건).
// exec를 주입해 실 gh 없이 검증한다: (1) argv 빌더 구조 고정, (2) createIssue가 라벨 사전
// 생성 후 이슈 생성 순서, (3) findByLabel 파싱, (4) createIssue URL 미검출 시 throw,
// (5) resolveViewerPermission 파싱·실패 시 보수 read, (6) repo 형식 검증.
import assert from 'node:assert/strict'
import test from 'node:test'
import {createGithubProvider, resolveViewerPermission, listArgs, labelEnsureArgs, createArgs, permissionArgs} from './ticket/provider-github-exec.mjs'
import {providerCapabilities, requireTicketProvider} from './ticket/ticket-provider.mjs'
import {buildIssueFields} from './ticket/provider-github.mjs'

const fields = buildIssueFields({sourceKey: 'FEAT-042', title: 't', body: 'b', acceptanceCriteria: ['TC-042-1'], harnessRefs: {featureIds: ['FEAT-042'], testCaseIds: ['TC-042-1']}}, {assignee: '@me'})

test('argv 빌더: 인자 구조 고정', () => {
  assert.deepEqual(listArgs('o/r', 'feat:FEAT-042'), ['issue', 'list', '--repo', 'o/r', '--label', 'feat:FEAT-042', '--state', 'all', '--json', 'number,title,url,state', '--limit', '1'])  // state: 닫힌 티켓을 되살리려면 상태가 필요하다
  assert.deepEqual(labelEnsureArgs('o/r', 'feat:FEAT-042'), ['label', 'create', 'feat:FEAT-042', '--repo', 'o/r', '--color', 'ededed', '--force'])
  assert.deepEqual(permissionArgs('o/r'), ['repo', 'view', 'o/r', '--json', 'viewerPermission'])
  assert.ok(createArgs('o/r', fields).includes('--repo') && createArgs('o/r', fields).slice(-2)[0] === '--repo')
})

test('createIssue: 라벨 사전 생성 → 이슈 생성 순서, URL 파싱', async () => {
  const calls = []
  const exec = async args => {
    calls.push(args[0] + (args[1] ? ' ' + args[1] : ''))
    if (args[0] === 'label') return ''
    if (args[0] === 'issue' && args[1] === 'create') return 'https://github.com/o/r/issues/9\n'
    return '[]'
  }
  const provider = createGithubProvider({repo: 'o/r', exec})
  const issue = await provider.createIssue(fields)
  assert.deepEqual(calls, ['label create', 'issue create']) // 라벨 먼저, 그 다음 이슈
  assert.deepEqual(issue, {number: 9, url: 'https://github.com/o/r/issues/9'})
})

test('findByLabel: 이슈 목록 파싱', async () => {
  const provider = createGithubProvider({repo: 'o/r', exec: async () => '[{"number":7,"title":"t","url":"u"}]'})
  assert.deepEqual(await provider.findByLabel('feat:FEAT-042'), {number: 7, title: 't', url: 'u'})
  const empty = createGithubProvider({repo: 'o/r', exec: async () => '[]'})
  assert.equal(await empty.findByLabel('feat:FEAT-042'), null)
})

test('createIssue: 생성 출력에 URL 없으면 throw', async () => {
  const provider = createGithubProvider({repo: 'o/r', exec: async args => args[0] === 'label' ? '' : '출력 없음'})
  await assert.rejects(() => provider.createIssue(fields), /URL을 못 찾음/)
})

test('resolveViewerPermission: 파싱 + 실패 시 보수 read', async () => {
  assert.equal(await resolveViewerPermission({repo: 'o/r', exec: async () => '{"viewerPermission":"WRITE"}'}), 'write')
  assert.equal(await resolveViewerPermission({repo: 'o/r', exec: async () => { throw new Error('HTTP 404') }}), 'read')
})

test('repo 형식 검증: 잘못된 repo는 loud-fail', () => {
  assert.throws(() => createGithubProvider({repo: 'bad repo'}), /INVALID_REPO/)
})

// ── 실 provider가 TicketProvider 계약을 만족하는가 (이관 회귀) ──

test('createGithubProvider는 TicketProvider 필수부를 만족한다', () => {
  const provider = createGithubProvider({repo: 'o/r', exec: async () => '[]'})
  assert.equal(requireTicketProvider(provider), provider)
  assert.equal(provider.name, 'github')
})

test('GitHub은 transition을 제공하지 않는다 — 상태가 open/closed뿐이라 "진행중"이 없다', () => {
  const caps = providerCapabilities(createGithubProvider({repo: 'o/r', exec: async () => '[]'}))
  assert.deepEqual(caps, {reopen: true, transition: false, autoClose: true},
    '없는 능력을 흉내 내면 pickup이 전이했다고 보고하게 된다')
})

test('findByFeature는 FEAT를 라벨로 바꿔 조회한다 — 그 변환은 provider 안에 머문다', async () => {
  const calls = []
  const provider = createGithubProvider({repo: 'o/r', exec: async args => { calls.push(args); return '[]' }})
  await provider.findByFeature('FEAT-042')
  assert.ok(calls[0].includes('feat:FEAT-042'), '조회 키 생성이 호출자에게 새지 않는다')
})
