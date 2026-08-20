#!/usr/bin/env node
// analyze-ab.mjs — 결과 효능 A/B 분석 (M2 Part 2).
//
// **데이터 수집 전에 작성·커밋된 사전등록 분석기다**(outcome-efficacy-ab-plan.md §3).
// 수집 후 엔드포인트나 분석을 바꾸면 원하는 답이 나온다 — 그래서 여기 고정한다.
//
// 주 엔드포인트: 미완율 = outcome ∈ {truncated, crashed, incomplete} / 전체 스폰.
// 분석 단위: 스폰. 클러스터: run(앱 1개 빌드) — 같은 run 안의 스폰은 독립이 아니다.
// 보고: 위험차(pp)와 클러스터-로버스트 95% CI. p-value 단독 보고 금지(계획서 §3).
//
// 사용법:
//   node docs/efficacy/analyze-ab.mjs --telemetry <path>...   # 여러 run 파일을 합산
//   node docs/efficacy/analyze-ab.mjs --telemetry a.json --json
//
// 암 판정: telemetry `run` 라벨의 `+gatesOn` / `+gatesOff` 접미(계획서 §5 Stage 0-2).
// 라벨이 없는 스폰은 **암 미상으로 제외하고 그 수를 보고한다** — 조용히 한쪽에 넣지 않는다.
import {readFileSync} from 'node:fs'

const INCOMPLETE = new Set(['truncated', 'crashed', 'incomplete'])

export const armOf = runLabel => {
  if (typeof runLabel !== 'string') return null
  if (runLabel.includes('+gatesOff')) return 'off'
  if (runLabel.includes('+gatesOn')) return 'on'
  return null
}

// 스폰을 (암, 클러스터=run 라벨)로 묶는다.
export const collectArms = spawnLists => {
  const arms = {on: new Map(), off: new Map()}
  let unlabeled = 0
  for (const spawns of spawnLists) {
    for (const spawn of spawns) {
      const arm = armOf(spawn.run)
      if (arm === null) {
        unlabeled += 1
        continue
      }
      const cluster = arms[arm].get(spawn.run) ?? {n: 0, events: 0}
      cluster.n += 1
      if (INCOMPLETE.has(spawn.outcome)) cluster.events += 1
      arms[arm].set(spawn.run, cluster)
    }
  }
  return {arms, unlabeled}
}

// 클러스터-로버스트 비율 추정. 클러스터 합계 기반 분산(비율 추정량의 선형화) —
// run 수가 적으면 CI가 매우 넓게 나오는데, 그것이 정직한 표현이다.
export const clusterRate = clusters => {
  const list = [...clusters.values()]
  const nTotal = list.reduce((s, c) => s + c.n, 0)
  const eTotal = list.reduce((s, c) => s + c.events, 0)
  const k = list.length
  if (nTotal === 0) return {rate: null, se: null, n: 0, events: 0, clusters: 0}
  const rate = eTotal / nTotal
  // k<2면 클러스터 간 분산을 추정할 수 없다 — SE를 null로 두고 CI를 만들지 않는다.
  if (k < 2) return {rate, se: null, n: nTotal, events: eTotal, clusters: k}
  const meanN = nTotal / k
  const resid = list.map(c => c.events - rate * c.n)
  const ss = resid.reduce((s, r) => s + r * r, 0)
  const varRate = (k / ((k - 1) * nTotal * nTotal)) * ss
  return {rate, se: Math.sqrt(varRate), n: nTotal, events: eTotal, clusters: k, meanClusterSize: meanN}
}

// 암 준수 검증(계획서 §6 교란 통제) — OFF 암인데 오케스트레이터가 습관적으로 게이트를
// 호출했다면 암 구분이 무너진다. executor.log(트레이스)에서 3게이트 호출 흔적을 센다.
// **자기보고(프롬프트 준수)를 믿지 않고 로그로 확인**하는 것이 요점이다.
// 한계(정직): 로그에 남는 문자열 매칭이라 게이트를 다른 경로로 호출하면 놓칠 수 있다 —
// 이것은 오염 탐지용 하한이지 준수의 증명이 아니다.
export const GATE_SCRIPTS = ['validate-spawn-plan', 'verify-spawn-completion', 'resume-manifest']

