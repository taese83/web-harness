// hook-denial-log-lib.mjs — PreToolUse 훅이 막을 때 한 줄씩 남긴다(막는 결정은 바꾸지 않는다).
//
// 막기는 「거부하고 계속」이다 — 오탐 한 번은 에이전트의 재시도 한 번으로 조용히 비용이 된다. 어느 훅이 무엇을 얼마나
// 막는지 보여야 오탐 후보를 고른다(정밀도는 측정 먼저). 하네스 프로젝트에서만, 메인·서브에이전트 모두 기록한다. 자리·분류는
// 결과 크기 기록과 같다(`context-telemetry-lib.mjs`, `kind: "deny"` 행). 거부 문구는 남기지 않고 막은 자리의 **안정 코드**만
// 남긴다 — 문구에는 경로·에이전트 이름·파서 오류의 원문 조각이 섞여 집계가 흩어지고 내용이 샌다. 그 파일의 git 제외는 팀 흐름
// 프로젝트에서 개발 준비 검사(team-sharing)가 보장한다. 기록 실패는 무시한다 — 막는 결정이 우선이다.
// 집계: node .claude/scripts/report-execution-telemetry.mjs --project <root>
import {realpathSync} from 'node:fs'
import {appendEvidenceLine} from './evidence-log-lib.mjs'
import {CONTEXT_TELEMETRY_MAX_BYTES, contextTelemetryPath, telemetryTarget} from './context-telemetry-lib.mjs'

/** 막은 호출 한 줄 — `code`는 막은 자리의 안정 코드(없으면 UNCODED). */
export function recordHookDenial(input, {hook, code = null}) {
  try {
    if (!input || typeof input !== 'object') return
    const projectRoot = realpathSync(process.env.CLAUDE_PROJECT_DIR ?? input.cwd)
    const path = contextTelemetryPath(projectRoot)
    if (!path) return
    appendEvidenceLine(path, {
      at: new Date().toISOString(), session: input.session_id ?? null, kind: 'deny', hook, tool: input.tool_name ?? null,
      agent: input.agent_type ?? null, code: typeof code === 'string' && code ? code.slice(0, 80) : 'UNCODED',
      target: telemetryTarget(input.tool_name, input.tool_input, projectRoot),
    }, {maxBytes: CONTEXT_TELEMETRY_MAX_BYTES})
  } catch { /* 기록 실패로 막는 결정을 흔들지 않는다 */ }
}
