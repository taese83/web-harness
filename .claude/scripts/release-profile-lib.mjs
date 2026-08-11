import {existsSync, lstatSync, readFileSync, readdirSync} from 'node:fs'
import {join, relative} from 'node:path'
import {
  adapterCheckBindings,
  readLockedExecutionPlan,
  readLockedProjectProfile,
  validateLockedProfileProjectState,
} from './web-core/profile-policy-lib.mjs'
import {stableStringify} from './web-core/core-lib.mjs'
import {validateVercelProjectConfig} from './web-core/vercel-config-lib.mjs'
import {readRuntimeDataContract} from './runtime-data-contract-lib.mjs'

const dependencyNames = packageJson => new Set(
  ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
    .flatMap(key => Object.keys(packageJson[key] ?? {})),
)

const classifyWebPackage = (projectRoot, packageRoot, packageJson) => {
  const packages = dependencyNames(packageJson)
  const next = packages.has('next')
  const vite = packages.has('react') && packages.has('vite')
  if (!next && !vite) return null
  const appRoots = ['app', 'src/app'].filter(root =>
    ['js', 'jsx', 'ts', 'tsx'].some(extension => existsSync(join(packageRoot, root, `layout.${extension}`))),
  )
  const viteEntries = [
    'vite.config.js', 'vite.config.mjs', 'vite.config.ts',
    'src/main.js', 'src/main.jsx', 'src/main.ts', 'src/main.tsx',
  ].filter(path => existsSync(join(packageRoot, path)))
  const hybrid = vite && existsSync(join(packageRoot, 'api'))
  const profileIds = [
    ...(next ? ['next-app-fullstack'] : []),
    ...(vite ? [hybrid ? 'vite-serverless-hybrid' : 'react-vite-spa'] : []),
  ]
  const blockers = [
    ...(next && appRoots.length === 0 ? ['next-app-layout-missing'] : []),
    ...(next && appRoots.length > 1 ? ['next-app-roots-mixed'] : []),
    ...(vite && viteEntries.length === 0 ? ['vite-entry-missing'] : []),
    ...(profileIds.length > 1 ? ['framework-profiles-mixed'] : []),
  ]
  return {
    path: relative(projectRoot, packageRoot) || '.',
    profileIds,
    blockers,
  }
}

const WORKSPACE_IGNORED_DIRECTORIES = new Set([
  '.claude', '.git', '.next', '_workspace', 'build', 'coverage', 'dist', 'node_modules', 'out',
])
const MAX_WORKSPACE_DIRECTORIES = 5000
const MAX_WORKSPACE_DEPTH = 10

const discoverReleaseWebApps = projectRoot => {
  const errors = []
  let rootPackage
  try {
    const rootPackagePath = join(projectRoot, 'package.json')
    if (!lstatSync(rootPackagePath).isFile()) throw new Error('package.json must be a regular file, not a symlink')
    rootPackage = JSON.parse(readFileSync(rootPackagePath, 'utf8'))
  } catch (error) {
    return {apps: [], errors: [`Project package.json is unreadable: ${error instanceof Error ? error.message : String(error)}`]}
  }
  const apps = []
  const rootApp = classifyWebPackage(projectRoot, projectRoot, rootPackage)
  if (rootApp) apps.push(rootApp)
  const hasWorkspace = Array.isArray(rootPackage.workspaces) ||
    Array.isArray(rootPackage.workspaces?.packages) ||
    existsSync(join(projectRoot, 'pnpm-workspace.yaml'))
  if (!hasWorkspace) return {apps, errors}

  const pending = [{directory: projectRoot, depth: 0}]
  let inspectedDirectories = 0
  while (pending.length > 0) {
    const {directory, depth} = pending.pop()
    inspectedDirectories += 1
    if (inspectedDirectories > MAX_WORKSPACE_DIRECTORIES) {
      errors.push(`Workspace profile discovery exceeded ${MAX_WORKSPACE_DIRECTORIES} directories`)
      break
    }
    let entries
    try {
      entries = readdirSync(directory, {withFileTypes: true})
    } catch (error) {
      errors.push(`Workspace directory is unreadable: ${relative(projectRoot, directory) || '.'}`)
      continue
    }
    if (directory !== projectRoot) {
      const packagePath = join(directory, 'package.json')
      if (existsSync(packagePath)) {
        try {
          if (!lstatSync(packagePath).isFile()) throw new Error('workspace package.json must be a regular file')
          const candidate = classifyWebPackage(projectRoot, directory, JSON.parse(readFileSync(packagePath, 'utf8')))
          if (candidate) apps.push(candidate)
        } catch (error) {
          errors.push(`Workspace package.json is invalid: ${relative(projectRoot, packagePath)}`)
        }
      }
    }
    if (depth >= MAX_WORKSPACE_DEPTH) continue
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || WORKSPACE_IGNORED_DIRECTORIES.has(entry.name)) continue
      pending.push({directory: join(directory, entry.name), depth: depth + 1})
    }
  }
  return {
    apps: apps.sort((left, right) => left.path.localeCompare(right.path)),
    errors,
  }
}

