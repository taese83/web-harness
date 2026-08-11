import {existsSync, realpathSync} from 'node:fs'
import {dirname, isAbsolute, join, relative, resolve, sep} from 'node:path'
import {fileURLToPath} from 'node:url'
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
    'commands', 'checks', 'initialCapabilities', 'targetCapabilities', 'tasks',
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

  const commands = Array.isArray(adapter.commands) ? adapter.commands : []
  if (!Array.isArray(adapter.commands) || commands.length === 0) errors.push('commands must be a non-empty array')
  const commandIds = uniqueObjects(commands, 'commands', errors)
  for (const [index, command] of commands.entries()) {
    assertKnownKeys(command, ['id', 'executable', 'args', 'cwd'], `commands[${index}]`, errors)
    if (!identifierPattern.test(command?.id ?? '')) errors.push(`commands[${index}].id is invalid`)
    if (!/^[a-zA-Z0-9._-]+$/.test(command?.executable ?? '')) errors.push(`commands[${index}].executable is invalid`)
    if (command?.executable && !allowedExecutables.has(command.executable)) errors.push(`commands[${index}].executable is not allowlisted`)
    arrayOfStrings(command?.args, `commands[${index}].args`, errors, {nonempty: true})
    if (command?.executable === 'pnpm' && !safePnpmArgs(command.args)) errors.push(`commands[${index}] violates the bounded pnpm contract`)
    if (command?.cwd !== '.') errors.push(`commands[${index}].cwd must equal .`)
  }

  const checks = Array.isArray(adapter.checks) ? adapter.checks : []
  if (!Array.isArray(adapter.checks) || checks.length === 0) errors.push('checks must be a non-empty array')
  uniqueObjects(checks, 'checks', errors)
  const knownCheckRequirements = new Set([...(adapter.provides ?? []), ...deploymentIds])
  const checkEvidenceCapabilities = []
  for (const [index, check] of checks.entries()) {
    assertKnownKeys(check, ['id', 'kind', 'commandId', 'requires', 'evidenceCapability'], `checks[${index}]`, errors)
    if (!identifierPattern.test(check?.id ?? '')) errors.push(`checks[${index}].id is invalid`)
    if (!['build', 'static', 'unit', 'contract', 'browser', 'runtime', 'security', 'artifact'].includes(check?.kind)) errors.push(`checks[${index}].kind is invalid`)
    if (!commandIds.has(check?.commandId)) errors.push(`checks[${index}] references unknown command: ${check?.commandId}`)
    if (!capabilityPattern.test(check?.evidenceCapability ?? '')) errors.push(`checks[${index}].evidenceCapability is invalid`)
    else checkEvidenceCapabilities.push([index, check.evidenceCapability])
    for (const requirement of arrayOfStrings(check?.requires, `checks[${index}].requires`, errors)) {
      if (!knownCheckRequirements.has(requirement)) {
        errors.push(`checks[${index}] requires unknown capability or deployment target: ${requirement}`)
      }
    }
  }

  const tasks = Array.isArray(adapter.tasks) ? adapter.tasks : []
  if (!Array.isArray(adapter.tasks) || tasks.length === 0) errors.push('tasks must be a non-empty array')
  uniqueObjects(tasks, 'tasks', errors)
  const capabilityProviders = new Map()
  for (const [index, task] of tasks.entries()) {
    assertKnownKeys(task, ['id', 'phase', 'requires', 'provides', 'commandIds'], `tasks[${index}]`, errors)
    if (!identifierPattern.test(task?.id ?? '')) errors.push(`tasks[${index}].id is invalid`)
    if (!['plan', 'scaffold', 'install', 'verify', 'build', 'runtime', 'release'].includes(task?.phase)) errors.push(`tasks[${index}].phase is invalid`)
    arrayOfStrings(task?.requires, `tasks[${index}].requires`, errors, {pattern: capabilityPattern})
    for (const capability of arrayOfStrings(task?.provides, `tasks[${index}].provides`, errors, {nonempty: true, pattern: capabilityPattern})) {
      if (capabilityProviders.has(capability)) errors.push(`capability has multiple providers: ${capability}`)
      capabilityProviders.set(capability, task.id)
    }
    for (const commandId of arrayOfStrings(task?.commandIds, `tasks[${index}].commandIds`, errors)) {
      if (!commandIds.has(commandId)) errors.push(`tasks[${index}] references unknown command: ${commandId}`)
    }
  }
  const initial = new Set(adapter.initialCapabilities ?? [])
  for (const [index, task] of tasks.entries()) {
    for (const requirement of task.requires ?? []) {
      if (!initial.has(requirement) && !capabilityProviders.has(requirement)) errors.push(`tasks[${index}] has unsatisfied capability: ${requirement}`)
    }
  }
  for (const target of adapter.targetCapabilities ?? []) {
    if (!initial.has(target) && !capabilityProviders.has(target)) errors.push(`target capability has no provider: ${target}`)
  }
  for (const [index, evidenceCapability] of checkEvidenceCapabilities) {
    if (!initial.has(evidenceCapability) && !capabilityProviders.has(evidenceCapability)) {
      errors.push(`checks[${index}] evidence has no DAG provider: ${evidenceCapability}`)
    }
  }
  for (const deploymentId of deploymentIds) {
    const releaseCapability = `release.${deploymentId}`
    if (!capabilityProviders.has(releaseCapability)) {
      errors.push(`deployment target has no release DAG provider: ${releaseCapability}`)
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

export const loadBuiltinAdapter = id => {
  if (!BUILTIN_ADAPTER_IDS.includes(id)) throw new WebCoreError('UNKNOWN_PROFILE', `Unknown built-in profile: ${id}`, {available: BUILTIN_ADAPTER_IDS})
  const path = join(adapterDirectory, id, 'adapter.json')
  if (!existsSync(path)) throw new WebCoreError('ADAPTER_MISSING', `Built-in adapter manifest is missing: ${id}`)
  assertInsideBuiltins(path)
  const adapter = readJson(path)
  const errors = validateAdapter(adapter, {expectedId: id})
  if (errors.length) throw new WebCoreError('INVALID_ADAPTER', `Built-in adapter is invalid: ${id}`, {errors})
  return adapter
}

export const loadBuiltinAdapters = () => BUILTIN_ADAPTER_IDS.map(loadBuiltinAdapter)
