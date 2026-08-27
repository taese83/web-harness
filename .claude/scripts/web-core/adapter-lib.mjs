import {existsSync, realpathSync} from 'node:fs'
import {dirname, isAbsolute, join, relative, resolve, sep} from 'node:path'
import {fileURLToPath} from 'node:url'
import {artifactOf, deriveGraph, evidenceNameOf, readShapeChecks} from '../derive-execution-graph.mjs'
import {assertKnownKeys, isPlainObject, readJson, sortedUnique, WebCoreError} from './core-lib.mjs'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
export const claudeDirectory = resolve(scriptDirectory, '../..')
export const adapterDirectory = join(claudeDirectory, 'adapters')
export const BUILTIN_ADAPTER_IDS = Object.freeze(['next-app-fullstack', 'react-vite-spa', 'vite-serverless-hybrid'])

const identifierPattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/
const profileIdPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const capabilityPattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/
const trustedEnvironmentKeys = new Set(['CI', 'NODE_ENV', 'NEXT_TELEMETRY_DISABLED'])

const safePnpmArgs = args => {
  if (!Array.isArray(args)) return false
  if (args.length === 3 && args[0] === 'install') {
    return args[1] === '--frozen-lockfile' && args[2] === '--ignore-scripts'
  }
  return args.length === 2 && args[0] === 'run' && /^[a-z0-9][a-z0-9:._-]*$/.test(args[1] ?? '')
}

const arrayOfStrings = (value, label, errors, {nonempty = false, pattern} = {}) => {
  if (!Array.isArray(value)) {
    errors.push(`${label} must be an array`)
    return []
  }
  if (nonempty && value.length === 0) errors.push(`${label} must not be empty`)
  const strings = value.filter((item, index) => {
    if (typeof item !== 'string' || item.length === 0) {
      errors.push(`${label}[${index}] must be a non-empty string`)
      return false
    }
    if (item.includes('\0')) errors.push(`${label}[${index}] must not contain NUL`)
    if (pattern && !pattern.test(item)) errors.push(`${label}[${index}] has an invalid format: ${item}`)
    return true
  })
  if (new Set(strings).size !== strings.length) errors.push(`${label} must contain unique values`)
  return strings
}

const uniqueObjects = (items, label, errors) => {
  const ids = items.map(item => item?.id).filter(id => typeof id === 'string')
  if (new Set(ids).size !== ids.length) errors.push(`${label} ids must be unique`)
  return new Set(ids)
}

const safeRelativePath = value =>
  typeof value === 'string' && value.length > 0 && !isAbsolute(value) && !value.includes('\0') &&
  !value.split(/[\\/]/).some(segment => segment === '..')

