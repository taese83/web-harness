#!/usr/bin/env node
// report-execution-telemetry.mjs — 실행 telemetry 집계 (advisory, gate 아님).
// 사용법: node .claude/scripts/report-execution-telemetry.mjs [--project <root>] — 0 = 집계 출력(파일 없음 포함), 1 = telemetry 파싱·형식 오류.
//
// execution-budget-contract.md의 telemetry 절이 정의한
// _workspace/04_qa/execution-telemetry.json 을 run·phase별로 집계해 출력한다.
// cap 판정·release gate와 무관하며, 스폰 예산 조정과 재읽기 비용 진단의 근거 자료다.

import {existsSync, readFileSync} from 'node:fs'
import {join, resolve} from 'node:path'
import {answerHelp} from './cli-help-lib.mjs'

answerHelp(import.meta.url)

const args = process.argv.slice(2)
const projectIndex = args.indexOf('--project')
const projectRoot = resolve(projectIndex >= 0 && args[projectIndex + 1] ? args[projectIndex + 1] : '.')
const telemetryPath = join(projectRoot, '_workspace', '04_qa', 'execution-telemetry.json')

// 메인 세션 문맥 기록(record-context-telemetry 훅) — 도구·대상별 결과 바이트 합. 무엇이 문맥을 채우는지 본다.
const contextPath = join(projectRoot, '_workspace', '04_qa', 'context-telemetry.jsonl')
if (existsSync(contextPath)) {
  const rows = readFileSync(contextPath, 'utf8').split('\n').flatMap(line => { try { return line ? [JSON.parse(line)] : [] } catch { return [] } })
  const sum = key => {
    const totals = new Map()
    for (const row of rows) {
      const name = key(row)
      const entry = totals.get(name) ?? {count: 0, bytes: 0}
      entry.count += 1
      entry.bytes += Number.isFinite(row.bytes) ? row.bytes : 0
      totals.set(name, entry)
    }
    return [...totals.entries()].sort((left, right) => right[1].bytes - left[1].bytes)
  }
  const total = rows.reduce((acc, row) => acc + (Number.isFinite(row.bytes) ? row.bytes : 0), 0)
  console.log(`=== 메인 세션 도구 결과: ${rows.length}회 · ${(total / 1024).toFixed(1)}KB ===`)
  for (const [tool, entry] of sum(row => row.tool)) console.log(`  ${tool}: ${entry.count}회 · ${(entry.bytes / 1024).toFixed(1)}KB`)
  console.log('  큰 대상 상위 10:')
  for (const [target, entry] of sum(row => `${row.tool} ${row.target ?? ''}`).slice(0, 10)) {
    console.log(`    ${target}: ${entry.count}회 · ${(entry.bytes / 1024).toFixed(1)}KB`)
  }
}

if (!existsSync(telemetryPath)) {
  console.log(`telemetry 없음: ${telemetryPath} — 오케스트레이터가 아직 스폰을 기록하지 않았다.`)
  process.exit(0)
}

let parsed
try {
  parsed = JSON.parse(readFileSync(telemetryPath, 'utf8'))
} catch (error) {
  console.error(`telemetry 파싱 실패: ${telemetryPath}: ${error.message}`)
  process.exit(1)
}

const spawns = Array.isArray(parsed?.spawns) ? parsed.spawns.filter(entry => entry && typeof entry === 'object') : null
if (parsed?.schemaVersion !== 1 || !spawns) {
  console.error(`telemetry 형식 오류: schemaVersion 1 + spawns 배열이 필요하다 (${telemetryPath})`)
  process.exit(1)
}
if (spawns.length === 0) {
  console.log('telemetry 파일은 있으나 기록된 스폰이 없다.')
  process.exit(0)
}

const asCount = value => (Number.isFinite(value) ? value : null)
const formatTokens = (sum, measured, total) =>
  measured === 0 ? '미계측' : `${sum.toLocaleString()} tokens (${measured}/${total} 스폰 계측)`

// execution-budget-contract.md "스폰 완결성 게이트" Layer 3 — per-spawn 규모 임계.
const RUNAWAY_TOKENS = 120_000
const RUNAWAY_DURATION_MS = 20 * 60_000

const runs = new Map()
for (const spawn of spawns) {
  const runKey = typeof spawn.run === 'string' && spawn.run ? spawn.run : '(run 미기록)'
  if (!runs.has(runKey)) runs.set(runKey, [])
  runs.get(runKey).push(spawn)
}

