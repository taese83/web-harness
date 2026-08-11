#!/usr/bin/env node

import {existsSync, readFileSync} from 'node:fs'
import {spawnSync} from 'node:child_process'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const claudeDirectory = resolve(scriptDirectory, '..')
const repositoryRoot = resolve(claudeDirectory, '..')
const requestedStage = process.argv[process.argv.indexOf('--stage') + 1] ?? 'all'
const supportedStages = ['foundation', 'routing', 'services', 'policy', 'eval-contracts', 'all']

if (!supportedStages.includes(requestedStage)) {
  console.error('Unknown AI harness stage: ' + requestedStage)
  console.error('Expected one of: ' + supportedStages.join(', '))
  process.exit(2)
}

const errors = []
const checks = []
const applies = stage => requestedStage === 'all' || requestedStage === stage
const pass = message => checks.push(message)
const fail = message => errors.push(message)
const absolute = relativePath => join(repositoryRoot, relativePath)
const read = relativePath => readFileSync(absolute(relativePath), 'utf8')
const requireFile = relativePath => {
  if (!existsSync(absolute(relativePath))) {
    fail(relativePath + ': required file is missing')
    return false
  }
  return true
}

const manifestPath = '.claude/ai-harness.json'
const scenariosPath = '.claude/evals/ai-scenarios.json'
let manifest
let scenarioDocument

try {
  manifest = JSON.parse(read(manifestPath))
} catch (error) {
  fail(manifestPath + ': invalid or missing JSON: ' + (error instanceof Error ? error.message : String(error)))
}

try {
  scenarioDocument = JSON.parse(read(scenariosPath))
} catch (error) {
  fail(scenariosPath + ': invalid or missing JSON: ' + (error instanceof Error ? error.message : String(error)))
}

if (applies('foundation') && manifest) {
  if (manifest.version !== 1) fail('AI harness manifest version must be 1')

  const requiredModes = [
    'AI_MODE',
    'RAG_MODE',
    'TOOL_AGENT_MODE',
    'CODE_REVIEW_AGENT_MODE',
    'REALTIME_VOICE_MODE',
    'ANALYTICS_AGENT_MODE',
    'BROWSER_AGENT_MODE',
  ]
  const modeIds = new Set((manifest.modes ?? []).map(mode => mode.id))
  for (const mode of requiredModes) {
    if (!modeIds.has(mode)) fail('AI harness manifest is missing mode ' + mode)
  }

  const requiredSkills = ['ai-app-orchestrator', 'ai-runtime-setup', 'ai-eval']
  for (const skill of requiredSkills) requireFile('.claude/skills/' + skill + '/SKILL.md')

  for (const group of ['planning', 'implementation', 'verification']) {
    const agents = manifest.commonAgents?.[group]
    if (!Array.isArray(agents) || agents.length === 0) {
      fail('AI harness manifest commonAgents.' + group + ' must not be empty')
      continue
    }
    for (const agent of agents) requireFile('.claude/agents/' + agent + '.md')
  }

  const orchestrator = read('.claude/skills/ai-app-orchestrator/SKILL.md')
  const requiredArtifacts = manifest.modes.find(mode => mode.id === 'AI_MODE')?.requiredArtifacts ?? []
  for (const artifact of requiredArtifacts) {
    if (!orchestrator.includes(artifact)) fail('AI orchestrator does not require artifact ' + artifact)
  }
  for (const marker of ['Hard Stops', '/ai-runtime-setup', '/ai-eval', 'AI_MODE']) {
    if (!orchestrator.includes(marker)) fail('AI orchestrator is missing ' + marker)
  }

  const productionContract = read('.claude/skills/ai-app-orchestrator/references/production-contract.md')
  for (const marker of ['server secret', 'untrusted input', 'idempotency', 'maxRequestCost', 'L4']) {
    if (!productionContract.includes(marker)) fail('AI production contract is missing ' + marker)
  }

  const projectInit = read('.claude/skills/project-init/references/checklist.md')
  if (!projectInit.includes('.claude/ai-harness.json')) fail('project-init does not copy the AI harness manifest')
  if (
    !projectInit.includes('validate-ai-harness.mjs') &&
    !projectInit.includes('test-ai-harness.mjs --through eval-contracts')
  ) {
    fail('project-init does not run the AI harness validator directly or through the staged runner')
  }

  pass('AI foundation manifest, common skills, agents, artifacts, and production contract checked')
}

