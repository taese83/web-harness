#!/usr/bin/env node
// eval-trace-metrics.mjs — `claude plugin eval` 실행 트레이스(stream-json)에서 실행 비용 지표를 뽑는다(순수).
//
// 무엇을 재는가(메인 스레드 기준 — 서브에이전트 메시지는 `parent_tool_use_id`로 가려 뺀다): 턴 수·최대 컨텍스트
// (한 번의 요청이 실은 입력 토큰)·출력 토큰·도구별 호출 수·스폰한 에이전트·하네스 스크립트 소스를 직접 연 횟수.
// 마지막 것은 도구 인체공학의 신호다 — 게이트를 통과하려고 모델이 스크립트 본문을 읽었다면 CLI 안내나 오류 메시지가
// 다음 행동을 말하지 못한 것이다. 셸(cat·sed·grep…)과 Read·Grep 도구 둘 다 센다.

const SCRIPT_PATH = /\/scripts\/[\w./-]+\.mjs/
const SHELL_SOURCE_READ = /(?:^|[\s;&|(])(?:cat|sed|grep|rg|awk|head|tail|less)\b[^|;&]*\/scripts\/[\w./-]+\.mjs/

const parse = text => String(text).split(/\r?\n/).filter(Boolean).flatMap(line => {
  try { return [JSON.parse(line)] } catch { return [] }
})

const opensScriptSource = block => {
  if (block.name === 'Bash') return SHELL_SOURCE_READ.test(String(block.input?.command ?? ''))
  if (block.name === 'Read' || block.name === 'Grep') return SCRIPT_PATH.test(String(block.input?.file_path ?? block.input?.path ?? ''))
  return false
}

/** @param {string} traceText stream-json 줄들 */
export const traceMetrics = traceText => {
  const events = parse(traceText)
  let peakContextTokens = 0
  let assistantTurns = 0
  const toolUses = {}
  const agentSpawns = {}
  const scriptSourceReads = []
  const bashIds = new Set()
  let bashErrors = 0
  for (const event of events) {
    // 메인 스레드 Bash 결과 중 오류 — 스크립트가 전부 실패한 실행이 receipt에서 건강해 보이지 않게 분모를 남긴다.
    if (event.type === 'user' && !event.parent_tool_use_id && Array.isArray(event.message?.content)) {
      bashErrors += event.message.content.filter(block => block.type === 'tool_result' && block.is_error && bashIds.has(block.tool_use_id)).length
      continue
    }
    if (event.type !== 'assistant' || !event.message || event.parent_tool_use_id) continue
    assistantTurns += 1
    const usage = event.message.usage ?? {}
    const context = (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0)
    peakContextTokens = Math.max(peakContextTokens, context)
    for (const block of event.message.content ?? []) {
      if (block.type !== 'tool_use') continue
      toolUses[block.name] = (toolUses[block.name] ?? 0) + 1
      if (block.name === 'Bash') bashIds.add(block.id)
      if (block.name === 'Agent' || block.name === 'Task') {
        const type = String(block.input?.subagent_type ?? 'unknown')
        agentSpawns[type] = (agentSpawns[type] ?? 0) + 1
      }
      if (opensScriptSource(block)) scriptSourceReads.push(String(block.input?.command ?? block.input?.file_path ?? block.input?.path).slice(0, 160))
    }
  }
  const result = [...events].reverse().find(event => event.type === 'result') ?? {}
  return {
    turns: result.num_turns ?? assistantTurns,
    peakContextTokens,
    outputTokens: result.usage?.output_tokens ?? null,
    cacheReadTokens: result.usage?.cache_read_input_tokens ?? null,
    toolUses,
    bashErrors,
    agentSpawns,
    scriptSourceReads: scriptSourceReads.length,
    scriptSourceReadSamples: scriptSourceReads.slice(0, 5),
  }
}
