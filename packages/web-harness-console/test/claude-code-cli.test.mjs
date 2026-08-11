import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {tmpdir} from 'node:os'
import test from 'node:test'
import {buildClaudeCodeArguments, executeClaudeCodeCli, probeClaudeCodeConnection} from '../src/claude-code-cli.mjs'
import {createExecutorAdapter} from '../src/executor-adapters.mjs'

const fakeChild = () => {
  const child = new EventEmitter()
  child.stdin = new EventEmitter()
  child.stdin.written = ''
  child.stdin.end = chunk => { child.stdin.written += chunk ?? '' }
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = () => {}
  return child
}

const validResult = phase => ({
  phase,
  outcome: phase === 'impact' ? 'READY' : 'READY_FOR_REVIEW',
  summary: 'ok',
  affectedFiles: ['_workspace/01_plan/feature-plan.md'],
  affectedFeatureIds: ['FEAT-001'],
  affectedSubFeatureIds: [],
  affectedTestCaseIds: ['TC-001-1'],
  sourceDigest: null,
  previewDigest: null,
  risks: [],
  checks: [],
  blockers: [],
})

test('claude probe distinguishes missing binary, broken binary, unauthenticated, and connected CLI', () => {
  const now = new Date('2026-08-07T00:00:00Z')
  const missing = probeClaudeCodeConnection({spawnSyncFn: () => ({error: {code: 'ENOENT'}}), now})
  assert.equal(missing.connected, false)
  assert.equal(missing.reason, 'CLAUDE_CODE_NOT_INSTALLED')

  const broken = probeClaudeCodeConnection({spawnSyncFn: () => ({error: {code: 'EBADARCH'}}), now})
  assert.equal(broken.reason, 'CLAUDE_CODE_UNAVAILABLE')

  const unauthenticated = probeClaudeCodeConnection({
    spawnSyncFn: (_bin, args) => args[0] === '--version' ? {status: 0, stdout: 'Claude Code v2.1.0\n'} : {status: 1, stdout: ''},
    now,
  })
  assert.equal(unauthenticated.available, true)
  assert.equal(unauthenticated.connected, false)
  assert.equal(unauthenticated.reason, 'CLAUDE_CODE_NOT_AUTHENTICATED')

  const calls = []
  const connected = probeClaudeCodeConnection({
    spawnSyncFn: (_bin, args) => {
      calls.push(args)
      return args[0] === '--version' ? {status: 0, stdout: 'Claude Code v2.1.0\n'} : {status: 0, stdout: ''}
    },
    now,
  })
  assert.equal(connected.connected, true)
  assert.equal(connected.version, 'Claude Code v2.1.0')
  assert.equal(connected.reason, null)
  assert.deepEqual(calls, [['--version'], ['auth', 'status']])
})

test('claude argv pins print/json-schema output and per-phase tool policy without a positional prompt', () => {
  const impact = buildClaudeCodeArguments({phase: 'impact', schemaJson: '{"schema":1}'})
  assert.equal(impact[0], '--print')
  assert.deepEqual(impact.slice(1, 5), ['--output-format', 'json', '--json-schema', '{"schema":1}'])
  // 프롬프트는 stdin으로만 전달한다 — variadic --allowedTools가 positional을 삼키기 때문.
  assert.equal(impact.at(-1), 'Read,Glob,Grep')
  assert.equal(impact[impact.indexOf('--allowedTools') + 1], 'Read,Glob,Grep')
  assert.equal(impact.includes('--permission-mode'), false)
  const impactDisallowed = impact[impact.indexOf('--disallowedTools') + 1]
  for (const banned of ['Bash', 'PowerShell', 'WebFetch', 'WebSearch']) assert.equal(impactDisallowed.includes(banned), true)

  const apply = buildClaudeCodeArguments({phase: 'apply', schemaJson: '{}'})
  const applyAllowed = apply[apply.indexOf('--allowedTools') + 1]
  for (const tool of ['Read', 'Write', 'Edit']) assert.equal(applyAllowed.includes(tool), true)
  assert.equal(applyAllowed.includes('Bash'), false)
  assert.equal(apply[apply.indexOf('--permission-mode') + 1], 'acceptEdits')
  assert.equal(apply[apply.indexOf('--disallowedTools') + 1].includes('Bash'), true)

  assert.equal(impact.includes('--model'), false)
  const routed = buildClaudeCodeArguments({phase: 'impact', schemaJson: '{}', model: 'small-1'})
  assert.equal(routed[routed.indexOf('--model') + 1], 'small-1')
})

