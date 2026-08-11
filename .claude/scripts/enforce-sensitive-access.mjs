#!/usr/bin/env node

import {evaluateSensitiveAccess} from './sensitive-access-policy-lib.mjs'

let source = ''
for await (const chunk of process.stdin) source += chunk
try {
  const decision = evaluateSensitiveAccess(JSON.parse(source))
  if (!decision.allowed) {
    process.stderr.write(`Blocked sensitive filesystem access: ${decision.code}\n`)
    process.exit(2)
  }
} catch (error) {
  process.stderr.write(`Blocked sensitive filesystem access: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(2)
}
