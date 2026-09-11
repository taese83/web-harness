#!/usr/bin/env node
// release-write-lease.mjs — `SubagentStop`: 끝난 서브에이전트의 write 임대를 놓는다.
//
// 짝은 `enforce-agent-ownership.mjs`의 임대 취득이다(`write-lease-lib.mjs`). **막지 않는다** —
// 스톱 훅이 실패해 서브에이전트 종료가 꼬이면 그쪽이 더 나쁘다. 해제에 실패하면 임대가 남고,
// 다음 developer 쓰기가 홀더·경로를 대며 loud하게 막힌다(조용한 동시 쓰기보다 낫다).
// **남의 임대는 지우지 않는다** — `releaseLease`가 agent_id를 대조한다.
import {realpathSync} from 'node:fs'
import {releaseLease} from './write-lease-lib.mjs'

try {
  let source = ''
  for await (const chunk of process.stdin) source += chunk
  const input = JSON.parse(source)
  if (typeof input.agent_id === 'string' && input.agent_id) {
    releaseLease({projectRoot: realpathSync(process.env.CLAUDE_PROJECT_DIR ?? input.cwd), agentId: input.agent_id})
  }
} catch { /* 해제 실패로 종료를 막지 않는다 — 남은 임대는 다음 쓰기가 알린다 */ }
process.exit(0)
