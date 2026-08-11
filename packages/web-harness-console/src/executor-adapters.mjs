import {executeCodexCli, probeCodexConnection} from './codex-runs.mjs'
import {executeClaudeCodeCli, probeClaudeCodeConnection} from './claude-code-cli.mjs'

export const EXECUTOR_KINDS = ['auto', 'codex', 'claude-code']

export const createExecutorAdapter = ({kind = 'auto', codexBin = 'codex', claudeBin = 'claude', probes = {}, executors = {}} = {}) => {
  if (!EXECUTOR_KINDS.includes(kind)) throw new Error(`executor must be one of: ${EXECUTOR_KINDS.join(', ')}`)
  const probeFor = {
    codex: probes.codex ?? probeCodexConnection,
    'claude-code': probes['claude-code'] ?? probeClaudeCodeConnection,
  }
  const executeFor = {
    codex: executors.codex ?? executeCodexCli,
    'claude-code': executors['claude-code'] ?? executeClaudeCodeCli,
  }
  let activeExecutor = null

  const probe = ({now = new Date()} = {}) => {
    const order = kind === 'auto' ? ['codex', 'claude-code'] : [kind]
    const statuses = []
    for (const candidate of order) {
      const status = candidate === 'codex'
        ? probeFor.codex({codexBin, now})
        : probeFor['claude-code']({claudeBin, now})
      statuses.push({...status, executor: candidate})
      if (status.connected) break
    }
    const connected = statuses.find(status => status.connected) ?? null
    activeExecutor = connected?.executor ?? null
    const primary = connected ?? statuses.find(status => status.available) ?? statuses[0]
    return statuses.length > 1
      ? {...primary, candidates: statuses.map(({executor, reason, version, available}) => ({executor, reason, version, available}))}
      : primary
  }

  const execute = input => activeExecutor === 'claude-code'
    ? executeFor['claude-code']({claudeBin, ...input})
    : executeFor.codex(input)

  return {
    kind,
    probe,
    execute,
    get activeExecutor() {
      return activeExecutor
    },
  }
}
