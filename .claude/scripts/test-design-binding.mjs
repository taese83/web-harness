#!/usr/bin/env node
// test-design-binding.mjs — 디자인 근거 귀속의 회귀.
//
// 이 기록의 존재 이유: 시안이 어느 화면의 어느 조건인지가 산문에만 있어 기계가 승계하지
// 못했고, 조건 분기(권한 없음·빈 상태·모바일)가 구현 중에 즉흥으로 결정됐다. 그래서 여기서
// 고정하는 것은 둘이다 — **추론과 위조를 적을 자리가 없는가**, 그리고 **미결이 인계를 막는가.**
//
// 배선까지 본다. 순수 함수 회귀만 있으면 `analyzeHandoffReadiness`에서 검사를 빼도 조용히
// green이 된다(wiring-coverage가 §4에 등록한 클래스).
import assert from 'node:assert/strict'
import test from 'node:test'
import {mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {spawnSync} from 'node:child_process'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {tmpdir} from 'node:os'
import {
  DESIGN_BINDING_PATH, collectDesignBinding, conditionKey, crossCheckVisualReferences, validateDesignBinding,
} from './design-binding-lib.mjs'
import {
  analyzeHandoffReadiness, checkDesignBinding, checkDesignInputs, designDebtReport, pageGroupIdsIn, readDecisionLog,
  parseInformationHierarchy, parsePageGroups,
} from './validate-handoff-readiness.mjs'
import {evaluateGlobalBashPolicy} from './global-bash-policy-lib.mjs'
import {validateVisualContract} from './visual-evidence-lib.mjs'
import {hasUserInterface} from './spec.mjs'

const AT = '2026-01-01T00:00:00.000Z'
const FIGMA = {
  id: 'order-detail', kind: 'figma-node', locator: 'node-id=412:9037',
  snapshot: '_workspace/00_source/figma-a1-412-9037.md', capturedAt: AT,
}
const binding = (over = {}) => ({
  schemaVersion: 1,
  references: [structuredClone(FIGMA)],
  bindings: [
    {pageGroup: 'PAGE-002', condition: {state: 'default'}, referenceIds: ['order-detail'], declaredBy: 'user', declaredAt: AT},
    {pageGroup: 'PAGE-002', condition: {state: 'empty'}, referenceIds: [], resolution: 'derive', declaredBy: 'user', declaredAt: AT},
  ],
  unbound: {references: [], pageGroups: []},
  ...over,
})
// Figma 없이 시안 이미지·명세로만 공급되는 두 번째 형태. 같은 계약이 서는지를 정상계로 고정한다.
const imageBinding = () => ({
  schemaVersion: 1,
  references: [
    {id: 'order-shot', kind: 'image', locator: '_inputs/design/order.png', capturedAt: AT},
    {id: 'order-spec', kind: 'specification', locator: '_inputs/design/screen-spec.md', capturedAt: AT},
  ],
  bindings: [
    {pageGroup: 'PAGE-002', condition: {state: 'default'}, referenceIds: ['order-shot', 'order-spec'], declaredBy: 'user', declaredAt: AT},
    {pageGroup: 'PAGE-002', condition: {variant: '읽기 전용 담당자'}, referenceIds: [], resolution: 'derive', declaredBy: 'carried', declaredAt: AT},
  ],
  unbound: {references: [], pageGroups: []},
})

const errorsOf = document => validateDesignBinding(document).errors.join('\n')

test('한 화면이 조건에 따라 여러 근거를 갖는 것이 정상 형태다', () => {
  const document = binding()
  document.bindings.push({
    pageGroup: 'PAGE-002', condition: {modeId: 'mobile-light'}, referenceIds: [],
    resolution: 'reuse:order-detail', declaredBy: 'user', declaredAt: AT,
  })
  const result = validateDesignBinding(document)
  assert.deepEqual(result.errors, [])
  assert.equal(result.coverage.bindings, 3)
  assert.deepEqual(result.coverage.resolutions, {derive: 1, pending: 0, reuse: 1, supplied: 1})
})

test('declaredBy에 inferred를 적을 수 없다 — 추론 결과를 담을 어휘가 없다', () => {
  const document = binding()
  document.bindings[0].declaredBy = 'inferred'
  assert.match(errorsOf(document), /declaredBy/)
})

test('figma-node에 해시를 적을 수 없다 — 계산할 수단이 없는 값을 적는 것은 위조다', () => {
  const document = binding()
  document.references[0].sha256 = 'a'.repeat(64)
  assert.match(errorsOf(document), /sha256을 적을 수 없다/)
})

test('figma-node는 스냅샷과 가져온 시각으로 재현성을 담보한다', () => {
  const withoutSnapshot = binding()
  delete withoutSnapshot.references[0].snapshot
  assert.match(errorsOf(withoutSnapshot), /텍스트 스냅샷이 필요하다/)
  const remoteSnapshot = binding()
  remoteSnapshot.references[0].snapshot = 'https://figma.com/design/abc'
  assert.match(errorsOf(remoteSnapshot), /텍스트 스냅샷이 필요하다/)
  const withoutTime = binding()
  withoutTime.references[0].capturedAt = ''
  assert.match(errorsOf(withoutTime), /capturedAt/)
})

test('선택 필드도 타입을 본다 — 스키마만 알고 게이트가 모르면 스키마는 장식이다', () => {
  const noted = binding()
  noted.bindings[0].note = 42
  assert.match(errorsOf(noted), /note는 문자열이어야 한다/)
  const unbound = binding()
  unbound.references.push({...FIGMA, id: 'settings', locator: 'node-id=1:2'})
  unbound.unbound.references = [7]
  assert.match(errorsOf(unbound), /reference id 형식이 아니다/)
})

test('미지 키를 조용히 버리지 않는다 — 오타 하나가 조건을 통째로 없앤다', () => {
  const document = binding()
  document.bindings[0].condition = {varient: 'free'}
  assert.match(errorsOf(document), /알 수 없는 조건 키 varient/)
  for (const [label, mutate] of [
    ['문서', d => { d.notes = 'x' }],
    ['reference', d => { d.references[0].hash = 'x' }],
    ['binding', d => { d.bindings[0].owner = 'x' }],
    ['unbound', d => { d.unbound.pages = [] }],
  ]) {
    const mutated = binding()
    mutate(mutated)
    assert.match(errorsOf(mutated), /알 수 없는 키/, `${label} 수준의 미지 키가 통과했다`)
  }
})

test('로컬 원본은 locator가 정본이다 — 실물과 대조할 수 없는 경로는 거부한다', () => {
  const document = imageBinding()
  assert.deepEqual(validateDesignBinding(document).errors, [])
  const escaped = imageBinding()
  escaped.references[0].locator = '../../etc/passwd'
  assert.match(errorsOf(escaped), /프로젝트 상대 경로여야 한다/)
  const remote = imageBinding()
  remote.references[0].locator = 'https://figma.com/design/abc'
  assert.match(errorsOf(remote), /프로젝트 상대 경로여야 한다/)
})

test('같은 화면의 같은 조건을 두 번 선언할 수 없다 — 택일은 이 계약의 것이 아니다', () => {
  const document = binding()
  document.bindings.push({pageGroup: 'PAGE-002', condition: {state: 'default'}, referenceIds: ['order-detail'], declaredBy: 'user', declaredAt: AT})
  assert.match(errorsOf(document), /두 번 선언됐다/)
})

test('figma-node의 locator는 node ID다 — 스냅샷 경로로 덮어쓰면 식별자가 사라진다', () => {
  for (const locator of ['node-id=412:9037', '412:9037', '412-9037']) {
    const document = binding()
    document.references[0].locator = locator
    assert.deepEqual(validateDesignBinding(document).errors, [], `${locator}가 거부됐다`)
  }
  for (const locator of ['_workspace/00_source/figma-a1-412-9037.md', '.claude/README.md', 'https://figma.com/design/abc']) {
    const document = binding()
    document.references[0].locator = locator
    assert.match(errorsOf(document), /locator는 node ID여야 한다/, `${locator}가 통과했다`)
  }
})

test('로컬 원본에는 snapshot을 적지 않는다 — 정본이 둘이 되면 안 된다', () => {
  const document = imageBinding()
  document.references[0].snapshot = '_workspace/00_source/copy.md'
  assert.match(errorsOf(document), /snapshot을 적지 않는다/)
})

test('시각 계약으로 옮기는 것은 세 값뿐이다 — 객체를 통째로 넣으면 거부된다', () => {
  // 이 계약의 capturedAt·snapshot은 visual-qa 스키마에 없는 키다. 통째로 복사하면
  // 스키마상 무효한 계약이 되고, 그 거부는 visual-evidence-lib이 실제로 수행한다
  // (배선 fixture는 validate-visual-design.mjs에 있다).
  const {id, kind, locator} = binding().references[0]
  assert.deepEqual(crossCheckVisualReferences(binding(), [{id, kind, locator}]), [])
  const errors = []
  validateVisualContract({
    schemaVersion: 1, references: [{...binding().references[0]}], modes: [], targets: [],
  }, errors)
  assert.ok(errors.some(e => /unknown keys: capturedAt, snapshot/.test(e)), errors.join('\n'))
})

test('조건 값에 구분자가 들어가도 서로 다른 조건이다', () => {
  assert.notEqual(conditionKey({state: 'a&variant=b'}), conditionKey({state: 'a', variant: 'b'}))
  const document = binding()
  document.bindings[0].condition = {state: 'a&variant=b'}
  document.bindings[1].condition = {state: 'a', variant: 'b'}
  assert.deepEqual(validateDesignBinding(document).errors, [])
})

test('조건 키 순서를 바꿔도 같은 조건이다', () => {
  assert.equal(conditionKey({variant: 'free', state: 'default'}), conditionKey({state: 'default', variant: 'free'}))
  const document = binding()
  document.bindings[0].condition = {state: 'default', variant: 'free'}
  document.bindings.push({pageGroup: 'PAGE-002', condition: {variant: 'free', state: 'default'}, referenceIds: ['order-detail'], declaredBy: 'user', declaredAt: AT})
  assert.match(errorsOf(document), /두 번 선언됐다/)
})

test('근거 없는 조건은 resolution을 명시해야 한다 — 빈 칸은 결정이 아니다', () => {
  const document = binding()
  delete document.bindings[1].resolution
  assert.match(errorsOf(document), /resolution/)
})

test('reuse는 실재하는 근거만 가리킬 수 있다', () => {
  const document = binding()
  document.bindings[1].resolution = 'reuse:nope'
  assert.match(errorsOf(document), /알 수 없는 referenceId nope/)
})

test('unbound는 선언이며 실제와 어긋나면 거부한다', () => {
  const missing = binding()
  missing.references.push({...FIGMA, id: 'settings'})
  assert.match(errorsOf(missing), /빠진 미바인딩 근거: settings/)
  const lying = binding()
  lying.unbound.references = ['order-detail']
  assert.match(errorsOf(lying), /실제로는 바인딩된/)
})

test('같은 id가 시각 계약에서 다른 것을 가리키면 발산이다', () => {
  const document = binding()
  assert.deepEqual(crossCheckVisualReferences(document, [{id: 'order-detail', kind: 'figma-node', locator: 'node-id=412:9037'}]), [])
  // 시각 계약이 고르지 않은 근거는 정상이다 — 부분집합을 요구하지 않는다.
  assert.deepEqual(crossCheckVisualReferences(document, [{id: 'approved-prototype', kind: 'none', locator: 'preview'}]), [])
  const diverged = crossCheckVisualReferences(document, [{id: 'order-detail', kind: 'figma-node', locator: 'node-id=999:1'}])
  assert.equal(diverged.length, 1)
  assert.match(diverged[0], /다른 것을 가리킨다/)
})

test('선언 집합은 Page Groups 표다 — 산문의 언급은 선언이 아니다', () => {
  const plan = [
    '## Page Groups',
    '| Page Group ID | Page | Route/Screen | Order |',
    '|---|---|---|---|',
    '| PAGE-000 | Common | all | 99 |',
    '| PAGE-002 | Order Detail | order-detail | 1 |',
    '',
    '## Feature List',
    'FEAT-001은 나중에 PAGE-999로 옮길 수도 있다.',
  ].join('\n')
  // PAGE-000은 전역 책임이라 제외되고, 표 밖에서 언급된 PAGE-999는 선언이 아니다.
  assert.deepEqual(pageGroupIdsIn(plan).sort(), ['PAGE-002'])
  assert.deepEqual(pageGroupIdsIn('PAGE-002를 만든다'), [])
})

// ── 배선 ────────────────────────────────────────────────────────────────────
const pageGroups = (...rows) => ['## Page Groups', '| Page Group ID | Page | Route/Screen | Order |', '|---|---|---|---|', ...rows].join('\n')
const hierarchy = (...rows) => [
  '## 화면별 정보 위계',
  '| 화면 | info:Primary | info:Secondary | info:밀도 | state:empty | variant:권한 없음 |',
  '|---|---|---|---|---|---|',
  ...rows,
].join('\n')
const DESIGN_DIRECTION = '\n\n## 디자인 방향\n- 브랜드 제약: 없음\n'
// 기본 brief는 조건을 하나도 요구하지 않는 최소 형태다 — 조건 커버리지를 재지 않는 테스트가
// 분모 부재로 실패하지 않게 한다. 분모 자체를 보는 테스트는 brief를 직접 넘긴다.
const MINIMAL_BRIEF = ['## 화면별 정보 위계',
  '| 화면 | info:Primary | info:Secondary | info:밀도 | state:empty |', '|---|---|---|---|---|',
  '| PAGE-002 | ① 주문 | 이력 | 표준 | 비적용(항상 값이 있다) |'].join('\n')
const withProject = (fn, {document = binding(), plan = pageGroups('| PAGE-002 | Order Detail | order-detail | 1 |'), brief = MINIMAL_BRIEF} = {}) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wh-binding-')))
  try {
    mkdirSync(join(root, '_workspace/00_source'), {recursive: true})
    mkdirSync(join(root, '_workspace/01_plan'), {recursive: true})
    writeFileSync(join(root, '_workspace/00_source/figma-a1-412-9037.md'), '# snapshot')
    if (document) writeFileSync(join(root, DESIGN_BINDING_PATH), JSON.stringify(document))
    if (plan) writeFileSync(join(root, '_workspace/01_plan/feature-plan.md'), plan)
    if (brief) writeFileSync(join(root, '_workspace/01_plan/ux-brief.md'), brief + DESIGN_DIRECTION)
    return fn(root)
  } finally { rmSync(root, {recursive: true, force: true}) }
}

