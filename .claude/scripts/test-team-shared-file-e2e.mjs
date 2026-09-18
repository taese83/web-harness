#!/usr/bin/env node
// test-team-shared-file-e2e.mjs — 여러 작업이 같은 파일(라우트 등록부·package.json)을 건드릴 때. 실제 git clone·메모리 Jira.
//
// 고정하는 사실:
//   (1) 순서 없는 두 작업이 같은 경로를 선언하면 계획 검증(claim)이 막는다(T08)
//   (2) 순서를 주면 뒤 작업은 앞 작업이 머지되기 전에 집을 수 없고, 머지 뒤에는 앞 작업의 코드 위에서 시작해 충돌하지 않는다
//   (3) 선언하지 않은 공유 파일을 병렬 작업이 손으로 고치면 `link`가 범위 밖 파일로 알리고, 충돌은 그 파일에서만 난다
import assert from 'node:assert/strict'
import test from 'node:test'
import {execFileSync} from 'node:child_process'
import {cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createJiraStub} from './ticket/jira-memory-stub.mjs'
import {createJiraProvider} from './ticket/provider-jira-exec.mjs'
import {runClaimWork} from './ticket/work-claim.mjs'
import {runWorkPublish} from './ticket/work-publish-run.mjs'
import {pickupOutcome, runWorkPickup} from './ticket/work-pickup-run.mjs'
import {runWorkLink, runWorkMergeSync} from './ticket/work-link-run.mjs'
import {checkTeamSharing} from './validate-development-readiness.mjs'

const repoRoot = new URL('../..', import.meta.url).pathname
const W = n => `WORK-0000000${n}-0000-4000-8000-00000000000${n}`
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim()
const tryGit = (cwd, ...args) => { try { git(cwd, ...args); return true } catch { return false } }
const jiraConfig = {baseUrl: 'https://jira.test', projectKey: 'PF', issueType: 'Task', apiVersion: '2', assigneeField: 'name',
  transitions: {'in-progress': '31', done: '41'}, workLink: {mode: 'issue-link', linkType: 'Relates'}, componentAxis: {PLAN: '기획 입력', DEVELOP: '개발 티켓'}}
const ticketConfig = {provider: 'jira', jira: jiraConfig}
const merged = async urls => new Map(urls.map(url => [url, {state: 'MERGED', baseRefName: 'main'}]))
const open = async () => ({state: 'OPEN', baseRefName: 'main'})
const commitSplit = (dir, message) => {
  git(dir, 'add', '-A', '--', '.', ':(exclude)_workspace')
  if (!tryGit(dir, 'diff', '--cached', '--quiet')) git(dir, 'commit', '-qm', `code: ${message}`)
  git(dir, 'add', '-A', '--', '_workspace')
  if (!tryGit(dir, 'diff', '--cached', '--quiet')) git(dir, 'commit', '-qm', `harness: ${message}`)
}
const write = (dir, file, text) => { mkdirSync(join(dir, file, '..'), {recursive: true}); writeFileSync(join(dir, file), text) }
const pkg = deps => `{\n  "name": "web",\n  "dependencies": {\n${deps.map(dep => `    "${dep}": "1"`).join(',\n')}\n  }\n}\n`

/** 리드 저장소 — 계획을 고쳐 claim까지. */
function leadWith(base, mutate) {
  const lead = join(base, 'lead')
  mkdirSync(lead)
  cpSync(join(repoRoot, '.claude/evals/fixtures/work-plan/crud'), lead, {recursive: true})
  writeFileSync(join(lead, '_workspace/03_dev/spec.json'), JSON.stringify({schemaVersion: 2, specTier: 'unverifiable',
    layerMap: {app: 'src/app', entities: 'src/entities', pages: 'src/pages', shared: 'src/shared'}, testLayers: {unit: 'tests'}}))
  write(lead, 'src/app/routes.ts', 'export const routes = [\n]\n')
  write(lead, 'package.json', pkg(['react']))
  const planPath = join(lead, '_workspace/03_dev/work-plan.json')
  const plan = JSON.parse(readFileSync(planPath, 'utf8'))
  mutate(plan.workItems)
  writeFileSync(planPath, JSON.stringify(plan, null, 2))
  return lead
}

