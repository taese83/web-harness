import assert from 'node:assert/strict'
import {mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test from 'node:test'
import {createChangeRequest, listChangeRequests, reviseChangeRequest} from '../src/change-requests.mjs'

const projectFixture = root => ({
  root,
  preview: {status: 'ABSENT', sourceDigest: null, previewDigest: null},
  features: [{
    featureId: 'FEAT-001',
    testCaseIds: ['TC-001-1'],
    subFeatures: [],
    relatedDocuments: [],
    previewMapping: {anchors: []},
  }],
})

test('change request storage rejects a symlinked append-only directory', t => {
  const root = mkdtempSync(join(tmpdir(), 'web-harness-console-change-request-'))
  const projectRoot = join(root, 'project')
  const outside = join(root, 'outside')
  mkdirSync(join(projectRoot, '_workspace', '01_plan'), {recursive: true})
  mkdirSync(outside)
  symlinkSync(outside, join(projectRoot, '_workspace', '01_plan', 'change-requests'))
  t.after(() => rmSync(root, {recursive: true, force: true}))

  const project = projectFixture(projectRoot)
  assert.throws(() => createChangeRequest(project, {
    targetFeatureId: 'FEAT-001',
    title: 'Safe boundary',
    requestedChange: 'Record this request.',
    reason: 'Verify path containment.',
    expectedBehavior: 'No file escapes the project.',
    versionIntent: 'patch',
  }, {idempotencyKey: '019fcf35-48fe-7d93-bb95-3304a2732950'}), error => error.code === 'UNSAFE_CHANGE_REQUEST_PATH')
  assert.deepEqual(readdirSync(outside), [])
})

test('request revisions preserve the original and expose an idempotent effective history', t => {
  const root = mkdtempSync(join(tmpdir(), 'web-harness-console-change-revision-'))
  mkdirSync(join(root, '_workspace', '01_plan'), {recursive: true})
  t.after(() => rmSync(root, {recursive: true, force: true}))
  const project = projectFixture(root)
  const created = createChangeRequest(project, {
    targetFeatureId: 'FEAT-001',
    title: 'Original title',
    requestedChange: 'Original request.',
    reason: 'Original reason.',
    expectedBehavior: 'Original behavior.',
    versionIntent: 'patch',
  }, {idempotencyKey: '019fcf35-48fe-7d93-bb95-3304a2732950', now: new Date('2026-08-06T01:00:00Z')})
  const originalPath = join(root, '_workspace', '01_plan', 'change-requests', `${created.changeRequest.id}.md`)
  const originalSource = readFileSync(originalPath, 'utf8')

  const input = {
    title: 'Corrected title',
    requestedChange: 'Corrected request.',
    reason: 'Impact assumptions were wrong.',
    expectedBehavior: 'Corrected behavior.',
    versionIntent: 'minor',
  }
  const revised = reviseChangeRequest(root, created.changeRequest.id, input, {
    idempotencyKey: '019fcf35-48fe-7d93-bb95-3304a2732951',
    now: new Date('2026-08-06T02:00:00Z'),
  })
  assert.equal(revised.created, true)
  assert.equal(revised.revision.revisionId, `${created.changeRequest.id}-REV-001`)
  assert.equal(revised.changeRequest.title, 'Corrected title')
  assert.equal(revised.changeRequest.revisionCount, 1)
  assert.notEqual(revised.changeRequest.currentDigest, created.changeRequest.currentDigest)
  assert.equal(readFileSync(originalPath, 'utf8'), originalSource)
  assert.equal(revised.changeRequest.currentRevision.path, `_workspace/01_plan/change-request-revisions/${created.changeRequest.id}-REV-001.md`)

  const replay = reviseChangeRequest(root, created.changeRequest.id, input, {idempotencyKey: '019fcf35-48fe-7d93-bb95-3304a2732951'})
  assert.equal(replay.created, false)
  assert.equal(replay.changeRequest.revisionCount, 1)
  assert.equal(listChangeRequests(root)[0].requestedChange, 'Corrected request.')
  assert.throws(
    () => reviseChangeRequest(root, created.changeRequest.id, input, {idempotencyKey: '019fcf35-48fe-7d93-bb95-3304a2732952'}),
    error => error.code === 'CHANGE_REQUEST_REVISION_UNCHANGED',
  )
})

test('request revision storage rejects a symlinked append-only directory', t => {
  const root = mkdtempSync(join(tmpdir(), 'web-harness-console-change-revision-symlink-'))
  const outside = join(root, 'outside')
  mkdirSync(join(root, '_workspace', '01_plan'), {recursive: true})
  mkdirSync(outside)
  t.after(() => rmSync(root, {recursive: true, force: true}))
  const created = createChangeRequest(projectFixture(root), {
    targetFeatureId: 'FEAT-001', title: 'Original', requestedChange: 'Original request.', reason: 'Original reason.', expectedBehavior: 'Original behavior.', versionIntent: 'patch',
  }, {idempotencyKey: '019fcf35-48fe-7d93-bb95-3304a2732960'})
  symlinkSync(outside, join(root, '_workspace', '01_plan', 'change-request-revisions'))
  assert.throws(() => reviseChangeRequest(root, created.changeRequest.id, {
    title: 'Revised', requestedChange: 'Revised request.', reason: 'Revised reason.', expectedBehavior: 'Revised behavior.', versionIntent: 'patch',
  }, {idempotencyKey: '019fcf35-48fe-7d93-bb95-3304a2732961'}), error => error.code === 'UNSAFE_CHANGE_REQUEST_PATH')
  assert.deepEqual(readdirSync(outside), [])
})

test('bootstrap change request works without features and round-trips its null target', t => {
  const root = mkdtempSync(join(tmpdir(), 'web-harness-console-change-bootstrap-'))
  mkdirSync(join(root, '_workspace', '01_plan'), {recursive: true})
  t.after(() => rmSync(root, {recursive: true, force: true}))
  const emptyProject = {root, preview: {status: 'ABSENT', sourceDigest: null, previewDigest: null}, features: []}

  const base = {
    title: '재고 알림 추가',
    requestedChange: '재고가 임계치 아래로 내려가면 알림을 보여주세요.',
    reason: '품절을 늦게 발견합니다.',
    expectedBehavior: '임계치 이하일 때 목록에 경고 배지가 보인다.',
    versionIntent: 'minor',
  }

  // bootstrap 없이 빈 프로젝트 → 기존 규칙대로 거부
  assert.throws(() => createChangeRequest(emptyProject, {...base, targetFeatureId: 'FEAT-001'},
    {idempotencyKey: '019fcf35-48fe-7d93-bb95-3304a2732951'}), error => error.code === 'CHANGE_REQUEST_TARGET_NOT_FOUND')
  // bootstrap + 대상 지정은 모순 → 거부
  assert.throws(() => createChangeRequest(emptyProject, {...base, bootstrap: true, targetFeatureId: 'FEAT-001'},
    {idempotencyKey: '019fcf35-48fe-7d93-bb95-3304a2732952'}), error => error.code === 'INVALID_CHANGE_REQUEST')
  // bootstrap은 FEAT 보유 프로젝트에서 거부 — 서버 제한이 UI 노출 조건과 일치
  const populated = {...emptyProject, features: [{featureId: 'FEAT-001', testCaseIds: [], subFeatures: [], relatedDocuments: [], previewMapping: {anchors: []}}]}
  assert.throws(() => createChangeRequest(populated, {...base, bootstrap: true},
    {idempotencyKey: '019fcf35-48fe-7d93-bb95-3304a2732954'}), error => error.code === 'INVALID_CHANGE_REQUEST')

  const {created, changeRequest} = createChangeRequest(emptyProject, {...base, bootstrap: true},
    {idempotencyKey: '019fcf35-48fe-7d93-bb95-3304a2732953'})
  assert.equal(created, true)
  assert.equal(changeRequest.context.bootstrap, true)
  assert.equal(changeRequest.context.featureId, null)
  assert.deepEqual(changeRequest.context.testCaseIds, [])

  const stored = readFileSync(join(root, '_workspace', '01_plan', 'change-requests', `${changeRequest.id}.md`), 'utf8')
  assert.match(stored, /- Target: PROJECT_BOOTSTRAP/)
  const listed = listChangeRequests(root)
  assert.equal(listed[0].context.bootstrap, true)
  assert.equal(listed[0].context.featureId, null)
})

test('newFeature change request is targetless on populated projects and rejected on empty ones', t => {
  const root = mkdtempSync(join(tmpdir(), 'web-harness-console-change-newfeature-'))
  mkdirSync(join(root, '_workspace', '01_plan'), {recursive: true})
  t.after(() => rmSync(root, {recursive: true, force: true}))
  const populated = projectFixture(root)
  const base = {
    title: '알림 센터 신설',
    requestedChange: '기존 기능과 무관한 알림 센터를 추가해 주세요.',
    reason: '변경 소식을 모아 볼 곳이 없습니다.',
    expectedBehavior: '상단에 알림 센터 아이콘이 생기고 목록이 열린다.',
    versionIntent: 'minor',
  }

  // 빈 프로젝트에서는 거부(bootstrap 사용 안내)
  const emptyProject = {...populated, features: []}
  assert.throws(() => createChangeRequest(emptyProject, {...base, newFeature: true},
    {idempotencyKey: '019fcf35-48fe-7d93-bb95-3304a2732960'}), error => error.code === 'INVALID_CHANGE_REQUEST')
  // bootstrap과 동시 지정은 모순
  assert.throws(() => createChangeRequest(populated, {...base, newFeature: true, bootstrap: true},
    {idempotencyKey: '019fcf35-48fe-7d93-bb95-3304a2732961'}), error => error.code === 'INVALID_CHANGE_REQUEST')
  // 대상 지정과 동시 사용은 모순
  assert.throws(() => createChangeRequest(populated, {...base, newFeature: true, targetFeatureId: 'FEAT-001'},
    {idempotencyKey: '019fcf35-48fe-7d93-bb95-3304a2732962'}), error => error.code === 'INVALID_CHANGE_REQUEST')

  const {created, changeRequest} = createChangeRequest(populated, {...base, newFeature: true},
    {idempotencyKey: '019fcf35-48fe-7d93-bb95-3304a2732963'})
  assert.equal(created, true)
  assert.equal(changeRequest.context.newFeature, true)
  assert.equal(changeRequest.context.bootstrap, false)
  assert.equal(changeRequest.context.featureId, null)
  const stored = readFileSync(join(root, '_workspace', '01_plan', 'change-requests', `${changeRequest.id}.md`), 'utf8')
  assert.match(stored, /- Target: NEW_FEATURE/)
  assert.equal(listChangeRequests(root)[0].context.newFeature, true)
})
