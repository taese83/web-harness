// GitHub provider 실행부의 argv·순서·오류 경로. exec를 주입해 실 gh 없이 검증한다:
// (1) argv 빌더 구조 고정, (2) createIssue가 라벨 사전 생성 후 이슈 생성, (3) URL 미검출 시 throw,
// (4) repo 형식 검증, (5) TicketProvider 필수부(WORK 표면) 충족.
import assert from 'node:assert/strict'
import test from 'node:test'
import {createArgs, createGithubProvider, labelEnsureArgs} from './ticket/provider-github-exec.mjs'
import {buildWorkIssueFields} from './ticket/provider-github.mjs'
import {providerCapabilities, requireTicketProvider} from './ticket/ticket-provider.mjs'

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
  // `comment`는 되돌림을 기획자에게 알리는 경로다 — 전이와 달리 GitHub도 갖는다.
  assert.deepEqual(caps, {transition: false, autoClose: true, comment: true, updateBody: true},
    '없는 능력을 흉내 내면 pickup이 전이했다고 보고하게 된다')
})

const fields = buildWorkIssueFields({title: 't', body: 'b', labels: ['work-00000001-0000-4000-8000-000000000001', 'feat:FEAT-042']})

test('argv 빌더: 인자 구조 고정', () => {
  assert.deepEqual(labelEnsureArgs('o/r', 'feat:FEAT-042'), ['label', 'create', 'feat:FEAT-042', '--repo', 'o/r', '--color', 'ededed', '--force'])
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
  assert.deepEqual(calls, ['label create', 'label create', 'issue create']) // 라벨 먼저, 그 다음 이슈
  assert.deepEqual(issue, {number: 9, url: 'https://github.com/o/r/issues/9'})
})

test('createIssue: 생성 출력에 URL 없으면 throw', async () => {
  const provider = createGithubProvider({repo: 'o/r', exec: async args => args[0] === 'label' ? '' : '출력 없음'})
  await assert.rejects(() => provider.createIssue(fields), /URL을 못 찾음/)
})

test('comment·updateBody: 되돌림 알림과 본문 교체의 argv — 본문은 stdin으로 넘긴다', async () => {
  const calls = []
  const provider = createGithubProvider({repo: 'o/r', exec: async (args, options = {}) => { calls.push({args, stdin: options.stdin ?? null}); return '' }})
  await provider.comment('12', '되돌림 사유')
  await provider.updateBody('12', '새 본문')
  assert.deepEqual(calls[0].args, ['issue', 'comment', '12', '--repo', 'o/r', '--body', '되돌림 사유'])
  assert.deepEqual(calls[1].args, ['issue', 'edit', '12', '--repo', 'o/r', '--body-file', '-'])
  assert.equal(calls[1].stdin, '새 본문', '긴 본문을 인자로 넘기면 길이 한계·인용 문제가 난다')
})
