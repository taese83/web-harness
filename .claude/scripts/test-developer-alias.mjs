#!/usr/bin/env node
// test-developer-alias.mjs — `--developer me`(`@me`)를 지금 인증된 계정으로 푸는지 고정한다.
// 풀지 않으면 트래커가 모르는 계정(`me`)으로 배정하려다 멈추고(Jira Cloud 404), 「이미 내 것인가」 대조도 늘 어긋난다.
import assert from 'node:assert/strict'
import test from 'node:test'
import {createJiraStub} from './ticket/jira-memory-stub.mjs'
import {createJiraProvider} from './ticket/provider-jira-exec.mjs'
import {createGithubProvider} from './ticket/provider-github-exec.mjs'
import {developerGuidance, resolveDeveloperAlias} from './ticket/cli.mjs'

const jiraFor = ({cloud}) => {
  const jira = createJiraStub({cloud})
  const config = cloud
    ? {baseUrl: 'https://team.atlassian.net', projectKey: 'PF', issueType: 'Task', apiVersion: '3', assigneeField: 'accountId'}
    : {baseUrl: 'https://jira.example.com', projectKey: 'PF', issueType: 'Task', apiVersion: '2', assigneeField: 'name'}
  return {jira, provider: createJiraProvider({config, fetchImpl: jira.fetchImpl, env: {JIRA_TOKEN: 't'}})}
}

test('Jira Cloud: me는 accountId로 풀리고, 그 값으로 배정이 성공한다(별칭 그대로면 404)', async () => {
  const {jira, provider} = jiraFor({cloud: true})
  const key = jira.humanTicket({summary: 's', description: 'd'})
  await assert.rejects(provider.assign(key, 'me'), /JIRA_HTTP_404/, '스텁이 실제처럼 모르는 계정을 거부해야 한다')
  for (const alias of ['me', '@me', ' ME ']) {
    assert.deepEqual(await resolveDeveloperAlias(alias, provider), {developer: 'acc-self'})
  }
  await provider.assign(key, (await resolveDeveloperAlias('me', provider)).developer)
  assert.equal(jira.issues.get(key).fields.assignee.accountId, 'acc-self')
})

test('Jira 서버: me는 username으로 풀린다', async () => {
  const {provider} = jiraFor({cloud: false})
  assert.deepEqual(await resolveDeveloperAlias('me', provider), {developer: 'dev-self'})
})

test('GitHub: me는 login으로 풀린다', async () => {
  const provider = createGithubProvider({repo: 'o/r', exec: async args => (args[0] === 'api' && args[1] === 'user' ? 'octo-dev\n' : '')})
  assert.deepEqual(await resolveDeveloperAlias('@me', provider), {developer: 'octo-dev'})
})

test('별칭이 아니면 그대로 두고, 풀지 못하면 null과 사유 — 계정을 지어내지 않는다', async () => {
  assert.deepEqual(await resolveDeveloperAlias('acc-123', null), {developer: 'acc-123'})
  assert.deepEqual(await resolveDeveloperAlias(undefined, null), {developer: null})
  const none = await resolveDeveloperAlias('me', null)
  assert.equal(none.developer, null)
  assert.match(none.unresolved, /현재 계정/)
  const failing = await resolveDeveloperAlias('me', {currentUser: async () => { throw new Error('JIRA_HTTP_401: unauthorized') }})
  assert.equal(failing.developer, null)
  assert.match(failing.unresolved, /401/)
  assert.match(developerGuidance('x'), /accountId.*username.*login/)
})

test('CLI pickup: me를 풀지 못하면 트래커에 쓰기 전에 멈춘다(프로세스 배선 — 로컬 판정 뒤)', async () => {
  const {spawnSync} = await import('node:child_process')
  const {chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync} = await import('node:fs')
  const {tmpdir} = await import('node:os')
  const {dirname, join} = await import('node:path')
  const {fileURLToPath} = await import('node:url')
  const root = mkdtempSync(join(tmpdir(), 'wh-dev-alias-'))
  try {
    // 계획이 있어야 픽업이 로컬 판정을 지나 트래커 단계(계정 풀기)까지 간다.
    cpSync(join(dirname(fileURLToPath(import.meta.url)), '../evals/fixtures/work-plan/crud'), root, {recursive: true})
    writeFileSync(join(root, '_workspace/03_dev/ticket-provider.json'), JSON.stringify({provider: 'github'}))
    const bin = join(root, 'bin')
    mkdirSync(bin)
    const log = join(root, 'gh-calls.txt')
    // 가짜 gh — 모든 호출을 적고, 현재 계정 조회(api user)는 실패시킨다.
    // 이슈 조회에는 최소 응답을 준다 — 정지가 빠지면 크래시가 아니라 아래 단언(배정 시도·사유)이 잡도록.
    const issueJson = JSON.stringify({number: 7, title: 't', body: 'b', labels: [], assignees: [], comments: [], updatedAt: '2026-01-01T00:00:00Z'})
    writeFileSync(join(bin, 'gh'), `#!/bin/sh\necho "$@" >> "${log}"\ncase "$1 $2" in "api user") echo "HTTP 401: Bad credentials" >&2; exit 1;; "issue view") echo '${issueJson}';; esac\nexit 0\n`)
    chmodSync(join(bin, 'gh'), 0o755)
    const cli = join(dirname(fileURLToPath(import.meta.url)), 'ticket/cli.mjs')
    const result = spawnSync(process.execPath, [cli, 'pickup', '7', '--developer', 'me', '--repo', 'o/r', '--root', root],
      {encoding: 'utf8', env: {...process.env, PATH: `${bin}:${process.env.PATH}`}})
    const output = JSON.parse(result.stdout)
    assert.equal(output.bounce?.reason, 'developer-unresolved', result.stdout)
    assert.equal(output.externalWrites, 0)
    assert.match(output.guidance, /accountId.*username.*login/)
    const calls = existsSync(log) ? readFileSync(log, 'utf8') : ''
    assert.doesNotMatch(calls, /issue edit/, '계정을 모르는데 배정을 시도했다')
  } finally { rmSync(root, {recursive: true, force: true}) }
})

