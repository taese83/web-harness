#!/usr/bin/env node

import {PACKAGE_OPERATIONS_FOR_WRITERS, RESTRICTED_BASH_WRITERS, VERIFIER_AGENTS} from './agent-registry.mjs'
import {recordHookDenial} from './hook-denial-log-lib.mjs'
import {harnessAgentName} from './agent-identity.mjs'
import {bashPolicyRemedy, evaluateGlobalBashPolicy, isWriterInstallCommand, tokenizeSimpleCommand} from './global-bash-policy-lib.mjs'

const READ_COMMANDS = new Set(['pwd', 'ls', 'cat', 'head', 'tail', 'wc', 'rg', 'grep'])
const VERIFIER_BLOCKED_SCRIPTS = new Set([
  '.claude/scripts/deploy-harness.mjs',
  '.claude/scripts/run-package-operation.mjs',
  '.claude/scripts/web-core/compile-execution-plan.mjs',
  '.claude/scripts/web-core/resolve-profile.mjs',
])

// 쓰는 에이전트는 verifier 허용목록을 물려받지 않는다 — 읽기 전용 검사 스크립트와 실행기·브로커만 양성 목록으로 연다
// (그 밖의 검사 스크립트 중에는 트래커 발행·--fix·스냅샷처럼 파일·외부 상태를 바꾸는 것이 있다).
const WRITER_ALLOWED_SCRIPTS = new Set([
  '.claude/scripts/run-quality-gates.mjs',
  '.claude/scripts/run-package-operation.mjs',
  '.claude/scripts/run-git-inspection.mjs',
  '.claude/scripts/read-skill-section.mjs',
  '.claude/scripts/plan-lookup.mjs',
  '.claude/scripts/validate-layer-boundaries.mjs',
  '.claude/scripts/validate-spec-conformance.mjs',
])

const readInput = async () => {
  let source = ''
  for await (const chunk of process.stdin) source += chunk
  return JSON.parse(source)
}

let deniedInput = null  // 막을 때 무엇을 막았는지 남긴다(hook-denial-log-lib)
const block = (message, code) => {
  process.stderr.write(`${message}\n`)
  recordHookDenial(deniedInput, {hook: 'enforce-verifier-bash', code})
  process.exit(2)
}

try {
  const input = await readInput()
  deniedInput = input
  // 하네스 에이전트만 verifier 정책을 받는다 — 플러그인 판본에서 프로젝트가 정의한 같은 이름은 프로젝트 에이전트다
  // (프로젝트 리뷰어가 `git diff`를 못 돌리게 되면 그 리뷰가 조용히 빈다). 판정은 agent-identity.mjs.
  const agentType = harnessAgentName(input.agent_type, {projectRoot: process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? null})
  const writer = RESTRICTED_BASH_WRITERS.has(agentType)
  if (input.tool_name !== 'Bash' || !agentType || !(VERIFIER_AGENTS.has(agentType) || writer)) process.exit(0)

  const command = input.tool_input?.command?.trim()
  if (!command) block('Blocked: verifier Bash requires a non-empty command.', 'EMPTY_COMMAND')
  if (writer && isWriterInstallCommand(input)) process.exit(0)
  const policy = evaluateGlobalBashPolicy(input)
  // 정책의 이유와 허용 형태를 그대로 넘긴다 — 코드만 받으면 같은 명령을 모양만 바꿔 되풀이한다.
  if (!policy.allowed) {
    const remedy = bashPolicyRemedy(policy.code)
    block(`Blocked: ${input.agent_type} failed global Bash policy (${policy.code}): ${policy.reason}${remedy ? ` — ${remedy}` : ''}`, `GLOBAL_POLICY_${policy.code}`)
  }

  const tokens = tokenizeSimpleCommand(command)
  if (READ_COMMANDS.has(tokens[0]) || tokens[0] === 'web-harness-read') process.exit(0)
  if (tokens[0] !== 'node' && tokens[0] !== 'web-harness-script') {
    block(`Blocked: ${input.agent_type} must use a typed validation or inspection runner — verifiers read (pwd ls cat head tail wc rg grep web-harness-read) `
      + 'or run an approved `node .claude/scripts/<validator>.mjs` / `web-harness-script <name>` check; they create no files or directories.', 'UNTYPED_RUNNER')
  }

  // 플러그인 dispatcher 호출은 같은 스크립트 차단 집합으로 정규화해 판정한다.
  const script = tokens[0] === 'web-harness-script'
    ? `.claude/scripts/${tokens[1]}.mjs`
    : tokens[1] === '--check' ? null : tokens[1]
  // 쓰는 에이전트는 패키지 브로커로도 의존성을 설치·잠근다(직접 형태는 위 `pnpm install --ignore-scripts`뿐). 그 밖의 브로커 작업은 막는다.
  const operation = tokens[tokens.indexOf('--operation') + 1]
  const writerPackageOperation = writer && script === '.claude/scripts/run-package-operation.mjs' && PACKAGE_OPERATIONS_FOR_WRITERS.has(operation)
  if (writer && (!script || !WRITER_ALLOWED_SCRIPTS.has(script))) {
    block(`Blocked: ${input.agent_type} may run only the quality runner, package broker (install·lockfile), \`pnpm install --ignore-scripts\`, `
      + 'and read-only inspection scripts (run-git-inspection, read-skill-section, plan-lookup, validate-layer-boundaries, validate-spec-conformance).', 'WRITER_SCRIPT')
  }
  // 전체 증거 세트(--all)는 채점용이다 — 쓰는 에이전트는 --check 하나씩 피드백으로만 돌린다.
  if (writer && script === '.claude/scripts/run-quality-gates.mjs' && tokens.includes('--all')) {
    block(`Blocked: ${input.agent_type} runs one check at a time (--check <id>) — the full evidence set (--all) is the main thread's gate.`, 'WRITER_ALL_CHECKS')
  }
  if (script && VERIFIER_BLOCKED_SCRIPTS.has(script) && !writerPackageOperation) {
    block(`Blocked: ${input.agent_type} cannot invoke mutating control-plane runner ${script} — leave it to the main thread and note it in your report.`, 'MUTATING_RUNNER')
  }
  if (script === '.claude/scripts/validate-release-gate.mjs' && tokens.includes('--write-manifest')) {
    block(`Blocked: ${input.agent_type} cannot write a release manifest — run the gate without --write-manifest; the main thread writes it.`, 'RELEASE_MANIFEST_WRITE')
  }
} catch (error) {
  block(`Blocked: verifier Bash hook could not validate the operation: ${error instanceof Error ? error.message : String(error)}`, 'HOOK_ERROR')
}
