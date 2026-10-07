#!/usr/bin/env node
// record-subagent-telemetry.mjs — `SubagentStop`: 끝난 서브에이전트의 소요 시간·턴·도구 사용 수를 한 줄씩 남긴다(막지 않는다).
//
// 오케스트레이터의 스폰 기록(execution-telemetry.json)은 자기보고라 빠질 수 있다 — 어느 에이전트가 느린지는 런타임 transcript로 잰다.
// 창: 같은 agentId의 **직전 기록 이후** 줄만 본다 — 이어받은(SendMessage) 스폰은 멈출 때마다 한 줄이고 행을 더해도 겹치지 않는다.
// 소요: 연속한 줄 사이 간격의 합이되 **다음 줄이 지시(도구 결과가 아닌 user 줄)인 간격은 뺀다** — 지시를 기다린 시간(사용자가 답하는
// 동안)은 작업이 아니다. 턴 = assistant 메시지 id 수, 도구 = tool_use 블록 수. 토큰은 재지 않는다 — 스트리밍 줄의 usage는 중간값이다.
// 내용은 남기지 않는다. 기록: context-telemetry.jsonl의 `kind: "subagent"` 행. 집계: report-execution-telemetry.mjs
import {lstatSync, readFileSync, realpathSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import {harnessAgentName} from './agent-identity.mjs'
import {appendEvidenceLine} from './evidence-log-lib.mjs'
import {CONTEXT_TELEMETRY_MAX_BYTES, contextTelemetryPath} from './context-telemetry-lib.mjs'

const TRANSCRIPT_MAX_BYTES = 32 * 1024 * 1024

// 지시 줄: 도구 결과가 아닌 user 줄(스폰 프롬프트·이어받은 메시지·런타임 재지시).
const isInstruction = row => row.type === 'user' &&
  !(Array.isArray(row.message?.content) && row.message.content.some(block => block?.type === 'tool_result'))

/**
 * transcript JSONL 본문 → `since`(직전 기록 시각, ms) 이후 창의 {durationMs, turns, toolUses}(순수). 창에 줄이 없으면 null.
 * 창 첫 줄 앞 간격은 창 직전 줄을 기준으로 잰다 — 멈춤 기록보다 먼저 써진 줄(런타임 재지시) 뒤의 작업을 놓치지 않는다.
 */
export const summarizeTranscript = (text, {since = null} = {}) => {
  const rows = []
  for (const line of text.split('\n')) {
    let row
    try { row = line ? JSON.parse(line) : null } catch { continue }
    const at = row && typeof row === 'object' ? Date.parse(row.timestamp) : NaN
    if (Number.isFinite(at)) rows.push({row, at})
  }
  const start = since === null ? 0 : rows.findIndex(entry => entry.at > since)
  if (start < 0 || rows.length === 0) return null
  let durationMs = 0
  const messages = new Set()
  const toolUses = {}
  for (let index = start; index < rows.length; index += 1) {
    const {row, at} = rows[index]
    if (index > 0 && !isInstruction(row)) durationMs += Math.max(0, at - rows[index - 1].at)
    if (row.type !== 'assistant') continue
    const message = row.message ?? {}
    if (typeof message.id === 'string') messages.add(message.id)
    for (const block of Array.isArray(message.content) ? message.content : []) {
      if (block?.type === 'tool_use' && typeof block.name === 'string') {
        const name = block.name.slice(0, 60)
        toolUses[name] = (toolUses[name] ?? 0) + 1
      }
    }
  }
  return {durationMs, turns: messages.size, toolUses}
}

/** 같은 agentId의 직전 기록 시각(ms) — 없으면 null. */
const previousStop = (path, agentId) => {
  if (!agentId) return null
  let latest = null
  try {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      if (!line.includes(agentId)) continue
      try {
        const row = JSON.parse(line)
        const at = Date.parse(row.at)
        if (row.kind === 'subagent' && row.agentId === agentId && Number.isFinite(at) && (latest === null || at > latest)) latest = at
      } catch { /* 깨진 줄은 건너뛴다 */ }
    }
  } catch { return null }
  return latest
}

const readTranscript = path => {
  if (typeof path !== 'string') return null
  try {
    const stat = lstatSync(path)
    // 링크는 따라 읽지 않는다 · 상한을 넘는 transcript는 재지 않는다(미계측으로 남는다).
    return stat.isFile() && stat.size <= TRANSCRIPT_MAX_BYTES ? readFileSync(path, 'utf8') : null
  } catch { return null }
}

const main = async () => {
  let source = ''
  for await (const chunk of process.stdin) source += chunk
  const input = JSON.parse(source)
  const projectRoot = realpathSync(process.env.CLAUDE_PROJECT_DIR ?? input.cwd)
  const path = contextTelemetryPath(projectRoot)
  if (!path) return
  const agentId = typeof input.agent_id === 'string' ? input.agent_id.slice(0, 80) : null
  const text = readTranscript(input.agent_transcript_path)
  const since = previousStop(path, agentId)
  const summary = text === null ? null : summarizeTranscript(text, {since})
  const rawType = typeof input.agent_type === 'string' ? input.agent_type.slice(0, 80) : null
  appendEvidenceLine(path, {at: new Date().toISOString(), kind: 'subagent', session: input.session_id ?? null,
    // 플러그인(`web-harness:x`)과 저장소(`x`) 실행이 같은 키로 모이게 하네스 이름으로 정규화한다 — 하네스 밖 에이전트는 원래 이름.
    agent: (rawType && harnessAgentName(rawType, {projectRoot})) ?? rawType,
    agentId, resumed: since !== null,
    // 잴 수 없었으면 숫자를 지어내지 않고 null로 남긴다 — 집계가 「미계측」으로 보인다.
    durationMs: summary?.durationMs ?? null, turns: summary?.turns ?? null,
    toolUses: summary?.toolUses ?? null},
  {maxBytes: CONTEXT_TELEMETRY_MAX_BYTES})
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await main() } catch { /* 기록 실패로 서브에이전트 종료를 막지 않는다 — 측정이 빠질 뿐이다 */ }
  process.exit(0)
}
