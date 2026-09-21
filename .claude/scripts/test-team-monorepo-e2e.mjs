#!/usr/bin/env node
// test-team-monorepo-e2e.mjs — 모노레포(apps/web + apps/api)에서 be·fe가 나눠 집는 흐름. 실제 git clone·메모리 Jira·
// **실제 소유권 훅 프로세스**로 돈다.
//
// 고정하는 사실:
//   (1) 역할은 트래커 라벨과 보드 행에 그대로 실린다(be·fe)
//   (2) 픽업 범위는 앱 접두 경로로 좁혀지고, 따로 둔 테스트 레이어는 쓸 수 있다 — 완료 조건인 테스트를 막지 않는다
//   (3) 남의 앱 경로는 훅이 막는다
//   (4) 진행 중인 be 작업과 경로가 겹치는 사람 티켓은 착수하지 않고, 그 티켓을 연결하려 하면 판정 전에 죽지 않고 멈춘다
import assert from 'node:assert/strict'
import test from 'node:test'
import {execFileSync} from 'node:child_process'
import {cpSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createJiraStub} from './ticket/jira-memory-stub.mjs'
import {createJiraProvider} from './ticket/provider-jira-exec.mjs'
import {readChangeScopeFile} from './ticket/cli.mjs'
import {canonicalDigest} from './ticket/work-analysis.mjs'
import {runClaimWork} from './ticket/work-claim.mjs'
import {runWorkPublish} from './ticket/work-publish-run.mjs'
import {pickupOutcome, runWorkPickup} from './ticket/work-pickup-run.mjs'
import {runWorkLink} from './ticket/work-link-run.mjs'
import {runWorkBoard} from './ticket/work-board.mjs'
import {assessmentDigest, assessmentPath} from './ticket/ticket-work.mjs'
import {checkTeamSharing} from './validate-development-readiness.mjs'

const repoRoot = new URL('../..', import.meta.url).pathname
const hook = join(repoRoot, '.claude/scripts/enforce-agent-ownership.mjs')
const W = n => `WORK-0000000${n}-0000-4000-8000-00000000000${n}`
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim()
const tryGit = (cwd, ...args) => { try { git(cwd, ...args); return true } catch { return false } }
const jiraConfig = {baseUrl: 'https://jira.test', projectKey: 'PF', issueType: 'Task', apiVersion: '2', assigneeField: 'name',
  transitions: {'in-progress': '31', done: '41'}, workLink: {mode: 'issue-link', linkType: 'Relates'}, componentAxis: {PLAN: '기획 입력', DEVELOP: '개발 티켓'}}
const ticketConfig = {provider: 'jira', jira: jiraConfig}
// PR 호스트(메모리) — 기대 base에 머지된 PR 목록. 하네스는 머지를 기록하지 않고 제목의 티켓 키로 읽는다.
const merged = []
const mergedPrs = async () => merged
const mergePr = (url, ticketKey) => merged.push({number: Number(url.split('/').pop()), title: `[${ticketKey}] 작업`, mergedAt: new Date().toISOString(), url})
const open = async () => ({state: 'OPEN', baseRefName: 'main'})
const commitSplit = (dir, message) => {
  git(dir, 'add', '-A', '--', '.', ':(exclude)_workspace')
  if (!tryGit(dir, 'diff', '--cached', '--quiet')) git(dir, 'commit', '-qm', `code: ${message}`)
  git(dir, 'add', '-A', '--', '_workspace')
  if (!tryGit(dir, 'diff', '--cached', '--quiet')) git(dir, 'commit', '-qm', `harness: ${message}`)
}
/** 개발 에이전트가 쓰는 것처럼 — 훅이 허락한 파일만 쓴다. */
const agentWrite = (dir, file, text) => {
  try {
    execFileSync(process.execPath, [hook], {cwd: dir, stdio: ['pipe', 'pipe', 'pipe'],
      input: JSON.stringify({tool_name: 'Write', agent_type: 'developer', cwd: dir, tool_input: {file_path: join(dir, file)}})})
  } catch { return false }
  mkdirSync(join(dir, file, '..'), {recursive: true})
  writeFileSync(join(dir, file), text)
  return true
}

