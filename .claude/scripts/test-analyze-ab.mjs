#!/usr/bin/env node
// test-analyze-ab.mjs — 결과 효능 A/B 분석기 회귀 (사전등록 분석의 안전망).
//
// 왜: 분석기는 **데이터 수집 전에** 고정돼야 의미가 있다(p-hacking 차단). 그런데 분석기
// 자체가 조용히 틀리면 사전등록이 장식이 된다. 여기서 고정하는 사실:
//   (1) 암 판정은 run 라벨 접미로만 하고, 라벨 없는 스폰은 제외하고 그 수를 보고한다
//   (2) 미완 정의는 truncated|crashed|incomplete 3종(complete는 아니다)
//   (3) 클러스터가 2개 미만이면 SE/CI를 만들지 않는다(없는 정밀도를 지어내지 않음)
//   (4) 위험차 부호는 OFF−ON (양수 = OFF가 더 많이 실패)
//   (5) outcome 미상은 완주로 세지 않는다(fail-closed) — 미상 비율이 높은 run은 무효 표시
import assert from 'node:assert/strict'
import test from 'node:test'
import {armOf, collectArms, clusterRate, compareArms, countGateInvocations, checkArmCompliance, classifyOutcome,
        classifyRunaway, classifyIncomplete, analyze, RUNAWAY_TOKENS, RUNAWAY_DURATION_MS} from '../../docs/efficacy/analyze-ab.mjs'

const spawn = (run, outcome) => ({run, outcome, tokens: 1000})

test('암 판정: run 라벨 접미로만 결정하고 미상은 null이다', () => {
  assert.equal(armOf('2026-01-01+fresh+gatesOn'), 'on')
  assert.equal(armOf('2026-01-01+fresh+gatesOff'), 'off')
  assert.equal(armOf('2026-01-01+fresh'), null)   // 기존 telemetry(라벨 없음) — 조용히 편입 금지
  assert.equal(armOf(undefined), null)
})

test('라벨 없는 스폰은 분석에서 제외되고 그 수가 보고된다', () => {
  const {arms, unlabeled} = collectArms([[
    spawn('r1+gatesOn', 'complete'),
    spawn('legacy-run', 'incomplete'),   // 제외 대상
    spawn('r1+gatesOff', 'truncated'),
  ]])
  assert.equal(unlabeled, 1)
  assert.equal(arms.on.get('r1+gatesOn').n, 1)
  assert.equal(arms.off.get('r1+gatesOff').events, 1)
})

test('미완 정의는 truncated|crashed|incomplete 3종이다', () => {
  const {arms} = collectArms([[
    spawn('r+gatesOn', 'complete'),
    spawn('r+gatesOn', 'truncated'),
    spawn('r+gatesOn', 'crashed'),
    spawn('r+gatesOn', 'incomplete'),
  ]])
  const r = clusterRate(arms.on)
  assert.equal(r.n, 4)
  assert.equal(r.events, 3)   // complete만 제외
  assert.equal(r.rate, 0.75)
})

test('클러스터가 2개 미만이면 SE를 만들지 않는다(없는 정밀도 금지)', () => {
  const {arms} = collectArms([[spawn('only+gatesOn', 'incomplete'), spawn('only+gatesOn', 'complete')]])
  const r = clusterRate(arms.on)
  assert.equal(r.clusters, 1)
  assert.equal(r.se, null)
  assert.equal(r.rate, 0.5)
})

test('위험차는 OFF−ON이고, 한쪽 run이 1개면 CI를 만들지 않는다', () => {
  // ON: run 2개(각 2스폰, 미완 0/1) = 1/4 = 25% · OFF: run 1개(2스폰, 미완 2) = 100%
  const result = compareArms(collectArms([[
    spawn('a+gatesOn', 'complete'), spawn('a+gatesOn', 'complete'),
    spawn('b+gatesOn', 'incomplete'), spawn('b+gatesOn', 'complete'),
    spawn('x+gatesOff', 'incomplete'), spawn('x+gatesOff', 'truncated'),
  ]]))
  assert.equal(result.on.rate, 0.25)
  assert.equal(result.off.rate, 1)
  assert.equal(Math.round(result.riskDifferencePp), 75)  // 양수 = OFF가 더 실패
  assert.equal(result.ci95Pp, null)                       // OFF run 1개 → CI 없음
  assert.match(result.verdict, /NO_AUTOMATIC_VERDICT/)
})