test('적은 경로가 실재하지 않으면 근거가 아니다 — figma 스냅샷도 같다', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wh-binding-')))
  try {
    mkdirSync(join(root, '_workspace/00_source'), {recursive: true})
    // 스냅샷 파일 없이 경로만 적은 상태 — 종전에는 문자열 존재만 봐서 통과했다.
    writeFileSync(join(root, DESIGN_BINDING_PATH), JSON.stringify(binding()))
    assert.match(collectDesignBinding(root).errors.join('\n'), /figma-a1-412-9037\.md: 디자인 근거를 읽을 수 없다/)
    writeFileSync(join(root, '_workspace/00_source/figma-a1-412-9037.md'), '# snapshot')
    assert.deepEqual(collectDesignBinding(root).errors, [])
  } finally { rmSync(root, {recursive: true, force: true}) }
})

test('적힌 해시는 실물과 대조한다 — 지어낸 64자 hex는 통과하지 못한다', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wh-binding-')))
  try {
    mkdirSync(join(root, '_inputs/design'), {recursive: true})
    mkdirSync(join(root, '_workspace/00_source'), {recursive: true})
    writeFileSync(join(root, '_inputs/design/order.png'), 'shot')
    writeFileSync(join(root, '_inputs/design/screen-spec.md'), 'spec')

    // 해시가 없는 것은 허용한다 — 쓰는 주체에 계산 수단이 없을 수 있다.
    writeFileSync(join(root, DESIGN_BINDING_PATH), JSON.stringify(imageBinding()))
    assert.deepEqual(collectDesignBinding(root).errors, [])

    const forged = imageBinding()
    forged.references[0].sha256 = 'b'.repeat(64)
    writeFileSync(join(root, DESIGN_BINDING_PATH), JSON.stringify(forged))
    assert.match(collectDesignBinding(root).errors.join('\n'), /적힌 sha256이 실물과 다르다/)

    const absent = imageBinding()
    absent.references[0].locator = '_inputs/design/missing.png'
    writeFileSync(join(root, DESIGN_BINDING_PATH), JSON.stringify(absent))
    assert.match(collectDesignBinding(root).errors.join('\n'), /읽을 수 없다/)
  } finally { rmSync(root, {recursive: true, force: true}) }
})

test('파일이 없는 것은 정상이다 — 디자인 generated·absent 경로', () => {
  withProject(root => {
    assert.equal(collectDesignBinding(root).present, false)
    assert.equal(checkDesignBinding(root).state, 'SKIPPED')
  }, {document: null})
})

test('완결된 기록은 인계를 통과한다', () => {
  withProject(root => {
    const result = checkDesignBinding(root)
    assert.equal(result.state, 'PASS', result.detail)
    assert.match(result.detail, /파생 1/)
  })
})

test('미결은 인계를 막는다 — 미바인딩 근거·미결 화면·pending', () => {
  const unboundReference = binding()
  unboundReference.references.push({...FIGMA, id: 'settings'})
  unboundReference.unbound.references = ['settings']
  withProject(root => assert.match(checkDesignBinding(root).detail, /붙지 않은 근거 1건/), {document: unboundReference})

  const unboundPage = binding()
  unboundPage.unbound.pageGroups = ['PAGE-003']
  withProject(root => assert.match(checkDesignBinding(root).detail, /미결인 화면 1건/), {document: unboundPage})

  const pending = binding()
  pending.bindings[1].resolution = 'pending'
  withProject(root => assert.match(checkDesignBinding(root).detail, /결정이 미뤄진 조건 1건/), {document: pending})
})

