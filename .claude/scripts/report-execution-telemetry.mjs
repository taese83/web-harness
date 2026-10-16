#!/usr/bin/env node
// report-execution-telemetry.mjs — 실행 telemetry 집계 (advisory, gate 아님).
// 사용법: node .claude/scripts/report-execution-telemetry.mjs --project <root> [--emit <path> [--run-suffix <+라벨>]]
// 0 = 집계 출력(기록 없음 포함), 1 = --emit 쓰기 실패, 2 = 사용법 오류.
//
// 원천은 `_workspace/04_qa/context-telemetry.jsonl` 하나다 — 스폰은 SubagentStop 훅(record-subagent-telemetry)이 기록하고
// 오케스트레이터는 손으로 옮기지 않는다. run = 메인 세션, 스폰 = agentId(이어받은 멈춤은 접는다).
// `--emit`은 같은 집계를 execution-telemetry 형식(schemaVersion 1 `spawns[]`)으로 쓴다 — 실험 분석기(analyze-ab) 입력용.
// `tokens`는 스폰의 최대 contextTokens(런타임 스폰 보고와 같은 뜻)이고 `outcome`·`retry`는 기록되지 않는다(미판정 — 지어내지 않는다).
// cap 판정·release gate와 무관하며, 스폰 예산 조정과 재읽기 비용 진단의 근거 자료다.

import {closeSync, constants, existsSync, openSync, readFileSync, writeSync} from 'node:fs'
import {join, relative, resolve, sep} from 'node:path'
import {answerHelp} from './cli-help-lib.mjs'

answerHelp(import.meta.url)

const args = process.argv.slice(2)
const optionValue = name => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}
const projectRoot = resolve(optionValue('--project') ?? '.')
const emitPath = optionValue('--emit')
const runSuffix = optionValue('--run-suffix') ?? ''
if ((args.includes('--emit') && !emitPath) || (runSuffix && !/^\+[A-Za-z0-9-]+$/.test(runSuffix))) {
  console.error('사용법: --emit <path> · --run-suffix는 `+라벨`(영숫자·-)이다')
  process.exit(2)
}

