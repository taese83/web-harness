#!/usr/bin/env node
// record-context-telemetry.mjs — `PostToolUse`: 메인 세션의 도구 결과 크기를 한 줄씩 남긴다(막지 않는다).
//
// 메인 오케스트레이터 문맥은 도구 결과가 쌓여 자란다 — 무엇이 크게 쌓이는지 알아야 줄일 곳을 고른다(측정 먼저, 강제는 뒤).
// 하네스 프로젝트(`_workspace/`가 있는 곳)에서만, 메인 세션(agent_type 없음)만 기록한다. 내용은 남기지 않는다 — 도구 이름,
// 결과 바이트(훅이 받은 결과의 직렬화 크기 — 문맥 토큰이 아니다), 대상 분류뿐이다. 파일: `_workspace/04_qa/context-telemetry.jsonl`(로컬 기록).
// 집계: node .claude/scripts/report-execution-telemetry.mjs --project <root>
import {realpathSync} from 'node:fs'
import {appendEvidenceLine} from './evidence-log-lib.mjs'
import {CONTEXT_TELEMETRY_MAX_BYTES, contextTelemetryPath, telemetryTarget} from './context-telemetry-lib.mjs'

const sizeOf = value => Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value ?? ''), 'utf8')

try {
  let source = ''
  for await (const chunk of process.stdin) source += chunk
  const input = JSON.parse(source)
  // 서브에이전트 호출은 agent_id(런타임 실측)나 agent_type을 싣는다 — 둘 다 없을 때만 메인이다.
  if (!input.agent_type && !input.agent_id) {
    const projectRoot = realpathSync(process.env.CLAUDE_PROJECT_DIR ?? input.cwd)
    // 하네스 프로젝트가 아니면 아무것도 만들지 않는다. 기록 자리의 조상이 링크면 따라 쓰지 않는다.
    const path = contextTelemetryPath(projectRoot)
    if (path) {
      appendEvidenceLine(path, {at: new Date().toISOString(), session: input.session_id ?? null,
        tool: input.tool_name, bytes: sizeOf(input.tool_response), target: telemetryTarget(input.tool_name, input.tool_input, projectRoot)},
      {maxBytes: CONTEXT_TELEMETRY_MAX_BYTES})
    }
  }
} catch { /* 기록 실패로 도구 흐름을 막지 않는다 — 측정이 빠질 뿐이다 */ }
process.exit(0)
