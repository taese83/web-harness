import assert from 'node:assert/strict'
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test from 'node:test'
import {listChangeRequestReviews, recordChangeRequestReview} from '../src/change-request-reviews.mjs'

const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'web-harness-console-review-'))
  mkdirSync(join(root, '_workspace', '01_plan'), {recursive: true})
  const request = {
    id: 'CHG-20260806-001',
    context: {featureId: 'FEAT-001', subFeatureId: 'FEAT-001-01', testCaseIds: ['TC-001-1'], sourceDigest: null, previewDigest: null},
  }
  const applyRun = {
    runId: 'RUN-CHG-20260806-001-apply-019fcf35-48fe-7d93-bb95-3304a2732950',
    changeRequestId: request.id,
    phase: 'apply',
    status: 'COMPLETED',
    result: {
      outcome: 'READY_FOR_REVIEW',
      affectedFeatureIds: ['FEAT-001'],
      affectedSubFeatureIds: ['FEAT-001-01'],
      affectedTestCaseIds: ['TC-001-1'],
      sourceDigest: null,
      previewDigest: null,
    },
  }
  return {root, request, applyRun}
}

test('review decisions append once, bind to the exact apply run, and replay idempotently', t => {
  const value = fixture()
  t.after(() => rmSync(value.root, {recursive: true, force: true}))
  const options = {
    idempotencyKey: '019fcf35-48fe-7d93-bb95-3304a2732951',
    applyRun: value.applyRun,
    now: new Date('2026-08-06T07:00:00.000Z'),
    uuid: () => '019fcf35-48fe-7d93-bb95-3304a2732952',
  }
  const created = recordChangeRequestReview(value.root, value.request, {decision: 'REVISION_REQUESTED', reason: '버튼 간격을 다시 확인해 주세요.'}, options)
  assert.equal(created.created, true)
  assert.equal(created.reviewDecision.applyRunId, value.applyRun.runId)
  assert.equal(created.reviewDecision.idempotencyKey, undefined)

  const replay = recordChangeRequestReview(value.root, value.request, {decision: 'REVISION_REQUESTED', reason: 'ignored replay'}, options)
  assert.equal(replay.created, false)
  assert.equal(replay.reviewDecision.eventId, created.reviewDecision.eventId)
  assert.equal(listChangeRequestReviews(value.root, value.request.id).length, 1)
  const audit = readFileSync(join(value.root, '_workspace', '03_dev', 'change-request-decisions', `${value.request.id}.jsonl`), 'utf8')
  assert.equal(audit.trim().split('\n').length, 1)
})

test('review decisions reject invalid transitions and terminal rewrites', t => {
  const value = fixture()
  t.after(() => rmSync(value.root, {recursive: true, force: true}))
  const base = {idempotencyKey: '019fcf35-48fe-7d93-bb95-3304a2732953', applyRun: value.applyRun}
  assert.throws(
    () => recordChangeRequestReview(value.root, value.request, {decision: 'DISCARDED', reason: ''}, base),
    error => error.code === 'INVALID_REVIEW_DECISION',
  )
  assert.throws(
    () => recordChangeRequestReview(value.root, value.request, {decision: 'APPROVED'}, {...base, applyRun: {...value.applyRun, status: 'RUNNING'}}),
    error => error.code === 'REVIEW_NOT_READY',
  )
  const approval = recordChangeRequestReview(value.root, value.request, {decision: 'APPROVED', reason: ''}, base)
  assert.equal(approval.reviewDecision.featureLinks.targetFeatureId, 'FEAT-001')
  assert.equal(approval.reviewDecision.featureLinks.scopeSource, 'apply-result')
  assert.throws(
    () => recordChangeRequestReview(value.root, value.request, {decision: 'DISCARDED', reason: '다른 결정'}, {...base, idempotencyKey: '019fcf35-48fe-7d93-bb95-3304a2732954'}),
    error => error.code === 'REVIEW_ALREADY_TERMINAL',
  )
})

test('approval rejects an apply scope that omits its Change Request target', t => {
  const value = fixture()
  t.after(() => rmSync(value.root, {recursive: true, force: true}))
  const applyRun = {
    ...value.applyRun,
    result: {...value.applyRun.result, affectedFeatureIds: ['FEAT-002'], affectedSubFeatureIds: []},
  }
  assert.throws(
    () => recordChangeRequestReview(value.root, value.request, {decision: 'APPROVED', reason: ''}, {
      idempotencyKey: '019fcf35-48fe-7d93-bb95-3304a2732956',
      applyRun,
    }),
    error => error.code === 'REVIEW_TARGET_MISMATCH',
  )
})