test('양쪽 arm에 run이 2개 이상이면 클러스터-로버스트 CI를 낸다', () => {
  const result = compareArms(collectArms([[
    spawn('a+gatesOn', 'complete'), spawn('a+gatesOn', 'complete'),
    spawn('b+gatesOn', 'complete'), spawn('b+gatesOn', 'incomplete'),
    spawn('x+gatesOff', 'incomplete'), spawn('x+gatesOff', 'complete'),
    spawn('y+gatesOff', 'truncated'), spawn('y+gatesOff', 'incomplete'),
  ]]))
  assert.ok(result.ci95Pp !== null)
  assert.equal(result.ci95Pp.length, 2)
  assert.ok(result.ci95Pp[0] < result.riskDifferencePp && result.riskDifferencePp < result.ci95Pp[1])
})

test('한쪽 암 데이터가 전혀 없으면 비교하지 않는다', () => {
  const result = compareArms(collectArms([[spawn('a+gatesOn', 'complete')]]))
  assert.equal(result.off.rate, null)
  assert.equal(result.riskDifferencePp, null)
})

// ── 암 준수 검증(계획서 §6 교란 통제) — 자기보고가 아니라 로그로 확인한다
test('OFF 암에서 게이트 호출 흔적이 있으면 폐기 대상으로 판정한다', () => {
  const dirty = [
    'executor가 계획을 세웠다.',
    'node .claude/scripts/validate-spawn-plan.mjs --project .',
    'node .claude/scripts/resume-manifest.mjs --project . --manifest package.json',
  ].join('\n')
  const r = checkArmCompliance('off', dirty)
  assert.equal(r.compliant, false)
  assert.equal(r.counts.total, 2)
  assert.match(r.note, /폐기 대상/)
})

test('OFF 암에서 호출 흔적이 0이면 암 구분 유지로 판정한다', () => {
  const clean = 'executor가 스펙을 읽고 파일을 썼다. 게이트 호출 없음.'
  const r = checkArmCompliance('off', clean)
  assert.equal(r.compliant, true)
  assert.equal(r.counts.total, 0)
})

test('ON 암은 게이트 호출이 정상이므로 준수 위반이 아니다', () => {
  const r = checkArmCompliance('on', 'node .claude/scripts/validate-spawn-plan.mjs --project .')
  assert.equal(r.compliant, true)
  assert.equal(r.counts['validate-spawn-plan'], 1)
})

test('게이트 3종을 개별 집계한다(실호출 형태만)', () => {
  const c = countGateInvocations([
    'node .claude/scripts/validate-spawn-plan.mjs',
    'node .claude/scripts/verify-spawn-completion.mjs --project .',
    'node .claude/scripts/verify-spawn-completion.mjs --json',
  ].join('\n'))
  assert.equal(c['validate-spawn-plan'], 1)
  assert.equal(c['verify-spawn-completion'], 2)
  assert.equal(c['resume-manifest'], 0)
  assert.equal(c.total, 3)
})

// --- 구조적 오탐 차단 (적대 리뷰 2026-08-26) ---
// executor.log 첫 줄 `# command:`는 프롬프트 전문을 에코하는데, OFF armInstruction이 3게이트
// 스크립트 이름을 명시한다. 헤더를 세면 **모든 준수 OFF run이 자동 폐기 판정**을 받는다.

