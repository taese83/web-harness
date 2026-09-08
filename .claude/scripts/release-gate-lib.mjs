import {existsSync, readdirSync, readFileSync} from 'node:fs'
import {basename, join, resolve} from 'node:path'
import {
  computeSourceFingerprint,
  listSourceFiles,
  normalizePath,
  sha256,
} from './evidence-lib.mjs'
import {
  collectAdapterReleaseEvidence,
  releaseProfileSummary,
  resolveReleaseProfile,
} from './release-profile-lib.mjs'
import {isVisualProject, releaseReportRequirements} from './release-report-policy.mjs'
import {collectDeploymentArtifacts} from './artifact-inventory-lib.mjs'
import {verifyQualityAttestation} from './quality-attestation-lib.mjs'
import {createReceiptValidationContext, readReceipt} from './receipt-validation-lib.mjs'
import {
  INGESTION_RECEIPT_ID,
  ingestionEvidenceMatches,
  validateRuntimeDataArtifacts,
} from './runtime-data-contract-lib.mjs'
import {readProjectRegularFile} from './safe-project-file-lib.mjs'
import {inspectExternalIngestion} from './web-core/ingestion-detection-lib.mjs'
import {inspectSpecConformance} from './validate-spec-conformance.mjs'
import {acceptanceSummary, designRoundSummary, resolveSymbols, routeBindingSummary} from './design-evidence-lib.mjs'
export {computeSourceFingerprint, listSourceFiles, normalizePath, sha256} from './evidence-lib.mjs'
export {releaseReportRequirements} from './release-report-policy.mjs'
export {acceptanceSummary, designRoundSummary, exportedNames, resolveSymbols, routeBindingSummary} from './design-evidence-lib.mjs'
export const REQUIRED_CHECKS = new Map([
  ['typecheck', 'code'],
  ['lint', 'code'],
  ['build', 'integration'],
  ['test', 'test'],
  ['coverage', 'test'],
  ['browser', 'browser'],
  ['audit', 'security'],
])
const REPORT_PASSING_STATUSES = new Set(['PASS', 'WARN'])
const KNOWN_STATUSES = new Set(['PASS', 'WARN', 'FAIL', 'BLOCKED', 'NEEDS_REVIEW'])
const PACKAGE_ARTIFACT_NAMES = new Set(['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'])
const normalizeStatus = value => value.replace(/[`*_]/g, '').trim().toUpperCase()
const parseResult = source => {
  const match = source.match(/^## Result\s*\r?\n\s*([^\r\n]+)$/im)
  if (!match) return null
  const status = normalizeStatus(match[1])
  return KNOWN_STATUSES.has(status) ? status : null
}
const parseChecks = (source, reportId) => {
  const checks = []
  for (const line of source.split(/\r?\n/)) {
    if (!line.trim().startsWith('|')) continue
    const cells = line
      .split('|')
      .slice(1, -1)
      .map(cell => cell.trim())
    if (cells.length < 4) continue

    const [id, command, rawExitCode, rawStatus] = cells
    const status = normalizeStatus(rawStatus)
    if (!REQUIRED_CHECKS.has(id) || !KNOWN_STATUSES.has(status)) continue

    const exitCode = /^-?\d+$/.test(rawExitCode) ? Number(rawExitCode) : null
    checks.push({id, reportId, command: command.replace(/^`|`$/g, ''), exitCode, status})
  }
  return checks
}
const readArtifact = (projectRoot, relativePath, errors) => {
  const absolutePath = join(projectRoot, relativePath)
  if (!existsSync(absolutePath)) {
    errors.push(`Required artifact is missing: ${relativePath}`)
    return null
  }
  let source
  try {
    source = readProjectRegularFile(projectRoot, relativePath, {maxBytes: 64 * 1024 * 1024})
  } catch (error) {
    errors.push(`Required artifact cannot be read safely: ${relativePath}: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
  return {path: relativePath, sha256: sha256(source)}
}

const collectPackageArtifacts = (projectRoot, errors) => {
  const rootArtifacts = ['package.json', 'pnpm-lock.yaml']
  for (const relativePath of rootArtifacts) {
    if (!existsSync(join(projectRoot, relativePath))) errors.push(`Required artifact is missing: ${relativePath}`)
  }

  return listSourceFiles(projectRoot)
    .filter(relativePath => PACKAGE_ARTIFACT_NAMES.has(basename(relativePath)))
    .map(relativePath => readArtifact(projectRoot, relativePath, errors))
    .filter(Boolean)
}

export const requiresProtectedPrebuiltDeployment = lockedProfile => Boolean(
  lockedProfile?.selection?.provider?.id === 'vercel' &&
  lockedProfile.selection.selectedCapabilities?.includes('external-ingestion') &&
  ['static-cdn', 'static-export'].includes(lockedProfile.selection.target?.id)
)

const collectSpecConformanceErrors = (projectRoot, errors) => {
  let result
  try {
    result = inspectSpecConformance({projectRoot})
  } catch (error) {
    errors.push(`Spec conformance could not be inspected: ${error instanceof Error ? error.message : String(error)}`)
    return
  }
  if (result.status !== 'FAIL') return
  for (const failure of result.failures) {
    errors.push(`Spec conformance [${failure.kind}]: ${failure.reason}`)
  }
}

export const buildReleaseManifest = (projectPath, {phase = 'final', readExports} = {}) => {
  if (!['attestation-request', 'final'].includes(phase)) {
    throw new TypeError(`Unknown release manifest phase: ${phase}`)
  }
  const projectRoot = resolve(projectPath)
  const qaDirectory = join(projectRoot, '_workspace/04_qa')
  const errors = []
  const reports = []
  const checks = []
  const receipts = []
  const adapterChecks = []
  const ingestionInspection = inspectExternalIngestion(projectRoot)
  errors.push(...ingestionInspection.errors.map(error => `External ingestion declaration is invalid: ${error}`))
  if (ingestionInspection.detected && !ingestionInspection.contractsComplete) {
    errors.push(
      'External ingestion markers require both _workspace/02_design/ingestion-contract.md and ' +
      '_workspace/02_design/runtime-data-contract.json',
    )
  }
  const lockedProfile = resolveReleaseProfile(projectRoot, errors)
  if (requiresProtectedPrebuiltDeployment(lockedProfile)) {
    errors.push(
      'Vercel static external-ingestion production release is blocked until a protected prebuilt deployment broker ' +
      'proves process-namespace teardown and binds the attested immutable artifact digest to the deployed Vercel subject',
    )
  }
  const receiptValidationContext = createReceiptValidationContext(projectRoot)
  const sourceFingerprint = computeSourceFingerprint(projectRoot, {
    excludePaths: lockedProfile?.selection.artifacts.map(artifact => artifact.path) ?? [],
  })

  let ingestionValidation = null
  if (ingestionInspection.contractsComplete) {
    ingestionValidation = validateRuntimeDataArtifacts(projectRoot, {
      mutableArtifactRoots: lockedProfile?.selection.artifacts.map(artifact => artifact.path) ?? [],
    })
    errors.push(...ingestionValidation.errors)
  }

  for (const [id, fileName] of releaseReportRequirements(
    projectRoot,
    lockedProfile,
    phase,
    ingestionInspection.detected,
  )) {
    const relativePath = `_workspace/04_qa/${fileName}`
    const absolutePath = join(qaDirectory, fileName)
    if (!existsSync(absolutePath)) {
      errors.push(`Required QA report is missing: ${relativePath}`)
      continue
    }
    let reportSource
    try {
      reportSource = readProjectRegularFile(projectRoot, relativePath, {maxBytes: 2 * 1024 * 1024})
    } catch (error) {
      errors.push(`${relativePath}: QA report cannot be read safely: ${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    const source = reportSource.toString('utf8')
    const status = parseResult(source)
    if (!status) {
      errors.push(`${relativePath}: exact "## Result" status is missing or invalid`)
      continue
    }

    reports.push({id, path: relativePath, sha256: sha256(source), status})
    checks.push(...parseChecks(source, id))
    if (id === 'data-quality' && status !== 'PASS') errors.push(`${relativePath}: status is ${status}; external data quality requires PASS`)
    else if (!REPORT_PASSING_STATUSES.has(status)) errors.push(`${relativePath}: status is ${status}`)
  }

  for (const [checkId, expectedReportId] of REQUIRED_CHECKS) {
    const matches = checks.filter(check => check.id === checkId)
    const receipt = readReceipt(
      projectRoot,
      checkId,
      sourceFingerprint,
      errors,
      lockedProfile,
      receiptValidationContext,
    )
    if (receipt) receipts.push(receipt)

    if (matches.length !== 1) {
      errors.push(`Required command evidence must appear exactly once: ${checkId}`)
      continue
    }

    const [check] = matches
    if (check.reportId !== expectedReportId) {
      errors.push(`${checkId}: command evidence belongs in qa-${expectedReportId}.md`)
    }
    const allowedStatuses = checkId === 'coverage' ? new Set(['PASS', 'WARN']) : new Set(['PASS'])
    if (!allowedStatuses.has(check.status)) errors.push(`${checkId}: status is ${check.status}`)
    if (check.exitCode !== 0) errors.push(`${checkId}: exit code must be 0`)
    if (!check.command) errors.push(`${checkId}: command is empty`)
    if (receipt && check.command !== receipt.command) errors.push(`${checkId}: report command does not match machine receipt`)
    if (receipt && check.exitCode !== receipt.exitCode) errors.push(`${checkId}: report exit code does not match machine receipt`)
  }

  if (ingestionInspection.contractsComplete) {
    const receipt = readReceipt(
      projectRoot,
      INGESTION_RECEIPT_ID,
      sourceFingerprint,
      errors,
      lockedProfile,
      receiptValidationContext,
    )
    if (receipt) {
      try {
        const receiptSource = readProjectRegularFile(
          projectRoot,
          `_workspace/04_qa/evidence/${INGESTION_RECEIPT_ID}.json`,
          {maxBytes: 2 * 1024 * 1024},
        )
        const receiptDocument = JSON.parse(receiptSource.toString('utf8'))
        if (!ingestionEvidenceMatches(receiptDocument.ingestionValidation, ingestionValidation)) {
          errors.push(`_workspace/04_qa/evidence/${INGESTION_RECEIPT_ID}.json: runtime data validation evidence is stale`)
        }
      } catch (error) {
        errors.push(
          `_workspace/04_qa/evidence/${INGESTION_RECEIPT_ID}.json: cannot verify runtime data validation evidence: ` +
          `${error instanceof Error ? error.message : String(error)}`,
        )
      }
      receipts.push(receipt)
    }
  }

  const deploymentArtifacts = collectDeploymentArtifacts(
    projectRoot,
    lockedProfile?.selection.artifacts ?? [],
    {requireAll: Boolean(lockedProfile)},
  )
  errors.push(...deploymentArtifacts.errors)
  adapterChecks.push(...collectAdapterReleaseEvidence({
    lockedProfile,
    receipts,
    sourceFingerprint,
    errors,
    deploymentArtifacts: deploymentArtifacts.artifacts,
    readReceipt: (checkId, fingerprint, targetErrors, profile) =>
      readReceipt(projectRoot, checkId, fingerprint, targetErrors, profile, receiptValidationContext),
  }))
  const cohortIds = new Set(receipts.map(receipt => receipt.qualityCohortId).filter(Boolean))
  if (cohortIds.size !== 1 || receipts.some(receipt => receipt.runMode !== 'all')) {
    errors.push('All release receipts must come from one final --all quality cohort')
  }
  const environmentDigests = new Set(receipts.map(receipt => receipt.publicEnvironmentSha256).filter(Boolean))
  if (environmentDigests.size !== 1) errors.push('Release receipts were produced with different public build environments')
  const attestation = phase === 'final'
    ? verifyQualityAttestation({
        projectRoot,
        receipts,
        sourceFingerprint,
        errors,
      })
    : null

  const artifactCandidates = [
    ...collectPackageArtifacts(projectRoot, errors),
    ...(ingestionInspection.detected
      ? ['_workspace/02_design/ingestion-contract.md', '_workspace/02_design/runtime-data-contract.json']
          .map(relativePath => readArtifact(projectRoot, relativePath, errors))
          .filter(Boolean)
      : []),
    ...(ingestionValidation?.evidenceFiles ?? []),
    ...(isVisualProject(projectRoot)
      ? ['_workspace/02_design/visual-qa-contract.json', '_workspace/02_design/visual-baseline-manifest.json']
          .map(relativePath => readArtifact(projectRoot, relativePath, errors))
          .filter(Boolean)
      : []),
    ...deploymentArtifacts.artifacts,
  ]
  const artifacts = [...new Map(artifactCandidates.map(artifact => [artifact.path, artifact])).values()]
    .sort((left, right) => left.path.localeCompare(right.path))
  const sourceFingerprintAfterValidation = computeSourceFingerprint(projectRoot, {
    excludePaths: lockedProfile?.selection.artifacts.map(artifact => artifact.path) ?? [],
  })
  if (sourceFingerprintAfterValidation !== sourceFingerprint) {
    errors.push('Source tree changed while release evidence was being validated')
  }
  // 시안 구현 대조표 — 표 부재는 계약 의무 불이행이라 막고, 부실 기재 신호는 기록만 한다.
  // 설계 → 코드 결속. **기록만 한다** — 경로만으로는 미구현과 개명을 구별할 수 없어
  // 차단하면 개명한 정직한 프로젝트를 막는다(실측 근거는 `routeBindingSummary` 머리말).
  const routeBinding = routeBindingSummary(projectPath)
  // 심볼 수준은 경로가 못 가른 것을 가른다 — 선언된 심볼이 다른 파일에 있으면 개명,
  // 그 이름이 어디에도 없으면 「이름 없음」이다(**미구현과 같지 않다** — 이름까지 바뀐
  // 개명은 여기서 「이름 없음」으로 읽힌다). **역시 기록만 한다** — 실측에서 완주한 프로젝트도
  // 미구현 항목을 가져 차단하면 소급 차단이 된다. 프로젝트 TypeScript를 빌려 쓰고
  // 없으면 `NOT_MEASURED`(통과가 아니다)다.
  const symbolBinding = resolveSymbols(projectPath, routeBinding, {readExports})
  const designRound = designRoundSummary(projectPath)
  if (designRound.state === 'MISSING') errors.push(`Design round implementation verdict is missing: ${designRound.missing.join(', ')}`)
  const manifest = {
    schemaVersion: 3,
    generatedAt: new Date().toISOString(),
    projectRoot: '.',
    sourceFingerprint,
    releaseStatus: errors.length === 0 ? 'PASS' : 'BLOCKED',
    reports,
    checks,
    receipts,
    attestation,
    acceptance: acceptanceSummary(projectPath),
    designRound,
    routeBinding,
    symbolBinding,
    profile: releaseProfileSummary(lockedProfile),
    adapterChecks,
    artifacts,
  }

  return {errors: [...new Set(errors)], manifest}
}

// `readExports`는 **테스트 주입용 구멍**이다 — 심볼 상태가 릴리스 판정을 바꾸지 않는다는
// 것을 회귀가 실제 상태(UNBUILT/RESOLVED)로 확인하려면 여기까지 뚫려 있어야 한다.
export const validateReleaseGate = (projectPath, {readExports} = {}) => {
  const projectRoot = resolve(projectPath)
  const manifestPath = join(projectRoot, '_workspace/04_qa/qa-manifest.json')
  const expected = buildReleaseManifest(projectRoot, {readExports})
  const errors = [...expected.errors]
  collectSpecConformanceErrors(projectRoot, errors)

  if (!existsSync(manifestPath)) {
    errors.push('QA manifest is missing: _workspace/04_qa/qa-manifest.json')
    return {errors: [...new Set(errors)], manifest: null}
  }

  let manifestSource
  try {
    manifestSource = readProjectRegularFile(projectRoot, '_workspace/04_qa/qa-manifest.json')
  } catch (error) {
    errors.push(`QA manifest cannot be inspected safely: ${error instanceof Error ? error.message : String(error)}`)
    return {errors: [...new Set(errors)], manifest: null}
  }

  let manifest
  try {
    manifest = JSON.parse(manifestSource.toString('utf8'))
  } catch (error) {
    errors.push(`QA manifest is invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
    return {errors: [...new Set(errors)], manifest: null}
  }

  if (manifest.schemaVersion !== 3) errors.push('QA manifest schemaVersion must be 3')
  if (manifest.projectRoot !== '.') errors.push('QA manifest projectRoot must be "."')
  if (manifest.sourceFingerprint !== expected.manifest.sourceFingerprint) {
    errors.push('QA manifest sourceFingerprint does not match the current source tree')
  }
  if (manifest.releaseStatus !== expected.manifest.releaseStatus) {
    errors.push('QA manifest releaseStatus does not match current evidence')
  }

  for (const collectionName of ['reports', 'checks', 'receipts', 'adapterChecks', 'artifacts']) {
    const actual = JSON.stringify(manifest[collectionName] ?? [])
    const current = JSON.stringify(expected.manifest[collectionName])
    if (actual !== current) errors.push(`QA manifest ${collectionName} do not match current evidence`)
  }
  if (JSON.stringify(manifest.profile ?? null) !== JSON.stringify(expected.manifest.profile)) {
    errors.push('QA manifest profile does not match the locked project profile')
  }
  if (JSON.stringify(manifest.attestation ?? null) !== JSON.stringify(expected.manifest.attestation)) {
    errors.push('QA manifest attestation does not match the trusted quality evidence')
  }

  if (manifest.releaseStatus !== 'PASS') errors.push(`Release status is ${manifest.releaseStatus ?? 'missing'}`)
  return {errors: [...new Set(errors)], manifest}
}
