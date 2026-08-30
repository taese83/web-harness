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
  checkSpecReady, loadPlanUnits, checkPathsAgainstSpec, checkActivePickupIntact, featureIdsIn,
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

// TC를 함께 둔다 — 검증 기준 없는 FEAT는 별도 테스트가 따로 잰다.
const DECLARED = [
  '## FEAT-001 첫째',
  '<!-- web-harness:unit feat=FEAT-001 dependsOn=none paths=src/entities/a -->',
  '- TC-001-1 기대',
  '## FEAT-002 둘째',
  '<!-- web-harness:unit feat=FEAT-002 dependsOn=FEAT-001 paths=src/entities/b -->',
  '- TC-002-1 기대',
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

// ── (1) 선언된 경로 ↔ 스팩 귀속 (2026-08-30) ────────────────────────────────
// 선언은 자기보고다. 대조가 없으면 지어낸 귀속이 통과하고, 그 순간 거짓 충돌이 생겨
// 착수가 막힌다 — 오늘 `src/entities/track/model`이 정확히 그랬다.
const SPEC_WITH_BOUNDARIES = {
  specTier: 'verifiable', libraries: {}, constitution: {substrate: {}},
  moduleBoundaries: [
    {scope: 'src/entities/track/lib/closure', rationale: 'FEAT-004 폐곡선 검증'},
    {scope: 'src/entities/track/model', rationale: '4단계 파이프라인 타입 정본'},
    {scope: 'src/widgets/canvas', rationale: 'FEAT-006/007/008이 공유하는 표면'},
  ],
}

test('아무에게도 귀속되지 않은 공유 경계를 특정 FEAT가 선언하면 지적한다', () => {
  const units = [{featureId: 'FEAT-004', paths: ['src/entities/track/model'], testCaseIds: ['TC-004-1']}]
  const result = checkPathsAgainstSpec(units, SPEC_WITH_BOUNDARIES)
  assert.equal(result.state, 'HOLE')
  assert.match(result.detail, /어느 FEAT에도 귀속되지 않은/)
})

test('남의 FEAT에 귀속된 경계를 선언하면 지적한다', () => {
  const units = [{featureId: 'FEAT-005', paths: ['src/entities/track/lib/closure'], testCaseIds: ['TC-005-1']}]
  const result = checkPathsAgainstSpec(units, SPEC_WITH_BOUNDARIES)
  assert.equal(result.state, 'HOLE')
  assert.match(result.detail, /FEAT-004에 귀속/)
})

// 자체 실측: `FEAT-006/007/008` 축약에서 첫 번째만 읽어 나머지 셋을 오탐했다.
test('FEAT 축약 표기를 전부 읽는다 — 공유 경계를 오탐하지 않는다', () => {
  assert.deepEqual(featureIdsIn('FEAT-006/007/008이 공유하는 표면'), ['FEAT-006', 'FEAT-007', 'FEAT-008'])
  const units = [{featureId: 'FEAT-008', paths: ['src/widgets/canvas'], testCaseIds: ['TC-008-1']}]
  assert.equal(checkPathsAgainstSpec(units, SPEC_WITH_BOUNDARIES).state, 'PASS')
})

test('스팩이 모르는 경계는 대조 대상이 아니다 — 없는 근거로 지적하지 않는다', () => {
  const units = [{featureId: 'FEAT-004', paths: ['src/somewhere/else'], testCaseIds: ['TC-004-1']}]
  assert.equal(checkPathsAgainstSpec(units, SPEC_WITH_BOUNDARIES).state, 'PASS')
})

// ── (3) 진행 중 픽업 보호 (2026-08-30) ──────────────────────────────────────
// 계획을 고치면 그것을 읽고 작업 중인 개발자 밑에서 순서가 바뀐다. 오늘 내가 그렇게 했다.
const writeScope = (root, featureId) => writeFileSync(
  join(root, '_workspace/03_dev/change-scope.md'),
  ['# s', '', '```json change-scope', JSON.stringify({featureId, ALLOWED_PATHS: []}), '```', ''].join('\n'),
)

test('진행 중인 픽업이 계획 변경으로 착수 불가가 되면 지적한다', () => {
  withProject(root => {
    writeScope(root, 'FEAT-009')
    const units = [
      {featureId: 'FEAT-009', paths: ['src/widgets/canvas'], dependsOn: [], testCaseIds: ['TC-009-1']},
      {featureId: 'FEAT-006', paths: ['src/widgets/canvas'], dependsOn: [], testCaseIds: ['TC-006-1']},
    ]
    const result = checkActivePickupIntact(root, units)
    assert.equal(result.state, 'HOLE')
    assert.match(result.detail, /FEAT-009가 현재 계획으로는 착수 불가/)
  }, {shards: {'a.md': DECLARED}})
})

test('진행 중인 픽업이 계획에서 사라지면 지적한다', () => {
  withProject(root => {
    writeScope(root, 'FEAT-999')
    const result = checkActivePickupIntact(root, [{featureId: 'FEAT-001', dependsOn: [], paths: []}])
    assert.equal(result.state, 'HOLE')
    assert.match(result.detail, /계획에서 사라졌다/)
  }, {shards: {'a.md': DECLARED}})
})

test('진행 중인 픽업이 멀쩡하면 통과한다', () => {
  withProject(root => {
    writeScope(root, 'FEAT-002')
    const units = [
      {featureId: 'FEAT-001', paths: ['src/entities/a'], dependsOn: [], testCaseIds: ['TC-001-1']},
      {featureId: 'FEAT-002', paths: ['src/entities/b'], dependsOn: ['FEAT-001'], testCaseIds: ['TC-002-1']},
    ]
    assert.equal(checkActivePickupIntact(root, units).state, 'PASS')
  }, {shards: {'a.md': DECLARED}})
})

test('진행 중인 픽업이 없으면 검사하지 않는다 — 통과로 세지 않는다', () => {
  withProject(root => {
    assert.equal(checkActivePickupIntact(root, []).state, 'SKIPPED')
  }, {shards: {'a.md': DECLARED}})
})
