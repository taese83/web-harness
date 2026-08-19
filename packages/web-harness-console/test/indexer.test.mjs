import assert from 'node:assert/strict'
import {existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test from 'node:test'
import {WorkspaceCatalog, parseFeaturePlan} from '../src/indexer.mjs'

const fixtureRoot = () => {
  const root = mkdtempSync(join(tmpdir(), 'web-harness-console-indexer-'))
  const project = join(root, 'workspace', 'alpha')
  for (const directory of ['00_source', '01_plan', '02_design', '03_dev', '04_qa']) {
    mkdirSync(join(project, '_workspace', directory), {recursive: true})
  }
  writeFileSync(join(project, '_workspace', '00_source', 'brief.md'), '# Brief\n')
  writeFileSync(join(project, '_workspace', '01_plan', 'ux-brief.md'), '# UX Brief\n')
  writeFileSync(join(project, '_workspace', '01_plan', 'feature-plan.md'), [
    '# Feature Plan',
    '| Page Group ID | 페이지 | Route/Screen | 순서 |',
    '|---|---|---|---|',
    '| PAGE-002 | Documents | documents | 2 |',
    '| PAGE-001 | Projects | projects | 1 |',
    '',
    '| FEAT ID | Feature | Priority | Page Group | Screen |',
    '|---|---|---|---|---|',
    '| FEAT-001 | Project discovery | Must | PAGE-001 | projects |',
    '| FEAT-002 | Document reader | Must | PAGE-002 | documents |',
    '',
    '- TC-001-1: finds a project',
    '- TC-002-1: reads an allowed document',
    '- TC-002-2: blocks a traversal path',
    '',
    '| Sub Feature ID | 동작 | 관련 Test Case | 화면/영역 | 이번 범위 |',
    '|---|---|---|---|---|',
    '| FEAT-001-01 | Discover project | TC-001-1 | project-list | keep |',
  ].join('\n'))
  writeFileSync(join(project, '_workspace', '02_design', 'design-system.md'), '# Design System\n')
  writeFileSync(join(project, '_workspace', '02_design', 'layout-spec.md'), '# Layout\n')
  writeFileSync(join(project, '_workspace', '02_design', 'component-spec.md'), '# Components\n')
  writeFileSync(join(project, '_workspace', '03_dev', 'secret.md'), 'must not be indexed\n')
  writeFileSync(join(project, '_workspace', '04_qa', 'qa.md'), 'must not be indexed\n')
  return {root, project}
}

test('parseFeaturePlan maps TC prefixes to their owning FEAT', () => {
  const features = parseFeaturePlan('| FEAT-001 | One | Must |\n| FEAT-002 | Two | Must |\nTC-001-1\nTC-002-1\nTC-002-2\n')
  assert.deepEqual(features.map(feature => [feature.featureId, feature.testCaseIds]), [
    ['FEAT-001', ['TC-001-1']],
    ['FEAT-002', ['TC-002-1', 'TC-002-2']],
  ])
})

test('parseFeaturePlan captures feature metadata, behavior, and structured test case detail', () => {
  const features = parseFeaturePlan([
    '| ID | 기능 | 사용자 가치 (1줄) | 우선순위 | 화면 | 이번 범위 |',
    '|---|---|---|---|---|---|',
    '| FEAT-001 | 도구 생성 | 새 도구를 시작 | Must | tool-list | keep |',
    '',
    '### FEAT-001 — 도구 생성',
    '**동작 명세**: 이름을 입력해 새 도구를 만든다.',
    '| Test Case | Given | When | Then |',
    '|---|---|---|---|',
    '| TC-001-1 (happy) | 도구 목록 | 저장 | 목록에 나타난다 |',
  ].join('\n'))
  assert.equal(features[0].summary, '새 도구를 시작')
  assert.equal(features[0].priority, 'Must')
  assert.equal(features[0].screen, 'tool-list')
  assert.deepEqual(features[0].pageGroup, {id: null, label: 'tool-list', route: 'tool-list', order: null, source: 'screen-fallback'})
  assert.equal(features[0].scope, 'keep')
  assert.equal(features[0].description, '이름을 입력해 새 도구를 만든다.')
  assert.deepEqual(features[0].testCases[0], {
    testCaseId: 'TC-001-1',
    label: 'happy',
    given: '도구 목록',
    when: '저장',
    then: '목록에 나타난다',
    description: '',
  })
})

test('parseFeaturePlan resolves explicit page groups and keeps unknown or missing plans visible', () => {
  const features = parseFeaturePlan([
    '## Page Groups',
    '| Page Group ID | 페이지 | Route/Screen | 순서 |',
    '|---|---|---|---|',
    '| PAGE-002 | 도구 상세 | tool-detail | 2 |',
    '| PAGE-001 | 도구 목록 | tool-list | 1 |',
    '',
    '## Feature List',
    '| ID | 기능 | 사용자 가치 (1줄) | 우선순위 | 페이지 그룹 | 화면 | 이번 범위 |',
    '|---|---|---|---|---|---|---|',
    '| FEAT-001 | 도구 생성 | 새 도구 시작 | Must | PAGE-001 | tool-list | keep |',
    '| FEAT-002 | 상세 편집 | 구조 관리 | Must | PAGE-002 | tool-detail/edit | keep |',
    '| FEAT-003 | 미래 페이지 | 후속 범위 | Should | PAGE-099 | future | defer |',
    '| FEAT-004 | 내부 검사 | 안전성 확인 | Should |  |  | defer |',
  ].join('\n'))
  assert.deepEqual(features.map(feature => feature.pageGroup), [
    {id: 'PAGE-001', label: '도구 목록', route: 'tool-list', order: 1, source: 'explicit'},
    {id: 'PAGE-002', label: '도구 상세', route: 'tool-detail', order: 2, source: 'explicit'},
    {id: 'PAGE-099', label: 'PAGE-099', route: 'future', order: null, source: 'unknown-reference'},
    {id: null, label: '미분류', route: '', order: null, source: 'ungrouped'},
  ])
})

test('parseFeaturePlan keeps parent FEAT and parses optional hierarchical subfeatures', () => {
  const features = parseFeaturePlan([
    '| ID | 기능 | 사용자 가치 (1줄) | 우선순위 | 화면 | 이번 범위 |',
    '|---|---|---|---|---|---|',
    '| FEAT-004 | 테이블 관리 | 구조를 관리 | Must | tool-detail | keep |',
    '',
    '#### FEAT-004 하위 기능',
    '| Sub Feature ID | 동작 | 관련 Test Case | 화면/영역 | 이번 범위 |',
    '|---|---|---|---|---|',
    '| FEAT-004-01 | 테이블 생성 | TC-004-1 | tool-detail/create | keep |',
    '| FEAT-004-02 | 테이블 이름 변경 | TC-004-2, TC-004-5 | tool-detail/row | keep |',
    '',
    '- TC-004-1: creates a table',
    '- TC-004-2: renames a table',
    '- TC-004-5: rejects an empty name',
  ].join('\n'))
  assert.equal(features.length, 1)
  assert.deepEqual(features[0].subFeatures, [
    {subFeatureId: 'FEAT-004-01', title: '테이블 생성', testCaseIds: ['TC-004-1'], screen: 'tool-detail/create', scope: 'keep'},
    {subFeatureId: 'FEAT-004-02', title: '테이블 이름 변경', testCaseIds: ['TC-004-2', 'TC-004-5'], screen: 'tool-detail/row', scope: 'keep'},
  ])
})

test('catalog indexes only source, plan, and design and reports session changes', t => {
  const fixture = fixtureRoot()
  t.after(() => rmSync(fixture.root, {recursive: true, force: true}))
  const catalog = new WorkspaceCatalog(fixture.root)
  const projects = catalog.list().projects
  assert.equal(projects.length, 1)
  assert.equal(projects[0].name, 'alpha')
  assert.deepEqual(projects[0].phaseCounts, {source: 1, plan: 2, design: 3})
  assert.equal(projects[0].featureCount, 2)
  assert.equal(projects[0].testCaseCount, 3)
  assert.equal(projects[0].preview.status, 'ABSENT')

  const detail = catalog.detail(projects[0].id)
  assert.equal(Object.keys(detail.documents).join(','), 'source,plan,design')
  assert.equal(detail.documents.design.some(document => document.path.includes('03_dev')), false)
  assert.ok(detail.features[0].relatedDocuments.some(document => document.path.endsWith('/feature-plan.md')))
  assert.deepEqual(detail.features.map(feature => feature.pageGroup), [
    {id: 'PAGE-001', label: 'Projects', route: 'projects', order: 1, source: 'explicit'},
    {id: 'PAGE-002', label: 'Documents', route: 'documents', order: 2, source: 'explicit'},
  ])
  assert.deepEqual(detail.features[0].previewMapping, {available: false, unmappedReason: null, anchors: []})
  assert.equal(catalog.document(projects[0].id, '_workspace/03_dev/secret.md').error, 'DOCUMENT_NOT_FOUND')
  assert.equal(catalog.document(projects[0].id, '../../secret.md').error, 'DOCUMENT_NOT_FOUND')

  writeFileSync(join(fixture.project, '_workspace', '01_plan', 'ux-brief.md'), '# UX Brief\n\nChanged\n')
  writeFileSync(join(fixture.project, '_workspace', '02_design', 'api-schema.md'), '# API\n')
  catalog.refresh()
  const changes = catalog.detail(projects[0].id).changes
  assert.ok(changes.some(change => change.kind === 'modified' && change.path.endsWith('ux-brief.md')))
  assert.ok(changes.some(change => change.kind === 'added' && change.path.endsWith('api-schema.md')))

  const created = catalog.createChangeRequest(projects[0].id, {
    targetFeatureId: 'FEAT-001',
    subFeatureId: 'FEAT-001-01',
    title: 'Discovery revision',
    requestedChange: 'Clarify project discovery.',
    reason: 'The entry point is ambiguous.',
    expectedBehavior: 'The discovery action is explicit.',
    versionIntent: 'patch',
  }, {idempotencyKey: '019fcf35-48fe-7d93-bb95-3304a2732990', now: new Date('2026-08-06T07:00:00.000Z')})
  catalog.recordChangeRequestReview(projects[0].id, created.changeRequest.id, {decision: 'APPROVED', reason: 'Reviewed.'}, {
    idempotencyKey: '019fcf35-48fe-7d93-bb95-3304a2732991',
    applyRun: {
      runId: `RUN-${created.changeRequest.id}-apply-019fcf35-48fe-7d93-bb95-3304a2732992`,
      changeRequestId: created.changeRequest.id,
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
    },
  })
  const approvedDetail = catalog.detail(projects[0].id)
  assert.equal(approvedDetail.features[0].approvedChanges[0].changeRequestId, created.changeRequest.id)
  assert.equal(approvedDetail.features[0].subFeatures[0].approvedChanges[0].changeRequestId, created.changeRequest.id)
  assert.throws(
    () => catalog.deleteChangeRequest(projects[0].id, created.changeRequest.id),
    error => error.code === 'CHANGE_REQUEST_DELETE_APPROVED',
  )
  const draft = catalog.createChangeRequest(projects[0].id, {
    targetFeatureId: 'FEAT-002', title: 'Disposable draft', requestedChange: 'Discard this draft.', reason: 'It is no longer needed.', expectedBehavior: 'The draft disappears.', versionIntent: 'patch',
  }, {idempotencyKey: '019fcf35-48fe-7d93-bb95-3304a2732993', now: new Date('2026-08-06T08:00:00.000Z')})
  assert.throws(
    () => catalog.deleteChangeRequest(projects[0].id, draft.changeRequest.id, {codexRuns: [{changeRequestId: draft.changeRequest.id, status: 'RUNNING'}]}),
    error => error.code === 'CHANGE_REQUEST_DELETE_RUN_ACTIVE',
  )
  const draftPath = join(fixture.project, '_workspace', '01_plan', 'change-requests', `${draft.changeRequest.id}.md`)
  assert.equal(existsSync(draftPath), true)
  assert.equal(catalog.deleteChangeRequest(projects[0].id, draft.changeRequest.id).deleted, true)
  assert.equal(existsSync(draftPath), false)
  assert.equal(catalog.detail(projects[0].id).changeRequests.some(request => request.id === draft.changeRequest.id), false)
  assert.deepEqual(catalog.deleteChangeRequest(projects[0].id, draft.changeRequest.id), {deleted: false, artifactCount: 0})
  const malformed = catalog.createChangeRequest(projects[0].id, {
    targetFeatureId: 'FEAT-002', title: 'Malformed review guard', requestedChange: 'Keep this request.', reason: 'The review audit is invalid.', expectedBehavior: 'Deletion fails closed.', versionIntent: 'patch',
  }, {idempotencyKey: '019fcf35-48fe-7d93-bb95-3304a2732994', now: new Date('2026-08-06T09:00:00.000Z')})
  const decisionDirectory = join(fixture.project, '_workspace', '03_dev', 'change-request-decisions')
  mkdirSync(decisionDirectory, {recursive: true})
  writeFileSync(join(decisionDirectory, `${malformed.changeRequest.id}.jsonl`), '{not-json}\n')
  catalog.refresh()
  assert.throws(
    () => catalog.deleteChangeRequest(projects[0].id, malformed.changeRequest.id),
    error => error.code === 'REVIEW_HISTORY_INVALID',
  )
  assert.equal(existsSync(join(fixture.project, '_workspace', '01_plan', 'change-requests', `${malformed.changeRequest.id}.md`)), true)
})

test('discovery walks nested layouts beyond workspace/ and packages/ and reports the scan root', t => {
  const root = mkdtempSync(join(tmpdir(), 'web-harness-console-nested-'))
  t.after(() => rmSync(root, {recursive: true, force: true}))
  mkdirSync(join(root, 'apps', 'site', '_workspace', '01_plan'), {recursive: true})
  writeFileSync(join(root, 'apps', 'site', '_workspace', '01_plan', 'requirements.md'), '# REQ\n')
  mkdirSync(join(root, 'node_modules', 'dep', '_workspace', '01_plan'), {recursive: true})
  writeFileSync(join(root, 'node_modules', 'dep', '_workspace', '01_plan', 'ignored.md'), '# ignored\n')

  const catalog = new WorkspaceCatalog(root)
  const listing = catalog.list()
  assert.equal(listing.projects.length, 1)
  assert.equal(listing.projects[0].name, 'site')
  assert.equal(typeof listing.scanRoot, 'string')
  assert.ok(listing.scanRoot.length > 0)
})

test('sharded feature-plan 디렉토리에서도 FEAT/TC가 파싱된다 (search-portal 파일럿 실측 회귀)', () => {
  const root = mkdtempSync(join(tmpdir(), 'web-harness-console-sharded-'))
  try {
    const project = join(root, 'workspace', 'sharded')
    mkdirSync(join(project, '_workspace', '01_plan', 'feature-plan'), {recursive: true})
    writeFileSync(join(project, '_workspace', '01_plan', 'feature-plan', 'INDEX.md'), [
      '# Feature Plan — 서비스',
      '| 절 | 파일 | 담당 범위 | 주 소비자 |',
      '|---|---|---|---|',
      '| Feature List | `feature-list.md` | FEAT 표 | 전체 |',
    ].join('\n'))
    writeFileSync(join(project, '_workspace', '01_plan', 'feature-plan', 'feature-list.md'), [
      '| FEAT ID | Feature | Priority | Page Group | Screen |',
      '|---|---|---|---|---|',
      '| FEAT-001 | Unified search | Must | PAGE-001 | home |',
    ].join('\n'))
    writeFileSync(join(project, '_workspace', '01_plan', 'feature-plan', 'behavior-specs.md'), [
      '- TC-001-1: runs a search',
      '',
      '| Sub Feature ID | 동작 | 관련 Test Case | 화면/영역 | 이번 범위 |',
      '|---|---|---|---|---|',
      '| FEAT-001-01 | Submit query | TC-001-1 | search-input | keep |',
    ].join('\n'))
    const catalog = new WorkspaceCatalog(root)
    const listing = catalog.list()
    const detail = catalog.detail(listing.projects[0].id)
    assert.equal(detail.features.length, 1)
    assert.equal(detail.features[0].featureId, 'FEAT-001')
    assert.equal(detail.features[0].subFeatures[0].subFeatureId, 'FEAT-001-01')
    assert.ok(detail.features[0].subFeatures[0].testCaseIds.includes('TC-001-1'))
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})