test('유령 화면으로 미바인딩 검사를 우회할 수 없다', () => {
  // 기획에 없는 PAGE-999를 만들어 근거를 붙이면 unbound가 비지만, 그것은 근거가 화면에
  // 도달한 것이 아니라 화면을 지어낸 것이다.
  const ghost = binding()
  ghost.references.push({...FIGMA, id: 'settings', locator: 'node-id=1:2'})
  ghost.bindings.push({pageGroup: 'PAGE-999', condition: {state: 'default'}, referenceIds: ['settings'], declaredBy: 'user', declaredAt: AT})
  withProject(root => {
    const result = checkDesignBinding(root)
    assert.equal(result.state, 'HOLE')
    assert.match(result.detail, /기획에 없는 화면에 붙은 기록 1건: PAGE-999/)
  }, {document: ghost})

  // 표 밖 산문의 언급은 선언이 아니다 — 그 이름으로 우회할 수 없다.
  withProject(root => {
    assert.match(checkDesignBinding(root).detail, /기획에 없는 화면에 붙은 기록 1건: PAGE-999/)
  }, {document: ghost, plan: `${pageGroups('| PAGE-002 | Order Detail | order-detail | 1 |')}\n\n## Feature List\nPAGE-999는 검토 중이다.`})

  // 기획을 못 읽으면 조용히 넘기지 않는다 — Page Groups만 빠뜨리는 것으로 조건 커버리지
  // 전체를 끌 수 있으면 그것이 우회다. 못 재는 것과 잴 것이 없는 것은 다르고, 못 재면 말한다.
  withProject(root => {
    const result = checkDesignBinding(root)
    assert.equal(result.state, 'HOLE')
    assert.match(result.detail, /Page Groups 표를 읽지 못했다/)
  }, {document: ghost, plan: null})
})

test('기획에 있는 화면이 기록에 없으면 구멍이다', () => {
  withProject(root => {
    assert.match(checkDesignBinding(root).detail, /기록에 없는 화면 1건: PAGE-007/)
  }, {plan: pageGroups('| PAGE-002 | Order Detail | order-detail | 1 |', '| PAGE-007 | Settings | settings | 2 |')})
})

test('깨진 JSON은 조용히 통과하지 않는다', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wh-binding-')))
  try {
    mkdirSync(join(root, '_workspace/00_source'), {recursive: true})
    writeFileSync(join(root, DESIGN_BINDING_PATH), '{ not json')
    assert.equal(checkDesignBinding(root).state, 'HOLE')
  } finally { rmSync(root, {recursive: true, force: true}) }
})

// ── 조건의 분모 ─────────────────────────────────────────────────────────────
test('조건 열만 분모다 — 접두 없는 열은 서술이고, 해당 없음은 빠진다', () => {
  const table = parseInformationHierarchy(hierarchy(
    '| PAGE-002 | ① 주문 상태 | 이력 | 표준 | 첫 주문 안내 | 읽기 전용 배너 |',
    '| PAGE-003 | ① 설정 | — | 표준 | 해당 없음(항상 값이 있다) | 접근 요청 안내 |',
  ))
  assert.deepEqual(table.blanks, [])
  assert.deepEqual(table.axes.map(a => `${a.axis}:${a.value}`), ['state:empty', 'variant:권한 없음'])
  assert.deepEqual(table.rows[0].conditions, [{state: 'empty'}, {variant: '권한 없음'}])
  assert.deepEqual(table.rows[1].conditions, [{variant: '권한 없음'}])
})

test('빈 칸은 미결이다 — 표의 존재만 보던 것이 분모를 0으로 만들었다', () => {
  const table = parseInformationHierarchy(hierarchy('| PAGE-002 | ① 주문 상태 | 이력 | 표준 |  | 읽기 전용 배너 |'))
  assert.deepEqual(table.blanks, ['PAGE-002/state:empty'])
  const brief = hierarchy('| PAGE-002 | ① 주문 상태 | 이력 | 표준 |  | 읽기 전용 배너 |')
  withProject(root => {
    const inputs = checkDesignInputs(root)
    assert.equal(inputs.state, 'HOLE')
    assert.match(inputs.detail, /빈 칸 1건: PAGE-002\/state:empty/)
    // `design-inputs`는 `--to design`에만 서고 그 인계를 부르는 계약 문장이 아직 없다.
    // 부르지 않는 검사에 분모를 맡기면 분모가 없는 것과 같으므로 `design-binding`도 본다.
    const bound = checkDesignBinding(root)
    assert.equal(bound.state, 'HOLE')
    assert.match(bound.detail, /빈 칸 1건: PAGE-002\/state:empty/)
  }, {brief})
})

test('형 없는 열은 분모를 붕괴시킨다 — 조용히 넘기지 않는다', () => {
  // 빈 칸 우회를 닫으면 우회가 헤더로 옮겨간다. 종전 형식(`empty 시 내용`)은 서술로 읽혀
  // 분모가 state:default 하나로 줄고, 그러면 커버리지 게이트가 이름만 남는다.
  const legacy = [
    '## 화면별 정보 위계',
    '| 화면 | info:Primary | info:Secondary | info:밀도 | empty 시 내용 | 권한 없음 시 |',
    '|---|---|---|---|---|---|',
    '| PAGE-002 | ① 주문 상태 | 이력 | 표준 | 첫 주문 안내 | 읽기 전용 배너 |',
  ].join('\n')
  const table = parseInformationHierarchy(legacy)
  assert.equal(table.axes.length, 0)
  assert.deepEqual(table.untypedHeaders, ['empty 시 내용', '권한 없음 시'])
  withProject(root => {
    const result = checkDesignBinding(root)
    assert.equal(result.state, 'HOLE')
    assert.match(result.detail, /형이 없는 열/)
  }, {brief: legacy})
})

test('축 열 하나가 나머지 형 없는 열을 가리지 않는다 — 키워드 밖 조건도 잡는다', () => {
  // 접두를 하나만 붙이고 나머지를 그대로 두면, 종전에는 axes.length > 0이라 통과했다.
  const mixed = [
    '## 화면별 정보 위계',
    '| 화면 | info:Primary | info:밀도 | state:empty | error 시 내용 | 무료 플랜 시 |',
    '|---|---|---|---|---|---|',
    '| PAGE-002 | ① 주문 | 표준 | 첫 주문 안내 | 재시도 안내 | 배너 |',
  ].join('\n')
  const table = parseInformationHierarchy(mixed)
  assert.equal(table.axes.length, 1)
  // 키워드 목록에 없는 조건(`무료 플랜 시`)도 잡힌다 — 형이 없으면 추측하지 않고 물어본다.
  assert.deepEqual(table.untypedHeaders, ['error 시 내용', '무료 플랜 시'])
  withProject(root => {
    const result = checkDesignBinding(root)
    assert.equal(result.state, 'HOLE')
    assert.match(result.detail, /형이 없는 열 2개: error 시 내용, 무료 플랜 시/)
  }, {brief: mixed})
})

test('형 어휘 밖의 접두도 조용히 버리지 않는다', () => {
  // 접두를 붙였다는 것은 조건으로 의도했다는 뜻이다. 어휘가 틀렸는데 서술로 버리면
  // 접두를 아예 안 붙인 것과 같은 붕괴가 일어난다.
  const brief = [
    '## 화면별 정보 위계',
    '| 화면 | info:Primary | info:밀도 | state:empty | mode:compact |',
    '|---|---|---|---|---|',
    '| PAGE-002 | ① 주문 | 표준 | 첫 주문 안내 | 좁은 화면 |',
  ].join('\n')
  assert.deepEqual(parseInformationHierarchy(brief).untypedHeaders, ['mode:compact'])
  withProject(root => {
    assert.match(checkDesignBinding(root).detail, /형이 없는 열 1개: mode:compact/)
  }, {brief})
})

test('절 자체를 지우는 것으로 우회할 수 없다 — 개발 인계는 design-inputs를 다시 세우지 않는다', () => {
  withProject(root => {
    const result = checkDesignBinding(root)
    assert.equal(result.state, 'HOLE')
    assert.match(result.detail, /「화면별 정보 위계」를 헤딩으로 찾지 못했다/)
  }, {brief: null})
})

test('N/A는 칸 전체일 때만이다 — 화면 내용이 접두로 시작해도 조건은 남는다', () => {
  const table = parseInformationHierarchy(hierarchy(
    '| PAGE-002 | ① 주문 | 이력 | 표준 | 해당 없음 안내와 문의 CTA | 비적용(권한 구분 없음) |',
  ))
  assert.deepEqual(table.blanks, [])
  // 첫 칸은 실제 화면 내용이므로 조건이 남고, 둘째 칸은 사유 있는 N/A라 분모에서 빠진다.
  assert.deepEqual(table.rows[0].conditions, [{state: 'empty'}])
  for (const cell of ['해당 없음', '해당 없음(사유)', '비적용', 'n/a', 'N/A (없음)', '—', '-']) {
    const na = parseInformationHierarchy(hierarchy(`| PAGE-002 | ① 주문 | 이력 | 표준 | ${cell} | ${cell} |`))
    assert.deepEqual(na.rows[0].conditions, [], `${cell}가 N/A로 인정되지 않았다`)
  }
})

