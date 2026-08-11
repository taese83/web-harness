import {createHash} from 'node:crypto'
import {
  appendFileSync,
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import {join, relative, resolve, sep} from 'node:path'

const REQUIRED_PREVIEW_FILES = [
  'index.html',
  'tokens.css',
  'app.css',
  'store.js',
  'router.js',
  'app.js',
  'behaviors.md',
  'traceability.json',
]

const SOURCE_INPUTS = [
  ['_workspace/01_plan/feature-plan.md', true],
  ['_workspace/01_plan/ux-brief.md', true],
  ['_workspace/02_design/design-system', false],
  ['_workspace/02_design/design-system.md', false],
  ['_workspace/02_design/layout-spec', false],
  ['_workspace/02_design/layout-spec.md', false],
  ['_workspace/02_design/component-spec', false],
  ['_workspace/02_design/component-spec.md', false],
  ['_workspace/02_design/state-contract', false],
  ['_workspace/02_design/state-contract.md', false],
]

// live-delta 모드(브라운필드 개발 표면 승격 — docs/brownfield-adoption.md L2 재정의):
// 산출물은 preview/delta/ 아래에 있고, 스펙 정본은 feature-plan + delta-spec이다.
// greenfield 문서 3종(design-system 등)은 있으면 digest에 포함하되 요구하지 않는다.
const DELTA_REQUIRED_FILES = ['delta/bootstrap.mjs', 'delta/wh-overlay.mjs', 'delta/traceability.json']
const DELTA_SOURCE_INPUTS = [
  ['_workspace/01_plan/feature-plan.md', true],
  ['_workspace/02_design/delta-spec.md', true],
  ['_workspace/01_plan/ux-brief.md', false],
  ['_workspace/02_design/design-system', false],
  ['_workspace/02_design/design-system.md', false],
  ['_workspace/02_design/layout-spec', false],
  ['_workspace/02_design/layout-spec.md', false],
  ['_workspace/02_design/component-spec', false],
  ['_workspace/02_design/component-spec.md', false],
]

export const readPreviewMode = project => {
  const manifestPath = join(resolve(project), '_workspace', '02_design', 'preview', 'manifest.json')
  if (!existsSync(manifestPath)) return {mode: 'prototype', manifest: null, error: null}
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (manifest?.mode === 'live-delta') return {mode: 'live-delta', manifest, error: null}
    if (manifest?.mode === undefined || manifest?.mode === 'prototype') return {mode: 'prototype', manifest, error: null}
    return {mode: 'prototype', manifest, error: `unknown preview mode: ${manifest.mode}`}
  } catch (error) {
    return {mode: 'prototype', manifest: null, error: `invalid manifest.json: ${error.message}`}
  }
}

const sha256 = value => createHash('sha256').update(value).digest('hex')

const walkFiles = path => {
  if (!existsSync(path)) return []
  const stat = lstatSync(path)
  if (stat.isSymbolicLink()) return []
  if (stat.isFile()) return [path]
  if (!stat.isDirectory()) return []
  return readdirSync(path, {withFileTypes: true})
    .filter(entry => !entry.name.startsWith('.'))
    .flatMap(entry => walkFiles(join(path, entry.name)))
}

const fileRecords = (projectRoot, absolutePaths) =>
  absolutePaths
    .map(path => ({
      path: relative(projectRoot, path).split(sep).join('/'),
      sha256: sha256(readFileSync(path)),
    }))
    .sort((left, right) => left.path.localeCompare(right.path))

const digestRecords = records => sha256(records.map(record => `${record.path}:${record.sha256}`).join('\n'))

const sourceFiles = (projectRoot, mode = 'prototype') => {
  const missing = []
  const files = []
  const groupedAlternatives = new Map()
  const inputs = mode === 'live-delta' ? DELTA_SOURCE_INPUTS : SOURCE_INPUTS
  for (const [relativePath, required] of inputs) {
    const absolutePath = join(projectRoot, relativePath)
    if (existsSync(absolutePath)) files.push(...walkFiles(absolutePath))
    else if (required) missing.push(relativePath)
    const group = relativePath.replace(/\.md$/, '')
    groupedAlternatives.set(group, (groupedAlternatives.get(group) ?? 0) + Number(existsSync(absolutePath)))
  }
  if (mode !== 'live-delta') {
    for (const group of [
      '_workspace/02_design/design-system',
      '_workspace/02_design/layout-spec',
      '_workspace/02_design/component-spec',
    ]) {
      if ((groupedAlternatives.get(group) ?? 0) === 0) missing.push(`${group}(.md|/)`)
    }
  }
  return {files: [...new Set(files)], missing}
}