test('legacy apply results use an explicit request-context approval snapshot', t => {
  const value = fixture()
  t.after(() => rmSync(value.root, {recursive: true, force: true}))
  const approval = recordChangeRequestReview(value.root, value.request, {decision: 'APPROVED', reason: ''}, {
    idempotencyKey: '019fcf35-48fe-7d93-bb95-3304a2732957',
    applyRun: {...value.applyRun, result: {outcome: 'READY_FOR_REVIEW'}},
  })
  assert.equal(approval.reviewDecision.featureLinks.scopeSource, 'request-context-legacy')
  assert.deepEqual(approval.reviewDecision.featureLinks.affectedSubFeatureIds, ['FEAT-001-01'])
})

test('review mutation fails closed when an existing audit is malformed', t => {
  const value = fixture()
  t.after(() => rmSync(value.root, {recursive: true, force: true}))
  const directory = join(value.root, '_workspace', '03_dev', 'change-request-decisions')
  mkdirSync(directory, {recursive: true})
  const path = join(directory, `${value.request.id}.jsonl`)
  writeFileSync(path, '{not-json}\n')
  assert.throws(
    () => recordChangeRequestReview(value.root, value.request, {decision: 'APPROVED', reason: ''}, {
      idempotencyKey: '019fcf35-48fe-7d93-bb95-3304a2732955',
      applyRun: value.applyRun,
    }),
    error => error.code === 'REVIEW_HISTORY_INVALID',
  )
  assert.equal(readFileSync(path, 'utf8'), '{not-json}\n')
})

test('targetless approvals require structured scope and validate against post-promotion features', t => {
  const value = fixture()
  t.after(() => rmSync(value.root, {recursive: true, force: true}))
  const targetlessRequest = {
    id: value.request.id,
    context: {bootstrap: false, newFeature: true, featureId: null, subFeatureId: null, testCaseIds: [], sourceDigest: null, previewDigest: null},
  }
  // 검증은 승격 이후 재인덱스된 canonical 기준 — 신설 FEAT-202가 이미 인덱싱된 상태를 모사한다.
  const postPromotionFeatures = [{featureId: 'FEAT-201', subFeatures: []}, {featureId: 'FEAT-202', subFeatures: []}]
  const planApplyRun = {
    ...value.applyRun,
    result: {
      outcome: 'READY_FOR_REVIEW',
      affectedFeatureIds: ['FEAT-202'],
      affectedSubFeatureIds: [],
      affectedTestCaseIds: ['TC-202-1'],
      sourceDigest: null,
      previewDigest: null,
    },
  }

  // 구조화 범위 없는 결과는 거부
  assert.throws(
    () => recordChangeRequestReview(value.root, targetlessRequest, {decision: 'APPROVED', reason: ''}, {
      idempotencyKey: '019fcf35-48fe-7d93-bb95-3304a2732970',
      applyRun: {...planApplyRun, result: {...planApplyRun.result, affectedFeatureIds: []}},
      features: postPromotionFeatures,
    }),
    error => error.code === 'REVIEW_SCOPE_INVALID',
  )
  // 승격 후 canonical에 없는 id는 일반 CR과 동일하게 거부
  assert.throws(
    () => recordChangeRequestReview(value.root, targetlessRequest, {decision: 'APPROVED', reason: ''}, {
      idempotencyKey: '019fcf35-48fe-7d93-bb95-3304a2732971',
      applyRun: {...planApplyRun, result: {...planApplyRun.result, affectedFeatureIds: ['FEAT-999']}},
      features: postPromotionFeatures,
    }),
    error => error.code === 'REVIEW_SCOPE_INVALID',
  )
  // 신설 FEAT-202 승인 성공 — featureLinks에 기록된다
  const approval = recordChangeRequestReview(value.root, targetlessRequest, {decision: 'APPROVED', reason: ''}, {
    idempotencyKey: '019fcf35-48fe-7d93-bb95-3304a2732972',
    applyRun: planApplyRun,
    features: postPromotionFeatures,
  })
  assert.equal(approval.created, true)
  assert.deepEqual(approval.reviewDecision.featureLinks.affectedFeatureIds, ['FEAT-202'])
  // 읽기 왕복 — targetFeatureId null 이벤트가 읽기 검증에서 탈락하면 종결 보호가
  // 무력화된다(실측 결함 회귀 방지).
  const readBack = listChangeRequestReviews(value.root, value.request.id)
  assert.equal(readBack.length, 1)
  assert.equal(readBack[0].decision, 'APPROVED')
  assert.equal(readBack[0].featureLinks.targetFeatureId, null)
})
