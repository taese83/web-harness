#!/usr/bin/env node

import {spawnSync} from 'node:child_process'
import {resolveProfileCommands} from './resolve-commands.mjs'
import {evaluateHostExecutionGrant, recordHostExecutionGrant} from './host-execution-grant.mjs'
import {randomUUID} from 'node:crypto'
import {
  existsSync,
  closeSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import {tmpdir} from 'node:os'
import {delimiter, dirname, join, relative, resolve, sep} from 'node:path'
import {computeSourceFingerprint, listSourceFiles, sha256} from './evidence-lib.mjs'
import {collectDeploymentArtifacts} from './artifact-inventory-lib.mjs'
import {validateStaticRuntimeDataDeployment} from './runtime-data-deployment-lib.mjs'
import {
  INGESTION_RECEIPT_ID,
  ingestionReceiptEvidence,
  readRuntimeDataContract,
  validateRuntimeDataArtifacts,
} from './runtime-data-contract-lib.mjs'
import {
  analyzePackageScript,
  cleanProfileBuildArtifacts,
  findUnsafePackageConfig,
  hasMeaningfulProfileScript,
  readDependencyBinding,
  readExecutionTargetBinding,
  resolvePackageExecutionTarget,
} from './quality-policy-lib.mjs'
import {
  adapterCheckBindings,
  projectProfileSha256,
  readLockedExecutionPlan,
  readLockedProjectProfile,
  validateLockedProfileProjectState,
} from './web-core/profile-policy-lib.mjs'
import {inspectExternalIngestion} from './web-core/ingestion-detection-lib.mjs'
import {validateVercelProjectConfig} from './web-core/vercel-config-lib.mjs'
import {
  parseTrustedPromotionActions,
  validateWorkflowSecurityProjects,
} from './validators/validate-workflows-and-evals.mjs'
import {collectVisualEvidence} from './visual-evidence-lib.mjs'
const BASE_CHECKS = new Map([
  ['build', {scripts: ['build'], timeoutMs: 600_000}],
  ['typecheck', {scripts: ['typecheck'], timeoutMs: 600_000}],
  ['lint', {scripts: ['lint'], timeoutMs: 600_000}],
  ['test', {scripts: ['test'], testKind: 'unit', timeoutMs: 600_000}],
  ['coverage', {scripts: ['test:coverage', 'coverage'], testKind: 'unit', timeoutMs: 600_000}],
  ['browser', {scripts: ['test:e2e', 'e2e'], testKind: 'browser', timeoutMs: 900_000}],
  ['audit', {command: ['pnpm', 'audit', '--prod', '--registry=https://registry.npmjs.org'], timeoutMs: 180_000}],
])
const FALLBACK_INGESTION_CHECK = {
  scripts: ['validate:ingestion'],
  requiredScript: 'validate:ingestion',
  receiptId: INGESTION_RECEIPT_ID,
  kind: 'contract',
  timeoutMs: 600_000,
}
const GRANT_NOTE = '되돌리려면 _workspace/03_dev/host-execution-grant.json 삭제'
const args = process.argv.slice(2)
let projectValue = process.cwd()
let selectedCheck = null
let allRequested = false
let hostExecutionApproved = false
const seenOptions = new Set()
for (let index = 0; index < args.length; index += 1) {
  const option = args[index]
  if (!['--project', '--check', '--all', '--allow-host-execution'].includes(option) || seenOptions.has(option)) {
    process.stderr.write(`Unknown or duplicate quality runner option: ${option}\n`)
    process.exit(2)
  }
  seenOptions.add(option)
  if (option === '--all') allRequested = true
  else if (option === '--allow-host-execution') hostExecutionApproved = true
  else {
    const value = args[index + 1]
    if (!value || value.startsWith('--')) {
      process.stderr.write(`Quality runner option requires a value: ${option}\n`)
      process.exit(2)
    }
    if (option === '--project') projectValue = value
    else selectedCheck = value
    index += 1
  }
}
if (allRequested && selectedCheck) {
  process.stderr.write('--all and --check are mutually exclusive.\n')
  process.exit(2)
}
const externallyIsolated = process.env.WEB_HARNESS_ISOLATED_EXECUTION === '1'
const projectRoot = realpathSync(resolve(projectValue))
// **한 번 승인하면 다시 묻지 않는다.** 이 러너는 생성된 프로젝트의 package script를 사용자
// 머신에서 실행하므로 처음 한 번은 반드시 승인이 필요하다 — 그러나 매번 묻는 것은 판단이
// 아니라 의식이다(Gate A·B·C·재시도마다 반복). 승인은 프로젝트+호스트에 결박해 기록되고,
// 되돌리려면 `_workspace/03_dev/host-execution-grant.json`을 지운다.
const standing = evaluateHostExecutionGrant(projectRoot)
if (!externallyIsolated && !hostExecutionApproved && !standing.granted) {
  process.stderr.write('Quality runner executes project code; rerun after approval with --allow-host-execution or in isolated CI.\n')
  if (standing.reason !== 'no-grant') process.stderr.write(`(기존 승인 무효: ${standing.reason})\n`)
  process.exit(2)
}
// 명시 승인으로 들어왔으면 그 사실을 남긴다 — 다음 게이트부터는 묻지 않는다.
if (!externallyIsolated && hostExecutionApproved && !standing.granted) {
  recordHostExecutionGrant(projectRoot)
  process.stderr.write(`host 실행 승인을 기록했다 — 이 프로젝트에서는 다시 묻지 않는다(${GRANT_NOTE}).\n`)
}
// Toolchain pin preflight (development-gates-contract §toolchain pin): this runner spawns the
// project's package scripts under the Node that launched it. If that Node is older than the
// project's pinned major (.nvmrc), gates fail in confusing ways and any green is not valid
// evidence — fail closed before executing anything. Skipped when no numeric .nvmrc pin exists.
const nvmrcPath = join(projectRoot, '.nvmrc')
if (existsSync(nvmrcPath)) {
  const pinRaw = readFileSync(nvmrcPath, 'utf8').trim().replace(/^v/i, '')
  const pinMajor = /^\d+/.test(pinRaw) ? parseInt(pinRaw, 10) : null
  if (pinMajor !== null) {
    const runningMajor = parseInt(process.versions.node.split('.')[0], 10)
    if (runningMajor < pinMajor) {
      process.stderr.write(
        `Node ${process.versions.node} is older than the project pin (.nvmrc = ${pinMajor}). ` +
          `Rerun gates under Node ${pinMajor}+ (e.g. nvm use ${pinMajor}); results from an older Node are not valid evidence.\n`,
      )
      process.exit(2)
    }
  }
}
const evidenceDirectory = ['_workspace', '04_qa', 'evidence'].reduce((parent, segment) => {
  const directory = join(parent, segment)
  if (!existsSync(directory)) mkdirSync(directory)
  const stats = lstatSync(directory)
  const offset = relative(projectRoot, realpathSync(directory))
  if (
    stats.isSymbolicLink() ||
    !stats.isDirectory() ||
    offset === '..' ||
    offset.startsWith(`..${sep}`)
  ) {
    process.stderr.write('Quality evidence directory must be a real directory inside the project.\n')
    process.exit(2)
  }
  return directory
}, projectRoot)
const runAll = allRequested || selectedCheck === null
const sandboxHome = mkdtempSync(join(tmpdir(), 'web-harness-quality-home-'))
mkdirSync(join(sandboxHome, 'tmp'), {recursive: true})
process.on('exit', () => rmSync(sandboxHome, {recursive: true, force: true}))
const SAFE_ENVIRONMENT_KEYS = new Set([
  'CI',
  'COLORTERM',
  'COMSPEC',
  'FORCE_COLOR',
  'LANG',
  'LC_ALL',
  'NO_COLOR',
  'PATH',
  'PATHEXT',
  'SYSTEMROOT',
  'TERM',
  'TMP',
  'TEMP',
  'TMPDIR',
  'TZ',
])
const publicEnvironmentPath = join(projectRoot, '_workspace/02_design/build-environment.json')
let declaredPublicEnvironment = []
let buildEnvironmentSource = null
if (existsSync(publicEnvironmentPath)) {
  try {
    buildEnvironmentSource = readFileSync(publicEnvironmentPath, 'utf8')
    const contract = JSON.parse(buildEnvironmentSource)
    if (contract.schemaVersion !== 1 || !Array.isArray(contract.public)) throw new Error('schemaVersion 1 and public[] are required')
    declaredPublicEnvironment = [...new Set(contract.public)]
    for (const name of declaredPublicEnvironment) {
      if (
        typeof name !== 'string' ||
        !/^(?:NEXT_PUBLIC_|PUBLIC_|VITE_)[A-Z0-9_]+$/.test(name) ||
        /(?:SECRET|TOKEN|PASSWORD|CREDENTIAL|PRIVATE_KEY|API_KEY)/.test(name)
      ) throw new Error(`unsafe public environment name: ${String(name)}`)
      const value = process.env[name]
      if (typeof value === 'string' && (value.length > 4096 || /[\0\r\n]/.test(value))) {
        throw new Error(`unsafe public environment value: ${name}`)
      }
    }
  } catch (error) {
    process.stderr.write(`Invalid build environment contract: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(2)
  }
}
const declaredPublicEnvironmentSet = new Set(declaredPublicEnvironment)
const commandEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(([key]) =>
    SAFE_ENVIRONMENT_KEYS.has(key) || declaredPublicEnvironmentSet.has(key),
  ),
)
commandEnvironment.CI = process.env.CI ?? '1'
commandEnvironment.HOME = sandboxHome
commandEnvironment.USERPROFILE = sandboxHome
commandEnvironment.XDG_CACHE_HOME = join(sandboxHome, '.cache')
commandEnvironment.XDG_CONFIG_HOME = join(sandboxHome, '.config')
commandEnvironment.npm_config_userconfig = join(sandboxHome, '.npmrc')
commandEnvironment.npm_config_globalconfig = join(sandboxHome, '.global-npmrc')
commandEnvironment.npm_config_registry = 'https://registry.npmjs.org'
commandEnvironment.TMP = join(sandboxHome, 'tmp')
commandEnvironment.TEMP = join(sandboxHome, 'tmp')
commandEnvironment.TMPDIR = join(sandboxHome, 'tmp')
commandEnvironment.PATH = [dirname(process.execPath), commandEnvironment.PATH]
  .filter(Boolean)
  .join(delimiter)
const publicEnvironmentSha256 = sha256(JSON.stringify(Object.fromEntries(
  [...declaredPublicEnvironment].sort().map(name => [name, commandEnvironment[name] ?? null]),
)))
const packageJsonPath = join(projectRoot, 'package.json')
const pnpmExecutable = join(dirname(process.execPath), process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm')
if (!existsSync(pnpmExecutable)) {
  process.stderr.write('Pinned pnpm must be installed beside the active Node runtime.\n')
  process.exit(2)
}
let packageJson
try {
  packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
} catch (error) {
  process.stderr.write(`Cannot read package.json: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(2)
}
if (findUnsafePackageConfig(projectRoot)) {
  process.stderr.write('Project/workspace npmrc or pnpm hook is outside the public-registry quality runner scope.\n')
  process.exit(2)
}
const dependencyBindingAtStart = readDependencyBinding(projectRoot, packageJson)
const adapterChecks = new Map()
const activeAdapterEntries = []
const projectProfilePath = join(projectRoot, '_workspace/01_plan/project-profile.json')
let lockedProfile = null
let lockedExecutionPlan = null
if (existsSync(projectProfilePath)) {
  try {
    lockedProfile = readLockedProjectProfile(projectProfilePath)
    validateLockedProfileProjectState(lockedProfile, projectRoot)
    lockedExecutionPlan = readLockedExecutionPlan(
      join(projectRoot, '_workspace/03_dev/web-execution-plan.json'),
      lockedProfile,
    )
    for (const name of lockedProfile.adapter.trust.environmentAllowlist) {
      if (typeof process.env[name] === 'string') commandEnvironment[name] = process.env[name]
    }
    if (lockedProfile.adapter.id === 'next-app-fullstack') commandEnvironment.NEXT_TELEMETRY_DISABLED = '1'
    const commands = resolveProfileCommands({projectRoot, adapter: lockedProfile.adapter})
    for (const binding of adapterCheckBindings({
      adapter: lockedProfile.adapter,
      deploymentProvider: lockedProfile.selection.provider.id,
      deploymentTarget: lockedProfile.selection.target.id,
      capabilities: lockedProfile.selection.selectedCapabilities,
    })) {
      const command = commands.get(binding.commandId)
      if (!command) throw new Error(`adapter command is missing: ${binding.commandId}`)
      const requiredScript = command.executable === 'pnpm' && command.args[0] === 'run' ? command.args[1] : null
      const definition = {
        command: [command.executable, ...command.args],
        commandId: binding.commandId,
        evidenceCapability: binding.evidenceCapability,
        requiredScript,
        receiptId: binding.receiptId,
        kind: binding.kind,
        testKind: binding.kind === 'browser' ? 'browser' : binding.kind === 'unit' ? 'unit' : undefined,
        timeoutMs: ['browser', 'runtime', 'artifact'].includes(binding.kind) ? 900_000 : 600_000,
      }
      adapterChecks.set(binding.id, definition)
      adapterChecks.set(binding.receiptId, definition)
      activeAdapterEntries.push([binding.id, definition])
    }
  } catch (error) {
    process.stderr.write(`Invalid locked project profile: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(2)
  }
}
const ingestionInspection = inspectExternalIngestion(projectRoot)
if (ingestionInspection.errors.length) {
  process.stderr.write(`Invalid external ingestion declaration: ${ingestionInspection.errors.join('; ')}\n`)
  process.exit(2)
}
if (ingestionInspection.detected && !ingestionInspection.contractsComplete) {
  process.stderr.write(
    'External ingestion markers require both _workspace/02_design/ingestion-contract.md and ' +
    '_workspace/02_design/runtime-data-contract.json.\n',
  )
  process.exit(2)
}
let runtimeDataContract = null
let generatedArtifactPaths = []
if (ingestionInspection.contractsComplete) {
  try {
    runtimeDataContract = readRuntimeDataContract(projectRoot, {
      mutableArtifactRoots: lockedProfile?.selection.artifacts.map(artifact => artifact.path) ?? [],
    })
    generatedArtifactPaths = runtimeDataContract.contract.generatedArtifacts.map(artifact => artifact.path)
  } catch (error) {
    process.stderr.write(`Invalid runtime data contract: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(2)
  }
}
const vercelConfigValidation = validateVercelProjectConfig({
  projectRoot,
  lockedProfile,
  runtimeDataContract,
})
if (!vercelConfigValidation.ok) {
  process.stderr.write(`Vercel project configuration validation failed: ${vercelConfigValidation.errors.join('; ')}\n`)
  process.exit(2)
}
let trustedPromotionActions
try {
  trustedPromotionActions = parseTrustedPromotionActions(process.env.WEB_HARNESS_TRUSTED_PROMOTION_ACTIONS)
} catch (error) {
  process.stderr.write(`Invalid protected promotion policy: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(2)
}
if (runtimeDataContract?.contract.refreshCapabilities.includes('scheduled') && trustedPromotionActions.length === 0) {
  process.stderr.write('Scheduled ingestion requires WEB_HARNESS_TRUSTED_PROMOTION_ACTIONS from protected CI configuration.\n')
  process.exit(2)
}
const trustedPromotionActionsSha256 = sha256(JSON.stringify(trustedPromotionActions))
const workflowPolicyErrors = []
try {
  validateWorkflowSecurityProjects({
    repositoryRoot: projectRoot,
    manifest: {
      schemaVersion: 1,
      projects: [{root: '.', generatedPaths: generatedArtifactPaths, trustedPromotionActions}],
    },
    pass: () => {},
    fail: message => workflowPolicyErrors.push(message),
  })
} catch (error) {
  workflowPolicyErrors.push(error instanceof Error ? error.message : String(error))
}
if (workflowPolicyErrors.length) {
  process.stderr.write(`Workflow security validation failed: ${workflowPolicyErrors.join('; ')}\n`)
  process.exit(2)
}
const checks = new Map([...BASE_CHECKS, ...adapterChecks])
if (runtimeDataContract && !checks.has(INGESTION_RECEIPT_ID)) {
  checks.set(INGESTION_RECEIPT_ID, FALLBACK_INGESTION_CHECK)
}
if (!runAll && !checks.has(selectedCheck)) {
  process.stderr.write(`Unknown quality check: ${selectedCheck ?? '<missing>'}\n`)
  process.exit(2)
}
const normalizeVersion = source => {
  const match = String(source).match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/)
  return match ? [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)] : null
}

const compareVersions = (left, right) => {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index] ? 1 : -1
  }
  return 0
}

const satisfiesComparator = (version, comparator) => {
  const match = comparator.match(/^(>=|<=|>|<|=|\^|~)?\s*(\d+)(?:\.(\d+|x|X|\*))?(?:\.(\d+|x|X|\*))?$/)
  if (!match) return null
  const operator = match[1] ?? '='
  const requested = [Number(match[2]), Number(match[3]?.match(/^\d+$/) ? match[3] : 0), Number(match[4]?.match(/^\d+$/) ? match[4] : 0)]
  const comparison = compareVersions(version, requested)
  if (match[3] && !/^\d+$/.test(match[3])) return version[0] === requested[0]
  if (match[4] && !/^\d+$/.test(match[4])) return version[0] === requested[0] && version[1] === requested[1]
  if (operator === '>=') return comparison >= 0
  if (operator === '<=') return comparison <= 0
  if (operator === '>') return comparison > 0
  if (operator === '<') return comparison < 0
  if (operator === '^') return version[0] === requested[0] && comparison >= 0
  if (operator === '~') return version[0] === requested[0] && version[1] === requested[1] && comparison >= 0
  return comparison === 0 || (!match[3] && version[0] === requested[0])
}

const satisfiesNodeEngine = (range, versionSource) => {
  if (!range) return null
  const version = normalizeVersion(versionSource)
  if (!version) return null
  for (const alternative of String(range).split('||')) {
    const comparators = alternative.trim().split(/\s+/).filter(Boolean)
    const results = comparators.map(comparator => satisfiesComparator(version, comparator))
    if (results.every(result => result === true)) return true
    if (results.some(result => result === null)) continue
  }
  return false
}

const commandText = parts => parts.map(part => (/\s/.test(part) ? JSON.stringify(part) : part)).join(' ')
const executeVerifiedPackageScript = ({analysis, timeoutMs}) => {
  const startedAt = Date.now()
  let stdout = ''
  let stderr = ''
  for (const command of analysis.executionCommands) {
    const elapsed = Date.now() - startedAt
    const remaining = Math.max(1, timeoutMs - elapsed)
    let executable
    let args
    if (command.executable === 'node') {
      executable = process.execPath
      args = command.args
    } else if (command.executable === 'docker') {
      executable = 'docker'
      args = command.args
    } else {
      const packageTarget = resolvePackageExecutionTarget(projectRoot, command.executable)
      const descriptor = openSync(packageTarget, 'r')
      const headerBuffer = Buffer.alloc(256)
      let header
      try {
        header = headerBuffer.subarray(0, readSync(descriptor, headerBuffer, 0, headerBuffer.length, 0)).toString('utf8')
      } finally {
        closeSync(descriptor)
      }
      const nodeEntrypoint = /^#![^\r\n]*\bnode\b/.test(header) || /\.(?:c?js|mjs)$/.test(packageTarget)
      executable = nodeEntrypoint ? process.execPath : packageTarget
      args = nodeEntrypoint ? [packageTarget, ...command.args] : command.args
    }
    const result = spawnSync(executable, args, {
      cwd: projectRoot,
      encoding: 'utf8',
      env: {
        ...commandEnvironment,
        ...Object.fromEntries(command.assignments.map(assignment => [assignment.name, assignment.value])),
      },
      maxBuffer: 20 * 1024 * 1024,
      timeout: remaining,
    })
    stdout += result.stdout ?? ''
    stderr += result.stderr ?? result.error?.message ?? ''
    if (result.status !== 0) return {...result, stdout, stderr}
  }
  return {status: 0, signal: null, stdout, stderr, error: null}
}
const pnpmVersionResult = spawnSync(pnpmExecutable, ['--version'], {
  cwd: projectRoot,
  encoding: 'utf8',
  env: commandEnvironment,
})
const pnpmVersion = pnpmVersionResult.status === 0 ? pnpmVersionResult.stdout.trim() : null
const nodeVersion = process.version.replace(/^v/, '')
const engineSatisfied = satisfiesNodeEngine(packageJson.engines?.node, nodeVersion)
const declaredPackageManagerMatch = packageJson.packageManager?.match(/^pnpm@([^+]+)(?:\+.+)?$/)
const declaredPackageManagerVersion = declaredPackageManagerMatch ? normalizeVersion(declaredPackageManagerMatch[1]) : null
const installedPackageManagerVersion = pnpmVersion ? normalizeVersion(pnpmVersion) : null
const packageManagerSatisfied = packageJson.packageManager
  ? Boolean(
      declaredPackageManagerVersion &&
      installedPackageManagerVersion &&
      compareVersions(declaredPackageManagerVersion, installedPackageManagerVersion) === 0
    )
  : null
const gitCommit = null
const discoveredTests = kind => {
  if (!kind) return []
  return listSourceFiles(projectRoot).filter(relativePath => {
    const isBrowser = /(?:^|\/)e2e\/.*\.spec\.[jt]sx?$/.test(relativePath)
    if (kind === 'browser') return isBrowser
    return !isBrowser && /(?:^|\/)(?:__tests__\/.*|[^/]+\.(?:test|spec)\.[jt]sx?)$/.test(relativePath)
  })
}
const executeCheck = (id, definition) => {
  const receiptId = definition.receiptId ?? id
  const startedAt = new Date().toISOString()
  const started = process.hrtime.bigint()
  const profileArtifactPaths = lockedProfile?.selection.artifacts.map(artifact => artifact.path) ?? []
  const sourceExclusions = profileArtifactPaths
  const allowedMutationPaths = profileArtifactPaths
  const sourceFingerprintBefore = computeSourceFingerprint(projectRoot, {excludePaths: sourceExclusions})
  const protectedSourceFingerprintBefore = computeSourceFingerprint(projectRoot, {
    excludePaths: allowedMutationPaths,
  })
  const discoveredTestFiles = discoveredTests(definition.testKind)
  const visualEvidenceBefore = definition.testKind === 'browser'
    ? collectVisualEvidence(projectRoot, discoveredTestFiles)
    : null
  const artifactInventoryBefore = collectDeploymentArtifacts(
    projectRoot,
    lockedProfile?.selection.artifacts ?? [],
  )
  const selectedScript = definition.scripts?.find(script => typeof packageJson.scripts?.[script] === 'string')
  const command = definition.command ?? (selectedScript ? ['pnpm', selectedScript] : ['pnpm', definition.scripts?.[0] ?? id])
  const packageScriptName = definition.requiredScript ?? selectedScript ?? null
  const packageScriptSource = packageScriptName ? packageJson.scripts?.[packageScriptName] ?? null : null
  const packageScriptAnalysis = packageScriptSource ? analyzePackageScript(packageScriptSource) : null
  const requiresExternallyIsolatedDocker = packageScriptAnalysis?.commands?.some(command => command.executable === 'docker') === true
  const dependencyBindingBefore = readDependencyBinding(projectRoot, packageJson)
  const dependencyDriftBeforeCheck = JSON.stringify(dependencyBindingBefore) !== JSON.stringify(dependencyBindingAtStart)
  const executionTargetBindingBefore = readExecutionTargetBinding({
    projectRoot,
    analysis: packageScriptAnalysis,
    pnpmExecutable,
    searchPath: commandEnvironment.PATH,
  })

  let result = null
  let status = 'PASS'
  let blockedReason = null
  let cleanBuildArtifacts = []
  let ingestionValidation = null
  let runtimeDataDeploymentValidation = null
  if (engineSatisfied === false) {
    status = 'BLOCKED'
    blockedReason = `Current Node ${nodeVersion} does not satisfy engines.node ${packageJson.engines.node}`
  } else if (packageManagerSatisfied === false) {
    status = 'BLOCKED'
    blockedReason = `Current pnpm ${pnpmVersion ?? 'unavailable'} does not match packageManager ${packageJson.packageManager}`
  } else if (definition.requiredScript && typeof packageJson.scripts?.[definition.requiredScript] !== 'string') {
    status = 'BLOCKED'
    blockedReason = `Missing package script: ${definition.requiredScript}`
  } else if (definition.scripts && !selectedScript) {
    status = 'BLOCKED'
    blockedReason = `Missing package script; expected one of: ${definition.scripts.join(', ')}`
  } else if (packageScriptAnalysis && !packageScriptAnalysis.ok) {
    status = 'BLOCKED'
    blockedReason = `Package script violates the argv command contract: ${packageScriptAnalysis.error}`
  } else if (requiresExternallyIsolatedDocker && !externallyIsolated) {
    status = 'BLOCKED'
    blockedReason = 'Docker quality commands require externally isolated CI execution'
  } else if (lockedProfile && packageScriptSource && !hasMeaningfulProfileScript(id, definition, packageScriptSource, packageScriptAnalysis)) {
    status = 'BLOCKED'
    blockedReason = `Profile-bound package script does not satisfy its semantic command contract: ${packageScriptName}`
  } else if (command[0] === 'pnpm' && !dependencyBindingBefore.satisfied) {
    status = 'BLOCKED'
    blockedReason = 'Installed dependency graph is missing or does not match the reviewed frozen lockfile'
  } else if (dependencyDriftBeforeCheck) {
    status = 'BLOCKED'
    blockedReason = 'Installed dependency content or metadata changed earlier in this quality cohort'
  } else if (!executionTargetBindingBefore.satisfied) {
    status = 'BLOCKED'
    blockedReason = executionTargetBindingBefore.errors.join('; ')
  } else if (definition.testKind && discoveredTestFiles.length === 0) {
    status = 'BLOCKED'
    blockedReason = `No ${definition.testKind} test files were discovered`
  } else if (visualEvidenceBefore?.required && visualEvidenceBefore.errors.length > 0) {
    status = 'BLOCKED'
    blockedReason = `Visual evidence preflight failed: ${visualEvidenceBefore.errors.join('; ')}`
  } else {
    try {
      if (lockedProfile && definition.kind === 'build') {
        cleanBuildArtifacts = cleanProfileBuildArtifacts(projectRoot, lockedProfile.selection.artifacts)
      }
      result = packageScriptAnalysis
        ? executeVerifiedPackageScript({analysis: packageScriptAnalysis, timeoutMs: definition.timeoutMs})
        : spawnSync(command[0] === 'pnpm' ? pnpmExecutable : command[0], command.slice(1), {
            cwd: projectRoot,
            encoding: 'utf8',
            env: commandEnvironment,
            maxBuffer: 20 * 1024 * 1024,
            timeout: definition.timeoutMs,
          })
      if (result.status !== 0) status = 'FAIL'
    } catch (error) {
      status = 'BLOCKED'
      blockedReason = error instanceof Error ? error.message : String(error)
    }
  }

  if (receiptId === INGESTION_RECEIPT_ID) {
    ingestionValidation = validateRuntimeDataArtifacts(projectRoot, {
      mutableArtifactRoots: lockedProfile?.selection.artifacts.map(artifact => artifact.path) ?? [],
    })
    if (!ingestionValidation.ok) {
      status = 'FAIL'
      blockedReason = `Runtime data artifact validation failed: ${ingestionValidation.errors.join('; ')}`
    }
  }

  const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000
  const sourceFingerprintAfter = computeSourceFingerprint(projectRoot, {excludePaths: sourceExclusions})
  const protectedSourceFingerprintAfter = computeSourceFingerprint(projectRoot, {
    excludePaths: allowedMutationPaths,
  })
  const sourceMutationDetected = protectedSourceFingerprintBefore !== protectedSourceFingerprintAfter
  const dependencyBindingAfter = readDependencyBinding(projectRoot, packageJson)
  const dependencyMutationDetected = JSON.stringify(dependencyBindingBefore) !== JSON.stringify(dependencyBindingAfter)
  const executionTargetBindingAfter = readExecutionTargetBinding({
    projectRoot,
    analysis: packageScriptAnalysis,
    pnpmExecutable,
    searchPath: commandEnvironment.PATH,
  })
  const executionTargetMutationDetected = executionTargetBindingBefore.sha256 !== executionTargetBindingAfter.sha256 ||
    executionTargetBindingBefore.satisfied !== executionTargetBindingAfter.satisfied
  const artifactInventoryAfter = collectDeploymentArtifacts(
    projectRoot,
    lockedProfile?.selection.artifacts ?? [],
    {requireAll: Boolean(lockedProfile) && ['build', 'artifact', 'browser', 'runtime'].includes(definition.kind)},
  )
  const visualEvidenceAfter = definition.testKind === 'browser'
    ? collectVisualEvidence(projectRoot, discoveredTestFiles)
    : null
  if (status !== 'BLOCKED' && visualEvidenceAfter?.required && visualEvidenceAfter.errors.length > 0) {
    status = 'FAIL'
    blockedReason = `Visual evidence validation failed: ${visualEvidenceAfter.errors.join('; ')}`
  }
  if (definition.kind === 'build' && runtimeDataContract) {
    runtimeDataDeploymentValidation = validateStaticRuntimeDataDeployment({
      projectRoot,
      lockedProfile,
    })
    if (!runtimeDataDeploymentValidation.ok) {
      status = 'FAIL'
      blockedReason = `Static runtime data deployment validation failed: ${runtimeDataDeploymentValidation.errors.join('; ')}`
    }
  }
  if (sourceMutationDetected) {
    status = 'FAIL'
    blockedReason = 'Quality command mutated protected source files; cache/output paths must be excluded explicitly'
  }
  if (dependencyMutationDetected) {
    status = 'FAIL'
    blockedReason = 'Quality command mutated installed dependency content or metadata'
  }
  if (executionTargetMutationDetected) {
    status = 'FAIL'
    blockedReason = 'Quality command mutated its resolved package execution target'
  }
  if (artifactInventoryBefore.errors.length || artifactInventoryAfter.errors.length) {
    status = 'FAIL'
    blockedReason = [...artifactInventoryBefore.errors, ...artifactInventoryAfter.errors].join('; ')
  }
  if (
    lockedProfile &&
    !['build', 'artifact'].includes(definition.kind) &&
    JSON.stringify(artifactInventoryBefore.artifacts) !== JSON.stringify(artifactInventoryAfter.artifacts)
  ) {
    status = 'FAIL'
    blockedReason = 'Quality command mutated the selected deployment artifact'
  }
  const stdout = result?.stdout ?? ''
  const stderr = result?.stderr ?? result?.error?.message ?? ''
  return {
    schemaVersion: 2,
    runner: 'web-harness-quality-gate',
    id: receiptId,
    adapterCheckId: lockedProfile ? id : null,
    adapterCommandId: lockedProfile ? definition.commandId ?? null : null,
    command: commandText(command),
    executionMode: packageScriptAnalysis ? 'verified-package-argv' : 'pinned-control-plane-argv',
    packageScript: packageScriptName ? {
      name: packageScriptName,
      sha256: sha256(packageScriptSource),
      commandContractSha256: packageScriptAnalysis?.ok ? sha256(JSON.stringify(packageScriptAnalysis.commands)) : null,
    } : null,
    cwd: '.',
    startedAt,
    durationMs: Math.round(durationMs),
    timeoutMs: definition.timeoutMs,
    nodeVersion,
    nodeEngine: packageJson.engines?.node ?? null,
    engineSatisfied,
    pnpmVersion,
    packageManager: packageJson.packageManager ?? null,
    packageManagerSatisfied,
    dependencyBinding: dependencyBindingBefore,
    dependencyBindingBefore,
    dependencyBindingAfter,
    dependencyMutationDetected,
    executionTargetBindingBefore,
    executionTargetBindingAfter,
    executionTargetMutationDetected,
    gitCommit,
    sourceFingerprint: null,
    sourceFingerprintBefore,
    sourceFingerprintAfter,
    sourceMutationDetected,
    allowedSourceMutations: allowedMutationPaths,
    artifactInventoryBefore: artifactInventoryBefore.artifacts,
    artifactInventoryAfter: artifactInventoryAfter.artifacts,
    cleanBuildArtifacts,
    ...(ingestionValidation ? {ingestionValidation: ingestionReceiptEvidence(ingestionValidation)} : {}),
    ...(runtimeDataDeploymentValidation?.applicable ? {runtimeDataDeploymentValidation} : {}),
    ...(visualEvidenceAfter?.required ? {visualEvidence: visualEvidenceAfter} : {}),
    exitCode: Number.isInteger(result?.status) ? result.status : null,
    signal: result?.signal ?? null,
    status,
    blockedReason,
    discoveredTestFiles,
    stdoutSha256: sha256(stdout),
    stderrSha256: sha256(stderr),
    stdoutTail: '',
    stderrTail: '',
    outputTailPolicy: 'omitted-to-prevent-secret-persistence',
    environmentPolicy: {
      inheritedKeys: Object.keys(commandEnvironment)
        .filter(key => !['HOME', 'USERPROFILE', 'XDG_CACHE_HOME', 'XDG_CONFIG_HOME', 'npm_config_userconfig'].includes(key))
        .sort(),
      isolatedHome: true,
      secretVariablesInherited: false,
      declaredPublicVariables: declaredPublicEnvironment.sort(),
      publicEnvironmentSha256,
      trustedPromotionActionsSha256,
      executionContext: externallyIsolated ? 'isolated-ci-declared' : 'user-approved-host',
      isolationVerifiedByRunner: false,
      hostFilesystemIsolated: null,
      networkIsolated: null,
    },
    profileBinding: lockedProfile ? {
      profileId: lockedProfile.adapter.id,
      adapterVersion: lockedProfile.adapter.version,
      adapterSha256: lockedProfile.profile.adapter.sha256,
      deploymentProvider: lockedProfile.selection.provider.id,
      deploymentTarget: lockedProfile.selection.target.id,
      profileSha256: projectProfileSha256(lockedProfile.profile),
      selectedCapabilities: lockedProfile.selection.selectedCapabilities,
      releaseTarget: lockedProfile.selection.releaseTarget,
      executionPlanSha256: lockedExecutionPlan.sha256,
      buildEnvironmentSha256: buildEnvironmentSource === null ? null : sha256(buildEnvironmentSource),
      publicEnvironmentSha256,
    } : null,
  }
}
let selectedEntries = runAll
  ? lockedProfile
    ? [
        ...[...new Map(
          [...activeAdapterEntries]
            .sort((left, right) => {
              const providerIndex = definition => lockedExecutionPlan.plan.nodes.findIndex(node =>
                node.provides.includes(definition.evidenceCapability),
              )
              return providerIndex(left[1]) - providerIndex(right[1])
            })
            .map(([id, definition]) => [definition.receiptId, [id, definition]]),
        ).values()],
        ...['coverage', 'audit'].map(id => [id, BASE_CHECKS.get(id)]),
      ]
    : [...BASE_CHECKS]
  : [[selectedCheck, checks.get(selectedCheck)]]
if (
  runAll &&
  runtimeDataContract &&
  !selectedEntries.some(([id, definition]) => (definition.receiptId ?? id) === INGESTION_RECEIPT_ID)
) {
  selectedEntries.push([INGESTION_RECEIPT_ID, FALLBACK_INGESTION_CHECK])
}
if (runAll) {
  const ingestionIndex = selectedEntries.findIndex(
    ([id, definition]) => (definition.receiptId ?? id) === INGESTION_RECEIPT_ID,
  )
  if (ingestionIndex >= 0) selectedEntries.push(...selectedEntries.splice(ingestionIndex, 1))
}
const qualityCohortId = randomUUID()
const receipts = selectedEntries.map(([id, definition]) => executeCheck(id, definition))
const dependencyBindingAtEnd = readDependencyBinding(projectRoot, packageJson)
if (JSON.stringify(dependencyBindingAtEnd) !== JSON.stringify(dependencyBindingAtStart)) {
  for (const receipt of receipts) {
    receipt.status = 'FAIL'
    receipt.blockedReason = 'Quality command changed the installed dependency graph binding'
  }
}
const sourceFingerprint = computeSourceFingerprint(projectRoot, {
  excludePaths: lockedProfile?.selection.artifacts.map(artifact => artifact.path) ?? [],
})

for (const receipt of receipts) {
  receipt.sourceFingerprint = sourceFingerprint
  receipt.qualityCohortId = qualityCohortId
  receipt.runMode = runAll ? 'all' : 'single'
  receipt.completedAt = new Date().toISOString()
  const receiptPath = join(evidenceDirectory, `${receipt.id}.json`)
  const temporaryReceiptPath = join(evidenceDirectory, `.${receipt.id}.${qualityCohortId}.tmp`)
  try {
    writeFileSync(temporaryReceiptPath, `${JSON.stringify(receipt, null, 2)}\n`, {flag: 'wx', mode: 0o600})
    renameSync(temporaryReceiptPath, receiptPath)
  } finally {
    rmSync(temporaryReceiptPath, {force: true})
  }
  process.stdout.write(`${receipt.id}: ${receipt.status} (${receipt.command})\n`)
  if (receipt.blockedReason) process.stderr.write(`${receipt.id}: ${receipt.blockedReason}\n`)
}

rmSync(sandboxHome, {recursive: true, force: true})
if (receipts.some(receipt => receipt.status !== 'PASS')) process.exit(1)
