#!/usr/bin/env node

import {evaluateSensitiveAccess} from './sensitive-access-policy-lib.mjs'
import {recordHookDenial} from './hook-denial-log-lib.mjs'

let source = ''
for await (const chunk of process.stdin) source += chunk
try {
  const input = JSON.parse(source)
  const decision = evaluateSensitiveAccess(input)
  if (!decision.allowed) {
    recordHookDenial(input, {hook: 'enforce-sensitive-access', code: decision.code})
    process.stderr.write(`Blocked sensitive filesystem access: ${decision.code}\n`)
    process.exit(2)
  }
} catch (error) {
  process.stderr.write(`Blocked sensitive filesystem access: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(2)
}