test('서술 열이 없으면 기본 조건의 근거가 없다', () => {
  const noInfo = [
    '## 화면별 정보 위계',
    '| 화면 | state:empty |', '|---|---|',
    '| PAGE-002 | 첫 주문 안내 |',
  ].join('\n')
  withProject(root => {
    const result = checkDesignInputs(root)
    assert.equal(result.state, 'HOLE')
    assert.match(result.detail, /서술 열/)
  }, {brief: noInfo, document: null})
})

test('화면 행을 빼는 것으로 분모를 줄일 수 없다 — 양방향으로 대조한다', () => {
  // PAGE-003을 선언해놓고 정보 위계에 안 적으면, 그 화면의 조건은 아무도 요구하지 않는다.
  withProject(root => {
    const result = checkDesignInputs(root)
    assert.equal(result.state, 'HOLE')
    assert.match(result.detail, /정보 위계 행이 없는 화면 1건: PAGE-003/)
  }, {
    plan: pageGroups('| PAGE-002 | Order Detail | order-detail | 1 |', '| PAGE-003 | Settings | settings | 2 |'),
    brief: hierarchy('| PAGE-002 | ① 주문 | 이력 | 표준 | 비적용(-) | 비적용(-) |'),
    document: null,
  })
  // PAGE-000은 전역 책임이라 화면 행을 요구하지 않는다.
  withProject(root => assert.equal(checkDesignInputs(root).state, 'PASS'), {
    plan: pageGroups('| PAGE-002 | Order Detail | order-detail | 1 |', '| PAGE-000 | Common | all | 99 |'),
    brief: hierarchy('| PAGE-002 | ① 주문 | 이력 | 표준 | 비적용(-) | 비적용(-) |'),
    document: null,
  })
})

test('shard로 나눠 적어도 모든 절을 읽는다 — 나누는 것이 게이트를 끄는 길이 되면 안 된다', () => {
  const sharded = [
    hierarchy('| PAGE-002 | ① 주문 | 이력 | 표준 | 비적용(-) | 비적용(-) |'),
    '',
    hierarchy('| PAGE-003 | ① 설정 | — | 표준 |  | 접근 요청 |'),
  ].join('\n')
  const table = parseInformationHierarchy(sharded)
  assert.equal(table.rows.length, 2, '두 번째 절의 행이 빠졌다')
  assert.deepEqual(table.blanks, ['PAGE-003/state:empty'], '두 번째 절의 빈 칸이 빠졌다')

  // 조건 열을 다른 절로 떼어놓는 것으로 분모를 비울 수 없다 — 축은 절의 합집합이고
  // 그 합집합을 모든 행에 적용한다. 답하지 않은 행은 빈 칸이다.
  const split = [
    '## 화면별 정보 위계',
    '| 화면 | info:Primary |', '|---|---|',
    '| PAGE-002 | ① 주문 |',
    '| PAGE-003 | ① 설정 |',
    '',
    '## 화면별 정보 위계',
    '| 화면 | state:empty |', '|---|---|',
  ].join('\n')
  assert.deepEqual(parseInformationHierarchy(split).blanks, ['PAGE-002/state:empty', 'PAGE-003/state:empty'])

  // 서술 열도 같다 — 한 절에만 `info:`를 두고 다른 절의 화면은 서술 없이 두는 것으로
  // 기본 조건의 근거를 비울 수 없다.
  const splitInfo = [
    '## 화면별 정보 위계',
    '| 화면 | info:Primary | state:empty |', '|---|---|---|',
    '| PAGE-002 | ① 주문 | 비적용(-) |',
    '',
    '## 화면별 정보 위계',
    '| 화면 | state:empty |', '|---|---|',
    '| PAGE-003 | 첫 설정 안내 |',
  ].join('\n')
  assert.deepEqual(parseInformationHierarchy(splitInfo).blanks, ['PAGE-003/info:Primary'])
})

test('칸을 아예 생략한 짧은 행도 빈 칸이다', () => {
  // 헤더는 6열인데 행이 5칸이면, 종전에는 존재하는 cells만 순회해서 마지막 칸이 검사에서
  // 통째로 빠졌다 — 빈 칸의 가장 흔한 형태다.
  const short = [
    '## 화면별 정보 위계',
    '| 화면 | info:Primary | info:밀도 | state:empty | info:비고 |',
    '|---|---|---|---|---|',
    '| PAGE-002 | ① 주문 | 표준 | 첫 주문 안내 |',
  ].join('\n')
  assert.deepEqual(parseInformationHierarchy(short).blanks, ['PAGE-002/info:비고'])
  withProject(root => assert.match(checkDesignBinding(root).detail, /빈 칸 1건/), {brief: short})
})

test('산문에 문구만 있는 것은 절이 아니다 — includes와 파서가 어긋나면 표 없는 문서가 통과한다', () => {
  const prose = '## UX 개요\n각 화면의 화면별 정보 위계는 다음 절에서 다룬다.\n\n## 디자인 방향\n- 브랜드 제약: 없음\n'
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wh-binding-')))
  try {
    mkdirSync(join(root, '_workspace/01_plan'), {recursive: true})
    writeFileSync(join(root, '_workspace/01_plan/ux-brief.md'), prose)
    const result = checkDesignInputs(root)
    assert.equal(result.state, 'HOLE')
    // 필수 절 앵커도 헤딩에 결박돼 있으므로 여기서 먼저 잡힌다 — 산문의 문구는 절이 아니다.
    assert.match(result.detail, /화면별 정보 위계|헤딩으로 찾지 못했다/)
  } finally { rmSync(root, {recursive: true, force: true}) }
})

test('해소되지 않는 행은 디자인 근거가 붙기 전에도 잡힌다', () => {
  // 종전에는 바인딩 문서가 있을 때만 봤다 — 없으면 checkDesignBinding이 SKIP이라
  // Page Groups와 어긋나는 행이 조용히 통과했다.
  const unknown = hierarchy('| 주문상세화면 | ① 주문 상태 | 이력 | 표준 | 비적용(-) | 비적용(-) |')
  withProject(root => {
    const result = checkDesignInputs(root)
    assert.equal(result.state, 'HOLE')
    assert.match(result.detail, /해소되지 않는 정보 위계 행 1건: 주문상세화면/)
  }, {brief: unknown, document: null})
})

test('구분선 없는 표는 표가 아니다 — 헤더가 데이터 행으로 읽히면 판정이 어긋난다', () => {
  const noSeparator = [
    '## 화면별 정보 위계',
    '| 화면 | info:Primary | state:empty |',
    '| PAGE-002 | ① 주문 | 첫 주문 안내 |',
  ].join('\n')
  const table = parseInformationHierarchy(noSeparator)
  assert.equal(table.malformed, true)
  assert.deepEqual(table.rows, [])
  withProject(root => assert.match(checkDesignBinding(root).detail, /구분선/), {brief: noSeparator})

  // 열 수가 안 맞는 구분선도 표가 아니다 — 3열 헤더에 `|---|` 하나면 정렬이 어긋난다.
  const shortSeparator = [
    '## 화면별 정보 위계',
    '| 화면 | info:Primary | state:empty |',
    '|---|',
    '| PAGE-002 | ① 주문 | 첫 주문 안내 |',
  ].join('\n')
  assert.equal(parseInformationHierarchy(shortSeparator).malformed, true)
})

