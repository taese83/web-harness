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
  // feature-plan·ux-brief는 sharding 계약상 디렉토리 형태가 가능하다(search-portal 파일럿
  // 실측 — Phase 1 sharded 산출물에서 flat 필수 요구가 오탐 missing을 냄). Phase 2 3종과
  // 동일하게 (.md|/) 그룹 필수 검사로 강제한다(아래 grouped 검사 참조).
  ['_workspace/01_plan/feature-plan', false],
  ['_workspace/01_plan/feature-plan.md', false],
  ['_workspace/01_plan/ux-brief', false],
  ['_workspace/01_plan/ux-brief.md', false],
  ['_workspace/02_design/design-system', false],
  ['_workspace/02_design/design-system.md', false],
  ['_workspace/02_design/layout-spec', false],
  ['_workspace/02_design/layout-spec.md', false],
  ['_workspace/02_design/component-spec', false],
  ['_workspace/02_design/component-spec.md', false],
  ['_workspace/02_design/state-contract', false],
  ['_workspace/02_design/state-contract.md', false],
]


export const readPreviewMode = project => {
  const manifestPath = join(resolve(project), '_workspace', '02_design', 'preview', 'manifest.json')
  if (!existsSync(manifestPath)) return {mode: 'prototype', manifest: null, error: null}
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    // live-delta 모드 제거(2026-08-28): 승인 표면이 프리뷰 하나로 모이면서 이 모드가 없어졌다.
    // 남아 있는 레거시 manifest는 알 수 없는 모드로 loud 보고한다 — 조용히 prototype으로
    // 강등하면 델타 킷을 가진 프로젝트가 "정상 프리뷰"로 오표시된다.
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
  const inputs = SOURCE_INPUTS
  for (const [relativePath, required] of inputs) {
    const absolutePath = join(projectRoot, relativePath)
    if (existsSync(absolutePath)) files.push(...walkFiles(absolutePath))
    else if (required) missing.push(relativePath)
    const group = relativePath.replace(/\.md$/, '')
    groupedAlternatives.set(group, (groupedAlternatives.get(group) ?? 0) + Number(existsSync(absolutePath)))
  }
  {
    for (const group of [
      '_workspace/01_plan/feature-plan',
      '_workspace/01_plan/ux-brief',
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

  // 마커 스캔은 문자열 포함 검사일 뿐(§4 등록 프록시) — 프리뷰 산출물은 html·js다.
  const renderSources = walkFiles(previewRoot)
    .filter(path => /\.(?:html|js)$/.test(path))
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

const traceabilityPathFor = previewRoot => join(previewRoot, 'traceability.json')

// 스냅샷 바탕 — 프리뷰가 없던 기존 서비스의 화면을 정적 DOM으로 뜬 것(capture-base-snapshot.mjs).
// **모드가 아니라 속성이다.** 승인 절차는 프리뷰 하나이고 바탕만 다르다 — live-delta를 걷어낸
// 이유가 승인 표면의 이원화였으므로, 여기서 모드를 다시 늘리지 않는다.
//
// 바탕이 있으면 **승인 가능한 바탕인지**를 따진다. html만 있고 출처(meta.json)가 없으면
// 시드로 떴는지 실데이터로 떴는지 알 수 없고, 그 위의 승인은 근거가 없다.
// traceability가 선언한 앵커 ID. 읽을 수 없으면 **null**을 준다 — 빈 집합으로 퇴화시키면
// traceability가 깨졌을 때 바탕 앵커가 전부 "미등록"으로 쏟아져 진짜 원인을 덮는다.
// traceability 자체의 유효성은 validateTraceability가 따로 보고한다.
const readTraceabilityAnchorIds = projectRoot => {
  const path = join(projectRoot, '_workspace', '02_design', 'preview', 'traceability.json')
  if (!existsSync(path)) return null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    if (!Array.isArray(parsed?.anchors)) return null
    return new Set(parsed.anchors.map(anchor => anchor?.anchorId).filter(id => typeof id === 'string'))
  } catch {
    return null
  }
}

export const readBaseSnapshot = projectRoot => {
  const baseRoot = join(projectRoot, '_workspace', '02_design', 'preview', 'base')
  if (!existsSync(baseRoot)) return {present: false, meta: null, errors: []}
  const metaPath = join(baseRoot, 'meta.json')
  if (!existsSync(metaPath)) {
    return {present: true, meta: null, errors: ['base/meta.json is missing; a base without capture provenance cannot be approved on']}
  }
  let meta
  try {
    meta = JSON.parse(readFileSync(metaPath, 'utf8'))
  } catch (error) {
    return {present: true, meta: null, errors: [`invalid base/meta.json: ${error.message}`]}
  }
  const errors = []
  const captures = Array.isArray(meta?.captures) ? meta.captures : []
  if (captures.length === 0) errors.push('base/meta.json declares no captures')
  const declared = new Set()
  const baseAnchors = new Set()
  for (const capture of captures) {
    const slug = capture?.slug
    if (typeof slug !== 'string' || slug === '') {
      errors.push('base capture entry has no slug')
      continue
    }
    declared.add(`${slug}.html`)
    const htmlPath = join(baseRoot, `${slug}.html`)
    if (!existsSync(htmlPath)) {
      errors.push(`base snapshot declared in meta.json but missing: ${slug}.html`)
      continue
    }
    const html = readFileSync(htmlPath, 'utf8')
    // 앵커는 **파일이 아니라 HTML에서** 읽는다 — meta.json의 stampedAnchors는 손으로 고칠 수
    // 있고, 배지를 만드는 것은 문서의 속성이지 메타의 주장이 아니다.
    const fileAnchors = [...html.matchAll(/data-wh-anchor="([^"]*)"/g)].map(match => match[1])
    for (const anchorId of fileAnchors) baseAnchors.add(anchorId)
    // 앵커가 있는데 부트스트랩이 없으면 배지가 뜨지 않는다 — 앵커만 박힌 채 조용히 무력하다.
    if (fileAnchors.length > 0 && !/\bdata-wh-overlay-bootstrap\b/.test(html)) {
      errors.push(`base snapshot ${slug}.html has anchors but no overlay bootstrap; badges cannot render`)
    }
    // 스냅샷에서 실행되는 것은 **하네스 오버레이 부트스트랩 하나뿐**이다. 그 밖의 script는
    // 캡처를 거치지 않았거나 손으로 넣은 것이고, 콘솔이 서빙할 때 실행된다(I6 안전 하한).
    // "script 전면 금지"가 아니라 allowlist인 이유: 바탕 위에 배지를 띄우려면 오버레이가
    // 로드돼야 하고, 그것은 하네스 소유 코드다. 허용 범위를 정확히 한 개로 못박는다.
    const scriptTags = readFileSync(htmlPath, 'utf8').match(/<script\b[^>]*>/gi) ?? []
    const foreignScripts = scriptTags.filter(tag => !/\bdata-wh-overlay-bootstrap\b/.test(tag))
    if (foreignScripts.length > 0) {
      errors.push(`base snapshot contains a non-harness <script>: ${slug}.html — capture strips app scripts; this file was not produced by capture`)
    }
    if (scriptTags.length > 1) {
      errors.push(`base snapshot has ${scriptTags.length} <script> tags: ${slug}.html — exactly one overlay bootstrap is allowed`)
    }
    // computed-fallback은 반응형이 살아 있지 않다 — 그 위에서 레이아웃을 승인하면 거짓 확신이다.
    if (capture?.styleMode === 'computed-fallback') {
      errors.push(`base snapshot ${slug}.html was captured with computed-fallback styles; responsive layout cannot be approved on it`)
    }
  }
  // meta에 없는 html은 캡처 출처가 없다.
  for (const entry of readdirSync(baseRoot, {withFileTypes: true})) {
    if (!entry.isFile() || !entry.name.endsWith('.html')) continue
    if (!declared.has(entry.name)) errors.push(`base snapshot not declared in meta.json: ${entry.name}`)
  }

  // **바탕에는 앵커가 있어야 한다.** 바탕이 존재하는 이유는 "기획이 화면 어디에 붙는가"를
  // 보이는 것이고, 앵커가 하나도 없으면 그 일을 못 한다 — 배지가 없으니 기획 매칭을 주장할
  // 근거가 없는데도 승인은 진행됐다. `--anchor-map` 없이 캡처하면 정확히 이 상태가 되며,
  // 2026-08-28까지 protected-core §4에 "공허 통과"로 등록돼 있던 자리다.
  //
  // 검사는 **바탕 전체 기준**이다. 기능이 한 화면에만 붙고 나머지 route는 맥락으로만 뜨는
  // 것은 정상이므로, 파일마다 앵커를 요구하면 정당한 사용을 막는다.
  if (declared.size > 0 && baseAnchors.size === 0) {
    errors.push('base snapshot has no data-wh-anchor; a base without plan anchors cannot be approved on — capture with --anchor-map')
  }

  // traceability에 없는 앵커는 오버레이가 **배지하지 않는다**(브라운필드 안전장치). 그래서
  // anchor-map에만 있고 traceability에 없는 앵커는 조용히 배지가 빠진다 — loud로 바꾼다.
  const knownAnchorIds = readTraceabilityAnchorIds(projectRoot)
  if (knownAnchorIds !== null) {
    for (const anchorId of baseAnchors) {
      if (!knownAnchorIds.has(anchorId)) {
        errors.push(`base anchor is not in traceability.json: ${anchorId} — the overlay will not badge it`)
      }
    }
  }
  return {present: true, meta, errors}
}

const inspectPreviewCore = (projectRoot, baseErrors) => {
  const previewRoot = join(projectRoot, '_workspace', '02_design', 'preview')
  const {mode, error: modeError} = readPreviewMode(projectRoot)
  const traceabilityPath = traceabilityPathFor(previewRoot)
  const errors = [...baseErrors]
  if (modeError) errors.push(modeError)
  for (const filename of REQUIRED_PREVIEW_FILES) {
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
  // 과거 live-delta 승인 레코드에 남은 `anchorReceipt`는 **읽되 요구하지 않는다**(2026-08-28).
  // 기록된 승인을 새 규칙에 맞춰 무효로 만들지 않는다 — 그때의 판단은 그때 유효했다.
  if (approval.sourceDigest !== source.digest) {
    return {schemaVersion: 1, mode, status: 'STALE', reason: 'APPROVED_SOURCE_CHANGED', errors: [], source, preview, approval, traceability}
  }
  if (approval.previewDigest !== preview.digest) {
    return {schemaVersion: 1, mode, status: 'STALE', reason: 'APPROVED_PREVIEW_CHANGED', errors: [], source, preview, approval, traceability}
  }
  return {schemaVersion: 1, mode, status: 'APPROVED', errors: [], source, preview, approval, traceability}
}

export const inspectDesignPreview = project => {
  const projectRoot = resolve(project)
  const base = readBaseSnapshot(projectRoot)
  const result = inspectPreviewCore(projectRoot, base.errors)
  return base.present ? {...result, base: {captures: base.meta?.captures ?? [], capturedAt: base.meta?.capturedAt ?? null}} : result
}

// 앵커 → **실제 렌더 파일** 색인.
//
// traceability.json은 앵커가 있다는 **주장**이고, 파일에 박힌 문자열이 **사실**이다 —
// base 스냅샷 검증이 이미 같은 원칙을 쓴다("앵커는 파일이 아니라 HTML에서 읽는다").
// 기존 프리뷰 검증은 렌더 소스를 전부 이어붙여 포함 여부만 봤기 때문에(그 자리 주석이
// "§4 등록 프록시"라고 적고 있다) **어느 파일인지가 어디에도 남지 않았다.** 그래서 변경
// 요청의 영향도 검토가 앵커의 구현 위치를 짚지 못했다.
//
// 앵커 ID의 형태를 가정하지 않는다 — 주어진 ID의 출현을 찾을 뿐이라 프로젝트마다 다른
// 명명 규칙에도 그대로 성립한다.
export const indexRenderAnchors = (project, anchorIds, {maxFiles = 200, maxHitsPerAnchor = 8} = {}) => {
  const projectRoot = resolve(project)
  const previewRoot = join(projectRoot, '_workspace', '02_design', 'preview')
  const wanted = [...new Set((anchorIds ?? []).filter(id => typeof id === 'string' && id.length > 0))]
  const result = {anchors: {}, scannedFiles: 0, unresolved: [...wanted]}
  if (wanted.length === 0 || !existsSync(previewRoot)) return result
  const files = walkFiles(previewRoot).filter(path => /\.(?:html|js|mjs)$/.test(path)).slice(0, maxFiles)
  for (const absolute of files) {
    let text
    try { text = readFileSync(absolute, 'utf8') } catch { continue }
    result.scannedFiles += 1
    const path = relative(projectRoot, absolute).split(sep).join('/')
    let lines = null
    for (const anchorId of wanted) {
      if (!text.includes(anchorId)) continue
      lines = lines ?? text.split('\n')
      const hits = []
      for (let index = 0; index < lines.length && hits.length < maxHitsPerAnchor; index += 1) {
        if (lines[index].includes(anchorId)) hits.push(index + 1)
      }
      result.anchors[anchorId] = result.anchors[anchorId] ?? []
      result.anchors[anchorId].push({path, lines: hits})
    }
  }
  result.unresolved = wanted.filter(anchorId => !result.anchors[anchorId])
  return result
}

export const writeSourceSnapshot = project => {
  const projectRoot = resolve(project)
  const {mode} = readPreviewMode(projectRoot)
  const traceabilityPath = traceabilityPathFor(join(projectRoot, '_workspace', '02_design', 'preview'))
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

export const recordPreviewApproval = (project, approvalText, {recordedVia = 'harness-session'} = {}) => {
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
    traceabilityDigest: sha256(readFileSync(traceabilityPathFor(join(projectRoot, '_workspace', '02_design', 'preview')))),
    testCaseIds,
  }
  const receiptLine = ''
  const heading = existing.includes('\n## Preview Approval') ? '' : '\n## Preview Approval\n'
  const body = `${heading}\n### ${record.approvedAt}\n\n- Status: APPROVED\n- Mode: ${record.mode}\n- Approval: ${record.approvalText}\n- Recorded via: ${record.recordedVia}${receiptLine}\n- Source digest: \`${record.sourceDigest}\`\n- Preview digest: \`${record.previewDigest}\`\n- Traceability digest: \`${record.traceabilityDigest}\`\n- Test cases: ${testCaseIds.join(', ')}\n\n<!-- web-harness-preview-approval\n${JSON.stringify(record)}\n-->\n`
  appendFileSync(designReviewPath, body)
  return inspectDesignPreview(projectRoot)
}