export const buildSourceSnapshot = (project, mode = 'prototype') => {
  const projectRoot = resolve(project)
  const {files, missing} = sourceFiles(projectRoot, mode)
  const records = fileRecords(projectRoot, files)
  return {
    algorithm: 'sha256',
    digest: digestRecords(records),
    files: records,
    missing,
  }
}

const buildPreviewSnapshot = projectRoot => {
  const previewRoot = join(projectRoot, '_workspace', '02_design', 'preview')
  const records = fileRecords(projectRoot, walkFiles(previewRoot))
  return {algorithm: 'sha256', digest: digestRecords(records), files: records}
}

const collectIds = (text, pattern) => [...new Set(text.match(pattern) ?? [])].sort()

const validateTraceability = (projectRoot, traceability, mode = 'prototype') => {
  const errors = []
  const featurePlanPath = join(projectRoot, '_workspace', '01_plan', 'feature-plan.md')
  const behaviorsPath = join(projectRoot, '_workspace', '02_design', 'preview', 'behaviors.md')
  const previewRoot = join(projectRoot, '_workspace', '02_design', 'preview')

  if (![1, 2].includes(traceability?.schemaVersion)) errors.push('traceability.json schemaVersion must be 1 or 2')
  if (!Array.isArray(traceability?.features)) errors.push('traceability.json features must be an array')
  if (!Array.isArray(traceability?.anchors)) errors.push('traceability.json anchors must be an array')
  if (errors.length > 0) return errors

  const featureIds = new Set()
  const subFeatureIds = new Set()
  const anchorIds = new Set()
  const mappedTests = new Set()
  const featureById = new Map()
  const subFeatureById = new Map()

  for (const feature of traceability.features) {
    if (!/^FEAT-\d{3,}$/.test(feature.featureId ?? '')) errors.push(`invalid featureId: ${feature.featureId ?? '<missing>'}`)
    if (featureIds.has(feature.featureId)) errors.push(`duplicate featureId: ${feature.featureId}`)
    featureIds.add(feature.featureId)
    featureById.set(feature.featureId, feature)
    if (typeof feature.title !== 'string' || feature.title.trim() === '') errors.push(`${feature.featureId}: title is required`)
    if (!Array.isArray(feature.testCaseIds)) errors.push(`${feature.featureId}: testCaseIds must be an array`)
    else for (const testId of feature.testCaseIds) {
      if (!/^TC-\d{3,}-\d+$/.test(testId)) errors.push(`${feature.featureId}: invalid test case ${testId}`)
      mappedTests.add(testId)
    }
    if (!Array.isArray(feature.anchorIds)) errors.push(`${feature.featureId}: anchorIds must be an array`)
    else if (feature.anchorIds.length === 0 && !feature.unmappedReason) {
      errors.push(`${feature.featureId}: anchorIds is empty; unmappedReason is required`)
    }
    if (feature.subFeatures !== undefined && !Array.isArray(feature.subFeatures)) {
      errors.push(`${feature.featureId}: subFeatures must be an array`)
    }
    if (traceability.schemaVersion === 1 && (feature.subFeatures?.length ?? 0) > 0) {
      errors.push(`${feature.featureId}: subFeatures require schemaVersion 2`)
    }
    for (const subFeature of feature.subFeatures ?? []) {
      const expectedPattern = new RegExp(`^${feature.featureId}-\\d{2}$`)
      if (!expectedPattern.test(subFeature.subFeatureId ?? '')) {
        errors.push(`${feature.featureId}: invalid subFeatureId ${subFeature.subFeatureId ?? '<missing>'}`)
      }
      if (subFeatureIds.has(subFeature.subFeatureId)) errors.push(`duplicate subFeatureId: ${subFeature.subFeatureId}`)
      subFeatureIds.add(subFeature.subFeatureId)
      subFeatureById.set(subFeature.subFeatureId, {feature, subFeature})
      if (typeof subFeature.title !== 'string' || subFeature.title.trim() === '') {
        errors.push(`${subFeature.subFeatureId}: title is required`)
      }
      if (!Array.isArray(subFeature.testCaseIds) || subFeature.testCaseIds.length === 0) {
        errors.push(`${subFeature.subFeatureId}: testCaseIds must contain at least one TC`)
      } else for (const testId of subFeature.testCaseIds) {
        if (!/^TC-\d{3,}-\d+$/.test(testId)) errors.push(`${subFeature.subFeatureId}: invalid test case ${testId}`)
        if (!(feature.testCaseIds ?? []).includes(testId)) {
          errors.push(`${subFeature.subFeatureId}: test case ${testId} is not owned by ${feature.featureId}`)
        }
      }
      if (!Array.isArray(subFeature.anchorIds)) errors.push(`${subFeature.subFeatureId}: anchorIds must be an array`)
      else if (subFeature.anchorIds.length === 0 && !subFeature.unmappedReason) {
        errors.push(`${subFeature.subFeatureId}: anchorIds is empty; unmappedReason is required`)
      }
    }
  }

  for (const anchor of traceability.anchors) {
    if (!/^wh-feat-[a-z0-9][a-z0-9-]*$/.test(anchor.anchorId ?? '')) errors.push(`invalid anchorId: ${anchor.anchorId ?? '<missing>'}`)
    if (anchorIds.has(anchor.anchorId)) errors.push(`duplicate anchorId: ${anchor.anchorId}`)
    anchorIds.add(anchor.anchorId)
    if (!featureIds.has(anchor.featureId)) errors.push(`${anchor.anchorId}: unknown featureId ${anchor.featureId}`)
    const owningFeature = featureById.get(anchor.featureId)
    const owningSubFeatureEntry = anchor.subFeatureId ? subFeatureById.get(anchor.subFeatureId) : null
    if (anchor.subFeatureId && !owningSubFeatureEntry) {
      errors.push(`${anchor.anchorId}: unknown subFeatureId ${anchor.subFeatureId}`)
    }
    if (owningSubFeatureEntry && owningSubFeatureEntry.feature.featureId !== anchor.featureId) {
      errors.push(`${anchor.anchorId}: subFeatureId ${anchor.subFeatureId} does not belong to ${anchor.featureId}`)
    }
    if (owningFeature && !(owningFeature.anchorIds ?? []).includes(anchor.anchorId)) {
      errors.push(`${anchor.anchorId}: owning feature does not reference this anchor`)
    }
    if (owningSubFeatureEntry && !(owningSubFeatureEntry.subFeature.anchorIds ?? []).includes(anchor.anchorId)) {
      errors.push(`${anchor.anchorId}: owning subfeature does not reference this anchor`)
    }
    if (!Array.isArray(anchor.testCaseIds) || anchor.testCaseIds.length === 0) {
      errors.push(`${anchor.anchorId}: testCaseIds must contain at least one TC`)
    } else {
      for (const testId of anchor.testCaseIds) {
        if (!/^TC-\d{3,}-\d+$/.test(testId)) errors.push(`${anchor.anchorId}: invalid test case ${testId}`)
        if (owningFeature && !(owningFeature.testCaseIds ?? []).includes(testId)) {
          errors.push(`${anchor.anchorId}: test case ${testId} is not owned by ${anchor.featureId}`)
        }
        if (owningSubFeatureEntry && !(owningSubFeatureEntry.subFeature.testCaseIds ?? []).includes(testId)) {
          errors.push(`${anchor.anchorId}: test case ${testId} is not owned by ${anchor.subFeatureId}`)
        }
        mappedTests.add(testId)
      }
    }
    for (const field of ['label', 'route', 'selector']) {
      if (typeof anchor[field] !== 'string' || anchor[field].trim() === '') errors.push(`${anchor.anchorId}: ${field} is required`)
    }
    if (anchor.selector !== `[data-wh-anchor="${anchor.anchorId}"]`) {
      errors.push(`${anchor.anchorId}: selector must target its exact data-wh-anchor`)
    }
    if (anchor.fixtureId !== undefined && !/^[a-z0-9][a-z0-9-]*$/.test(anchor.fixtureId ?? '')) {
      errors.push(`${anchor.anchorId}: fixtureId must use lowercase kebab-case`)
    }
    if (anchor.fixtureMode !== undefined && anchor.fixtureMode !== 'isolated-reset') {
      errors.push(`${anchor.anchorId}: fixtureMode must be isolated-reset`)
    }
    if (anchor.fixtureMode !== undefined && anchor.fixtureId === undefined) {
      errors.push(`${anchor.anchorId}: fixtureMode requires fixtureId`)
    }
  }

  for (const feature of traceability.features) {
    for (const anchorId of feature.anchorIds ?? []) {
      if (!anchorIds.has(anchorId)) errors.push(`${feature.featureId}: unknown anchorId ${anchorId}`)
    }
    for (const subFeature of feature.subFeatures ?? []) {
      for (const anchorId of subFeature.anchorIds ?? []) {
        if (!anchorIds.has(anchorId)) errors.push(`${subFeature.subFeatureId}: unknown anchorId ${anchorId}`)
      }
    }
  }

  if (existsSync(featurePlanPath)) {
    const featurePlan = readFileSync(featurePlanPath, 'utf8')
    const plannedFeatures = collectIds(featurePlan, /FEAT-\d{3,}/g)
    const plannedSubFeatures = collectIds(featurePlan, /FEAT-\d{3}-\d{2}(?!\d)/g)
    const plannedTests = collectIds(featurePlan, /TC-\d{3,}-\d+/g)
    for (const featureId of plannedFeatures) {
      if (!featureIds.has(featureId)) errors.push(`feature-plan feature is not mapped: ${featureId}`)
    }
    for (const featureId of featureIds) {
      if (!plannedFeatures.includes(featureId)) errors.push(`traceability feature is not in feature-plan: ${featureId}`)
    }
    for (const subFeatureId of plannedSubFeatures) {
      if (!subFeatureIds.has(subFeatureId)) errors.push(`feature-plan subfeature is not mapped: ${subFeatureId}`)
    }
    for (const subFeatureId of subFeatureIds) {
      if (!plannedSubFeatures.includes(subFeatureId)) errors.push(`traceability subfeature is not in feature-plan: ${subFeatureId}`)
    }
    for (const testId of plannedTests) {
      if (!mappedTests.has(testId)) errors.push(`feature-plan test case is not mapped: ${testId}`)
    }
    for (const testId of mappedTests) {
      if (!plannedTests.includes(testId)) errors.push(`traceability test case is not in feature-plan: ${testId}`)
    }
  }

  if (existsSync(behaviorsPath)) {
    const behaviorTests = collectIds(readFileSync(behaviorsPath, 'utf8'), /TC-\d{3,}-\d+/g)
    for (const testId of mappedTests) {
      if (!behaviorTests.includes(testId)) errors.push(`mapped test case is missing from behaviors.md: ${testId}`)
    }
  }

  // 마커 스캔은 문자열 포함 검사일 뿐(§4 등록 프록시) — .mjs 포함은 delta 모드에 한정한다.
  const renderSources = walkFiles(previewRoot)
    .filter(path => (mode === 'live-delta' ? /\.(?:html|js|mjs)$/ : /\.(?:html|js)$/).test(path))
    .map(path => readFileSync(path, 'utf8'))
    .join('\n')
  if (traceability.anchors.length > 0) {
    for (const marker of ['data-wh-anchor', 'data-wh-feature', 'data-wh-tests']) {
      if (!renderSources.includes(marker)) errors.push(`preview render source is missing ${marker}`)
    }
    for (const anchorId of anchorIds) {
      if (!renderSources.includes(anchorId)) errors.push(`preview render source is missing anchor ${anchorId}`)
    }
    if (subFeatureIds.size > 0 && !renderSources.includes('data-wh-subfeature')) {
      errors.push('preview render source is missing data-wh-subfeature')
    }
  }
  return errors
}

