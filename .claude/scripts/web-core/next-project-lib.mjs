import {existsSync, lstatSync, readFileSync} from 'node:fs'
import {resolveProfileCommands} from '../resolve-commands.mjs'
import {dirname, join, resolve} from 'node:path'
import {collectDeploymentArtifacts} from '../artifact-inventory-lib.mjs'
import {computeSourceFingerprint, sha256} from '../evidence-lib.mjs'
import {verifyQualityAttestation} from '../quality-attestation-lib.mjs'
import {
  analyzePackageScript,
  readDependencyBinding,
  readExecutionTargetBinding,
} from '../quality-policy-lib.mjs'
import {resolveProjectProfile} from './profile-lib.mjs'
import {
  adapterCheckBindings,
  projectProfileSha256,
  readLockedExecutionPlan,
  readLockedProjectProfile,
  validateLockedProfileProjectState,
} from './profile-policy-lib.mjs'
import {stableStringify, WebCoreError} from './core-lib.mjs'

const MATRIX_HEADINGS = [
  '## Route Matrix',
  '## Server Client Boundary Matrix',
  '## Authorization Matrix',
  '## Environment Matrix',
  '## Cache Matrix',
  '## Deployment Matrix',
]

const readRegularFile = (path, code) => {
  if (!existsSync(path) || !lstatSync(path).isFile()) throw new WebCoreError(code, `Required regular file is missing: ${path}`)
  return readFileSync(path, 'utf8')
}

const validateBuildEnvironment = projectRoot => {
  const path = join(projectRoot, '_workspace/02_design/build-environment.json')
  const source = readRegularFile(path, 'NEXT_BUILD_ENVIRONMENT_MISSING')
  let contract
  try {
    contract = JSON.parse(source)
  } catch {
    throw new WebCoreError('NEXT_BUILD_ENVIRONMENT_INVALID', 'build-environment.json must be valid JSON')
  }
  if (contract.schemaVersion !== 1 || !Array.isArray(contract.public) || Object.keys(contract).some(key => !['schemaVersion', 'public'].includes(key))) {
    throw new WebCoreError('NEXT_BUILD_ENVIRONMENT_INVALID', 'build-environment.json must contain only schemaVersion 1 and public[]')
  }
  for (const name of contract.public) {
    if (
      typeof name !== 'string' ||
      !/^NEXT_PUBLIC_[A-Z0-9_]+$/.test(name) ||
      /(?:SECRET|TOKEN|PASSWORD|CREDENTIAL|PRIVATE_KEY|API_KEY)/.test(name)
    ) throw new WebCoreError('NEXT_BUILD_ENVIRONMENT_UNSAFE', `Unsafe public environment name: ${String(name)}`)
  }
  return {sha256: sha256(source), public: [...new Set(contract.public)].sort()}
}

