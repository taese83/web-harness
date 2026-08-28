#!/usr/bin/env node
import assert from 'node:assert/strict'
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {test} from 'node:test'
import {inspectDesignPreview, readBaseSnapshot, recordPreviewApproval, writeSourceSnapshot} from './design-preview-status-lib.mjs'

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


  // 프로토타입 모드에 델타 소스 요구가 새지 않는지(오탐 0): delta-spec 없이도 기존 흐름 그대로
  const regressionRoot = makeProject('prototype-regression')
  roots.push(regressionRoot)
  const regression = inspectDesignPreview(regressionRoot)
  assert.equal(regression.mode, 'prototype')
  assert.equal(regression.status, 'DRAFT')

  // sharded Phase 1 입력 (결함 8호 회귀 — search-portal 파일럿 실측): flat 대신 디렉토리
  // 형태의 feature-plan/·ux-brief/도 required 그룹을 충족해야 한다
  const shardedRoot = makeProject('sharded-phase1')
  roots.push(shardedRoot)
  const shardedPlan = join(shardedRoot, '_workspace', '01_plan')
  rmSync(join(shardedPlan, 'feature-plan.md'))
  rmSync(join(shardedPlan, 'ux-brief.md'))
  mkdirSync(join(shardedPlan, 'feature-plan'), {recursive: true})
  mkdirSync(join(shardedPlan, 'ux-brief'), {recursive: true})
  writeFileSync(join(shardedPlan, 'feature-plan', 'INDEX.md'), '# Feature Plan\n')
  writeFileSync(join(shardedPlan, 'feature-plan', 'feature-list.md'), '## FEAT-001 Save item\n\n- TC-001-1: saves a valid item\n')
  writeFileSync(join(shardedPlan, 'ux-brief', 'INDEX.md'), '# UX Brief\n\nPrimary action: Save\n')
  const sharded = inspectDesignPreview(shardedRoot)
  assert.equal(sharded.status, 'DRAFT')
  assert.deepEqual(sharded.errors, [])
  assert.ok(sharded.source.files.some(file => file.path === '_workspace/01_plan/feature-plan/feature-list.md'))

  // 양쪽(.md·디렉토리) 모두 부재면 그룹 필수 검사가 loud하게 잡는다
  const missingPlanRoot = makeProject('missing-phase1')
  roots.push(missingPlanRoot)
  rmSync(join(missingPlanRoot, '_workspace', '01_plan', 'feature-plan.md'))
  rmSync(join(missingPlanRoot, '_workspace', '01_plan', 'ux-brief.md'))
  const missingPlan = inspectDesignPreview(missingPlanRoot)
  assert.equal(missingPlan.status, 'INVALID')
  assert.ok(missingPlan.errors.some(error => error.includes('_workspace/01_plan/feature-plan(.md|/)')))
  assert.ok(missingPlan.errors.some(error => error.includes('_workspace/01_plan/ux-brief(.md|/)')))

  process.stdout.write('design preview traceability, approval, and stale-state tests passed\n')
} finally {
  for (const root of roots) rmSync(root, {recursive: true, force: true})
}

// 스냅샷 바탕 — 브라운필드 승인의 시각적 바탕. 모드가 아니라 속성이다.
// 계약: skills/web-orchestrator/references/design-approval-contract.md
test('바탕 없음은 정상이다 — 그린필드 프리뷰는 바탕이 필요 없다', () => {
  const root = makeProject('base-absent')
  const base = readBaseSnapshot(root)
  assert.equal(base.present, false)
  assert.deepEqual(base.errors, [])
  assert.equal(inspectDesignPreview(root).base, undefined)
})

const withBase = (root, files) => {
  const baseRoot = join(root, '_workspace', '02_design', 'preview', 'base')
  mkdirSync(baseRoot, {recursive: true})
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(baseRoot, name), typeof body === 'string' ? body : `${JSON.stringify(body, null, 2)}\n`)
  }
  return baseRoot
}

const metaFor = captures => ({schemaVersion: 1, capturedAt: '2026-08-28T00:00:00.000Z', captures})

