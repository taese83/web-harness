#!/usr/bin/env node
// test-team-e2e.mjs — 리드 1명과 개발자 3명이 **같은 원격 저장소와 같은 Jira**를 쓰는 흐름을 실제 git과 실제 CLI 코드로 돈다.
//
// 한 사람씩 도는 e2e는 사람 사이에서만 생기는 결함을 보지 못한다. 여기서 고정하는 사실:
//   (1) 같은 티켓을 동시에 집으면 한 사람만 착수하고 나머지는 「다른 사람 배정」으로 멈춘다
//   (2) 개발 준비 검사 --fix가 원장 병합 규칙(merge=union)과 로컬 작업 파일 제외를 넣는다 — 그러면 PR 셋이 충돌 없이 머지된다
//   (3) 연결·완료된 작업의 범위는 다음 픽업을 막지 않는다
//   (4) 같은 머지를 여러 사람이 각자 확인해 올려도 원장이 깨지지 않는다(보호된 main)
//   (5) 보드는 머지로 끝난 작업과 남이 맡은 사람 티켓을 「집을 수 있음」으로 보이지 않고, 픽업도 판정 전에 멈춘다
import assert from 'node:assert/strict'
import test from 'node:test'
import {execFileSync} from 'node:child_process'
import {cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createJiraStub} from './ticket/jira-memory-stub.mjs'
import {createJiraProvider} from './ticket/provider-jira-exec.mjs'
import {runClaimWork} from './ticket/work-claim.mjs'
import {runWorkPublish} from './ticket/work-publish-run.mjs'
import {pickupOutcome, runWorkPickup} from './ticket/work-pickup-run.mjs'
import {runWorkLink, runWorkMergeSync} from './ticket/work-link-run.mjs'
import {runWorkBoard} from './ticket/work-board.mjs'
import {assessmentDigest, assessmentPath, assessmentSnapshotPath} from './ticket/ticket-work.mjs'
import {readChangeScopeFile} from './ticket/cli.mjs'
import {foldWorkState, readWorkEvents, WORK_EVENTS_PATH} from './ticket/work-events.mjs'
import {checkTeamSharing} from './validate-development-readiness.mjs'

const repoRoot = new URL('../..', import.meta.url).pathname
const W = n => `WORK-0000000${n}-0000-4000-8000-00000000000${n}`
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim()
const tryGit = (cwd, ...args) => { try { git(cwd, ...args); return true } catch { return false } }
const jiraConfig = {baseUrl: 'https://jira.test', projectKey: 'PF', issueType: 'Task', apiVersion: '2', assigneeField: 'name',
  transitions: {'in-progress': '31', done: '41'}, workLink: {mode: 'issue-link', linkType: 'Relates'},
  componentAxis: {PLAN: '기획 입력', DEVELOP: '개발 티켓'}}
const ticketConfig = {provider: 'jira', jira: jiraConfig}
const merged = async urls => new Map(urls.map(url => [url, {state: 'MERGED', baseRefName: 'main'}]))
const open = async () => ({state: 'OPEN', baseRefName: 'main'})

/** 하네스 컨벤션대로 코드와 하네스 산출물을 따로 커밋한다. */
const commitSplit = (dir, message) => {
  git(dir, 'add', '-A', '--', '.', ':(exclude)_workspace')
  if (!tryGit(dir, 'diff', '--cached', '--quiet')) git(dir, 'commit', '-qm', `code: ${message}`)
  git(dir, 'add', '-A', '--', '_workspace')
  if (!tryGit(dir, 'diff', '--cached', '--quiet')) git(dir, 'commit', '-qm', `harness: ${message}`)
}
/** 개발자가 완료 조건의 대상 파일을 고치고 자기 TC·TT를 인용하는 테스트를 쓴다. */
const develop = (dir, name) => {
  const scope = readChangeScopeFile(dir) ?? {}
  const targets = (scope.checks ?? []).flatMap(check => check.targetRefs ?? []).filter(ref => !ref.endsWith('/'))
  for (const ref of (scope.ALLOWED_PATHS ?? []).filter(ref => ref.endsWith('/'))) targets.push(`${ref}${name}.ts`)
  for (const file of new Set(targets)) { mkdirSync(join(dir, file, '..'), {recursive: true}); writeFileSync(join(dir, file), `export const by${name} = true\n`) }
  mkdirSync(join(dir, 'tests'), {recursive: true})
  writeFileSync(join(dir, `tests/${name}.test.ts`), `// ${(scope.testCaseIds ?? []).join(' ')}\n`)
}