test('모노레포 팀 흐름: be·fe가 앱 접두 범위로 나눠 집고, 테스트는 쓰고 남의 앱은 막힌다', async () => {
  const base = mkdtempSync(join(tmpdir(), 'wh-team-mono-'))
  const jira = createJiraStub()
  const providerFor = () => createJiraProvider({config: jiraConfig, fetchImpl: jira.fetchImpl, env: {JIRA_TOKEN: 't'}})
  try {
    const origin = join(base, 'origin.git')
    git(base, 'init', '-q', '--bare', '-b', 'main', origin)
    const lead = join(base, 'lead')
    mkdirSync(lead)
    cpSync(join(repoRoot, '.claude/evals/fixtures/work-plan/crud'), lead, {recursive: true})
    // 모노레포로 옮긴다: 화면은 apps/web, 회원 API 계약 작업(W1)은 apps/api의 be 작업
    mkdirSync(join(lead, 'apps/web'), {recursive: true})
    renameSync(join(lead, 'src'), join(lead, 'apps/web/src'))
    mkdirSync(join(lead, 'apps/api/src/members'), {recursive: true})
    writeFileSync(join(lead, 'apps/api/src/server.ts'), 'export {}\n')
    const toWeb = path => JSON.parse(readFileSync(path, 'utf8').replace(/"src\//g, '"apps/web/src/'))
    const analysis = toWeb(join(lead, '_workspace/03_dev/work-analysis.json'))
    analysis.scope.targetRoots = ['apps/web/src', 'apps/api/src']
    writeFileSync(join(lead, '_workspace/03_dev/work-analysis.json'), JSON.stringify(analysis, null, 2))
    const plan = toWeb(join(lead, '_workspace/03_dev/work-plan.json'))
    const contract = plan.workItems.find(item => item.workId === W(1))
    Object.assign(contract, {roles: ['be'], readPaths: ['apps/api/src/server.ts'], writePaths: ['apps/api/src/members/'],
      provides: [{path: 'apps/api/src/members/routes.ts', anchor: 'memberRoutes'}]})
    contract.checks[0].targetRefs = ['apps/api/src/members/routes.ts']
    plan.analysisRef.digest = canonicalDigest(analysis)
    writeFileSync(join(lead, '_workspace/03_dev/work-plan.json'), JSON.stringify(plan, null, 2))
    writeFileSync(join(lead, '_workspace/03_dev/spec.json'), JSON.stringify({schemaVersion: 2, specTier: 'unverifiable',
      layerMap: {'web-entities': 'apps/web/src/entities', 'web-pages': 'apps/web/src/pages', 'web-shared': 'apps/web/src/shared', api: 'apps/api/src'},
      testLayers: {'web-tests': 'apps/web/tests', 'api-tests': 'apps/api/tests'}}))
    git(lead, 'init', '-q', '-b', 'main'); git(lead, 'config', 'user.name', 'lead'); git(lead, 'config', 'user.email', 'lead@t')
    git(lead, 'add', '-A'); git(lead, 'commit', '-qm', 'init'); git(lead, 'remote', 'add', 'origin', origin); git(lead, 'push', '-q', 'origin', 'main')

    assert.equal((await runClaimWork({root: lead, flags: {}})).phase, 'P1_REVIEW')
    const published = await runWorkPublish({root: lead, flags: {'work-ids': [1, 3, 4, 5].map(W).join(','), confirm: true}, io: {mergedPrs, provider: providerFor(), ticketConfig}})
    assert.equal(published.phase, 'PUBLISHED', JSON.stringify(published.guidance ?? published.errors))
    const keyOf = workId => published.published.find(item => item.workId === workId).ticketKey
    // (1) 역할은 라벨과 보드에 실린다
    assert.deepEqual(jira.issues.get(keyOf(W(1))).fields.labels.filter(label => ['be', 'fe'].includes(label)), ['be'])
    assert.deepEqual(jira.issues.get(keyOf(W(3))).fields.labels.filter(label => ['be', 'fe'].includes(label)), ['fe'])
    checkTeamSharing(lead, {install: true})
    commitSplit(lead, '계획 발행'); git(lead, 'push', '-q', 'origin', 'main')

    const devs = {}
    for (const name of ['be', 'fe', 'third']) {
      devs[name] = join(base, name); git(base, 'clone', '-q', origin, devs[name])
      git(devs[name], 'config', 'user.name', name); git(devs[name], 'config', 'user.email', `${name}@t`)
    }
    const pickup = (name, key, flags = {}) => runWorkPickup({root: devs[name], ticketKey: key, developer: name, flags, io: {mergedPrs, provider: providerFor(), ticketConfig}})
    const board = await runWorkBoard({root: devs.be, developer: 'be', flags: {}, io: {mergedPrs, provider: providerFor(), ticketConfig}})
    assert.deepEqual(board.rows.find(row => row.workId === W(1)).roles, ['be'])
    assert.equal(pickupOutcome(await pickup('be', keyOf(W(1)))), 'started')
    assert.equal(pickupOutcome(await pickup('fe', keyOf(W(3)))), 'started')

    // (2)(3) 범위는 앱 접두 경로, 테스트 레이어는 쓸 수 있고 남의 앱은 막힌다
    assert.deepEqual(readChangeScopeFile(devs.be).ALLOWED_PATHS, ['apps/api/src/members/', 'apps/web/tests/', 'apps/api/tests/'])
    assert.equal(agentWrite(devs.be, 'apps/api/src/members/routes.ts', 'export const memberRoutes = []\n'), true)
    assert.equal(agentWrite(devs.be, 'apps/api/tests/members.test.ts', '// A-1\n'), true, '완료 조건인 테스트를 쓰지 못했다')
    assert.equal(agentWrite(devs.be, 'apps/web/src/entities/member/api.ts', 'x'), false, 'be 범위가 화면 앱에 썼다')
    assert.equal(agentWrite(devs.fe, 'apps/web/src/pages/members/MembersPage.tsx', 'export const MembersPage = null\n'), true)
    assert.equal(agentWrite(devs.fe, 'apps/web/tests/members-page.test.tsx', '// C-1\n'), true)
    assert.equal(agentWrite(devs.fe, 'apps/api/src/members/routes.ts', 'x'), false, 'fe 범위가 API 앱에 썼다')

    // (4) 진행 중인 be 작업과 겹치는 사람 티켓
    const humanKey = jira.humanTicket({summary: '회원 목록 API 정렬 기본값', components: ['DEVELOP'], description: '완료 조건: 정렬 인자가 없으면 가입일 역순'})
    assert.equal(pickupOutcome(await pickup('third', humanKey)), 'assessing')
    const assessment = {schemaVersion: 1, ticket: {key: humanKey, provider: 'jira'}, verdict: 'startable', lane: 'change', objective: '정렬 기본값',
      roles: ['be'], selfCheck: ['new-route', 'new-data-contract', 'new-auth-path', 'new-external-dependency', 'public-contract-change']
        .map(id => ({id, answer: 'no', evidence: ['apps/api/src/server.ts:1']})),
      planningNeeds: [], designNeeds: [], reasons: [], writePaths: ['apps/api/src/members/list.ts'], nonGoals: [], dependsOn: [],
      acceptance: [{text: '정렬 인자가 없으면 가입일 역순', source: 'ticket'}],
      testItems: [{id: `TT-${humanKey}-1`, text: '정렬 인자 없이 호출하면 가입일 역순', source: 'proposed'}]}
    writeFileSync(join(devs.third, assessmentPath(humanKey)), JSON.stringify(assessment))
    const overlapped = await pickup('third', humanKey, {assessment: assessmentDigest(assessment)})
    assert.equal(overlapped.phase, 'TICKET_ASSESSMENT_MISMATCH', '겹침을 보지 않은 확인으로 착수했다')
    const shown = await pickup('third', humanKey)
    assert.ok(shown.review?.overlaps?.length > 0, JSON.stringify(shown))
    assert.equal(readChangeScopeFile(devs.third), null)
    const stray = await runWorkLink({root: devs.third, ticketKey: humanKey, prUrl: 'https://github.com/acme/mono/pull/9', flags: {}, io: {mergedPrs, prInfo: open}})
    assert.equal(stray.blocked, 'work-not-registered')

    // 두 PR이 충돌 없이 머지되고, 기록 없이 완료로 읽힌다
    let pr = 20
    const prs = []
    for (const name of ['be', 'fe']) {
      git(devs[name], 'checkout', '-qb', `feat/${name}`)
      commitSplit(devs[name], `${name} 작업`)
      const prUrl = `https://github.com/acme/mono/pull/${++pr}`
      prs.push([prUrl, keyOf(name === 'be' ? W(1) : W(3))])
      const linked = await runWorkLink({root: devs[name], ticketKey: keyOf(name === 'be' ? W(1) : W(3)), prUrl, flags: {}, io: {mergedPrs, prInfo: open, provider: providerFor()}})
      assert.equal(linked.ok, true, `${name}: ${JSON.stringify(linked.blocked ?? linked.completion)}`)
      commitSplit(devs[name], `${name} 연결`); git(devs[name], 'push', '-q', 'origin', `feat/${name}`)
    }
    git(lead, 'fetch', '-q', 'origin')
    for (const name of ['be', 'fe']) assert.equal(tryGit(lead, 'merge', '--no-ff', '-m', `merge ${name}`, `origin/feat/${name}`), true, `${name} 머지 충돌`)
    for (const [url, key] of prs) mergePr(url, key)
    const done = await runWorkBoard({root: lead, developer: 'lead', flags: {}, io: {mergedPrs, provider: providerFor(), ticketConfig}})
    assert.deepEqual(done.rows.filter(row => row.completed).map(row => row.workId).sort(), [W(1), W(3)].sort(), JSON.stringify(done.notes))
  } finally {
    rmSync(base, {recursive: true, force: true})
  }
})