test('생산자 템플릿의 표 형식이 파서와 맞는다', () => {
  // ux-researcher가 내놓는 형식이 파서에 안 맞으면, 정상 생성물이 게이트에 걸린다.
  // 이 저장소가 이미 물린 클래스 — 생산자와 검사기가 같은 형식을 말해야 한다.
  const template = readFileSync(new URL('../agents/ux-researcher.md', import.meta.url), 'utf8')
  // **템플릿의 헤딩을 그대로 쓴다.** 한국어 헤딩을 인위적으로 붙이면 필수 절 앵커와 파서의
  // 언어 집합이 어긋나 있어도 테스트가 통과한다 — 결함을 가리는 회귀가 된다(실제로 그랬다).
  const table = parseInformationHierarchy(template)
  assert.equal(table.malformed, false)
  assert.equal(table.rows.length, 1, '템플릿의 예시 행이 파싱되지 않는다')
  assert.deepEqual(table.untypedHeaders, [], '템플릿에 형 없는 열이 있다')
  assert.ok(table.axes.length >= 3, '템플릿에 조건 열이 없다')

  // 파싱만이 아니라 **검사 전체**를 템플릿의 헤딩 그대로 통과하는지 본다 — 필수 절 앵커가
  // 파서와 다른 언어 집합을 가지면 정상 산출물이 여기서 막힌다.
  const sections = template.match(/## Information Hierarchy per Screen[\s\S]*?(?=\n## Navigation)/)
  assert.ok(sections, '템플릿에서 정보 위계~디자인 방향 구간을 찾지 못했다')
  withProject(root => {
    const result = checkDesignInputs(root)
    assert.equal(result.state, 'PASS', `템플릿 형식이 검사에 막힌다: ${result.detail}`)
  }, {brief: sections[0], plan: pageGroups('| PAGE-001 | Dashboard | dashboard | 1 |'), document: null})
})

test('헤딩만 있고 표가 없으면 분모가 서지 않는다', () => {
  const headingOnly = '## 화면별 정보 위계\n각 화면의 정보 위계는 아래와 같다.\n'
  const table = parseInformationHierarchy(headingOnly)
  assert.equal(table.present, true)
  assert.deepEqual(table.rows, [])
  withProject(root => {
    assert.match(checkDesignBinding(root).detail, /정보 위계 절에 표가 없다/)
  }, {brief: headingOnly})
})

test('같은 사실을 두 검사가 각자 보고하지 않는다 — 빈 칸도 절 부재도', () => {
  const cases = [
    ['빈 칸', hierarchy('| PAGE-002 | ① 주문 상태 | 이력 | 표준 |  | 읽기 전용 배너 |'), /빈 칸|위계/],
    ['절 부재', null, /위계|ux-brief/],
  ]
  for (const [label, brief, pattern] of cases) {
    withProject(root => {
      const report = analyzeHandoffReadiness(root, {to: 'design'})
      const reporting = report.holes.filter(h => pattern.test(h.detail)).map(h => h.id)
      assert.deepEqual(reporting, ['design-inputs'], `${label}: 분모 문제를 ${reporting.length}개 검사가 보고했다 (${reporting.join(', ')})`)
    }, {brief})
  }
})

test('N/A 어휘와 백틱 route를 실제 코퍼스 형태로 받는다', () => {
  const table = parseInformationHierarchy(hierarchy(
    '| PAGE-002 | ① 주문 | 이력 | 표준 | 비적용(항상 값이 있다) | — |',
  ))
  assert.deepEqual(table.blanks, [])
  assert.deepEqual(table.rows[0].conditions, [])
  // Page Groups의 route가 백틱으로 감싸여 있어도 해소된다.
  withProject(root => assert.equal(checkDesignBinding(root).state, 'PASS'), {
    plan: pageGroups('| PAGE-002 | Order Detail | `order-detail` | 1 |'),
    brief: hierarchy('| order-detail | ① 주문 | 이력 | 표준 | 비적용(-) | 비적용(-) |'),
  })
})

test('기획이 선언한 조건에 근거가 없으면 인계가 막힌다 — default도 조건이다', () => {
  const brief = hierarchy('| PAGE-002 | ① 주문 상태 | 이력 | 표준 | 첫 주문 안내 | 읽기 전용 배너 |')
  // 기본 문서는 default와 empty만 덮는다 — variant:권한 없음이 남는다.
  withProject(root => {
    const result = checkDesignBinding(root)
    assert.equal(result.state, 'HOLE')
    assert.match(result.detail, /근거가 없는 조건 1건: PAGE-002\[variant=권한 없음\]/)
  }, {brief})

  const complete = binding()
  complete.bindings.push({
    pageGroup: 'PAGE-002', condition: {variant: '권한 없음'}, referenceIds: [],
    resolution: 'derive', declaredBy: 'user', declaredAt: AT,
  })
  withProject(root => assert.equal(checkDesignBinding(root).state, 'PASS'), {brief, document: complete})

  // default를 덮지 않으면 그것도 구멍이다.
  const noDefault = binding()
  noDefault.bindings[0].condition = {state: 'loading'}
  noDefault.bindings.push({
    pageGroup: 'PAGE-002', condition: {variant: '권한 없음'}, referenceIds: [],
    resolution: 'derive', declaredBy: 'user', declaredAt: AT,
  })
  withProject(root => {
    assert.match(checkDesignBinding(root).detail, /PAGE-002\[state=default\]/)
  }, {brief, document: noDefault})
})

test('정보 위계 행은 Page Groups로 해소된다 — 안 되면 조용히 넘기지 않는다', () => {
  assert.deepEqual(parsePageGroups(pageGroups('| PAGE-002 | Order Detail | order-detail | 1 |')),
    [{id: 'PAGE-002', page: 'Order Detail', route: 'order-detail'}])
  // 이름으로 적어도 Page Groups의 Page·Route/Screen과 일치하면 해소된다.
  const byName = hierarchy('| order-detail | ① 주문 상태 | 이력 | 표준 | 해당 없음(-) | 해당 없음(-) |')
  withProject(root => assert.equal(checkDesignBinding(root).state, 'PASS'), {brief: byName})
  const unknown = hierarchy('| 주문상세화면 | ① 주문 상태 | 이력 | 표준 | 해당 없음(-) | 해당 없음(-) |')
  withProject(root => {
    assert.match(checkDesignBinding(root).detail, /해소되지 않는 정보 위계 행 1건: 주문상세화면/)
  }, {brief: unknown})
})

test('두 인계 모두에서 검사가 선다 — 한쪽만 배선되면 사이에 지워진다', () => {
  const broken = binding()
  broken.bindings[0].declaredBy = 'inferred'
  withProject(root => {
    for (const to of ['design', 'development']) {
      const report = analyzeHandoffReadiness(root, {to})
      assert.ok(report.results.some(r => r.id === 'design-binding' && r.state === 'HOLE'), `${to}에서 design-binding 구멍이 보고되지 않았다`)
    }
  }, {document: broken})
})

// ── 디자인 부채 청구 (DESIGN_SOURCE: absent 경로) ────────────────────────────
// 실측(2026-09-04): 디자인 부재는 인계 판정에 흔적을 남기지 않는다 — 양쪽 인계 READY,
// 대조군 대비 판정 변화 0건. 그래서 막는 대신 개발 시점에 청구한다. 여기서 고정하는 것은
// **청구서가 실제로 무엇이 미결인지 이름으로 말하는가**이다.
const FULL_BRIEF = [
  '## 화면별 정보 위계',
  '| 화면 | info:Primary | info:밀도 | state:empty | variant:권한 없음 |',
  '|---|---|---|---|---|',
  '| PAGE-002 | ① 주문 | 표준 | 첫 주문 안내 | 읽기 전용 배너 |',
].join('\n')

test('디자인이 없으면 화면의 모든 조건이 시각 근거를 잃는다 — default 포함', () => {
  withProject(root => {
    const debt = designDebtReport(root)
    assert.equal(debt.bindingPresent, false)
    assert.equal(debt.designSource, null, '마커가 없으면 공급원은 모른다')
    assert.equal(debt.status, 'debt')
    assert.deepEqual(debt.denominatorProblems, [])
    // 내용은 기획에 있다 — 없는 것은 **어떻게 그리는가**뿐이므로 planOnly로 가른다.
    assert.deepEqual(debt.planOnly.map(item => `${item.pageGroup}[${item.label}]`),
      ['PAGE-002[state=default]', 'PAGE-002[state=empty]', 'PAGE-002[variant=권한 없음]'])
    assert.deepEqual(debt.deferred, [])
  }, {brief: FULL_BRIEF, document: null})
})

test('근거가 붙은 조건은 부채가 아니다 — 파생·재사용도 결정이다', () => {
  const document = binding()
  document.bindings.push({
    pageGroup: 'PAGE-002', condition: {variant: '권한 없음'}, referenceIds: [],
    resolution: 'reuse:order-detail', declaredBy: 'user', declaredAt: AT,
  })
  withProject(root => {
    const debt = designDebtReport(root)
    assert.equal(debt.status, 'clear')
    assert.deepEqual([...debt.deferred, ...debt.planOnly], [], '공급·파생·재사용이 부채로 잡혔다')
    assert.deepEqual(debt.screens[0].conditions.map(item => item.basis), ['supplied', 'derive', 'reuse:order-detail'])
  }, {brief: FULL_BRIEF, document})
})

test('분할된 decision-log도 정본이다 — 인수 기록을 찾지 못하면 경로가 완결되지 않는다', () => {
  // `artifact-sharding-contract.md`는 결정 로그를 ID 구간으로 나누고 디렉터리와 동명 `.md`를
  // 함께 두는 것을 금지한다. 계약이 flat만 말하면 분할 프로젝트에서 ③이 성립하지 않는다
  // (교차 모델 리뷰 2026-09-04). 기계는 이미 두 형태를 읽는다 — 산문이 그것을 따라간다.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wh-debt-')))
  try {
    mkdirSync(join(root, '_workspace/01_plan/decision-log'), {recursive: true})
    writeFileSync(join(root, '_workspace/01_plan/decision-log/PC-001~050.md'), '## PC-007 디자인 부채 인수\n범위: 이 프로젝트의 화면 조건 전부\n')
    assert.match(readDecisionLog(root), /PC-007/)
  } finally { rmSync(root, {recursive: true, force: true}) }
})

test('결정을 미룬 것(pending)은 시각 근거 부재와 다른 부류다 — 대가가 다르다', () => {
  const document = binding()
  document.bindings[1].resolution = 'pending'
  document.bindings.push({
    pageGroup: 'PAGE-002', condition: {variant: '권한 없음'}, referenceIds: [],
    resolution: 'derive', declaredBy: 'user', declaredAt: AT,
  })
  withProject(root => {
    const debt = designDebtReport(root)
    assert.deepEqual(debt.deferred.map(item => `${item.pageGroup}[${item.label}]`), ['PAGE-002[state=empty]'])
    assert.deepEqual(debt.planOnly, [])
  }, {brief: FULL_BRIEF, document})
})

test('기획이 없는 것을 "화면이 없다"로 말하지 않는다 — 부채가 최대인 상태다', () => {
  // 적대 리뷰(2026-09-04)가 실제 트리 2곳에서 재현한 거짓 보고다. 기획·디자인이 둘 다
  // absent인 web-app과 브라운필드 첫 작업이 "청구할 것이 없다"로 나왔다.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wh-debt-')))
  try {
    mkdirSync(join(root, '_workspace/01_plan'), {recursive: true})
    const debt = designDebtReport(root)
    assert.equal(debt.status, 'no-plan')
  } finally { rmSync(root, {recursive: true, force: true}) }
})

test('화면 없는 형태는 기획이 없어도 청구 대상이 아니다 — 형태 판정이 먼저다', () => {
  // 기획 부재를 먼저 보면 library·cli가 기획을 세우지 않은 **정상 경로**인데도
  // "부채가 최대"로 나온다(교차 모델 리뷰 2026-09-04).
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wh-debt-')))
  try {
    mkdirSync(join(root, '_workspace/03_dev'), {recursive: true})
    writeFileSync(join(root, '_workspace/03_dev/spec.json'), JSON.stringify({targetShapes: ['library']}))
    assert.equal(designDebtReport(root).status, 'no-screens')
  } finally { rmSync(root, {recursive: true, force: true}) }
})

test('검증 전 문서의 형태를 가정하지 않는다 — 보고가 비정상 종료하면 exit 0 약속이 깨진다', () => {
  // `binding-invalid` 판정보다 근거 수집이 먼저 돌므로, 유효 JSON이되 구조가 깨진 문서에서
  // TypeError가 나면 항상 exit 0을 약속한 보고가 죽는다(교차 모델 리뷰 2026-09-04).
  for (const bindings of [[null], ['문자열'], [{}], [{pageGroup: 7}]]) {
    withProject(root => {
      const debt = designDebtReport(root)
      assert.equal(debt.status, 'binding-invalid', JSON.stringify(bindings))
    }, {brief: FULL_BRIEF, document: {schemaVersion: 1, references: [], bindings, unbound: {references: [], pageGroups: []}}})
  }
})

test('깨진 근거 기록은 clear가 될 수 없다 — 막지 않는 보고가 거짓말하면 방어가 없다', () => {
  const broken = binding()
  broken.bindings[0].declaredBy = 'inferred'
  broken.bindings.push({
    pageGroup: 'PAGE-002', condition: {variant: '권한 없음'}, referenceIds: ['order-detail'],
    declaredBy: 'user', declaredAt: AT,
  })
  withProject(root => {
    const debt = designDebtReport(root)
    assert.equal(debt.status, 'binding-invalid')
    assert.ok(debt.bindingProblems.length > 0)
    // 같은 상태에서 인계 검사는 이미 HOLE이다 — 두 판정이 어긋나면 안 된다.
    assert.equal(checkDesignBinding(root).state, 'HOLE')
  }, {brief: FULL_BRIEF, document: broken})
})

test('UI로 확정된 스팩에서는 PAGE-000뿐인 것이 "화면 없음"이 아니다 — 불완전한 기획이다', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wh-debt-')))
  try {
    mkdirSync(join(root, '_workspace/01_plan'), {recursive: true})
    mkdirSync(join(root, '_workspace/03_dev'), {recursive: true})
    writeFileSync(join(root, '_workspace/03_dev/spec.json'), JSON.stringify({targetShapes: ['web-app']}))
    writeFileSync(join(root, '_workspace/01_plan/feature-plan.md'), pageGroups('| PAGE-000 | Common | all | 99 |'))
    assert.equal(designDebtReport(root).status, 'denominator-broken')
    // 정보 위계 표가 **유효한데 PAGE-000 행뿐**이어도 같다 — 잴 화면이 0개면 `clear`가
    // "부채 없음 — 화면 0개"라는 공허한 통과가 된다.
    writeFileSync(join(root, '_workspace/01_plan/ux-brief.md'),
      `${hierarchy('| PAGE-000 | ① 공통 | 이력 | 표준 | 비적용(-) | 비적용(-) |')}${DESIGN_DIRECTION}`)
    const debt = designDebtReport(root)
    assert.deepEqual(debt.screens, [])
    assert.equal(debt.status, 'denominator-broken')
  } finally { rmSync(root, {recursive: true, force: true}) }
})

