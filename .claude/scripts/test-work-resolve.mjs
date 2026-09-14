#!/usr/bin/env node
// test-work-resolve.mjs — 원장 키로 WORK를 알아보는 입구들.
//
// 고정하는 사실:
//   T11  마커가 지워진 WORK 티켓은 원장 키로 알아본다 — 픽업은 착수시키지 않고, 인테이크는 공급 원문으로 받지 않는다
//   확정  결과를 모르는 발행은 사람이 찾은 키로 확정하되, 그 티켓 본문에 **그 작업의 마커**가 있을 때만이다
import assert from 'node:assert/strict'
import test from 'node:test'
import {cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {randomUUID} from 'node:crypto'
import {pickupWorkTicket} from './ticket/work-pickup.mjs'
import {runPublishResolve} from './ticket/work-resolve-run.mjs'
import {runIntake} from './ticket/cli.mjs'
import {appendWorkEvent, foldWorkState, readWorkEvents, WORK_EVENTS_PATH} from './ticket/work-events.mjs'
import {buildAggregateMarker, buildWorkMarker} from './ticket/work-refs.mjs'
import {canonicalDigest} from './ticket/work-analysis.mjs'
import {spawnSync} from 'node:child_process'
import {writeFileSync} from 'node:fs'

const repo = new URL('../..', import.meta.url).pathname
const FIXTURE = join(repo, '.claude/evals/fixtures/work-plan/crud')
const plan = JSON.parse(readFileSync(join(FIXTURE, '_workspace/03_dev/work-plan.json'), 'utf8'))
const planDigest = canonicalDigest(plan)
const W = n => `WORK-0000000${n}-0000-4000-8000-00000000000${n}`
const markerOf = workId => buildWorkMarker({planId: plan.planId, workId, featureIds: ['FEAT-001'], testCaseIds: [], planDigest})
const workspace = () => {
  const root = mkdtempSync(join(tmpdir(), 'wh-resolve-'))
  cpSync(FIXTURE, root, {recursive: true})
  return root
}
const append = (root, extra) => appendWorkEvent(join(root, WORK_EVENTS_PATH), {schemaVersion: 1, eventId: randomUUID(), planId: plan.planId,
  at: new Date().toISOString(), planDigest, ...extra})

test('T11: 마커가 지워진 WORK 티켓은 원장 키로 알아보고 착수시키지 않는다', () => {
  const state = {works: new Map([[W(1), {status: 'published', ticketKey: 'PF-101', planDigest}]])}
  const stripped = pickupWorkTicket({issue: {ticketKey: 'PF-101', provider: 'jira', title: 't', body: '사람이 본문을 통째로 고쳐 마커가 사라졌다'},
    plan, planDigest, state})
  assert.equal(stripped.bounce.reason, 'work-marker-missing')
  assert.equal(stripped.bounce.workId, W(1))
  // 원장이 모르는 키는 여전히 종류 미상이다.
  assert.equal(pickupWorkTicket({issue: {ticketKey: 'PF-999', title: 't', body: '본문'}, plan, planDigest, state}).bounce.reason, 'unknown-ticket-not-work')
})

test('T11: 인테이크는 원장이 발행한 키를 마커가 없어도 공급 원문으로 받지 않는다', async () => {
  const root = workspace()
  try {
    mkdirSync(join(root, '_workspace/00_source'), {recursive: true})
    append(root, {workId: W(1), operationId: randomUUID(), eventType: 'publish-confirmed', payload: {ticketKey: 'PF-101', provider: 'jira'}})
    const io = {provider: {name: 'jira'}, resolveIssue: async () => ({title: '회원 타입', body: '마커가 지워진 본문', url: 'https://jira/PF-101'})}
    const refused = await runIntake({root, repo: 'o/r', ticketKey: 'PF-101', flags: {}, io})
    assert.equal(refused.ok, false)
    assert.equal(refused.bounce.reason, 'published-ticket-not-source')
  } finally { rmSync(root, {recursive: true, force: true}) }
})

test('확정: 결과를 모르는 발행은 본문에 그 작업의 마커가 있는 티켓으로만 확정한다', async () => {
  const root = workspace()
  try {
    const operationId = randomUUID()
    append(root, {workId: W(1), operationId, eventType: 'publish-attempted', payload: {payloadDigest: 'b'.repeat(64)}})
    append(root, {workId: W(1), operationId, eventType: 'publish-unknown', payload: {reason: 'timeout'}})
    const oldRev = buildWorkMarker({planId: plan.planId, workId: W(1), featureIds: ['FEAT-001'], testCaseIds: [], planDigest: 'd'.repeat(64)})
    const bodies = {'PF-101': `요약\n\n${markerOf(W(1))}`, 'PF-102': `요약\n\n${markerOf(W(3))}`, 'PF-103': '마커 없음', 'PF-104': `옛 판본\n\n${oldRev}`}
    const provider = {name: 'jira', async resolveIssue(key) { return {body: bodies[key]} }}
    // 다른 작업의 티켓·마커 없는 티켓으로는 확정하지 않는다.
    for (const key of ['PF-102', 'PF-103', 'PF-104']) {
      const refused = await runPublishResolve({root, flags: {resolve: W(1), ticket: key, confirm: true}, io: {provider}})
      assert.equal(refused.phase, 'RESOLVE_BLOCKED', `${key}로 확정했다`)
    }
    // 트래커를 바꿔 부르면 막는다.
    assert.equal((await runPublishResolve({root, flags: {resolve: W(1), ticket: 'PF-101', 'ticket-provider': 'github'}, io: {provider}})).phase, 'RESOLVE_BLOCKED')
    // 확인 없이는 미리보기다.
    const preview = await runPublishResolve({root, flags: {resolve: W(1), ticket: 'PF-101'}, io: {provider}})
    assert.equal(preview.phase, 'RESOLVE_PREVIEW')
    assert.equal(foldWorkState(readWorkEvents(join(root, WORK_EVENTS_PATH))).works.get(W(1)).status, 'unknown')
    const resolved = await runPublishResolve({root, flags: {resolve: W(1), ticket: 'PF-101', confirm: true}, io: {provider}})
    assert.equal(resolved.phase, 'RESOLVED')
    const state = foldWorkState(readWorkEvents(join(root, WORK_EVENTS_PATH)))
    assert.equal(state.works.get(W(1)).status, 'published')
    assert.equal(state.works.get(W(1)).ticketKey, 'PF-101')
    assert.equal(state.works.get(W(1)).operationId, operationId, '원래 시도와 이어지지 않았다')
    // 이미 확정된 것은 풀 대상이 아니다 — 새 발행을 이 입구로 우회시키지 않는다.
    assert.equal((await runPublishResolve({root, flags: {resolve: W(1), ticket: 'PF-101', confirm: true}, io: {provider}})).phase, 'RESOLVE_BLOCKED')
    assert.equal((await runPublishResolve({root, flags: {resolve: W(3), ticket: 'PF-102', confirm: true}, io: {provider}})).phase, 'RESOLVE_BLOCKED')
  } finally { rmSync(root, {recursive: true, force: true}) }
})

test('확정: 결과를 모르는 집계 티켓도 같은 방식으로 — 집계 마커로 확인한다', async () => {
  const root = workspace()
  try {
    append(root, {featureId: 'FEAT-001', operationId: randomUUID(), eventType: 'aggregate-attempted', payload: {payloadDigest: 'c'.repeat(64)}})
    append(root, {featureId: 'FEAT-001', operationId: randomUUID(), eventType: 'aggregate-unknown', payload: {reason: 'timeout'}})
    const provider = {name: 'jira', async resolveIssue(key) {
      return {body: key === 'PF-500' ? `요약\n\n${buildAggregateMarker({planId: plan.planId, featureId: 'FEAT-001'})}` : `요약\n\n${buildAggregateMarker({planId: plan.planId, featureId: 'FEAT-002'})}`}
    }}
    assert.equal((await runPublishResolve({root, flags: {resolve: 'FEAT-001', ticket: 'PF-501', confirm: true}, io: {provider}})).phase, 'RESOLVE_BLOCKED')
    assert.equal((await runPublishResolve({root, flags: {resolve: 'FEAT-001', ticket: 'PF-500', confirm: true}, io: {provider}})).phase, 'RESOLVED')
    assert.equal(foldWorkState(readWorkEvents(join(root, WORK_EVENTS_PATH))).aggregates.get('FEAT-001').ticketKey, 'PF-500')
  } finally { rmSync(root, {recursive: true, force: true}) }
})

test('배선: `claim --publish --resolve`가 확정 입구로 가고, 결과를 모르는 발행이 아니면 트래커를 부르기 전에 막는다', () => {
  const root = workspace()
  try {
    writeFileSync(join(root, '_workspace/03_dev/ticket-provider.json'),
      JSON.stringify({provider: 'jira', jira: {baseUrl: 'https://jira.invalid', projectKey: 'PF', issueType: 'Task'}}))
    const run = spawnSync(process.execPath, [join(repo, '.claude/scripts/ticket/cli.mjs'), 'claim', '--publish', '--resolve', W(1), '--ticket', 'PF-1', '--root', root],
      {encoding: 'utf8', env: {PATH: process.env.PATH, HOME: process.env.HOME}, timeout: 30000})
    const result = JSON.parse(run.stdout)
    assert.equal(result.phase, 'RESOLVE_BLOCKED', run.stdout + run.stderr)
    assert.match(result.errors.join(' '), /결과를 모르는 발행이 아니다/)
  } finally { rmSync(root, {recursive: true, force: true}) }
})

test('T11: 원장이 깨졌으면 인테이크도 멈춘다 — 발행 여부를 모르는 채 공급 원문으로 받지 않는다', async () => {
  const root = workspace()
  try {
    mkdirSync(join(root, '_workspace/00_source'), {recursive: true})
    writeFileSync(join(root, WORK_EVENTS_PATH), '{깨진 줄\n')
    const io = {provider: {name: 'jira'}, resolveIssue: async () => ({title: 't', body: '본문', url: 'https://jira/PF-1'})}
    await assert.rejects(() => runIntake({root, repo: 'o/r', ticketKey: 'PF-1', flags: {}, io}), /WORK_EVENTS_CORRUPT/)
  } finally { rmSync(root, {recursive: true, force: true}) }
})
