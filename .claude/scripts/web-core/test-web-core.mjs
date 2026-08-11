#!/usr/bin/env node

import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {BUILTIN_ADAPTER_IDS, claudeDirectory, loadBuiltinAdapter, loadBuiltinAdapters, validateAdapter} from './adapter-lib.mjs'
import {readJson, stableStringify, WebCoreError} from './core-lib.mjs'
import {checkCapabilityDag, compileCapabilityDag} from './dag-lib.mjs'
import {inspectExternalIngestion} from './ingestion-detection-lib.mjs'
import {resolveProjectProfile} from './profile-lib.mjs'
import {
  adapterCheckBindings,
  adapterSha256,
  projectProfileSha256,
  validateLockedExecutionPlan,
  validateLockedProfileProjectState,
  validateLockedProjectProfile,
} from './profile-policy-lib.mjs'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const fixtureDirectory = resolve(scriptDirectory, '../../evals/web-core-fixtures')
let assertions = 0
const check = (condition, message) => {
  assertions += 1
  assert.ok(condition, message)
}

for (const name of ['adapter', 'project-profile', 'execution-plan']) {
  const schemaPath = join(claudeDirectory, 'schemas', 'web-core', `${name}.schema.json`)
  check(existsSync(schemaPath), `schema must exist: ${name}`)
  check(readJson(schemaPath).$schema === 'https://json-schema.org/draft/2020-12/schema', `schema must use draft 2020-12: ${name}`)
}

const adapters = loadBuiltinAdapters()
check(adapters.length === 3, 'exactly three built-in profiles are supported')
check(BUILTIN_ADAPTER_IDS.join(',') === 'next-app-fullstack,react-vite-spa,vite-serverless-hybrid', 'built-in profile ids are stable and sorted')
for (const adapter of adapters) {
  check(validateAdapter(adapter, {expectedId: adapter.id}).length === 0, `${adapter.id} manifest must validate`)
  check(adapter.trust.commandPolicy === 'argv-only', `${adapter.id} commands must be argv-only`)
  check(adapter.commands.every(command => !Object.hasOwn(command, 'command') && !Object.hasOwn(command, 'shell')), `${adapter.id} must not contain shell command strings`)
  const first = compileCapabilityDag(adapter)
  const second = compileCapabilityDag(adapter)
  check(stableStringify(first) === stableStringify(second), `${adapter.id} DAG compilation must be deterministic`)
  check(first.executionOrder.length === first.nodes.length, `${adapter.id} DAG must contain every selected node once`)
  const positions = new Map(first.executionOrder.map((id, index) => [id, index]))
  check(first.edges.every(edge => positions.get(edge.from) < positions.get(edge.to)), `${adapter.id} DAG must be acyclic and topologically ordered`)
  check(checkCapabilityDag(adapter).taskCount === adapter.tasks.length, `${adapter.id} full graph must be acyclic`)
}

const expected = readJson(join(fixtureDirectory, 'expected.json'))
for (const fixture of expected.profiles) {
  const profile = resolveProjectProfile({
    projectRoot: join(fixtureDirectory, fixture.fixture),
    requested: fixture.requested,
    adapters,
    includeAncestorIngestion: false,
  })
  check(profile.profileId === fixture.expectedProfile, `${fixture.fixture} profile must resolve`)
  check(profile.resolution.source === fixture.expectedSource, `${fixture.fixture} resolution source must match`)
  check(profile.adapter.sha256 === adapterSha256(loadBuiltinAdapter(profile.profileId)), `${fixture.fixture} adapter hash must be locked`)
}
for (const fixture of expected.errors) {
  let caught
  try {
    resolveProjectProfile({
      projectRoot: join(fixtureDirectory, fixture.fixture),
      requested: fixture.requested,
      adapters,
      includeAncestorIngestion: false,
    })
  } catch (error) {
    caught = error
  }
  check(caught instanceof WebCoreError && caught.code === fixture.expectedCode, `${fixture.fixture} must fail with ${fixture.expectedCode}`)
}