test('디자인 산출물이 있으면 청구하지 않는다 — generated 경로를 되묻지 않는다', () => {
  // `design-binding.json`은 **공급된** 근거의 귀속 기록이라 `generated`에는 생기지 않는다.
  // 그것만 보고 판정하면 정상적으로 디자인을 만들고 승인받은 프로젝트가 전건 부채로 나오고,
  // 사용자는 이미 내린 결정을 다시 요구받는다(교차 모델 리뷰 2026-09-04).
  for (const artifact of ['design-system.md', 'layout-spec.md', 'component-spec.md']) {
    withProject(root => {
      assert.equal(designDebtReport(root).status, 'debt', `${artifact} 이전`)
      mkdirSync(join(root, '_workspace/02_design'), {recursive: true})
      writeFileSync(join(root, '_workspace/02_design', artifact), '# 산출물\n')
      assert.equal(designDebtReport(root).status, 'design-present', artifact)
    }, {brief: FULL_BRIEF, document: null})
  }
  // 공급된 귀속 기록이 있으면 산출물이 있어도 조건별로 잰다 — 그때는 잴 근거가 있다.
  withProject(root => {
    mkdirSync(join(root, '_workspace/02_design'), {recursive: true})
    writeFileSync(join(root, '_workspace/02_design/layout-spec.md'), '# 산출물\n')
    assert.equal(designDebtReport(root).status, 'debt')
  }, {brief: FULL_BRIEF})
})

test('공급된 디자인인데 귀속 기록이 없으면 무문서 SKIP이지 generated가 아니다', () => {
  // 산출물 존재만 보면 supplied 무문서 우회가 이리로 옮겨온다(교차 모델 리뷰 2026-09-04).
  // 마커가 정본이고, 없으면 `00_source/` 인벤토리가 공급 흔적이다.
  const probe = (setup, expected) => withProject(root => {
    mkdirSync(join(root, '_workspace/02_design'), {recursive: true})
    writeFileSync(join(root, '_workspace/02_design/layout-spec.md'), '# 산출물\n')
    setup(root)
    assert.equal(designDebtReport(root).status, expected)
  }, {brief: FULL_BRIEF, document: null})

  probe(() => {}, 'design-present')
  // **면제는 분모를 확인한 뒤에만.** 중단 과정에서 남은 산출물 하나가 깨진 기획을 통째로
  // 면제하면 반대 방향으로 샌다(교차 모델 리뷰 2026-09-04).
  const brokenDenominator = realpathSync(mkdtempSync(join(tmpdir(), 'wh-debt-')))
  try {
    mkdirSync(join(brokenDenominator, '_workspace/02_design'), {recursive: true})
    mkdirSync(join(brokenDenominator, '_workspace/01_plan'), {recursive: true})
    writeFileSync(join(brokenDenominator, '_workspace/02_design/layout-spec.md'), '# 산출물\n')
    writeFileSync(join(brokenDenominator, '_workspace/01_plan/feature-plan.md'), pageGroups('| PAGE-002 | Order | order-detail | 1 |'))
    // ux-brief가 없다 — 분모가 서지 않는다.
    assert.equal(designDebtReport(brokenDenominator).status, 'denominator-broken')
  } finally { rmSync(brokenDenominator, {recursive: true, force: true}) }
  probe(root => writeFileSync(join(root, '_workspace/web-harness.md'), '- DESIGN_SOURCE: supplied\n'), 'binding-missing')
  probe(root => writeFileSync(join(root, '_workspace/web-harness.md'), '- DESIGN_SOURCE: generated\n'), 'design-present')
  // **`absent`는 면제하지 않는다** — 그 경로는 Phase 2 체크포인트를 돌지 않았으므로 "이미
  // 확인했다"가 사실이 아니다. 중단된 실행이 남긴 산출물 하나로 청구가 사라지면 안 된다
  // (교차 모델 리뷰 2026-09-04).
  probe(root => writeFileSync(join(root, '_workspace/web-harness.md'), '- DESIGN_SOURCE: absent\n'), 'debt')
  // **인벤토리는 공급 신호가 아니다.** `00_source/source-index.md`는 기획·API·설계 공급에도
  // 생기며, 실제로 기획만 공급받고 디자인은 생성한 프로젝트가 있다(교차 모델 리뷰 2026-09-04).
  // 그것으로 공급을 단정하면 정상 프로젝트에 없는 귀속 기록을 요구하게 된다.
  probe(root => {
    mkdirSync(join(root, '_workspace/00_source'), {recursive: true})
    writeFileSync(join(root, '_workspace/00_source/source-index.md'), '# Source Index\n\n기획만 공급받았다.\n')
  }, 'design-present')
})

