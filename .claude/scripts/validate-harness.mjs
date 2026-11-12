#!/usr/bin/env node
// validate-harness.mjs — 하네스 저장소 전체 검사(계약·에이전트·스킬·예산·fixture). CI가 부른다.
// 사용법: node .claude/scripts/validate-harness.mjs
// 종료 코드: 0 = 통과, 1 = 오류 있음.

import {spawnSync} from 'node:child_process'
import {validateGoldenSpecDrift} from './golden-spec-drift-lib.mjs'
import {validateEntryPoints} from './validators/validate-entry-points.mjs'
import {validateProjectTemplate} from './validators/validate-project-template.mjs'
import {existsSync, readFileSync, readdirSync} from 'node:fs'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {inspectShapeCatalog} from './validate-shape-checks.mjs'
import {validateAdapterHygiene} from './validators/validate-adapter-hygiene.mjs'; import {validateAgentBoundaries} from './validators/validate-agent-boundaries.mjs'
import {validateContentPolicy} from './validators/validate-content-policy.mjs'
import {validateGoldenProfiles} from './validators/validate-golden-profiles.mjs'
import {validateHardeningSelfTests} from './validators/validate-hardening-self-tests.mjs'
import {validateMinimalChange} from './validators/validate-minimal-change.mjs'
import {orchestrationSurface} from './validators/orchestration-surface.mjs'
import {validateModularity} from './validators/validate-modularity.mjs'
import {validatePlanningFacilitation} from './validators/validate-planning-facilitation.mjs'
import {validateReleaseFixtures} from './validators/validate-release-fixtures.mjs'; import {validateSchemaParity} from './validators/validate-schema-parity.mjs'
import {validateSettings} from './validators/validate-settings.mjs'
import {RESTRICTED_BASH_WRITERS} from './agent-registry.mjs'
import {validateWebCoreIntegration} from './validators/validate-web-core-integration.mjs'
import {validateVisualDesign} from './validators/validate-visual-design.mjs'
import {validateWorkflowsAndEvals} from './validators/validate-workflows-and-evals.mjs'; import {validateContractHygiene} from './validators/validate-contract-hygiene.mjs'
import {validateMarkerIntegrity} from './validators/validate-marker-integrity.mjs'; import {validateCertifiedEvidence} from './validators/validate-certified-evidence.mjs'
import {validateSectionReaders} from './validators/validate-section-readers.mjs'
import {detectSourceRepository} from './validators/validate-adapter-hygiene.mjs'
import {validateAgentReachability} from './validators/agent-reachability.mjs'
import {agentRuntimeSettingFailures, skillRuntimeSettingFailures} from './validators/validate-agent-runtime-settings.mjs'
import {RETIRED_AGENTS} from './agent-registry.mjs'
import {answerHelp} from './cli-help-lib.mjs'

answerHelp(import.meta.url)
const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const claudeDirectory = resolve(scriptDirectory, '..')
const repositoryRoot = resolve(claudeDirectory, '..')
const errors = []
const checks = []
const pass = message => checks.push(message)
const fail = message => errors.push(message)
const read = relativePath => readFileSync(join(repositoryRoot, relativePath), 'utf8')
const toolchainPreflight = spawnSync(process.execPath, [join(scriptDirectory, 'validate-toolchain.mjs')], {cwd: repositoryRoot, encoding: 'utf8'})
if (toolchainPreflight.status !== 0) {
  process.stderr.write(toolchainPreflight.stderr || toolchainPreflight.stdout || 'Toolchain preflight failed.\n'); process.exit(toolchainPreflight.status ?? 1)
}
pass('repository Node and pnpm toolchain preflight passed')
validateHardeningSelfTests({scriptDirectory, repositoryRoot, pass, fail})
validateGoldenProfiles({repositoryRoot, pass, fail})
const markdownFiles = directory =>
  readdirSync(join(repositoryRoot, directory), {withFileTypes: true})
    .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
    .map(entry => join(directory, entry.name))

const skillFiles = readdirSync(join(claudeDirectory, 'skills'), {withFileTypes: true})
  .filter(entry => entry.isDirectory())
  .map(entry => join('.claude/skills', entry.name, 'SKILL.md'))
  .filter(relativePath => existsSync(join(repositoryRoot, relativePath)))

const agentFiles = markdownFiles('.claude/agents')