export const validateAdapter = (adapter, {expectedId} = {}) => {
  const errors = []
  const rootKeys = [
    '$schema', 'schemaVersion', 'id', 'version', 'supportLevel', 'trust', 'project', 'runtime',
    'detection', 'profileDefaults', 'provides', 'conflicts', 'deploymentProviders', 'deploymentTargets', 'artifacts',
    'shapes', 'initialCapabilities', 'targetCapabilities',
  ]
  if (!assertKnownKeys(adapter, rootKeys, 'adapter', errors)) return errors
  if (adapter.schemaVersion !== 1) errors.push('schemaVersion must equal 1')
  if (!profileIdPattern.test(adapter.id ?? '')) errors.push('id must be a kebab-case profile id')
  if (expectedId && adapter.id !== expectedId) errors.push(`id must match built-in directory: ${expectedId}`)
  if (!/^\d+\.\d+\.\d+$/.test(adapter.version ?? '')) errors.push('version must be an exact semantic version')
  if (!['certified', 'compatible', 'experimental'].includes(adapter.supportLevel)) errors.push('supportLevel is invalid')

  assertKnownKeys(adapter.trust, ['tier', 'source', 'commandPolicy', 'allowedExecutables', 'environmentAllowlist'], 'trust', errors)
  if (adapter.trust?.tier !== 'builtin') errors.push('trust.tier must equal builtin')
  if (adapter.trust?.source !== 'web-harness-control-plane') errors.push('trust.source is not trusted')
  if (adapter.trust?.commandPolicy !== 'argv-only') errors.push('trust.commandPolicy must equal argv-only')
  const allowedExecutables = new Set(arrayOfStrings(adapter.trust?.allowedExecutables, 'trust.allowedExecutables', errors, {nonempty: true}))
  if (allowedExecutables.size !== 1 || !allowedExecutables.has('pnpm')) errors.push('trust.allowedExecutables must contain only pnpm')
  const environmentAllowlist = arrayOfStrings(adapter.trust?.environmentAllowlist, 'trust.environmentAllowlist', errors, {pattern: /^[A-Z][A-Z0-9_]*$/})
  for (const key of environmentAllowlist) {
    if (!trustedEnvironmentKeys.has(key)) errors.push(`trust.environmentAllowlist contains an unsafe key: ${key}`)
  }

  assertKnownKeys(adapter.project, ['framework', 'variant', 'packageManager', 'router', 'rendering'], 'project', errors)
  for (const field of ['framework', 'variant', 'router']) {
    if (typeof adapter.project?.[field] !== 'string' || adapter.project[field].length === 0) errors.push(`project.${field} is required`)
  }
  if (adapter.project?.packageManager !== 'pnpm') errors.push('project.packageManager must equal pnpm')
  arrayOfStrings(adapter.project?.rendering, 'project.rendering', errors, {nonempty: true})

  assertKnownKeys(adapter.runtime, ['primary', 'supported'], 'runtime', errors)
  if (typeof adapter.runtime?.primary !== 'string') errors.push('runtime.primary is required')
  const supportedRuntimes = arrayOfStrings(adapter.runtime?.supported, 'runtime.supported', errors, {nonempty: true})
  if (adapter.runtime?.primary && !supportedRuntimes.includes(adapter.runtime.primary)) errors.push('runtime.supported must include runtime.primary')

  const stringSets = ['provides', 'conflicts', 'initialCapabilities', 'targetCapabilities']
  for (const key of stringSets) arrayOfStrings(adapter[key], key, errors, {nonempty: key === 'targetCapabilities', pattern: key.includes('Capabilities') ? capabilityPattern : undefined})
  const overlap = (adapter.provides ?? []).filter(item => (adapter.conflicts ?? []).includes(item))
  if (overlap.length) errors.push(`provides and conflicts overlap: ${sortedUnique(overlap).join(', ')}`)

  assertKnownKeys(adapter.detection, ['allPackages', 'anyPackages', 'allPaths', 'anyPaths', 'forbiddenPackages', 'forbiddenPaths'], 'detection', errors)
  for (const key of ['allPackages', 'anyPackages', 'forbiddenPackages']) arrayOfStrings(adapter.detection?.[key], `detection.${key}`, errors)
  for (const key of ['allPaths', 'anyPaths', 'forbiddenPaths']) {
    for (const path of arrayOfStrings(adapter.detection?.[key], `detection.${key}`, errors)) {
      if (!safeRelativePath(path)) errors.push(`detection.${key} contains unsafe path: ${path}`)
    }
  }
  if ((adapter.detection?.allPackages?.length ?? 0) === 0 && (adapter.detection?.anyPackages?.length ?? 0) === 0) {
    errors.push('detection must require at least one package')
  }

  assertKnownKeys(adapter.profileDefaults, ['productKind', 'backendShape', 'deploymentProvider', 'deploymentTarget', 'riskLevel', 'capabilities'], 'profileDefaults', errors)
  for (const key of ['productKind', 'backendShape', 'deploymentProvider', 'deploymentTarget', 'riskLevel']) {
    if (typeof adapter.profileDefaults?.[key] !== 'string' || adapter.profileDefaults[key].length === 0) errors.push(`profileDefaults.${key} is required`)
  }
  const defaultCapabilities = arrayOfStrings(adapter.profileDefaults?.capabilities, 'profileDefaults.capabilities', errors, {nonempty: true})
  for (const capability of defaultCapabilities) {
    if (!(adapter.provides ?? []).includes(capability)) errors.push(`profileDefaults.capabilities contains an unsupported capability: ${capability}`)
  }

  const deployments = Array.isArray(adapter.deploymentTargets) ? adapter.deploymentTargets : []
  if (!Array.isArray(adapter.deploymentTargets) || deployments.length === 0) errors.push('deploymentTargets must be a non-empty array')
  const deploymentIds = uniqueObjects(deployments, 'deploymentTargets', errors)
  for (const [index, target] of deployments.entries()) {
    assertKnownKeys(target, ['id', 'runtime', 'requires', 'conflicts'], `deploymentTargets[${index}]`, errors)
    if (!identifierPattern.test(target?.id ?? '')) errors.push(`deploymentTargets[${index}].id is invalid`)
    if (typeof target?.runtime !== 'string' || target.runtime.length === 0) errors.push(`deploymentTargets[${index}].runtime is required`)
    if (typeof target?.runtime === 'string' && !supportedRuntimes.includes(target.runtime)) {
      errors.push(`deploymentTargets[${index}].runtime is not declared in runtime.supported: ${target.runtime}`)
    }
    arrayOfStrings(target?.requires, `deploymentTargets[${index}].requires`, errors)
    arrayOfStrings(target?.conflicts, `deploymentTargets[${index}].conflicts`, errors)
  }
  if (!deploymentIds.has(adapter.profileDefaults?.deploymentTarget)) errors.push('profileDefaults.deploymentTarget is not declared')
  const providers = Array.isArray(adapter.deploymentProviders) ? adapter.deploymentProviders : []
  if (!Array.isArray(adapter.deploymentProviders) || providers.length === 0) errors.push('deploymentProviders must be a non-empty array')
  const providerIds = uniqueObjects(providers, 'deploymentProviders', errors)
  for (const [index, provider] of providers.entries()) {
    assertKnownKeys(provider, ['id', 'deploymentTargets'], `deploymentProviders[${index}]`, errors)
    if (!identifierPattern.test(provider?.id ?? '')) errors.push(`deploymentProviders[${index}].id is invalid`)
    for (const targetId of arrayOfStrings(provider?.deploymentTargets, `deploymentProviders[${index}].deploymentTargets`, errors, {nonempty: true})) {
      if (!deploymentIds.has(targetId)) errors.push(`deploymentProviders[${index}] references unknown deployment target: ${targetId}`)
    }
  }
  if (!providerIds.has(adapter.profileDefaults?.deploymentProvider)) errors.push('profileDefaults.deploymentProvider is not declared')
  const defaultProvider = providers.find(provider => provider?.id === adapter.profileDefaults?.deploymentProvider)
  if (defaultProvider && !defaultProvider.deploymentTargets?.includes(adapter.profileDefaults?.deploymentTarget)) {
    errors.push('profileDefaults deployment provider does not support the default deployment target')
  }
  const defaultTarget = deployments.find(target => target?.id === adapter.profileDefaults?.deploymentTarget)
  if (defaultTarget) {
    const selectedDefaults = new Set(defaultCapabilities)
    for (const requirement of defaultTarget.requires ?? []) {
      if (!selectedDefaults.has(requirement)) errors.push(`profileDefaults.capabilities is missing default target requirement: ${requirement}`)
    }
    for (const conflict of defaultTarget.conflicts ?? []) {
      if (selectedDefaults.has(conflict)) errors.push(`profileDefaults.capabilities conflicts with the default target: ${conflict}`)
    }
  }

  const artifacts = Array.isArray(adapter.artifacts) ? adapter.artifacts : []
  if (!Array.isArray(adapter.artifacts) || artifacts.length === 0) errors.push('artifacts must be a non-empty array')
  uniqueObjects(artifacts, 'artifacts', errors)
  for (const [index, artifact] of artifacts.entries()) {
    assertKnownKeys(artifact, ['id', 'path', 'kind', 'deploymentTargets'], `artifacts[${index}]`, errors)
    if (!identifierPattern.test(artifact?.id ?? '')) errors.push(`artifacts[${index}].id is invalid`)
    if (!safeRelativePath(artifact?.path)) errors.push(`artifacts[${index}].path is unsafe`)
    if (typeof artifact?.kind !== 'string' || artifact.kind.length === 0) errors.push(`artifacts[${index}].kind is required`)
    for (const targetId of arrayOfStrings(artifact?.deploymentTargets, `artifacts[${index}].deploymentTargets`, errors, {nonempty: true})) {
      if (!deploymentIds.has(targetId)) errors.push(`artifacts[${index}] references unknown deployment target: ${targetId}`)
    }
  }
  for (const deploymentId of deploymentIds) {
    if (!artifacts.some(artifact => artifact?.deploymentTargets?.includes(deploymentId))) {
      errors.push(`deployment target has no artifact: ${deploymentId}`)
    }
  }

  // shapes — 이 어댑터가 어느 형태 카탈로그를 쓰는가. `commands`·`checks`·`tasks`를 대신한다.
  const shapes = arrayOfStrings(adapter.shapes, 'shapes', errors, {nonempty: true})
  const catalog = readShapeChecks()
  for (const shape of shapes) {
    if (!catalog.shapes?.[shape]) errors.push(`shapes references unknown shape: ${shape}`)
  }

  return sortedUnique(errors)
}