test('스팩도 검증 전 문서다 — 형태를 가정하면 보고가 죽거나 화면을 잃는다', () => {
  const probe = spec => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'wh-debt-')))
    try {
      mkdirSync(join(root, '_workspace/01_plan'), {recursive: true})
      mkdirSync(join(root, '_workspace/03_dev'), {recursive: true})
      writeFileSync(join(root, '_workspace/03_dev/spec.json'), JSON.stringify(spec))
      writeFileSync(join(root, '_workspace/01_plan/feature-plan.md'), pageGroups('| PAGE-002 | Order | order-detail | 1 |'))
      writeFileSync(join(root, '_workspace/01_plan/ux-brief.md'), `${FULL_BRIEF}${DESIGN_DIRECTION}`)
      return designDebtReport(root).status
    } finally { rmSync(root, {recursive: true, force: true}) }
  }
  // 배열이 아닌 형태에서 죽지 않는다.
  assert.equal(probe({targetShapes: 'web-app'}), 'debt')
  // 프로토타입과 겹치는 이름을 "등록된 형태"로 오인하지 않는다 — 오인하면 UI 없음으로
  // 확정되고 청구가 통째로 빠진다(fail-open).
  for (const shape of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    assert.equal(hasUserInterface([shape]), 'unknown', shape)
    assert.equal(probe({targetShapes: [shape], testLayers: {unit: 'src', e2e: 'e2e'}}), 'debt', shape)
  }
  // 비어 있거나 없는 것은 "화면 없음"이 아니라 "모른다" — Page Groups가 이어서 판정한다.
  assert.equal(probe({targetShapes: []}), 'debt')
  assert.equal(probe({}), 'debt')
})

test('공급원 판정 불가를 단정하지 않는다 — 보고 필드가 자기모순이면 안 된다', () => {
  withProject(root => {
    mkdirSync(join(root, '_workspace/02_design'), {recursive: true})
    writeFileSync(join(root, '_workspace/02_design/layout-spec.md'), '# 산출물\n')
    // 마커가 없으면 모른다 — `false`가 아니다.
    assert.equal(designDebtReport(root).designSource, null)
    writeFileSync(join(root, '_workspace/web-harness.md'), '- DESIGN_SOURCE: supplied\n')
    const debt = designDebtReport(root)
    assert.equal(debt.status, 'binding-missing')
    assert.equal(debt.designSource, 'supplied', 'status는 supplied라 하고 필드는 아니라고 하면 안 된다')
    assert.equal(debt.bindingPresent, false)
  }, {brief: FULL_BRIEF, document: null})
})

// ── 인수 기록 대조 (acknowledgedBy) ─────────────────────────────────────────
// 청구가 자기신고로 끝나지 않게 하는 자리. `ux-brief` 행·칸의 결정 ID 인용을 **결정 로그와
// 대조**해 실재할 때만 인수로 센다. 없는 ID를 적어 미결을 지우는 것은 자기신고보다 나쁘다.
const ackBrief = (row) => [
  '## 화면별 정보 위계',
  '| 화면 | info:Primary | info:밀도 | state:empty | variant:권한 없음 |',
  '|---|---|---|---|---|',
  row,
].join('\n')
const withLog = (root, body) => {
  mkdirSync(join(root, '_workspace/01_plan'), {recursive: true})
  writeFileSync(join(root, '_workspace/01_plan/decision-log.md'), body)
}

test('조건 칸의 인수 토큰은 그 조건만 인수한다', () => {
  withProject(root => {
    withLog(root, '## PC-007 (2026-09-04) — 빈 상태는 구현 판단에 맡긴다\n')
    const debt = designDebtReport(root)
    assert.deepEqual(debt.acknowledged.map(i => `${i.label}←${i.acknowledgedBy}`), ['state=empty←PC-007'])
    assert.deepEqual(debt.planOnly.map(i => i.label), ['state=default', 'variant=권한 없음'])
    assert.equal(debt.status, 'debt', '일부만 인수됐으면 아직 부채다')
  }, {brief: ackBrief('| PAGE-002 | ① 주문 | 표준 | 첫 주문 안내 (ack:PC-007) | 읽기 전용 배너 |'), document: null})
})

test('이름 칸의 인수 토큰은 그 화면의 조건 전부를 인수한다', () => {
  withProject(root => {
    withLog(root, '## PC-011 (2026-09-04) — 이 화면의 조건은 구현이 정한다\n')
    const debt = designDebtReport(root)
    assert.equal(debt.status, 'acknowledged', '전부 인수됐으면 미결이 아니다')
    assert.deepEqual(debt.planOnly, [])
    assert.equal(debt.acknowledged.length, 3)
  }, {brief: ackBrief('| PAGE-002 (ack:PC-011) | ① 주문 | 표준 | 첫 주문 안내 | 읽기 전용 배너 |'), document: null})
})

test('없는 결정을 인수 토큰으로 적으면 인수가 아니다 — 파일에 남은 거짓을 이름으로 낸다', () => {
  withProject(root => {
    withLog(root, '## PC-007 (2026-09-04) — 다른 결정\n')
    const debt = designDebtReport(root)
    assert.deepEqual(debt.acknowledged, [], '로그에 없는 ID가 인수로 세어졌다')
    assert.deepEqual(debt.danglingCitations.map(i => i.id), ['PC-999'])
    assert.equal(debt.status, 'debt')
  }, {brief: ackBrief('| PAGE-002 | ① 주문 | 표준 | 첫 주문 안내 (ack:PC-999) | 읽기 전용 배너 |'), document: null})
})

test('결정 로그가 없으면 어떤 인수 토큰도 인수가 아니다', () => {
  withProject(root => {
    const debt = designDebtReport(root)
    assert.deepEqual(debt.acknowledged, [])
    assert.deepEqual(debt.danglingCitations.map(i => i.id), ['PC-007'])
    assert.equal(debt.status, 'debt')
  }, {brief: ackBrief('| PAGE-002 | ① 주문 | 표준 | 첫 주문 안내 (ack:PC-007) | 읽기 전용 배너 |'), document: null})
})

test('표제가 아닌 ID는 인수가 아니다 — 로그 본문 언급을 인수로 읽으면 대조가 문자열 검색이 된다', () => {
  // 대조는 `declaredDecisions`(표제)로 한다. 본문 포함 검사로 바꾸면 "PC-007은 보류한다"처럼
  // **결정이 아니라고 적은 줄**이 인수를 세운다 — 이 회귀가 그 변이를 잡는다(적대 리뷰 2026-09-04).
  withProject(root => {
    withLog(root, '## D-001 (2026-09-04) — 다른 결정\n\n- PC-007은 아직 보류한다.\n')
    const debt = designDebtReport(root)
    assert.deepEqual(debt.acknowledged, [], '표제가 아닌 본문 언급이 인수로 세어졌다')
    assert.deepEqual(debt.danglingCitations.map(i => i.id), ['PC-007'])
    assert.equal(debt.status, 'debt')
  }, {brief: ackBrief('| PAGE-002 | ① 주문 | 표준 | 첫 주문 안내 (ack:PC-007) | 읽기 전용 배너 |'), document: null})
})

test('맨 ID는 인수가 아니다 — 내용 근거 인용을 인수로 읽으면 다른 게이트가 부채를 지운다', () => {
  // `checkDecisionsLanded`는 정본이 새 결정을 ID로 인용하도록 밀고, 실제 트리에 그 습관이
  // 있다("decision-log PC-002 연계"). 그 인용을 인수로 세면 하네스의 게이트를 따르는 것이
  // 곧 부채를 지우는 행위가 된다(적대 리뷰 2026-09-04).
  withProject(root => {
    withLog(root, '## PC-002 (2026-09-04) — 주문 상세 정보 위계 조정\n')
    const debt = designDebtReport(root)
    assert.deepEqual(debt.acknowledged, [], '내용 인용이 인수로 세어졌다')
    assert.deepEqual(debt.danglingCitations, [])
    assert.equal(debt.status, 'debt')
  }, {brief: ackBrief('| PAGE-002 | ① 주문 (decision-log PC-002 연계) | 표준 | 첫 주문 안내 | 읽기 전용 배너 |'), document: null})
})

test('하네스 자신의 ID는 인수 토큰이 아니다 — REQ-F-001의 F-001로 오탐하지 않는다', () => {
  // 종전 구현은 `PAGE|FEAT|TC|REQ` 전방탐색으로 걸렀는데 `REQ-F-001`의 `F-001`이 빠져나가
  // "결정 로그에 없는 ID를 인용했다"는 거짓 보고를 냈다(실측 2026-09-04).
  withProject(root => {
    withLog(root, '## PC-007 (2026-09-04) — 결정\n')
    const debt = designDebtReport(root)
    assert.deepEqual(debt.danglingCitations, [], '하네스 자신의 ID가 인용으로 읽혔다')
    assert.deepEqual(debt.acknowledged, [])
  }, {brief: ackBrief('| PAGE-002 | ① 주문 (REQ-F-001, FEAT-003, TC-003-1) | 표준 | 첫 주문 안내 | 읽기 전용 배너 |'), document: null})
})

