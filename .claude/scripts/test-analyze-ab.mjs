#!/usr/bin/env node
// test-analyze-ab.mjs — 결과 효능 A/B 분석기 회귀 (사전등록 분석의 안전망).
//
// 왜: 분석기는 **데이터 수집 전에** 고정돼야 의미가 있다(p-hacking 차단). 그런데 분석기
// 자체가 조용히 틀리면 사전등록이 장식이 된다. 여기서 고정하는 사실:
//   (1) 암 판정은 run 라벨 접미로만 하고, 라벨 없는 스폰은 제외하고 그 수를 보고한다
//   (2) 미완 정의는 truncated|crashed|incomplete 3종(complete는 아니다)
//   (3) 클러스터가 2개 미만이면 SE/CI를 만들지 않는다(없는 정밀도를 지어내지 않음)
//   (4) 위험차 부호는 OFF−ON (양수 = OFF가 더 많이 실패)
import assert from 'node:assert/strict'
import test from 'node:test'
import {armOf, collectArms, clusterRate, compareArms, countGateInvocations, checkArmCompliance} from '../../docs/efficacy/analyze-ab.mjs'

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
  const dirty = '... node .claude/scripts/validate-spawn-plan.mjs --project . ... resume-manifest.mjs ...'
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
  const r = checkArmCompliance('on', 'validate-spawn-plan.mjs 실행')
  assert.equal(r.compliant, true)
  assert.equal(r.counts['validate-spawn-plan'], 1)
})

test('게이트 3종을 개별 집계한다', () => {
  const c = countGateInvocations('validate-spawn-plan verify-spawn-completion verify-spawn-completion')
  assert.equal(c['validate-spawn-plan'], 1)
  assert.equal(c['verify-spawn-completion'], 2)
  assert.equal(c['resume-manifest'], 0)
  assert.equal(c.total, 3)
})