test('claude executor parses structured output, maps usage, and rejects failures', async () => {
  let child = fakeChild()
  const spawnFn = (_bin, _args, options) => {
    assert.equal(options.shell, false)
    assert.equal('ANTHROPIC_API_KEY' in options.env || true, true)
    return child
  }

  const execution = executeClaudeCodeCli({projectRoot: tmpdir(), phase: 'impact', prompt: 'x', spawnFn})
  assert.equal(child.stdin.written, 'x')
  child.stdout.emit('data', Buffer.from(JSON.stringify({
    structured_output: validResult('impact'),
    session_id: 'session-123',
    usage: {input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 40},
  })))
  child.emit('close', 0)
  const value = await execution
  assert.equal(value.threadId, 'session-123')
  assert.equal(value.result.outcome, 'READY')
  assert.deepEqual(value.usage, {inputTokens: 100, cachedInputTokens: 40, outputTokens: 20, totalTokens: 120})

  child = fakeChild()
  const reportedError = executeClaudeCodeCli({projectRoot: tmpdir(), phase: 'impact', prompt: 'x', spawnFn})
  child.stdout.emit('data', Buffer.from(JSON.stringify({is_error: true, result: 'execution exploded'})))
  child.emit('close', 0)
  await assert.rejects(reportedError, error => error.code === 'CLAUDE_CODE_RUN_FAILED' && /execution exploded/.test(error.message))

  child = fakeChild()
  const nonZeroExit = executeClaudeCodeCli({projectRoot: tmpdir(), phase: 'apply', prompt: 'x', spawnFn})
  child.stderr.emit('data', Buffer.from('tool denied'))
  child.emit('close', 1)
  await assert.rejects(nonZeroExit, error => error.code === 'CLAUDE_CODE_RUN_FAILED' && /tool denied/.test(error.message))

  child = fakeChild()
  const invalidOutput = executeClaudeCodeCli({projectRoot: tmpdir(), phase: 'impact', prompt: 'x', spawnFn})
  child.stdout.emit('data', Buffer.from('not json at all'))
  child.emit('close', 0)
  await assert.rejects(invalidOutput, error => error.code === 'CLAUDE_CODE_OUTPUT_INVALID')

  child = fakeChild()
  const wrongPhase = executeClaudeCodeCli({projectRoot: tmpdir(), phase: 'impact', prompt: 'x', spawnFn})
  child.stdout.emit('data', Buffer.from(JSON.stringify({structured_output: validResult('apply'), session_id: 's'})))
  child.emit('close', 0)
  await assert.rejects(wrongPhase, error => error.code === 'CODEX_OUTPUT_INVALID')
})

test('auto adapter prefers codex, falls back to claude-code, and dispatches execution', async () => {
  const events = []
  const adapter = createExecutorAdapter({
    kind: 'auto',
    probes: {
      codex: () => ({available: false, authenticated: false, connected: false, version: null, reason: 'CODEX_NOT_INSTALLED'}),
      'claude-code': () => ({available: true, authenticated: true, connected: true, version: 'Claude Code v2', reason: null}),
    },
    executors: {
      codex: async () => {
        events.push('codex')
        return {}
      },
      'claude-code': async input => {
        events.push(['claude-code', input.claudeBin, input.phase])
        return {ok: true}
      },
    },
  })
  const status = adapter.probe()
  assert.equal(status.connected, true)
  assert.equal(status.executor, 'claude-code')
  assert.equal(status.candidates.length, 2)
  assert.deepEqual(status.candidates.map(candidate => candidate.executor), ['codex', 'claude-code'])
  const result = await adapter.execute({phase: 'impact', prompt: 'x'})
  assert.deepEqual(result, {ok: true})
  assert.deepEqual(events, [['claude-code', 'claude', 'impact']])

  const codexOnly = createExecutorAdapter({
    kind: 'codex',
    probes: {codex: () => ({available: true, authenticated: true, connected: true, version: 'codex 1', reason: null})},
    executors: {codex: async () => 'codex-ran', 'claude-code': async () => 'claude-ran'},
  })
  const codexStatus = codexOnly.probe()
  assert.equal(codexStatus.executor, 'codex')
  assert.equal('candidates' in codexStatus, false)
  assert.equal(await codexOnly.execute({}), 'codex-ran')

  const nothingConnected = createExecutorAdapter({
    kind: 'auto',
    probes: {
      codex: () => ({available: false, authenticated: false, connected: false, version: null, reason: 'CODEX_NOT_INSTALLED'}),
      'claude-code': () => ({available: false, authenticated: false, connected: false, version: null, reason: 'CLAUDE_CODE_NOT_INSTALLED'}),
    },
  })
  const disconnected = nothingConnected.probe()
  assert.equal(disconnected.connected, false)
  assert.equal(disconnected.candidates.length, 2)
  assert.throws(() => createExecutorAdapter({kind: 'gemini'}), /executor must be one of/)
})

test('claude executor strips the draft meta-schema reference the CLI validator cannot load', async () => {
  const child = fakeChild()
  let capturedArgs = null
  const spawnFn = (_bin, args) => {
    capturedArgs = args
    return child
  }
  const execution = executeClaudeCodeCli({projectRoot: tmpdir(), phase: 'impact', prompt: 'x', spawnFn})
  child.stdout.emit('data', Buffer.from(JSON.stringify({structured_output: validResult('impact'), session_id: 's'})))
  child.emit('close', 0)
  await execution
  const schema = JSON.parse(capturedArgs[capturedArgs.indexOf('--json-schema') + 1])
  assert.equal('$schema' in schema, false)
  assert.equal(schema.additionalProperties, false)
  assert.deepEqual(schema.properties.phase.enum, ['impact', 'apply'])
  assert.ok(schema.required.includes('outcome'))
})