test('ID 체계를 박지 않는다 — 인수 토큰 뒤의 어떤 접두도 로그와 대조한다', () => {
  // 하네스 계약은 `PC-NNN`이고 track은 `D-NNN`을 쓴다. 하나를 박으면 다른 쪽에서 이 대조가
  // 전건 오탐이 된다(`declaredDecisions`가 같은 이유로 접두를 로그에서 읽는다).
  withProject(root => {
    withLog(root, '## D-042 (2026-09-04) — 이 화면의 조건은 구현이 정한다\n')
    const debt = designDebtReport(root)
    assert.equal(debt.status, 'acknowledged')
    assert.deepEqual([...new Set(debt.acknowledged.map(i => i.acknowledgedBy))], ['D-042'])
  }, {brief: ackBrief('| PAGE-002 (ack:D-042) | ① 주문 | 표준 | 첫 주문 안내 | 읽기 전용 배너 |'), document: null})
})

test('근거가 있는 조건에 인수 토큰을 얹어도 인수 목록에 들어가지 않는다', () => {
  // `derive`·`reuse:*`는 이미 결정된 조건이라 인수 대상이 아니다 — "인수된 부채 N건"이
  // 부채가 아니었던 것을 세면 숫자가 사실보다 커진다.
  withProject(root => {
    withLog(root, '## PC-011 (2026-09-04) — 인수\n')
    const debt = designDebtReport(root)
    assert.deepEqual(debt.acknowledged.map(i => i.label), ['variant=권한 없음'],
      'supplied·derive 조건이 인수 목록에 들어갔다')
  }, {brief: ackBrief('| PAGE-002 (ack:PC-011) | ① 주문 | 표준 | 첫 주문 안내 | 읽기 전용 배너 |')})
})

test('인수 토큰만 있는 칸을 빈 칸으로 잡지 않는다 — 현재 계약은 내용 있음으로 본다', () => {
  const table = parseInformationHierarchy(ackBrief('| PAGE-002 | ① 주문 | 표준 | (ack:PC-007) | 배너 |'))
  assert.deepEqual(table.blanks, [], '토큰이 있는 칸을 빈 칸으로 볼지는 내용 판정이 아니다')
  // 토큰은 내용이 아니지만 칸이 비어 있지도 않다 — 현재 계약은 이 자리를 "내용 있음"으로
  // 본다. 그 판단을 명시적으로 고정한다(바꾸려면 이 회귀가 먼저 깨진다).
  assert.deepEqual(table.rows[0].conditions.map(c => Object.values(c)[0]), ['empty', '권한 없음'])
})

test('인수는 시각 근거가 아니다 — clear와 섞지 않는다', () => {
  withProject(root => {
    withLog(root, '## PC-011 (2026-09-04) — 인수\n')
    const debt = designDebtReport(root)
    assert.equal(debt.status, 'acknowledged')
    assert.notEqual(debt.status, 'clear')
    // 근거가 있는 조건은 인수 목록에 들어가지 않는다.
    assert.ok(debt.acknowledged.every(item => item.acknowledgedBy !== null))
  }, {brief: ackBrief('| PAGE-002 (ack:PC-011) | ① 주문 | 표준 | 첫 주문 안내 | 읽기 전용 배너 |'), document: null})
})

test('카탈로그 밖 형태는 testLayers.e2e가 화면 여부를 말한다', () => {
  // `spec.mjs`가 미등록 형태에 대해 "경로를 적거나 (absent — 이유)로 명시하라"고 이미
  // 요구한다. 그 선언을 안 보고 Page Groups로 넘어가면 미등록 UI 형태가 PAGE-000뿐일 때
  // 불완전한 기획이 "화면 없음"으로 통과한다(교차 모델 리뷰 2026-09-04).
  const probe = (testLayers, expected) => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'wh-debt-')))
    try {
      mkdirSync(join(root, '_workspace/01_plan'), {recursive: true})
      mkdirSync(join(root, '_workspace/03_dev'), {recursive: true})
      writeFileSync(join(root, '_workspace/03_dev/spec.json'), JSON.stringify({targetShapes: ['dashboard-app'], testLayers}))
      writeFileSync(join(root, '_workspace/01_plan/feature-plan.md'), pageGroups('| PAGE-000 | Common | all | 99 |'))
      assert.equal(designDebtReport(root).status, expected, JSON.stringify(testLayers))
    } finally { rmSync(root, {recursive: true, force: true}) }
  }
  probe({unit: 'src', e2e: 'e2e'}, 'denominator-broken')          // UI가 있다 — 기획이 불완전하다
  probe({unit: 'src', e2e: '(absent — 화면 없음)'}, 'no-screens')  // 스팩이 화면 없음을 선언했다
  probe({unit: 'src'}, 'no-screens')                               // 말하지 않았다 — Page Groups로 판정
})

test('화면이 없는 형태에는 청구할 것이 없다 — Page Groups가 전역 책임뿐일 때', () => {
  withProject(root => {
    assert.equal(designDebtReport(root).status, 'no-screens')
  }, {brief: null, plan: pageGroups('| PAGE-000 | Common | all | 99 |'), document: null})
})

test('Page Groups 표가 없는 것은 화면이 없는 것이 아니다', () => {
  withProject(root => {
    assert.equal(designDebtReport(root).status, 'denominator-broken')
  }, {brief: FULL_BRIEF, plan: '## FEAT-001 첫째\n- TC-001-1 기대\n', document: null})
})

test('분모를 못 읽으면 청구 대신 그 사실을 낸다 — 범위 없는 인수를 만들지 않는다', () => {
  withProject(root => {
    const debt = designDebtReport(root)
    assert.equal(debt.status, 'denominator-broken')
    assert.ok(debt.denominatorProblems.length > 0)
  }, {brief: '## 화면별 정보 위계\n표는 아직 없다.\n', document: null})
})

test('배선: --design-debt가 프로세스로 돌고 진행을 막지 않는다', () => {
  withProject(root => {
    const result = spawnSync(process.execPath, [
      fileURLToPath(new URL('./validate-handoff-readiness.mjs', import.meta.url)),
      '--project', root, '--design-debt',
    ], {encoding: 'utf8'})
    // **보고이지 판정이 아니다** — 부채가 있어도 exit 0이다. 여기서 막으면 absent를 고를 수
    // 없게 되고, 고를 수 없으면 사용자는 우회로 돌아간다(provenance §3).
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.match(result.stdout, /시각 근거가 없는 조건 3건/)
    assert.match(result.stdout, /PAGE-002\[variant=권한 없음\]/)
  }, {brief: FULL_BRIEF, document: null})
})

test('배선: 두 시점이 청구서를 부른다 — 부르지 않는 절차는 존재하지 않는 것과 같다', () => {
  // 개발 착수 직전(결정 요구)과 기획 발행 직후(보여주기)의 두 자리다. 산문에서 명령이
  // 사라지면 기계는 그대로 도는데 아무도 부르지 않는 상태가 된다 — 이 저장소가 `--to design`
  // 에서 이미 겪은 형태이며, 그것은 protected-core §4에 한계로 등록돼 있다.
  const surface = name => readFileSync(new URL(`../skills/web-orchestrator/references/${name}`, import.meta.url), 'utf8')
  assert.match(surface('phase-3-development.md'), /--design-debt/, '개발 착수 직전 청구가 없다')
  const checkpoints = surface('approval-checkpoints.md')
  assert.match(checkpoints, /--design-debt/, 'Phase 1 → 2에서 부채를 보여주지 않는다')
  // 그 자리의 **강도**가 명시돼야 한다 — 조건별 결정을 요구하면 근거 없는 결정을 받게 된다.
  assert.match(checkpoints, /조건별 결정은 요구하지 않는다/, '기획 발행 시점의 강도가 명시되지 않았다')
  // 다만 "붙일지"는 여기서 확인한다 — 그 비용이 여기가 가장 싸다(스팩 재확정이 없다).
  assert.match(checkpoints, /absent 유지/, '되돌릴 기회가 확인 항목에 없다')
})

test('배선: bash 정책이 --design-debt를 허용한다 — 등록 없는 명령은 에이전트 경로에서 막힌다', () => {
  // 오케스트레이터가 부를 명령을 정책에 등록하지 않으면 에이전트 경로에서 DENY로 막히고,
  // 저자는 메인 스레드라 그것을 못 본다 — 이 저장소가 이미 두 번 물린 클래스다.
  const decide = command => evaluateGlobalBashPolicy({
    agent_type: 'code-reviewer', tool_name: 'Bash', tool_input: {command},
  }).allowed
  const base = 'node .claude/scripts/validate-handoff-readiness.mjs --project . --design-debt'
  assert.equal(decide(base), true)
  assert.equal(decide(`${base} --json`), true)
  // 인자 계약은 좁게 유지한다 — 알 수 없는 플래그가 함께 오면 허용하지 않는다.
  assert.equal(decide(`${base} --fix`), false)
  // 기존 형태는 그대로 허용된다(약화 없음).
  assert.equal(decide('node .claude/scripts/validate-handoff-readiness.mjs --project . --to development'), true)
})