test('팀 흐름: 리드 1 + 개발자 3이 같은 저장소·같은 Jira로 발행→동시 픽업→개발→PR 셋 머지→완료→다음 작업까지 막힘 없이 간다', async () => {
  const base = mkdtempSync(join(tmpdir(), 'wh-team-e2e-'))
  const jira = createJiraStub()
  const providerFor = () => createJiraProvider({config: jiraConfig, fetchImpl: jira.fetchImpl, env: {JIRA_TOKEN: 't'}})
  try {
    // ── 원격과 리드 ──
    const origin = join(base, 'origin.git')
    git(base, 'init', '-q', '--bare', '-b', 'main', origin)
    const lead = join(base, 'lead')
    mkdirSync(lead)
    cpSync(join(repoRoot, '.claude/evals/fixtures/work-plan/crud'), lead, {recursive: true})
    writeFileSync(join(lead, '_workspace/03_dev/spec.json'), JSON.stringify({schemaVersion: 2, specTier: 'unverifiable',
      layerMap: {entities: 'src/entities', pages: 'src/pages', shared: 'src/shared', tests: 'tests'}}))
    git(lead, 'init', '-q', '-b', 'main'); git(lead, 'config', 'user.name', 'lead'); git(lead, 'config', 'user.email', 'lead@t')
    git(lead, 'add', '-A'); git(lead, 'commit', '-qm', 'init'); git(lead, 'remote', 'add', 'origin', origin); git(lead, 'push', '-q', 'origin', 'main')

    assert.equal((await runClaimWork({root: lead, flags: {}})).phase, 'P1_REVIEW')
    const published = await runWorkPublish({root: lead, flags: {'work-ids': [1, 3, 4, 5].map(W).join(','), confirm: true}, io: {provider: providerFor(), ticketConfig}})
    assert.equal(published.phase, 'PUBLISHED', JSON.stringify(published))
    const keyOf = workId => published.published.find(item => item.workId === workId).ticketKey
    // (2) 여러 사람이 쓰기 전에 공유 설정을 넣는다
    assert.equal(checkTeamSharing(lead).state, 'FAIL', '공유 설정이 없는데 통과했다')
    assert.equal(checkTeamSharing(lead, {install: true}).state, 'PASS')
    commitSplit(lead, '계획 발행'); git(lead, 'push', '-q', 'origin', 'main')

    // ── 개발자 셋 ──
    const devs = {}, providers = {}
    for (const name of ['A', 'B', 'C']) {
      devs[name] = join(base, name); git(base, 'clone', '-q', origin, devs[name])
      git(devs[name], 'config', 'user.name', name); git(devs[name], 'config', 'user.email', `${name}@t`)
      providers[name] = providerFor()
    }
    const pickup = (name, ticketKey, flags = {}) => runWorkPickup({root: devs[name], ticketKey, developer: name, flags, io: {provider: providers[name], ticketConfig}})

    // (1) A와 B가 같은 W1을 동시에 집는다 — 한 사람만 착수한다
    const race = await Promise.all([pickup('A', keyOf(W(1))), pickup('B', keyOf(W(1)))])
    const outcomes = race.map(pickupOutcome)
    assert.deepEqual([...outcomes].sort(), ['started', 'stopped'], JSON.stringify(race.map(item => item.bounce)))
    const winner = outcomes[0] === 'started' ? 'A' : 'B'
    const loser = winner === 'A' ? 'B' : 'A'
    assert.equal(race[outcomes.indexOf('stopped')].bounce.reason, 'assigned-to-other')
    assert.equal(jira.issues.get(keyOf(W(1))).fields.assignee.name, winner)
    assert.equal(pickupOutcome(await pickup(loser, keyOf(W(3)))), 'started')

    // C: 준비된 계획 작업이 없어 사람이 만든 개발 티켓을 집는다
    const humanKey = jira.humanTicket({summary: '표 빈 상태 문구', components: ['DEVELOP'],
      description: '데이터가 없을 때 표에 아무것도 안 보입니다.\n\n완료 조건: 데이터가 없으면 "표시할 항목이 없습니다"가 보인다'})
    assert.equal(pickupOutcome(await pickup('C', humanKey)), 'assessing')
    const assessment = {schemaVersion: 1, ticket: {key: humanKey, provider: 'jira'}, verdict: 'startable', lane: 'change', objective: '빈 상태 문구',
      roles: ['fe'], selfCheck: ['new-route', 'new-data-contract', 'new-auth-path', 'new-external-dependency', 'public-contract-change']
        .map(id => ({id, answer: 'no', evidence: ['src/shared/ui/DataTable.tsx:1']})),
      planningNeeds: [], designNeeds: [], reasons: [], writePaths: ['src/shared/ui/'], nonGoals: [], dependsOn: [],
      acceptance: [{text: '데이터가 없으면 "표시할 항목이 없습니다"가 보인다', source: 'ticket'}],
      testItems: [{id: `TT-${humanKey}-1`, text: '빈 목록이면 빈 상태 문구', source: 'proposed'}]}
    writeFileSync(join(devs.C, assessmentPath(humanKey)), JSON.stringify(assessment))
    assert.equal(pickupOutcome(await pickup('C', humanKey)), 'confirm')
    assert.equal(pickupOutcome(await pickup('C', humanKey, {assessment: assessmentDigest(assessment)})), 'started')

    // ── 각자 브랜치에서 개발 → link → push ──
    const work = {[winner]: keyOf(W(1)), [loser]: keyOf(W(3)), C: humanKey}
    let pr = 10
    for (const name of ['A', 'B', 'C']) {
      git(devs[name], 'checkout', '-qb', `feat/${name}`)
      develop(devs[name], name)
      commitSplit(devs[name], `${name} 작업`)
      const linked = await runWorkLink({root: devs[name], ticketKey: work[name], prUrl: `https://github.com/acme/web/pull/${++pr}`, flags: {}, io: {prInfo: open}})
      assert.equal(linked.ok, true, `${name}: ${JSON.stringify(linked.blocked ?? linked.completion)}`)
      assert.deepEqual(linked.commitSplit?.mixed, [], `${name}: 산출물과 코드가 섞인 커밋`)
      commitSplit(devs[name], `${name} 연결`); git(devs[name], 'push', '-q', 'origin', `feat/${name}`)
    }
    // (2) 리드가 PR 셋을 차례로 머지한다 — 원장·작업 범위가 충돌하지 않는다
    git(lead, 'fetch', '-q', 'origin')
    for (const name of ['A', 'B', 'C']) {
      assert.equal(tryGit(lead, 'merge', '--no-ff', '-m', `merge ${name}`, `origin/feat/${name}`), true,
        `${name} 머지가 충돌했다: ${tryGit(lead, 'diff', '--name-only', '--diff-filter=U') ? git(lead, 'diff', '--name-only', '--diff-filter=U') : ''}`)
    }
    assert.equal(existsSync(join(lead, '_workspace/03_dev/change-scope.md')), false, '개발자 한 명의 작업 범위가 main에 올라왔다')

    // ── 완료 확인 → 다음 작업 ──
    assert.equal((await runWorkMergeSync({root: lead, io: {prStates: merged}})).completed.length, 3)
    commitSplit(lead, '머지 관측'); git(lead, 'push', '-q', 'origin', 'main')
    git(devs.C, 'checkout', '-q', 'main'); git(devs.C, 'pull', '-q', '--no-rebase', 'origin', 'main')
    const boardC = await runWorkBoard({root: devs.C, developer: 'C', flags: {}, io: {provider: providers.C, ticketConfig}})
    assert.deepEqual(boardC.ready, [W(4)])
    // (3) C의 끝난 작업 범위가 로컬에 남아 있어도 다음 픽업을 막지 않는다
    assert.equal(readChangeScopeFile(devs.C)?.ticketKey, humanKey, '전제: 끝난 작업의 범위가 남아 있어야 이 검사가 의미 있다')
    assert.equal(pickupOutcome(await pickup('C', keyOf(W(4)))), 'started')

    // (4) 보호된 main: 같은 머지를 A와 B가 각자 확인해 자기 브랜치로 올린다
    for (const name of ['A', 'B']) {
      git(devs[name], 'checkout', '-q', `feat/${name}`)
      await runWorkMergeSync({root: devs[name], io: {prStates: merged}})
      git(devs[name], 'checkout', '-qb', `sync/${name}`); commitSplit(devs[name], `${name} 머지 관측`); git(devs[name], 'push', '-q', 'origin', `sync/${name}`)
    }
    git(lead, 'fetch', '-q', 'origin')
    for (const name of ['A', 'B']) assert.equal(tryGit(lead, 'merge', '--no-ff', '-m', `merge sync ${name}`, `origin/sync/${name}`), true, `sync/${name} 머지 충돌`)
    const state = foldWorkState(readWorkEvents(join(lead, WORK_EVENTS_PATH)))
    assert.equal([...state.works.values()].filter(item => item.completed).length, 3)

    // (5) 보드: 끝난 작업은 담당자에게도 집을 수 있는 작업이 아니다 · 남이 맡은 사람 티켓은 막힌다
    const boardWinner = await runWorkBoard({root: devs[winner], developer: winner, flags: {}, io: {provider: providers[winner], ticketConfig}})
    assert.equal(boardWinner.rows.find(row => row.workId === W(1)).blockedReason, 'completed')
    assert.equal(boardWinner.ready.includes(W(1)), false, '머지로 끝난 작업을 집을 수 있다고 보였다')
    const humanRow = boardWinner.tickets.find(row => row.ticketKey === humanKey)
    assert.equal(humanRow.blockedReason, 'assigned-to-other')
    const steal = await pickup(winner, humanKey)
    assert.equal(steal.bounce?.reason, 'assigned-to-other')
    // PM이 담당자를 먼저 정해 둔, 아직 아무도 판정하지 않은 사람 티켓 — 판정 에이전트를 띄우기 전에 멈춘다.
    const assignedKey = jira.humanTicket({summary: '검색창 자리표시 문구', components: ['DEVELOP'], description: '검색창에 안내 문구를 넣어 주세요.'})
    jira.issues.get(assignedKey).fields.assignee = {name: 'C'}
    const early = await pickup(winner, assignedKey)
    assert.equal(early.phase, 'TICKET_ASSIGNED_TO_OTHER', JSON.stringify(early.bounce))
    assert.equal(existsSync(join(devs[winner], assessmentSnapshotPath(assignedKey))), false, '남의 티켓인데 판정을 준비했다')
  } finally {
    rmSync(base, {recursive: true, force: true})
  }
})
