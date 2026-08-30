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
  checkSpecReady, loadPlanUnits, checkPathsAgainstSpec, checkActivePickupIntact, featureIdsIn, extractProseEdges, checkProseEdgesDeclared, measureParallelism, checkUpstreamDecisionsReachable, supersededDecisionIds, declaredDecisions, supersessionMap, planSources, supersededAndReached,
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

// ── 산문이 말한 의존 간선 (2026-08-30) ──────────────────────────────────────
// 오늘 세 번 같은 실수를 했다: 산문의 **웨이브 목록**을 간선으로 옮기면서 같은 문서가
// 네 줄 위에서 준 **명시적 간선**을 안 읽었다. 그 한 줄이 잔여 8건 중 7건을 막았다.
test('산문의 명시적 간선을 뽑는다 — 웨이브는 묶음이지 간선이 아니다', () => {
  const edges = extractProseEdges('FEAT-008(레인체인지)은 FEAT-005(고도)와 FEAT-006(배치) 둘 다에 의존하지만, laneOffset은 독립 축이다.')
  assert.deepEqual(edges.map(e => `${e.subject}→${e.dep}`), ['FEAT-008→FEAT-005', 'FEAT-008→FEAT-006'])
  assert.match(edges[0].quote, /둘 다에 의존/, '원문을 함께 실어야 사람이 즉시 판단한다')
})

test('주체는 조사가 붙은 가장 가까운 FEAT다 — 나열 속에서도 옳게 집는다', () => {
  const wave = '{FEAT-006, FEAT-008, FEAT-010, FEAT-013} 병렬 → {FEAT-007, FEAT-012}(FEAT-007은 FEAT-012의 이벤트에 의존하므로 통합)'
  assert.deepEqual(extractProseEdges(wave).map(e => `${e.subject}→${e.dep}`), ['FEAT-007→FEAT-012'])
})

test('부정·독립 진술은 간선이 아니다', () => {
  assert.deepEqual(extractProseEdges('FEAT-011은 FEAT-006과 무관하며 의존하지 않는다'), [])
  assert.deepEqual(extractProseEdges('FEAT-014는 FEAT-006 이전에 독립적으로 선행 개발 가능하다'), [])
})

// 자체 실측: 트리거가 `의존`만이면 "파이프라인은 순차 의존이므로"에서 엉뚱한 주체를 집어
// 오탐 4건이 났다. `…에 의존` 절 형태로 좁혔다.
test('의존이라는 낱말만으로는 간선을 만들지 않는다', () => {
  assert.deepEqual(extractProseEdges('FEAT-001(fetch)이 실패하면 FEAT-002는 비활성이다. 파이프라인은 순차 의존이므로'), [])
})

test('산문 간선이 선언에 없으면 지적하고, 있으면 통과한다', () => {
  const prose = '## 인접\n- FEAT-008(레인체인지)은 FEAT-005와 FEAT-006(배치) 둘 다에 의존하지만 독립 축이다.'
  const shards = {'a.md': [
    '## FEAT-005 고도', '<!-- web-harness:unit feat=FEAT-005 dependsOn=none paths=src/entities/e -->', '- TC-005-1 x',
    '## FEAT-006 씬', '<!-- web-harness:unit feat=FEAT-006 dependsOn=none paths=src/widgets/c -->', '- TC-006-1 x',
    '## FEAT-008 레인', '<!-- web-harness:unit feat=FEAT-008 dependsOn=FEAT-005 paths=src/widgets/l -->', '- TC-008-1 x',
  ].join('\n'), 'b.md': prose}
  withProject(root => {
    const missing = checkProseEdgesDeclared(root, loadPlanUnits(root))
    assert.equal(missing.state, 'HOLE')
    assert.match(missing.detail, /FEAT-008→FEAT-006/)
  }, {shards})

  const fixed = {...shards, 'a.md': shards['a.md'].replace('feat=FEAT-008 dependsOn=FEAT-005', 'feat=FEAT-008 dependsOn=FEAT-005,FEAT-006')}
  withProject(root => {
    assert.equal(checkProseEdgesDeclared(root, loadPlanUnits(root)).state, 'PASS')
  }, {shards: fixed})
})

test('계획에 없는 FEAT를 가리키는 산문 간선은 지적하지 않는다 — 없는 근거로 막지 않는다', () => {
  withProject(root => {
    assert.equal(checkProseEdgesDeclared(root, loadPlanUnits(root)).state, 'SKIPPED')
  }, {shards: {'a.md': DECLARED}})
})

