#!/usr/bin/env node
// test-team-revision-e2e.mjs — 개발자 5명이 긴 선행 사슬을 따라가는 동안 계획이 두 번 바뀌고, 머지 하나가 되돌려진다.
// 실제 git clone·메모리 Jira.
//
// 고정하는 사실:
//   (1) 받지 않은 계획 개정이 원격에 있으면 link가 막는다 — 받고 다시 집으면 처음 찍은 지문을 이어 연결된다
//   (2) 작업 내용이 바뀐 발행분은 제자리로 고치지 않고, 안내가 그 이유(대체 필요)를 말한다
//   (3) 대체하면 옛 티켓에 「개발하지 말라·이어서 할 티켓」을 한 번 알리고, 옛 작업은 집을 수 없다
//   (4) 머지를 되돌리면 `link --reopen`으로 완료를 거둔다 — 그 작업을 선행으로 둔 작업은 다시 기다리고, 담당자가 다시 집는다
import assert from 'node:assert/strict'
import test from 'node:test'
import {execFileSync} from 'node:child_process'
import {cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createJiraStub} from './ticket/jira-memory-stub.mjs'
import {createJiraProvider} from './ticket/provider-jira-exec.mjs'
import {readChangeScopeFile} from './ticket/cli.mjs'
import {runClaimWork} from './ticket/work-claim.mjs'
import {runWorkPublish} from './ticket/work-publish-run.mjs'
import {pickupOutcome, runWorkPickup} from './ticket/work-pickup-run.mjs'
import {runWorkLink, runWorkMergeSync, runWorkReopen} from './ticket/work-link-run.mjs'
import {runWorkBoard} from './ticket/work-board.mjs'
import {checkTeamSharing} from './validate-development-readiness.mjs'

const repoRoot = new URL('../..', import.meta.url).pathname
const W = n => `WORK-0000000${n}-0000-4000-8000-00000000000${n}`
const W8 = 'WORK-00000008-0000-4000-8000-000000000008'
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
const develop = (dir, name) => {
  const scope = readChangeScopeFile(dir)
  const targets = scope.checks.flatMap(check => check.targetRefs).map(ref => (ref.endsWith('/') ? `${ref}${name}.ts` : ref))
  for (const file of targets) { mkdirSync(join(dir, file, '..'), {recursive: true}); writeFileSync(join(dir, file), `export const by${name} = 1\n`) }
  mkdirSync(join(dir, 'tests'), {recursive: true})
  writeFileSync(join(dir, `tests/${name}.test.ts`), `// ${scope.testCaseIds.join(' ')}\n`)
}