test('값 없는 --developer는 문자열 true로 배정하지 않는다', async () => {
  const bare = await resolveDeveloperAlias(true, null)
  assert.equal(bare.developer, null)
  assert.match(bare.unresolved, /값이 없다/)
})

test('보드: 내 계정을 모르면 담당자가 있는 티켓을 「남의 것」이라 하지 않는다', async () => {
  const {buildTicketBoard} = await import('./ticket/work-board.mjs')
  const board = buildTicketBoard({state: {works: new Map(), tickets: new Map()}, developer: null,
    devTickets: [{ticketKey: 'PF-1', summary: 's', assignees: ['acc-self']}, {ticketKey: 'PF-2', summary: 's', assignees: []}]})
  const rows = new Map((board.rows ?? board).map(row => [row.ticketKey, row]))
  assert.equal(rows.get('PF-1').blockedReason, 'assignment-unknown')
  assert.doesNotMatch(rows.get('PF-1').next, /다른 개발자/)
  assert.equal(rows.get('PF-2').blockedReason, null)
  const known = buildTicketBoard({state: {works: new Map(), tickets: new Map()}, developer: 'acc-other',
    devTickets: [{ticketKey: 'PF-1', summary: 's', assignees: ['acc-self']}]})
  assert.equal((known.rows ?? known)[0].blockedReason, 'assigned-to-other')
})

test('정상 경로: Jira Cloud 사람 티켓 픽업에서 me가 accountId로 풀려 실제로 배정되고 「내 것」으로 대조된다', async () => {
  const {mkdirSync, mkdtempSync, rmSync, writeFileSync} = await import('node:fs')
  const {tmpdir} = await import('node:os')
  const {join} = await import('node:path')
  const {pickupOutcome, runWorkPickup} = await import('./ticket/work-pickup-run.mjs')
  const root = mkdtempSync(join(tmpdir(), 'wh-dev-alias-happy-'))
  try {
    mkdirSync(join(root, '_workspace/03_dev'), {recursive: true})
    writeFileSync(join(root, '_workspace/03_dev/spec.json'), JSON.stringify({schemaVersion: 2, specTier: 'unverifiable', layerMap: {shared: 'src/shared'}, testLayers: {unit: 'tests'}}))
    writeFileSync(join(root, '_workspace/03_dev/work-item-events.jsonl'), '')
    const jira = createJiraStub({cloud: true})
    const config = {baseUrl: 'https://team.atlassian.net', projectKey: 'PF', issueType: 'Task', apiVersion: '3', assigneeField: 'accountId',
      componentAxis: {DEVELOP: '개발 티켓'}}
    const provider = createJiraProvider({config, fetchImpl: jira.fetchImpl, env: {JIRA_TOKEN: 't'}})
    const key = jira.humanTicket({summary: '표 빈 상태', components: ['DEVELOP'], description: '완료 조건: 빈 목록이면 안내 문구'})
    const picked = await runWorkPickup({root, ticketKey: key, developer: 'me', flags: {'no-fetch': true},
      io: {provider, ticketConfig: {provider: 'jira', jira: config}, resolveDeveloper: value => resolveDeveloperAlias(value, provider)}})
    assert.equal(jira.issues.get(key).fields.assignee?.accountId, 'acc-self', `배정이 풀린 계정으로 가지 않았다: ${JSON.stringify(picked).slice(0, 300)}`)
    assert.notEqual(picked.bounce?.reason, 'assign-lost', '배정 뒤 「내 것」 대조가 어긋났다')
    assert.equal(pickupOutcome(picked), 'assessing')
  } finally { rmSync(root, {recursive: true, force: true}) }
})