// 메인 세션 문맥 기록(record-context-telemetry 훅) — 도구·대상별 결과 바이트 합. 무엇이 문맥을 채우는지 본다.
const contextPath = join(projectRoot, '_workspace', '04_qa', 'context-telemetry.jsonl')
if (!existsSync(contextPath)) {
  console.log(`기록 없음: ${contextPath} — 하네스 훅이 아직 아무것도 기록하지 않았다.`)
  if (!emitPath) process.exit(0)
}
const all = !existsSync(contextPath) ? [] : readFileSync(contextPath, 'utf8').split('\n')
  .flatMap(line => { try { return line ? [JSON.parse(line)] : [] } catch { return [] } })
{
  const rows = all.filter(row => row.kind !== 'deny' && row.kind !== 'subagent')
  // 서브에이전트 실측(record-subagent-telemetry 훅) — 행은 멈춤 하나이고 서로 겹치지 않는다(이어받은 스폰은 멈출 때마다 직전 이후만).
  // 스폰(agentId)별로 접어 스폰 수·소요(지시 대기 제외)·턴을 보인다. 어느 에이전트가 느린지 본다.
  const subagents = all.filter(row => row.kind === 'subagent')
  if (subagents.length > 0) {
    const spawns = new Map()
    for (const [index, row] of subagents.entries()) {
      const key = typeof row.agentId === 'string' && row.agentId ? row.agentId : `(id 미기록 ${index})`
      const spawn = spawns.get(key) ?? {agent: typeof row.agent === 'string' && row.agent ? row.agent : '(agent 미기록)', stops: 0, measured: false, durationMs: 0, turns: 0, tools: 0}
      spawn.stops += 1
      if (Number.isFinite(row.durationMs)) {
        spawn.measured = true
        spawn.durationMs += row.durationMs
        spawn.turns += Number.isFinite(row.turns) ? row.turns : 0
        spawn.tools += Object.values(row.toolUses ?? {}).reduce((sum, count) => sum + (Number.isFinite(count) ? count : 0), 0)
      }
      spawns.set(key, spawn)
    }
    const byAgent = new Map()
    for (const spawn of spawns.values()) {
      const entry = byAgent.get(spawn.agent) ?? {spawns: 0, stops: 0, measured: 0, durationMs: 0, maxMs: 0, turns: 0, tools: 0}
      entry.spawns += 1
      entry.stops += spawn.stops
      if (spawn.measured) {
        entry.measured += 1
        entry.durationMs += spawn.durationMs
        entry.maxMs = Math.max(entry.maxMs, spawn.durationMs)
        entry.turns += spawn.turns
        entry.tools += spawn.tools
      }
      byAgent.set(spawn.agent, entry)
    }
    const minutes = ms => (ms / 60000).toFixed(1)
    console.log(`=== 서브에이전트 실측: 스폰 ${spawns.size} · 멈춤 ${subagents.length} (소요는 지시 대기 제외) ===`)
    for (const [agent, entry] of [...byAgent.entries()].sort((left, right) => right[1].durationMs - left[1].durationMs)) {
      const unmeasured = entry.spawns - entry.measured
      const measured = entry.measured === 0 ? '미계측' : `합 ${minutes(entry.durationMs)}min · 평균 ${minutes(entry.durationMs / entry.measured)}min · 최대 ${minutes(entry.maxMs)}min · ` +
        `평균 턴 ${(entry.turns / entry.measured).toFixed(1)} · 평균 도구 ${(entry.tools / entry.measured).toFixed(1)}`
      console.log(`  ${agent}: 스폰 ${entry.spawns} · 멈춤 ${entry.stops} · ${measured}${unmeasured > 0 && entry.measured > 0 ? ` (미계측 ${unmeasured})` : ''}`)
    }
  }
  // 훅 거부(hook-denial-log-lib) — 훅·코드별 건수와 같은 대상이 되풀이된 것(재시도로 새는 오탐 후보)을 본다.
  const denials = all.filter(row => row.kind === 'deny')
  if (denials.length > 0) {
    const byCode = new Map()
    for (const row of denials) { const key = `${row.hook} ${row.code}`; byCode.set(key, (byCode.get(key) ?? 0) + 1) }
    console.log(`=== 훅 거부: ${denials.length}회 (메인 ${denials.filter(row => !row.agent).length} · 서브에이전트 ${denials.filter(row => row.agent).length}) ===`)
    for (const [key, count] of [...byCode.entries()].sort((left, right) => right[1] - left[1]).slice(0, 10)) console.log(`  ${key}: ${count}회`)
    const targets = new Map()
    for (const row of denials) { const key = `${row.hook} ${row.target ?? ''}`; targets.set(key, (targets.get(key) ?? 0) + 1) }
    const repeated = [...targets.entries()].filter(([, count]) => count > 1).sort((left, right) => right[1] - left[1]).slice(0, 5)
    if (repeated.length > 0) {
      console.log('  같은 대상 반복 거부(오탐 후보):')
      for (const [key, count] of repeated) console.log(`    ${key}: ${count}회`)
    }
  }
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


// run·스폰 보기 — 체크포인트의 토큰 합계와 Layer 3 runaway 임계(execution-budget-contract.md)의 데이터다.
// execution-budget-contract.md "스폰 완결성 게이트" Layer 3 — per-spawn 규모 임계(최대 문맥 토큰 · 이어받은 멈춤까지 합한 소요).
const RUNAWAY_TOKENS = 120_000
const RUNAWAY_DURATION_MS = 20 * 60_000
const finite = value => Number.isFinite(value)
const spawnsById = new Map()
for (const [index, row] of all.filter(entry => entry.kind === 'subagent').entries()) {
  const key = typeof row.agentId === 'string' && row.agentId ? row.agentId : `(id 미기록 ${index})`
  const spawn = spawnsById.get(key) ?? {
    session: typeof row.session === 'string' && row.session ? row.session : '(session 미기록)', firstAt: row.at ?? '',
    agent: typeof row.agent === 'string' && row.agent ? row.agent : '(agent 미기록)', agentId: row.agentId ?? null, description: null,
    stops: 0, resumes: 0, durationMs: null, turns: null, toolUses: null, contextTokens: null, processedTokens: null, outputTokens: null,
  }
  spawn.stops += 1
  if (row.resumed === true) spawn.resumes += 1
  if (typeof row.description === 'string' && !spawn.description) spawn.description = row.description
  const add = (field, value) => { if (finite(value)) spawn[field] = (spawn[field] ?? 0) + value }
  add('durationMs', row.durationMs)
  add('turns', row.turns)
  add('processedTokens', row.processedTokens)
  add('outputTokens', row.outputTokens)
  if (row.toolUses && typeof row.toolUses === 'object') add('toolUses', Object.values(row.toolUses).reduce((sum, count) => sum + (finite(count) ? count : 0), 0))
  if (finite(row.contextTokens)) spawn.contextTokens = Math.max(spawn.contextTokens ?? 0, row.contextTokens)
  spawnsById.set(key, spawn)
}
const runs = new Map()
for (const spawn of spawnsById.values()) {
  if (!runs.has(spawn.session)) runs.set(spawn.session, [])
  runs.get(spawn.session).push(spawn)
}
const runLabel = runSpawns => `${runSpawns.map(spawn => spawn.firstAt).filter(Boolean).sort()[0] ?? '(시각 미기록)'}+${runSpawns[0].session.slice(0, 8)}${runSuffix}`
const sumOf = (list, field) => list.reduce((sum, spawn) => sum + (spawn[field] ?? 0), 0)
const spawnName = spawn => `${spawn.agent}${spawn.description ? ` 「${spawn.description}」` : ''}`

for (const runSpawns of runs.values()) {
  const measured = runSpawns.filter(spawn => spawn.contextTokens !== null)
  console.log(`=== run: ${runLabel(runSpawns)} — 스폰 ${runSpawns.length} · 멈춤 ${sumOf(runSpawns, 'stops')} · 이어받기 ${sumOf(runSpawns, 'resumes')} ===`)
  console.log(measured.length === 0 ? '  토큰: 미계측' : `  토큰: 문맥 합 ${sumOf(measured, 'contextTokens').toLocaleString()} · 처리 합 ${sumOf(measured, 'processedTokens').toLocaleString()} · ` +
    `출력 합 ${sumOf(measured, 'outputTokens').toLocaleString()} (${measured.length}/${runSpawns.length} 스폰 계측)`)
  const byAgent = new Map()
  for (const spawn of measured) byAgent.set(spawn.agent, (byAgent.get(spawn.agent) ?? 0) + spawn.processedTokens)
  const top = [...byAgent.entries()].sort(([, left], [, right]) => right - left).slice(0, 5)
  if (top.length > 0) console.log(`  처리 토큰 상위 agent: ${top.map(([agent, tokens]) => `${agent} ${tokens.toLocaleString()}`).join(' · ')}`)
  const runaway = runSpawns.filter(spawn => (spawn.contextTokens ?? 0) > RUNAWAY_TOKENS || (spawn.durationMs ?? 0) > RUNAWAY_DURATION_MS)
  if (runaway.length > 0) {
    console.log(`  🐘 runaway 스폰 ${runaway.length}개 (문맥 >${RUNAWAY_TOKENS.toLocaleString()} tokens 또는 >20min):`)
    for (const spawn of runaway) {
      const tokens = spawn.contextTokens !== null ? `문맥 ${spawn.contextTokens.toLocaleString()} tokens` : 'tokens 미계측'
      const duration = spawn.durationMs !== null ? ` · ${(spawn.durationMs / 60000).toFixed(1)}min` : ''
      console.log(`    ${spawnName(spawn)}: ${tokens}${duration}`)
    }
  }
}

if (emitPath) {
  const target = resolve(emitPath)
  const spawns = [...runs.values()].flatMap(runSpawns => runSpawns.map(spawn => ({
    run: runLabel(runSpawns), agent: spawn.agent, agentId: spawn.agentId, description: spawn.description,
    stops: spawn.stops, resumes: spawn.resumes, tokens: spawn.contextTokens, processedTokens: spawn.processedTokens,
    outputTokens: spawn.outputTokens, toolUses: spawn.toolUses, durationMs: spawn.durationMs,
  })))
  try {
    const inside = relative(projectRoot, target)
    if (!inside || inside === '..' || inside.startsWith(`..${sep}`)) throw new Error('프로젝트 밖에는 쓰지 않는다')
    // 링크(끊긴 링크 포함)는 따라가지 않는다 — 다른 곳에 파일을 만든다.
    const descriptor = openSync(target, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600)
    try { writeSync(descriptor, JSON.stringify({schemaVersion: 1, source: 'context-telemetry.jsonl', spawns}, null, 2) + '\n') } finally { closeSync(descriptor) }
  } catch (error) {
    console.error(`--emit 실패: ${target}: ${error.message}`)
    process.exit(1)
  }
  console.log(`execution-telemetry 형식으로 썼다: ${target} (스폰 ${spawns.length})`)
}
