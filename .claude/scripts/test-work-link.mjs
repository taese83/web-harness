#!/usr/bin/env node
// test-work-link.mjs — WORK의 완료 주장(link)과 완료(머지 관측): legacy `link`의 게이트를 옮겼는가.
//
// 고정하는 사실:
//   STALE  change-scope가 이 작업의 것이면 계획 digest로 대조하고, 대조할 수 없으면 명시 인수 없이 막는다
//   멱등   이미 연결된 작업의 재실행은 지나간 판정을 다시 심판하지 않는다
//   완료   소유 TC가 인용되지 않았거나 check 대상이 없으면 막는다 — 기준이 하나도 없으면 판정 불가
//   인수   `--accept-*`로 넘긴 사실은 원장에 남는다(휘발성 주장이 되지 않게)
//   머지   `work-completed`는 머지를 **관측했을 때만** 쓴다 — 조회 실패·열린 PR은 완료가 아니다
import assert from 'node:assert/strict'
import test from 'node:test'
import {cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {randomUUID} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import {evaluateWorkCompletion, planMergeSync, planWorkLink, projectRefDigest} from './ticket/work-link.mjs'
import {resolvePrStates, runWorkLink, runWorkMergeSync, workCloseLine} from './ticket/work-link-run.mjs'
import {appendWorkEvent, foldWorkState, readWorkEvents, validateWorkEvent, WORK_EVENTS_PATH} from './ticket/work-events.mjs'
import {canonicalDigest} from './ticket/work-analysis.mjs'
import {writeChangeScopeFile} from './ticket/cli.mjs'
import {buildWorkChangeScope} from './ticket/work-pickup.mjs'

const repo = new URL('../..', import.meta.url).pathname
const FIXTURE = join(repo, '.claude/evals/fixtures/work-plan/crud')
const plan = JSON.parse(readFileSync(join(FIXTURE, '_workspace/03_dev/work-plan.json'), 'utf8'))
const planDigest = canonicalDigest(plan)
const W = n => `WORK-0000000${n}-0000-4000-8000-00000000000${n}`
const PR = 'https://github.com/acme/web/pull/42'
const work = id => plan.workItems.find(entry => entry.workId === id)
const owned = id => plan.featureBindings.flatMap(binding => binding.acceptanceOwners.filter(owner => owner.workId === id).map(owner => owner.testCaseId))
const everything = () => true
const published = (id, extra = {}) => ({works: new Map([[id, {status: 'published', ticketKey: 'PF-104', planDigest, ...extra}]])})
const scopeFor = id => ({workId: id, sourceDigest: planDigest, ticket: {key: 'PF-104', provider: 'jira', revision: 'r1', revisionStage: 'settled-at-pickup'}})

test('완료: 소유 TC가 인용되지 않았거나 check 대상이 없으면 충족이 아니다', () => {
  const tcs = owned(W(4))
  assert.ok(tcs.length > 0, 'fixture 전제: W4는 TC를 소유한다')
  const full = evaluateWorkCompletion({work: work(W(4)), ownedTestCaseIds: tcs, citedIds: tcs, pathExists: everything})
  assert.equal(full.ok, true)
  const uncited = evaluateWorkCompletion({work: work(W(4)), ownedTestCaseIds: tcs, citedIds: tcs.slice(1), pathExists: everything})
  assert.equal(uncited.reason, 'uncited-test-cases')
  assert.deepEqual(uncited.testCases.missing, [tcs[0]])
  // TC가 없는 기반 작업은 check 대상의 실재로 잰다.
  const foundation = evaluateWorkCompletion({work: work(W(1)), ownedTestCaseIds: [], citedIds: [], pathExists: () => false})
  assert.equal(foundation.reason, 'check-targets-missing')
  assert.deepEqual(foundation.checks.missing.map(item => item.checkId), ['A-1'])
  // 대상 경로가 없는 check는 잴 수 없다 — 통과로 접지 않는다.
  const unmeasurable = evaluateWorkCompletion({work: {checks: [{checkId: 'X', targetRefs: []}]}, ownedTestCaseIds: [], citedIds: [], pathExists: everything})
  assert.equal(unmeasurable.ok, false)
  // 기준이 하나도 없으면 판정 불가다.
  assert.equal(evaluateWorkCompletion({work: {checks: []}, ownedTestCaseIds: [], citedIds: [], pathExists: everything}).reason, 'no-acceptance')
})

test('STALE: 픽업 뒤 계획이 바뀌었으면 막고, 대조할 수 없으면 명시 인수 없이 막는다', () => {
  const completion = evaluateWorkCompletion({work: work(W(4)), ownedTestCaseIds: owned(W(4)), citedIds: owned(W(4)), pathExists: everything})
  const base = {plan, planDigest, state: published(W(4)), ticketKey: 'PF-104', prUrl: PR, completion}
  assert.equal(planWorkLink({...base, changeScope: {...scopeFor(W(4)), sourceDigest: 'b'.repeat(64)}}).blocked, 'stale-change-scope')
  const none = planWorkLink({...base, changeScope: null})
  assert.equal(none.blocked, 'stale-check-unavailable')
  assert.equal(none.staleCheck, 'not-performed:no-change-scope')
  assert.equal(planWorkLink({...base, changeScope: scopeFor(W(1))}).staleCheck, 'not-performed:different-work')
  const accepted = planWorkLink({...base, changeScope: null, flags: {'accept-unverified-scope': true}})
  assert.equal(accepted.ok, true)
  assert.equal(accepted.event.payload.acceptedUnverifiedScope, true, '대조 없이 넘긴 사실이 원장에서 사라졌다')
  const verified = planWorkLink({...base, changeScope: scopeFor(W(4))})
  assert.equal(verified.event.payload.staleCheck, 'verified')
  assert.deepEqual(verified.event.payload.ticket, scopeFor(W(4)).ticket, '어느 티켓 개정으로 개발했는지 원장에 남지 않았다')
})

test('완료 조건 미충족은 막고, 명시 인수로 넘기면 그 사실이 원장에 남는다', () => {
  const partial = evaluateWorkCompletion({work: work(W(4)), ownedTestCaseIds: owned(W(4)), citedIds: [], pathExists: everything})
  const base = {plan, planDigest, state: published(W(4)), changeScope: scopeFor(W(4)), ticketKey: 'PF-104', prUrl: PR, completion: partial}
  assert.equal(planWorkLink(base).blocked, 'completion:uncited-test-cases')
  const accepted = planWorkLink({...base, flags: {'accept-incomplete': true}})
  assert.equal(accepted.event.payload.acceptedIncomplete, true)
  assert.equal(accepted.event.payload.completion.ok, false)
  assert.deepEqual(accepted.event.payload.completion.testCases.missing, owned(W(4)))
})

test('등록·멱등: 원장이 모르는 키는 막고, 이미 연결된 작업은 다시 심판하지 않는다', () => {
  const completion = evaluateWorkCompletion({work: work(W(4)), ownedTestCaseIds: owned(W(4)), citedIds: [], pathExists: everything})
  assert.equal(planWorkLink({plan, planDigest, state: {works: new Map()}, changeScope: null, ticketKey: 'PF-104', prUrl: PR, completion}).blocked, 'work-not-registered')
  const twice = {works: new Map([[W(4), {status: 'published', ticketKey: 'PF-104'}], [W(5), {status: 'published', ticketKey: 'PF-104'}]])}
  assert.equal(planWorkLink({plan, planDigest, state: twice, changeScope: null, ticketKey: 'PF-104', prUrl: PR, completion}).blocked, 'ticket-registered-twice')
  const linked = published(W(4), {link: {prUrl: 'https://github.com/acme/web/pull/7'}})
  const again = planWorkLink({plan, planDigest, state: linked, changeScope: scopeFor(W(4)), ticketKey: 'PF-104', prUrl: PR, completion})
  assert.equal(again.idempotent, true, '미충족인데 재실행이 막혔다 — 지나간 판정을 다시 심판했다')
  assert.equal(again.existing, 'https://github.com/acme/web/pull/7')
  assert.equal(planWorkLink({plan, planDigest, state: published(W(4)), changeScope: null, ticketKey: 'PF-104', prUrl: 'not-a-url', completion}).blocked, 'pr-url-required')
})

test('머지: 머지를 관측한 것만 완료다 — 열린 PR·조회 실패는 완료가 아니다', () => {
  const state = {works: new Map([
    [W(1), {status: 'published', link: {prUrl: 'https://github.com/o/r/pull/1'}}],
    [W(3), {status: 'published', link: {prUrl: 'https://github.com/o/r/pull/3'}}],
    [W(4), {status: 'published', link: {prUrl: 'https://github.com/o/r/pull/4'}}],
    [W(5), {status: 'published', link: {prUrl: 'https://github.com/o/r/pull/5'}, completed: {prUrl: 'x', at: 't'}}],
  ])}
  const prStates = new Map([
    ['https://github.com/o/r/pull/1', {state: 'MERGED'}],
    ['https://github.com/o/r/pull/3', {state: 'OPEN'}],
    ['https://github.com/o/r/pull/4', {error: 'gh: not logged in'}],
  ])
  const sync = planMergeSync({plan, state, prStates})
  assert.deepEqual(sync.events.map(event => event.workId), [W(1)])
  assert.equal(sync.events[0].payload.via, 'pr-merged')
  assert.deepEqual(sync.open.map(item => item.workId), [W(3)])
  assert.deepEqual(sync.unknown.map(item => item.workId), [W(4)])
})

test('원장: 머지를 관측하지 않은 완료·판정 요약 없는 링크는 쓸 수 없다', () => {
  const base = {schemaVersion: 1, eventId: randomUUID(), planId: plan.planId, workId: W(1), at: new Date().toISOString()}
  assert.deepEqual(validateWorkEvent({...base, eventType: 'work-completed', payload: {prUrl: PR, via: 'pr-merged'}}), [])
  assert.ok(validateWorkEvent({...base, eventType: 'work-completed', payload: {prUrl: PR, via: 'manual'}}).some(error => /pr-merged/.test(error)),
    '머지 관측이 아닌 완료가 원장에 들어간다')
  assert.ok(validateWorkEvent({...base, eventType: 'work-linked', planDigest, payload: {prUrl: PR, staleCheck: 'verified'}})
    .some(error => /completion/.test(error)), '판정 요약 없는 링크가 원장에 들어간다')
})

test('닫는 줄은 트래커가 정한다 — 모르면 닫는다고 적지 않는다', () => {
  assert.match(workCloseLine('github', '12'), /12/)
  assert.match(workCloseLine('jira', 'PF-104'), /Relates to PF-104[\s\S]*자동 닫히지 않는다/)
  assert.equal(workCloseLine(null, 'PF-104'), null)
})

// ── 실행부: 원장·파일·배선 ──────────────────────────────────────────────
const workspace = () => {
  const root = mkdtempSync(join(tmpdir(), 'wh-work-link-'))
  cpSync(FIXTURE, root, {recursive: true})
  appendWorkEvent(join(root, WORK_EVENTS_PATH), {schemaVersion: 1, eventId: randomUUID(), operationId: randomUUID(), planId: plan.planId,
    workId: W(1), eventType: 'publish-confirmed', at: new Date().toISOString(), planDigest, payload: {ticketKey: 'PF-101'}})
  return root
}

test('실행부: 기반 작업을 연결하면 원장에 판정과 함께 남고, 머지 관측 뒤에야 완료가 된다', async () => {
  const root = workspace()
  try {
    writeChangeScopeFile(root, buildWorkChangeScope({issue: {ticketKey: 'PF-101', provider: 'jira', title: 't', body: 'b', revision: 'r1'},
      plan, planDigest, work: work(W(1)), featureIds: ['FEAT-001'], testCaseIds: []}))
    // check 대상이 아직 없다 — 막힌다.
    const blocked = await runWorkLink({root, ticketKey: 'PF-101', prUrl: PR, flags: {}})
    assert.equal(blocked.blocked, 'completion:check-targets-missing', JSON.stringify(blocked))
    // 대상을 만든다(작업 산출물).
    mkdirSync(join(root, 'src/entities/member'), {recursive: true})
    writeFileSync(join(root, 'src/entities/member/api.ts'), 'export type Member = {id: string}\n')
    const linked = await runWorkLink({root, ticketKey: 'PF-101', prUrl: PR, flags: {}})
    assert.equal(linked.ok, true, JSON.stringify(linked))
    assert.equal(linked.staleCheck, 'verified')
    let state = foldWorkState(readWorkEvents(join(root, WORK_EVENTS_PATH)))
    assert.equal(state.works.get(W(1)).link.prUrl, PR)
    assert.equal(state.works.get(W(1)).completed, null, '링크를 완료로 기록했다')
    // 조회 실패는 ok:false로 올린다 — 완료로도 침묵으로도 접지 않는다.
    const failing = await runWorkMergeSync({root, io: {prStates: async () => new Map()}})
    assert.equal(failing.ok, false)
    assert.deepEqual(failing.completed, [])
    assert.deepEqual(failing.unknown.map(item => item.workId), [W(1)])
    // 머지 관측: 열린 PR은 완료가 아니다.
    const open = await runWorkMergeSync({root, io: {prStates: async urls => new Map(urls.map(url => [url, {state: 'OPEN'}]))}})
    assert.deepEqual(open.completed, [])
    const merged = await runWorkMergeSync({root, io: {prStates: async urls => new Map(urls.map(url => [url, {state: 'MERGED'}]))}})
    assert.deepEqual(merged.completed, [W(1)])
    state = foldWorkState(readWorkEvents(join(root, WORK_EVENTS_PATH)))
    assert.equal(state.works.get(W(1)).completed.prUrl, PR)
    // 이미 완료된 작업은 다시 조회하지 않는다(완료 이벤트가 중복으로 쌓이지 않게).
    const again = await runWorkMergeSync({root, io: {prStates: async urls => { assert.deepEqual(urls, []); return new Map() }}})
    assert.deepEqual(again.completed, [])
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})

test('배선: `link --work <키> <PR>`가 WORK 입구로 가고, 대조할 수 없으면 exit 2로 막힌다', () => {
  const root = workspace()
  try {
    const run = spawnSync(process.execPath, [join(repo, '.claude/scripts/ticket/cli.mjs'), 'link', '--work', 'PF-101', PR, '--root', root],
      {encoding: 'utf8', env: {PATH: process.env.PATH, HOME: process.env.HOME}, timeout: 30000})
    const result = JSON.parse(run.stdout)
    assert.equal(result.mode, 'work', `--work가 WORK 입구로 가지 않았다: ${run.stdout}${run.stderr}`)
    assert.equal(result.blocked, 'stale-check-unavailable')
    assert.equal(run.status, 2)
    assert.equal(readWorkEvents(join(root, WORK_EVENTS_PATH)).some(event => event.eventType === 'work-linked'), false)
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})

test('기반 작업: 이미 있던 대상을 적어 두고 아무것도 안 하면 완료가 아니다 — 픽업 때 찍은 지문과 같다', async () => {
  const root = workspace()
  try {
    // 브라운필드: 대상 파일이 계획 전부터 있다.
    mkdirSync(join(root, 'src/entities/member'), {recursive: true})
    writeFileSync(join(root, 'src/entities/member/api.ts'), 'export type Member = {id: string}\n')
    const digest = projectRefDigest(root)
    const scope = buildWorkChangeScope({issue: {ticketKey: 'PF-101', provider: 'jira', title: 't', body: 'b', revision: 'r1'},
      plan, planDigest, work: work(W(1)), featureIds: ['FEAT-001'], testCaseIds: []})
    scope.checks = scope.checks.map(check => ({...check, baseline: Object.fromEntries(check.targetRefs.map(ref => [ref, digest(ref)]))}))
    writeChangeScopeFile(root, scope)
    const untouched = await runWorkLink({root, ticketKey: 'PF-101', prUrl: PR, flags: {}})
    assert.equal(untouched.blocked, 'completion:check-targets-unchanged', JSON.stringify(untouched))
    assert.match(untouched.guidance, /바뀌지 않았다/)
    // 작업이 대상을 바꾸면 통과한다.
    writeFileSync(join(root, 'src/entities/member/api.ts'), 'export type Member = {id: string; name: string}\n')
    const changed = await runWorkLink({root, ticketKey: 'PF-101', prUrl: PR, flags: {}})
    assert.equal(changed.ok, true, JSON.stringify(changed))
    assert.equal(changed.completion.checks.baselineCheck, 'verified')
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})

test('실행부: 픽업이 change-scope에 대상 지문 기준선을 남긴다', async () => {
  const root = workspace()
  try {
    const {runWorkPickup} = await import('./ticket/work-pickup-run.mjs')
    const {buildWorkMarker} = await import('./ticket/work-refs.mjs')
    const {readChangeScopeFile} = await import('./ticket/cli.mjs')
    const issue = {ticketKey: 'PF-101', provider: 'jira', title: 't', revision: 'r1', assignees: [], links: [], comments: [], commentsOmitted: 0,
      body: `요약\n\n${buildWorkMarker({planId: plan.planId, workId: W(1), featureIds: ['FEAT-001'], testCaseIds: [], planDigest})}`}
    let assignees = []
    const provider = {name: 'jira', async resolveIssue() { return {...issue, assignees: [...assignees]} },
      async assign(key, who) { assignees = [who] }, async transition() { return {transitioned: true} },
      async comment() { return {ok: true} }, supportedPhases: ['in-progress']}
    const picked = await runWorkPickup({root, ticketKey: 'PF-101', developer: 'me', flags: {}, io: {provider}})
    assert.equal(picked.ok, true, JSON.stringify(picked.bounce ?? picked))
    const scope = readChangeScopeFile(root)
    assert.equal(scope.checks[0].checkId, 'A-1')
    assert.ok(Object.hasOwn(scope.checks[0].baseline, 'src/entities/member/api.ts'), '대상 지문을 찍지 않았다')
    assert.equal(scope.checks[0].baseline['src/entities/member/api.ts'], null, '없는 대상은 null이어야 한다')
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})

test('닫는 줄의 트래커는 발행 원장이 정한다 — 지금 설정이 바뀌어도 따르지 않는다', () => {
  const completion = evaluateWorkCompletion({work: work(W(4)), ownedTestCaseIds: owned(W(4)), citedIds: owned(W(4)), pathExists: everything})
  const decision = planWorkLink({plan, planDigest, state: published(W(4), {provider: 'jira'}),
    changeScope: {...scopeFor(W(4)), ticket: {...scopeFor(W(4)).ticket, provider: 'github'}}, ticketKey: 'PF-104', prUrl: PR, completion})
  assert.equal(decision.provider, 'jira')
  // 원장이 모르면 대조한 범위의 트래커, 그것도 없으면 모른다(닫는 줄을 만들지 않는다).
  const fromScope = planWorkLink({plan, planDigest, state: published(W(4)), changeScope: scopeFor(W(4)), ticketKey: 'PF-104', prUrl: PR, completion})
  assert.equal(fromScope.provider, 'jira')
  const unknown = planWorkLink({plan, planDigest, state: published(W(4)), changeScope: null, ticketKey: 'PF-104', prUrl: PR, completion,
    flags: {'accept-unverified-scope': true}})
  assert.equal(unknown.provider, null)
})

test('STALE: 같은 작업이라도 다른 티켓의 범위면 대조한 것으로 치지 않는다', () => {
  const completion = evaluateWorkCompletion({work: work(W(4)), ownedTestCaseIds: owned(W(4)), citedIds: owned(W(4)), pathExists: everything})
  const other = planWorkLink({plan, planDigest, state: published(W(4)), changeScope: {...scopeFor(W(4)), ticketKey: 'PF-9'},
    ticketKey: 'PF-104', prUrl: PR, completion})
  assert.equal(other.blocked, 'stale-check-unavailable')
  assert.equal(other.staleCheck, 'not-performed:different-ticket')
})

test('PR 상태 조회 실패는 머지가 아니다 — 조회기가 던지면 오류로 남는다', async () => {
  const states = await resolvePrStates(['https://github.com/o/r/pull/9', 'https://github.com/o/r/pull/10'], {
    exec: async args => { if (args.includes('https://github.com/o/r/pull/9')) throw new Error('gh: auth'); return JSON.stringify({state: 'MERGED'}) }})
  assert.equal(states.get('https://github.com/o/r/pull/9').state, undefined)
  assert.match(states.get('https://github.com/o/r/pull/9').error, /auth/)
  assert.equal(states.get('https://github.com/o/r/pull/10').state, 'MERGED')
})