const defaultNextProfile = resolveProjectProfile({
  projectRoot: join(fixtureDirectory, 'projects/next-app'),
  requested: 'auto',
  adapters,
  includeAncestorIngestion: false,
})
check(!defaultNextProfile.capabilities.includes('auth'), 'Next default profile must not enable authentication without a requirement')
check(defaultNextProfile.risk.level === 'public', 'Next default profile risk must follow enabled capabilities')
const lockedDefaultNext = validateLockedProjectProfile(defaultNextProfile)
const defaultNextBindings = adapterCheckBindings({
  adapter: lockedDefaultNext.adapter,
  deploymentTarget: lockedDefaultNext.selection.target.id,
  capabilities: lockedDefaultNext.selection.selectedCapabilities,
})
const defaultNextPlan = compileCapabilityDag(lockedDefaultNext.adapter, [
  lockedDefaultNext.selection.releaseTarget,
  ...defaultNextBindings.map(binding => binding.evidenceCapability),
])
defaultNextPlan.profileBinding = {
  adapterSha256: defaultNextProfile.adapter.sha256,
  profileSha256: projectProfileSha256(defaultNextProfile),
  deploymentProvider: lockedDefaultNext.selection.provider.id,
  deploymentTarget: lockedDefaultNext.selection.target.id,
  selectedCapabilities: lockedDefaultNext.selection.selectedCapabilities,
}
check(!defaultNextPlan.executionOrder.some(id => id.includes('authz')), 'Next default execution plan must exclude auth-only checks')
check(validateLockedExecutionPlan(defaultNextPlan, lockedDefaultNext).sha256.length === 64, 'bound execution plan must validate and hash deterministically')

const hybridProfile = resolveProjectProfile({
  projectRoot: join(fixtureDirectory, 'projects/react-vite-hybrid'),
  requested: 'auto',
  adapters,
  includeAncestorIngestion: false,
})
check(hybridProfile.deployment.provider === 'vercel', 'hybrid profile must default to the vercel provider')
check(hybridProfile.deployment.target === 'vercel-hybrid', 'hybrid profile must bind the vercel-hybrid target')
check(hybridProfile.deployment.releaseTarget === 'release.vercel-hybrid', 'hybrid profile must bind its release target')
check(hybridProfile.capabilities.includes('serverless-functions'), 'hybrid default capabilities must include serverless functions')
check(!hybridProfile.capabilities.includes('auth'), 'hybrid default profile must not enable authentication without a requirement')
check(hybridProfile.risk.level === 'public', 'hybrid default risk must follow enabled capabilities')
const lockedHybrid = validateLockedProjectProfile(hybridProfile)
const hybridBindings = adapterCheckBindings({
  adapter: lockedHybrid.adapter,
  deploymentTarget: lockedHybrid.selection.target.id,
  capabilities: lockedHybrid.selection.selectedCapabilities,
})
check(hybridBindings.some(binding => binding.id === 'api.guards' && binding.kind === 'security'), 'hybrid profile must require endpoint guard evidence')
check(hybridBindings.some(binding => binding.id === 'api.unit'), 'hybrid profile must require serverless handler unit evidence')
const hybridPlan = compileCapabilityDag(lockedHybrid.adapter, [
  lockedHybrid.selection.releaseTarget,
  ...hybridBindings.map(binding => binding.evidenceCapability),
])
hybridPlan.profileBinding = {
  adapterSha256: hybridProfile.adapter.sha256,
  profileSha256: projectProfileSha256(hybridProfile),
  deploymentProvider: lockedHybrid.selection.provider.id,
  deploymentTarget: lockedHybrid.selection.target.id,
  selectedCapabilities: lockedHybrid.selection.selectedCapabilities,
}
check(validateLockedExecutionPlan(hybridPlan, lockedHybrid).sha256.length === 64, 'hybrid execution plan must validate and hash deterministically')

