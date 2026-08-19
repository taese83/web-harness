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

  // 명시 kind는 probe 여부와 무관하게 항상 그 실행기를 쓴다 — 이전엔 probe 전
  // (activeExecutor=null)이면 kind='claude-code'여도 codex 경로로 떨어지는 버그가 있었다
  // (search-portal 파일럿 실측: Claude 연결 상태에서 변경 적용이 codex를 실행).
  const execute = input => {
    const target = kind !== 'auto' ? kind : (activeExecutor ?? 'codex')
    return target === 'claude-code'
      ? executeFor['claude-code']({claudeBin, ...input})
      : executeFor.codex(input)
  }

  return {
    kind,
    probe,
    execute,
    get activeExecutor() {
      return activeExecutor
    },
  }
}
