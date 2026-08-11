import {existsSync, lstatSync, readFileSync, readdirSync} from 'node:fs'
import {isAbsolute, join, relative, resolve, sep} from 'node:path'
import {loadBuiltinAdapters} from './adapter-lib.mjs'
import {readJson, sortedUnique, WebCoreError} from './core-lib.mjs'
import {
  EXTERNAL_INGESTION_CAPABILITY,
  inspectExternalIngestion,
  SCHEDULED_STATIC_INGESTION_CAPABILITY,
} from './ingestion-detection-lib.mjs'
import {adapterSha256, resolveAdapterSelection} from './profile-policy-lib.mjs'

const packageNames = packageJson => sortedUnique(
  ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']
    .flatMap(key => Object.keys(packageJson[key] ?? {})),
)

const inspectProject = projectRoot => {
  const root = resolve(projectRoot)
  if (!existsSync(root) || !lstatSync(root).isDirectory()) {
    throw new WebCoreError('PROJECT_ROOT_INVALID', `Project root must be an existing directory: ${root}`)
  }
  const packagePath = join(root, 'package.json')
  const packageJson = existsSync(packagePath) ? readJson(packagePath) : {}
  return {root, packageJson, packages: packageNames(packageJson)}
}

const markerExists = (root, marker) => {
  const candidate = resolve(root, marker)
  const offset = relative(root, candidate)
  if (offset === '..' || offset.startsWith(`..${sep}`) || isAbsolute(offset)) return false
  return existsSync(candidate)
}

const nextAppRoots = root => ['app', 'src/app'].filter(appRoot =>
  ['js', 'jsx', 'ts', 'tsx'].some(extension => markerExists(root, `${appRoot}/layout.${extension}`)),
)