const ingestionFixture = mkdtempSync(join(tmpdir(), 'web-harness-ingestion-profile-'))
try {
  mkdirSync(join(ingestionFixture, 'src'), {recursive: true})
  mkdirSync(join(ingestionFixture, 'scripts'), {recursive: true})
  mkdirSync(join(ingestionFixture, '_workspace/02_design'), {recursive: true})
  writeFileSync(join(ingestionFixture, 'package.json'), `${JSON.stringify({
    packageManager: 'pnpm@11.18.0',
    engines: {node: '>=22.22.0'},
    scripts: {crawl: 'tsx scripts/crawl.ts', 'validate:ingestion': 'node scripts/validate-ingestion.mjs'},
    dependencies: {react: '19.1.1'},
    devDependencies: {vite: '7.1.3'},
  })}\n`)
  writeFileSync(join(ingestionFixture, 'vite.config.ts'), 'export default {}\n')
  writeFileSync(join(ingestionFixture, 'src/main.tsx'), 'export {}\n')
  writeFileSync(join(ingestionFixture, 'scripts/crawl.ts'), 'export {}\n')
  writeFileSync(join(ingestionFixture, '_workspace/02_design/ingestion-contract.md'), '# Ingestion Contract\n')
  writeFileSync(join(ingestionFixture, '_workspace/02_design/runtime-data-contract.json'), `${JSON.stringify({
    $schema: '.claude/schemas/runtime-data-contract.schema.json',
    schemaVersion: 1,
    mode: 'static-snapshot',
    authoritativeSource: 'fixture-source',
    buildCwd: '.',
    deploymentRoot: '.',
    generatedArtifacts: [{
      path: 'public/data.json',
      required: true,
      schema: 'schemas/data.schema.json',
      minCount: 1,
      validation: {diff: {baselinePath: 'public/last-known-good.json', maximumCountDropRatio: 0.25}},
    }],
    freshnessSlo: 'PT24H',
    promotionPolicy: 'reject-invalid',
    servingFallback: 'last-known-good',
    refreshCapabilities: ['manual-recovery', 'scheduled'],
  })}\n`)

  const ingestionProfile = resolveProjectProfile({
    projectRoot: ingestionFixture,
    requested: 'auto',
    deploymentProvider: 'vercel',
    adapters,
  })
  check(ingestionProfile.deployment.provider === 'vercel', 'Vercel provider must be locked separately from the runtime target')
  check(ingestionProfile.deployment.target === 'static-cdn', 'Vercel React/Vite must retain the static-cdn runtime target')
  check(ingestionProfile.capabilities.includes('external-ingestion'), 'detected ingestion must lock external-ingestion')
  check(ingestionProfile.capabilities.includes('scheduled-static-ingestion'), 'scheduled static ingestion must lock its narrow capability')
  const ingestionBindings = adapterCheckBindings({
    adapter: loadBuiltinAdapter('react-vite-spa'),
    deploymentProvider: ingestionProfile.deployment.provider,
    deploymentTarget: ingestionProfile.deployment.target,
    capabilities: ingestionProfile.capabilities,
  })
  check(ingestionBindings.some(binding => binding.receiptId === 'ingestion'), 'ingestion capability must require a machine receipt')

  const downgradedProfile = JSON.parse(JSON.stringify(ingestionProfile))
  downgradedProfile.capabilities = downgradedProfile.capabilities.filter(capability =>
    !['external-ingestion', 'scheduled-static-ingestion'].includes(capability),
  )
  let staleIngestionCapabilities
  try {
    validateLockedProfileProjectState(validateLockedProjectProfile(downgradedProfile), ingestionFixture)
  } catch (error) {
    staleIngestionCapabilities = error
  }
  check(
    staleIngestionCapabilities instanceof WebCoreError &&
      staleIngestionCapabilities.code === 'PROJECT_PROFILE_INGESTION_CAPABILITY_STALE',
    'locked profiles must not omit ingestion capabilities added after profile resolution',
  )

  let omittedIngestionCapability
  try {
    resolveProjectProfile({
      projectRoot: ingestionFixture,
      requested: 'react-vite-spa',
      capabilities: ['client-routing', 'csr', 'static-build'],
      adapters,
    })
  } catch (error) {
    omittedIngestionCapability = error
  }
  check(
    omittedIngestionCapability instanceof WebCoreError && omittedIngestionCapability.code === 'INGESTION_CAPABILITY_REQUIRED',
    'explicit capabilities must not omit detected ingestion',
  )

  rmSync(join(ingestionFixture, '_workspace/02_design/runtime-data-contract.json'))
  let missingIngestionContract
  try {
    resolveProjectProfile({projectRoot: ingestionFixture, requested: 'auto', adapters})
  } catch (error) {
    missingIngestionContract = error
  }
  check(
    missingIngestionContract instanceof WebCoreError && missingIngestionContract.code === 'INGESTION_CONTRACT_MISSING',
    'crawler markers without both contracts must fail closed',
  )
} finally {
  rmSync(ingestionFixture, {recursive: true, force: true})
}

