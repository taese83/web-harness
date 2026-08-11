#!/usr/bin/env node
import assert from 'node:assert/strict'
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {inspectDesignPreview, recordPreviewApproval, writeSourceSnapshot} from './design-preview-status-lib.mjs'

const makeProject = suffix => {
  const root = mkdtempSync(join(tmpdir(), `web-harness-preview-${suffix}-`))
  const plan = join(root, '_workspace', '01_plan')
  const design = join(root, '_workspace', '02_design')
  const preview = join(design, 'preview')
  mkdirSync(plan, {recursive: true})
  mkdirSync(preview, {recursive: true})
  writeFileSync(join(plan, 'feature-plan.md'), '# Feature List\n\n## FEAT-001 Save item\n\n- TC-001-1: saves a valid item\n')
  writeFileSync(join(plan, 'ux-brief.md'), '# UX Brief\n\nPrimary action: Save\n')
  writeFileSync(join(design, 'design-system.md'), '# Design System\n\nPrimary: blue\n')
  writeFileSync(join(design, 'layout-spec.md'), '# Layout\n\nRoute: #/items\n')
  writeFileSync(join(design, 'component-spec.md'), '# Components\n\nSave button\n')
  writeFileSync(join(preview, 'index.html'), '<!doctype html><html><body><script type="module" src="app.js"></script></body></html>\n')
  writeFileSync(join(preview, 'tokens.css'), ':root { --primary: blue; }\n')
  writeFileSync(join(preview, 'app.css'), '.badge { color: var(--primary); }\n')
  writeFileSync(join(preview, 'store.js'), 'export const state = {}\n')
  writeFileSync(join(preview, 'router.js'), 'export const route = "#/items"\n')
  writeFileSync(join(preview, 'app.js'), 'document.body.innerHTML = `<button data-wh-anchor="wh-feat-001-save" data-wh-feature="FEAT-001" data-wh-tests="TC-001-1">Save</button>`\n')
  writeFileSync(join(preview, 'behaviors.md'), '| TC ID | Result |\n| --- | --- |\n| TC-001-1 | PASS |\n')
  writeFileSync(join(preview, 'traceability.json'), `${JSON.stringify({
    schemaVersion: 1,
    features: [{featureId: 'FEAT-001', title: 'Save item', testCaseIds: ['TC-001-1'], anchorIds: ['wh-feat-001-save']}],
    anchors: [{
      anchorId: 'wh-feat-001-save',
      featureId: 'FEAT-001',
      testCaseIds: ['TC-001-1'],
      label: 'Save button',
      route: '#/items',
      selector: '[data-wh-anchor="wh-feat-001-save"]',
      fixtureId: 'canonical-seed',
      fixtureMode: 'isolated-reset',
    }],
  }, null, 2)}\n`)
  return root
}

const makeV2Project = suffix => {
  const root = makeProject(suffix)
  const planPath = join(root, '_workspace', '01_plan', 'feature-plan.md')
  writeFileSync(planPath, `${readFileSync(planPath, 'utf8')}\n#### FEAT-001 하위 기능\n\n| Sub Feature ID | 동작 | 관련 Test Case |\n|---|---|---|\n| FEAT-001-01 | Save action | TC-001-1 |\n`)
  const preview = join(root, '_workspace', '02_design', 'preview')
  writeFileSync(join(preview, 'app.js'), 'document.body.innerHTML = `<button data-wh-anchor="wh-feat-001-save" data-wh-feature="FEAT-001" data-wh-subfeature="FEAT-001-01" data-wh-tests="TC-001-1">Save</button>`\n')
  const traceabilityPath = join(preview, 'traceability.json')
  const traceability = JSON.parse(readFileSync(traceabilityPath, 'utf8'))
  traceability.schemaVersion = 2
  traceability.features[0].subFeatures = [{
    subFeatureId: 'FEAT-001-01',
    title: 'Save action',
    testCaseIds: ['TC-001-1'],
    anchorIds: ['wh-feat-001-save'],
  }]
  traceability.anchors[0].subFeatureId = 'FEAT-001-01'
  writeFileSync(traceabilityPath, `${JSON.stringify(traceability, null, 2)}\n`)
  return root
}

