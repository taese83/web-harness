import {spawn, spawnSync} from 'node:child_process'
import {mkdtempSync, readFileSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {CodexRunError, codexRunConstants, filteredEnvironment, normalizeCodexUsage, normalizeRunResult} from './codex-runs.mjs'

const moduleRoot = dirname(fileURLToPath(import.meta.url))
const OUTPUT_SCHEMA_PATH = join(moduleRoot, 'codex-run-output.schema.json')
const CLAUDE_ENV_KEYS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_MODEL', 'XDG_CONFIG_HOME']
const IMPACT_ALLOWED_TOOLS = 'Read,Glob,Grep'
const APPLY_ALLOWED_TOOLS = 'Read,Glob,Grep,Write,Edit,MultiEdit'
const DISALLOWED_TOOLS = 'Bash,PowerShell,WebFetch,WebSearch,Agent,Task,Skill,NotebookEdit'

const claudeEnvironment = source => filteredEnvironment(source, CLAUDE_ENV_KEYS)
const boundedText = (value, limit) => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').slice(0, limit)

// Claude CLI의 --json-schema 검증기는 draft/2020-12 메타스키마 참조($schema)를 로드하지
// 못해 시작 전에 거부한다. canonical 파일은 Codex --output-schema용으로 유지하고, Claude
// 경로에서만 $schema 선언을 벗겨 전달한다 — 나머지 키워드는 draft 간 동일하게 해석된다.
const readOutputSchema = () => {
  const schema = JSON.parse(readFileSync(OUTPUT_SCHEMA_PATH, 'utf8'))
  delete schema.$schema
  return JSON.stringify(schema)
}

export const probeClaudeCodeConnection = ({claudeBin = 'claude', spawnSyncFn = spawnSync, now = new Date()} = {}) => {
  const options = {encoding: 'utf8', timeout: 5000, env: claudeEnvironment(process.env), shell: false}
  const versionResult = spawnSyncFn(claudeBin, ['--version'], options)
  if (versionResult.error?.code === 'ENOENT') {
    return {available: false, authenticated: false, connected: false, version: null, reason: 'CLAUDE_CODE_NOT_INSTALLED', checkedAt: now.toISOString()}
  }
  if (versionResult.error || versionResult.status !== 0) {
    return {available: false, authenticated: false, connected: false, version: null, reason: 'CLAUDE_CODE_UNAVAILABLE', checkedAt: now.toISOString()}
  }
  const version = boundedText(versionResult.stdout, 160).trim() || null
  const authResult = spawnSyncFn(claudeBin, ['auth', 'status'], options)
  const authenticated = !authResult.error && authResult.status === 0
  return {
    available: true,
    authenticated,
    connected: authenticated,
    version,
    reason: authenticated ? null : 'CLAUDE_CODE_NOT_AUTHENTICATED',
    checkedAt: now.toISOString(),
  }
}

// 프롬프트는 argv가 아니라 stdin으로 전달한다. --allowedTools/--disallowedTools가 가변 인자
// 옵션이라 뒤따르는 positional 프롬프트를 도구 목록으로 삼키고("Input must be provided
// either through stdin or as a prompt argument"), stdin 전달은 argv 길이 한계에서도 자유롭다.
export const buildClaudeCodeArguments = ({phase, schemaJson, model = null}) => [
  '--print',
  '--output-format', 'json',
  '--json-schema', schemaJson,
  '--disallowedTools', DISALLOWED_TOOLS,
  ...(model ? ['--model', model] : []),
  ...(phase === 'impact'
    ? ['--allowedTools', IMPACT_ALLOWED_TOOLS]
    : ['--allowedTools', APPLY_ALLOWED_TOOLS, '--permission-mode', 'acceptEdits']),
]

const normalizeClaudeUsage = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const input = value.input_tokens
  const output = value.output_tokens
  return normalizeCodexUsage({
    input_tokens: input,
    cached_input_tokens: value.cache_read_input_tokens,
    cache_write_input_tokens: value.cache_creation_input_tokens,
    output_tokens: output,
    total_tokens: Number.isSafeInteger(input) && Number.isSafeInteger(output) ? input + output : undefined,
  })
}

const parseClaudePayload = stdout => {
  try {
    return JSON.parse(stdout)
  } catch {
    throw new CodexRunError('CLAUDE_CODE_OUTPUT_INVALID', 'Claude Code output could not be parsed', 502)
  }
}

