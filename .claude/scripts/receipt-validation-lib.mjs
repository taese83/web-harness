import {existsSync, readFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {sha256} from './evidence-lib.mjs'
import {readProjectRegularFile} from './safe-project-file-lib.mjs'
import {validateStaticRuntimeDataDeployment} from './runtime-data-deployment-lib.mjs'
import {parseTrustedPromotionActions} from './validators/validate-workflows-and-evals.mjs'
import {
  analyzePackageScript,
  readDependencyBinding,
  readExecutionTargetBinding,
} from './quality-policy-lib.mjs'
import {collectVisualEvidence, visualEvidenceMatches} from './visual-evidence-lib.mjs'

const MAX_RECEIPT_AGE_MS = 24 * 60 * 60 * 1000
const MAX_RECEIPT_BYTES = 2 * 1024 * 1024

const readReceiptSource = (projectRoot, relativePath) =>
  readProjectRegularFile(projectRoot, relativePath, {maxBytes: MAX_RECEIPT_BYTES}).toString('utf8')

export const createReceiptValidationContext = projectRoot => {
  let packageMetadata = {}
  try {
    packageMetadata = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'))
  } catch {}
  return {
    packageMetadata,
    dependencyBinding: readDependencyBinding(projectRoot, packageMetadata),
  }
}

export const readReceipt = (
  projectRoot,
  checkId,
  sourceFingerprint,
  errors,
  expectedProfile = null,
  validationContext = null,
) => {
  const relativePath = `_workspace/04_qa/evidence/${checkId}.json`
  const absolutePath = join(projectRoot, relativePath)
  if (!existsSync(absolutePath)) {
    errors.push(`Required machine receipt is missing: ${relativePath}`)
    return null
  }
  let source
  try {
    source = readReceiptSource(projectRoot, relativePath)
  } catch (error) {
    errors.push(`${relativePath}: cannot read trusted receipt: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
  let receipt
  try {
    receipt = JSON.parse(source)
  } catch (error) {
    errors.push(`${relativePath}: invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }

  if (receipt.schemaVersion !== 2) errors.push(`${relativePath}: schemaVersion must be 2`)
  if (receipt.runner !== 'web-harness-quality-gate') errors.push(`${relativePath}: untrusted receipt runner`)
  if (receipt.id !== checkId) errors.push(`${relativePath}: receipt id must be ${checkId}`)
  if (receipt.sourceFingerprint !== sourceFingerprint) errors.push(`${relativePath}: source fingerprint is stale`)
  if (receipt.sourceFingerprintAfter !== sourceFingerprint) errors.push(`${relativePath}: command did not finish on the current source tree`)
  if (receipt.sourceMutationDetected !== false) errors.push(`${relativePath}: command mutated protected source files`)
  if (receipt.engineSatisfied === false) errors.push(`${relativePath}: Node engine is not satisfied`)
  if (receipt.packageManagerSatisfied === false) errors.push(`${relativePath}: package manager is not satisfied`)
  if (receipt.status !== 'PASS') errors.push(`${relativePath}: status is ${receipt.status ?? 'missing'}`)
  if (receipt.exitCode !== 0) errors.push(`${relativePath}: exit code must be 0`)
  if (typeof receipt.command !== 'string' || !receipt.command.trim()) errors.push(`${relativePath}: command is empty`)
  if (receipt.executionMode !== (checkId === 'audit' ? 'pinned-control-plane-argv' : 'verified-package-argv')) {
    errors.push(`${relativePath}: verified execution mode is missing`)
  }
  if (typeof receipt.sourceFingerprintBefore !== 'string') errors.push(`${relativePath}: sourceFingerprintBefore is missing`)
  if (
    receipt.stdoutTail !== '' ||
    receipt.stderrTail !== '' ||
    receipt.outputTailPolicy !== 'omitted-to-prevent-secret-persistence'
  ) errors.push(`${relativePath}: raw process output tails must not be persisted`)
  const completedAt = Date.parse(receipt.completedAt ?? '')
  if (!Number.isFinite(completedAt) || completedAt > Date.now() + 5 * 60 * 1000 || Date.now() - completedAt > MAX_RECEIPT_AGE_MS) {
    errors.push(`${relativePath}: receipt is missing, future-dated, or older than 24 hours`)
  }
  if (!/^[0-9a-f-]{36}$/i.test(receipt.qualityCohortId ?? '')) errors.push(`${relativePath}: quality cohort id is missing`)
  if (receipt.runMode !== 'all') errors.push(`${relativePath}: final release evidence must come from one --all run`)
  if (!/^[0-9a-f]{64}$/.test(receipt.environmentPolicy?.publicEnvironmentSha256 ?? '')) {
    errors.push(`${relativePath}: public build environment digest is missing`)
  }
  if (receipt.environmentPolicy?.isolatedHome !== true || receipt.environmentPolicy?.secretVariablesInherited !== false) {
    errors.push(`${relativePath}: isolated secret-free environment policy is missing`)
  }
  if (!['isolated-ci-declared', 'user-approved-host'].includes(receipt.environmentPolicy?.executionContext)) {
    errors.push(`${relativePath}: approved execution context is missing`)
  }

  const context = validationContext ?? createReceiptValidationContext(projectRoot)
  const {packageMetadata, dependencyBinding} = context
  if (
    !dependencyBinding.satisfied ||
    JSON.stringify(receipt.dependencyBinding) !== JSON.stringify(dependencyBinding) ||
    JSON.stringify(receipt.dependencyBindingBefore) !== JSON.stringify(dependencyBinding) ||
    JSON.stringify(receipt.dependencyBindingAfter) !== JSON.stringify(dependencyBinding) ||
    receipt.dependencyMutationDetected !== false
  ) {
    errors.push(`${relativePath}: installed dependency graph binding is missing or stale`)
  }

  const packageScriptName = receipt.packageScript?.name
  const packageScriptSource = typeof packageScriptName === 'string' ? packageMetadata?.scripts?.[packageScriptName] : null
  const packageScriptAnalysis = typeof packageScriptSource === 'string' ? analyzePackageScript(packageScriptSource) : null
  if (checkId !== 'audit') {
    if (
      !packageScriptAnalysis?.ok ||
      receipt.packageScript?.sha256 !== sha256(packageScriptSource ?? '') ||
      receipt.packageScript?.commandContractSha256 !== sha256(JSON.stringify(packageScriptAnalysis?.commands ?? []))
    ) errors.push(`${relativePath}: package script argv binding is missing or stale`)
  }
  const pnpmExecutable = join(dirname(process.execPath), process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm')
  const currentExecutionTargetBinding = readExecutionTargetBinding({
    projectRoot,
    analysis: packageScriptAnalysis,
    pnpmExecutable,
    searchPath: process.env.PATH,
  })
  if (
    !currentExecutionTargetBinding.satisfied ||
    JSON.stringify(receipt.executionTargetBindingBefore) !== JSON.stringify(currentExecutionTargetBinding) ||
    JSON.stringify(receipt.executionTargetBindingAfter) !== JSON.stringify(currentExecutionTargetBinding) ||
    receipt.executionTargetMutationDetected !== false
  ) errors.push(`${relativePath}: resolved execution target binding is missing or stale`)

  // 배포 메타(deploymentProvider·deploymentTarget·releaseTarget·selectedCapabilities)를 뺐다
  // (2026-08-26). Score·OAM은 워크로드 스펙과 배포를 분리하고 SLSA build provenance는 배포
  // 대상을 묶지 않는다 — 하네스가 들 자리가 아니다. 남은 것은 빌드 provenance뿐이며,
  // "코드가 바뀌었나"는 이미 sourceFingerprint가 (spec.json 포함해) 덮는다.
  // 환경 결속은 어댑터와 무관하다 — **항상** 검증한다. 종전에는 아래 `if (expectedProfile)`
  // 안에 있어 프로필이 없으면 통째로 미검증이었다(조건부 스킵, 2026-08-26 해소).
  // 빌드 환경·공개 환경 변수가 바뀌면 그 receipt는 다른 조건에서 나온 것이다.
  const binding = receipt.profileBinding
  const environmentPath = join(projectRoot, '_workspace/02_design/build-environment.json')
  const environmentSha256 = existsSync(environmentPath) ? sha256(readFileSync(environmentPath, 'utf8')) : null
  if (
    binding?.buildEnvironmentSha256 !== environmentSha256 ||
    binding?.publicEnvironmentSha256 !== receipt.environmentPolicy?.publicEnvironmentSha256
  ) errors.push(`${relativePath}: environment binding is missing or stale`)

  if (expectedProfile) {
    if (
      binding?.profileId !== expectedProfile.adapter.id ||
      binding?.adapterVersion !== expectedProfile.adapter.version ||
      binding?.adapterSha256 !== expectedProfile.profile.adapter.sha256 ||
      binding?.profileSha256 !== expectedProfile.executionPlan.plan.profileBinding.profileSha256 ||
      binding?.executionPlanSha256 !== expectedProfile.executionPlan.sha256
    ) errors.push(`${relativePath}: project profile binding is missing or stale`)

    if (expectedProfile.selection.selectedCapabilities.includes('scheduled-static-ingestion')) {
      try {
        const trustedPromotionActions = parseTrustedPromotionActions(process.env.WEB_HARNESS_TRUSTED_PROMOTION_ACTIONS)
        const expectedPromotionPolicySha256 = sha256(JSON.stringify(trustedPromotionActions))
        if (
          trustedPromotionActions.length === 0 ||
          receipt.environmentPolicy?.trustedPromotionActionsSha256 !== expectedPromotionPolicySha256
        ) errors.push(`${relativePath}: protected promotion action policy binding is missing or stale`)
      } catch (error) {
        errors.push(`${relativePath}: protected promotion action policy is invalid: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    if (
      checkId === 'build' &&
      expectedProfile.selection.selectedCapabilities.includes('external-ingestion') &&
      ['static-cdn', 'static-export'].includes(expectedProfile.selection.target.id)
    ) {
      try {
        const currentDeploymentValidation = validateStaticRuntimeDataDeployment({
          projectRoot,
          lockedProfile: expectedProfile,
        })
        if (
          !currentDeploymentValidation.ok ||
          JSON.stringify(receipt.runtimeDataDeploymentValidation) !== JSON.stringify(currentDeploymentValidation)
        ) {
          errors.push(`${relativePath}: static runtime data deployment digest binding is missing or stale`)
        }
      } catch (error) {
        errors.push(
          `${relativePath}: static runtime data deployment cannot be revalidated: ` +
          `${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
  }
  if (['test', 'coverage', 'browser'].includes(checkId) && (!Array.isArray(receipt.discoveredTestFiles) || receipt.discoveredTestFiles.length === 0)) {
    errors.push(`${relativePath}: no matching test files were discovered`)
  }
  if (checkId === 'browser') {
    const currentVisualEvidence = collectVisualEvidence(projectRoot, receipt.discoveredTestFiles)
    if (currentVisualEvidence.required) {
      if (currentVisualEvidence.errors.length > 0) {
        errors.push(`${relativePath}: current visual evidence is invalid: ${currentVisualEvidence.errors.join('; ')}`)
      }
      if (!visualEvidenceMatches(receipt.visualEvidence, currentVisualEvidence)) {
        errors.push(`${relativePath}: visual contract, tests, or approved baseline evidence is stale`)
      }
    } else if (receipt.visualEvidence !== undefined) {
      errors.push(`${relativePath}: unexpected visual evidence exists without a visual contract`)
    }
  }

  return {
    id: checkId,
    path: relativePath,
    sha256: sha256(source),
    status: receipt.status ?? null,
    sourceFingerprint: receipt.sourceFingerprint ?? null,
    command: receipt.command ?? '',
    exitCode: Number.isInteger(receipt.exitCode) ? receipt.exitCode : null,
    adapterCheckId: receipt.adapterCheckId ?? null,
    adapterCommandId: receipt.adapterCommandId ?? null,
    artifactInventoryAfter: Array.isArray(receipt.artifactInventoryAfter) ? receipt.artifactInventoryAfter : [],
    qualityCohortId: receipt.qualityCohortId ?? null,
    runMode: receipt.runMode ?? null,
    completedAt: receipt.completedAt ?? null,
    executionContext: receipt.environmentPolicy?.executionContext ?? null,
    executionTargetBinding: receipt.executionTargetBindingAfter ?? null,
    publicEnvironmentSha256: receipt.environmentPolicy?.publicEnvironmentSha256 ?? null,
    packageScript: receipt.packageScript ?? null,
    dependencyBinding: receipt.dependencyBinding ?? null,
    cleanBuildArtifacts: Array.isArray(receipt.cleanBuildArtifacts) ? receipt.cleanBuildArtifacts : [],
  }
}
