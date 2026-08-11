#!/usr/bin/env node

import {spawnSync} from 'node:child_process'
import {join, resolve} from 'node:path'
import {collectDeploymentArtifacts} from './artifact-inventory-lib.mjs'
import {computeSourceFingerprint} from './evidence-lib.mjs'
import {
  ingestionReceiptEvidence,
  validateRuntimeDataArtifacts,
} from './runtime-data-contract-lib.mjs'
import {validateStaticRuntimeDataDeployment} from './runtime-data-deployment-lib.mjs'
import {readProjectRegularFile} from './safe-project-file-lib.mjs'
import {
  analyzePackageScript,
  cleanProfileBuildArtifacts,
  resolvePackageExecutionTarget,
} from './quality-policy-lib.mjs'
import {
  readLockedProjectProfile,
  validateLockedProfileProjectState,
} from './web-core/profile-policy-lib.mjs'

const projectRoot = resolve(process.cwd())
const BUILD_TIMEOUT_MS = 15 * 60 * 1000
const BUILD_QUIESCENCE_MS = 1000

const fail = message => {
  process.stderr.write(`Vercel static ingestion build failed: ${message}\n`)
  process.exit(1)
}

try {
  const lockedProfile = readLockedProjectProfile(join(projectRoot, '_workspace/01_plan/project-profile.json'))
  validateLockedProfileProjectState(lockedProfile, projectRoot)
  if (
    lockedProfile.selection.provider.id !== 'vercel' ||
    !lockedProfile.selection.selectedCapabilities.includes('external-ingestion') ||
    !['static-cdn', 'static-export'].includes(lockedProfile.selection.target.id)
  ) fail('the locked profile must select Vercel external-ingestion on a static target')

  const mutableArtifactRoots = lockedProfile.selection.artifacts.map(artifact => artifact.path)
  const runtimeDataBefore = validateRuntimeDataArtifacts(projectRoot, {mutableArtifactRoots})
  if (!runtimeDataBefore.ok) fail(`pre-build runtime data is invalid: ${runtimeDataBefore.errors.join('; ')}`)
  const sourceFingerprintBefore = computeSourceFingerprint(projectRoot, {excludePaths: mutableArtifactRoots})

  const packageSource = readProjectRegularFile(projectRoot, 'package.json', {maxBytes: 2 * 1024 * 1024})
  const packageJson = JSON.parse(packageSource.toString('utf8'))
  const buildScript = packageJson.scripts?.build
  if (typeof buildScript !== 'string') fail('package.json scripts.build is required')
  const analysis = analyzePackageScript(buildScript)
  if (!analysis.ok || analysis.executionCommands.length === 0) {
    fail(`scripts.build violates the reviewed argv contract: ${analysis.error ?? 'empty build command'}`)
  }

  cleanProfileBuildArtifacts(projectRoot, lockedProfile.selection.artifacts)
  const started = Date.now()
  for (const command of analysis.executionCommands) {
    if (command.executable === 'docker') fail('Docker commands are not supported in a Vercel static build')
    const executable = process.execPath
    const args = command.executable === 'node'
      ? command.args
      : [resolvePackageExecutionTarget(projectRoot, command.executable), ...command.args]
    const remaining = Math.max(1, BUILD_TIMEOUT_MS - (Date.now() - started))
    const result = spawnSync(executable, args, {
      cwd: projectRoot,
      env: {
        ...process.env,
        ...Object.fromEntries(command.assignments.map(assignment => [assignment.name, assignment.value])),
      },
      stdio: 'inherit',
      timeout: remaining,
    })
    if (result.status !== 0) {
      fail(`framework build command failed with ${result.signal ?? result.status ?? result.error?.message ?? 'unknown status'}`)
    }
  }

  const sourceFingerprintAfter = computeSourceFingerprint(projectRoot, {excludePaths: mutableArtifactRoots})
  if (sourceFingerprintAfter !== sourceFingerprintBefore) fail('framework build mutated protected source or promoted runtime data')

  const runtimeDataAfter = validateRuntimeDataArtifacts(projectRoot, {mutableArtifactRoots})
  if (!runtimeDataAfter.ok) fail(`post-build runtime data is invalid: ${runtimeDataAfter.errors.join('; ')}`)
  if (JSON.stringify(ingestionReceiptEvidence(runtimeDataAfter)) !== JSON.stringify(ingestionReceiptEvidence(runtimeDataBefore))) {
    fail('framework build changed the promoted runtime data evidence')
  }
  const deploymentValidation = validateStaticRuntimeDataDeployment({
    projectRoot,
    lockedProfile,
  })
  if (!deploymentValidation.ok || !deploymentValidation.applicable) {
    fail(deploymentValidation.errors.join('; ') || 'deployment copy validation is not applicable')
  }
  const artifactInventory = collectDeploymentArtifacts(
    projectRoot,
    lockedProfile.selection.artifacts,
    {requireAll: true},
  )
  if (artifactInventory.errors.length > 0) fail(artifactInventory.errors.join('; '))

  // Catch ordinary background writers before returning control to the provider.
  // This is a quiescence check, not an OS isolation boundary; certified deploys
  // still transfer the resulting digest through a protected prebuilt broker.
  await new Promise(resolveWait => setTimeout(resolveWait, BUILD_QUIESCENCE_MS))
  const settledSourceFingerprint = computeSourceFingerprint(projectRoot, {excludePaths: mutableArtifactRoots})
  if (settledSourceFingerprint !== sourceFingerprintAfter) fail('source changed during the post-build quiescence window')
  const runtimeDataSettled = validateRuntimeDataArtifacts(projectRoot, {mutableArtifactRoots})
  if (!runtimeDataSettled.ok) fail(`settled runtime data is invalid: ${runtimeDataSettled.errors.join('; ')}`)
  if (JSON.stringify(ingestionReceiptEvidence(runtimeDataSettled)) !== JSON.stringify(ingestionReceiptEvidence(runtimeDataAfter))) {
    fail('runtime data evidence changed during the post-build quiescence window')
  }
  const settledDeploymentValidation = validateStaticRuntimeDataDeployment({projectRoot, lockedProfile})
  if (
    !settledDeploymentValidation.ok ||
    JSON.stringify(settledDeploymentValidation) !== JSON.stringify(deploymentValidation)
  ) fail(settledDeploymentValidation.errors.join('; ') || 'deployment data changed during the post-build quiescence window')
  const settledArtifactInventory = collectDeploymentArtifacts(
    projectRoot,
    lockedProfile.selection.artifacts,
    {requireAll: true},
  )
  if (
    settledArtifactInventory.errors.length > 0 ||
    JSON.stringify(settledArtifactInventory.artifacts) !== JSON.stringify(artifactInventory.artifacts)
  ) fail(settledArtifactInventory.errors.join('; ') || 'deployment artifact changed during the post-build quiescence window')

  process.stdout.write(`${JSON.stringify({
    ok: true,
    sourceFingerprint: settledSourceFingerprint,
    ingestionEvidence: ingestionReceiptEvidence(runtimeDataSettled),
    deploymentValidation: settledDeploymentValidation,
    artifactInventory: settledArtifactInventory.artifacts,
  })}\n`)
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}
