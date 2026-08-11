import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {collectDeploymentArtifacts} from './artifact-inventory-lib.mjs'
import {computeSourceFingerprint, sha256} from './evidence-lib.mjs'
import {analyzePackageScript} from './quality-policy-lib.mjs'
import {releaseReportRequirements} from './release-report-policy.mjs'
import {resolveReleaseProfile} from './release-profile-lib.mjs'
import {readProjectRegularFile} from './safe-project-file-lib.mjs'
import {WebCoreError} from './web-core/core-lib.mjs'

const MAX_RECEIPT_AGE_MS = 24 * 60 * 60 * 1000
const REQUIRED_HYBRID_RECEIPTS = [
  'api.guards',
  'api.unit',
  'audit',
  'browser',
  'build',
  'coverage',
  'lint',
  'test',
  'typecheck',
  'vite.production-mock-boundary',
]
const CHECK_REPORTS = new Map([
  ['audit', 'security'],
  ['browser', 'browser'],
  ['build', 'integration'],
  ['coverage', 'test'],
  ['lint', 'code'],
  ['test', 'test'],
  ['typecheck', 'code'],
])

const reportStatus = source =>
  source.match(/^## Result\s*\r?\n\s*([^\r\n]+)$/im)?.[1]?.replace(/[`*_]/g, '').trim().toUpperCase() ?? null

const reportChecks = source => source.split(/\r?\n/).flatMap(line => {
  if (!line.trim().startsWith('|')) return []
  const cells = line.split('|').slice(1, -1).map(cell => cell.trim())
  if (cells.length < 4 || !CHECK_REPORTS.has(cells[0])) return []
  return [{
    id: cells[0],
    command: cells[1].replace(/^`|`$/g, ''),
    exitCode: /^-?\d+$/.test(cells[2]) ? Number(cells[2]) : null,
    status: cells[3].replace(/[`*_]/g, '').trim().toUpperCase(),
  }]
})

export const validateIsolatedCohort = ({projectRoot, declaredRevision}) => {
  if (!/^[0-9a-f]{40}$/i.test(declaredRevision ?? '')) {
    throw new WebCoreError('INVALID_ARGUMENT', 'declaredRevision must be a full Git commit SHA')
  }
  const errors = []
  const lockedProfile = resolveReleaseProfile(projectRoot, errors)
  if (!lockedProfile || lockedProfile.adapter.id !== 'vite-serverless-hybrid') {
    errors.push('locked profile must be vite-serverless-hybrid')
  }
  const artifactPaths = lockedProfile?.selection.artifacts.map(artifact => artifact.path) ?? []
  const sourceFingerprint = computeSourceFingerprint(projectRoot, {excludePaths: artifactPaths})
  const packageJson = JSON.parse(readProjectRegularFile(projectRoot, 'package.json').toString('utf8'))
  const lockfileSha256 = sha256(readProjectRegularFile(projectRoot, 'pnpm-lock.yaml'))
  const receipts = []

  for (const id of REQUIRED_HYBRID_RECEIPTS) {
    const relativePath = `_workspace/04_qa/evidence/${id}.json`
    let receipt
    try {
      receipt = JSON.parse(readProjectRegularFile(projectRoot, relativePath).toString('utf8'))
    } catch (error) {
      errors.push(`${relativePath}: cannot read trusted receipt: ${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    if (receipt.schemaVersion !== 2 || receipt.runner !== 'web-harness-quality-gate' || receipt.id !== id) {
      errors.push(`${relativePath}: trusted runner identity is invalid`)
    }
    if (receipt.status !== 'PASS' || receipt.exitCode !== 0) errors.push(`${relativePath}: command did not pass`)
    if (
      receipt.sourceFingerprint !== sourceFingerprint ||
      receipt.sourceFingerprintBefore !== sourceFingerprint ||
      receipt.sourceFingerprintAfter !== sourceFingerprint ||
      receipt.sourceMutationDetected !== false
    ) errors.push(`${relativePath}: source fingerprint or immutability binding is stale`)
    const dependency = receipt.dependencyBinding
    if (
      !dependency?.satisfied ||
      dependency.lockfileSha256 !== lockfileSha256 ||
      dependency.installedLockfileSha256 !== lockfileSha256 ||
      JSON.stringify(receipt.dependencyBindingBefore) !== JSON.stringify(dependency) ||
      JSON.stringify(receipt.dependencyBindingAfter) !== JSON.stringify(dependency) ||
      receipt.dependencyMutationDetected !== false
    ) errors.push(`${relativePath}: execution-time dependency graph binding is invalid`)
    if (
      !receipt.executionTargetBindingBefore?.satisfied ||
      JSON.stringify(receipt.executionTargetBindingBefore) !== JSON.stringify(receipt.executionTargetBindingAfter) ||
      receipt.executionTargetMutationDetected !== false
    ) errors.push(`${relativePath}: execution target binding is invalid`)
    if (
      receipt.environmentPolicy?.executionContext !== 'isolated-ci-declared' ||
      receipt.environmentPolicy?.isolatedHome !== true ||
      receipt.environmentPolicy?.secretVariablesInherited !== false
    ) errors.push(`${relativePath}: isolated CI environment declaration is missing`)
    const completedAt = Date.parse(receipt.completedAt ?? '')
    if (!Number.isFinite(completedAt) || completedAt > Date.now() + 300_000 || Date.now() - completedAt > MAX_RECEIPT_AGE_MS) {
      errors.push(`${relativePath}: receipt is missing, future-dated, or older than 24 hours`)
    }
    if (receipt.runMode !== 'all' || !/^[0-9a-f-]{36}$/i.test(receipt.qualityCohortId ?? '')) {
      errors.push(`${relativePath}: final --all cohort binding is missing`)
    }
    if (id === 'audit') {
      if (receipt.executionMode !== 'pinned-control-plane-argv' || receipt.packageScript !== null) {
        errors.push(`${relativePath}: audit execution binding is invalid`)
      }
    } else {
      const scriptName = receipt.packageScript?.name
      const scriptSource = typeof scriptName === 'string' ? packageJson.scripts?.[scriptName] : null
      const analysis = typeof scriptSource === 'string' ? analyzePackageScript(scriptSource) : null
      if (
        receipt.executionMode !== 'verified-package-argv' ||
        !analysis?.ok ||
        receipt.packageScript?.sha256 !== sha256(scriptSource) ||
        receipt.packageScript?.commandContractSha256 !== sha256(JSON.stringify(analysis.commands))
      ) errors.push(`${relativePath}: package script argv binding is invalid`)
    }
    if (lockedProfile) {
      const binding = receipt.profileBinding
      if (
        binding?.profileId !== lockedProfile.adapter.id ||
        binding?.adapterVersion !== lockedProfile.adapter.version ||
        binding?.adapterSha256 !== lockedProfile.profile.adapter.sha256 ||
        binding?.executionPlanSha256 !== lockedProfile.executionPlan.sha256 ||
        binding?.releaseTarget !== lockedProfile.selection.releaseTarget
      ) errors.push(`${relativePath}: locked profile binding is invalid`)
    }
    receipts.push(receipt)
  }

  const cohorts = [...new Set(receipts.map(receipt => receipt.qualityCohortId))]
  if (cohorts.length !== 1) errors.push('all receipts must belong to one --all cohort')
  const deployment = collectDeploymentArtifacts(
    projectRoot,
    lockedProfile?.selection.artifacts ?? [],
    {requireAll: Boolean(lockedProfile)},
  )
  errors.push(...deployment.errors)
  for (const id of ['browser', 'build', 'vite.production-mock-boundary']) {
    const receipt = receipts.find(candidate => candidate.id === id)
    if (receipt && JSON.stringify(receipt.artifactInventoryAfter) !== JSON.stringify(deployment.artifacts)) {
      errors.push(`${id}: selected deployment artifact digest is stale`)
    }
  }
  if ((receipts.find(receipt => receipt.id === 'build')?.cleanBuildArtifacts ?? []).length === 0) {
    errors.push('build receipt is not from a clean selected-artifact build')
  }

  const reports = []
  const checks = []
  for (const [reportId, fileName] of releaseReportRequirements(projectRoot, lockedProfile, 'attestation-request', false)) {
    const relativePath = `_workspace/04_qa/${fileName}`
    let source
    try {
      source = readProjectRegularFile(projectRoot, relativePath).toString('utf8')
    } catch (error) {
      errors.push(`${relativePath}: cannot read QA report: ${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    const status = reportStatus(source)
    if (status !== 'PASS') errors.push(`${relativePath}: every T1 QA report must be PASS`)
    reports.push({id: reportId, status})
    checks.push(...reportChecks(source).map(check => ({...check, reportId})))
  }
  for (const [id, expectedReportId] of CHECK_REPORTS) {
    const matches = checks.filter(check => check.id === id)
    const receipt = receipts.find(candidate => candidate.id === id)
    if (
      matches.length !== 1 ||
      matches[0].reportId !== expectedReportId ||
      matches[0].status !== 'PASS' ||
      matches[0].exitCode !== 0 ||
      matches[0].command !== receipt?.command
    ) errors.push(`${id}: QA report command evidence does not match its receipt`)
  }

  if (errors.length > 0) {
    throw new WebCoreError(
      'T1_EVIDENCE_INVALID',
      'Isolated cohort does not satisfy T1 prerequisites',
      {errors: [...new Set(errors)]},
    )
  }
  return {
    schemaVersion: 1,
    status: 'ISOLATED_VERIFIED',
    qualification: 'isolated-ci-declared',
    profileId: lockedProfile.adapter.id,
    declaredRevision,
    sourceFingerprint,
    qualityCohortId: cohorts[0],
    reports,
    receipts: receipts.map(receipt => ({id: receipt.id, status: receipt.status})),
    generatedAt: new Date().toISOString(),
    nextTier: 'T2 externally binds revision and evidence through Ed25519 attestation',
  }
}
