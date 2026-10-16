#!/usr/bin/env node

import {evaluateSensitiveAccess, sensitiveDenyRemedy} from './sensitive-access-policy-lib.mjs'
import {recordHookDenial} from './hook-denial-log-lib.mjs'

let source = ''
for await (const chunk of process.stdin) source += chunk
try {
  const input = JSON.parse(source)
  const decision = evaluateSensitiveAccess(input)
  // 비밀 경로가 있는 트리의 Grep — 막는 대신 비밀 파일을 빼는 glob을 붙여 실행한다(검색 결과에 비밀 내용이 나오지 않는다).
  if (decision.allowed && decision.updatedInput) {
    process.stdout.write(JSON.stringify({hookSpecificOutput: {hookEventName: 'PreToolUse', permissionDecision: 'allow',
      permissionDecisionReason: `web-harness: 비밀 경로를 제외하는 glob을 붙여 검색한다${decision.replacedGlob
        ? ` (요청한 glob ${decision.replacedGlob}은 비밀 파일에 걸려 바꿨다${decision.updatedInput.type ? ` — type ${decision.updatedInput.type}로 범위를 지켰다` : ' — 범위가 넓어졌다. type이나 하위 폴더로 좁힌다'})` : ''}`,
      updatedInput: decision.updatedInput}}))
    process.exit(0)
  }
  if (!decision.allowed) {
    recordHookDenial(input, {hook: 'enforce-sensitive-access', code: decision.code})
    // 막힌 뒤 어디로 가면 되는지 한 줄(sensitiveDenyRemedy) — 모르면 같은 요청을 모양만 바꿔 되풀이한다.
    const remedy = sensitiveDenyRemedy(decision, input)
    process.stderr.write(`Blocked sensitive filesystem access: ${decision.code}${decision.reason ? ` (${decision.reason})` : ''}${remedy ? ` — ${remedy}` : ''}\n`)
    process.exit(2)
  }
} catch (error) {
  process.stderr.write(`Blocked sensitive filesystem access: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(2)
}