const catalogRefreshFixture = mkdtempSync(join(tmpdir(), 'web-harness-catalog-refresh-'))
try {
  writeFileSync(join(catalogRefreshFixture, 'package.json'), `${JSON.stringify({
    scripts: {'update:catalog': 'node tools/fetch-catalog.mjs'},
  })}\n`)
  const inspection = inspectExternalIngestion(catalogRefreshFixture)
  check(
    inspection.detected && inspection.evidence.includes('package-script:update:catalog'),
    'catalog update/fetch scripts must not evade external ingestion detection',
  )
  writeFileSync(join(catalogRefreshFixture, 'package.json'), `${JSON.stringify({
    scripts: {'pull:catalog': 'node tools/pull.mjs'},
  })}\n`)
  check(
    inspectExternalIngestion(catalogRefreshFixture).evidence.includes('package-script:pull:catalog'),
    'catalog pull scripts must not evade external ingestion detection',
  )
  mkdirSync(join(catalogRefreshFixture, 'tools'), {recursive: true})
  writeFileSync(join(catalogRefreshFixture, 'tools/opaque.mjs'), "await fetch('https://example.invalid/catalog')\n")
  writeFileSync(join(catalogRefreshFixture, 'package.json'), `${JSON.stringify({
    scripts: {maintain: 'node tools/opaque.mjs'},
  })}\n`)
  check(
    inspectExternalIngestion(catalogRefreshFixture).evidence.includes('network-source:tools/opaque.mjs'),
    'bounded Node network sources must not rely only on ingestion naming heuristics',
  )
  mkdirSync(join(catalogRefreshFixture, 'jobs'), {recursive: true})
  writeFileSync(join(catalogRefreshFixture, 'jobs/opaque.mjs'), "const request = globalThis.fetch; await request('https://example.invalid/catalog')\n")
  check(
    inspectExternalIngestion(catalogRefreshFixture).evidence.includes('network-source:jobs/opaque.mjs'),
    'common first-party jobs and fetch aliases must be included in the bounded network scan',
  )
} finally {
  rmSync(catalogRefreshFixture, {recursive: true, force: true})
}

const oversizedPackageFixture = mkdtempSync(join(tmpdir(), 'web-harness-oversized-package-'))
try {
  writeFileSync(join(oversizedPackageFixture, 'package.json'), `${JSON.stringify({
    scripts: {'pull:catalog': 'node opaque.mjs'},
    padding: 'x'.repeat(2 * 1024 * 1024),
  })}\n`)
  const inspection = inspectExternalIngestion(oversizedPackageFixture)
  check(
    inspection.detected &&
      inspection.evidence.includes('uninspectable-package:package.json') &&
      inspection.errors.length > 0,
    'an oversized security-relevant package manifest must fail closed',
  )
} finally {
  rmSync(oversizedPackageFixture, {recursive: true, force: true})
}