test('회귀 반증: 프롬프트 에코 헤더를 게이트 호출로 세지 않는다', () => {
  // 실제 OFF executor.log 형태 — 헤더에 3게이트 이름이 전부 등장하지만 본문은 깨끗하다.
  const realisticOffLog = [
    '# command: claude -p /web-orchestrator 앱을 만들어줘',
    '',
    '[A/B 실험 지시 — 이 실행은 게이트 OFF 암이다] runaway 방어 3게이트를 호출하지 마라: ' +
      '(1) validate-spawn-plan.mjs(fit-gate) (2) verify-spawn-completion.mjs(완결성) ' +
      '(3) resume-manifest.mjs(재개 판정). --permission-mode bypassPermissions',
    '# exit: 0',
    '',
    '## stdout',
    'executor가 스펙을 읽고 파일을 썼다. 게이트 호출 없음.',
  ].join('\n')
  const r = checkArmCompliance('off', realisticOffLog)
  assert.equal(r.counts.total, 0, '헤더 에코를 세면 모든 OFF run이 폐기된다')
  assert.equal(r.compliant, true)
})

test('헤더를 제외해도 본문의 실제 호출은 잡는다', () => {
  const contaminated = [
    '# command: claude -p ... validate-spawn-plan.mjs ...',
    '# exit: 0',
    '## stdout',
    'node .claude/scripts/verify-spawn-completion.mjs --project .',
  ].join('\n')
  const r = checkArmCompliance('off', contaminated)
  assert.equal(r.counts['verify-spawn-completion'], 1)
  assert.equal(r.counts['validate-spawn-plan'], 0, '헤더 언급은 호출이 아니다')
  assert.equal(r.compliant, false)
})

test('이름 언급만으로는 호출로 세지 않는다', () => {
  const c = countGateInvocations('resume-manifest.mjs 를 쓰지 않았다. validate-spawn-plan 참고.')
  assert.equal(c.total, 0)
})

// --- outcome 미상 fail-closed (사전등록 변경 #2, 2026-08-26) ---
// 배경: 최초 구현은 분모에 전 스폰을 넣고 분자만 INCOMPLETE로 세어, outcome 미기록 스폰이
// 조용히 "완주"로 집계됐다(fail-open). 실측으로 한 OFF run의 스폰 3개가 전부 미상이었다.

test('outcome 3분류: 미상은 complete가 아니다', () => {
  assert.equal(classifyOutcome('complete'), 'complete')
  assert.equal(classifyOutcome('truncated'), 'incomplete')
  assert.equal(classifyOutcome(undefined), 'unknown')
  assert.equal(classifyOutcome(''), 'unknown')
  assert.equal(classifyOutcome('   '), 'unknown')
  assert.equal(classifyOutcome(null), 'unknown')
})

test('회귀 반증: 미상 스폰을 완주로 세지 않는다(fail-open 복귀 시 실패)', () => {
  // 미완 1 + 미상 3. 옛 fail-open 동작이면 분모 4 → 25%.
  // fail-closed면 분모는 분류 가능한 1개뿐 → 100%, 미상 3은 별도 보고.
  const {arms} = collectArms([[
    spawn('r+gatesOn', 'incomplete'),
    spawn('r+gatesOn', undefined),
    spawn('r+gatesOn', undefined),
    spawn('r+gatesOn', undefined),
  ]])
  const rate = clusterRate(arms.on)
  assert.equal(rate.n, 1, '분모는 분류 가능한 스폰만')
  assert.equal(rate.events, 1)
  assert.equal(rate.unknown, 3)
  assert.equal(rate.rate, 1, 'fail-open이면 0.25가 나온다')
})

test('미상 비율이 임계를 넘는 run은 무효로 표시된다', () => {
  const {arms} = collectArms([[
    spawn('bad+gatesOn', 'complete'),
    spawn('bad+gatesOn', undefined),
  ]])
  const rate = clusterRate(arms.on)
  assert.equal(rate.invalidRuns.length, 1)
  assert.equal(rate.invalidRuns[0].run, 'bad+gatesOn')
  assert.equal(rate.invalidRuns[0].unknown, 1)
})

