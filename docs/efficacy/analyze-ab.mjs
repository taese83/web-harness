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
//
// outcome 미상 fail-closed (사전등록 변경 #2, 2026-08-26):
//   최초 구현은 `INCOMPLETE.has(spawn.outcome)`만 보고 분모에는 전 스폰을 넣어서,
//   outcome이 기록되지 않은 스폰이 **조용히 "완주"로 집계**됐다(fail-open). 2026-08-26 실측:
//   한 OFF run의 스폰 3개가 전부 `outcome: undefined`였다. 게다가 이 필드는 측정 대상인
//   오케스트레이터의 **자기보고**다 — 미상을 성공으로 세면 게이트 효능이 체계적으로 과대평가된다.
//   이제 미상은 분자·분모 양쪽에서 제외하고 그 수를 보고하며, 한 run의 미상 비율이
//   UNKNOWN_RATIO_INVALID를 넘으면 그 run을 **무효로 표시**한다(자동 판정 없음, §4 등록).
import {readFileSync} from 'node:fs'

const INCOMPLETE = new Set(['truncated', 'crashed', 'incomplete'])
// 한 run의 스폰 중 이 비율을 넘게 outcome이 미상이면 그 run은 해석 불가로 본다.
export const UNKNOWN_RATIO_INVALID = 0.2

// outcome을 3분류한다. 계약 어휘(execution-budget-contract.md)는 4종으로 고정돼 있다:
// complete | truncated | crashed | incomplete. **어휘 밖 문자열은 완주가 아니라 미상이다** —
// outcome은 측정 대상의 자기보고라 어휘 이탈 한 번이 곧 편향이 된다(적대 리뷰 2026-08-26).
export const classifyOutcome = outcome => {
  if (typeof outcome !== 'string') return 'unknown'
  const value = outcome.trim()
  if (value === 'complete') return 'complete'
  if (INCOMPLETE.has(value)) return 'incomplete'
  return 'unknown'
}

// ── 주 엔드포인트: runaway율 (사전등록 변경 #3, 2026-08-26) ──────────────────────
// 왜 바꿨나: 미완율의 원천인 `outcome`은 **완결성 게이트의 판정 결과**이고
// (execution-budget-contract.md: "게이트를 돌리지 않았으면 outcome을 생략한다"),
// OFF 암이 끄는 3게이트 중 하나가 바로 그 게이트다. 즉 미완율은 OFF 암에서 정의상 측정
// 불가라 암 간 비교가 성립하지 않는다 — 온도계를 뺀 뒤 그 온도계로 온도를 읽는 구조였다.
// runaway율은 tokens/durationMs에서 나오고 이 둘은 게이트와 무관하게 기록된다(암 독립).
// 임계는 §2에서 ON 참조값을 산출할 때 이미 고정된 값이며 데이터를 보고 고르지 않았다.
// §3이 이 지표를 주 엔드포인트에서 뺀 사유는 "임계가 형태 의존이라 2형태 비교에 부적합"인데
// Stage 1은 단일 형태 within-form 비교라 그 사유가 적용되지 않는다.
export const RUNAWAY_TOKENS = 120_000
export const RUNAWAY_DURATION_MS = 20 * 60 * 1000

// 이벤트 분류기 공통 계약: 'event' | 'nonevent' | 'unknown'.
// 두 신호가 모두 없으면 unknown이다 — 없는 값을 nonevent(정상)로 세지 않는다(fail-closed).
// tokens는 usage 미제공 환경에서 계약상 null일 수 있으므로 duration 단독 판정도 유효하다.
export const classifyRunaway = spawn => {
  const tokens = typeof spawn.tokens === 'number' ? spawn.tokens : null
  const duration = typeof spawn.durationMs === 'number' ? spawn.durationMs : null
  if (tokens === null && duration === null) return 'unknown'
  if (tokens !== null && tokens > RUNAWAY_TOKENS) return 'event'
  if (duration !== null && duration > RUNAWAY_DURATION_MS) return 'event'
  return 'nonevent'
}

// 부 엔드포인트(기술 통계 전용). OFF 암에서는 구조적으로 unknown이 되므로 비교에 쓰지 않는다.
export const classifyIncomplete = spawn => {
  const classification = classifyOutcome(spawn.outcome)
  if (classification === 'unknown') return 'unknown'
  return classification === 'incomplete' ? 'event' : 'nonevent'
}

export const armOf = runLabel => {
  if (typeof runLabel !== 'string') return null
  if (runLabel.includes('+gatesOff')) return 'off'
  if (runLabel.includes('+gatesOn')) return 'on'
  return null
}

