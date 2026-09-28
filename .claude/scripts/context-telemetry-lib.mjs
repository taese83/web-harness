// context-telemetry-lib.mjs — 로컬 문맥 기록(`_workspace/04_qa/context-telemetry.jsonl`)의 단일 소유: 경로·크기 상한·기록 자리 판정·
// 대상 분류. 결과 크기 기록(record-context-telemetry)과 훅 거부 기록(hook-denial-log-lib)이 같은 분류를 쓴다 — 한 파일 안에서
// `target`의 뜻이 행 종류마다 달라지지 않게. 내용은 남기지 않는다: 명령 원문·Grep 검색어·파일 내용·프로젝트 밖 경로 없음.
import {existsSync, lstatSync} from 'node:fs'
import {join, relative, sep} from 'node:path'

export const CONTEXT_TELEMETRY_RELATIVE = '_workspace/04_qa/context-telemetry.jsonl'
export const CONTEXT_TELEMETRY_MAX_BYTES = 5 * 1024 * 1024

/** 기록 자리 — 하네스 프로젝트(`_workspace/04_qa/`가 링크 아닌 실제 디렉터리)일 때만 경로, 아니면 null. */
export const contextTelemetryPath = projectRoot => {
  const realDirectory = path => existsSync(path) && lstatSync(path).isDirectory() && !lstatSync(path).isSymbolicLink()
  const workspace = join(projectRoot, '_workspace')
  return realDirectory(workspace) && realDirectory(join(workspace, '04_qa')) ? join(projectRoot, CONTEXT_TELEMETRY_RELATIVE) : null
}

const HARNESS_PATH = /\.claude\/scripts\/|_workspace\/\.contracts\/|\/references\/|\/\.claude\//
/** 도구 호출의 대상 분류(순수). */
export const telemetryTarget = (toolName, toolInput, projectRoot) => {
  if (toolName === 'Bash') {
    // `cd <dir> && …`·`cd <dir>; …` 접두는 벗긴다 — 실제로 무엇을 돌렸는지로 분류한다.
    const command = String(toolInput?.command ?? '').trim().replace(/^(?:cd\s+(?:"[^"]*"|'[^']*'|\S+)\s*(?:&&|;)\s*)+/, '')
    const executable = command.split(/\s+/)[0] ?? ''
    const simple = /^[A-Za-z0-9._/-]+$/.test(executable) ? executable.split('/').at(-1) : '(env)'
    const script = command.match(/^(?:node\s+\S*\.claude\/scripts\/|\S*web-harness-script\s+)([a-z0-9/-]+)/)
    if (script) return `script:${script[1].replace(/\.mjs$/, '')}`
    return `bash:${simple}${HARNESS_PATH.test(command) ? ':harness-source' : ''}`.slice(0, 60)
  }
  if (toolName === 'Glob') return `glob:${String(toolInput?.pattern ?? '')}`.slice(0, 100)
  const path = toolName === 'Grep' ? toolInput?.path : toolInput?.file_path
  if (['Read', 'Edit', 'Write', 'Grep'].includes(toolName) && typeof path === 'string') {
    const shown = relative(projectRoot, path).split(sep).join('/')
    const window = toolName === 'Read' && (toolInput.offset || toolInput.limit) ? `#${toolInput.offset ?? 1}+${toolInput.limit ?? ''}` : ''
    const inside = shown.startsWith('..') ? (HARNESS_PATH.test(path) ? '(outside:harness-source)' : '(outside)') : shown
    return `${inside}${window}`.slice(0, 160)
  }
  if (['Agent', 'Task'].includes(toolName)) return `agent:${toolInput?.subagent_type ?? ''}`.slice(0, 80)
  return null
}
