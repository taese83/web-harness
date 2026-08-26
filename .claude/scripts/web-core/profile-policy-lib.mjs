import {createHash} from 'node:crypto'
import {existsSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {loadBuiltinAdapter} from './adapter-lib.mjs'
import {compileCapabilityDag} from './dag-lib.mjs'
import {readJson, sortedUnique, stableStringify, WebCoreError} from './core-lib.mjs'
import {
  EXTERNAL_INGESTION_CAPABILITY,
  inspectExternalIngestion,
  SCHEDULED_STATIC_INGESTION_CAPABILITY,
} from './ingestion-detection-lib.mjs'

export const COMMON_RECEIPT_ALIASES = Object.freeze({
  'ingestion.validate': 'ingestion',
  'quality.lint': 'lint',
  'quality.typecheck': 'typecheck',
  'quality.unit': 'test',
  'next.build': 'build',
  'next.node-browser': 'browser',
  'next.docker-browser': 'browser',
  'next.static-browser': 'browser',
  'vite.build': 'build',
  'vite.browser': 'browser',
})

export const adapterSha256 = adapter =>
  createHash('sha256').update(stableStringify(adapter)).digest('hex')

export const projectProfileSha256 = profile =>
  createHash('sha256').update(stableStringify(profile)).digest('hex')

export const executionPlanSha256 = plan =>
  createHash('sha256').update(stableStringify(plan)).digest('hex')

export const resolveAdapterSelection = ({adapter, deploymentProvider, deploymentTarget, capabilities}) => {
  const targetId = deploymentTarget ?? adapter.profileDefaults.deploymentTarget
  if (adapter.id === 'next-app-fullstack' && targetId === 'docker-standalone') {
    throw new WebCoreError(
      'NEXT_DOCKER_OCI_EVIDENCE_BROKER_REQUIRED',
      'Docker standalone release is blocked until a typed broker binds the built image to an immutable registry OCI digest',
    )
  }
  const target = adapter.deploymentTargets.find(candidate => candidate.id === targetId)
  if (!target) {
    throw new WebCoreError('DEPLOYMENT_TARGET_UNKNOWN', `Unknown deployment target for ${adapter.id}: ${targetId}`, {
      available: adapter.deploymentTargets.map(candidate => candidate.id).sort(),
    })
  }
  const providerId = deploymentProvider ?? adapter.profileDefaults.deploymentProvider
  const provider = adapter.deploymentProviders.find(candidate => candidate.id === providerId)
  if (!provider) {
    throw new WebCoreError('DEPLOYMENT_PROVIDER_UNKNOWN', `Unknown deployment provider for ${adapter.id}: ${providerId}`, {
      available: adapter.deploymentProviders.map(candidate => candidate.id).sort(),
    })
  }
  if (!provider.deploymentTargets.includes(targetId)) {
    throw new WebCoreError(
      'DEPLOYMENT_PROVIDER_TARGET_CONFLICT',
      `Deployment provider ${providerId} does not support target ${targetId}`,
      {provider: providerId, target: targetId, availableTargets: [...provider.deploymentTargets].sort()},
    )
  }
  const selectedCapabilities = sortedUnique(capabilities?.length ? capabilities : adapter.profileDefaults.capabilities)
  const available = new Set(adapter.provides)
  const unknown = selectedCapabilities.filter(capability => !available.has(capability))
  if (unknown.length) {
    throw new WebCoreError('CAPABILITY_UNKNOWN', 'Selected capabilities are not provided by the adapter', {unknown})
  }
  const selected = new Set(selectedCapabilities)
  if (selected.has('scheduled-static-ingestion') && !selected.has('external-ingestion')) {
    throw new WebCoreError(
      'INGESTION_CAPABILITY_CONFLICT',
      'scheduled-static-ingestion requires external-ingestion',
    )
  }
  const missing = target.requires.filter(capability => !selected.has(capability)).sort()
  const conflicts = target.conflicts.filter(capability => selected.has(capability)).sort()
  if (missing.length || conflicts.length) {
    throw new WebCoreError('DEPLOYMENT_CAPABILITY_CONFLICT', `Capabilities are incompatible with deployment target ${targetId}`, {
      target: targetId,
      missing,
      conflicts,
    })
  }
  const artifacts = adapter.artifacts
    .filter(artifact => artifact.deploymentTargets.includes(targetId))
    .map(artifact => ({id: artifact.id, path: artifact.path, kind: artifact.kind}))
    .sort((left, right) => left.path.localeCompare(right.path))
  if (artifacts.length === 0) throw new WebCoreError('DEPLOYMENT_ARTIFACT_MISSING', `No artifact is declared for target ${targetId}`)
  const releaseTarget = `release.${targetId}`
  if (!adapter.tasks.some(task => task.provides.includes(releaseTarget))) {
    throw new WebCoreError('DEPLOYMENT_RELEASE_TARGET_MISSING', `No DAG task provides ${releaseTarget}`)
  }
  return {provider, target, selectedCapabilities, artifacts, releaseTarget}
}

export const adapterCheckBindings = ({adapter, deploymentProvider, deploymentTarget, capabilities}) => {
  const selection = resolveAdapterSelection({adapter, deploymentProvider, deploymentTarget, capabilities})
  const active = new Set([...selection.selectedCapabilities, selection.target.id])
  return adapter.checks
    .filter(check => check.requires.every(requirement => active.has(requirement)))
    .map(check => ({
      id: check.id,
      commandId: check.commandId,
      kind: check.kind,
      evidenceCapability: check.evidenceCapability,
      receiptId: COMMON_RECEIPT_ALIASES[check.id] ?? check.id,
    }))
    .sort((left, right) => left.id.localeCompare(right.id))
}

export const validateLockedProjectProfile = profile => {
  if (!profile || profile.schemaVersion !== 1 || typeof profile.profileId !== 'string') {
    throw new WebCoreError('PROJECT_PROFILE_INVALID', 'Locked project profile must use schemaVersion 1 and include profileId')
  }
  const adapter = loadBuiltinAdapter(profile.profileId)
  if (
    profile.adapter?.id !== adapter.id ||
    profile.adapter?.version !== adapter.version ||
    profile.adapter?.sha256 !== adapterSha256(adapter) ||
    profile.adapter?.supportLevel !== adapter.supportLevel ||
    profile.adapter?.trustTier !== 'builtin'
  ) {
    throw new WebCoreError('PROJECT_PROFILE_ADAPTER_STALE', 'Locked project profile does not match the current built-in adapter')
  }
  const selection = resolveAdapterSelection({
    adapter,
    deploymentProvider: profile.deployment?.provider,
    deploymentTarget: profile.deployment?.target,
    capabilities: profile.capabilities,
  })
  if (profile.deployment?.releaseTarget !== selection.releaseTarget) {
    throw new WebCoreError('PROJECT_PROFILE_RELEASE_TARGET_STALE', 'Locked project profile release target is stale')
  }
  if (profile.deployment?.provider !== selection.provider.id) {
    throw new WebCoreError('PROJECT_PROFILE_PROVIDER_STALE', 'Locked deployment provider is stale')
  }
  return {profile, adapter, selection}
}

export const readLockedProjectProfile = path => validateLockedProjectProfile(readJson(path))

export const validateLockedProfileProjectState = (lockedProfile, projectRoot) => {
  let packageJson
  try {
    packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'))
  } catch {
    throw new WebCoreError('PROJECT_PROFILE_PACKAGE_MISSING', 'Locked profile requires a readable project package.json')
  }
  const declaredVersion = name =>
    packageJson.dependencies?.[name] ??
    packageJson.devDependencies?.[name] ??
    packageJson.peerDependencies?.[name] ??
    packageJson.optionalDependencies?.[name]
  const declarations = Object.fromEntries(
    sortedUnique([...lockedProfile.adapter.detection.allPackages, ...lockedProfile.adapter.detection.anyPackages])
      .filter(name => declaredVersion(name) !== undefined)
      .map(name => [name, declaredVersion(name)]),
  )
  const missingPackages = lockedProfile.adapter.detection.allPackages.filter(name => !declarations[name])
  if (missingPackages.length) {
    throw new WebCoreError('PROJECT_PROFILE_PACKAGE_MISSING', 'Project no longer satisfies the locked adapter package contract', {missingPackages})
  }
  const current = {
    nodeEngine: packageJson.engines?.node ?? null,
    packageManager: packageJson.packageManager ?? null,
    packageDeclarations: declarations,
  }
  const expected = {
    nodeEngine: lockedProfile.profile.toolchain?.nodeEngine ?? null,
    packageManager: lockedProfile.profile.toolchain?.packageManager ?? null,
    packageDeclarations: lockedProfile.profile.toolchain?.packageDeclarations ?? {},
  }
  if (stableStringify(current) !== stableStringify(expected)) {
    throw new WebCoreError('PROJECT_PROFILE_TOOLCHAIN_STALE', 'Package or toolchain declarations changed after profile resolution', {current, expected})
  }
  if (lockedProfile.profile.toolchain?.exactFrameworkVersions !== true) {
    throw new WebCoreError('PROJECT_PROFILE_VERSION_UNPINNED', 'Built-in framework package versions must be exact before quality or release execution')
  }
  if (!/^pnpm@\d+\.\d+\.\d+$/.test(current.packageManager ?? '')) {
    throw new WebCoreError('PROJECT_PROFILE_PACKAGE_MANAGER_UNPINNED', 'packageManager must pin an exact pnpm version')
  }
  const ingestion = inspectExternalIngestion(projectRoot)
  if (ingestion.errors.length > 0) {
    throw new WebCoreError(
      'PROJECT_PROFILE_INGESTION_STATE_INVALID',
      'Current external ingestion state cannot be inspected safely',
      {errors: ingestion.errors},
    )
  }
  if (ingestion.detected && !ingestion.contractsComplete) {
    throw new WebCoreError(
      'PROJECT_PROFILE_INGESTION_CONTRACT_STALE',
      'Current external ingestion markers are not covered by both locked ingestion contracts',
      {evidence: ingestion.evidence},
    )
  }
  const selectedCapabilities = new Set(lockedProfile.selection.selectedCapabilities)
  const requiredCapabilities = ingestion.detected
    ? [
        EXTERNAL_INGESTION_CAPABILITY,
        ...(ingestion.scheduledStatic ? [SCHEDULED_STATIC_INGESTION_CAPABILITY] : []),
      ]
    : []
  const missingCapabilities = requiredCapabilities.filter(capability => !selectedCapabilities.has(capability))
  const staleScheduledCapability =
    selectedCapabilities.has(SCHEDULED_STATIC_INGESTION_CAPABILITY) !== ingestion.scheduledStatic
  const staleExternalCapability = selectedCapabilities.has(EXTERNAL_INGESTION_CAPABILITY) !== ingestion.detected
  if (missingCapabilities.length > 0 || staleScheduledCapability || staleExternalCapability) {
    throw new WebCoreError(
      'PROJECT_PROFILE_INGESTION_CAPABILITY_STALE',
      'Locked ingestion capabilities do not match the current project and runtime-data contract',
      {
        detected: ingestion.detected,
        scheduledStatic: ingestion.scheduledStatic,
        missingCapabilities,
      },
    )
  }
  return lockedProfile
}

export const validateLockedExecutionPlan = (plan, lockedProfile) => {
  if (!plan || plan.schemaVersion !== 1 || plan.profileId !== lockedProfile.adapter.id) {
    throw new WebCoreError('EXECUTION_PLAN_INVALID', 'Execution plan does not match the locked profile')
  }
  const binding = plan.profileBinding
  if (
    plan.adapter?.id !== lockedProfile.adapter.id ||
    plan.adapter?.version !== lockedProfile.adapter.version ||
    binding?.adapterSha256 !== lockedProfile.profile.adapter.sha256 ||
    binding?.profileSha256 !== projectProfileSha256(lockedProfile.profile) ||
    binding?.deploymentProvider !== lockedProfile.selection.provider.id ||
    binding?.deploymentTarget !== lockedProfile.selection.target.id ||
    stableStringify(binding?.selectedCapabilities ?? []) !== stableStringify(lockedProfile.selection.selectedCapabilities)
  ) throw new WebCoreError('EXECUTION_PLAN_PROFILE_STALE', 'Execution plan profile binding is missing or stale')

  const requiredTargets = [
    lockedProfile.selection.releaseTarget,
    ...adapterCheckBindings({
      adapter: lockedProfile.adapter,
      deploymentProvider: lockedProfile.selection.provider.id,
      deploymentTarget: lockedProfile.selection.target.id,
      capabilities: lockedProfile.selection.selectedCapabilities,
    }).map(check => check.evidenceCapability),
  ]
  const targets = new Set(plan.targetCapabilities ?? [])
  const missingTargets = sortedUnique(requiredTargets.filter(target => !targets.has(target)))
  if (missingTargets.length) {
    throw new WebCoreError('EXECUTION_PLAN_EVIDENCE_MISSING', 'Execution plan omits active release evidence', {missingTargets})
  }
  const expected = compileCapabilityDag(lockedProfile.adapter, plan.targetCapabilities)
  for (const key of ['initialCapabilities', 'targetCapabilities', 'nodes', 'edges', 'executionOrder']) {
    if (stableStringify(plan[key]) !== stableStringify(expected[key])) {
      throw new WebCoreError('EXECUTION_PLAN_GRAPH_STALE', `Execution plan ${key} does not match the adapter DAG`)
    }
  }
  return {plan, sha256: executionPlanSha256(plan)}
}

export const readLockedExecutionPlan = (path, lockedProfile) => {
  if (!existsSync(path)) throw new WebCoreError('EXECUTION_PLAN_MISSING', 'Canonical _workspace/03_dev/web-execution-plan.json is required')
  return validateLockedExecutionPlan(readJson(path), lockedProfile)
}
