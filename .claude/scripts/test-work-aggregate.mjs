#!/usr/bin/env node
// test-work-aggregate.mjs — 부모 FEAT 집계: 머지를 인수로 부르지 않고, 유예 두 종류를 다르게 센다.
//
// 고정하는 사실:
//   §4.5  제품 유예는 분모에서 빠지고(뺐다고 적는다), 후속 상세화는 분모에 남아 끝나지 않는다
//   T17·T19  작업이 머지돼도 부모는 닫을 수 없다 — 통합 revision의 TC 증거가 아직 연결되지 않았다(이유를 낸다)
//   T24  인수로 넘긴 완료·계획의 TC 유예는 `works-merged`로 접히지 않고 따로 표시된다
//   §5.3 책임 없는 TC·취소된 필수 작업은 분모를 줄이는 것이 아니라 계획 불일치다
//   집계 티켓: 확인한 판본만, 쓰기 전 시도 기록, 결과를 모르면 사람에게, 본문이 같으면 다시 쓰지 않는다
import assert from 'node:assert/strict'
import test from 'node:test'
import {cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {randomUUID} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import {aggregateFeatures, CLOSE_BLOCKERS} from './ticket/work-aggregate.mjs'
import {runAggregatePublish, runFeatureBoard} from './ticket/work-aggregate-run.mjs'
import {runClaimWork} from './ticket/work-claim.mjs'
import {appendWorkEvent, foldWorkState, readWorkEvents, WORK_EVENTS_PATH} from './ticket/work-events.mjs'
import {canonicalDigest} from './ticket/work-analysis.mjs'
import {parseFeaturePlanUnits} from './ticket/plan-units.mjs'
import {fromAdf, toAdf} from './ticket/provider-jira.mjs'
import {buildAggregateMarker, classifyTicketKind} from './ticket/work-refs.mjs'

const repo = new URL('../..', import.meta.url).pathname
const FIXTURE = join(repo, '.claude/evals/fixtures/work-plan/crud')
const plan = JSON.parse(readFileSync(join(FIXTURE, '_workspace/03_dev/work-plan.json'), 'utf8'))
const analysis = JSON.parse(readFileSync(join(FIXTURE, '_workspace/03_dev/work-analysis.json'), 'utf8'))
const planText = readFileSync(join(FIXTURE, '_workspace/01_plan/feature-plan.md'), 'utf8')
const planUnits = parseFeaturePlanUnits(planText)
const W = n => `WORK-0000000${n}-0000-4000-8000-00000000000${n}`
const ALL = [1, 3, 4, 5, 6, 7].map(W)
const stateWith = (entries = {}) => ({works: new Map(Object.entries(entries)), aggregates: new Map()})
const merged = ids => stateWith(Object.fromEntries(ids.map(id => [id, {status: 'published', ticketKey: `PF-${id.slice(12, 13)}`, link: {prUrl: 'u'}, completed: {prUrl: 'u'}}])))
const byId = result => new Map(result.features.map(feature => [feature.featureId, feature]))

test('§4.5: 제품 유예는 분모에서 빠지고, 후속 상세화는 분모에 남아 끝나지 않는다', () => {
  const result = aggregateFeatures({plan, analysis, state: merged(ALL), planUnits, planText})
  const features = byId(result)
  assert.equal(features.get('FEAT-004').status, 'deferred-product')
  assert.equal(features.get('FEAT-004').counted, false)
  assert.equal(features.get('FEAT-005').status, 'awaiting-follow-up')
  assert.equal(features.get('FEAT-005').counted, true, '후속 상세화가 분모를 줄였다')
  assert.deepEqual(result.denominator.excluded, ['FEAT-004'])
  assert.equal(result.denominator.counted, 4)
  // 모든 작업이 머지돼도 후속 상세화 FEAT는 완료로 세지 않고, 유예가 있는 FEAT는 따로 센다.
  assert.equal(result.denominator.worksMerged, 2)
  assert.equal(result.denominator.worksMergedWithDeferrals, 1)
})

test('T17·T19: 작업이 전부 머지돼도 부모는 닫을 수 없다 — 이유를 낸다', () => {
  const features = byId(aggregateFeatures({plan, analysis, state: merged(ALL), planUnits, planText}))
  const feat1 = features.get('FEAT-001')
  assert.equal(feat1.status, 'works-merged')
  assert.equal(feat1.closeEligible, false)
  assert.equal(feat1.evidence, 'not-connected')
  assert.ok(feat1.closeBlockers.includes(CLOSE_BLOCKERS.evidence), '증거 없이 닫을 수 있다고 했다')
  for (const feature of features.values()) assert.equal(feature.closeEligible, false, `${feature.featureId}를 닫을 수 있다고 했다`)
})

test('진행 단계: 시작 전 → 진행 중 → 머지 — PR 연결은 머지가 아니다', () => {
  assert.equal(byId(aggregateFeatures({plan, analysis, state: stateWith(), planUnits, planText})).get('FEAT-001').status, 'not-started')
  const linkedOnly = stateWith(Object.fromEntries(ALL.map(id => [id, {status: 'published', link: {prUrl: 'u'}}])))
  const feat1 = byId(aggregateFeatures({plan, analysis, state: linkedOnly, planUnits, planText})).get('FEAT-001')
  assert.equal(feat1.status, 'in-progress', 'PR만 연결된 작업을 머지로 셌다')
  assert.match(feat1.closeBlockers.join(' '), /works-not-merged/)
})

test('T24: 인수로 넘긴 완료와 계획의 TC 유예는 따로 표시된다', () => {
  const withException = merged(ALL)
  withException.works.set(W(4), {...withException.works.get(W(4)), link: {prUrl: 'u', acceptedIncomplete: true}})
  const features = byId(aggregateFeatures({plan, analysis, state: withException, planUnits, planText}))
  assert.equal(features.get('FEAT-001').status, 'works-merged-with-exceptions')
  assert.match(features.get('FEAT-001').closeBlockers.join(' '), /accepted-with-exceptions: WORK-00000004/)
  // FEAT-003의 TC-003-3은 계획이 유예했다.
  const clean = byId(aggregateFeatures({plan, analysis, state: merged(ALL), planUnits, planText}))
  assert.equal(clean.get('FEAT-003').status, 'works-merged-with-deferrals')
  assert.deepEqual(clean.get('FEAT-003').testCases.deferred, ['TC-003-3'])
})

test('§5.3: 책임 없는 TC·취소된 필수 작업은 분모를 줄이지 않고 계획 불일치다', () => {
  const unowned = {...plan, featureBindings: plan.featureBindings.map(binding => binding.featureId === 'FEAT-001'
    ? {...binding, acceptanceOwners: binding.acceptanceOwners.filter(owner => owner.testCaseId !== 'TC-001-3')} : binding)}
  const feat1 = byId(aggregateFeatures({plan: unowned, analysis, state: merged(ALL), planUnits, planText})).get('FEAT-001')
  assert.equal(feat1.status, 'plan-inconsistent')
  assert.deepEqual(feat1.testCases.unowned, ['TC-001-3'])
  const cancelled = {...plan, workItems: plan.workItems.map(work => work.workId === W(7) ? {...work, lifecycle: 'cancelled'} : work)}
  assert.equal(byId(aggregateFeatures({plan: cancelled, analysis, state: merged(ALL), planUnits, planText})).get('FEAT-001').status, 'plan-inconsistent')
})

// ── 실행부 ──────────────────────────────────────────────────────────────
const workspace = async () => {
  const root = mkdtempSync(join(tmpdir(), 'wh-aggregate-'))
  cpSync(FIXTURE, root, {recursive: true})
  assert.equal((await runClaimWork({root, flags: {}})).phase, 'P1_REVIEW')
  return root
}
const tracker = ({fail = false} = {}) => {
  const calls = []
  let sequence = 500
  return {calls, provider: {
    name: 'jira', featLabel: id => `feat-${id}`,
    buildWorkFields: draft => ({fields: {summary: draft.title, description: draft.body, labels: draft.labels}}),
    async createIssue(fields) { calls.push({kind: 'create', title: fields.fields.summary, labels: fields.fields.labels}); if (fail) throw new Error('JIRA_HTTP_502'); return {key: `PF-${++sequence}`} },
    async updateBody(key, body) { calls.push({kind: 'update', key, body}); return {updated: true} },
  }}
}

test('집계 티켓: 미리보기는 쓰지 않고, 확인하면 FEAT마다 하나 — 다시 부르면 바뀐 것만 갱신한다', async () => {
  const root = await workspace()
  try {
    const first = tracker()
    const preview = await runAggregatePublish({root, flags: {}, io: {provider: first.provider}})
    assert.equal(preview.phase, 'PUBLISH_PREVIEW')
    assert.equal(first.calls.length, 0)
    assert.deepEqual(preview.aggregates.filter(item => item.action === 'create').map(item => item.featureId), ['FEAT-001', 'FEAT-002', 'FEAT-003'])
    const created = await runAggregatePublish({root, flags: {confirm: true}, io: {provider: first.provider}})
    assert.equal(created.phase, 'PUBLISHED', JSON.stringify(created))
    assert.equal(first.calls.filter(call => call.kind === 'create').length, 3)
    assert.ok(first.calls[0].labels.includes('feat-FEAT-001') && first.calls[0].labels.includes('work-aggregate'))
    const ledger = readWorkEvents(join(root, WORK_EVENTS_PATH))
    const attemptAt = ledger.findIndex(event => event.eventType === 'aggregate-attempted' && event.featureId === 'FEAT-001')
    const confirmAt = ledger.findIndex(event => event.eventType === 'aggregate-confirmed' && event.featureId === 'FEAT-001')
    assert.ok(attemptAt >= 0 && attemptAt < confirmAt, '쓰기 전에 시도를 남기지 않았다')
    // 아무것도 안 바뀌었으면 다시 쓰지 않는다.
    const second = tracker()
    const again = await runAggregatePublish({root, flags: {confirm: true}, io: {provider: second.provider}})
    assert.equal(second.calls.length, 0, JSON.stringify(again))
    // 작업이 머지되면 본문이 바뀌고 — 새로 만들지 않고 갱신한다.
    const planDigest = canonicalDigest(plan)
    appendWorkEvent(join(root, WORK_EVENTS_PATH), {schemaVersion: 1, eventId: randomUUID(), operationId: randomUUID(), planId: plan.planId,
      workId: W(1), eventType: 'publish-confirmed', at: new Date().toISOString(), planDigest, payload: {ticketKey: 'PF-101'}})
    const third = tracker()
    const refreshed = await runAggregatePublish({root, flags: {confirm: true}, io: {provider: third.provider}})
    assert.equal(third.calls.filter(call => call.kind === 'create').length, 0, '집계 티켓을 FEAT마다 또 만들었다')
    assert.ok(third.calls.filter(call => call.kind === 'update').length >= 1, JSON.stringify(refreshed))
    assert.match(third.calls.find(call => call.kind === 'update').body, /PF-101/)
  } finally { rmSync(root, {recursive: true, force: true}) }
})

test('집계 티켓: 결과를 모르면 사람에게 넘기고 재발행하지 않는다 · 검토 뒤 바뀐 계획은 내지 않는다', async () => {
  const root = await workspace()
  try {
    const failing = tracker({fail: true})
    const first = await runAggregatePublish({root, flags: {confirm: true, features: 'FEAT-001'}, io: {provider: failing.provider}})
    assert.equal(first.phase, 'PUBLISHED_WITH_PENDING')
    assert.equal(foldWorkState(readWorkEvents(join(root, WORK_EVENTS_PATH))).aggregates.get('FEAT-001').status, 'unknown')
    const retry = tracker()
    const held = await runAggregatePublish({root, flags: {confirm: true, features: 'FEAT-001'}, io: {provider: retry.provider}})
    assert.equal(retry.calls.length, 0, '결과를 모르는데 다시 만들었다')
    assert.equal(held.results[0].action, 'hold')
    // 검토 뒤 계획이 바뀌면 막는다.
    const planPath = join(root, '_workspace/03_dev/work-plan.json')
    writeFileSync(planPath, JSON.stringify({...plan, workItems: plan.workItems.map((work, index) => index === 0 ? {...work, title: '바뀜'} : work)}))
    assert.equal((await runAggregatePublish({root, flags: {confirm: true}, io: {provider: tracker().provider}})).phase, 'PUBLISH_BLOCKED')
  } finally { rmSync(root, {recursive: true, force: true}) }
})

test('배선: `board --by-feature`가 집계를 돌려주고 인수 완료라 부르지 않는다', async () => {
  const root = await workspace()
  try {
    const run = spawnSync(process.execPath, [join(repo, '.claude/scripts/ticket/cli.mjs'), 'board', '--by-feature', '--root', root],
      {encoding: 'utf8', env: {PATH: process.env.PATH, HOME: process.env.HOME}, timeout: 30000})
    const result = JSON.parse(run.stdout)
    assert.equal(result.view, 'by-feature', run.stdout + run.stderr)
    assert.ok(result.notes.some(note => /인수 완료가 아니다/.test(note)))
    assert.deepEqual(result.denominator.excluded, ['FEAT-004'])
    const direct = await runFeatureBoard({root})
    assert.equal(direct.features.length, result.features.length)
  } finally { rmSync(root, {recursive: true, force: true}) }
})

test('TC 책임을 대조하지 못하면 머지돼도 `works-merged`라 부르지 않고, 집계 발행을 막는다', async () => {
  const unchecked = byId(aggregateFeatures({plan, analysis, state: merged(ALL), planUnits: null, planText: ''}))
  assert.equal(unchecked.get('FEAT-001').status, 'merged-tc-unchecked')
  assert.match(unchecked.get('FEAT-001').closeBlockers.join(' '), /tc-ownership-not-checked/)
  // 계획 문서에 unit이 없는 FEAT도 같다.
  const missingUnit = byId(aggregateFeatures({plan, analysis, state: merged(ALL), planUnits: planUnits.filter(unit => unit.featureId !== 'FEAT-002'), planText}))
  assert.equal(missingUnit.get('FEAT-002').status, 'merged-tc-unchecked')
  // 필수 작업이 하나도 없는 바인딩은 영원한 시작 전이 아니라 계획 불일치다.
  const empty = {...plan, featureBindings: plan.featureBindings.map(binding => binding.featureId === 'FEAT-001' ? {...binding, requiredWorkIds: [], acceptanceOwners: []} : binding)}
  assert.equal(byId(aggregateFeatures({plan: empty, analysis, state: stateWith(), planUnits, planText})).get('FEAT-001').status, 'plan-inconsistent')
  const root = await workspace()
  try {
    rmSync(join(root, '_workspace/01_plan/feature-plan.md'))
    const blocked = await runAggregatePublish({root, flags: {confirm: true}, io: {provider: tracker().provider}})
    assert.equal(blocked.phase, 'PUBLISH_BLOCKED')
    assert.match(blocked.errors.join(' '), /TC 책임 대조를 하지 못했다/)
  } finally { rmSync(root, {recursive: true, force: true}) }
})

test('집계 발행: 검토 뒤 분석만 바꿔도(분모의 원천) 내지 않는다', async () => {
  const root = await workspace()
  try {
    const path = join(root, '_workspace/03_dev/work-analysis.json')
    const changed = {...analysis, scope: {...analysis.scope, featureDisposition: analysis.scope.featureDisposition.map(entry =>
      entry.featureId === 'FEAT-005' ? {...entry, deferral: 'product-deferral'} : entry)}}
    writeFileSync(path, JSON.stringify(changed))
    assert.equal((await runAggregatePublish({root, flags: {confirm: true}, io: {provider: tracker().provider}})).phase, 'PUBLISH_BLOCKED')
  } finally { rmSync(root, {recursive: true, force: true}) }
})

test('집계 마커는 Jira ADF 왕복 뒤에도 집계로 판정된다 — WORK·FEAT로 읽히지 않는다', () => {
  const body = `요약\n\n${buildAggregateMarker({planId: plan.planId, featureId: 'FEAT-001'})}`
  assert.equal(classifyTicketKind(fromAdf(toAdf(body))).kind, 'aggregate')
})