// ── 병렬성 지표 (2026-08-30) ────────────────────────────────────────────────
// 나눔의 목표는 "몇 조각인가"가 아니라 "몇 개를 동시에 진행할 수 있나"다. 규칙만 있고
// 재는 것이 없으면 지켜졌는지 알 수 없다 — 오늘 반복해 본 형태다.
test('세로 슬라이스는 사슬이 짧고 독립 단위가 많다', () => {
  const flat = [
    {featureId: 'FEAT-001', dependsOn: []},
    {featureId: 'FEAT-002', dependsOn: []},
    {featureId: 'FEAT-003', dependsOn: []},
  ]
  const metric = measureParallelism(flat)
  assert.equal(metric.edges, 0)
  assert.equal(metric.longestChain, 1, '전부 독립이면 한 웨이브다')
  assert.equal(metric.independent, 3)
  assert.equal(metric.bottleneck, null)
})

test('계층 슬라이스는 사슬이 길고 병목이 드러난다', () => {
  const layered = [
    {featureId: 'FEAT-001', dependsOn: []},
    {featureId: 'FEAT-002', dependsOn: ['FEAT-001']},
    {featureId: 'FEAT-003', dependsOn: ['FEAT-001']},
    {featureId: 'FEAT-004', dependsOn: ['FEAT-002']},
  ]
  const metric = measureParallelism(layered)
  assert.equal(metric.longestChain, 3)
  assert.equal(metric.independent, 1)
  assert.deepEqual(metric.bottleneck, {featureId: 'FEAT-001', blocks: 2})
})

test('계획 밖 FEAT를 가리키는 의존은 세지 않는다 — 없는 것으로 사슬을 늘리지 않는다', () => {
  const metric = measureParallelism([{featureId: 'FEAT-001', dependsOn: ['FEAT-999']}])
  assert.equal(metric.edges, 0)
  assert.equal(metric.longestChain, 1)
})

test('의존 순환이 있어도 무한 재귀하지 않는다', () => {
  const metric = measureParallelism([
    {featureId: 'A', dependsOn: ['B']},
    {featureId: 'B', dependsOn: ['A']},
  ])
  assert.ok(Number.isFinite(metric.longestChain), '순환은 computeClaimOrder가 따로 보고한다')
})

// 지표는 **실패로 만들지 않는다** — 파이프라인은 본래 순차이고, 의존이 많은 것이 항상
// 잘못은 아니다. 재서 보여주기만 하고 판단은 사람이 한다.
test('병렬성이 나빠도 그것 때문에 막지 않는다 — 재서 보여주기만 한다', () => {
  const chain = [
    '## FEAT-001 첫째', '<!-- web-harness:unit feat=FEAT-001 dependsOn=none paths=src/a -->', '- TC-001-1 x',
    '## FEAT-002 둘째', '<!-- web-harness:unit feat=FEAT-002 dependsOn=FEAT-001 paths=src/b -->', '- TC-002-1 x',
    '## FEAT-003 셋째', '<!-- web-harness:unit feat=FEAT-003 dependsOn=FEAT-002 paths=src/c -->', '- TC-003-1 x',
  ].join('\n')
  withProject(root => {
    const report = analyzeHandoffReadiness(root, {to: 'development'})
    assert.equal(report.parallelism.longestChain, 3, '사슬이 길다는 사실은 재서 싣는다')
    assert.equal(report.parallelism.independent, 1)
    assert.ok(!report.holes.some(hole => /병렬|사슬|parallel/.test(`${hole.id}${hole.detail}`)),
      '병렬성은 판정 축이 아니다 — 파이프라인은 본래 순차이고 의존이 많은 것이 항상 잘못은 아니다')
  }, {shards: {'a.md': chain}})
})

// ── 상류 조정이 개발에 도달하는가 (2026-08-30) ──────────────────────────────
// 기획·디자인·설계에서 조정한 결정이 **프리뷰 코드에만** 남으면 개발은 그것을 못 본다 —
// Phase 3은 preview를 구현 입력으로 전달하는 것을 금지하므로 도달할 경로 자체가 없다.
const withPreview = (fn, {preview = '', canon = '', log = ''} = {}) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wh-upstream-')))
  try {
    mkdirSync(join(root, '_workspace/02_design/preview'), {recursive: true})
    mkdirSync(join(root, '_workspace/01_plan/decision-log'), {recursive: true})
    mkdirSync(join(root, '_workspace/01_plan/feature-plan'), {recursive: true})
    writeFileSync(join(root, '_workspace/02_design/preview/geom.js'), preview)
    writeFileSync(join(root, '_workspace/01_plan/decision-log/log.md'), log)
    writeFileSync(join(root, '_workspace/01_plan/feature-plan/a.md'), canon)
    return fn(root)
  } finally { rmSync(root, {recursive: true, force: true}) }
}