if (applies('routing') && manifest) {
  const detectionPath = '.claude/skills/ai-app-orchestrator/references/detection-contract.md'
  requireFile(detectionPath)
  const detection = read(detectionPath)
  for (const marker of [
    '사내 문서',
    'AI 코드리뷰',
    '음성 상담',
    'AI 대시보드',
    '브라우저 agent',
    'Playwright 회귀 QA',
    'TIMESERIES_MODE',
  ]) {
    if (!detection.includes(marker)) fail('AI detection contract is missing routing marker ' + marker)
  }

  const webOrchestratorPath = '.claude/skills/web-orchestrator/SKILL.md'
  const webOrchestrator = read(webOrchestratorPath)
  if (!webOrchestrator.includes(detectionPath)) fail(webOrchestratorPath + ': canonical AI detection contract is not referenced')
  if (!webOrchestrator.includes('AI_MODE')) fail(webOrchestratorPath + ': AI_MODE is not routed')
  if (!webOrchestrator.includes('/ai-app-orchestrator')) fail(webOrchestratorPath + ': AI orchestrator delegation is missing')

  const devOrchestratorPath = '.claude/skills/dev-orchestrator/SKILL.md'
  const devOrchestrator = read(devOrchestratorPath)
  if (!devOrchestrator.includes('/web-orchestrator')) fail(devOrchestratorPath + ': web application delegation is missing')
  if (devOrchestrator.includes('AI_MODE') || devOrchestrator.includes('/ai-app-orchestrator')) {
    fail(devOrchestratorPath + ': duplicates AI routing owned by web-orchestrator')
  }

  pass('AI mode detection, canonical web routing, and dev delegation checked')
}

if (applies('services') && manifest && scenarioDocument) {
  const scenarios = scenarioDocument.scenarios ?? []
  for (const service of manifest.services ?? []) {
    const skillPath = '.claude/skills/' + service.skill + '/SKILL.md'
    const builderPath = '.claude/agents/' + service.builder + '.md'
    if (!requireFile(skillPath) || !requireFile(builderPath)) continue
    const skill = read(skillPath)
    if (!skill.includes(service.builder)) fail(skillPath + ': service builder ' + service.builder + ' is not invoked')
    for (const mode of service.modes) {
      if (!skill.includes(mode)) fail(skillPath + ': required mode ' + mode + ' is missing')
    }
    const serviceScenarios = scenarios.filter(scenario => scenario.service === service.id)
    if (serviceScenarios.length < service.minimumScenarios) {
      fail(service.id + ': expected at least ' + service.minimumScenarios + ' scenarios, found ' + serviceScenarios.length)
    }
    if (!serviceScenarios.some(scenario => scenario.risk === 'critical')) {
      fail(service.id + ': at least one critical scenario is required')
    }
  }
  pass('five AI service skills, builders, modes, and minimum scenarios checked')
}

if (applies('policy') && manifest) {
  const settings = JSON.parse(read('.claude/settings.json'))
  const hookSource = JSON.stringify(settings.hooks ?? {})
  if (!hookSource.includes('enforce-ai-safety.mjs')) fail('Claude settings do not register the AI safety hook')

  const safetyHookPath = absolute('.claude/scripts/enforce-ai-safety.mjs')
  const runSafetyHook = (filePath, content, toolName = 'Write') =>
    spawnSync(process.execPath, [safetyHookPath], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: {...process.env, CLAUDE_PROJECT_DIR: repositoryRoot},
      input: JSON.stringify({
        cwd: repositoryRoot,
        tool_name: toolName,
        tool_input: {
          file_path: absolute(filePath),
          content,
          new_string: content,
        },
      }),
    })

  const allowedServerProvider = runSafetyHook(
    'apps/agent-api/src/provider.ts',
    "const providerKey = process.env.OPENAI_API_KEY",
  )
  const blockedBrowserSecret = runSafetyHook(
    'apps/web/src/features/chat/api.ts',
    "const providerKey = import.meta.env.VITE_OPENAI_API_KEY",
  )
  const blockedBrowserEndpoint = runSafetyHook(
    'apps/web/src/features/chat/api.ts',
    "fetch('https://api.openai.com/v1/responses')",
  )
  const blockedSideEffect = runSafetyHook(
    'packages/ai-contracts/src/refund.ts',
    'export const refund = { sideEffect: true }',
  )
  const blockedJsonSideEffectEdit = runSafetyHook(
    'packages/ai-contracts/src/refund.json',
    '{"sideEffect": true}',
    'Edit',
  )
  const allowedSideEffect = runSafetyHook(
    'packages/ai-contracts/src/refund.ts',
    'export const refund = { sideEffect: true, requiresApproval: true, idempotencyRequired: true }',
  )

  if (allowedServerProvider.status !== 0) fail('AI safety hook blocks a server-only provider credential')
  if (blockedBrowserSecret.status !== 2) fail('AI safety hook allows a browser provider credential')
  if (blockedBrowserEndpoint.status !== 2) fail('AI safety hook allows a direct browser provider endpoint')
  if (blockedSideEffect.status !== 2) fail('AI safety hook allows an unapproved non-idempotent side effect')
  if (blockedJsonSideEffectEdit.status !== 2) fail('AI safety hook allows a JSON side effect through Edit')
  if (allowedSideEffect.status !== 0) fail('AI safety hook blocks an approved idempotent side effect')

  const verifierHookPath = absolute('.claude/scripts/enforce-verifier-bash.mjs')
  const runVerifierHook = command =>
    spawnSync(process.execPath, [verifierHookPath], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      input: JSON.stringify({
        agent_type: 'ai-eval-runner',
        tool_name: 'Bash',
        tool_input: {command},
      }),
    })
  if (runVerifierHook('node .claude/scripts/run-ai-evals.mjs --validate').status !== 0) {
    fail('AI eval verifier cannot run the read-only eval validator')
  }
  if (runVerifierHook("node -e 'process.exit(0)'").status !== 2) {
    fail('AI eval verifier can run arbitrary Node code')
  }

  const requiredToolFields = new Set(manifest.toolContractRequiredFields ?? [])
  for (const field of [
    'name',
    'inputSchema',
    'sideEffect',
    'requiredScopes',
    'requiresApproval',
    'idempotencyRequired',
    'timeoutMs',
    'auditEvent',
  ]) {
    if (!requiredToolFields.has(field)) fail('AI tool contract manifest is missing ' + field)
  }

  pass('AI safety hook, verifier command boundary, and tool policy checked')
}

