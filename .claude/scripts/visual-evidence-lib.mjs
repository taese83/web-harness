import {existsSync} from 'node:fs'
import {join} from 'node:path'
import {listSourceFiles, sha256} from './evidence-lib.mjs'
import {readProjectRegularFile} from './safe-project-file-lib.mjs'
import {collectDesignBinding, crossCheckVisualReferences} from './design-binding-lib.mjs'

export const VISUAL_CONTRACT_PATH = '_workspace/02_design/visual-qa-contract.json'
export const VISUAL_MANIFEST_PATH = '_workspace/02_design/visual-baseline-manifest.json'

const ID = /^[a-z0-9][a-z0-9-]*$/
const SHA256 = /^[0-9a-f]{64}$/
// visual-qa-contract.schema.json의 references 허용 키. 스키마와 갈라지면 schema-parity가 잡는다.
const VISUAL_REFERENCE_KEYS = ['id', 'kind', 'locator', 'sha256']
const safeRelativePath = value =>
  typeof value === 'string' &&
  !value.includes('\0') &&
  !value.includes('\\') &&
  !value.startsWith('/') &&
  !value.split('/').some(segment => !segment || segment === '..')
const safeRelativePng = value =>
  safeRelativePath(value) &&
  value.endsWith('.png') &&
  /(?:^|\/)e2e\/.*(?:-snapshots|\/snapshots)\/.+\.png$/.test(value)

