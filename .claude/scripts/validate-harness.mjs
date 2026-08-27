#!/usr/bin/env node
import {spawnSync} from 'node:child_process'
import {existsSync, readFileSync, readdirSync} from 'node:fs'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {validateAdapterHygiene} from './validators/validate-adapter-hygiene.mjs'; import {validateAgentBoundaries} from './validators/validate-agent-boundaries.mjs'
import {validateAnalyticsBuilder} from './validators/validate-analytics-builder.mjs'
import {validateContentPolicy} from './validators/validate-content-policy.mjs'
import {validateGoldenProfiles} from './validators/validate-golden-profiles.mjs'
import {validateHardeningSelfTests} from './validators/validate-hardening-self-tests.mjs'
import {validateMinimalChange} from './validators/validate-minimal-change.mjs'
import {validateModularity} from './validators/validate-modularity.mjs'
import {validatePlanningFacilitation} from './validators/validate-planning-facilitation.mjs'
import {validateReleaseFixtures} from './validators/validate-release-fixtures.mjs'; import {validateSchemaParity} from './validators/validate-schema-parity.mjs'
import {validateSettings} from './validators/validate-settings.mjs'
import {validateWebCoreIntegration} from './validators/validate-web-core-integration.mjs'
import {validateVisualDesign} from './validators/validate-visual-design.mjs'
import {validateWorkflowsAndEvals} from './validators/validate-workflows-and-evals.mjs'; import {validateContractHygiene} from './validators/validate-contract-hygiene.mjs'
import {validateMarkerIntegrity} from './validators/validate-marker-integrity.mjs'; import {validateCertifiedEvidence} from './validators/validate-certified-evidence.mjs'
import {validateSectionReaders} from './validators/validate-section-readers.mjs'
import {detectSourceRepository} from './validators/validate-adapter-hygiene.mjs'
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
    if (!/^[1-9]\d*$/.test(frontmatter.maxTurns ?? '')) fail(`${relativePath}: maxTurns must be a positive integer`)
    if (/\bWrite\b/.test(frontmatter.tools ?? '')) writableAgents.push(name)
    if (/\bWrite\b/.test(frontmatter.tools ?? '') && /\bBash\b/.test(frontmatter.tools ?? '')) {
      fail(`${relativePath}: writable agents must not have Bash because it bypasses path ownership hooks`)
    }
  } else {
    if (frontmatter['disable-model-invocation'] !== 'true') {
      fail(`${relativePath}: action skill must set disable-model-invocation: true`)
    }
    if (!frontmatter['allowed-tools']) fail(`${relativePath}: action skill must explicitly allowlist tools`)
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

// 배치-류 마커: 존재 + 코드펜스 밖 배치까지 검사한다(존재-류는 validate-marker-integrity
// 레지스트리 몫). needle은 언어 중립 앵커 — 지시 산문은 자유 번역 가능(M1 ④).
const instructionPlacementChecks = [
  ['.claude/agents/requirements-analyst.md', '<!-- marker:detect-timeseries -->'],
]
for (const [relativePath, marker] of instructionPlacementChecks) {
  const lines = read(relativePath).split(/\r?\n/)
  let insideFence = false
  let found = false
  for (const line of lines) {
    if (line.startsWith('```')) {
      insideFence = !insideFence
      continue
    }
    if (!line.includes(marker)) continue
    found = true
    if (insideFence) fail(`${relativePath}: required instruction is inside a fenced code block: ${marker}`)
  }
  if (!found) fail(`${relativePath}: required instruction marker is missing: ${marker}`)
}
pass('critical instruction placement outside fenced examples checked')

for (const agentName of legacyAgents) {
  if (activeSource.includes(agentName)) fail(`active harness still references legacy agent: ${agentName}`)
}
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

const requiredPackages = [
  '@axe-core/playwright',
  '@hookform/resolvers',
  '@playwright/test',
  'eslint-plugin-jsx-a11y',
  'web-vitals',
  'zod',
]
for (const packageName of requiredPackages) {
  if (!templateSource.includes(`"${packageName}"`)) fail(`project template is missing ${packageName}`)
}
for (const requiredTemplate of ['## ESLINT_CONFIG', '## PLAYWRIGHT_CONFIG', '## ERROR_FALLBACK', '## NOT_FOUND_PAGE', '## RENOVATE_CONFIG']) {
  if (!templateSource.includes(requiredTemplate)) fail(`project template is missing ${requiredTemplate}`)
}
pass('project template dependencies and sections checked')

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

const webOrchestrationSource = [
  read('.claude/skills/web-orchestrator/SKILL.md'),
  read('.claude/skills/web-verify/SKILL.md'),
].join('\n')
const devOrchestratorSource = read('.claude/skills/dev-orchestrator/SKILL.md')
for (const agentName of [
  'api-contract-verifier',
  'browser-verifier',
  'security-reviewer',
  'timeseries-architect',
  'data-access-verifier',
  'state-contract-designer',
  'state-invariant-verifier',
  'ingestion-contract-designer',
  'data-quality-verifier',
]) {
  if (!webOrchestrationSource.includes(agentName)) fail(`web orchestrators do not invoke ${agentName}`)
}
for (const modeName of ['TIMESERIES_MODE', 'LOCAL_DOMAIN_STATE_MODE', 'EXTERNAL_DATA_INGESTION_MODE']) {
  if (!webOrchestrationSource.includes(modeName)) fail(`web orchestrators do not define ${modeName}`)
  if (devOrchestratorSource.includes(modeName)) fail(`dev-orchestrator duplicates web mode ${modeName}`)
}
if (!devOrchestratorSource.includes('/web-orchestrator')) fail('dev-orchestrator does not delegate web applications')
for (const webOnlyAgent of ['timeseries-architect', 'realtime-data-builder', 'mock-api-builder', 'data-ui-binder']) {
  if (devOrchestratorSource.includes(webOnlyAgent)) fail(`dev-orchestrator duplicates web agent ${webOnlyAgent}`)
}
if (!existsSync(join(claudeDirectory, 'skills', 'timeseries-dashboard', 'SKILL.md'))) fail('timeseries-dashboard skill is missing')
pass('canonical web orchestration and dev delegation checked')

const localStateReference = '.claude/skills/web-orchestrator/references/local-domain-state.md'
if (!existsSync(join(repositoryRoot, localStateReference))) fail('local domain state contract is missing')
for (const orchestratorPath of ['.claude/skills/web-orchestrator/SKILL.md', '.claude/agents/requirements-analyst.md']) {
  if (!read(orchestratorPath).includes(localStateReference)) {
    fail(`${orchestratorPath}: canonical local domain state contract is not referenced`)
  }
}
for (const marker of ['filtered/virtualized index', 'invalid-state recovery', 'qa-state.md']) {
  if (!read(localStateReference).includes(marker)) fail(`local domain state contract is missing ${marker}`)
}
pass('local domain state detection and invariant contracts checked')

const externalIngestionReference = '.claude/skills/web-orchestrator/references/external-data-ingestion.md'
if (!existsSync(join(repositoryRoot, externalIngestionReference))) fail('external data ingestion contract is missing')
for (const orchestratorPath of ['.claude/skills/web-orchestrator/SKILL.md', '.claude/agents/requirements-analyst.md']) {
  if (!read(orchestratorPath).includes(externalIngestionReference)) {
    fail(`${orchestratorPath}: canonical external ingestion contract is not referenced`)
  }
}
for (const marker of ['static-snapshot', 'last-known-good', 'atomic publish', 'qa-data-quality.md']) {
  if (!read(externalIngestionReference).includes(marker)) fail(`external ingestion contract is missing ${marker}`)
}
pass('external ingestion detection, quality, and promotion contracts checked')

const detectionReference = '.claude/skills/timeseries-dashboard/references/detection-contract.md'
if (!existsSync(join(repositoryRoot, detectionReference))) fail('timeseries detection contract is missing')
const detectionSource = existsSync(join(repositoryRoot, detectionReference)) ? read(detectionReference) : ''
if (!read('.claude/skills/web-orchestrator/SKILL.md').includes(detectionReference)) {
  fail('.claude/skills/web-orchestrator/SKILL.md: canonical timeseries detection contract is not referenced')
}
for (const keyword of ['그라파나', '시계열', '날짜별', '실시간', '빅데이터', '채팅']) {
  if (!detectionSource.includes(keyword)) fail(`timeseries detection contract is missing Korean case: ${keyword}`)
}
// historical-only 허용 규칙의 존속은 validate-marker-integrity가 앵커
// (timeseries-historical-only)로 지킨다 — 한국어 문장 인라인 매칭에서 이관(M1 ④).
pass('bilingual timeseries detection contract checked')

const streamingSource = read('.claude/skills/timeseries-dashboard/references/streaming-contract.md')
  // entity-query-builder는 2026-08-26에 제거됐다(구조 지시 빌더 6종). 종전에는 그것과
  // shared-foundation-builder의 timestamp 스키마 소유 선언이 **일치하는지**를 봤다.
  // 이제 소유자가 하나이므로 그 선언의 존속만 확인한다.
  // shared-foundation-builder는 2026-08-26에 제거됐다(5범주 밖 26종). 그 본문을 읽던
  // timestamp 소유 선언 검사도 함께 사라진다 — streaming contract 검사는 그대로다.
for (const requiredStreamingPattern of [
  '.pipe(unixMsSchema)',
  'protocolVersion: 1',
  'packedPoints[index * 2] = point.timestamp',
  'globalThis.crossOriginIsolated === true',
]) {
  if (!streamingSource.includes(requiredStreamingPattern)) fail(`streaming contract is missing ${requiredStreamingPattern}`)
}
if (streamingSource.includes("src/shared/realtime/timestamp.ts")) fail('timestamp schema is still owned by the later realtime phase')
// realtime Mock 빌드 순서 규칙의 존속은 validate-marker-integrity가 앵커
// (timeseries-realtime-build-order)로 지킨다 — 한국어 문장 인라인 매칭에서 이관(M1 ④).
pass('timeseries timestamp and Worker contracts checked')

  // deploy-ci-writer는 2026-08-26에 제거됐다. 워크플로 하드닝 검사는 그 본문을 읽던
  // 검사였으므로 함께 사라진다 — 계약 산문은 skills 쪽에 남는다.
pass('deploy promotion and dependency-update contracts checked')

validateSettings({claudeDirectory, repositoryRoot, read, pass, fail})
validateWebCoreIntegration({repositoryRoot, pass, fail})
validateReleaseFixtures({claudeDirectory, repositoryRoot, pass, fail})

validateWorkflowsAndEvals({claudeDirectory, repositoryRoot, pass, fail}); validateAnalyticsBuilder({repositoryRoot, read, pass, fail}); validateVisualDesign({repositoryRoot, read, pass, fail}); validatePlanningFacilitation({repositoryRoot, read, pass, fail}); validateAdapterHygiene({repositoryRoot, pass, fail}); validateSchemaParity({repositoryRoot, pass, fail}); validateContractHygiene({repositoryRoot, pass, fail}); validateMarkerIntegrity({repositoryRoot, pass, fail}); validateCertifiedEvidence({repositoryRoot, pass, fail})

if (errors.length) {
  console.error(`Harness validation failed with ${errors.length} error(s):`)
  for (const message of errors) console.error(`- ${message}`)
  process.exitCode = 1
} else {
  console.log(`Harness validation passed (${checks.length} checks).`)
  for (const message of checks) console.log(`- ${message}`)
}
