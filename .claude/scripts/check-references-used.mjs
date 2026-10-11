#!/usr/bin/env node
// check-references-used.mjs — `SubagentStop`: inject-implementation-references가 기준을 건넨 스폰이 반환에 `REFERENCES_USED` 줄 없이
// 끝나면 **한 번** 돌려보낸다(이유를 주고 이어 가게 한다). 같은 스폰이 다시 멈추면 통과한다 — 상기 장치이지 게이트가 아니다.
// 반환으로 세는 것은 글과 보고 전달 도구(SubagentHandback)뿐이다 — 파일 쓰기에 그 줄이 들어갔으면 반환이 아니라 누출이다.
// 스폰마다 context-telemetry에 `kind: "references"` 행(건넨 영역 수·실제로 연 기준 파일·첫 멈춤의 줄 유무·돌려보냄)을 남긴다.
// 주입하지 않은 스폰(표시 없음)은 보지 않는다. 어떤 오류도 침묵하고 통과한다.
import {readFileSync, realpathSync, rmSync, statSync, writeFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import {hasReferencesUsed, isReferenceFile, markerPath} from './reference-areas-lib.mjs'
import {appendEvidenceLine} from './evidence-log-lib.mjs'
import {CONTEXT_TELEMETRY_MAX_BYTES, contextTelemetryPath} from './context-telemetry-lib.mjs'

const MAX_TRANSCRIPT = 16 * 1024 * 1024
const FILE_WRITES = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
const HANDBACK = 'SubagentHandback'

/** transcript의 어시스턴트 출력 — 반환(글·보고 전달), 파일 쓰기 입력, 연 기준 파일, 보고 전달 여부. 주입 문구(user 줄)는 세지 않는다. */
export function assistantOutput(transcript) {
  const out = {returned: [], written: [], referencesRead: new Set(), handedBack: false}
  for (const line of String(transcript ?? '').split('\n')) {
    let entry
    try { entry = JSON.parse(line) } catch { continue }
    if (entry?.type !== 'assistant' || !Array.isArray(entry.message?.content)) continue
    for (const part of entry.message.content) {
      if (part?.type === 'text') out.returned.push(part.text)
      if (part?.type !== 'tool_use') continue
      if (part.name === HANDBACK) { out.handedBack = true; out.returned.push(typeof part.input?.message === 'string' ? part.input.message : JSON.stringify(part.input)) }
      else if (FILE_WRITES.has(part.name)) out.written.push(JSON.stringify(part.input))
      else if (part.name === 'Read' && isReferenceFile(part.input?.file_path)) out.referencesRead.add(String(part.input.file_path).split('/').pop())
    }
  }
  return {...out, returned: out.returned.join('\n'), written: out.written.join('\n')}
}

const main = async () => {
  let source = ''
  for await (const chunk of process.stdin) source += chunk
  const input = JSON.parse(source)
  const marker = typeof input.agent_id === 'string' && input.agent_id ? markerPath(input.agent_id) : null
  let state = null
  try { state = marker ? JSON.parse(readFileSync(marker, 'utf8')) : null } catch { state = null }
  if (!state) return
  let transcript = ''
  try {
    const path = input.agent_transcript_path
    if (typeof path === 'string' && statSync(path).size <= MAX_TRANSCRIPT) transcript = readFileSync(path, 'utf8')
  } catch { /* transcript 없음 — 마지막 메시지만 본다 */ }
  const output = assistantOutput(transcript)
  // 뒤로 갈수록 정확하다: 반환에서 찾고, 못 찾을 때만 마지막 메시지(이 훅 입력)를 본다 — 그 메시지는 글이라 파일 쓰기가 섞이지 않는다.
  const answered = hasReferencesUsed(output.returned) || hasReferencesUsed(input.last_assistant_message)
  // 파일 쓰기 입력은 JSON 문자열이라 줄 머리가 없다 — 어디에 있든 그 줄이면 누출이다.
  const leaked = /REFERENCES_USED\s*[:：]/.test(output.written)
  const ask = !state.asked && input.stop_hook_active !== true && (!answered || leaked)
  try {
    const telemetry = contextTelemetryPath(realpathSync(process.env.CLAUDE_PROJECT_DIR ?? input.cwd))
    if (telemetry) {
      appendEvidenceLine(telemetry, {at: new Date().toISOString(), kind: 'references', agent: state.agentName ?? null,
        agentId: input.agent_id.slice(0, 80), areasOffered: state.areas ?? null, referencesRead: [...output.referencesRead].sort(),
        answered, leaked, asked: ask, again: Boolean(state.asked)}, {maxBytes: CONTEXT_TELEMETRY_MAX_BYTES})
    }
  } catch { /* 기록 실패로 종료를 막지 않는다 */ }
  if (!ask) { rmSync(marker, {force: true}); return }
  writeFileSync(marker, `${JSON.stringify({...state, asked: true})}\n`)
  const reason = leaked
    ? '[web-harness] `REFERENCES_USED` 줄이나 항목 ID를 파일(코드·주석·노트·보고서)에 썼다 — 그 파일에서 지우고, 줄은 반환에만 둔다.'
      + (answered ? '' : ' 반환에도 그 줄을 덧붙인다.')
    : output.handedBack
      ? '[web-harness] 보고는 이미 전달됐다 — 다시 쓰지 말고 `REFERENCES_USED: <근거로 쓴 항목 ID들>`(쓰지 않았으면 `REFERENCES_USED: none(이유)`) 한 줄만 같은 방법으로 반환하라.'
      : '[web-harness] 반환에 외부 기준 줄이 없다. 작업은 다시 하지 말고 같은 보고 끝에 `REFERENCES_USED: <근거로 쓴 항목 ID들>`'
        + '(쓰지 않았으면 `REFERENCES_USED: none(이유)`) 한 줄을 덧붙여 다시 반환하라. 이 줄은 반환에만 두고 파일에는 쓰지 않는다.'
  process.stdout.write(`${JSON.stringify({decision: 'block', reason})}\n`)
}

if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  try { await main() } catch { /* 상기 장치 — 오류로 종료를 막지 않는다 */ }
  process.exit(0)
}
