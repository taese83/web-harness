#!/usr/bin/env node
// test-work-board.mjs — 「지금 무엇을 집을 수 있나」가 **픽업과 같은 판정**인가.
//
// 고정하는 사실:
//   (1) 보드의 `pickupable`과 픽업의 실제 차단이 같은 축이다 — 표시와 게이트가 갈라지지 않는다
//   (2) 트래커를 못 보거나 목록이 잘리면 **「미배정」이라 말하지 않는다**(배정 미상으로 둔다)
//   (3) 통합 대기는 정보다 — 선행의 완료는 아직 기록되지 않는다(P3), 착수 조건은 선행의 등록까지다
import assert from 'node:assert/strict'
import test from 'node:test'
import {cpSync, mkdtempSync, readFileSync, rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {randomUUID} from 'node:crypto'
import {buildWorkBoard, runWorkBoard} from './ticket/work-board.mjs'
import {appendWorkEvent, foldWorkState, readWorkEvents, WORK_EVENTS_PATH} from './ticket/work-events.mjs'
import {computeWorkView} from './ticket/work-plan.mjs'
import {canonicalDigest} from './ticket/work-analysis.mjs'
import {pickupWorkTicket} from './ticket/work-pickup.mjs'
import {buildWorkMarker} from './ticket/work-refs.mjs'

const repo = new URL('../..', import.meta.url).pathname
const base = join(repo, '.claude/evals/fixtures/work-plan/crud/_workspace/03_dev')
const plan = JSON.parse(readFileSync(join(base, 'work-plan.json'), 'utf8'))
const analysis = JSON.parse(readFileSync(join(base, 'work-analysis.json'), 'utf8'))
const planDigest = canonicalDigest(plan)
const view = computeWorkView(plan, analysis)
const W = n => `WORK-0000000${n}-0000-4000-8000-00000000000${n}`
const state = ids => ({works: new Map(ids.map((id, index) => [id, {status: 'published', ticketKey: `PF-10${index}`, planDigest}]))})

// 보드와 픽업을 **여러 상태**에서 돌려 대조한다. 한 상태(전부 발행·전부 미배정·같은 판본)만
// 보면 판별되는 축이 하나뿐이라 「같은 축」이 자명하게 참이 된다(적대 리뷰 2026-09-14).
const issueFor = (workId, ticketKey, assignees) => {
  const featureIds = plan.featureBindings.filter(binding => binding.requiredWorkIds.includes(workId)).map(binding => binding.featureId)
  const testCaseIds = plan.featureBindings.flatMap(binding =>
    binding.acceptanceOwners.filter(owner => owner.workId === workId).map(owner => owner.testCaseId))
  return {ticketKey, provider: 'jira', title: workId, assignees,
    body: `요약\n\n${buildWorkMarker({planId: plan.planId, workId, featureIds, testCaseIds, planDigest})}`}
}
const ALL = [W(1), W(3), W(4), W(5), W(6), W(7)]

test('보드의 착수 가능 판정이 픽업의 실제 차단과 같은 축이다 — 여러 상태에서', () => {
  const cases = [
    {name: '전부 발행·미배정', published: ALL, assignees: () => []},
    {name: '일부만 발행', published: [W(1), W(4)], assignees: () => []},
    {name: '남이 잡고 있음', published: ALL, assignees: workId => (workId === W(1) ? ['someone-else'] : [])},
    {name: '내가 잡고 있음', published: ALL, assignees: workId => (workId === W(1) ? ['me'] : [])},
    {name: '발행 뒤 계획이 바뀜', published: ALL, assignees: () => [], publishedWith: 'b'.repeat(64)},
    {name: '기반 둘이 머지됨', published: ALL, assignees: () => [], completed: [W(1), W(3)]},
    {name: 'PR만 연결됨', published: ALL, assignees: () => [], linked: [W(1), W(3)]},
  ]
  for (const scenario of cases) {
    const works = new Map(scenario.published.map((workId, index) => [workId,
      {status: 'published', ticketKey: `PF-20${index}`, planDigest: scenario.publishedWith ?? planDigest,
        ...((scenario.completed ?? []).includes(workId) ? {completed: {prUrl: `https://github.com/o/r/pull/${index}`, at: 't'}} : {}),
        ...((scenario.linked ?? []).includes(workId) ? {link: {prUrl: `https://github.com/o/r/pull/${index}`}} : {})}]))
    const published = {works}
    const issuesByWork = new Map([...works.entries()].map(([workId, item]) =>
      [workId, {ticketKey: item.ticketKey, assignees: scenario.assignees(workId)}]))
    const {rows} = buildWorkBoard({plan, view, state: published, planDigest, issuesByWork, developer: 'me', lookupComplete: true})
    assert.equal(rows.length, ALL.length, `${scenario.name}: 보드가 행을 빠뜨렸다`)
    for (const row of rows) {
      const item = works.get(row.workId)
      const pick = pickupWorkTicket({issue: issueFor(row.workId, item?.ticketKey ?? 'PF-999', scenario.assignees(row.workId)),
        plan, planDigest, state: published, view})
      // 픽업은 소유를 실행부에서 본다(순수 판정 밖) — 보드의 소유 축은 여기서 따로 맞춘다.
      const taken = scenario.assignees(row.workId).some(person => person !== 'me')
      assert.equal(row.pickupable, pick.ok && !taken,
        `${scenario.name} — ${row.workId}: 보드 ${row.pickupable}(${row.blockedReason}) ≠ 픽업 ${pick.ok}(${pick.bounce?.reason})`)
    }
  }
})

test('보드도 발행 뒤 바뀐 계획을 막는다 — 픽업과 같은 사유로', () => {
  const works = new Map([[W(1), {status: 'published', ticketKey: 'PF-100', planDigest: 'b'.repeat(64)}]])
  const {rows, notes} = buildWorkBoard({plan, view, state: {works}, planDigest, developer: 'me', lookupComplete: true,
    issuesByWork: new Map([[W(1), {ticketKey: 'PF-100', assignees: []}]])})
  const row = rows.find(entry => entry.workId === W(1))
  assert.equal(row.blockedReason, 'stale-plan')
  assert.equal(row.publishedWith, 'b'.repeat(64))
  assert.ok(notes.some(note => /발행 뒤 계획이 바뀐 작업/.test(note)), JSON.stringify(notes))
  // 발행 판본을 원장이 모르면 「같다」고 접지 않는다.
  const unknown = buildWorkBoard({plan, view, state: {works: new Map([[W(1), {status: 'published', ticketKey: 'PF-100'}]])},
    planDigest, developer: 'me', lookupComplete: true, issuesByWork: new Map([[W(1), {ticketKey: 'PF-100', assignees: []}]])})
  assert.equal(unknown.rows.find(entry => entry.workId === W(1)).blockedReason, 'plan-digest-unknown')
})

test('`--developer`가 없으면 누가 집을 수 있는지 말하지 않는다 — 픽업도 같은 이유로 막는다', () => {
  const works = new Map([[W(1), {status: 'published', ticketKey: 'PF-100', planDigest}]])
  const {rows, notes} = buildWorkBoard({plan, view, state: {works}, planDigest, lookupComplete: true,
    issuesByWork: new Map([[W(1), {ticketKey: 'PF-100', assignees: []}]])})
  assert.equal(rows.find(entry => entry.workId === W(1)).blockedReason, 'no-developer')
  assert.ok(notes.some(note => /--developer/.test(note)))
})

test('미등록·미해결 결정·미등록 선행은 사유와 함께 막힌다', () => {
  const seen = new Map([[W(1), {ticketKey: 'PF-100', assignees: []}]])
  const {rows} = buildWorkBoard({plan, view, state: state([W(1)]), planDigest, issuesByWork: seen, developer: 'me', lookupComplete: true})
  const by = new Map(rows.map(row => [row.workId, row]))
  assert.equal(by.get(W(3)).blockedReason, 'not-registered:unpublished')
  assert.equal(by.get(W(4)).blockedReason, 'not-registered:unpublished')
  assert.equal(by.get(W(1)).pickupable, true)
  // W1이 머지로 끝났고 W4가 등록되면, W4의 이유는 「선행 미완료」(W3)가 된다.
  const partial = {works: new Map([[W(1), {...state([W(1)]).works.get(W(1)), completed: {prUrl: 'u', at: 't'}}],
    [W(4), {status: 'published', ticketKey: 'PF-104', planDigest}]])}
  const second = buildWorkBoard({plan, view, state: partial, planDigest, developer: 'me', lookupComplete: true,
    issuesByWork: new Map([...seen, [W(4), {ticketKey: 'PF-104', assignees: []}]])})
  const row = second.rows.find(entry => entry.workId === W(4))
  assert.equal(row.blockedReason, 'dependency-incomplete')
  assert.deepEqual(row.incompleteDeps, [W(3)])
})

test('트래커를 못 보면 「미배정」이라 말하지 않는다 — 배정 미상으로 두고 그 사실을 적는다', () => {
  const published = state([W(1)])
  const offline = buildWorkBoard({plan, view, state: published, planDigest, issuesByWork: null, developer: 'me'})
  const row = offline.rows.find(entry => entry.workId === W(1))
  assert.equal(row.assignees, null)
  assert.equal(row.mine, null)
  assert.equal(row.blockedReason, 'assignment-unknown', '배정을 모르는데 집을 수 있다고 했다')
  assert.ok(offline.notes.some(note => /미배정이라는 뜻이 아니다/.test(note)), JSON.stringify(offline.notes))
  // 남이 잡고 있으면 막는다.
  const taken = buildWorkBoard({plan, view, state: published, planDigest, developer: 'me', lookupComplete: true,
    issuesByWork: new Map([[W(1), {ticketKey: 'PF-100', assignees: ['someone-else']}]])})
  assert.equal(taken.rows.find(entry => entry.workId === W(1)).blockedReason, 'assigned-to-other')
})

test('실행부: 트래커 조회가 실패해도 보드는 나오고 실패 사실이 남는다', async () => {
  const root = mkdtempSync(join(tmpdir(), 'wh-work-board-'))
  try {
    cpSync(join(repo, '.claude/evals/fixtures/work-plan/crud'), root, {recursive: true})
    const events = join(root, WORK_EVENTS_PATH)
    appendWorkEvent(events, {schemaVersion: 1, eventId: randomUUID(), operationId: randomUUID(), planId: plan.planId,
      workId: W(1), eventType: 'publish-confirmed', at: new Date().toISOString(), planDigest, payload: {ticketKey: 'PF-101'}})
    const provider = {name: 'jira', async listWorkIssues() { throw new Error('tracker down') }}
    const result = await runWorkBoard({root, developer: 'me', flags: {}, io: {provider}})
    assert.equal(result.ok, true)
    assert.ok(result.notes.some(note => /트래커 조회 실패/.test(note)), JSON.stringify(result.notes))
    assert.equal(result.rows.find(row => row.workId === W(1)).registration, 'published')
    assert.equal(foldWorkState(readWorkEvents(events)).works.get(W(1)).ticketKey, 'PF-101')
    // 조회 실패는 착수 가능으로 접히지 않는다.
    assert.deepEqual(result.ready, [])
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})

test('실행부: 계획이 없으면 보드가 아니라 계획을 요구한다', async () => {
  const root = mkdtempSync(join(tmpdir(), 'wh-work-board-empty-'))
  try {
    const result = await runWorkBoard({root, flags: {}, io: {}})
    assert.equal(result.ok, false)
    assert.equal(result.phase, 'PLAN_REQUIRED')
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})

test('원장은 발행됐다는데 트래커에 없으면 「배정 미상」이 아니라 그렇게 말한다', () => {
  const {rows, notes} = buildWorkBoard({plan, view, state: state([W(1)]), planDigest, issuesByWork: new Map(), developer: 'me', lookupComplete: true})
  const row = rows.find(entry => entry.workId === W(1))
  assert.equal(row.blockedReason, 'ticket-not-found')
  assert.ok(notes.some(note => /트래커 목록에 없는 작업/.test(note)), JSON.stringify(notes))
})
