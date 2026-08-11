#!/usr/bin/env node

import {readFileSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {evaluateGlobalBashPolicy} from '../global-bash-policy-lib.mjs'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(scriptDirectory, '..', '..', '..')
const fixturePath = resolve(repositoryRoot, '.claude/evals/fixtures/global-bash-policy-cases.json')
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'))
const errors = []

if (fixture.schemaVersion !== 1 || !Array.isArray(fixture.cases) || fixture.cases.length === 0) {
  errors.push('fixture must use schemaVersion 1 and contain cases')
}

const seen = new Set()
for (const testCase of fixture.cases ?? []) {
  if (!testCase.id || seen.has(testCase.id)) {
    errors.push(`invalid or duplicate fixture id: ${testCase.id ?? '<missing>'}`)
    continue
  }
  seen.add(testCase.id)
  const decision = evaluateGlobalBashPolicy({
    cwd: repositoryRoot,
    tool_name: 'Bash',
    agent_type: testCase.agentType,
    tool_input: {command: testCase.command, ...(testCase.toolInput ?? {})},
  }, {
    environment: {CLAUDE_PROJECT_DIR: repositoryRoot},
    processCwd: repositoryRoot,
  })
  const expectedAllowed = testCase.expect === 'ALLOW'
  if (decision.allowed !== expectedAllowed || decision.code !== testCase.code) {
    errors.push(`${testCase.id}: expected ${testCase.expect}/${testCase.code}, received ${decision.allowed ? 'ALLOW' : 'DENY'}/${decision.code} (${decision.reason})`)
  }
}

if (errors.length > 0) {
  process.stderr.write(`Global Bash policy fixtures failed (${errors.length}):\n`)
  for (const error of errors) process.stderr.write(`- ${error}\n`)
  process.exit(1)
}

process.stdout.write(`Global Bash policy fixtures passed (${fixture.cases.length} cases).\n`)