const extractStructuredResult = payload => {
  if (payload.structured_output && typeof payload.structured_output === 'object') return payload.structured_output
  try {
    return JSON.parse(String(payload.result ?? ''))
  } catch {
    throw new CodexRunError('CLAUDE_CODE_OUTPUT_INVALID', 'Claude Code did not return a structured result', 502)
  }
}

export const executeClaudeCodeCli = ({claudeBin = 'claude', projectRoot, phase, prompt, model = null, signal, spawnFn = spawn}) => new Promise((resolveExecution, rejectExecution) => {
  const timeoutMs = phase === 'impact' ? codexRunConstants.IMPACT_TIMEOUT_MS : codexRunConstants.APPLY_TIMEOUT_MS
  const temporary = mkdtempSync(join(tmpdir(), 'web-harness-claude-run-'))
  const args = buildClaudeCodeArguments({phase, schemaJson: readOutputSchema(), model})
  const child = spawnFn(claudeBin, args, {cwd: projectRoot, env: claudeEnvironment(process.env), shell: false, stdio: ['pipe', 'pipe', 'pipe']})
  child.stdin?.on('error', () => {})
  child.stdin?.end(prompt)
  let stdout = ''
  let stderr = ''
  let timedOut = false
  let aborted = false
  let settled = false
  let forceTimer = null
  const appendBounded = (current, chunk) => current.length >= codexRunConstants.MAX_CAPTURE_BYTES
    ? current
    : current + chunk.toString('utf8').slice(0, codexRunConstants.MAX_CAPTURE_BYTES - current.length)
  const cleanup = () => {
    clearTimeout(timer)
    if (forceTimer) clearTimeout(forceTimer)
    signal?.removeEventListener('abort', onAbort)
    rmSync(temporary, {recursive: true, force: true})
  }
  const finishError = error => {
    if (settled) return
    settled = true
    cleanup()
    rejectExecution(error)
  }
  const onAbort = () => {
    aborted = true
    child.kill('SIGTERM')
    forceTimer = setTimeout(() => child.kill('SIGKILL'), 2000)
  }
  const timer = setTimeout(() => {
    timedOut = true
    child.kill('SIGTERM')
    forceTimer = setTimeout(() => child.kill('SIGKILL'), 2000)
  }, timeoutMs)
  signal?.addEventListener('abort', onAbort, {once: true})
  child.stdout?.on('data', chunk => { stdout = appendBounded(stdout, chunk) })
  child.stderr?.on('data', chunk => { stderr = appendBounded(stderr, chunk) })
  child.once('error', error => finishError(new CodexRunError(error.code === 'ENOENT' ? 'CLAUDE_CODE_NOT_INSTALLED' : 'CLAUDE_CODE_PROCESS_FAILED', 'Claude Code process could not be started', 409)))
  child.once('close', code => {
    if (settled) return
    if (aborted) return finishError(new CodexRunError('CODEX_RUN_INTERRUPTED', 'Claude Code run was interrupted', 409))
    if (timedOut) return finishError(new CodexRunError('CODEX_RUN_TIMED_OUT', 'Claude Code run exceeded its time budget', 504))
    if (code !== 0) return finishError(new CodexRunError('CLAUDE_CODE_RUN_FAILED', boundedText(stderr.trim(), 500) || `Claude Code exited with code ${code}`, 502))
    try {
      const payload = parseClaudePayload(stdout)
      if (payload.is_error) throw new CodexRunError('CLAUDE_CODE_RUN_FAILED', boundedText(payload.result, 500) || 'Claude Code reported an execution error', 502)
      const result = normalizeRunResult(phase, extractStructuredResult(payload))
      const usage = normalizeClaudeUsage(payload.usage)
      const threadId = typeof payload.session_id === 'string' ? boundedText(payload.session_id, 128) : null
      settled = true
      cleanup()
      resolveExecution({threadId, result, usage})
    } catch (error) {
      const failure = error instanceof CodexRunError ? error : new CodexRunError('CLAUDE_CODE_OUTPUT_INVALID', 'Claude Code final output could not be parsed', 502)
      failure.usage = failure.usage ?? normalizeClaudeUsage(parseClaudePayloadSafe(stdout)?.usage)
      finishError(failure)
    }
  })
})

const parseClaudePayloadSafe = stdout => {
  try {
    return JSON.parse(stdout)
  } catch {
    return null
  }
}