const parseFrontmatter = (relativePath, source) => {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) {
    fail(`${relativePath}: YAML frontmatter is missing`)
    return {}
  }

  return Object.fromEntries(
    match[1]
      .split(/\r?\n/)
      .map(line => line.match(/^([A-Za-z][A-Za-z0-9-]*):\s*(.*)$/))
      .filter(Boolean)
      .map(([, key, value]) => [key, value.replace(/^['"]|['"]$/g, '')]),
  )
}

const seenNames = new Map()
const writableAgents = []

for (const relativePath of [...agentFiles, ...skillFiles]) {
  const source = read(relativePath)
  const frontmatter = parseFrontmatter(relativePath, source)
  const name = frontmatter.name
  const expectedName = relativePath.includes('/agents/')
    ? relativePath.split('/').at(-1).replace(/\.md$/, '')
    : relativePath.split('/').at(-2)

  if (!name) fail(`${relativePath}: frontmatter name is required`)
  if (!frontmatter.description) fail(`${relativePath}: frontmatter description is required`)
  if (name && name !== expectedName) fail(`${relativePath}: name must match ${expectedName}`)
  if (name && seenNames.has(name)) fail(`${relativePath}: duplicate name also used by ${seenNames.get(name)}`)
  if (name) seenNames.set(name, relativePath)

  if (relativePath.includes('/agents/')) {
    if (!frontmatter.tools) fail(`${relativePath}: tools must be explicitly allowlisted`)
    if (!frontmatter.model) fail(`${relativePath}: model must be explicit`)
    for (const failure of agentRuntimeSettingFailures(relativePath, frontmatter)) fail(failure)
    if (!/^[1-9]\d*$/.test(frontmatter.maxTurns ?? '')) fail(`${relativePath}: maxTurns must be a positive integer`)
    if (/\bWrite\b/.test(frontmatter.tools ?? '')) writableAgents.push(name)
    // 예외는 셸이 파일을 바꾸지 않는 typed 명령으로만 좁혀진 쓰는 에이전트뿐이다(enforce-verifier-bash · RESTRICTED_BASH_WRITERS).
    if (/\bWrite\b/.test(frontmatter.tools ?? '') && /\bBash\b/.test(frontmatter.tools ?? '') && !RESTRICTED_BASH_WRITERS.has(name)) {
      fail(`${relativePath}: writable agents must not have Bash because it bypasses path ownership hooks`)
    }
  } else {
    if (frontmatter['disable-model-invocation'] !== 'true') {
      fail(`${relativePath}: action skill must set disable-model-invocation: true`)
    }
    if (!frontmatter['allowed-tools']) fail(`${relativePath}: action skill must explicitly allowlist tools`)
    for (const failure of skillRuntimeSettingFailures(relativePath, frontmatter)) fail(failure)
  }
}
pass(`frontmatter checked for ${agentFiles.length} agents and ${skillFiles.length} skills`)

validateAgentBoundaries({
  claudeDirectory,
  repositoryRoot,
  read,
  parseFrontmatter,
  writableAgents,
  pass,
  fail,
})

const legacyAgents = [
  'lib-publish-setup',
  'project-scaffolder',
  'state-integrator',
  'test-runner',
  'version-analyst',
  ...Object.keys(RETIRED_AGENTS),
]
for (const agentName of legacyAgents) {
  if (existsSync(join(claudeDirectory, 'agents', `${agentName}.md`))) fail(`legacy agent still exists: ${agentName}`)
}
pass('legacy coordinator removal checked')

const activeMarkdown = [...agentFiles, ...skillFiles]
for (const relativePath of skillFiles) {
  const referenceDirectory = join(repositoryRoot, dirname(relativePath), 'references')
  if (!existsSync(referenceDirectory)) continue
  for (const entry of readdirSync(referenceDirectory, {withFileTypes: true})) {
    if (entry.isFile() && entry.name.endsWith('.md')) {
      activeMarkdown.push(join(dirname(relativePath), 'references', entry.name))
    }
  }
}

const activeSource = activeMarkdown.map(relativePath => `${relativePath}\n${read(relativePath)}`).join('\n')
// reachability 소스에 운영 계층(루트 CLAUDE.md 판단 게이트)을 포함한다 — governance 에이전트
// (harness-change-reviewer)의 소비자는 스킬이 아니라 운영 지침이다. 부재는 contract-hygiene가 fail.
const operatorSource = existsSync(join(repositoryRoot, 'CLAUDE.md')) ? read('CLAUDE.md') : ''
const skillSource = [operatorSource, ...activeMarkdown
  .filter(relativePath => relativePath.startsWith('.claude/skills/'))
  .map(relativePath => read(relativePath))].join('\n')

const resolveReferencePath = (sourcePath, targetPath) => {
  if (targetPath.startsWith('.claude/')) return join(repositoryRoot, targetPath)
  if (targetPath.startsWith('references/')) {
    const sourceDirectory = sourcePath.includes('/references/') ? dirname(dirname(sourcePath)) : dirname(sourcePath)
    return resolve(repositoryRoot, sourceDirectory, targetPath)
  }
  return resolve(repositoryRoot, dirname(sourcePath), targetPath)
}

for (const relativePath of activeMarkdown) {
  const source = read(relativePath)
  const fenceCount = source.match(/^```/gm)?.length ?? 0
  if (fenceCount % 2 !== 0) fail(`${relativePath}: unbalanced fenced code blocks`)

  const referenceTargets = new Set([
    ...[...source.matchAll(/Read `([^`]+\.(?:md|json))`/g)].map(match => match[1]),
    ...[...source.matchAll(/`((?:\.claude\/|(?:\.\.\/)+|references\/)[^`\r\n]+\.(?:md|json))`/g)].map(match => match[1]),
  ])
  for (const targetPath of referenceTargets) {
    if (/[{}]/.test(targetPath)) continue
    if (!existsSync(resolveReferencePath(relativePath, targetPath))) {
      fail(`${relativePath}: missing referenced file ${targetPath}`)
    }
  }
}
pass('Markdown code fences and document references checked')
validateModularity({repositoryRoot, agentFiles, skillFiles, activeMarkdown, read, pass, fail})
validateMinimalChange({repositoryRoot, read, pass, fail})

for (const agentName of legacyAgents) {
  if (activeSource.includes(agentName)) fail(`active harness still references legacy agent: ${agentName}`)
}
// 역방향 reachability(근거·규약·한계는 `validators/agent-reachability.mjs` 헤더가 canonical).
const agentNames = validateAgentReachability({agentFiles, activeMarkdown, read, pass, fail})

// 운영자 계층(CLAUDE.md)은 deploy-harness가 배포하지 않는다 — 배포된 control plane에서는
// 운영자-전용 소비 에이전트(harness-change-reviewer 등)의 참조원이 부재하므로 이 검사는
// source repo에서만 성립한다. source에서는 그대로 엄격하다.
// 알려진 과다 범위: 스킬은 배포되므로 스킬-참조 reachability는 배포본에서도 검사 가능하다.
// 실해소는 deployment.json에 운영자-전용 소비 에이전트 목록을 실어 그 목록만 면제하는 것 —
// docs/protected-core.md §4에 미해결 TODO로 등록.
const isSourceRepositoryRoot = detectSourceRepository(repositoryRoot)
if (isSourceRepositoryRoot) {
  for (const relativePath of agentFiles) {
    const agentName = relativePath.split('/').at(-1).replace(/\.md$/, '')
    if (!skillSource.includes(agentName)) fail(`${relativePath}: agent is not referenced by any skill, skill reference, or the operator layer (CLAUDE.md)`)
  }
  pass('agent reachability and legacy references checked')
} else {
  pass('legacy references checked; agent reachability is source-repo only (operator layer not deployed)')
}

validateContentPolicy({repositoryRoot, activeSource, read, pass, fail})

const projectInit = read('.claude/skills/project-init/references/checklist.md')
const projectInitSkill = read('.claude/skills/project-init/SKILL.md')
for (const requiredCopy of ['.claude/README.md', '.claude/skills', '.claude/agents', '.claude/scripts', '.claude/evals', '.claude/adapters', '.claude/schemas']) {
  if (!projectInit.includes(requiredCopy)) fail(`project-init does not copy ${requiredCopy}`)
}
for (const requiredToolchainFile of ['.node-version', '.nvmrc']) {
  if (!projectInit.includes(requiredToolchainFile)) fail(`project-init does not copy ${requiredToolchainFile}`)
}
if (!projectInit.includes('validate-toolchain.mjs')) fail('project-init does not run the toolchain preflight')
if (!projectInit.includes('.claude/settings.project.json')) {
  fail('project-init does not deploy .claude/settings.project.json as project settings')
}
if (!projectInit.includes('validate-harness.mjs')) fail('project-init does not run the harness validator')
pass('project-init dependency closure checked')

const templateSource = read('.claude/skills/project-init/assets/templates.md')
// 섹션-리더 실행 검사는 validators/validate-section-readers.mjs로 추출(400줄 한도의 §4 지시
// "실질 해소는 validator 모듈 추출"에 따름 — UI 레인 2종 대칭 검사 포함).
validateSectionReaders({claudeDirectory, repositoryRoot, read, pass, fail})

validateProjectTemplate({templateSource, pass, fail})

if (templateSource.includes('react-router-dom')) fail('project template uses removed React Router v8 react-router-dom package')
if (!/"react-router":\s*"(?:\^|~)?8\./.test(templateSource)) fail('project template does not use a React Router v8-compatible package')
if (!templateSource.includes('"node": ">=22.22.0"')) fail('project template does not satisfy the React Router v8 Node baseline')
if (templateSource.includes("@features/settings/model/store")) fail('project template imports a settings feature it does not scaffold')
if (!templateSource.includes('"workerDirectory": "./public"')) fail('project template does not configure the MSW worker directory')
if (!projectInit.includes('run-package-operation.mjs --project {app} --operation msw-init')) {
  fail('project-init does not generate the MSW browser worker through the typed package broker')
}
if (!projectInit.includes('run-package-operation.mjs --project {root} --operation lockfile')) fail('project-init does not separate lockfile review from dependency installation')
pass('Router v8 and browser Mock scaffold contracts checked')
const errorHandlingSource = read('.claude/skills/web-orchestrator/references/error-handling-patterns.md')
for (const staleRetryPattern of ['this.instance(', 'new WeakMap<object, number>()', '2 ** count']) {
  if (errorHandlingSource.includes(staleRetryPattern)) fail(`stale 429 retry pattern remains: ${staleRetryPattern}`)
}
for (const requiredRetryPattern of ['SAFE_RETRY_METHODS', 'EXPLICIT_IDEMPOTENT_METHODS', 'rateLimitRetry.enabled', 'AbortSignal']) {
  if (!errorHandlingSource.includes(requiredRetryPattern)) fail(`429 retry contract is missing ${requiredRetryPattern}`)
}
if (!templateSource.includes('waitForRetry') || !templateSource.includes('requestConfig.signal')) {
  fail('project API template does not implement cancellable 429 backoff')
}
if (!templateSource.includes('axios.isCancel(cause)')) fail('project API template normalizes cancellation as an application error')
pass('typed and cancellable 429 retry contract checked')

// 표면 = SKILL.md + Phase 참조 전부(2026-08-27 시점 로드 강등 후). 경로 하드코딩은 다음 강등에서
// 다시 눈이 먼다 — glob 정의는 `validators/orchestration-surface.mjs`가 canonical이다.
const webOrchestrationSource = [
  orchestrationSurface(repositoryRoot),
  read('.claude/skills/web-verify/SKILL.md'),
].join('\n')
for (const agentName of [
  'api-contract-verifier',
  'browser-verifier',
  'security-reviewer',
  'data-access-verifier',
]) {
  if (!webOrchestrationSource.includes(agentName)) fail(`web orchestrators do not invoke ${agentName}`)
}
pass('canonical web orchestration and dev delegation checked')

  // deploy-ci-writer는 2026-08-26에 제거됐다. 워크플로 하드닝 검사는 그 본문을 읽던
  // 검사였으므로 함께 사라진다 — 계약 산문은 skills 쪽에 남는다.
pass('deploy promotion and dependency-update contracts checked')

validateSettings({claudeDirectory, repositoryRoot, read, pass, fail})
validateWebCoreIntegration({repositoryRoot, pass, fail})
validateReleaseFixtures({claudeDirectory, repositoryRoot, pass, fail})

validateWorkflowsAndEvals({claudeDirectory, repositoryRoot, pass, fail}); validateVisualDesign({repositoryRoot, read, pass, fail}); validatePlanningFacilitation({repositoryRoot, read, pass, fail}); validateAdapterHygiene({repositoryRoot, pass, fail});
{
  const shapeCatalogErrors = inspectShapeCatalog();
  for (const message of shapeCatalogErrors) fail(message);
  if (shapeCatalogErrors.length === 0) pass('shape catalog entry keys checked (unknown keys and typed fields)');
} validateSchemaParity({repositoryRoot, pass, fail}); validateContractHygiene({repositoryRoot, pass, fail}); validateMarkerIntegrity({repositoryRoot, pass, fail}); validateCertifiedEvidence({repositoryRoot, pass, fail})

validateGoldenSpecDrift({repositoryRoot, pass, fail}); validateEntryPoints({repositoryRoot, pass, fail})

if (errors.length) {
  console.error(`Harness validation failed with ${errors.length} error(s):`)
  for (const message of errors) console.error(`- ${message}`)
  process.exitCode = 1
} else {
  console.log(`Harness validation passed (${checks.length} checks).`)
  for (const message of checks) console.log(`- ${message}`)
}