// 도출된 그래프의 무결성. 선언 검증에서 떼어냈다 — 이제 검사·task는 선언이 아니라 도출이므로
// "선언이 서로를 가리키는가"가 아니라 "도출 결과가 닫혀 있는가"를 본다.
export const validateDerivedAdapter = adapter => {
  const errors = []
  const deploymentIds = new Set((adapter.deploymentTargets ?? []).map(target => target?.id))
  const knownCheckRequirements = new Set([...(adapter.provides ?? []), ...deploymentIds])
  const checkEvidenceCapabilities = []
  for (const [index, check] of (adapter.checks ?? []).entries()) {
    if (!['build', 'static', 'unit', 'contract', 'browser', 'runtime', 'security', 'artifact'].includes(check?.kind)) {
      errors.push(`derived checks[${index}].kind is invalid: ${check?.kind}`)
    }
    for (const requirement of check?.requires ?? []) {
      if (!knownCheckRequirements.has(requirement)) {
        errors.push(`derived checks[${index}] requires unknown capability or deployment target: ${requirement}`)
      }
    }
    if (typeof check?.evidenceCapability === 'string') checkEvidenceCapabilities.push([index, check.evidenceCapability])
  }
  const capabilityProviders = new Map()
  for (const task of adapter.tasks ?? []) {
    for (const capability of task.provides ?? []) {
      if (capabilityProviders.has(capability)) errors.push(`capability has multiple providers: ${capability}`)
      capabilityProviders.set(capability, task.id)
    }
  }
  const initial = new Set(adapter.initialCapabilities ?? [])
  for (const task of adapter.tasks ?? []) {
    for (const requirement of task.requires ?? []) {
      if (!initial.has(requirement) && !capabilityProviders.has(requirement)) {
        errors.push(`task '${task.id}' has unsatisfied capability: ${requirement}`)
      }
    }
  }
  for (const target of adapter.targetCapabilities ?? []) {
    if (!initial.has(target) && !capabilityProviders.has(target)) errors.push(`target capability has no provider: ${target}`)
  }
  for (const [index, evidenceCapability] of checkEvidenceCapabilities) {
    // 산출물을 내는 검사(도커 이미지·정적 export)는 evidence가 아니라 artifact를 낸다 — 정상이다.
    if (evidenceCapability.startsWith('artifact.')) continue
    if (!initial.has(evidenceCapability) && !capabilityProviders.has(evidenceCapability)) {
      errors.push(`derived checks[${index}] evidence has no DAG provider: ${evidenceCapability}`)
    }
  }
  for (const deploymentId of deploymentIds) {
    if (!capabilityProviders.has(`release.${deploymentId}`)) {
      errors.push(`deployment target has no release DAG provider: release.${deploymentId}`)
    }
  }
  return sortedUnique(errors)
}