const parseApprovalRecords = designReview => {
  const records = []
  const errors = []
  const markers = [...designReview.matchAll(/<!-- web-harness-preview-approval\n([\s\S]*?)\n-->/g)]
  for (const match of markers) {
    try {
      const record = JSON.parse(match[1])
      if (record?.schemaVersion !== 1 || typeof record.sourceDigest !== 'string' || typeof record.previewDigest !== 'string') {
        errors.push('invalid machine-readable Preview Approval record')
      } else {
        records.push(record)
      }
    } catch (error) {
      errors.push(`invalid machine-readable Preview Approval JSON: ${error.message}`)
    }
  }
  const markerStarts = designReview.match(/<!-- web-harness-preview-approval/g)?.length ?? 0
  if (markerStarts !== markers.length) errors.push('unterminated machine-readable Preview Approval record')
  return {records, errors}
}

const traceabilityPathFor = (previewRoot, mode) =>
  mode === 'live-delta' ? join(previewRoot, 'delta', 'traceability.json') : join(previewRoot, 'traceability.json')

export const inspectDesignPreview = project => {
  const projectRoot = resolve(project)
  const previewRoot = join(projectRoot, '_workspace', '02_design', 'preview')
  const {mode, error: modeError} = readPreviewMode(projectRoot)
  const traceabilityPath = traceabilityPathFor(previewRoot, mode)
  const errors = []
  if (modeError) errors.push(modeError)
  for (const filename of mode === 'live-delta' ? DELTA_REQUIRED_FILES : REQUIRED_PREVIEW_FILES) {
    if (!existsSync(join(previewRoot, filename))) errors.push(`missing preview file: ${filename}`)
  }
  if (!existsSync(traceabilityPath)) {
    return {schemaVersion: 1, mode, status: 'MISSING', errors, source: buildSourceSnapshot(projectRoot, mode)}
  }

  let traceability
  try {
    traceability = JSON.parse(readFileSync(traceabilityPath, 'utf8'))
  } catch (error) {
    return {schemaVersion: 1, mode, status: 'INVALID', errors: [...errors, `invalid traceability.json: ${error.message}`]}
  }
  errors.push(...validateTraceability(projectRoot, traceability, mode))
  const source = buildSourceSnapshot(projectRoot, mode)
  if (source.missing.length > 0) errors.push(...source.missing.map(path => `missing preview input: ${path}`))
  if (errors.length > 0) return {schemaVersion: 1, mode, status: 'INVALID', errors, source}
  if (!traceability.sourceSnapshot?.digest) {
    return {schemaVersion: 1, mode, status: 'DRAFT', errors: [], source, traceability}
  }
  if (traceability.sourceSnapshot.digest !== source.digest) {
    return {schemaVersion: 1, mode, status: 'STALE', reason: 'SOURCE_CHANGED', errors: [], source, traceability}
  }

  const preview = buildPreviewSnapshot(projectRoot)
  const designReviewPath = join(projectRoot, '_workspace', '02_design', 'design-review.md')
  if (!existsSync(designReviewPath)) {
    return {schemaVersion: 1, mode, status: 'UNAPPROVED', errors: [], source, preview, traceability}
  }
  const approvals = parseApprovalRecords(readFileSync(designReviewPath, 'utf8'))
  if (approvals.errors.length > 0) {
    return {schemaVersion: 1, mode, status: 'INVALID', errors: approvals.errors, source, preview, traceability}
  }
  const approval = approvals.records.at(-1)
  if (!approval) return {schemaVersion: 1, mode, status: 'UNAPPROVED', errors: [], source, preview, traceability}
  // fail-closed는 쓰기 경로만으론 부족하다 — 수기로 작성된 승인 레코드도 읽기 경로에서
  // 같은 조건을 통과해야 한다: live-delta 승인은 mode 일치 + 비어있지 않은 anchorReceipt 필수.
  if (mode === 'live-delta' && (approval.mode !== 'live-delta' || typeof approval.anchorReceipt !== 'string' || approval.anchorReceipt.trim() === '')) {
    return {
      schemaVersion: 1, mode, status: 'INVALID',
      errors: ['live-delta approval record must declare mode "live-delta" and a non-empty anchorReceipt'],
      source, preview, traceability,
    }
  }
  if (approval.sourceDigest !== source.digest) {
    return {schemaVersion: 1, mode, status: 'STALE', reason: 'APPROVED_SOURCE_CHANGED', errors: [], source, preview, approval, traceability}
  }
  if (approval.previewDigest !== preview.digest) {
    return {schemaVersion: 1, mode, status: 'STALE', reason: 'APPROVED_PREVIEW_CHANGED', errors: [], source, preview, approval, traceability}
  }
  return {schemaVersion: 1, mode, status: 'APPROVED', errors: [], source, preview, approval, traceability}
}

