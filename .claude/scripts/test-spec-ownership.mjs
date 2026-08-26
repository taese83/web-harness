#!/usr/bin/env node
// test-spec-ownership.mjs — 스팩 유래 소유권 회귀 (Stage 3b의 안전망).
//
// 여기서 고정하는 사실:
//   (1) layerMap이 소유권 경로를 공급한다 — FSD가 아닌 어휘도 열린다
//   (2) fail-closed 유지 — 스팩이 없거나 신뢰 불가면 기존 등록부로 돌아간다. 전체 허용 금지
//   (3) 레이어가 겹치면 스팩을 신뢰하지 않는다 — 넓은 레이어로 남의 영역을 삼키는 확대 차단
//   (4) 역할 매핑이 없는 에이전트는 스팩의 영향을 받지 않는다
//   (5) 부재 표기(괄호 주석)는 경로 주장이 아니다
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AGENT_LAYER_ROLES, AGENT_OWNERSHIP, DEFAULT_LAYER_MAP, findLayerOverlaps,
  isLayerPathDeclared, resolveSpecOwnership, resolveDeveloperOwnership, intersectWithScope,
} from './agent-registry.mjs'

const owns = (patterns, path) => patterns.some(pattern => pattern.test(path))

// ── (1) 비-FSD 어휘가 열린다 ─────────────────────────────────────────────────
test('layerMap이 소유권 경로를 공급한다 — FSD가 아닌 어휘도 열린다', () => {
  // 실측된 브라운필드 형태: entities/features/widgets가 아니라 stores/components/hooks
  const lock = {layerMap: {domainModel: 'src/stores', clientState: 'src/state', featureUI: 'src/components'}}
  const patterns = resolveSpecOwnership(lock, 'client-domain-state-builder')
  assert.ok(patterns, '역할 매핑이 있으면 스팩에서 패턴이 나와야 한다')
  assert.ok(owns(patterns, 'src/stores/editor.ts'), '기존 등록부라면 소유자 없음으로 막혔을 경로')
  assert.equal(owns(patterns, 'src/entities/item/model.ts'), false, 'FSD 기본 경로는 이 스팩의 소유가 아니다')
})

test('모노레포 접두를 포섭한다', () => {
  const lock = {layerMap: {unitTests: 'src/tests/'}}
  const patterns = resolveSpecOwnership(lock, 'test-writer')
  assert.ok(owns(patterns, 'packages/widget-builder/src/tests/a.spec.ts'))
})

test('여러 역할이 매핑된 에이전트는 선언된 레이어만 갖는다', () => {
  const lock = {layerMap: {domainModel: 'src/stores', clientState: 'src/state'}}
  const patterns = resolveSpecOwnership(lock, 'client-domain-state-builder')
  assert.ok(owns(patterns, 'src/stores/editor.ts'))
  assert.ok(owns(patterns, 'src/state/session.ts'))
  // 선언되지 않은 레이어는 열리지 않는다
  assert.equal(owns(patterns, 'src/widgets/Panel.tsx'), false)
})

// ── (2) fail-closed ──────────────────────────────────────────────────────────
test('회귀 반증: 스팩이 없으면 null — 호출자가 AGENT_OWNERSHIP으로 돌아간다', () => {
  for (const lock of [null, {}, {layerMap: {}}]) {
    assert.equal(resolveSpecOwnership(lock, 'entity-query-builder'), null)
  }
})

test('회귀 반증: 구조 지시 빌더 6종은 제거됐고 폴백으로 되살아나지 않는다', () => {
  // 2026-08-26: 6종의 소유권이 실측으로 성립하지 않았다(3중 겹침 + 비-FSD 어휘 무소유).
  // 되살리면 다시 FSD 경로 처방이 된다. carve-out(live-mode 제외)은 그 6종의 유일한
  // 정당한 기능이었으나, layerMap이 표현하지 못하는 한계로 protected-core §4에 남아 있다.
  for (const gone of ['app-shell-builder', 'route-builder', 'component-builder',
                      'entity-query-builder', 'feature-mutation-builder', 'data-ui-binder']) {
    assert.equal(AGENT_OWNERSHIP[gone], undefined, `${gone}이 등록부에 되살아났다`)
    assert.equal(AGENT_LAYER_ROLES[gone], undefined, `${gone}이 역할 매핑에 되살아났다`)
  }
})

test('DEFAULT_LAYER_MAP은 참조 표현이며 폴백이 아니다', () => {
  assert.deepEqual(Object.keys(DEFAULT_LAYER_MAP).sort(),
    ['composedUI', 'domainModel', 'featureLogic', 'routes', 'sharedKernel'])
  assert.equal(resolveSpecOwnership(null, 'entity-query-builder'), null,
    'DEFAULT_LAYER_MAP이 폴백으로 쓰이면 안 된다')
})

test('회귀 반증: 매핑된 레이어가 layerMap에 없으면 null이지 전체 허용이 아니다', () => {
  // domainModel이 선언되지 않았다 — 다른 레이어만 있다
  const lock = {layerMap: {routes: 'src/pages/'}}
  assert.equal(resolveSpecOwnership(lock, 'entity-query-builder'), null,
    '전체 허용이 되면 소유권이 무너진다')
})