export const validateNextProject = projectPath => {
  const projectRoot = resolve(projectPath)
  const lockedProfile = readLockedProjectProfile(join(projectRoot, '_workspace/01_plan/project-profile.json'))
  if (lockedProfile.adapter.id !== 'next-app-fullstack') {
    throw new WebCoreError('NEXT_PROFILE_REQUIRED', 'Project validation requires the next-app-fullstack profile')
  }
  validateLockedProfileProjectState(lockedProfile, projectRoot)
  const executionPlan = readLockedExecutionPlan(
    join(projectRoot, '_workspace/03_dev/web-execution-plan.json'),
    lockedProfile,
  )
  resolveProjectProfile({
    projectRoot,
    requested: 'next-app-fullstack',
    deploymentProvider: lockedProfile.selection.provider.id,
    deploymentTarget: lockedProfile.selection.target.id,
    capabilities: lockedProfile.selection.selectedCapabilities,
  })

  const matrixPath = join(projectRoot, '_workspace/02_design/next-contract-matrices.md')
  const matrices = readRegularFile(matrixPath, 'NEXT_MATRICES_MISSING')
  const missingMatrices = MATRIX_HEADINGS.filter(heading => !matrices.includes(heading))
  if (missingMatrices.length) {
    throw new WebCoreError('NEXT_MATRICES_INCOMPLETE', 'Next contract matrices are incomplete', {missingMatrices})
  }
  const buildEnvironment = validateBuildEnvironment(projectRoot)
  const inventory = collectDeploymentArtifacts(projectRoot, lockedProfile.selection.artifacts, {requireAll: true})
  if (inventory.errors.length) throw new WebCoreError('NEXT_ARTIFACT_INVALID', 'Selected deployment artifact is invalid', {errors: inventory.errors})

  const sourceFingerprint = computeSourceFingerprint(projectRoot, {
    excludePaths: lockedProfile.selection.artifacts.map(artifact => artifact.path),
  })
  const bindings = adapterCheckBindings({
    adapter: lockedProfile.adapter,
    deploymentProvider: lockedProfile.selection.provider.id,
    deploymentTarget: lockedProfile.selection.target.id,
    capabilities: lockedProfile.selection.selectedCapabilities,
  })
  const packageJson = JSON.parse(readRegularFile(join(projectRoot, 'package.json'), 'NEXT_PACKAGE_INVALID'))
  const dependencyBinding = readDependencyBinding(projectRoot, packageJson)
  if (!dependencyBinding.satisfied) {
    throw new WebCoreError('NEXT_DEPENDENCY_BINDING_STALE', 'Installed dependency graph does not match the reviewed lockfile')
  }
  const pnpmExecutable = join(dirname(process.execPath), process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm')
  const commands = resolveProfileCommands({projectRoot, adapter: lockedProfile.adapter})
  const cohortIds = new Set()
  const environmentDigests = new Set()
  const receipts = []
  for (const binding of bindings) {
    const path = join(projectRoot, `_workspace/04_qa/evidence/${binding.receiptId}.json`)
    let receipt
    let receiptSource
    try {
      receiptSource = readRegularFile(path, 'NEXT_RECEIPT_MISSING')
      receipt = JSON.parse(receiptSource)
    } catch (error) {
      if (error instanceof WebCoreError) throw error
      throw new WebCoreError('NEXT_RECEIPT_INVALID', `Invalid receipt JSON: ${binding.receiptId}`)
    }
    const expectedBinding = {
      profileId: lockedProfile.adapter.id,
      adapterVersion: lockedProfile.adapter.version,
      adapterSha256: lockedProfile.profile.adapter.sha256,
      deploymentProvider: lockedProfile.selection.provider.id,
      deploymentTarget: lockedProfile.selection.target.id,
      profileSha256: projectProfileSha256(lockedProfile.profile),
      selectedCapabilities: lockedProfile.selection.selectedCapabilities,
      releaseTarget: lockedProfile.selection.releaseTarget,
      executionPlanSha256: executionPlan.sha256,
      buildEnvironmentSha256: buildEnvironment.sha256,
      publicEnvironmentSha256: receipt.environmentPolicy?.publicEnvironmentSha256,
    }
    const completedAt = Date.parse(receipt.completedAt ?? '')
    const command = commands.get(binding.commandId)
    const expectedScriptName = command?.args?.[0] === 'run' ? command.args[1] : null
    const packageScriptSource = expectedScriptName ? packageJson.scripts?.[expectedScriptName] : null
    const packageScriptAnalysis = typeof packageScriptSource === 'string' ? analyzePackageScript(packageScriptSource) : null
    const executionTargetBinding = readExecutionTargetBinding({
      projectRoot,
      analysis: packageScriptAnalysis,
      pnpmExecutable,
      searchPath: process.env.PATH,
    })
    if (
      receipt.schemaVersion !== 2 ||
      receipt.runner !== 'web-harness-quality-gate' ||
      receipt.id !== binding.receiptId ||
      receipt.adapterCheckId !== binding.id ||
      receipt.adapterCommandId !== binding.commandId ||
      receipt.status !== 'PASS' ||
      receipt.exitCode !== 0 ||
      receipt.executionMode !== 'verified-package-argv' ||
      receipt.sourceFingerprint !== sourceFingerprint ||
      receipt.sourceFingerprintAfter !== sourceFingerprint ||
      receipt.sourceMutationDetected !== false ||
      receipt.runMode !== 'all' ||
      !/^[0-9a-f-]{36}$/i.test(receipt.qualityCohortId ?? '') ||
      !Number.isFinite(completedAt) ||
      completedAt > Date.now() + 5 * 60 * 1000 ||
      Date.now() - completedAt > 24 * 60 * 60 * 1000 ||
      !/^[0-9a-f]{64}$/.test(receipt.environmentPolicy?.publicEnvironmentSha256 ?? '') ||
      receipt.environmentPolicy?.isolatedHome !== true ||
      receipt.environmentPolicy?.secretVariablesInherited !== false ||
      !['isolated-ci-declared', 'user-approved-host'].includes(receipt.environmentPolicy?.executionContext) ||
      receipt.stdoutTail !== '' ||
      receipt.stderrTail !== '' ||
      receipt.outputTailPolicy !== 'omitted-to-prevent-secret-persistence' ||
      !expectedScriptName ||
      !packageScriptAnalysis?.ok ||
      receipt.packageScript?.name !== expectedScriptName ||
      receipt.packageScript?.sha256 !== sha256(packageScriptSource ?? '') ||
      receipt.packageScript?.commandContractSha256 !== sha256(JSON.stringify(packageScriptAnalysis?.commands ?? [])) ||
      stableStringify(receipt.dependencyBinding) !== stableStringify(dependencyBinding) ||
      stableStringify(receipt.dependencyBindingBefore) !== stableStringify(dependencyBinding) ||
      stableStringify(receipt.dependencyBindingAfter) !== stableStringify(dependencyBinding) ||
      receipt.dependencyMutationDetected !== false ||
      !executionTargetBinding.satisfied ||
      stableStringify(receipt.executionTargetBindingBefore) !== stableStringify(executionTargetBinding) ||
      stableStringify(receipt.executionTargetBindingAfter) !== stableStringify(executionTargetBinding) ||
      receipt.executionTargetMutationDetected !== false ||
      stableStringify(receipt.profileBinding) !== stableStringify(expectedBinding)
    ) throw new WebCoreError('NEXT_RECEIPT_STALE', `Receipt is missing or stale: ${binding.receiptId}`)
    if (
      ['artifact', 'browser', 'build', 'runtime'].includes(binding.kind) &&
      stableStringify(receipt.artifactInventoryAfter ?? []) !== stableStringify(inventory.artifacts)
    ) throw new WebCoreError('NEXT_ARTIFACT_RECEIPT_STALE', `Receipt is not bound to the selected artifact: ${binding.receiptId}`)
    if (binding.kind === 'build' && !lockedProfile.selection.artifacts.every(artifact =>
      receipt.cleanBuildArtifacts?.some(path => artifact.path === path || artifact.path.startsWith(`${path}/`)),
    )) {
      throw new WebCoreError('NEXT_ARTIFACT_RECEIPT_STALE', `Build receipt is not from a clean selected artifact build: ${binding.receiptId}`)
    }
    cohortIds.add(receipt.qualityCohortId)
    environmentDigests.add(receipt.environmentPolicy.publicEnvironmentSha256)
    receipts.push({
      id: binding.receiptId,
      checkId: binding.id,
      commandId: binding.commandId,
      path: `_workspace/04_qa/evidence/${binding.receiptId}.json`,
      sha256: sha256(receiptSource),
      qualityCohortId: receipt.qualityCohortId,
      executionContext: receipt.environmentPolicy.executionContext,
    })
  }
  if (cohortIds.size !== 1 || environmentDigests.size !== 1) {
    throw new WebCoreError('NEXT_RECEIPT_COHORT_STALE', 'Next receipts do not share one quality cohort and public environment')
  }
  const attestationErrors = []
  const attestation = verifyQualityAttestation({
    projectRoot,
    receipts,
    sourceFingerprint,
    errors: attestationErrors,
    allowAdditionalReceiptDigests: true,
  })
  if (attestationErrors.length > 0 || attestation?.status !== 'PASS') {
    throw new WebCoreError('NEXT_ATTESTATION_INVALID', 'Next receipts lack trusted isolated-CI attestation', {
      errors: attestationErrors,
    })
  }
  const sourceFingerprintAfterValidation = computeSourceFingerprint(projectRoot, {
    excludePaths: lockedProfile.selection.artifacts.map(artifact => artifact.path),
  })
  if (sourceFingerprintAfterValidation !== sourceFingerprint) {
    throw new WebCoreError('NEXT_SOURCE_CHANGED_DURING_VALIDATION', 'Source changed while Next evidence was being validated')
  }
  return {
    ok: true,
    status: 'VERIFIED_FOR_CURRENT_FINGERPRINT',
    supportLevel: lockedProfile.adapter.supportLevel,
    profileId: lockedProfile.adapter.id,
    deploymentProvider: lockedProfile.selection.provider.id,
    deploymentTarget: lockedProfile.selection.target.id,
    sourceFingerprint,
    executionPlanSha256: executionPlan.sha256,
    artifacts: inventory.artifacts,
    receipts,
    attestation,
  }
}