const assertInsideBuiltins = path => {
  const root = realpathSync(adapterDirectory)
  const file = realpathSync(path)
  const offset = relative(root, file)
  if (offset.startsWith(`..${sep}`) || offset === '..' || isAbsolute(offset)) {
    throw new WebCoreError('UNTRUSTED_ADAPTER_PATH', 'Adapter path escapes the built-in adapter directory')
  }
}

// 2026-08-27: `commands`·`checks`·`tasks`를 어댑터에서 걷어냈다(3종 33,038B → 8,453B, −74%).
// 그 셋은 선언이 아니라 **도출 가능한 것**이었다 — 검사와 그래프는 `shape-checks.json`의 형태
// 카탈로그에서, 명령은 프로젝트 `package.json`의 script에서 나온다. 삭제 전에 내장 3종 전부
// 노드와 **간선까지** 일치함을 기계로 확인했다(등가 게이트는 그 확인을 위한 발판이었고 삭제와
// 함께 없앴다 — 비교 대상이 사라지면 게이트도 죽는 것이 맞다).
//
// `commands`가 여기 없는 이유: script 이름은 **프로젝트가 정한다**. 어댑터 로드 시점에는
// 프로젝트가 없으므로 해석은 실행 시점에 `resolve-commands`가 한다.
const deriveAdapterGraph = adapter => {
  const catalog = readShapeChecks()
  const shapes = Array.isArray(adapter.shapes) ? adapter.shapes : []
  const checks = [
    ...(catalog.common?.checks ?? []),
    ...shapes.flatMap(shape => catalog.shapes?.[shape]?.checks ?? []),
  ]
  const {tasks, errors} = deriveGraph({
    checks,
    capabilities: adapter.profileDefaults?.capabilities ?? [],
    deploymentTargets: (adapter.deploymentTargets ?? []).map(target => target.id),
    defaultTarget: adapter.profileDefaults?.deploymentTarget ?? null,
  })
  if (errors.length) {
    throw new WebCoreError('ADAPTER_GRAPH_UNDERIVABLE', `Cannot derive execution graph for ${adapter.id}`, {errors})
  }
  return {checks, tasks}
}

