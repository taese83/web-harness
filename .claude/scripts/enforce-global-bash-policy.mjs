#!/usr/bin/env node

import {evaluateGlobalBashPolicy} from './global-bash-policy-lib.mjs'

const readInput = async () => {
  let source = ''
  for await (const chunk of process.stdin) source += chunk
  return JSON.parse(source)
}

try {
  const input = await readInput()
  // 완화 정책 (사용자 승인, 2026-07-27): argv-only 명령 통제는 subagent(builder/verifier)에만 적용한다.
  // 사람이 직접 감독하는 main session의 Bash는 면제 — 개발 명령(git/pnpm/pipe 등)을 막지 않는다.
  // 정책 엔진(global-bash-policy-lib)과 fixture 계약은 변경 없이 유지된다.
  if (!input?.agent_type) process.exit(0)
  const decision = evaluateGlobalBashPolicy(input)
  if (!decision.allowed) {
    process.stderr.write(`Blocked [${decision.code}]: ${decision.reason}\n`)
    process.exit(2)
  }
} catch (error) {
  process.stderr.write(`Blocked [DENY_POLICY_ERROR]: global Bash hook failed closed: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(2)
}
