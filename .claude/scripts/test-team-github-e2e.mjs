#!/usr/bin/env node
// test-team-github-e2e.mjs — 3인 팀이 **GitHub Issues**를 트래커로 쓸 때. 실제 git clone, 메모리 GitHub(`gh` 대역),
// 대상 프로젝트 CI에서 도는 자동 닫기 v3 스크립트를 **실제 프로세스로** 돌린다.
//
// Jira와 다른 곳만 고정한다:
//   (1) 배정이 덧붙이기다 — 동시에 집어도 둘이 「내 배정」으로 남지 않는다(남을 본 쪽이 물러난다)
//   (2) PR 본문의 닫는 줄은 `Closes #N`이다 — 계획 작업도 사람 티켓(라벨 축)도
//   (3) 머지마다 자동 닫기 v3가 원장 결속만 근거로 그 PR의 이슈를 닫고, 다시 돌아도 한 번만 닫는다
import assert from 'node:assert/strict'
import test from 'node:test'
import {execFileSync} from 'node:child_process'
import {chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'
import {createGithubStub} from './ticket/github-memory-stub.mjs'
import {createGithubProvider} from './ticket/provider-github-exec.mjs'
import {installTicketCloseAssets, planTicketCloseInstall, readChangeScopeFile} from './ticket/cli.mjs'
import {runClaimWork} from './ticket/work-claim.mjs'
import {runWorkPublish} from './ticket/work-publish-run.mjs'
import {pickupOutcome, runWorkPickup} from './ticket/work-pickup-run.mjs'
import {runWorkLink, runWorkMergeSync} from './ticket/work-link-run.mjs'
import {runWorkBoard} from './ticket/work-board.mjs'
import {assessmentDigest, assessmentPath} from './ticket/ticket-work.mjs'
import {checkTeamSharing} from './validate-development-readiness.mjs'

const repoRoot = new URL('../..', import.meta.url).pathname
const stubPath = fileURLToPath(new URL('./ticket/github-memory-stub.mjs', import.meta.url))
const W = n => `WORK-0000000${n}-0000-4000-8000-00000000000${n}`
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim()
const tryGit = (cwd, ...args) => { try { git(cwd, ...args); return true } catch { return false } }
const ticketConfig = {provider: 'github', github: {labelAxis: {dev: '개발 티켓'}, workLink: {mode: 'link-only'}}}
const merged = async urls => new Map(urls.map(url => [url, {state: 'MERGED', baseRefName: 'main'}]))
const open = async () => ({state: 'OPEN', baseRefName: 'main'})
const commitSplit = (dir, message) => {
  git(dir, 'add', '-A', '--', '.', ':(exclude)_workspace')
  if (!tryGit(dir, 'diff', '--cached', '--quiet')) git(dir, 'commit', '-qm', `code: ${message}`)
  git(dir, 'add', '-A', '--', '_workspace')
  if (!tryGit(dir, 'diff', '--cached', '--quiet')) git(dir, 'commit', '-qm', `harness: ${message}`)
}
const develop = (dir, name) => {
  const scope = readChangeScopeFile(dir) ?? {}
  const targets = (scope.checks ?? []).flatMap(check => check.targetRefs ?? []).filter(ref => !ref.endsWith('/'))
  for (const ref of (scope.ALLOWED_PATHS ?? []).filter(ref => ref.endsWith('/'))) targets.push(`${ref}${name}.ts`)
  for (const file of new Set(targets)) { mkdirSync(join(dir, file, '..'), {recursive: true}); writeFileSync(join(dir, file), `export const by${name} = true\n`) }
  mkdirSync(join(dir, 'tests'), {recursive: true})
  writeFileSync(join(dir, `tests/${name}.test.ts`), `// ${(scope.testCaseIds ?? []).join(' ')}\n`)
}

test('GitHub 팀 흐름: 동시 배정 정리 → Closes #N → 머지마다 자동 닫기 v3가 그 이슈만 한 번 닫는다', async () => {
  const base = mkdtempSync(join(tmpdir(), 'wh-team-github-'))
  const stateFile = join(base, 'gh-state.json')
  const gh = createGithubStub({stateFile})
  const bin = join(base, 'bin')
  mkdirSync(bin)
  writeFileSync(join(bin, 'gh'), `#!/bin/sh\nexec "${process.execPath}" "${stubPath}" "$@"\n`)
  chmodSync(join(bin, 'gh'), 0o755)
  // 두 배정 호출이 모두 도착할 때까지 붙잡는다 — 둘 다 「비어 있음」을 본 뒤 배정하는 최악의 순서.
  let parked = []
  const racing = async (args, options) => {
    if (args.includes('--add-assignee')) await new Promise(resolve => { parked.push(resolve); if (parked.length === 2) { parked.forEach(go => go()); parked = [] } })
    return gh.exec(args, options)
  }
  const providerFor = (exec = gh.exec) => createGithubProvider({repo: 'acme/web', exec})
  try {
    const origin = join(base, 'origin.git')
    git(base, 'init', '-q', '--bare', '-b', 'main', origin)
    const lead = join(base, 'lead')
    mkdirSync(lead)
    cpSync(join(repoRoot, '.claude/evals/fixtures/work-plan/crud'), lead, {recursive: true})
    writeFileSync(join(lead, '_workspace/03_dev/spec.json'), JSON.stringify({schemaVersion: 2, specTier: 'unverifiable',
      layerMap: {entities: 'src/entities', pages: 'src/pages', shared: 'src/shared', tests: 'tests'}}))
    git(lead, 'init', '-q', '-b', 'main'); git(lead, 'config', 'user.name', 'lead'); git(lead, 'config', 'user.email', 'lead@t')
    git(lead, 'add', '-A'); git(lead, 'commit', '-qm', 'init'); git(lead, 'remote', 'add', 'origin', origin); git(lead, 'push', '-q', 'origin', 'main')

    await runClaimWork({root: lead, flags: {}})
    const published = await runWorkPublish({root: lead, flags: {'work-ids': [1, 3, 4, 5].map(W).join(','), confirm: true}, io: {provider: providerFor(), ticketConfig}})
    assert.equal(published.phase, 'PUBLISHED', JSON.stringify(published.guidance ?? published.errors))
    const keyOf = workId => published.published.find(item => item.workId === workId).ticketKey
    assert.equal(checkTeamSharing(lead, {install: true}).state, 'PASS')
    installTicketCloseAssets(lead, planTicketCloseInstall(lead))
    commitSplit(lead, '계획 발행'); git(lead, 'push', '-q', 'origin', 'main')

    const devs = {}
    for (const name of ['A', 'B', 'C']) {
      devs[name] = join(base, name); git(base, 'clone', '-q', origin, devs[name])
      git(devs[name], 'config', 'user.name', name); git(devs[name], 'config', 'user.email', `${name}@t`)
    }
    const pickup = (name, key, flags = {}, exec) => runWorkPickup({root: devs[name], ticketKey: key, developer: name, flags, io: {provider: providerFor(exec), ticketConfig}})

    // (1) 둘 다 비어 있음을 보고 배정한다 — 둘 다 물러나고 배정이 비워진다. 그 뒤 먼저 집은 한 사람만 시작한다.
    const w1 = keyOf(W(1))
    const race = await Promise.all([pickup('A', w1, {}, racing), pickup('B', w1, {}, racing)])
    assert.deepEqual(race.map(pickupOutcome), ['stopped', 'stopped'], JSON.stringify(race.map(item => item.bounce)))
    assert.deepEqual(gh.issue(w1).assignees, [], '물러나면서 배정을 남겼다 — 둘 다 「내 배정」으로 읽힌다')
    assert.equal(readChangeScopeFile(devs.A), null)
    assert.equal(pickupOutcome(await pickup('A', w1)), 'started')
    assert.equal((await pickup('B', w1)).bounce?.reason, 'assigned-to-other')
    const boardB = await runWorkBoard({root: devs.B, developer: 'B', flags: {}, io: {provider: providerFor(), ticketConfig}})
    assert.equal(boardB.ready.includes(W(1)), false, '남이 시작한 작업을 집을 수 있다고 보였다')
    assert.equal(pickupOutcome(await pickup('B', keyOf(W(3)))), 'started')

    // C: 라벨로 분류된 사람 티켓
    const humanKey = gh.humanIssue({title: '표 빈 상태 문구', labels: ['dev'],
      body: '데이터가 없을 때 표에 아무것도 안 보입니다.\n\n완료 조건: 데이터가 없으면 "표시할 항목이 없습니다"가 보인다'})
    const boardC = await runWorkBoard({root: devs.C, developer: 'C', flags: {}, io: {provider: providerFor(), ticketConfig}})
    assert.equal(boardC.tickets.find(row => row.ticketKey === humanKey)?.stage, 'unassessed')
    assert.equal(pickupOutcome(await pickup('C', humanKey)), 'assessing')
    const assessment = {schemaVersion: 1, ticket: {key: humanKey, provider: 'github'}, verdict: 'startable', lane: 'change', objective: '빈 상태 문구',
      roles: ['fe'], selfCheck: ['new-route', 'new-data-contract', 'new-auth-path', 'new-external-dependency', 'public-contract-change']
        .map(id => ({id, answer: 'no', evidence: ['src/shared/ui/DataTable.tsx:1']})),
      planningNeeds: [], designNeeds: [], reasons: [], writePaths: ['src/shared/ui/'], nonGoals: [], dependsOn: [],
      acceptance: [{text: '데이터가 없으면 "표시할 항목이 없습니다"가 보인다', source: 'ticket'}],
      testItems: [{id: `TT-${humanKey}-1`, text: '빈 목록이면 빈 상태 문구', source: 'proposed'}]}
    writeFileSync(join(devs.C, assessmentPath(humanKey)), JSON.stringify(assessment))
    assert.equal(pickupOutcome(await pickup('C', humanKey, {assessment: assessmentDigest(assessment)})), 'started')

    // (2) 각자 PR — 닫는 줄은 Closes #N
    const work = {A: w1, B: keyOf(W(3)), C: humanKey}
    const prOf = {}
    let pr = 10
    for (const name of ['A', 'B', 'C']) {
      git(devs[name], 'checkout', '-qb', `feat/${name}`)
      develop(devs[name], name)
      commitSplit(devs[name], `${name} 작업`)
      prOf[name] = `https://github.com/acme/web/pull/${++pr}`
      const linked = await runWorkLink({root: devs[name], ticketKey: work[name], prUrl: prOf[name], flags: {}, io: {prInfo: open}})
      assert.equal(linked.ok, true, `${name}: ${JSON.stringify(linked.blocked ?? linked.completion)}`)
      assert.equal(linked.closeLine, `Closes #${work[name]}`)
      commitSplit(devs[name], `${name} 연결`); git(devs[name], 'push', '-q', 'origin', `feat/${name}`)
    }

    // (3) 머지마다 ticket-close.yml이 하는 일 — 머지된 트리에서 v3 스크립트를 실제 프로세스로 돈다
    const closeRun = name => execFileSync(process.execPath, ['.github/scripts/close-merged-tickets.mjs'], {cwd: lead, encoding: 'utf8',
      env: {...process.env, PATH: `${bin}:${process.env.PATH}`, GH_STUB_STATE: stateFile, TICKET_REPO: 'acme/web', TICKET_PR_URL: prOf[name], TICKET_BASE_REF: 'main'}})
    git(lead, 'fetch', '-q', 'origin')
    for (const name of ['A', 'B', 'C']) {
      assert.equal(tryGit(lead, 'merge', '--no-ff', '-m', `merge ${name}`, `origin/feat/${name}`), true, `${name} 머지 충돌`)
      assert.match(closeRun(name), /done: 1\/1 closed/, `${name}의 이슈를 닫지 않았다`)
      assert.equal(gh.issue(work[name]).state, 'CLOSED')
    }
    assert.match(closeRun('A'), /이미 CLOSED/, '다시 돌면 한 번 더 닫으려 했다')
    assert.deepEqual([keyOf(W(4)), keyOf(W(5))].map(key => gh.issue(key).state), ['OPEN', 'OPEN'], '머지되지 않은 작업의 이슈를 닫았다')

    assert.equal((await runWorkMergeSync({root: lead, io: {prStates: merged}})).completed.length, 3)
    commitSplit(lead, '머지 관측'); git(lead, 'push', '-q', 'origin', 'main')
    git(devs.C, 'checkout', '-q', 'main'); git(devs.C, 'pull', '-q', '--no-rebase', 'origin', 'main')
    const next = await runWorkBoard({root: devs.C, developer: 'C', flags: {}, io: {provider: providerFor(), ticketConfig}})
    assert.deepEqual(next.ready, [W(4)])
    assert.equal(pickupOutcome(await pickup('C', keyOf(W(4)))), 'started')
  } finally {
    rmSync(base, {recursive: true, force: true})
  }
})
