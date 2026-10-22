#!/usr/bin/env node
// inject-implementation-references.mjs — `SubagentStart`: 기준을 읽어야 하는 하네스 에이전트(developer·code-reviewer·security-reviewer·
// system-architect)에 이번 변경이 닿는 영역의 기준 파일을 직접 건넨다(reference-areas-lib). 짝인 확인은 check-references-used.mjs다.
//
// **막지 않는다** — 시작 훅은 막을 수 없고, 어떤 오류도 침묵하고 통과한다(주입이 빠지면 짝 훅도 확인하지 않는다).
import {mkdirSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {homedir} from 'node:os'
import {harnessAgentName, isPluginBuild} from './agent-identity.mjs'
import {sessionsDirectory} from './harness-session-mode.mjs'
import {consumerAreas, implementationGuidance, markerPath, referenceContext, turnGuidance} from './reference-areas-lib.mjs'

const STALE_MS = 24 * 60 * 60 * 1000

try {
  let source = ''
  for await (const chunk of process.stdin) source += chunk
  const input = JSON.parse(source)
  const projectRoot = realpathSync(process.env.CLAUDE_PROJECT_DIR ?? input.cwd)
  const agentName = harnessAgentName(input.agent_type, {projectRoot})
  const context = agentName ? referenceContext(projectRoot, agentName, {pluginBuild: isPluginBuild()}) : null
  const guidance = agentName ? [implementationGuidance(agentName), turnGuidance(agentName)].filter(Boolean).join('\n') || null : null
  if (context) {
    if (typeof input.agent_id === 'string' && input.agent_id) {
      try {
        const directory = sessionsDirectory(homedir())
        mkdirSync(directory, {recursive: true})
        // 종료 훅에 닿지 못한 스폰(강제 종료)의 표시는 하루 뒤 지운다.
        for (const name of readdirSync(directory).filter(file => file.startsWith('refs-'))) {
          try { if (Date.now() - statSync(join(directory, name)).mtimeMs > STALE_MS) rmSync(join(directory, name), {force: true}) } catch { /* 다음에 */ }
        }
        writeFileSync(markerPath(input.agent_id), `${JSON.stringify({agentName, areas: consumerAreas(projectRoot, agentName), at: new Date().toISOString(), asked: false})}\n`)
      } catch { /* 표시를 못 남기면 확인만 빠진다 */ }
    }
  }
  const additionalContext = [guidance, context].filter(Boolean).join('\n')
  if (additionalContext) process.stdout.write(`${JSON.stringify({hookSpecificOutput: {hookEventName: 'SubagentStart', additionalContext}})}\n`)
} catch { /* 안내 층 — 주입 실패로 스폰을 막지 않는다 */ }
process.exit(0)
