#!/usr/bin/env node

import {VERIFIER_AGENTS} from './agent-registry.mjs'
import {harnessAgentName} from './agent-identity.mjs'
import {evaluateGlobalBashPolicy, tokenizeSimpleCommand} from './global-bash-policy-lib.mjs'

const READ_COMMANDS = new Set(['pwd', 'ls', 'cat', 'head', 'tail', 'wc', 'rg', 'grep'])
const VERIFIER_BLOCKED_SCRIPTS = new Set([
  '.claude/scripts/deploy-harness.mjs',
  '.claude/scripts/run-package-operation.mjs',
  '.claude/scripts/web-core/compile-execution-plan.mjs',
  '.claude/scripts/web-core/resolve-profile.mjs',
])

const readInput = async () => {
  let source = ''
  for await (const chunk of process.stdin) source += chunk
  return JSON.parse(source)
}

const block = message => {
  process.stderr.write(`${message}\n`)
  process.exit(2)
}

try {
  const input = await readInput()
  // 하네스 에이전트만 verifier 정책을 받는다 — 플러그인 판본에서 프로젝트가 정의한 같은 이름은 프로젝트 에이전트다
  // (프로젝트 리뷰어가 `git diff`를 못 돌리게 되면 그 리뷰가 조용히 빈다). 판정은 agent-identity.mjs.
  const agentType = harnessAgentName(input.agent_type, {projectRoot: process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? null})
  if (input.tool_name !== 'Bash' || !agentType || !VERIFIER_AGENTS.has(agentType)) process.exit(0)

  const command = input.tool_input?.command?.trim()
  if (!command) block('Blocked: verifier Bash requires a non-empty command.')
  const policy = evaluateGlobalBashPolicy(input)
  if (!policy.allowed) block(`Blocked: ${input.agent_type} failed global Bash policy (${policy.code}).`)

  const tokens = tokenizeSimpleCommand(command)
  if (READ_COMMANDS.has(tokens[0]) || tokens[0] === 'web-harness-read') process.exit(0)
  if (tokens[0] !== 'node' && tokens[0] !== 'web-harness-script') {
    block(`Blocked: ${input.agent_type} must use a typed validation or inspection runner.`)
  }

  // 플러그인 dispatcher 호출은 같은 스크립트 차단 집합으로 정규화해 판정한다.
  const script = tokens[0] === 'web-harness-script'
    ? `.claude/scripts/${tokens[1]}.mjs`
    : tokens[1] === '--check' ? null : tokens[1]
  if (script && VERIFIER_BLOCKED_SCRIPTS.has(script)) {
    block(`Blocked: ${input.agent_type} cannot invoke mutating control-plane runner ${script}.`)
  }
  if (script === '.claude/scripts/validate-release-gate.mjs' && tokens.includes('--write-manifest')) {
    block(`Blocked: ${input.agent_type} cannot write a release manifest.`)
  }
} catch (error) {
  block(`Blocked: verifier Bash hook could not validate the operation: ${error instanceof Error ? error.message : String(error)}`)
}