test('부재 표기는 경로 주장이 아니다', () => {
  assert.equal(isLayerPathDeclared('(absent — 네트워크 계층 없음)'), false)
  assert.equal(isLayerPathDeclared('   '), false)
  assert.equal(isLayerPathDeclared('src/stores'), true)
  const lock = {layerMap: {domainModel: '(absent)'}}
  assert.equal(resolveSpecOwnership(lock, 'entity-query-builder'), null)
})

// ── (3) 겹침 차단 — 권한 확대 벡터 ───────────────────────────────────────────
test('회귀 반증: 레이어가 겹치면 스팩을 신뢰하지 않는다', () => {
  // src/가 src/pages/를 삼킨다 — 이걸 허용하면 넓은 레이어 하나로 남의 영역을 가져갈 수 있다
  const lock = {layerMap: {domainModel: 'src/', routes: 'src/pages/'}}
  assert.equal(resolveSpecOwnership(lock, 'entity-query-builder'), null)
})

test('겹침 탐지가 동일 경로와 접두 포함을 모두 잡는다', () => {
  assert.equal(findLayerOverlaps({a: 'src/x', b: 'src/x/'}).length, 1, '동일 경로')
  assert.equal(findLayerOverlaps({a: 'src/', b: 'src/pages/'}).length, 1, '접두 포함')
  assert.equal(findLayerOverlaps({a: 'src/a/', b: 'src/b/'}).length, 0, '형제는 겹치지 않는다')
  assert.equal(findLayerOverlaps({a: 'src/ab/', b: 'src/a/'}).length, 0, '이름 접두는 경로 접두가 아니다')
})

// ── (4) 역할 매핑 밖 에이전트 ────────────────────────────────────────────────
test('역할 매핑이 없는 에이전트는 스팩의 영향을 받지 않는다', () => {
  const lock = {layerMap: {domainModel: 'src/stores'}}
  assert.equal(resolveSpecOwnership(lock, 'deploy-ci-writer'), null)
  assert.ok(AGENT_OWNERSHIP['deploy-ci-writer'], '기존 등록부는 그대로 유지된다')
})

test('역할 매핑에 등록된 에이전트는 전부 기존 등록부에도 있다', () => {
  for (const agent of Object.keys(AGENT_LAYER_ROLES)) {
    assert.ok(AGENT_OWNERSHIP[agent], `${agent}가 기존 등록부에 없으면 폴백이 불가능하다`)
  }
})

// ── 단일 개발 에이전트 (2026-08-26) ──────────────────────────────────────────
// 구조 지시 빌더 6종의 소유권이 실측으로 성립하지 않았다 — src/pages/**를 셋이 겹쳐 갖고,
// 비-FSD 어휘는 소유자가 없었다. 격리가 아니라 FSD 경로 처방이었다.
test('개발 에이전트가 비-FSD 어휘를 소유한다', () => {
  // 실사용 확정 2호(@kakao/ai-chatkit)의 실제 layerMap
  const spec = {layerMap: {'spa-ui': 'src', 'api-routes': 'api', e2e: 'playwright'}}
  const patterns = resolveDeveloperOwnership(spec)
  assert.ok(patterns, 'layerMap이 있으면 소유권이 나와야 한다')
  for (const path of ['src/main.tsx', 'api/health.ts', 'playwright/specs/a.spec.ts']) {
    assert.ok(owns(patterns, path), `${path}를 소유하지 못한다`)
  }
  assert.equal(owns(patterns, 'docs/x.md'), false, '선언되지 않은 경로는 소유하지 않는다')
})

test('회귀 반증: 스폰 범위는 소유권을 넓히지 못한다', () => {
  const spec = {layerMap: {'spa-ui': 'src', 'api-routes': 'api'}}
  const own = resolveDeveloperOwnership(spec)
  const scoped = intersectWithScope(own, ['api'])
  assert.ok(owns(scoped, 'api/health.ts'), '범위 안은 통과')
  assert.equal(owns(scoped, 'src/main.tsx'), false, '범위 밖은 차단 — 소유해도 이번 스폰은 아니다')
  // 범위가 layerMap 밖을 가리켜도 넓어지지 않는다
  const wide = intersectWithScope(own, ['docs'])
  assert.equal(owns(wide, 'docs/x.md'), false, '범위가 소유권을 넓히면 경계가 무너진다')
})

test('회귀 반증: 스팩이 없으면 개발 에이전트는 아무것도 못 쓴다', () => {
  // FSD 기본 경로를 폴백으로 주면 그 순간 다시 경로 처방이 된다.
  assert.equal(resolveDeveloperOwnership(null), null)
  assert.equal(resolveDeveloperOwnership({layerMap: {}}), null)
  assert.deepEqual(AGENT_OWNERSHIP.developer, [], '등록부 폴백이 비어 있어야 한다')
})

test('회귀 반증: layerMap이 겹치면 개발 에이전트도 신뢰하지 않는다', () => {
  assert.equal(resolveDeveloperOwnership({layerMap: {a: 'src/', b: 'src/pages/'}}), null)
})