export const resolveReleaseProfile = (projectRoot, errors) => {
  const profilePath = join(projectRoot, '_workspace/01_plan/project-profile.json')
  const discovery = discoverReleaseWebApps(projectRoot)
  errors.push(...discovery.errors)
  const mixedApps = discovery.apps.filter(app => app.profileIds.length !== 1 || app.blockers.length > 0)
  if (mixedApps.length > 0) {
    errors.push(`Supported web app profile is mixed or incomplete: ${mixedApps.map(app => `${app.path} (${app.blockers.join(', ')})`).join('; ')}`)
  }
  if (discovery.apps.length > 1) {
    errors.push(`Release root contains multiple supported web apps; release one app root at a time: ${discovery.apps.map(app => app.path).join(', ')}`)
  }
  const app = discovery.apps.length === 1 && mixedApps.length === 0 ? discovery.apps[0] : null
  if (app && app.path !== '.') {
    errors.push(`Workspace web app cannot use a generic root release; run release from the app root: ${app.path}`)
  }
  if (!existsSync(profilePath)) {
    if (discovery.apps.length > 0) {
      errors.push('Supported web project is missing _workspace/01_plan/project-profile.json')
    }
    return null
  }
  if (!app || app.path !== '.') {
    if (discovery.apps.length === 0) errors.push('Locked project profile exists but no supported web app matches the release root')
    return null
  }
  try {
    const lockedProfile = readLockedProjectProfile(profilePath)
    if (!app.profileIds.includes(lockedProfile.adapter.id)) {
      throw new Error(`Locked adapter ${lockedProfile.adapter.id} does not match discovered app profile ${app.profileIds.join(', ')}`)
    }
    validateLockedProfileProjectState(lockedProfile, projectRoot)
    const executionPlan = readLockedExecutionPlan(
      join(projectRoot, '_workspace/03_dev/web-execution-plan.json'),
      lockedProfile,
    )
    const resolvedProfile = {...lockedProfile, executionPlan}
    if (lockedProfile.selection.provider.id === 'vercel') {
      let runtimeDataContract = null
      if (lockedProfile.selection.selectedCapabilities.includes('external-ingestion')) {
        try {
          runtimeDataContract = readRuntimeDataContract(projectRoot)
        } catch (error) {
          errors.push(`Vercel runtime data contract is invalid: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      const vercelValidation = validateVercelProjectConfig({
        projectRoot,
        lockedProfile,
        runtimeDataContract,
      })
      errors.push(...vercelValidation.errors.map(error => `Vercel provider config is invalid: ${error}`))
    }
    return resolvedProfile
  } catch (error) {
    errors.push(`Locked project profile is invalid: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

export const profileReportRequirements = lockedProfile =>
  lockedProfile?.adapter.id === 'next-app-fullstack' ? [['next-contract', 'qa-next-contract.md']] : []

const OCI_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/
const OCI_REFERENCE_PATTERN = /^[a-z0-9][a-z0-9._:/-]*@sha256:[0-9a-f]{64}$/

const dockerImageEvidence = (receipt, errors) => {
  const images = receipt.artifactInventoryAfter.filter(artifact => artifact?.kind === 'oci-image')
  if (images.length !== 1) {
    errors.push(`${receipt.path}: Docker target receipt must bind exactly one OCI image identifier and digest`)
    return null
  }
  const [image] = images
  if (
    image.id !== 'next-docker-image' ||
    !OCI_REFERENCE_PATTERN.test(image.reference ?? '') ||
    !OCI_DIGEST_PATTERN.test(image.digest ?? '') ||
    !image.reference.endsWith(`@${image.digest}`)
  ) {
    errors.push(`${receipt.path}: OCI image evidence must use immutable reference@sha256 digest binding`)
    return null
  }
  return {id: image.id, kind: image.kind, reference: image.reference, digest: image.digest}
}

export const collectAdapterReleaseEvidence = ({
  lockedProfile,
  receipts,
  sourceFingerprint,
  errors,
  deploymentArtifacts,
  readReceipt,
}) => {
  if (!lockedProfile) return []
  const adapterChecks = []
  const receiptById = new Map(receipts.map(receipt => [receipt.id, receipt]))
  const bindings = adapterCheckBindings({
    adapter: lockedProfile.adapter,
    deploymentProvider: lockedProfile.selection.provider.id,
    deploymentTarget: lockedProfile.selection.target.id,
    capabilities: lockedProfile.selection.selectedCapabilities,
  })
  const dockerTarget = lockedProfile.selection.target.id === 'docker-standalone'
  const dockerEvidence = []
  if (dockerTarget) {
    const requiredDockerChecks = [
      'next.docker-browser', 'next.docker-build', 'next.docker-hydration', 'next.docker-shutdown', 'next.docker-smoke',
    ]
    const activeCheckIds = new Set(bindings.map(binding => binding.id))
    const missingChecks = requiredDockerChecks.filter(id => !activeCheckIds.has(id))
    if (missingChecks.length > 0) errors.push(`Docker standalone profile is missing target-specific checks: ${missingChecks.join(', ')}`)
  }
  for (const binding of bindings) {
    let receipt = receiptById.get(binding.receiptId)
    if (!receipt) {
      receipt = readReceipt(binding.receiptId, sourceFingerprint, errors, lockedProfile)
      if (receipt) {
        receipts.push(receipt)
        receiptById.set(receipt.id, receipt)
      }
    }
    if (receipt && (
      receipt.adapterCheckId !== binding.id ||
      receipt.adapterCommandId !== binding.commandId
    )) errors.push(`${receipt.path}: adapter target command binding is missing or stale`)
    let boundOciImage = null
    const dockerSpecific = dockerTarget && binding.id.startsWith('next.docker-')
    if (receipt && dockerSpecific) {
      boundOciImage = dockerImageEvidence(receipt, errors)
      if (boundOciImage) dockerEvidence.push({receipt: receipt.path, image: boundOciImage})
    }
    if (receipt && ['artifact', 'browser', 'build', 'runtime'].includes(binding.kind)) {
      const localInventory = dockerSpecific
        ? receipt.artifactInventoryAfter.filter(artifact => artifact?.kind !== 'oci-image')
        : receipt.artifactInventoryAfter
      if (JSON.stringify(localInventory) !== JSON.stringify(deploymentArtifacts)) {
        errors.push(`${receipt.path}: selected deployment artifact digest is missing or stale`)
      }
    }
    if (receipt && binding.kind === 'build' && receipt.cleanBuildArtifacts.length === 0) {
      errors.push(`${receipt.path}: profile build receipt is not from a clean artifact build`)
    }
    adapterChecks.push({
      id: binding.id,
      receiptId: binding.receiptId,
      commandId: binding.commandId,
      kind: binding.kind,
      status: receipt?.status ?? 'MISSING',
      ...(boundOciImage ? {ociImage: boundOciImage} : {}),
    })
  }
  if (dockerTarget && dockerEvidence.length > 0) {
    const images = new Set(dockerEvidence.map(evidence => stableStringify(evidence.image)))
    if (images.size !== 1 || dockerEvidence.length !== bindings.filter(binding => binding.id.startsWith('next.docker-')).length) {
      errors.push('Docker target-specific receipts do not bind the same immutable OCI image')
    }
  }
  return adapterChecks
}

export const releaseProfileSummary = lockedProfile => lockedProfile ? {
  id: lockedProfile.adapter.id,
  version: lockedProfile.adapter.version,
  supportLevel: lockedProfile.adapter.supportLevel,
  sha256: lockedProfile.profile.adapter.sha256,
  deploymentProvider: lockedProfile.selection.provider.id,
  deploymentTarget: lockedProfile.selection.target.id,
  releaseTarget: lockedProfile.selection.releaseTarget,
  capabilities: lockedProfile.selection.selectedCapabilities,
  executionPlanSha256: lockedProfile.executionPlan.sha256,
} : null
