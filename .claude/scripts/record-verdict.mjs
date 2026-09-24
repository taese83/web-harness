#!/usr/bin/env node
// record-verdict.mjs — `SubagentStop`: 끝난 검증 에이전트의 최종 판정(`## Result`)을 증거 폴더에 기록한다.
//
// **막지 않는다** — 스톱 훅이 실패해 서브에이전트 종료가 꼬이면 그쪽이 더 나쁘다. 기록을 못 남기면 릴리스 게이트가
// 그 보고서를 「기록 없음」으로 막으므로(verdict-record-lib) 실패는 조용하지 않다.
import {realpathSync} from 'node:fs'
import {harnessAgentName} from './agent-identity.mjs'
import {recordVerdict} from './verdict-record-lib.mjs'

try {
  let source = ''
  for await (const chunk of process.stdin) source += chunk
  const input = JSON.parse(source)
  const projectRoot = realpathSync(process.env.CLAUDE_PROJECT_DIR ?? input.cwd)
  const agentName = harnessAgentName(input.agent_type, {projectRoot})
  if (agentName) {
    recordVerdict(projectRoot, {agentName, agentId: typeof input.agent_id === 'string' ? input.agent_id : null,
      message: input.last_assistant_message})
  }
} catch { /* 기록 실패로 종료를 막지 않는다 — 게이트가 기록 없음을 알린다 */ }
process.exit(0)
