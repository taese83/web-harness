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
  AGENT_LAYER_ROLES, AGENT_OWNERSHIP, findLayerOverlaps,
  isLayerPathDeclared, resolveSpecOwnership,
} from './agent-registry.mjs'

const owns = (patterns, path) => patterns.some(pattern => pattern.test(path))

// ── (1) 비-FSD 어휘가 열린다 ─────────────────────────────────────────────────
test('layerMap이 소유권 경로를 공급한다 — FSD가 아닌 어휘도 열린다', () => {
  // 실측된 브라운필드 형태: entities/features/widgets가 아니라 stores/components/hooks
  const lock = {layerMap: {domainModel: 'src/stores', routes: 'src/pages/', featureUI: 'src/components'}}
  const patterns = resolveSpecOwnership(lock, 'entity-query-builder')
  assert.ok(patterns, '역할 매핑이 있으면 스팩에서 패턴이 나와야 한다')
  assert.ok(owns(patterns, 'src/stores/editor.ts'), '기존 등록부라면 소유자 없음으로 막혔을 경로')
  assert.equal(owns(patterns, 'src/entities/item/model.ts'), false, 'FSD 기본 경로는 이 스팩의 소유가 아니다')
})

test('모노레포 접두를 포섭한다', () => {
  const lock = {layerMap: {routes: 'src/pages/'}}
  const patterns = resolveSpecOwnership(lock, 'route-builder')
  assert.ok(owns(patterns, 'packages/widget-builder/src/pages/Home.tsx'))
})

test('여러 역할이 매핑된 에이전트는 선언된 레이어만 갖는다', () => {
  const lock = {layerMap: {sharedKernel: 'src/shared', featureUI: 'src/components'}}
  const patterns = resolveSpecOwnership(lock, 'component-builder')
  assert.ok(owns(patterns, 'src/shared/ui/Button.tsx'))
  assert.ok(owns(patterns, 'src/components/editor/Pane.tsx'))
  // composedUI는 layerMap에 없으므로 그 영역은 열리지 않는다
  assert.equal(owns(patterns, 'src/widgets/Panel.tsx'), false)
})

// ── (2) fail-closed ──────────────────────────────────────────────────────────
test('회귀 반증: 스팩이 없으면 null — 호출자가 기존 등록부로 돌아간다', () => {
  assert.equal(resolveSpecOwnership(null, 'entity-query-builder'), null)
  assert.equal(resolveSpecOwnership({}, 'entity-query-builder'), null)
  assert.equal(resolveSpecOwnership({layerMap: {}}, 'entity-query-builder'), null)
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
