#!/usr/bin/env node
// test-handoff-readiness.mjs — 인계 판정의 회귀.
//
// 이 판정의 존재 이유: 상류 승인이 "사람이 보기에 충분한가"였고, 개발은 **기계가 읽는다.**
// 그 간극이 오늘의 구멍 전부였다. 그래서 여기서 고정하는 것은 하나다 —
// **2026-08-30에 개발 중에 터진 것들이 승인 시점에 잡히는가.**
import assert from 'node:assert/strict'
import test from 'node:test'
import {mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {
  analyzeHandoffReadiness, checkDesignDecisionsClosed, checkPlanDeclarations, checkProseOnlyOrdering,
  checkSpecReady, loadPlanUnits,
} from './validate-handoff-readiness.mjs'
import {parseFeaturePlanUnits} from './ticket/plan-units.mjs'

const SOLUTION_DESIGN = decisions => [
  '# Solution Design', '', '```json web-harness:solution-design',
  JSON.stringify({targetShapes: ['web-app'], layerMap: {domain: 'src/entities'}, openDecisions: decisions}, null, 2),
  '```', '',
].join('\n')

const withProject = (fn, {shards = {}, design = SOLUTION_DESIGN([]), spec = {specTier: 'verifiable', libraries: {}, constitution: {substrate: {}}}} = {}) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wh-handoff-')))
  try {
    mkdirSync(join(root, '_workspace/01_plan/feature-plan'), {recursive: true})
    mkdirSync(join(root, '_workspace/02_design'), {recursive: true})
    mkdirSync(join(root, '_workspace/03_dev'), {recursive: true})
    for (const [name, body] of Object.entries(shards)) writeFileSync(join(root, '_workspace/01_plan/feature-plan', name), body)
    if (design) writeFileSync(join(root, '_workspace/02_design/solution-design.md'), design)
    if (spec) writeFileSync(join(root, '_workspace/03_dev/spec.json'), JSON.stringify(spec))
    writeFileSync(join(root, 'package.json'), JSON.stringify({devDependencies: {}}))
    return fn(root)
  } finally { rmSync(root, {recursive: true, force: true}) }
}

const DECLARED = [
  '## FEAT-001 첫째',
  '<!-- web-harness:unit feat=FEAT-001 dependsOn=none paths=src/entities/a -->',
  '## FEAT-002 둘째',
  '<!-- web-harness:unit feat=FEAT-002 dependsOn=FEAT-001 paths=src/entities/b -->',
].join('\n')

// ── 오늘의 구멍이 승인 시점에 잡히는가 ─────────────────────────────────────
test('의존이 산문에만 있으면 인계를 막는다 — 오늘 11건이 착수 가능으로 보인 원인', () => {
  const prose = ['## FEAT-001 첫째', '## FEAT-002 둘째', '', 'FEAT-001 완료 후 → FEAT-002를 병렬로 진행한다'].join('\n')
  withProject(root => {
    const units = loadPlanUnits(root)
    assert.equal(checkPlanDeclarations(units).state, 'HOLE')
    const ordering = checkProseOnlyOrdering(root, units)
    assert.equal(ordering.state, 'HOLE')
    assert.match(ordering.detail, /선언된 의존 엣지가 0건/)
  }, {shards: {'a.md': prose}})
})

test('선언이 있으면 통과한다', () => {
  withProject(root => {
    const units = loadPlanUnits(root)
    assert.equal(checkPlanDeclarations(units).state, 'PASS')
    assert.equal(checkProseOnlyOrdering(root, units).state, 'PASS')
  }, {shards: {'a.md': DECLARED}})
})

test('경로만 빠져도 구멍이다 — 충돌 검사가 통째로 미수행이 된다', () => {
  const noPaths = '## FEAT-001 첫째\n<!-- web-harness:unit feat=FEAT-001 dependsOn=none -->'
  withProject(root => {
    const result = checkPlanDeclarations(loadPlanUnits(root))
    assert.equal(result.state, 'HOLE')
    assert.match(result.detail, /경로 미선언/)
  }, {shards: {'a.md': noPaths}})
})