for (const [runKey, runSpawns] of runs) {
  console.log(`\n=== run: ${runKey} — 스폰 ${runSpawns.length}개 ===`)

  const phases = new Map()
  for (const spawn of runSpawns) {
    const phaseKey = typeof spawn.phase === 'string' && spawn.phase ? spawn.phase : '(phase 미기록)'
    if (!phases.has(phaseKey)) phases.set(phaseKey, {spawnCount: 0, retryCount: 0, tokenSum: 0, tokenMeasured: 0, durationMs: 0})
    const phase = phases.get(phaseKey)
    phase.spawnCount += 1
    if (spawn.retry === true) phase.retryCount += 1
    const tokens = asCount(spawn.tokens)
    if (tokens !== null) {
      phase.tokenSum += tokens
      phase.tokenMeasured += 1
    }
    const duration = asCount(spawn.durationMs)
    if (duration !== null) phase.durationMs += duration
  }

  for (const [phaseKey, phase] of [...phases.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const minutes = phase.durationMs > 0 ? ` · ${(phase.durationMs / 60000).toFixed(1)}min` : ''
    console.log(
      `  ${phaseKey}: 스폰 ${phase.spawnCount} (retry ${phase.retryCount}) · ` +
      `${formatTokens(phase.tokenSum, phase.tokenMeasured, phase.spawnCount)}${minutes}`,
    )
  }

  const agents = new Map()
  for (const spawn of runSpawns) {
    const agentKey = typeof spawn.agent === 'string' && spawn.agent ? spawn.agent : '(agent 미기록)'
    const tokens = asCount(spawn.tokens)
    if (tokens === null) continue
    agents.set(agentKey, (agents.get(agentKey) ?? 0) + tokens)
  }
  const topAgents = [...agents.entries()].sort(([, a], [, b]) => b - a).slice(0, 5)
  if (topAgents.length > 0) {
    console.log('  토큰 상위 agent:')
    for (const [agentKey, tokens] of topAgents) console.log(`    ${agentKey}: ${tokens.toLocaleString()}`)
  }

  const outcomes = new Map()
  for (const spawn of runSpawns) {
    const key = typeof spawn.outcome === 'string' && spawn.outcome ? spawn.outcome : '(미판정)'
    outcomes.set(key, (outcomes.get(key) ?? 0) + 1)
  }
  const outcomeParts = [...outcomes.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k} ${v}`)
  console.log(`  완결성 outcome: ${outcomeParts.join(' · ')}`)
  const incompleteCount = ['truncated', 'crashed', 'incomplete'].reduce((sum, k) => sum + (outcomes.get(k) ?? 0), 0)
  if (incompleteCount > 0) {
    console.log(`    ⚠️  미완 스폰 ${incompleteCount}개 — 완결성 게이트 실패가 있었다. 깨진 산출물 위에 다음 단계를 쌓지 않았는지 확인.`)
  }

  const runaway = runSpawns.filter(
    spawn => (asCount(spawn.tokens) ?? 0) > RUNAWAY_TOKENS || (asCount(spawn.durationMs) ?? 0) > RUNAWAY_DURATION_MS,
  )
  if (runaway.length > 0) {
    console.log(`  🐘 runaway 스폰 ${runaway.length}개 (>${RUNAWAY_TOKENS.toLocaleString()} tokens 또는 >20min):`)
    for (const spawn of runaway) {
      const tokens = asCount(spawn.tokens)
      const duration = asCount(spawn.durationMs)
      const tokenLabel = tokens !== null ? `${tokens.toLocaleString()} tokens` : 'tokens 미계측'
      const durationLabel = duration !== null ? ` · ${(duration / 60000).toFixed(1)}min` : ''
      console.log(`    ${spawn.agent ?? '(agent 미기록)'} [${spawn.phase ?? '?'}]: ${tokenLabel}${durationLabel}`)
    }
  }

  const totalRetries = runSpawns.filter(spawn => spawn.retry === true).length
  const totalTokens = runSpawns.reduce((sum, spawn) => sum + (asCount(spawn.tokens) ?? 0), 0)
  const totalMeasured = runSpawns.filter(spawn => asCount(spawn.tokens) !== null).length
  console.log(
    `  합계: 스폰 ${runSpawns.length} · retry ${totalRetries} (${((totalRetries / runSpawns.length) * 100).toFixed(0)}%) · ` +
    formatTokens(totalTokens, totalMeasured, runSpawns.length),
  )
}