const containsEdgeRuntime = (root, appRoots) => {
  const pending = appRoots.map(appRoot => join(root, appRoot))
  let inspected = 0
  while (pending.length > 0 && inspected < 1000) {
    const directory = pending.pop()
    for (const entry of readdirSync(directory, {withFileTypes: true})) {
      const path = join(directory, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) pending.push(path)
      else if (entry.isFile() && /\.[cm]?[jt]sx?$/.test(entry.name)) {
        inspected += 1
        if (/\bexport\s+const\s+runtime\s*=\s*['"]edge['"]/.test(readFileSync(path, 'utf8'))) return true
      }
    }
  }
  return false
}

export const detectAdapter = (adapter, project) => {
  const packages = new Set(project.packages)
  const detection = adapter.detection
  const allPackages = detection.allPackages.every(name => packages.has(name))
  const anyPackages = detection.anyPackages.length === 0 || detection.anyPackages.some(name => packages.has(name))
  const allPaths = detection.allPaths.every(path => markerExists(project.root, path))
  const detectedNextRoots = adapter.id === 'next-app-fullstack' ? nextAppRoots(project.root) : []
  const edgeRuntime = adapter.id === 'next-app-fullstack' && containsEdgeRuntime(project.root, detectedNextRoots)
  const anyPaths = adapter.id === 'next-app-fullstack'
    ? detectedNextRoots.length > 0
    : detection.anyPaths.length === 0 || detection.anyPaths.some(path => markerExists(project.root, path))
  const forbiddenPackages = detection.forbiddenPackages.filter(name => packages.has(name))
  const forbiddenPaths = detection.forbiddenPaths.filter(path => markerExists(project.root, path))
  const candidate = allPackages && anyPackages && allPaths && anyPaths
  const blockers = sortedUnique([
    ...forbiddenPackages.map(name => `package:${name}`),
    ...forbiddenPaths.map(path => `path:${path}`),
    ...(detectedNextRoots.length > 1 ? ['path:app+src/app'] : []),
    ...(edgeRuntime ? ['source:edge-runtime'] : []),
  ])
  const matched = candidate && blockers.length === 0
  const evidence = matched
    ? sortedUnique([
        ...detection.allPackages.map(name => `package:${name}`),
        ...detection.anyPackages.filter(name => packages.has(name)).map(name => `package:${name}`),
        ...detection.allPaths.map(path => `path:${path}`),
        ...(adapter.id === 'next-app-fullstack'
          ? detectedNextRoots.map(path => `path:${path}/layout`)
          : detection.anyPaths.filter(path => markerExists(project.root, path)).map(path => `path:${path}`)),
      ])
    : []
  return {id: adapter.id, matched, candidate, incompatibleCandidate: allPackages && anyPackages && blockers.length > 0, evidence, blockers}
}

export const resolveProjectProfile = ({
  projectRoot,
  requested = 'auto',
  deploymentProvider,
  deploymentTarget,
  capabilities,
  adapters = loadBuiltinAdapters(),
  includeAncestorIngestion = true,
}) => {
  if (!projectRoot) throw new WebCoreError('PROJECT_ROOT_REQUIRED', '--project-root is required')
  const project = inspectProject(projectRoot)
  const adapterById = new Map(adapters.map(adapter => [adapter.id, adapter]))
  if (adapterById.size !== adapters.length) throw new WebCoreError('DUPLICATE_PROFILE', 'Adapter profile ids must be unique')
  if (requested !== 'auto' && !adapterById.has(requested)) {
    throw new WebCoreError('UNKNOWN_PROFILE', `Unknown requested profile: ${requested}`, {available: [...adapterById.keys()].sort()})
  }

  const inspection = adapters.map(adapter => detectAdapter(adapter, project))
  const detections = inspection.filter(result => result.matched)
  if (detections.length > 1) {
    throw new WebCoreError('AMBIGUOUS_PROFILE', 'Project matches more than one built-in profile', {matches: detections.map(item => item.id).sort()})
  }
  const detected = detections[0] ?? null
  if (requested === 'auto' && !detected) {
    const incompatible = inspection.filter(result => result.incompatibleCandidate)
    if (incompatible.length > 0) {
      throw new WebCoreError('PROFILE_INCOMPATIBLE', 'Project contains markers outside the supported profile boundary', {
        candidates: incompatible.map(result => ({id: result.id, blockers: result.blockers})),
      })
    }
    throw new WebCoreError('PROFILE_NOT_DETECTED', 'No built-in profile matched the project', {available: [...adapterById.keys()].sort()})
  }
  if (requested !== 'auto' && detected && detected.id !== requested) {
    throw new WebCoreError('PROFILE_CONFLICT', `Requested profile ${requested} conflicts with detected profile ${detected.id}`, {requested, detected: detected.id})
  }

  if (requested !== 'auto') {
    const requestedInspection = inspection.find(result => result.id === requested)
    if (requestedInspection?.blockers.length > 0) {
      throw new WebCoreError('PROFILE_INCOMPATIBLE', `Requested profile ${requested} contains forbidden project markers`, {
        requested,
        blockers: requestedInspection.blockers,
      })
    }
  }

  const selectedId = requested === 'auto' ? detected.id : requested
  const adapter = adapterById.get(selectedId)
  const ingestion = inspectExternalIngestion(project.root, {
    includeAncestorRepositories: includeAncestorIngestion,
  })
  if (ingestion.errors.length > 0) {
    throw new WebCoreError('INGESTION_CONTRACT_INVALID', 'External ingestion contract cannot be inspected safely', {
      errors: ingestion.errors,
    })
  }
  const requestedIngestion = capabilities?.some(capability =>
    [EXTERNAL_INGESTION_CAPABILITY, SCHEDULED_STATIC_INGESTION_CAPABILITY].includes(capability),
  ) === true
  if ((ingestion.detected || requestedIngestion) && !ingestion.contractsComplete) {
    throw new WebCoreError(
      'INGESTION_CONTRACT_MISSING',
      'External ingestion markers require both ingestion-contract.md and runtime-data-contract.json',
      {evidence: ingestion.evidence},
    )
  }
  const requiredIngestionCapabilities = ingestion.detected
    ? [
        EXTERNAL_INGESTION_CAPABILITY,
        ...(ingestion.scheduledStatic ? [SCHEDULED_STATIC_INGESTION_CAPABILITY] : []),
      ]
    : []
  let selectedCapabilities = capabilities
  if (ingestion.detected && capabilities === undefined) {
    selectedCapabilities = sortedUnique([...adapter.profileDefaults.capabilities, ...requiredIngestionCapabilities])
  } else if (ingestion.detected) {
    const missing = requiredIngestionCapabilities.filter(capability => !capabilities.includes(capability))
    if (missing.length > 0) {
      throw new WebCoreError(
        'INGESTION_CAPABILITY_REQUIRED',
        'Locked capabilities omit detected external ingestion requirements',
        {missing, evidence: ingestion.evidence},
      )
    }
  }
  const selection = resolveAdapterSelection({
    adapter,
    deploymentProvider,
    deploymentTarget,
    capabilities: selectedCapabilities,
  })
  const source = detected && requested !== 'auto' ? 'requested-and-detected' : requested === 'auto' ? 'detected' : 'requested'
  const packageDeclarations = Object.fromEntries(
    sortedUnique([...adapter.detection.allPackages, ...adapter.detection.anyPackages])
      .filter(name => project.packageJson.dependencies?.[name] || project.packageJson.devDependencies?.[name])
      .map(name => [name, project.packageJson.dependencies?.[name] ?? project.packageJson.devDependencies?.[name]]),
  )
  return {
    $schema: 'https://web-harness.local/schemas/web-core/project-profile.schema.json',
    schemaVersion: 1,
    profileId: adapter.id,
    resolution: {
      source,
      requested: requested === 'auto' ? null : requested,
      detected: detected?.id ?? null,
      evidence: sortedUnique([...(detected?.evidence ?? []), ...ingestion.evidence]),
    },
    adapter: {
      id: adapter.id,
      version: adapter.version,
      sha256: adapterSha256(adapter),
      supportLevel: adapter.supportLevel,
      trustTier: adapter.trust.tier,
    },
    product: {kind: adapter.profileDefaults.productKind},
    frontend: {
      framework: adapter.project.framework,
      variant: adapter.project.variant,
      router: adapter.project.router,
      rendering: [...adapter.project.rendering].sort(),
      packageManager: adapter.project.packageManager,
    },
    backend: {shape: adapter.profileDefaults.backendShape},
    runtime: {primary: adapter.runtime.primary, supported: [...adapter.runtime.supported].sort()},
    capabilities: selection.selectedCapabilities,
    deployment: {
      provider: selection.provider.id,
      availableProviders: adapter.deploymentProviders
        .filter(provider => provider.deploymentTargets.includes(selection.target.id))
        .map(provider => provider.id)
        .sort(),
      target: selection.target.id,
      availableTargets: adapter.deploymentTargets
        .map(target => target.id)
        .filter(targetId => !(adapter.id === 'next-app-fullstack' && targetId === 'docker-standalone'))
        .sort(),
      releaseTarget: selection.releaseTarget,
      artifacts: selection.artifacts,
    },
    risk: {
      level: selection.target.id === 'static-export' ||
        !selection.selectedCapabilities.some(capability => ['auth', 'cookie-auth', 'route-handler-mutation', 'server-actions'].includes(capability))
        ? 'public'
        : adapter.profileDefaults.riskLevel,
    },
    toolchain: {
      nodeEngine: project.packageJson.engines?.node ?? null,
      packageManager: project.packageJson.packageManager ?? null,
      packageDeclarations,
      exactFrameworkVersions: Object.values(packageDeclarations).length > 0 &&
        Object.values(packageDeclarations).every(value => /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value)),
    },
  }
}
