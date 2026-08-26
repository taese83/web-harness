#!/usr/bin/env node
// test-derive-execution-graph.mjs — 도출 DAG가 어댑터 tasks를 대체할 수 있는가.
//
// 등가성을 증명한 뒤에 지운다. 재현하지 못하면 어댑터가 뭔가 더 담고 있었다는 뜻이다.
import assert from 'node:assert/strict'
import test from 'node:test'
import {existsSync, readFileSync} from 'node:fs'
import {deriveGraph, readShapeChecks, RECEIPT_ALIASES} from './derive-execution-graph.mjs'

const checksFor = shapes => {
  const catalog = readShapeChecks()
  return [...(catalog.common?.checks ?? []), ...shapes.flatMap(s => catalog.shapes?.[s]?.checks ?? [])]
}

test('어댑터 tasks를 재현한다 (알려진 차이 2종 제외)', () => {
  // 알려진 차이:
  //   ingestion.validate — capability 조건부 검사(requires: external-ingestion)다. 형태가 아니라
  //     능력에 걸려 있어 shape-checks에 없다. 미해결로 §4에 등록한다.
  //   release.assemble — 도출이 evidence.typecheck를 명시한다. 어댑터는 build가 이미 requires하니
  //     전이적이라고 보고 생략했다. **도출이 더 엄격하다** — 게이트 강화 방향이라 허용한다.
  let compared = 0
  for (const [profile, shapes] of [['react-vite-spa', ['web-app']], ['vite-serverless-hybrid', ['web-app', 'serverless-functions']]]) {
    const adapterPath = `.claude/adapters/${profile}/adapter.json`
    if (!existsSync(adapterPath)) continue
    const {tasks, errors} = deriveGraph({checks: checksFor(shapes)})
    assert.deepEqual(errors, [], `${profile}: 도출이 실패했다`)
    const derived = new Map(tasks.map(t => [t.id, t.requires.slice().sort().join(',')]))
    const adapter = JSON.parse(readFileSync(adapterPath, 'utf8'))
    for (const task of adapter.tasks) {
      // 어댑터의 vite.production-boundary는 receipt 파일명(vite.production-mock-boundary)과
      // 어긋나 있었다. 형태 카탈로그는 receipt 이름을 정본으로 쓴다.
      const id = task.id.replace('vite.production-boundary', 'vite.production-mock-boundary')
      if (id === 'ingestion.validate' || id === 'release.assemble') continue
      assert.ok(derived.has(id), `${profile}/${id}: 도출에 없다`)
      assert.equal(derived.get(id), (task.requires ?? []).slice().sort().join(','), `${profile}/${id}`)
      compared++
    }
  }
  assert.ok(compared >= 14, `비교가 ${compared}건뿐이다 — 어댑터를 못 읽었으면 vacuous PASS다`)
})

test('release.assemble은 모든 evidence의 합집합이다', () => {
  const {tasks} = deriveGraph({checks: checksFor(['web-app'])})
  const release = tasks.find(t => t.id === 'release.assemble')
  const evidence = tasks.flatMap(t => t.provides).filter(p => p.startsWith('evidence.'))
  assert.deepEqual(release.requires, [...evidence].sort())
  assert.deepEqual(release.provides, ['release.candidate'])
})

// ── 도출 규칙 ────────────────────────────────────────────────────────────────
test('needsArtifact가 빌드 의존을 가른다', () => {
  const {tasks} = deriveGraph({checks: [
    {id: 'x.build'}, {id: 'x.static'}, {id: 'x.runtime', needsArtifact: true},
  ]})
  const byId = new Map(tasks.map(t => [t.id, t]))
  assert.deepEqual(byId.get('x.build').requires, ['dependencies.installed', 'evidence.typecheck'])
  assert.deepEqual(byId.get('x.static').requires, ['dependencies.installed'])
  assert.deepEqual(byId.get('x.runtime').requires, ['artifact.built'])
})

test('회귀 반증: evidence 이름이 충돌하면 loud fail이다', () => {
  // 도출 초안의 실제 버그: 접두만 떼서 api.unit과 quality.unit이 둘 다 evidence.unit이 됐다.
  // 조용히 합쳐지면 하나만 돌아도 release가 통과한다.
  // 별칭과 폴백이 같은 이름으로 만나는 경로: quality.unit→'unit'(별칭), 'unit'→'unit'(폴백)
  const {errors} = deriveGraph({checks: [{id: 'quality.unit'}, {id: 'unit'}]})
  assert.equal(errors.length, 1)
  assert.match(errors[0], /충돌/)
})

test('api.unit과 quality.unit이 구분된다', () => {
  const {tasks, errors} = deriveGraph({checks: [{id: 'quality.unit'}, {id: 'api.unit'}]})
  assert.deepEqual(errors, [])
  const provides = tasks.flatMap(t => t.provides).filter(p => p.startsWith('evidence.'))
  assert.deepEqual(provides.sort(), ['evidence.api-unit', 'evidence.unit'])
  assert.equal(RECEIPT_ALIASES['api.unit'], 'api-unit')
})

test('회귀 반증: 빌드 없이 artifact를 요구하면 도달 불가 그래프다', () => {
  const {tasks, errors} = deriveGraph({checks: [{id: 'x.runtime', needsArtifact: true}]})
  assert.equal(tasks.length, 0)
  assert.match(errors[0], /빌드 task가 없는데/)
})