test('무효 run이 있으면 해석 금지 판정을 낸다', () => {
  const result = compareArms(collectArms([[
    spawn('a+gatesOn', undefined),
    spawn('a+gatesOn', undefined),
    spawn('b+gatesOff', 'complete'),
  ]]))
  assert.equal(result.interpretable, false)
  assert.match(result.verdict, /DATA_INVALID/)
  assert.equal(result.unknownSpawns, 2)
})

test('미상이 없으면 기존 판정 문구가 유지된다', () => {
  const result = compareArms(collectArms([[
    spawn('a+gatesOn', 'complete'),
    spawn('b+gatesOff', 'incomplete'),
  ]]))
  assert.equal(result.interpretable, true)
  assert.match(result.verdict, /NO_AUTOMATIC_VERDICT/)
  assert.equal(result.unknownSpawns, 0)
})

// --- 주 엔드포인트 = runaway율 (사전등록 변경 #3, 2026-08-26) ---
// 왜 바꿨나: 미완율의 원천 `outcome`은 완결성 게이트의 판정 결과이고, OFF 암이 끄는 게이트가
// 바로 그것이다 — OFF 암에서 정의상 측정 불가라 비교가 성립하지 않았다.
// runaway는 tokens/durationMs에서 나오고 이 둘은 게이트와 무관하게 기록된다(암 독립).

test('runaway 판정: 토큰 임계 초과', () => {
  assert.equal(classifyRunaway({tokens: RUNAWAY_TOKENS + 1, durationMs: 1000}), 'event')
  assert.equal(classifyRunaway({tokens: RUNAWAY_TOKENS, durationMs: 1000}), 'nonevent')
})

test('runaway 판정: 시간 임계 초과(토큰이 null이어도 유효)', () => {
  // 계약상 usage 미제공 환경에서 tokens는 null일 수 있다 — duration 단독 판정이 성립해야 한다.
  assert.equal(classifyRunaway({tokens: null, durationMs: RUNAWAY_DURATION_MS + 1}), 'event')
  assert.equal(classifyRunaway({tokens: null, durationMs: 1000}), 'nonevent')
})

test('회귀 반증: 두 신호가 모두 없으면 정상이 아니라 미상이다', () => {
  assert.equal(classifyRunaway({}), 'unknown')
  assert.equal(classifyRunaway({tokens: null, durationMs: null}), 'unknown')
  assert.equal(classifyRunaway({tokens: 'many'}), 'unknown', '비수치는 미상')
})

test('runaway 엔드포인트는 outcome이 전량 미상이어도 측정된다(암 독립 실증)', () => {
  // OFF 암의 계약상 정상 상태: outcome 생략. 그래도 runaway는 계산돼야 한다.
  const offSpawns = [
    {run: 'x+gatesOff', tokens: 200000, durationMs: 5000},
    {run: 'x+gatesOff', tokens: 1000, durationMs: 5000},
  ]
  const result = analyze([offSpawns])
  assert.equal(result.primary.off.rate, 0.5, 'runaway는 계산된다')
  assert.equal(result.primary.off.unknown, 0)
  // 부 엔드포인트는 같은 데이터에서 전량 미상 → 무효 표시
  assert.equal(result.secondaryDescriptive.off.rate, null)
  assert.equal(result.secondaryDescriptive.interpretable, false)
})

test('analyze는 주/부 엔드포인트를 이름과 함께 낸다', () => {
  const result = analyze([[{run: 'a+gatesOn', tokens: 10, durationMs: 10, outcome: 'complete'}]])
  assert.equal(result.primary.endpoint, 'runaway-rate')
  assert.equal(result.secondaryDescriptive.endpoint, 'incomplete-rate')
})

test('classifyIncomplete는 이벤트 어휘를 지킨다', () => {
  assert.equal(classifyIncomplete({outcome: 'incomplete'}), 'event')
  assert.equal(classifyIncomplete({outcome: 'complete'}), 'nonevent')
  assert.equal(classifyIncomplete({}), 'unknown')
})