test('프리뷰에만 있는 결정을 지적한다 — 개발이 도달할 경로가 없다', () => {
  withPreview(root => {
    const result = checkUpstreamDecisionsReachable(root)
    assert.equal(result.state, 'HOLE')
    assert.match(result.detail, /D-033/)
  }, {
    preview: '// 레인 폭은 D-033을 따른다',
    log: '## D-033 · 레인체인지는 한 칸씩 순환 (2026-08-29)',
    canon: '### FEAT-008 — 레인체인지\n시각적으로 구분해 표현한다.',
  })
})

test('정본에 도달했으면 통과한다', () => {
  withPreview(root => {
    assert.equal(checkUpstreamDecisionsReachable(root).state, 'PASS')
  }, {
    preview: '// 레인 폭은 D-033을 따른다',
    log: '## D-033 · 레인체인지는 한 칸씩 순환',
    canon: '### FEAT-008\n레인은 한 칸씩 순환한다(D-033).',
  })
})

// 자체 실측: 프리뷰가 인용한 5건 중 4건이 **대체된 결정**이었고 후속이 정본에 있었다.
// 그것을 전부 지적하면 오탐이 되어 검사가 무시된다.
test('대체·정정된 결정은 지적하지 않는다 — 후속이 정본에 있으면 도달한 것이다', () => {
  withPreview(root => {
    assert.equal(checkUpstreamDecisionsReachable(root).state, 'PASS')
  }, {
    preview: '// 뱅크 롤은 D-024',
    log: ['## D-024 · 뱅크 롤 20°', '## D-042 · 뱅크 20° 복귀 — D-024 대체'].join('\n'),
    canon: '### FEAT-005\n뱅크는 20°다(D-042).',
  })
})

// 옮길 대상이 없는데 "옮겨라"라고 하면 처방이 틀린다.
test('결정 로그에 없는 ID 인용은 다른 종류의 결함으로 가른다', () => {
  withPreview(root => {
    const result = checkUpstreamDecisionsReachable(root)
    assert.equal(result.state, 'HOLE')
    assert.match(result.detail, /결정 로그에 없는 ID/)
    assert.match(result.remedy, /결정을 기록하거나 인용을 고친다/)
  }, {preview: '// D-999를 따른다', log: '## D-001 · 무언가', canon: '내용'})
})

test('프리뷰가 없으면 검사하지 않는다 — 통과로 세지 않는다', () => {
  withProject(root => {
    assert.equal(checkUpstreamDecisionsReachable(root).state, 'SKIPPED')
  }, {shards: {'a.md': DECLARED}})
})

// 방향을 뒤집으면 살아 있는 결정을 "도달했다"고 오판한다 — 실제 로그에서 물린 문장들.
test('대체 방향은 계약된 표제 형태에서만 읽는다', () => {
  const ids = supersededDecisionIds([
    '## D-029 · 뱅크 구간 = 하나의 20° 기운 평면 — D-028 대체',
    '## D-014 · 색 인덱스 의미 확정 — N-001 해소, D-003 등급 정정',
    '## D-042 · 뱅크 20° 복귀 — 각도 드리프트 해소',
    'D-022의 고도 공식(tan)은 D-023이 sin으로 정정',  // 표제가 아니다 — 보지 않는다
  ].join('\n'))
  assert.deepEqual([...ids].sort(), ['D-003', 'D-028'])
})

// 리뷰가 낸 fail-open 반례들. 제외는 stranded를 **줄이는** 방향으로만 작동하므로 방향을
// 뒤집으면 살아 있는 결정이 조용히 통과한다 — 단정할 수 없으면 제외하지 않는 쪽이 맞다.
test('피동문에서 방향을 뒤집지 않는다 — 단정 못 하면 제외하지 않는다', () => {
  assert.deepEqual([...supersededDecisionIds('## D-024 · 뱅크 롤 — D-042로 대체됐다')], [])
  assert.deepEqual([...supersededDecisionIds('## D-028 · 뱅크 — D-029에 의해 대체됐다')], [])
})

test('부정문을 대체로 읽지 않는다', () => {
  assert.deepEqual([...supersededDecisionIds('## D-033 · 레인 순환 — D-030을 대체하지 않기로 했다')], [])
})

test('표제 밖 산문은 대체 판정에 쓰지 않는다', () => {
  assert.deepEqual([...supersededDecisionIds('D-021 적용으로 렌더 지터 해소')], [])
})

// I3: ID 체계를 박지 않는다 — 하네스 계약은 PC-NNN, track은 D-NNN이다.
test('로그가 선언한 접두사를 그대로 쓴다 — PC형과 D형 둘 다', () => {
  const pc = declaredDecisions('## PC-014 (2026-08-10) — 주문 상세에 배송지 변경 추가')
  assert.deepEqual([...pc.prefixes], ['PC'])
  assert.ok(pc.ids.has('PC-014'))
  const d = declaredDecisions('## D-036 · 프리뷰에서 확정한 형상 4건 (2026-08-29)')
  assert.deepEqual([...d.prefixes], ['D'])
  assert.ok(d.ids.has('D-036'))
})

