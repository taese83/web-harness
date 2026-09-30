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
    // 막힌 뒤 어디로 가면 되는지 한 줄 — 모르면 같은 요청을 모양만 바꿔 되풀이한다.
    const REMEDY = {
      DENY_PATH_OUTSIDE: 'Outside the project. Harness contracts are synced under _workspace/.contracts/ — read them there, not in the plugin cache. '
        + 'A file the user gave you (e.g. ~/Downloads/x.pdf): the main thread imports it with `node .claude/scripts/import-source.mjs --project-root . --from <absolute path>` (asks the user), then read _workspace/00_source/imported/.',
      DENY_SENSITIVE_TREE_GREP: 'The directory contains secret-bearing paths — search a narrower subdirectory (e.g. src/).',
    }
    process.stderr.write(`Blocked sensitive filesystem access: ${decision.code}${REMEDY[decision.code] ? ` — ${REMEDY[decision.code]}` : ''}\n`)
    process.exit(2)
  }
} catch (error) {
  process.stderr.write(`Blocked sensitive filesystem access: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(2)
}