const readJson = (projectRoot, relativePath, errors) => {
  try {
    const source = readProjectRegularFile(projectRoot, relativePath, {maxBytes: 2 * 1024 * 1024})
    return {source, value: JSON.parse(source.toString('utf8'))}
  } catch (error) {
    errors.push(`${relativePath}: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

const unique = (values, label, errors) => {
  const seen = new Set()
  for (const value of values) {
    if (seen.has(value)) errors.push(`${label} contains duplicate value: ${String(value)}`)
    seen.add(value)
  }
  return seen
}

export const validateVisualContract = (contract, errors) => {
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) {
    errors.push(`${VISUAL_CONTRACT_PATH}: contract must be an object`)
    return
  }
  if (contract.schemaVersion !== 1) errors.push(`${VISUAL_CONTRACT_PATH}: schemaVersion must be 1`)
  const render = contract.renderProfile
  if (
    render?.browser !== 'chromium' ||
    render?.animations !== 'disabled' ||
    render?.waitForFonts !== true ||
    render?.reflowCssWidth !== 320 ||
    render?.zoomEquivalentPercent !== 400 ||
    !(render?.deviceScaleFactor > 0) ||
    typeof render?.locale !== 'string' ||
    typeof render?.timezone !== 'string'
  ) errors.push(`${VISUAL_CONTRACT_PATH}: deterministic Chromium, font, animation, locale, timezone, DPR, and 320/400 reflow profile is required`)

  const thresholds = contract.thresholds
  if (
    !Number.isInteger(thresholds?.maxDiffPixels) ||
    thresholds.maxDiffPixels < 0 ||
    !(thresholds?.maxDiffPixelRatio >= 0 && thresholds.maxDiffPixelRatio <= 1) ||
    !(thresholds?.threshold >= 0 && thresholds.threshold <= 1)
  ) errors.push(`${VISUAL_CONTRACT_PATH}: screenshot thresholds are invalid`)
  if (
    contract.stability?.freezeClock !== true ||
    contract.stability?.deterministicData !== true ||
    !(contract.stability?.clsMax >= 0 && contract.stability.clsMax <= 0.1)
  ) errors.push(`${VISUAL_CONTRACT_PATH}: deterministic clock/data and CLS <= 0.1 are required`)
  if (
    contract.baselinePolicy?.approvalRequired !== true ||
    contract.baselinePolicy?.verifierMayUpdate !== false ||
    contract.baselinePolicy?.manifestPath !== VISUAL_MANIFEST_PATH
  ) errors.push(`${VISUAL_CONTRACT_PATH}: approved immutable baseline policy is required`)

  if (!Array.isArray(contract.references)) errors.push(`${VISUAL_CONTRACT_PATH}: references must be an array`)
  if (!Array.isArray(contract.modes) || contract.modes.length === 0) errors.push(`${VISUAL_CONTRACT_PATH}: modes must be non-empty`)
  if (!Array.isArray(contract.targets) || contract.targets.length === 0) errors.push(`${VISUAL_CONTRACT_PATH}: targets must be non-empty`)
  const references = Array.isArray(contract.references) ? contract.references : []
  const modes = Array.isArray(contract.modes) ? contract.modes : []
  const targets = Array.isArray(contract.targets) ? contract.targets : []
  const referenceIds = unique(references.map(reference => reference?.id), 'visual reference IDs', errors)
  const modeIds = unique(modes.map(mode => mode?.id), 'visual mode IDs', errors)
  unique(targets.map(target => target?.id), 'visual target IDs', errors)
  unique(targets.map(target => target?.baselinePath), 'visual target baseline paths', errors)

  for (const reference of references) {
    if (!ID.test(reference?.id ?? '') || !['figma-node', 'image', 'specification', 'none'].includes(reference?.kind)) {
      errors.push(`${VISUAL_CONTRACT_PATH}: invalid reference`)
    }
    // 스키마는 `additionalProperties: false`인데 이 수기 미러가 그것을 안 봤다. 상류
    // `design-binding.json`의 reference를 **통째로 복사**하면 `capturedAt`·`snapshot`이 딸려
    // 들어오고, 스키마상 무효한 계약이 receipt까지 조용히 통과한다(교차 모델 리뷰 2026-09-03).
    const unknown = Object.keys(reference ?? {}).filter(key => !VISUAL_REFERENCE_KEYS.includes(key))
    if (unknown.length > 0) {
      errors.push(`${VISUAL_CONTRACT_PATH}: reference ${reference?.id ?? '<missing>'} has unknown keys: ${unknown.sort().join(', ')}`)
    }
    if (reference?.kind === 'image' && !SHA256.test(reference?.sha256 ?? '')) {
      errors.push(`${VISUAL_CONTRACT_PATH}: image reference ${reference?.id ?? '<missing>'} requires SHA-256`)
    }
  }
  for (const mode of modes) {
    if (
      !ID.test(mode?.id ?? '') ||
      !Number.isInteger(mode?.width) ||
      mode.width < 1 ||
      !Number.isInteger(mode?.height) ||
      mode.height < 1 ||
      !['light', 'dark'].includes(mode?.colorScheme) ||
      !['reduce', 'no-preference'].includes(mode?.reducedMotion) ||
      !['none', 'active'].includes(mode?.forcedColors)
    ) errors.push(`${VISUAL_CONTRACT_PATH}: invalid mode ${mode?.id ?? '<missing>'}`)
  }
  if (!modes.some(mode => mode?.width === 320)) errors.push(`${VISUAL_CONTRACT_PATH}: a 320 CSS px mode is required`)
  if (!modes.some(mode => mode?.width >= 1024)) errors.push(`${VISUAL_CONTRACT_PATH}: a representative desktop mode is required`)
  for (const target of targets) {
    if (
      !ID.test(target?.id ?? '') ||
      !['route', 'story', 'component'].includes(target?.kind) ||
      typeof target?.locator !== 'string' ||
      !target.locator ||
      typeof target?.state !== 'string' ||
      !target.state ||
      !safeRelativePng(target?.baselinePath) ||
      typeof target?.blocking !== 'boolean'
    ) errors.push(`${VISUAL_CONTRACT_PATH}: invalid target ${target?.id ?? '<missing>'}`)
    if (!referenceIds.has(target?.referenceId)) errors.push(`${VISUAL_CONTRACT_PATH}: target ${target?.id ?? '<missing>'} has unknown referenceId`)
    if (!Array.isArray(target?.modeIds) || target.modeIds.length === 0 || target.modeIds.some(id => !modeIds.has(id))) {
      errors.push(`${VISUAL_CONTRACT_PATH}: target ${target?.id ?? '<missing>'} has invalid modeIds`)
    }
  }
}

export const collectVisualEvidence = (projectRoot, discoveredTestFiles = null) => {
  const errors = []
  if (!existsSync(join(projectRoot, VISUAL_CONTRACT_PATH))) {
    return {required: false, errors: []}
  }

  const contractDocument = readJson(projectRoot, VISUAL_CONTRACT_PATH, errors)
  const contract = contractDocument?.value ?? null
  validateVisualContract(contract, errors)
  const referenceEvidence = []
  for (const reference of Array.isArray(contract?.references) ? contract.references : []) {
    if (reference?.kind !== 'image') continue
    if (!safeRelativePath(reference.locator) || !/\.(?:jpe?g|png|webp)$/i.test(reference.locator)) {
      errors.push(`${VISUAL_CONTRACT_PATH}: image reference ${reference?.id ?? '<missing>'} must use a project-relative raster path`)
      continue
    }
    try {
      const source = readProjectRegularFile(projectRoot, reference.locator, {maxBytes: 64 * 1024 * 1024})
      const currentSha256 = sha256(source)
      if (currentSha256 !== reference.sha256) errors.push(`${reference.locator}: design reference hash differs from the contract`)
      referenceEvidence.push({id: reference.id, path: reference.locator, sha256: currentSha256})
    } catch (error) {
      errors.push(`${reference.locator}: design reference cannot be read: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  // 공급된 디자인 근거가 있으면 같은 id는 같은 것을 가리켜야 한다. 부분집합은 요구하지
  // 않는다 — visual-qa는 critical target만 고르므로 공급분 전부가 오르는 것이 정상이 아니다.
  // 검사하는 것은 **발산**이다: 한 이름이 두 곳에서 다른 것을 가리키면 정본이 둘이 되고,
  // 그러면 baseline이 무엇의 근거인지 아무도 말할 수 없다.
  const designBinding = collectDesignBinding(projectRoot)
  if (designBinding.present) {
    errors.push(...designBinding.errors)
    errors.push(...crossCheckVisualReferences(designBinding.document, contract?.references))
  }

  const manifestDocument = existsSync(join(projectRoot, VISUAL_MANIFEST_PATH))
    ? readJson(projectRoot, VISUAL_MANIFEST_PATH, errors)
    : (errors.push(`${VISUAL_MANIFEST_PATH}: approved baseline manifest is missing`), null)
  const manifest = manifestDocument?.value ?? null
  if (manifest && (manifest.schemaVersion !== 1 || !Array.isArray(manifest.baselines))) {
    errors.push(`${VISUAL_MANIFEST_PATH}: schemaVersion 1 and baselines[] are required`)
  }

  const sourceFiles = listSourceFiles(projectRoot)
  const browserTests = (discoveredTestFiles ?? sourceFiles.filter(path => /(?:^|\/)e2e\/.*\.spec\.[jt]sx?$/.test(path))).sort()
  const assertions = []
  for (const relativePath of browserTests) {
    try {
      const source = readProjectRegularFile(projectRoot, relativePath, {maxBytes: 2 * 1024 * 1024}).toString('utf8')
      const count = source.match(/\btoHaveScreenshot\s*\(/g)?.length ?? 0
      if (count > 0) assertions.push({path: relativePath, count, sha256: sha256(source)})
    } catch (error) {
      errors.push(`${relativePath}: visual test cannot be read: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (assertions.length === 0) errors.push('visual contract requires at least one Playwright toHaveScreenshot assertion')

  const baselines = Array.isArray(manifest?.baselines) ? manifest.baselines : []
  const manifestTargetIds = unique(baselines.map(entry => entry?.targetId), 'visual manifest target IDs', errors)
  unique(baselines.map(entry => entry?.path), 'visual manifest paths', errors)
  const targetById = new Map((Array.isArray(contract?.targets) ? contract.targets : []).map(target => [target.id, target]))
  const baselineEvidence = []
  for (const entry of baselines) {
    const target = targetById.get(entry?.targetId)
    if (
      !target ||
      entry?.path !== target.baselinePath ||
      !safeRelativePng(entry?.path) ||
      !SHA256.test(entry?.sha256 ?? '') ||
      typeof entry?.approvedBy !== 'string' ||
      !entry.approvedBy ||
      !Number.isFinite(Date.parse(entry?.approvedAt ?? '')) ||
      typeof entry?.reason !== 'string' ||
      !entry.reason ||
      entry?.referenceId !== target.referenceId
    ) {
      errors.push(`${VISUAL_MANIFEST_PATH}: invalid approval entry for ${entry?.targetId ?? '<missing>'}`)
      continue
    }
    try {
      const source = readProjectRegularFile(projectRoot, entry.path, {maxBytes: 64 * 1024 * 1024})
      const currentSha256 = sha256(source)
      if (currentSha256 !== entry.sha256) errors.push(`${entry.path}: baseline hash differs from approved manifest`)
      baselineEvidence.push({
        targetId: entry.targetId,
        path: entry.path,
        sha256: currentSha256,
        approvedBy: entry.approvedBy,
        approvedAt: entry.approvedAt,
        referenceId: entry.referenceId,
      })
    } catch (error) {
      errors.push(`${entry.path}: approved baseline cannot be read: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  for (const targetId of targetById.keys()) {
    if (!manifestTargetIds.has(targetId)) errors.push(`${VISUAL_MANIFEST_PATH}: target ${targetId} has no approved baseline`)
  }
  let designTokenEvidence = null
  if (contract?.designTokens?.path) {
    if (!safeRelativePath(contract.designTokens.path) || !sourceFiles.includes(contract.designTokens.path)) {
      errors.push(`${contract.designTokens.path}: declared design token source is missing or unsafe`)
    } else {
      const tokenDocument = readJson(projectRoot, contract.designTokens.path, errors)
      if (tokenDocument) {
        designTokenEvidence = {
          format: contract.designTokens.format,
          path: contract.designTokens.path,
          sha256: sha256(tokenDocument.source),
        }
      }
    }
  }

  return {
    required: true,
    contractPath: VISUAL_CONTRACT_PATH,
    contractSha256: contractDocument ? sha256(contractDocument.source) : null,
    manifestPath: VISUAL_MANIFEST_PATH,
    manifestSha256: manifestDocument ? sha256(manifestDocument.source) : null,
    executionPlatform: {platform: process.platform, architecture: process.arch},
    renderProfile: contract?.renderProfile ?? null,
    thresholds: contract?.thresholds ?? null,
    stability: contract?.stability ?? null,
    targetCount: targetById.size,
    references: referenceEvidence,
    designTokens: designTokenEvidence,
    assertions,
    baselines: baselineEvidence,
    errors: [...new Set(errors)].sort(),
  }
}

export const visualEvidenceMatches = (actual, expected) =>
  JSON.stringify(actual ?? null) === JSON.stringify(expected ?? null)