export const loadBuiltinAdapter = id => {
  if (!BUILTIN_ADAPTER_IDS.includes(id)) throw new WebCoreError('UNKNOWN_PROFILE', `Unknown built-in profile: ${id}`, {available: BUILTIN_ADAPTER_IDS})
  const path = join(adapterDirectory, id, 'adapter.json')
  if (!existsSync(path)) throw new WebCoreError('ADAPTER_MISSING', `Built-in adapter manifest is missing: ${id}`)
  assertInsideBuiltins(path)
  const adapter = readJson(path)
  const errors = validateAdapter(adapter, {expectedId: id})
  if (errors.length) throw new WebCoreError('INVALID_ADAPTER', `Built-in adapter is invalid: ${id}`, {errors})
  const {checks, tasks} = deriveAdapterGraph(adapter)
  const derived = {
    ...adapter,
    checks: checks.map(check => ({
      id: check.id,
      commandId: check.id,
      kind: check.receiptKind ?? 'runtime',
      // 빌드·2차 산출물 검사는 evidence가 아니라 artifact를 낸다(어댑터 선언도 그랬다).
      evidenceCapability: artifactOf(check) ?? evidenceNameOf(check),
      requires: check.requires ?? [],
      scriptCandidates: check.scriptCandidates ?? null,
    })),
    tasks,
  }
  const derivedErrors = validateDerivedAdapter(derived)
  if (derivedErrors.length) {
    throw new WebCoreError('INVALID_DERIVED_ADAPTER', `Derived adapter graph is invalid: ${id}`, {errors: derivedErrors})
  }
  return derived
}

export const loadBuiltinAdapters = () => BUILTIN_ADAPTER_IDS.map(loadBuiltinAdapter)