const splitRootFixture = mkdtempSync(join(tmpdir(), 'web-harness-split-root-'))
try {
  mkdirSync(join(splitRootFixture, '.git'))
  writeFileSync(join(splitRootFixture, '.git/HEAD'), 'ref: refs/heads/main\n')
  writeFileSync(join(splitRootFixture, '.git/config'), '[core]\n\trepositoryformatversion = 0\n')
  mkdirSync(join(splitRootFixture, 'client'))
  writeFileSync(join(splitRootFixture, 'package.json'), `${JSON.stringify({
    scripts: {'pull:catalog': 'node tools/pull.mjs'},
  })}\n`)
  writeFileSync(join(splitRootFixture, 'client/package.json'), '{}\n')
  const splitInspection = inspectExternalIngestion(join(splitRootFixture, 'client'))
  check(
    splitInspection.errors.some(error => error.includes('above the selected project root')),
    'a nested app must not hide ancestor ingestion from the canonical release boundary',
  )
  mkdirSync(join(splitRootFixture, 'client/.git'))
  check(
    inspectExternalIngestion(join(splitRootFixture, 'client')).errors.some(error => error.includes('above the selected project root')),
    'an untrusted nested .git marker must not suppress ancestor ingestion detection',
  )
  mkdirSync(join(splitRootFixture, 'apps/.claude/web'), {recursive: true})
  writeFileSync(join(splitRootFixture, 'apps/.claude/web/package.json'), '{}\n')
  check(
    inspectExternalIngestion(join(splitRootFixture, 'apps/.claude/web')).errors.some(error => error.includes('above the selected project root')),
    'a path segment named .claude must not disable ancestor ingestion inspection',
  )
  const aliasContainer = mkdtempSync(join(tmpdir(), 'web-harness-split-root-alias-'))
  symlinkSync(join(splitRootFixture, 'client'), join(aliasContainer, 'client'))
  check(
    inspectExternalIngestion(join(aliasContainer, 'client')).errors.some(error => error.includes('above the selected project root')),
    'a symlink alias must be canonicalized before ancestor ingestion inspection',
  )
  rmSync(aliasContainer, {recursive: true, force: true})
} finally {
  rmSync(splitRootFixture, {recursive: true, force: true})
}

const invalidCommandAdapter = JSON.parse(JSON.stringify(loadBuiltinAdapter('react-vite-spa')))
invalidCommandAdapter.commands[0] = {
  id: 'dependencies.install',
  executable: 'sh',
  args: ['-c', 'pnpm install'],
  cwd: '.',
}
const commandErrors = validateAdapter(invalidCommandAdapter, {expectedId: invalidCommandAdapter.id})
check(commandErrors.some(message => message.includes('not allowlisted')), 'non-allowlisted shell executables must be rejected')

const selfAllowlistedShellAdapter = JSON.parse(JSON.stringify(loadBuiltinAdapter('react-vite-spa')))
selfAllowlistedShellAdapter.trust.allowedExecutables = ['sh']
selfAllowlistedShellAdapter.commands[0] = {id: 'dependencies.install', executable: 'sh', args: ['-c', 'true'], cwd: '.'}
check(
  validateAdapter(selfAllowlistedShellAdapter, {expectedId: selfAllowlistedShellAdapter.id}).some(message => message.includes('only pnpm')),
  'built-in adapters must not expand their own executable trust boundary',
)

const unsafeEnvironmentAdapter = JSON.parse(JSON.stringify(loadBuiltinAdapter('react-vite-spa')))
unsafeEnvironmentAdapter.trust.environmentAllowlist.push('AWS_SECRET_ACCESS_KEY')
check(
  validateAdapter(unsafeEnvironmentAdapter, {expectedId: unsafeEnvironmentAdapter.id}).some(message => message.includes('unsafe key')),
  'adapter environment allowlists must reject secret-bearing host variables',
)

const unsafePnpmAdapter = JSON.parse(JSON.stringify(loadBuiltinAdapter('react-vite-spa')))
unsafePnpmAdapter.commands[0].args = ['exec', 'sh', '-c', 'true']
check(
  validateAdapter(unsafePnpmAdapter, {expectedId: unsafePnpmAdapter.id}).some(message => message.includes('bounded pnpm contract')),
  'adapter commands must reject arbitrary pnpm subcommands',
)

const cyclicAdapter = JSON.parse(JSON.stringify(loadBuiltinAdapter('react-vite-spa')))
cyclicAdapter.tasks = [
  {id: 'cycle.first', phase: 'plan', requires: ['cycle.second-ready'], provides: ['cycle.first-ready'], commandIds: []},
  {id: 'cycle.second', phase: 'plan', requires: ['cycle.first-ready'], provides: ['cycle.second-ready'], commandIds: []},
]
cyclicAdapter.initialCapabilities = []
cyclicAdapter.targetCapabilities = ['cycle.first-ready']
let cycleError
try {
  compileCapabilityDag(cyclicAdapter)
} catch (error) {
  cycleError = error
}
check(cycleError instanceof WebCoreError && cycleError.code === 'DAG_CYCLE', 'cyclic capability graphs must be rejected')

