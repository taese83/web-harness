import {existsSync, lstatSync, readFileSync, readdirSync} from 'node:fs'
import {join} from 'node:path'
import {analyzePackageScript, hasMeaningfulProfileScript} from '../quality-policy-lib.mjs'
import {validateVercelProjectConfig} from '../web-core/vercel-config-lib.mjs'
import {inspectWorkflowSecurity} from './validate-workflows-and-evals.mjs'
import {
  adapterCheckBindings,
  readLockedExecutionPlan,
  validateLockedProjectProfile,
} from '../web-core/profile-policy-lib.mjs'

const requiredHybridFiles = [
  '.env.example',
  '.gitignore',
  '.nvmrc',
  'README.md',
  '_workspace/01_plan/project-profile.json',
  '_workspace/03_dev/web-execution-plan.json',
  'api/_lib/guard.ts',
  'api/health.ts',
  'api/notes.ts',
  'e2e/app.spec.ts',
  'package.json',
  'playwright.config.ts',
  'pnpm-lock.yaml',
  'tests/api.guards.test.ts',
  'tests/api.loopback.test.ts',
  'tests/api.unit.test.ts',
  'tests/production-boundary.ts',
  '_workspace/04_qa/qa-api-contract.md',
  '_workspace/04_qa/qa-browser.md',
  '_workspace/04_qa/qa-code.md',
  '_workspace/04_qa/qa-integration.md',
  '_workspace/04_qa/qa-security.md',
  '_workspace/04_qa/qa-test.md',
  '_workspace/04_qa/qa-ux.md',
  'vercel.json',
  'vite.config.ts',
]

// react-vite-spa 골든의 구조 하한 — 현 체크인 상태(5/7 로컬 검증)에 calibrate한 존재 검사다(G2).
// hybrid처럼 locked profile·adapter 결속까지 검사하는 심화는 해당 골든이 T1 준비에 들어갈 때 확장한다.
const requiredSpaFiles = [
  'README.md',
  'e2e',
  'eslint.config.js',
  'index.html',
  'package.json',
  'playwright.config.ts',
  'pnpm-lock.yaml',
  'src',
  'tsconfig.json',
  'vite.config.ts',
]