export const countGateInvocations = logText => {
  const counts = {}
  for (const gate of GATE_SCRIPTS) {
    counts[gate] = (logText.match(new RegExp(gate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length
  }
  counts.total = GATE_SCRIPTS.reduce((s, g) => s + counts[g], 0)
  return counts
}

// OFF run은 total이 0이어야 유효하다. 0이 아니면 그 run은 **폐기 대상**이며,
// 판정을 자동으로 내리지 않고 폐기 권고와 근거 수치를 돌려준다.
export const checkArmCompliance = (arm, logText) => {
  const counts = countGateInvocations(logText)
  if (arm !== 'off') return {arm, counts, compliant: true, note: 'ON 암은 게이트 호출이 정상이다'}
  return {
    arm, counts,
    compliant: counts.total === 0,
    note: counts.total === 0
      ? 'OFF 암에서 게이트 호출 흔적 0 — 암 구분 유지'
      : `OFF 암인데 게이트 호출 흔적 ${counts.total}건 — 계획서 §6에 따라 이 run은 폐기 대상이다`,
  }
}

export const compareArms = ({arms, unlabeled}) => {
  const on = clusterRate(arms.on)
  const off = clusterRate(arms.off)
  const comparable = on.rate !== null && off.rate !== null
  const diff = comparable ? off.rate - on.rate : null
  const seDiff = on.se !== null && off.se !== null ? Math.sqrt(on.se ** 2 + off.se ** 2) : null
  return {
    endpoint: 'incomplete-rate',
    on, off, unlabeled,
    riskDifferencePp: diff === null ? null : diff * 100,
    ci95Pp: seDiff === null || diff === null ? null : [(diff - 1.96 * seDiff) * 100, (diff + 1.96 * seDiff) * 100],
    // 판정을 자동으로 내리지 않는다 — 계획서 §7의 주장 한계표를 사람이 적용한다.
    verdict: 'NO_AUTOMATIC_VERDICT — outcome-efficacy-ab-plan.md §7 주장 한계표를 적용하라',
  }
}

const paths = []
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--telemetry') { while (argv[i + 1] && !argv[i + 1].startsWith('--')) { paths.push(argv[i + 1]); i += 1 } }
}
if (import.meta.url === `file://${process.argv[1]}`) {
  if (paths.length === 0) {
    console.error('사용법: node docs/efficacy/analyze-ab.mjs --telemetry <execution-telemetry.json>... [--json]')
    process.exit(2)
  }
  const lists = paths.map(p => JSON.parse(readFileSync(p, 'utf8')).spawns ?? [])
  const result = compareArms(collectArms(lists))
  if (argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    const fmt = a => a.rate === null ? '데이터 없음' :
      `${(a.rate * 100).toFixed(1)}% (${a.events}/${a.n}, run ${a.clusters}개)${a.se === null ? ' — run<2라 CI 산출 불가' : ''}`
    console.log(`주 엔드포인트: 미완율 (truncated|crashed|incomplete)`)
    console.log(`  ON : ${fmt(result.on)}`)
    console.log(`  OFF: ${fmt(result.off)}`)
    if (result.unlabeled > 0) console.log(`  ⚠️ 암 라벨 없는 스폰 ${result.unlabeled}개 — 분석에서 제외(한쪽에 넣지 않음)`)
    if (result.riskDifferencePp === null) console.log('  → 양쪽 암 데이터가 있어야 비교 가능하다.')
    else {
      console.log(`  위험차(OFF−ON): ${result.riskDifferencePp >= 0 ? '+' : ''}${result.riskDifferencePp.toFixed(1)}pp`)
      console.log(result.ci95Pp ? `  95% CI: [${result.ci95Pp[0].toFixed(1)}, ${result.ci95Pp[1].toFixed(1)}]pp (클러스터-로버스트)`
                                : '  95% CI: 산출 불가(한쪽 arm의 run이 2개 미만) — 계획서 §7대로 "n=1 관찰"로만 보고하라')
    }
    console.log(`  ${result.verdict}`)
  }
}
