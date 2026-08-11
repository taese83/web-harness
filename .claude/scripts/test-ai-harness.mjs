#!/usr/bin/env node

import {spawnSync} from 'node:child_process'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(scriptDirectory, '..', '..')
const stageOrder = ['baseline', 'foundation', 'routing', 'services', 'policy', 'eval-contracts']
const args = process.argv.slice(2)

const valueAfter = option => {
  const index = args.indexOf(option)
  return index === -1 ? undefined : args[index + 1]
}

const requestedSingleStage = valueAfter('--stage')
const requestedThroughStage = valueAfter('--through') ?? (requestedSingleStage ? undefined : 'all')
const normalizeStage = stage => stage === 'all' ? stageOrder.at(-1) : stage
const targetStage = normalizeStage(requestedSingleStage ?? requestedThroughStage)

if (!stageOrder.includes(targetStage)) {
  console.error('Unknown stage: ' + targetStage)
  console.error('Expected one of: ' + [...stageOrder, 'all'].join(', '))
  process.exit(2)
}

const selectedStages = requestedSingleStage
  ? [targetStage]
  : stageOrder.slice(0, stageOrder.indexOf(targetStage) + 1)

const run = (label, script, scriptArgs = []) => {
  console.log('\n== ' + label + ' ==')
  const result = spawnSync(process.execPath, [join(scriptDirectory, script), ...scriptArgs], {
    cwd: repositoryRoot,
    stdio: 'inherit',
  })
  if (result.status !== 0) {
    console.error('\nStopped at ' + label + ' with exit code ' + result.status + '.')
    process.exit(result.status ?? 1)
  }
}

for (const stage of selectedStages) {
  if (stage === 'baseline') {
    run('Stage 0 — baseline harness', 'validate-harness.mjs')
  } else if (stage === 'eval-contracts') {
    run('Stage 5 — AI eval contract integration', 'validate-ai-harness.mjs', ['--stage', stage])
    run('Stage 5 — AI scenario schema', 'run-ai-evals.mjs', ['--validate'])
  } else {
    const index = stageOrder.indexOf(stage)
    run('Stage ' + index + ' — ' + stage, 'validate-ai-harness.mjs', ['--stage', stage])
  }
}

console.log('\nStatic stages passed: ' + selectedStages.join(' -> '))
if (selectedStages.includes('eval-contracts')) {
  console.log('Next: select a runtime scenario with:')
  console.log('  node .claude/scripts/run-ai-evals.mjs --list')
  console.log('  node .claude/scripts/run-ai-evals.mjs --scenario <id>')
  console.log('Execute it in an isolated fixture, record evidence, then verify the result JSON.')
}