test('출처 없는 바탕은 승인 대상이 아니다 — html만 있고 meta.json이 없다', () => {
  const root = makeProject('base-no-meta')
  withBase(root, {'index.html': '<!doctype html><p>x</p>\n'})
  const base = readBaseSnapshot(root)
  assert.equal(base.present, true)
  assert.equal(base.errors.length, 1)
  assert.match(base.errors[0], /meta\.json is missing/)
  // 바탕 오류는 프리뷰 판정을 INVALID로 끌어내린다 — 조용히 통과하지 않는다
  assert.equal(inspectDesignPreview(root).status, 'INVALID')
})

test('meta가 선언한 스냅샷이 없으면 오류다', () => {
  const root = makeProject('base-missing-html')
  withBase(root, {'meta.json': metaFor([{slug: 'orders', styleMode: 'stylesheets'}])})
  assert.match(readBaseSnapshot(root).errors.join('\n'), /declared in meta\.json but missing: orders\.html/)
})

test('meta에 없는 html은 캡처 출처가 없다 — 손으로 넣은 바탕을 잡는다', () => {
  const root = makeProject('base-undeclared')
  withBase(root, {
    'meta.json': metaFor([{slug: 'index', styleMode: 'stylesheets'}]),
    'index.html': '<!doctype html><p>x</p>\n',
    'hand-written.html': '<!doctype html><p>y</p>\n',
  })
  assert.match(readBaseSnapshot(root).errors.join('\n'), /not declared in meta\.json: hand-written\.html/)
})

test('앱 script가 남은 바탕은 캡처를 거치지 않은 것이다 — 콘솔이 서빙하면 실행된다(I6)', () => {
  const root = makeProject('base-script')
  withBase(root, {
    'meta.json': metaFor([{slug: 'index', styleMode: 'stylesheets'}]),
    'index.html': '<!doctype html><p>x</p><script src="./app.js"></script>\n',
  })
  assert.match(readBaseSnapshot(root).errors.join('\n'), /non-harness <script>/)
})

test('오버레이 부트스트랩 하나는 허용된다 — 바탕 위에 배지를 띄우려면 필요하다', () => {
  const root = makeProject('base-overlay-ok')
  withBase(root, {
    'meta.json': metaFor([{slug: 'index', styleMode: 'stylesheets'}]),
    'index.html': '<!doctype html><p data-wh-anchor="wh-feat-001-save">x</p><script type="module" data-wh-overlay-bootstrap>import {} from "../wh-overlay.mjs"</script>\n',
  })
  assert.deepEqual(readBaseSnapshot(root).errors, [])
})

test('부트스트랩이 둘 이상이면 오류다 — 허용 범위는 정확히 하나다', () => {
  const root = makeProject('base-overlay-two')
  const bootstrap = '<script type="module" data-wh-overlay-bootstrap></script>'
  withBase(root, {
    'meta.json': metaFor([{slug: 'index', styleMode: 'stylesheets'}]),
    'index.html': `<!doctype html><p>x</p>${bootstrap}${bootstrap}\n`,
  })
  assert.match(readBaseSnapshot(root).errors.join('\n'), /exactly one overlay bootstrap/)
})

test('computed-fallback 바탕에서는 반응형을 승인할 수 없다', () => {
  const root = makeProject('base-fallback')
  withBase(root, {
    'meta.json': metaFor([{slug: 'index', styleMode: 'computed-fallback'}]),
    'index.html': '<!doctype html><p>x</p>\n',
  })
  assert.match(readBaseSnapshot(root).errors.join('\n'), /computed-fallback/)
})

test('정상 바탕은 오류가 없고 판정에 실려 나온다', () => {
  const root = makeProject('base-ok')
  withBase(root, {
    'meta.json': metaFor([{slug: 'index', route: '/', styleMode: 'stylesheets'}]),
    'index.html': '<!doctype html><p data-wh-anchor="wh-feat-001-save">x</p><script type="module" data-wh-overlay-bootstrap></script>\n',
  })
  assert.deepEqual(readBaseSnapshot(root).errors, [])
  const status = inspectDesignPreview(root)
  assert.equal(status.base.captures.length, 1)
  assert.equal(status.base.capturedAt, '2026-08-28T00:00:00.000Z')
  assert.notEqual(status.status, 'INVALID')
})