// 스폰을 (암, 클러스터=run 라벨)로 묶는다.
export const collectArms = (spawnLists, classify = classifyIncomplete) => {
  const arms = {on: new Map(), off: new Map()}
  let unlabeled = 0
  for (const spawns of spawnLists) {
    for (const spawn of spawns) {
      const arm = armOf(spawn.run)
      if (arm === null) {
        unlabeled += 1
        continue
      }
      const cluster = arms[arm].get(spawn.run) ?? {n: 0, events: 0, unknown: 0}
      const classification = classify(spawn)
      if (classification === 'unknown') {
        cluster.unknown += 1
      } else {
        cluster.n += 1
        if (classification === 'event') cluster.events += 1
      }
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
  const unknownTotal = list.reduce((s, c) => s + (c.unknown ?? 0), 0)
  // 미상 비율이 임계를 넘는 run은 해석 불가로 표시한다(제외가 아니라 표시 — 조용한 절단 금지).
  const invalidRuns = [...clusters.entries()]
    .filter(([, c]) => {
      const total = c.n + (c.unknown ?? 0)
      return total > 0 && (c.unknown ?? 0) / total > UNKNOWN_RATIO_INVALID
    })
    .map(([label, c]) => ({run: label, unknown: c.unknown ?? 0, classified: c.n}))
  const k = list.length
  const base = {unknown: unknownTotal, invalidRuns}
  if (nTotal === 0) return {...base, rate: null, se: null, n: 0, events: 0, clusters: 0}
  const rate = eTotal / nTotal
  // k<2면 클러스터 간 분산을 추정할 수 없다 — SE를 null로 두고 CI를 만들지 않는다.
  if (k < 2) return {...base, rate, se: null, n: nTotal, events: eTotal, clusters: k}
  const meanN = nTotal / k
  const resid = list.map(c => c.events - rate * c.n)
  const ss = resid.reduce((s, r) => s + r * r, 0)
  const varRate = (k / ((k - 1) * nTotal * nTotal)) * ss
  return {...base, rate, se: Math.sqrt(varRate), n: nTotal, events: eTotal, clusters: k, meanClusterSize: meanN}
}

// 암 준수 검증(계획서 §6 교란 통제) — OFF 암인데 오케스트레이터가 습관적으로 게이트를
// 호출했다면 암 구분이 무너진다. executor.log(트레이스)에서 3게이트 호출 흔적을 센다.
// **자기보고(프롬프트 준수)를 믿지 않고 로그로 확인**하는 것이 요점이다.
// 한계(정직): 로그에 남는 문자열 매칭이라 게이트를 다른 경로로 호출하면 놓칠 수 있다 —
// 이것은 오염 탐지용 하한이지 준수의 증명이 아니다.
export const GATE_SCRIPTS = ['validate-spawn-plan', 'verify-spawn-completion', 'resume-manifest']

// 구조적 오탐 차단(적대 리뷰 2026-08-26): executor.log 첫 줄 `# command:`는 **프롬프트 전문을
// 에코**하는데, OFF armInstruction이 3게이트 스크립트 이름을 명시한다. 헤더를 세면 모든 OFF run이
// counts.total >= 3으로 자동 폐기 판정을 받는다. 따라서 (1) `# command:` 헤더 블록을 제외하고
// (2) 이름 언급이 아니라 **실호출 형태**(`node ... <gate>.mjs`)만 센다.
export const stripCommandHeader = logText => {
  const lines = String(logText).split('\n')
  if (!lines[0]?.startsWith('# command:')) return logText
  // 헤더는 `# exit:` 줄까지 이어진다(프롬프트가 여러 줄일 수 있다).
  const end = lines.findIndex(line => line.startsWith('# exit:'))
  return lines.slice(end === -1 ? 1 : end + 1).join('\n')
}

export const countGateInvocations = logText => {
  const body = stripCommandHeader(logText)
  const counts = {}
  for (const gate of GATE_SCRIPTS) {
    const escaped = gate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // 실호출만: `node <공백없는경로><gate>.mjs`. `[^\n]*`를 쓰면 한 줄 안의 다른 호출을 건너뛰어
    // 매칭돼 오탐이 나므로 공백 없는 경로 토큰(\S*)으로 좁힌다.
    counts[gate] = (body.match(new RegExp(`node\\s+\\S*${escaped}\\.mjs`, 'g')) ?? []).length
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

export const compareArms = ({arms, unlabeled}, endpoint = 'incomplete-rate') => {
  const on = clusterRate(arms.on)
  const off = clusterRate(arms.off)
  const comparable = on.rate !== null && off.rate !== null
  const diff = comparable ? off.rate - on.rate : null
  const seDiff = on.se !== null && off.se !== null ? Math.sqrt(on.se ** 2 + off.se ** 2) : null
  const invalidRuns = [...on.invalidRuns, ...off.invalidRuns]
  return {
    endpoint,
    on, off, unlabeled,
    unknownSpawns: on.unknown + off.unknown,
    invalidRuns,
    // 미상 비율이 임계를 넘는 run이 있으면 수치를 해석하지 말라고 못박는다.
    interpretable: invalidRuns.length === 0,
    riskDifferencePp: diff === null ? null : diff * 100,
    ci95Pp: seDiff === null || diff === null ? null : [(diff - 1.96 * seDiff) * 100, (diff + 1.96 * seDiff) * 100],
    // 판정을 자동으로 내리지 않는다 — 계획서 §7의 주장 한계표를 사람이 적용한다.
    verdict: invalidRuns.length > 0
      ? `DATA_INVALID — 미상 비율이 임계(${UNKNOWN_RATIO_INVALID * 100}%)를 넘는 run ${invalidRuns.length}개. 수치를 해석하지 말고 계측을 먼저 고쳐라`
      : 'NO_AUTOMATIC_VERDICT — outcome-efficacy-ab-plan.md §7 주장 한계표를 적용하라',
  }
}

// 주 엔드포인트(runaway율, 암 독립)와 부 엔드포인트(미완율, ON 암 기술 통계)를 함께 낸다.
// 부 엔드포인트는 **비교에 쓰지 않는다** — OFF 암에서 구조적으로 측정 불가다(변경 #3).
export const analyze = spawnLists => ({
  primary: compareArms(collectArms(spawnLists, classifyRunaway), 'runaway-rate'),
  secondaryDescriptive: compareArms(collectArms(spawnLists, classifyIncomplete), 'incomplete-rate'),
})

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
  const result = analyze(lists)
  if (argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    const fmt = a => a.rate === null ? `데이터 없음${a.unknown > 0 ? ` (미상 ${a.unknown}개뿐)` : ''}` :
      `${(a.rate * 100).toFixed(1)}% (${a.events}/${a.n}, run ${a.clusters}개)` +
      `${a.unknown > 0 ? `, 미상 ${a.unknown}개 제외` : ''}` +
      `${a.se === null ? ' — run<2라 CI 산출 불가' : ''}`
    const report = (r, title, note) => {
      console.log(title)
      if (note) console.log(`  ${note}`)
      console.log(`  ON : ${fmt(r.on)}`)
      console.log(`  OFF: ${fmt(r.off)}`)
      if (r.unlabeled > 0) console.log(`  ⚠️ 암 라벨 없는 스폰 ${r.unlabeled}개 — 분석에서 제외(한쪽에 넣지 않음)`)
      if (r.unknownSpawns > 0) console.log(`  ⚠️ 미상 스폰 ${r.unknownSpawns}개 — 정상으로 세지 않고 분자·분모 양쪽에서 제외했다`)
      for (const x of r.invalidRuns) console.log(`  ⛔ run 무효: ${x.run} — 미상 ${x.unknown}개 / 분류가능 ${x.classified}개`)
      if (r.riskDifferencePp === null) console.log('  → 양쪽 암 데이터가 있어야 비교 가능하다.')
      else {
        console.log(`  위험차(OFF−ON): ${r.riskDifferencePp >= 0 ? '+' : ''}${r.riskDifferencePp.toFixed(1)}pp`)
        console.log(r.ci95Pp ? `  95% CI: [${r.ci95Pp[0].toFixed(1)}, ${r.ci95Pp[1].toFixed(1)}]pp (클러스터-로버스트)`
                             : '  95% CI: 산출 불가(한쪽 arm의 run이 2개 미만) — 계획서 §7대로 "n=1 관찰"로만 보고하라')
      }
      console.log(`  ${r.verdict}`)
    }
    report(result.primary,
      `주 엔드포인트: runaway율 (tokens>${RUNAWAY_TOKENS.toLocaleString()} 또는 durationMs>${RUNAWAY_DURATION_MS / 60000}분)`,
      '암 독립 — tokens·durationMs는 게이트 호출 여부와 무관하게 기록된다')
    console.log('')
    report(result.secondaryDescriptive,
      '부 엔드포인트(기술 통계 전용): 미완율 (truncated|crashed|incomplete)',
      '⚠️ 암 간 비교에 쓰지 마라 — outcome은 완결성 게이트의 판정 결과라 OFF 암에서는 계약상 생략된다(변경 #3)')
  }
}