const makeDeltaProject = suffix => {
  const root = mkdtempSync(join(tmpdir(), `web-harness-delta-${suffix}-`))
  const plan = join(root, '_workspace', '01_plan')
  const design = join(root, '_workspace', '02_design')
  const delta = join(design, 'preview', 'delta')
  mkdirSync(plan, {recursive: true})
  mkdirSync(delta, {recursive: true})
  writeFileSync(join(plan, 'feature-plan.md'), '# Feature List\n\n## FEAT-020 Recent shortcut\n\n- TC-020-1: shows recent entries\n')
  writeFileSync(join(design, 'delta-spec.md'), '# Delta Spec\n\nAnchor: recent shortcut area\n')
  writeFileSync(join(design, 'preview', 'manifest.json'), `${JSON.stringify({schemaVersion: 1, mode: 'live-delta', target: 'http://127.0.0.1:8080'})}\n`)
  writeFileSync(join(delta, 'bootstrap.mjs'), 'const area = document.createElement("div")\narea.setAttribute("data-wh-anchor", "wh-feat-020-recent")\narea.setAttribute("data-wh-feature", "FEAT-020")\narea.setAttribute("data-wh-tests", "TC-020-1")\ndocument.body.append(area)\nimport("./wh-overlay.mjs").then(m => m.initWhOverlay({traceabilityUrl: "/__wh_delta__/traceability.json"}))\n')
  writeFileSync(join(delta, 'wh-overlay.mjs'), 'export const initWhOverlay = () => ({refresh() {}, close() {}})\n')
  writeFileSync(join(delta, 'traceability.json'), `${JSON.stringify({
    schemaVersion: 1,
    features: [{featureId: 'FEAT-020', title: 'Recent shortcut', testCaseIds: ['TC-020-1'], anchorIds: ['wh-feat-020-recent']}],
    anchors: [{
      anchorId: 'wh-feat-020-recent',
      featureId: 'FEAT-020',
      testCaseIds: ['TC-020-1'],
      label: 'Recent shortcut area',
      route: '#/entry',
      selector: '[data-wh-anchor="wh-feat-020-recent"]',
    }],
  }, null, 2)}\n`)
  return root
}