export const writeSourceSnapshot = project => {
  const projectRoot = resolve(project)
  const {mode} = readPreviewMode(projectRoot)
  const traceabilityPath = traceabilityPathFor(join(projectRoot, '_workspace', '02_design', 'preview'), mode)
  if (!existsSync(traceabilityPath)) throw new Error('traceability.json does not exist')
  const traceability = JSON.parse(readFileSync(traceabilityPath, 'utf8'))
  const structuralErrors = validateTraceability(projectRoot, traceability, mode)
  if (structuralErrors.length > 0) throw new Error(structuralErrors.join('\n'))
  const sourceSnapshot = buildSourceSnapshot(projectRoot, mode)
  if (sourceSnapshot.missing.length > 0) throw new Error(`missing inputs: ${sourceSnapshot.missing.join(', ')}`)
  traceability.sourceSnapshot = {
    algorithm: sourceSnapshot.algorithm,
    digest: sourceSnapshot.digest,
    files: sourceSnapshot.files,
  }
  writeFileSync(traceabilityPath, `${JSON.stringify(traceability, null, 2)}\n`)
  return inspectDesignPreview(projectRoot)
}

// recordedVia는 승인 증거의 출처를 기록한다(I1 — 검증 주체 구분).
//   harness-session: 오케스트레이터가 프리뷰 루프에서 동작을 확인·승인 문구를 대리 기록
//   console-user-attested: Console UI에서 사용자가 직접 확인했다고 진술하고 기록
const APPROVAL_RECORDED_VIA = new Set(['harness-session', 'console-user-attested'])