if (applies('eval-contracts') && manifest && scenarioDocument) {
  if (scenarioDocument.version !== 1) fail('AI scenario document version must be 1')
  const scenarios = scenarioDocument.scenarios
  if (!Array.isArray(scenarios) || scenarios.length < 31) {
    fail('At least 31 AI scenarios are required')
  } else {
    const ids = new Set()
    const services = new Set(['common', ...(manifest.services ?? []).map(service => service.id)])
    const stages = new Set((manifest.testStages ?? []).filter(stage => stage !== 'baseline'))
    const risks = new Set(['critical', 'high', 'medium', 'low'])
    const assertionTypes = new Set(['artifact', 'trace', 'policy', 'metric', 'manual'])

    for (const scenario of scenarios) {
      if (!scenario.id || ids.has(scenario.id)) fail('Invalid or duplicate AI scenario id: ' + (scenario.id ?? '<missing>'))
      ids.add(scenario.id)
      if (!services.has(scenario.service)) fail(scenario.id + ': unknown service ' + scenario.service)
      if (!stages.has(scenario.stage)) fail(scenario.id + ': unknown stage ' + scenario.stage)
      if (!risks.has(scenario.risk)) fail(scenario.id + ': unknown risk ' + scenario.risk)
      if (!scenario.entrySkill || !scenario.prompt) fail(scenario.id + ': entrySkill and prompt are required')
      if (!Array.isArray(scenario.assertions) || scenario.assertions.length < 2) {
        fail(scenario.id + ': at least two assertions are required')
        continue
      }

      const assertionIds = new Set()
      for (const assertion of scenario.assertions) {
        if (!assertion.id || assertionIds.has(assertion.id)) {
          fail(scenario.id + ': invalid or duplicate assertion id ' + (assertion.id ?? '<missing>'))
        }
        assertionIds.add(assertion.id)
        if (!assertionTypes.has(assertion.type)) {
          fail(scenario.id + '/' + assertion.id + ': unknown assertion type ' + assertion.type)
        }
        if (!assertion.expected) fail(scenario.id + '/' + assertion.id + ': expected result is required')
        if (assertion.evidenceRequired !== true) {
          fail(scenario.id + '/' + assertion.id + ': evidenceRequired must be true')
        }
      }
    }

    const commonCount = scenarios.filter(scenario => scenario.service === 'common').length
    if (commonCount < 6) fail('At least six common AI scenarios are required')
  }

  const evalRunnerPath = absolute('.claude/scripts/run-ai-evals.mjs')
  const runResultVerification = fixture =>
    spawnSync(process.execPath, [evalRunnerPath, '--verify-result', fixture], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    })
  if (runResultVerification('.claude/evals/fixtures/result-contract-pass.json').status !== 0) {
    fail('AI eval result verifier rejects a valid evidence-bearing PASS fixture')
  }
  if (runResultVerification('.claude/evals/fixtures/result-contract-missing-evidence.json').status !== 1) {
    fail('AI eval result verifier accepts PASS assertions without evidence')
  }
  pass('AI scenario schema, risk, assertion, evidence, and coverage checked')
}

if (errors.length) {
  console.error('AI harness validation failed for stage ' + requestedStage + ' with ' + errors.length + ' error(s):')
  for (const message of errors) console.error('- ' + message)
  process.exitCode = 1
} else {
  console.log('AI harness validation passed for stage ' + requestedStage + ' (' + checks.length + ' checks).')
  for (const message of checks) console.log('- ' + message)
}