const roots = []
try {
  const approvedRoot = makeProject('approved')
  roots.push(approvedRoot)
  assert.equal(inspectDesignPreview(approvedRoot).status, 'DRAFT')
  assert.equal(writeSourceSnapshot(approvedRoot).status, 'UNAPPROVED')
  assert.throws(
    () => recordPreviewApproval(approvedRoot, '사용자 승인', {recordedVia: 'bogus-source'}),
    /recordedVia must be one of/,
  )
  assert.equal(recordPreviewApproval(approvedRoot, '사용자 승인').status, 'APPROVED')
  const review = readFileSync(join(approvedRoot, '_workspace', '02_design', 'design-review.md'), 'utf8')
  assert.match(review, /web-harness-preview-approval/)
  assert.match(review, /TC-001-1/)
  assert.match(review, /"recordedVia":"harness-session"/)
  assert.equal(recordPreviewApproval(approvedRoot, 'Console 확인 승인', {recordedVia: 'console-user-attested'}).status, 'APPROVED')
  assert.match(
    readFileSync(join(approvedRoot, '_workspace', '02_design', 'design-review.md'), 'utf8'),
    /"recordedVia":"console-user-attested"/,
  )

  writeFileSync(join(approvedRoot, '_workspace', '01_plan', 'feature-plan.md'), '# Feature List changed\n\n## FEAT-001 Save item\n\n- TC-001-1: saves a valid item\n')
  assert.equal(inspectDesignPreview(approvedRoot).status, 'STALE')
  assert.equal(inspectDesignPreview(approvedRoot).reason, 'SOURCE_CHANGED')

  const v2Root = makeV2Project('subfeature-v2')
  roots.push(v2Root)
  assert.equal(inspectDesignPreview(v2Root).status, 'DRAFT')
  assert.equal(writeSourceSnapshot(v2Root).status, 'UNAPPROVED')

  const invalidFixtureRoot = makeProject('invalid-fixture-mode')
  roots.push(invalidFixtureRoot)
  const invalidFixturePath = join(invalidFixtureRoot, '_workspace', '02_design', 'preview', 'traceability.json')
  const invalidFixtureTraceability = JSON.parse(readFileSync(invalidFixturePath, 'utf8'))
  invalidFixtureTraceability.anchors[0].fixtureMode = 'shared'
  writeFileSync(invalidFixturePath, `${JSON.stringify(invalidFixtureTraceability, null, 2)}\n`)
  const invalidFixture = inspectDesignPreview(invalidFixtureRoot)
  assert.equal(invalidFixture.status, 'INVALID')
  assert.ok(invalidFixture.errors.some(error => error.includes('fixtureMode must be isolated-reset')))

  const invalidSubFeatureRoot = makeV2Project('invalid-subfeature-owner')
  roots.push(invalidSubFeatureRoot)
  const invalidSubFeaturePath = join(invalidSubFeatureRoot, '_workspace', '02_design', 'preview', 'traceability.json')
  const invalidSubFeatureTraceability = JSON.parse(readFileSync(invalidSubFeaturePath, 'utf8'))
  invalidSubFeatureTraceability.anchors[0].subFeatureId = 'FEAT-002-01'
  writeFileSync(invalidSubFeaturePath, `${JSON.stringify(invalidSubFeatureTraceability, null, 2)}\n`)
  const invalidSubFeature = inspectDesignPreview(invalidSubFeatureRoot)
  assert.equal(invalidSubFeature.status, 'INVALID')
  assert.ok(invalidSubFeature.errors.some(error => error.includes('unknown subFeatureId FEAT-002-01')))

  const previewDriftRoot = makeProject('preview-drift')
  roots.push(previewDriftRoot)
  writeSourceSnapshot(previewDriftRoot)
  recordPreviewApproval(previewDriftRoot, 'approve preview')
  writeFileSync(join(previewDriftRoot, '_workspace', '02_design', 'preview', 'app.css'), '.badge { color: red; }\n')
  assert.equal(inspectDesignPreview(previewDriftRoot).status, 'STALE')
  assert.equal(inspectDesignPreview(previewDriftRoot).reason, 'APPROVED_PREVIEW_CHANGED')

  const invalidRoot = makeProject('invalid')
  roots.push(invalidRoot)
  writeFileSync(join(invalidRoot, '_workspace', '02_design', 'preview', 'app.js'), 'document.body.textContent = "no anchors"\n')
  const invalid = inspectDesignPreview(invalidRoot)
  assert.equal(invalid.status, 'INVALID')
  assert.ok(invalid.errors.some(error => error.includes('data-wh-anchor')))

  const malformedApprovalRoot = makeProject('malformed-approval')
  roots.push(malformedApprovalRoot)
  writeSourceSnapshot(malformedApprovalRoot)
  assert.throws(() => recordPreviewApproval(malformedApprovalRoot, 'line one\nline two'), /single non-empty line/)
  recordPreviewApproval(malformedApprovalRoot, 'approve preview')
  const reviewPath = join(malformedApprovalRoot, '_workspace', '02_design', 'design-review.md')
  writeFileSync(reviewPath, `${readFileSync(reviewPath, 'utf8')}\n<!-- web-harness-preview-approval\n{broken}\n-->\n`)
  assert.equal(inspectDesignPreview(malformedApprovalRoot).status, 'INVALID')

  // live-delta 모드: 필수 파일·소스 세트·앵커 receipt 강제·STALE 파생
  const deltaRoot = makeDeltaProject('delta')
  roots.push(deltaRoot)
  const deltaDraft = inspectDesignPreview(deltaRoot)
  assert.equal(deltaDraft.mode, 'live-delta')
  assert.equal(deltaDraft.status, 'DRAFT')
  assert.equal(writeSourceSnapshot(deltaRoot).status, 'UNAPPROVED')
  assert.throws(() => recordPreviewApproval(deltaRoot, '델타 승인'), /anchor-receipt/)
  assert.throws(() => recordPreviewApproval(deltaRoot, '델타 승인', {anchorReceipt: 'two\nlines'}), /anchor-receipt/)
  const deltaApproved = recordPreviewApproval(deltaRoot, '델타 승인', {anchorReceipt: 'anchors 1/1 matched @ http://127.0.0.1:4312 (screenshot receipt-1.png)'})
  assert.equal(deltaApproved.status, 'APPROVED')
  const deltaReview = readFileSync(join(deltaRoot, '_workspace', '02_design', 'design-review.md'), 'utf8')
  assert.match(deltaReview, /"mode":"live-delta"/)
  assert.match(deltaReview, /anchors 1\/1 matched/)
  writeFileSync(join(deltaRoot, '_workspace', '02_design', 'delta-spec.md'), '# Delta Spec changed\n\nAnchor: recent shortcut area\n')
  assert.equal(inspectDesignPreview(deltaRoot).status, 'STALE')
  // 재승인 루프: 재생성(snapshot 갱신) 없이도 STALE에서 재확인 후 새 승인 기록으로 복귀 가능
  writeSourceSnapshot(deltaRoot)
  assert.equal(inspectDesignPreview(deltaRoot).status, 'STALE')
  const reApproved = recordPreviewApproval(deltaRoot, '델타 재승인', {anchorReceipt: 'anchors 1/1 re-verified @ http://127.0.0.1:4312'})
  assert.equal(reApproved.status, 'APPROVED')

  // 읽기 경로 fail-closed: recordPreviewApproval을 우회한 수기 승인 레코드(receipt 없음)는
  // digest가 일치해도 APPROVED가 아니라 INVALID여야 한다.
  const forgedRoot = makeDeltaProject('delta-forged-approval')
  roots.push(forgedRoot)
  writeSourceSnapshot(forgedRoot)
  const forgedStatus = inspectDesignPreview(forgedRoot)
  const forgedRecord = {
    schemaVersion: 1,
    approvedAt: new Date().toISOString(),
    approvalText: '수기 위조 레코드',
    recordedVia: 'harness-session',
    sourceDigest: forgedStatus.source.digest,
    previewDigest: forgedStatus.preview.digest,
  }
  writeFileSync(
    join(forgedRoot, '_workspace', '02_design', 'design-review.md'),
    `# Design Review\n\n## Preview Approval\n\n<!-- web-harness-preview-approval\n${JSON.stringify(forgedRecord)}\n-->\n`,
  )
  const forged = inspectDesignPreview(forgedRoot)
  assert.equal(forged.status, 'INVALID')
  assert.ok(forged.errors.some(error => error.includes('anchorReceipt')))

  const deltaMissingRoot = makeDeltaProject('delta-missing-overlay')
  roots.push(deltaMissingRoot)
  rmSync(join(deltaMissingRoot, '_workspace', '02_design', 'preview', 'delta', 'wh-overlay.mjs'))
  const deltaMissing = inspectDesignPreview(deltaMissingRoot)
  assert.equal(deltaMissing.status, 'INVALID')
  assert.ok(deltaMissing.errors.some(error => error.includes('missing preview file: delta/wh-overlay.mjs')))

  // 프로토타입 모드에 델타 소스 요구가 새지 않는지(오탐 0): delta-spec 없이도 기존 흐름 그대로
  const regressionRoot = makeProject('prototype-regression')
  roots.push(regressionRoot)
  const regression = inspectDesignPreview(regressionRoot)
  assert.equal(regression.mode, 'prototype')
  assert.equal(regression.status, 'DRAFT')

  process.stdout.write('design preview traceability, approval, stale-state, and live-delta mode tests passed\n')
} finally {
  for (const root of roots) rmSync(root, {recursive: true, force: true})
}