export const validateGoldenProfiles = ({repositoryRoot, pass, fail}) => {
  const goldenRoot = join(repositoryRoot, 'golden')
  if (!existsSync(goldenRoot)) return

  // next-app-fullstack 골든은 아직 없다 — 부재는 여기서 fail이 아니라 백필 대상이다
  // (G3 grandfather, docs/production-hardening-plan.md Pillar D). 체크인되면 검사를 추가한다.
  const spaProfileId = 'react-vite-spa'
  const spaRoot = join(goldenRoot, spaProfileId)
  if (!existsSync(spaRoot) || !lstatSync(spaRoot).isDirectory()) {
    fail(`golden profile is missing: golden/${spaProfileId}`)
  } else {
    for (const relativePath of requiredSpaFiles) {
      if (!existsSync(join(spaRoot, relativePath))) {
        fail(`golden/${spaProfileId}: required file is missing: ${relativePath}`)
      }
    }
    pass(`golden ${spaProfileId} structure checked`)
  }

  const profileId = 'vite-serverless-hybrid'
  const projectRoot = join(goldenRoot, profileId)
  if (!existsSync(projectRoot) || !lstatSync(projectRoot).isDirectory()) {
    fail(`golden profile is missing: golden/${profileId}`)
    return
  }
  for (const relativePath of requiredHybridFiles) {
    if (!existsSync(join(projectRoot, relativePath))) {
      fail(`golden/${profileId}: required file is missing: ${relativePath}`)
    }
  }

  let packageJson
  let lockedProfile
  try {
    packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'))
    lockedProfile = validateLockedProjectProfile(JSON.parse(
      readFileSync(join(projectRoot, '_workspace/01_plan/project-profile.json'), 'utf8'),
    ))
    readLockedExecutionPlan(
      join(projectRoot, '_workspace/03_dev/web-execution-plan.json'),
      lockedProfile,
    )
  } catch (error) {
    fail(`golden/${profileId}: locked profile or execution plan is stale: ${error instanceof Error ? error.message : String(error)}`)
    return
  }

  const declarations = {...packageJson.dependencies, ...packageJson.devDependencies}
  for (const [name, version] of Object.entries(declarations)) {
    if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
      fail(`golden/${profileId}: dependency must be exact: ${name}`)
    }
  }
  if (packageJson.packageManager !== 'pnpm@11.18.0' || packageJson.engines?.node !== '>=22 <23') {
    fail(`golden/${profileId}: Node/pnpm pins drifted from the locked profile`)
  }
  const lockedDeclarations = lockedProfile.profile.toolchain.packageDeclarations
  for (const [name, version] of Object.entries(lockedDeclarations)) {
    if (declarations[name] !== version) fail(`golden/${profileId}: locked package declaration is stale: ${name}`)
  }

  for (const binding of adapterCheckBindings({
    adapter: lockedProfile.adapter,
    deploymentProvider: lockedProfile.selection.provider.id,
    deploymentTarget: lockedProfile.selection.target.id,
    capabilities: lockedProfile.selection.selectedCapabilities,
  })) {
    const command = lockedProfile.adapter.commands.find(candidate => candidate.id === binding.commandId)
    const scriptName = command?.executable === 'pnpm' && command.args[0] === 'run' ? command.args[1] : null
    const source = scriptName ? packageJson.scripts?.[scriptName] : null
    const definition = {kind: binding.kind}
    if (!scriptName || typeof source !== 'string' || !hasMeaningfulProfileScript(binding.id, definition, source, analyzePackageScript(source))) {
      fail(`golden/${profileId}: adapter script is missing or semantically trivial: ${binding.id}`)
    }
  }

  const vercel = validateVercelProjectConfig({projectRoot, lockedProfile})
  for (const error of vercel.errors) fail(`golden/${profileId}: ${error}`)

  const ignore = readFileSync(join(projectRoot, '.gitignore'), 'utf8')
  for (const marker of ['.env', '.env.*', '!.env.example', 'node_modules/', '_workspace/04_qa/evidence/']) {
    if (!ignore.includes(marker)) fail(`golden/${profileId}: .gitignore is missing ${marker}`)
  }
  const guardTest = readFileSync(join(projectRoot, 'tests/api.guards.test.ts'), 'utf8')
  const handlers = readdirSync(join(projectRoot, 'api'), {withFileTypes: true})
    .filter(entry => entry.isFile() && entry.name.endsWith('.ts'))
    .map(entry => entry.name)
  for (const handler of handlers) {
    if (!guardTest.includes(handler)) fail(`golden/${profileId}: guard matrix omits ${handler}`)
  }
  const readme = readFileSync(join(projectRoot, 'README.md'), 'utf8')
  for (const marker of [profileId, 'T0', 'T1', 'T2', 'certified']) {
    if (!readme.includes(marker)) fail(`golden/${profileId}: README honesty contract is missing ${marker}`)
  }
  const runner = readFileSync(join(repositoryRoot, '.claude/scripts/run-golden-profile.mjs'), 'utf8')
  for (const marker of [
    'mkdtempSync',
    '--allow-host-execution',
    '--write-evidence',
    '--verify-t1',
    'run-quality-gates.mjs',
    'validateIsolatedCohort',
    't1-summary.json',
  ]) {
    if (!runner.includes(marker)) fail(`golden runner is missing ${marker}`)
  }

  const t1ValidatorPath = join(repositoryRoot, '.claude/scripts/validate-isolated-cohort.mjs')
  if (!existsSync(t1ValidatorPath)) {
    fail('isolated cohort validator is missing: .claude/scripts/validate-isolated-cohort.mjs')
  } else {
    const t1Validator = readFileSync(t1ValidatorPath, 'utf8')
    for (const marker of [
      'isolated-ci-declared',
      'ISOLATED_VERIFIED',
      'declaredRevision',
      'execution-time dependency graph binding is invalid',
      'every T1 QA report must be PASS',
      'T1_EVIDENCE_INVALID',
    ]) {
      if (!t1Validator.includes(marker)) fail(`isolated cohort validator is missing ${marker}`)
    }
  }

  const proposalPath = join(repositoryRoot, '.claude/ci/hybrid-t1.yml')
  if (!existsSync(proposalPath)) {
    fail('hybrid T1 CI proposal is missing: .claude/ci/hybrid-t1.yml')
  } else {
    const proposal = readFileSync(proposalPath, 'utf8')
    const findings = inspectWorkflowSecurity({
      source: proposal,
      workflowPath: '.github/workflows/hybrid-t1.yml',
    })
    for (const finding of findings) {
      fail(`hybrid T1 CI proposal: [${finding.code}] ${finding.message}`)
    }
    for (const marker of [
      'workflow_dispatch:',
      'environment: hybrid-t1-audit',
      'web-harness-isolated',
      "WEB_HARNESS_ISOLATED_EXECUTION: '1'",
      'run-package-operation.mjs --project golden/vite-serverless-hybrid --operation install',
      'run-golden-profile.mjs --profile vite-serverless-hybrid --write-evidence --verify-t1 --expected-revision',
      'actions/upload-artifact@c6a3b2bd78b3985e4b2f15397fec357f0fd808de',
      'if-no-files-found: error',
      'retention-days: 7',
    ]) {
      if (!proposal.includes(marker)) fail(`hybrid T1 CI proposal is missing ${marker}`)
    }
    if (proposal.includes('--allow-host-execution')) {
      fail('hybrid T1 CI proposal must not downgrade to host execution')
    }
  }

  pass(`golden ${profileId} profile, DAG, scripts, guards, and provider contract checked`)
}