test('마커를 읽지 못한 것과 선언이 없는 것을 가른다 — 처방이 다르다', () => {
  const brokenMarker = '## FEAT-001 x\n<!-- web-harness:unit feat=FEAT-001 dependsOn=FEAT-002 쓰레기 -->'
  withProject(root => {
    const result = checkPlanDeclarations(loadPlanUnits(root))
    assert.match(result.detail, /마커를 읽지 못함/)
  }, {shards: {'a.md': brokenMarker}})
})

// 미결정이 남으면 개발이 그것을 만나 멈추고, 사용자에게 되묻게 된다.
test('설계 미결정이 열려 있으면 인계를 막는다', () => {
  withProject(root => {
    const result = checkDesignDecisionsClosed(root)
    assert.equal(result.state, 'HOLE')
    assert.match(result.detail, /OD-001/)
  }, {shards: {'a.md': DECLARED}, design: SOLUTION_DESIGN([{id: 'OD-001', question: 'q', status: 'open'}])})
})

test('미결정이 닫혀 있으면 통과한다', () => {
  withProject(root => {
    assert.equal(checkDesignDecisionsClosed(root).state, 'PASS')
  }, {shards: {'a.md': DECLARED}, design: SOLUTION_DESIGN([{id: 'OD-001', question: 'q', status: 'confirmed'}])})
})

test('unverifiable 스팩은 인계를 막는다 — 무엇이 완료인지 판정할 기준이 없다', () => {
  withProject(root => {
    const result = checkSpecReady(root)
    assert.equal(result.state, 'HOLE')
    assert.match(result.detail, /unverifiable/)
  }, {shards: {'a.md': DECLARED}, spec: {specTier: 'unverifiable', libraries: {}, constitution: {substrate: {}}}})
})

// 확정과 설치의 간극. 오늘 track에 남아 있던 마지막 구멍이 이것이다.
test('확정한 라이브러리가 설치되지 않았으면 인계를 막는다', () => {
  withProject(root => {
    const report = analyzeHandoffReadiness(root)
    assert.equal(report.verdict, 'HOLES')
    assert.match(report.holes.map(h => h.detail).join(' '), /class-variance-authority/)
  }, {
    shards: {'a.md': DECLARED},
    spec: {specTier: 'verifiable', libraries: {ui: {choice: 'class-variance-authority', source: 'confirmed'}}, constitution: {substrate: {}}},
  })
})

test('전부 갖춰지면 READY다', () => {
  withProject(root => {
    const report = analyzeHandoffReadiness(root)
    assert.equal(report.verdict, 'READY', JSON.stringify(report.holes, null, 2))
  }, {shards: {'a.md': DECLARED}})
})

// 표 형식 계획은 unit 0개가 나온다(파서의 알려진 한계) — 그것을 "구멍 없음"으로 읽으면
// 승인이 공허 통과가 된다.
test('단위를 하나도 못 읽으면 통과가 아니다', () => {
  withProject(root => {
    assert.equal(checkPlanDeclarations(loadPlanUnits(root)).state, 'HOLE')
  }, {shards: {'a.md': '| FEAT | 제목 |\n|---|---|\n| FEAT-001 | 첫째 |'}})
})

test('feature-plan이 flat이어도 읽는다', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wh-handoff-flat-')))
  try {
    mkdirSync(join(root, '_workspace/01_plan'), {recursive: true})
    writeFileSync(join(root, '_workspace/01_plan/feature-plan.md'), DECLARED)
    assert.equal(loadPlanUnits(root).length, 2)
    assert.equal(parseFeaturePlanUnits(DECLARED).length, 2)
  } finally { rmSync(root, {recursive: true, force: true}) }
})