let staticConflict
try {
  resolveProjectProfile({
    projectRoot: join(fixtureDirectory, 'projects/unknown'),
    requested: 'next-app-fullstack',
    deploymentTarget: 'static-export',
    adapters,
    includeAncestorIngestion: false,
  })
} catch (error) {
  staticConflict = error
}
check(staticConflict instanceof WebCoreError && staticConflict.code === 'DEPLOYMENT_CAPABILITY_CONFLICT', 'static export must reject default full-stack capabilities')
let providerConflict
try {
  resolveProjectProfile({
    projectRoot: join(fixtureDirectory, 'projects/unknown'),
    requested: 'next-app-fullstack',
    deploymentProvider: 'vercel',
    deploymentTarget: 'docker-standalone',
    adapters,
    includeAncestorIngestion: false,
  })
} catch (error) {
  providerConflict = error
}
check(
  providerConflict instanceof WebCoreError && providerConflict.code === 'NEXT_DOCKER_OCI_EVIDENCE_BROKER_REQUIRED' ||
    providerConflict instanceof WebCoreError && providerConflict.code === 'DEPLOYMENT_PROVIDER_TARGET_CONFLICT',
  'Vercel provider must reject the Docker standalone target',
)
const staticProfile = resolveProjectProfile({
  projectRoot: join(fixtureDirectory, 'projects/unknown'),
  requested: 'next-app-fullstack',
  deploymentTarget: 'static-export',
  capabilities: ['app-router', 'rsc', 'ssg', 'static-get-route-handler'],
  adapters,
  includeAncestorIngestion: false,
})
check(staticProfile.deployment.releaseTarget === 'release.static-export', 'static profile must bind its release target')
const staticBindings = adapterCheckBindings({
  adapter: loadBuiltinAdapter('next-app-fullstack'),
  deploymentTarget: staticProfile.deployment.target,
  capabilities: staticProfile.capabilities,
})
check(!staticBindings.some(binding => binding.id.includes('authz') || binding.id.includes('cache-isolation')), 'static profile must exclude auth and cache checks')
check(staticBindings.some(binding => binding.id === 'next.export-artifact'), 'static profile must require export artifact evidence')

const runScript = (name, args = []) => spawnSync(
  process.execPath,
  [join(scriptDirectory, name), ...args],
  {cwd: resolve(claudeDirectory, '..'), encoding: 'utf8'},
)
const validationRun = runScript('validate-adapters.mjs')
check(validationRun.status === 0 && JSON.parse(validationRun.stdout).adapterCount === 3, 'adapter validation CLI must pass')
const cliProfileFixture = mkdtempSync(join(tmpdir(), 'web-harness-profile-cli-'))
cpSync(join(fixtureDirectory, 'projects/next-app'), cliProfileFixture, {recursive: true})
const resolutionRun = runScript('resolve-profile.mjs', [
  '--project-root',
  cliProfileFixture,
  '--requested',
  'auto',
])
check(resolutionRun.status === 0 && JSON.parse(resolutionRun.stdout).profileId === 'next-app-fullstack', 'profile resolution CLI must detect Next App Router')
rmSync(cliProfileFixture, {recursive: true, force: true})
const compilationRun = runScript('compile-execution-plan.mjs', ['--profile', 'react-vite-spa'])
check(compilationRun.status === 0 && JSON.parse(compilationRun.stdout).executionOrder.at(-1) === 'release.assemble', 'execution plan CLI must compile a release DAG')
const hybridCompilationRun = runScript('compile-execution-plan.mjs', ['--profile', 'vite-serverless-hybrid'])
check(hybridCompilationRun.status === 0 && JSON.parse(hybridCompilationRun.stdout).executionOrder.at(-1) === 'release.assemble', 'hybrid execution plan CLI must compile a release DAG')
const rejectedRun = runScript('compile-execution-plan.mjs', ['--profile', 'unknown-profile'])
check(rejectedRun.status === 1 && JSON.parse(rejectedRun.stderr).error.code === 'UNKNOWN_PROFILE', 'CLI failures must be structured and deterministic')

process.stdout.write(stableStringify({ok: true, assertions, profiles: BUILTIN_ADAPTER_IDS}))