test('같은 파일: 순서 없는 공유 선언은 계획에서 막고, 순서가 있으면 충돌 없이, 선언 밖 손 편집은 link가 알린다', async () => {
  const base = mkdtempSync(join(tmpdir(), 'wh-team-shared-'))
  try {
    // (1) 병렬 두 작업이 같은 등록부를 선언
    const parallel = leadWith(join(base), items => {
      for (const id of [W(1), W(3)]) items.find(item => item.workId === id).writePaths.push('src/app/routes.ts')
    })
    const refused = await runClaimWork({root: parallel, flags: {}})
    assert.equal(refused.phase, 'P1_PLAN_INVALID')
    assert.match(JSON.stringify(refused.errors), /T08/)
    rmSync(parallel, {recursive: true, force: true})

    // (2) 순서를 준 등록부 공유 — W3는 W1 뒤
    const lead = leadWith(base, items => {
      items.find(item => item.workId === W(1)).writePaths.push('src/app/routes.ts')
      const page = items.find(item => item.workId === W(3))
      page.writePaths.push('src/app/routes.ts')
      page.dependsOn = [W(1)]
    })
    assert.equal((await runClaimWork({root: lead, flags: {}})).phase, 'P1_REVIEW')
    const jira = createJiraStub()
    const providerFor = () => createJiraProvider({config: jiraConfig, fetchImpl: jira.fetchImpl, env: {JIRA_TOKEN: 't'}})
    const published = await runWorkPublish({root: lead, flags: {'work-ids': [1, 3, 4, 5].map(W).join(','), confirm: true}, io: {provider: providerFor(), ticketConfig}})
    assert.equal(published.phase, 'PUBLISHED')
    const keyOf = workId => published.published.find(item => item.workId === workId).ticketKey
    checkTeamSharing(lead, {install: true})
    const origin = join(base, 'origin.git')
    git(base, 'init', '-q', '--bare', '-b', 'main', origin)
    git(lead, 'init', '-q', '-b', 'main'); git(lead, 'config', 'user.name', 'lead'); git(lead, 'config', 'user.email', 'lead@t')
    git(lead, 'add', '-A'); git(lead, 'commit', '-qm', 'init'); git(lead, 'remote', 'add', 'origin', origin); git(lead, 'push', '-q', 'origin', 'main')
    const devs = {}
    for (const name of ['A', 'B']) {
      devs[name] = join(base, name); git(base, 'clone', '-q', origin, devs[name])
      git(devs[name], 'config', 'user.name', name); git(devs[name], 'config', 'user.email', `${name}@t`)
    }
    const pickup = (name, key) => runWorkPickup({root: devs[name], ticketKey: key, developer: name, flags: {}, io: {provider: providerFor(), ticketConfig}})
    assert.equal(pickupOutcome(await pickup('A', keyOf(W(1)))), 'started')
    assert.equal((await pickup('B', keyOf(W(3)))).bounce?.reason, 'dependency-incomplete', '앞 작업이 머지되기 전에 같은 등록부를 집었다')

    git(devs.A, 'checkout', '-qb', 'feat/A')
    write(devs.A, 'src/app/routes.ts', "export const routes = [\n  {path: '/api/members'},\n]\n")
    write(devs.A, 'src/entities/member/api.ts', 'export const MemberApi = {}\n')
    write(devs.A, 'tests/member-api.test.ts', '// A-1\n')
    commitSplit(devs.A, 'A')
    const linkedA = await runWorkLink({root: devs.A, ticketKey: keyOf(W(1)), prUrl: 'https://github.com/acme/web/pull/1', flags: {}, io: {prInfo: open}})
    assert.equal(linkedA.ok, true, JSON.stringify(linkedA.blocked ?? linkedA.completion))
    assert.deepEqual(linkedA.scopeDrift, {checked: true, outside: []}, '선언한 등록부·테스트를 범위 밖으로 읽었다')
    commitSplit(devs.A, 'A 연결'); git(devs.A, 'push', '-q', 'origin', 'feat/A')
    git(lead, 'fetch', '-q', 'origin')
    assert.equal(tryGit(lead, 'merge', '--no-ff', '-m', 'merge A', 'origin/feat/A'), true)
    await runWorkMergeSync({root: lead, io: {prStates: merged}})
    commitSplit(lead, '머지 관측'); git(lead, 'push', '-q', 'origin', 'main')

    git(devs.B, 'pull', '-q', '--no-rebase', 'origin', 'main')
    assert.equal(pickupOutcome(await pickup('B', keyOf(W(3)))), 'started')
    git(devs.B, 'checkout', '-qb', 'feat/B')
    const routes = readFileSync(join(devs.B, 'src/app/routes.ts'), 'utf8')
    assert.match(routes, /\/api\/members/, '앞 작업의 등록부 위에서 시작하지 않았다')
    write(devs.B, 'src/app/routes.ts', routes.replace(']\n', "  {path: '/members'},\n]\n"))
    write(devs.B, 'src/pages/members/MembersPage.tsx', 'export const MembersPage = null\n')
    write(devs.B, 'tests/members-page.test.ts', '// C-1\n')
    commitSplit(devs.B, 'B')
    assert.equal((await runWorkLink({root: devs.B, ticketKey: keyOf(W(3)), prUrl: 'https://github.com/acme/web/pull/2', flags: {}, io: {prInfo: open}})).ok, true)
    commitSplit(devs.B, 'B 연결'); git(devs.B, 'push', '-q', 'origin', 'feat/B')
    git(lead, 'fetch', '-q', 'origin')
    assert.equal(tryGit(lead, 'merge', '--no-ff', '-m', 'merge B', 'origin/feat/B'), true, '순서가 있는 등록부 공유가 충돌했다')
    await runWorkMergeSync({root: lead, io: {prStates: merged}})
    commitSplit(lead, '머지 관측 2'); git(lead, 'push', '-q', 'origin', 'main')

    // (3) 선언하지 않은 package.json — A는 다음 작업(W4)에서, B는 다른 브랜치에서 같은 때 손으로 고친다
    for (const name of ['A', 'B']) { git(devs[name], 'checkout', '-q', 'main'); git(devs[name], 'pull', '-q', '--no-rebase', 'origin', 'main') }
    assert.equal(pickupOutcome(await pickup('A', keyOf(W(4)))), 'started')
    const drift = {}
    for (const [name, dep] of [['A', 'zod'], ['B', 'dayjs']]) {
      git(devs[name], 'checkout', '-qb', `deps/${name}`)
      write(devs[name], 'package.json', pkg(['react', dep]))
      if (name === 'A') { write(devs.A, 'src/pages/members/list/List.tsx', 'export const List = null\n'); write(devs.A, 'tests/list.test.ts', '// TC-001-1 TC-001-2 TC-001-3\n') }
      commitSplit(devs[name], `${name} deps`)
      git(devs[name], 'push', '-q', 'origin', `deps/${name}`)
    }
    drift.A = (await runWorkLink({root: devs.A, ticketKey: keyOf(W(4)), prUrl: 'https://github.com/acme/web/pull/3', flags: {'dry-run': true}, io: {prInfo: open}})).scopeDrift
    assert.deepEqual(drift.A?.outside, ['package.json'], JSON.stringify(drift.A))
    assert.match(drift.A.guidance, /package\.json/)
    git(lead, 'fetch', '-q', 'origin')
    assert.equal(tryGit(lead, 'merge', '--no-ff', '-m', 'deps A', 'origin/deps/A'), true)
    assert.equal(tryGit(lead, 'merge', '--no-ff', '-m', 'deps B', 'origin/deps/B'), false, '두 손 편집이 충돌하지 않았다 — 시나리오가 성립하지 않는다')
    assert.equal(git(lead, 'diff', '--name-only', '--diff-filter=U'), 'package.json', '알린 파일 밖에서 충돌했다')
  } finally {
    rmSync(base, {recursive: true, force: true})
  }
})