test('계획 개정 두 번과 머지 되돌림: 받지 않은 개정은 link가 막고, 대체는 옛 티켓에 알리고, 되돌림은 reopen으로 거둔다', async () => {
  const base = mkdtempSync(join(tmpdir(), 'wh-team-revision-'))
  const jira = createJiraStub()
  const providerFor = () => createJiraProvider({config: jiraConfig, fetchImpl: jira.fetchImpl, env: {JIRA_TOKEN: 't'}})
  try {
    const origin = join(base, 'origin.git')
    git(base, 'init', '-q', '--bare', '-b', 'main', origin)
    const lead = join(base, 'lead')
    mkdirSync(lead)
    cpSync(join(repoRoot, '.claude/evals/fixtures/work-plan/crud'), lead, {recursive: true})
    writeFileSync(join(lead, '_workspace/03_dev/spec.json'), JSON.stringify({schemaVersion: 2, specTier: 'unverifiable',
      layerMap: {entities: 'src/entities', pages: 'src/pages', shared: 'src/shared'}, testLayers: {unit: 'tests'}}))
    git(lead, 'init', '-q', '-b', 'main'); git(lead, 'config', 'user.name', 'lead'); git(lead, 'config', 'user.email', 'lead@t')
    git(lead, 'add', '-A'); git(lead, 'commit', '-qm', 'init'); git(lead, 'remote', 'add', 'origin', origin); git(lead, 'push', '-q', 'origin', 'main')
    const planPath = join(lead, '_workspace/03_dev/work-plan.json')
    const editPlan = fn => { const plan = JSON.parse(readFileSync(planPath, 'utf8')); fn(plan); writeFileSync(planPath, JSON.stringify(plan, null, 2)) }
    const publish = async (ids, label) => {
      assert.equal((await runClaimWork({root: lead, flags: {}})).phase, 'P1_REVIEW', label)
      const result = await runWorkPublish({root: lead, flags: {'work-ids': ids.join(','), confirm: true}, io: {provider: providerFor(), ticketConfig}})
      commitSplit(lead, label); git(lead, 'push', '-q', 'origin', 'main')
      return result
    }
    const first = await publish([1, 3, 4, 5].map(W), '발행')
    const keys = new Map(first.published.map(item => [item.workId, item.ticketKey]))
    checkTeamSharing(lead, {install: true}); commitSplit(lead, '공유 설정'); git(lead, 'push', '-q', 'origin', 'main')

    const devs = {}
    for (const name of ['A', 'B', 'C', 'D', 'E']) {
      devs[name] = join(base, name); git(base, 'clone', '-q', origin, devs[name])
      git(devs[name], 'config', 'user.name', name); git(devs[name], 'config', 'user.email', `${name}@t`)
    }
    const pickup = (name, workId) => runWorkPickup({root: devs[name], ticketKey: keys.get(workId), developer: name, flags: {}, io: {provider: providerFor(), ticketConfig}})
    const link = (name, workId, pr) => runWorkLink({root: devs[name], ticketKey: keys.get(workId), prUrl: `https://github.com/acme/web/pull/${pr}`, flags: {}, io: {prInfo: open}})
    const mergeAndSync = async (name, branch) => {
      commitSplit(devs[name], `${name} 연결`); git(devs[name], 'push', '-q', 'origin', branch)
      git(lead, 'fetch', '-q', 'origin')
      assert.equal(tryGit(lead, 'merge', '--no-ff', '-m', `merge ${branch}`, `origin/${branch}`), true, `${branch} 머지 충돌`)
      await runWorkMergeSync({root: lead, io: {prStates: merged}})
      commitSplit(lead, `머지 ${branch}`); git(lead, 'push', '-q', 'origin', 'main')
    }
    const pull = name => { git(devs[name], 'checkout', '-q', 'main'); git(devs[name], 'pull', '-q', '--no-rebase', 'origin', 'main') }

    assert.equal(pickupOutcome(await pickup('A', W(1))), 'started')
    assert.equal(pickupOutcome(await pickup('B', W(3))), 'started')
    git(devs.A, 'checkout', '-qb', 'feat/A'); develop(devs.A, 'A'); commitSplit(devs.A, 'A 작업')

    // (1) 개정 1 — 역할 라벨만 바꾼다. A는 받지 않고 연결하려 한다
    editPlan(plan => { plan.workItems.find(work => work.workId === W(4)).roles.push('qa') })
    const revised = await publish([1, 3, 4, 5].map(W), '개정 1')
    assert.equal(revised.phase, 'PUBLISHED')
    assert.ok(jira.issues.get(keys.get(W(4))).fields.labels.includes('qa'))
    const behind = await link('A', W(1), 11)
    assert.equal(behind.blocked, 'plan-behind-remote', JSON.stringify(behind))
    git(devs.A, 'pull', '-q', '--no-rebase', 'origin', 'main')
    assert.equal(pickupOutcome(await pickup('A', W(1))), 'started')
    const relinked = await link('A', W(1), 11)
    assert.equal(relinked.ok, true, `다시 집은 뒤 한 일이 사라졌다: ${JSON.stringify(relinked.blocked ?? relinked.completion)}`)
    await mergeAndSync('A', 'feat/A')
    pull('B'); assert.equal(pickupOutcome(await pickup('B', W(3))), 'started')
    git(devs.B, 'checkout', '-qb', 'feat/B'); develop(devs.B, 'B'); commitSplit(devs.B, 'B 작업')
    assert.equal((await link('B', W(3), 12)).ok, true)
    await mergeAndSync('B', 'feat/B')
    pull('C'); assert.equal(pickupOutcome(await pickup('C', W(4))), 'started')
    pull('D'); assert.equal((await pickup('D', W(4))).bounce?.reason, 'assigned-to-other')

    // (2) 개정 2 — 발행한 W5의 목표를 제자리로 바꾸면 거부되고, 안내가 대체를 말한다
    editPlan(plan => { plan.workItems.find(work => work.workId === W(5)).objective = '이름·이메일로 목록을 좁힌다' })
    const inPlace = await publish([1, 3, 4, 5].map(W), '개정 2 제자리')
    assert.equal(inPlace.phase, 'PUBLISHED_WITH_PENDING')
    assert.match(inPlace.guidance, /superseded/, '보류 안내가 실제 이유를 말하지 않는다')
    // (3) 대체 — W5 → W8
    editPlan(plan => {
      const old = plan.workItems.find(work => work.workId === W(5))
      old.objective = '이름으로 목록을 좁힌다(검색 조건은 URL 소유)'
      const next = {...structuredClone(old), workId: W8, title: '검색·필터(이메일 포함)', objective: '이름·이메일로 목록을 좁힌다'}
      old.lifecycle = 'superseded'; old.supersededBy = [W8]
      plan.workItems.push(next)
      for (const binding of plan.featureBindings) {
        binding.requiredWorkIds = binding.requiredWorkIds.map(id => (id === W(5) ? W8 : id))
        for (const owner of binding.acceptanceOwners) if (owner.workId === W(5)) owner.workId = W8
      }
      for (const work of plan.workItems) if (work.workId !== W8) work.dependsOn = work.dependsOn.map(id => (id === W(5) ? W8 : id))
    })
    const replaced = await publish([W(1), W(3), W(4), W8], '개정 2 대체')
    assert.equal(replaced.phase, 'PUBLISHED', JSON.stringify(replaced.pending))
    const newKey = replaced.published.find(item => item.workId === W8).ticketKey
    keys.set(W8, newKey)
    assert.deepEqual(replaced.retired, [{workId: W(5), ticketKey: keys.get(W(5)), replacedBy: [newKey]}])
    const notices = (jira.issues.get(keys.get(W(5))).fields.comment?.comments ?? []).map(comment => comment.body)
    assert.equal(notices.filter(body => body.includes(newKey) && body.includes('개발하지 마세요')).length, 1)
    assert.deepEqual((await publish([W(1), W(3), W(4), W8], '다시 발행')).retired, [], '같은 알림을 두 번 남겼다')
    pull('E')
    assert.equal((await pickup('E', W(5))).bounce?.reason, 'work-cancelled')

    // (4) W1 머지를 되돌린다 — 원장은 모른다. reopen으로 완료를 거둔다
    const w1Merge = git(lead, 'log', '--merges', '--format=%H %s').split('\n').find(line => line.endsWith('merge feat/A')).split(' ')[0]
    assert.equal(tryGit(lead, 'revert', '-m', '1', '--no-edit', w1Merge), true)
    const noReason = await runWorkReopen({root: lead, ticketKey: keys.get(W(1)), flags: {}})
    assert.equal(noReason.blocked, 'reason-required')
    const reopened = await runWorkReopen({root: lead, ticketKey: keys.get(W(1)), flags: {reason: '회원 API 계약 오류로 되돌림'}})
    assert.equal(reopened.ok, true)
    assert.ok(reopened.affected.some(item => item.workId === W(4)), '이 작업을 선행으로 둔 작업을 알리지 않았다')
    commitSplit(lead, 'W1 되돌림'); git(lead, 'push', '-q', 'origin', 'main')
    pull('D')
    const board = await runWorkBoard({root: devs.D, developer: 'D', flags: {}, io: {provider: providerFor(), ticketConfig}})
    assert.equal(board.rows.find(row => row.workId === W(1)).completed, false)
    assert.equal(board.rows.find(row => row.workId === W8).blockedReason, 'dependency-incomplete', '되돌린 작업 위의 사슬이 열려 있다')
    pull('A')
    assert.equal(pickupOutcome(await runWorkPickup({root: devs.A, ticketKey: keys.get(W(1)), developer: 'A', flags: {}, io: {provider: providerFor(), ticketConfig}})), 'started')
  } finally {
    rmSync(base, {recursive: true, force: true})
  }
})
