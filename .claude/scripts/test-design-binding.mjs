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
import {mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {
  DESIGN_BINDING_PATH, collectDesignBinding, conditionKey, crossCheckVisualReferences, validateDesignBinding,
} from './design-binding-lib.mjs'
import {analyzeHandoffReadiness, checkDesignBinding, pageGroupIdsIn} from './validate-handoff-readiness.mjs'
import {validateVisualContract} from './visual-evidence-lib.mjs'

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
const withProject = (fn, {document = binding(), plan = pageGroups('| PAGE-002 | Order Detail | order-detail | 1 |')} = {}) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wh-binding-')))
  try {
    mkdirSync(join(root, '_workspace/00_source'), {recursive: true})
    mkdirSync(join(root, '_workspace/01_plan'), {recursive: true})
    writeFileSync(join(root, '_workspace/00_source/figma-a1-412-9037.md'), '# snapshot')
    if (document) writeFileSync(join(root, DESIGN_BINDING_PATH), JSON.stringify(document))
    if (plan) writeFileSync(join(root, '_workspace/01_plan/feature-plan.md'), plan)
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

  // 기획을 못 읽었으면 대조하지 않는다 — 없는 것과 못 읽은 것은 다르다.
  withProject(root => assert.equal(checkDesignBinding(root).state, 'PASS'), {document: ghost, plan: null})
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
