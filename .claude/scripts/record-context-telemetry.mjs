#!/usr/bin/env node
// record-context-telemetry.mjs — `PostToolUse`: 메인 세션의 도구 결과 크기를 한 줄씩 남긴다(막지 않는다).
//
// 메인 오케스트레이터 문맥은 도구 결과가 쌓여 자란다 — 무엇이 크게 쌓이는지 알아야 줄일 곳을 고른다(측정 먼저, 강제는 뒤).
// 하네스 프로젝트(`_workspace/`가 있는 곳)에서만, 메인 세션(agent_type 없음)만 기록한다. 내용은 남기지 않는다 — 도구 이름,
// 결과 바이트(훅이 받은 결과의 직렬화 크기 — 문맥 토큰이 아니다), 대상 분류뿐이다. 파일: `_workspace/04_qa/context-telemetry.jsonl`(로컬 기록).
// 집계: node .claude/scripts/report-execution-telemetry.mjs --project <root>
import {existsSync, lstatSync, realpathSync} from 'node:fs'
import {join, relative, sep} from 'node:path'
import {appendEvidenceLine} from './evidence-log-lib.mjs'

const CONTEXT_TELEMETRY_RELATIVE = '_workspace/04_qa/context-telemetry.jsonl'
const MAX_FILE_BYTES = 5 * 1024 * 1024

// 대상은 분류만 남긴다 — 명령 원문·env 값·프로젝트 밖 경로는 남기지 않는다.
const HARNESS_PATH = /\.claude\/scripts\/|_workspace\/\.contracts\/|\/references\/|\/\.claude\//
const targetOf = (toolName, toolInput, projectRoot) => {
  if (toolName === 'Bash') {
    const command = String(toolInput?.command ?? '').trim()
    const executable = command.split(/\s+/)[0] ?? ''
    const simple = /^[A-Za-z0-9._/-]+$/.test(executable) ? executable.split('/').at(-1) : '(env)'
    const script = command.match(/^(?:node\s+\S*\.claude\/scripts\/|\S*web-harness-script\s+)([a-z0-9/-]+)/)
    if (script) return `script:${script[1].replace(/\.mjs$/, '')}`
    return `bash:${simple}${HARNESS_PATH.test(command) ? ':harness-source' : ''}`.slice(0, 60)
  }
  if (['Read', 'Edit', 'Write'].includes(toolName) && typeof toolInput?.file_path === 'string') {
    const path = relative(projectRoot, toolInput.file_path).split(sep).join('/')
    const window = toolName === 'Read' && (toolInput.offset || toolInput.limit) ? `#${toolInput.offset ?? 1}+${toolInput.limit ?? ''}` : ''
    const shown = path.startsWith('..') ? (HARNESS_PATH.test(toolInput.file_path) ? '(outside:harness-source)' : '(outside)') : path
    return `${shown}${window}`.slice(0, 160)
  }
  if (['Agent', 'Task'].includes(toolName)) return `agent:${toolInput?.subagent_type ?? ''}`.slice(0, 80)
  return null
}

const sizeOf = value => Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value ?? ''), 'utf8')

try {
  let source = ''
  for await (const chunk of process.stdin) source += chunk
  const input = JSON.parse(source)
  // 서브에이전트 호출은 agent_id(런타임 실측)나 agent_type을 싣는다 — 둘 다 없을 때만 메인이다.
  if (!input.agent_type && !input.agent_id) {
    const projectRoot = realpathSync(process.env.CLAUDE_PROJECT_DIR ?? input.cwd)
    const workspace = join(projectRoot, '_workspace')
    const directory = join(workspace, '04_qa')
    // 하네스 프로젝트가 아니면 아무것도 만들지 않는다. 기록 자리의 조상이 링크면 따라 쓰지 않는다.
    const realDirectory = path => existsSync(path) && lstatSync(path).isDirectory() && !lstatSync(path).isSymbolicLink()
    if (realDirectory(workspace) && realDirectory(directory)) {
      appendEvidenceLine(join(projectRoot, CONTEXT_TELEMETRY_RELATIVE), {at: new Date().toISOString(), session: input.session_id ?? null,
        tool: input.tool_name, bytes: sizeOf(input.tool_response), target: targetOf(input.tool_name, input.tool_input, projectRoot)},
      {maxBytes: MAX_FILE_BYTES})
    }
  }
} catch { /* 기록 실패로 도구 흐름을 막지 않는다 — 측정이 빠질 뿐이다 */ }
process.exit(0)