export const recordPreviewApproval = (project, approvalText, {recordedVia = 'harness-session', anchorReceipt = null} = {}) => {
  const projectRoot = resolve(project)
  if (!APPROVAL_RECORDED_VIA.has(recordedVia)) {
    throw new Error(`recordedVia must be one of: ${[...APPROVAL_RECORDED_VIA].join(', ')}`)
  }
  const status = inspectDesignPreview(projectRoot)
  // STALE은 "변경 후 재확인 필요" 상태이며, 재확인을 마친 새 승인 기록(append-only)이
  // 곧 재승인이다 — 계약의 재생성→재확인→재승인 루프. 구조 결함(MISSING/INVALID/DRAFT)만 차단.
  if (!['UNAPPROVED', 'APPROVED', 'STALE'].includes(status.status)) {
    throw new Error(`preview cannot be approved while status is ${status.status}`)
  }
  if (
    typeof approvalText !== 'string'
    || approvalText.trim() === ''
    || approvalText.length > 500
    || /[\r\n\0]/.test(approvalText)
  ) {
    throw new Error('approval text must be a single non-empty line of at most 500 characters')
  }
  // live-delta는 바탕 앱이 digest 밖이므로, 라이브 앵커 검증 receipt(매칭 수·확인 URL·
  // 시점 요약 한 줄)가 승인 조건이다 — 없으면 승인 자체를 거부한다(fail-closed).
  if (status.mode === 'live-delta') {
    if (
      typeof anchorReceipt !== 'string'
      || anchorReceipt.trim() === ''
      || anchorReceipt.length > 300
      || /[\r\n\0]/.test(anchorReceipt)
    ) {
      throw new Error('live-delta approval requires --anchor-receipt: a single line (≤300 chars) recording the live anchor verification (e.g. "anchors 5/5 matched @ http://127.0.0.1:4312 2026-08-10")')
    }
  }
  const designReviewPath = join(projectRoot, '_workspace', '02_design', 'design-review.md')
  const existing = existsSync(designReviewPath) ? readFileSync(designReviewPath, 'utf8') : '# Design Review\n'
  if (!existsSync(designReviewPath)) writeFileSync(designReviewPath, existing)
  const testCaseIds = [...new Set(status.traceability.features.flatMap(feature => feature.testCaseIds))].sort()
  const record = {
    schemaVersion: 1,
    mode: status.mode,
    approvedAt: new Date().toISOString(),
    approvalText: approvalText.trim(),
    recordedVia,
    sourceDigest: status.source.digest,
    previewDigest: status.preview.digest,
    traceabilityDigest: sha256(readFileSync(traceabilityPathFor(join(projectRoot, '_workspace', '02_design', 'preview'), status.mode))),
    testCaseIds,
  }
  if (status.mode === 'live-delta') record.anchorReceipt = anchorReceipt.trim()
  const receiptLine = record.anchorReceipt ? `\n- Anchor receipt: ${record.anchorReceipt}` : ''
  const heading = existing.includes('\n## Preview Approval') ? '' : '\n## Preview Approval\n'
  const body = `${heading}\n### ${record.approvedAt}\n\n- Status: APPROVED\n- Mode: ${record.mode}\n- Approval: ${record.approvalText}\n- Recorded via: ${record.recordedVia}${receiptLine}\n- Source digest: \`${record.sourceDigest}\`\n- Preview digest: \`${record.previewDigest}\`\n- Traceability digest: \`${record.traceabilityDigest}\`\n- Test cases: ${testCaseIds.join(', ')}\n\n<!-- web-harness-preview-approval\n${JSON.stringify(record)}\n-->\n`
  appendFileSync(designReviewPath, body)
  return inspectDesignPreview(projectRoot)
}