test('표제 없는 로그는 SKIP이다 — 통과로 세지 않는다', () => {
  withPreview(root => {
    assert.equal(checkUpstreamDecisionsReachable(root).state, 'SKIPPED')
  }, {preview: '// D-033을 따른다', log: '결정이 산문으로만 적혀 있다', canon: '내용'})
})

// 계약상 결정 로그는 **flat** `decision-log.md`다. 디렉터리만 읽으면 계약 준수 프로젝트에서
// 이 검사가 영구 무의미해진다(2026-08-30 리뷰 BLOCK).
test('계약 형태(flat decision-log.md, PC-NNN)에서도 동작한다', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wh-flat-log-')))
  try {
    mkdirSync(join(root, '_workspace/02_design/preview'), {recursive: true})
    mkdirSync(join(root, '_workspace/01_plan'), {recursive: true})
    writeFileSync(join(root, '_workspace/01_plan/decision-log.md'),
      '## PC-014 (2026-08-10) — 배송지 변경 추가\n## PC-015 (2026-08-11) — 재고 표기 정정')
    writeFileSync(join(root, '_workspace/02_design/preview/app.js'), '// PC-015를 따른다')
    writeFileSync(join(root, '_workspace/01_plan/feature-plan.md'), '### FEAT-001\n재고를 표기한다.')
    const stranded = checkUpstreamDecisionsReachable(root)
    assert.equal(stranded.state, 'HOLE')
    assert.match(stranded.detail, /PC-015/)
    writeFileSync(join(root, '_workspace/01_plan/feature-plan.md'), '### FEAT-001\n재고를 표기한다(PC-015).')
    assert.equal(checkUpstreamDecisionsReachable(root).state, 'PASS')
  } finally { rmSync(root, {recursive: true, force: true}) }
})

// 면제의 논거는 "후속이 정본에 있으면 도달한 것"이다 — 그 논거 자체를 검사하지 않으면
// 옛 결정도 후속도 정본에 없는, **이 검사가 잡으려던 바로 그 상황**이 PASS로 나온다.
test('대체됐어도 후속이 정본에 없으면 면제하지 않는다', () => {
  withPreview(root => {
    const result = checkUpstreamDecisionsReachable(root)
    assert.equal(result.state, 'HOLE', '옛 결정도 후속도 정본에 없다')
    assert.match(result.detail, /D-024/)
  }, {
    preview: '// 뱅크 롤은 D-024',
    log: ['## D-024 · 뱅크 롤 20°', '## D-042 · 재조정 — D-024 대체'].join('\n'),
    canon: '### FEAT-005\n뱅크를 그린다.',
  })
})

test('후속의 사슬을 따라간다 — D-024 → D-042 → D-050이 정본에 있으면 면제한다', () => {
  withPreview(root => {
    assert.equal(checkUpstreamDecisionsReachable(root).state, 'PASS')
  }, {
    preview: '// 뱅크 롤은 D-024',
    log: ['## D-024 · 뱅크 롤 20°', '## D-042 · 재조정 — D-024 대체', '## D-050 · 최종 — D-042 대체'].join('\n'),
    canon: '### FEAT-005\n뱅크는 20°다(D-050).',
  })
})

test('순환하는 대체 사슬에서도 멈춘다', () => {
  const map = supersessionMap(['## D-001 · a — D-002 대체', '## D-002 · b — D-001 대체'].join('\n'))
  assert.equal(supersededAndReached('D-001', map, new Set()), false)
})

// 한 표제에 진술이 둘이면 앞 진술의 행위자가 뒤 진술의 목적어로 새면 안 된다.
test('키워드별로 직전 키워드 이후만 본다', () => {
  const ids = supersededDecisionIds('## D-050 · x — D-001로 대체됐다, D-002 정정')
  assert.deepEqual([...ids], ['D-002'], 'D-001은 피동 행위자다')
})

// flat 계획만 있는 프로젝트에서 "산문이 없다"는 **거짓 PASS**가 나던 자리.
test('계획 산문을 flat·sharded 양형에서 읽는다', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wh-plan-shape-')))
  try {
    mkdirSync(join(root, '_workspace/01_plan'), {recursive: true})
    writeFileSync(join(root, '_workspace/01_plan/feature-plan.md'),
      '### FEAT-001\n### FEAT-002\nFEAT-002는 FEAT-001 이후에 진행한다.')
    assert.equal(planSources(root).length, 1)
    const units = [{featureId: 'FEAT-001', dependsOn: []}, {featureId: 'FEAT-002', dependsOn: []}]
    const result = checkProseOnlyOrdering(root, units)
    assert.equal(result.state, 'HOLE', 'flat 계획의 순서 산문을 읽어야 한다')
  } finally { rmSync(root, {recursive: true, force: true}) }
})
