#!/usr/bin/env node

import {existsSync, readFileSync} from 'node:fs'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(scriptDirectory, '..', '..')
const documentPath = join(repositoryRoot, '.claude/evals/ai-scenarios.json')
const document = JSON.parse(readFileSync(documentPath, 'utf8'))
const scenarios = document.scenarios ?? []
const args = process.argv.slice(2)

const valueAfter = option => {
  const index = args.indexOf(option)
  return index === -1 ? undefined : args[index + 1]
}

const printScenario = scenario => {
  console.log(JSON.stringify({
    scenarioId: scenario.id,
    service: scenario.service,
    stage: scenario.stage,
    risk: scenario.risk,
    entrySkill: scenario.entrySkill,
    prompt: scenario.prompt,
    assertions: scenario.assertions,
    resultTemplate: {
      scenarioId: scenario.id,
      status: 'BLOCKED',
      versions: {
        model: 'record-model-version',
        prompt: 'record-prompt-version',
        workflow: 'record-workflow-version',
      },
      assertions: scenario.assertions.map(assertion => ({
        id: assertion.id,
        status: 'BLOCKED',
        evidence: [],
      })),
    },
  }, null, 2))
}

const validateDocument = () => {
  const errors = []
  if (document.version !== 1) errors.push('version must be 1')
  if (!Array.isArray(scenarios) || scenarios.length === 0) errors.push('scenarios must be a non-empty array')
  const ids = new Set()
  for (const scenario of scenarios) {
    if (!scenario.id || ids.has(scenario.id)) errors.push('invalid or duplicate scenario id: ' + scenario.id)
    ids.add(scenario.id)
    if (!scenario.service || !scenario.stage || !scenario.risk) errors.push(scenario.id + ': service, stage, and risk are required')
    if (!scenario.entrySkill || !scenario.prompt) errors.push(scenario.id + ': entrySkill and prompt are required')
    if (!Array.isArray(scenario.assertions) || scenario.assertions.length === 0) {
      errors.push(scenario.id + ': assertions are required')
    }
  }
  return errors
}

const verifyResult = resultPath => {
  const absoluteResultPath = resolve(repositoryRoot, resultPath)
  if (!existsSync(absoluteResultPath)) {
    console.error('Result file does not exist: ' + absoluteResultPath)
    process.exit(2)
  }

  const result = JSON.parse(readFileSync(absoluteResultPath, 'utf8'))
  const scenario = scenarios.find(candidate => candidate.id === result.scenarioId)
  if (!scenario) {
    console.error('Unknown scenarioId in result: ' + result.scenarioId)
    process.exit(2)
  }

  const errors = []
  const statuses = new Set(['PASS', 'FAIL', 'BLOCKED'])
  if (!statuses.has(result.status)) errors.push('status must be PASS, FAIL, or BLOCKED')
  for (const field of ['model', 'prompt', 'workflow']) {
    if (typeof result.versions?.[field] !== 'string' || !result.versions[field].trim()) {
      errors.push('versions.' + field + ' is required')
    }
  }

  const resultAssertions = new Map((result.assertions ?? []).map(assertion => [assertion.id, assertion]))
  for (const assertion of scenario.assertions) {
    const assertionResult = resultAssertions.get(assertion.id)
    if (!assertionResult) {
      errors.push('missing assertion result: ' + assertion.id)
      continue
    }
    if (!statuses.has(assertionResult.status)) {
      errors.push(assertion.id + ': invalid status')
    }
    if (
      assertionResult.status === 'PASS' &&
      (!Array.isArray(assertionResult.evidence) ||
        assertionResult.evidence.length === 0 ||
        assertionResult.evidence.some(item => typeof item !== 'string' || !item.trim()))
    ) {
      errors.push(assertion.id + ': PASS requires non-empty evidence strings')
    }
  }

  const allAssertionsPass = scenario.assertions.every(
    assertion => resultAssertions.get(assertion.id)?.status === 'PASS',
  )
  if (result.status === 'PASS' && !allAssertionsPass) {
    errors.push('overall PASS requires every assertion to PASS')
  }
  if (scenario.risk === 'critical' && result.status === 'BLOCKED') {
    errors.push('critical scenario BLOCKED does not satisfy the release gate')
  }

  if (errors.length) {
    console.error('AI eval result failed verification for ' + scenario.id + ':')
    for (const error of errors) console.error('- ' + error)
    process.exit(1)
  }

  if (result.status !== 'PASS') {
    console.error('AI eval result is structurally valid but does not pass: ' + result.status)
    process.exit(1)
  }

  console.log('AI eval result passed verification: ' + scenario.id)
}

if (args.includes('--validate')) {
  const errors = validateDocument()
  if (errors.length) {
    console.error('AI eval contract validation failed:')
    for (const error of errors) console.error('- ' + error)
    process.exit(1)
  }
  console.log('AI eval contracts are valid (' + scenarios.length + ' scenarios).')
} else if (args.includes('--list')) {
  for (const scenario of scenarios) {
    console.log([scenario.id, scenario.service, scenario.stage, scenario.risk, scenario.entrySkill].join('\t'))
  }
} else if (valueAfter('--service')) {
  const service = valueAfter('--service')
  const selected = scenarios.filter(scenario => scenario.service === service)
  if (!selected.length) {
    console.error('No scenarios for service: ' + service)
    process.exit(2)
  }
  for (const scenario of selected) console.log(scenario.id + '\t' + scenario.risk + '\t' + scenario.prompt)
} else if (valueAfter('--stage')) {
  const stage = valueAfter('--stage')
  const selected = scenarios.filter(scenario => scenario.stage === stage)
  if (!selected.length) {
    console.error('No scenarios for stage: ' + stage)
    process.exit(2)
  }
  for (const scenario of selected) console.log(scenario.id + '\t' + scenario.service + '\t' + scenario.risk)
} else if (valueAfter('--scenario')) {
  const id = valueAfter('--scenario')
  const scenario = scenarios.find(candidate => candidate.id === id)
  if (!scenario) {
    console.error('Unknown scenario: ' + id)
    process.exit(2)
  }
  printScenario(scenario)
} else if (valueAfter('--verify-result')) {
  verifyResult(valueAfter('--verify-result'))
} else {
  console.log('Usage:')
  console.log('  node .claude/scripts/run-ai-evals.mjs --validate')
  console.log('  node .claude/scripts/run-ai-evals.mjs --list')
  console.log('  node .claude/scripts/run-ai-evals.mjs --service <service>')
  console.log('  node .claude/scripts/run-ai-evals.mjs --stage <stage>')
  console.log('  node .claude/scripts/run-ai-evals.mjs --scenario <id>')
  console.log('  node .claude/scripts/run-ai-evals.mjs --verify-result <result.json>')
  process.exitCode = 2
}