test('깨진 meta.json은 loud다 — 조용히 바탕 없음으로 강등하지 않는다', () => {
  const root = makeProject('base-broken-meta')
  withBase(root, {'meta.json': '{not json\n'})
  const base = readBaseSnapshot(root)
  assert.equal(base.present, true)
  assert.match(base.errors.join('\n'), /invalid base\/meta\.json/)
})

// 앵커 없는 바탕은 승인 대상이 아니다 — `--anchor-map` 없이 캡처하면 만들어지는 상태다.
// 2026-08-28까지 protected-core §4에 "공허 통과"로 등록돼 있던 자리를 기계로 닫았다.
const BOOTSTRAP = '<script type="module" data-wh-overlay-bootstrap></script>'

test('앵커 0개인 바탕은 INVALID다 — 배지 없는 바탕 위에서 기획 매칭을 주장할 수 없다', () => {
  const root = makeProject('base-no-anchor')
  withBase(root, {
    'meta.json': metaFor([{slug: 'index', styleMode: 'stylesheets'}]),
    'index.html': '<!doctype html><p>x</p>\n',
  })
  assert.match(readBaseSnapshot(root).errors.join('\n'), /no data-wh-anchor/)
  assert.equal(inspectDesignPreview(root).status, 'INVALID')
})

test('앵커는 바탕 **전체** 기준이다 — 맥락으로만 뜨는 route에 앵커를 요구하지 않는다', () => {
  const root = makeProject('base-partial-anchor')
  withBase(root, {
    'meta.json': metaFor([
      {slug: 'index', styleMode: 'stylesheets'},
      {slug: 'settings', styleMode: 'stylesheets'},
    ]),
    'index.html': `<!doctype html><p data-wh-anchor="wh-feat-001-save">x</p>${BOOTSTRAP}\n`,
    'settings.html': '<!doctype html><p>맥락 화면</p>\n',
  })
  assert.deepEqual(readBaseSnapshot(root).errors, [])
})

test('앵커는 meta가 아니라 HTML에서 읽는다 — meta의 주장으로 통과시키지 않는다', () => {
  const root = makeProject('base-meta-lies')
  withBase(root, {
    'meta.json': metaFor([{slug: 'index', styleMode: 'stylesheets', stampedAnchors: ['wh-feat-001-save']}]),
    'index.html': '<!doctype html><p>앵커 없음</p>\n',
  })
  assert.match(readBaseSnapshot(root).errors.join('\n'), /no data-wh-anchor/)
})

test('traceability에 없는 앵커는 오버레이가 배지하지 않는다 — 조용한 누락을 loud로', () => {
  const root = makeProject('base-unknown-anchor')
  withBase(root, {
    'meta.json': metaFor([{slug: 'index', styleMode: 'stylesheets'}]),
    'index.html': `<!doctype html><p data-wh-anchor="wh-feat-999-ghost">x</p>${BOOTSTRAP}\n`,
  })
  assert.match(readBaseSnapshot(root).errors.join('\n'), /not in traceability\.json: wh-feat-999-ghost/)
})

test('traceability가 깨졌으면 앵커 대조를 하지 않는다 — 진짜 원인을 덮지 않는다', () => {
  const root = makeProject('base-broken-trace')
  writeFileSync(join(root, '_workspace', '02_design', 'preview', 'traceability.json'), '{not json\n')
  withBase(root, {
    'meta.json': metaFor([{slug: 'index', styleMode: 'stylesheets'}]),
    'index.html': `<!doctype html><p data-wh-anchor="wh-feat-001-save">x</p>${BOOTSTRAP}\n`,
  })
  const joined = readBaseSnapshot(root).errors.join('\n')
  assert.equal(joined.includes('not in traceability.json'), false)
})

test('앵커가 있는데 부트스트랩이 없으면 배지가 뜨지 않는다', () => {
  const root = makeProject('base-inert-anchor')
  withBase(root, {
    'meta.json': metaFor([{slug: 'index', styleMode: 'stylesheets'}]),
    'index.html': '<!doctype html><p data-wh-anchor="wh-feat-001-save">x</p>\n',
  })
  assert.match(readBaseSnapshot(root).errors.join('\n'), /anchors but no overlay bootstrap/)
})
