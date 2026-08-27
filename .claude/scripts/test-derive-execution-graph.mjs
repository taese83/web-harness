#!/usr/bin/env node
// test-derive-execution-graph.mjs — 도출 DAG가 어댑터 tasks를 대체할 수 있는가.
//
// 등가성을 증명한 뒤에 지운다. 재현하지 못하면 어댑터가 뭔가 더 담고 있었다는 뜻이다.
import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {dirname, join} from 'node:path'

const BASELINE_PATH = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/adapter-baseline.json')
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
  // 어댑터는 2026-08-26에 삭제됐다. 삭제 직전의 tasks를 fixtures/adapter-baseline.json에
  // 동결했다 — 도출이 그 그래프를 재현한다는 증거를 잃지 않기 위해서다.
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
  const SHAPES = {'react-vite-spa': ['web-app'], 'vite-serverless-hybrid': ['web-app', 'serverless-functions']}
  let compared = 0
  for (const [profile, entry] of Object.entries(baseline)) {
    const {tasks, errors} = deriveGraph({checks: checksFor(SHAPES[profile])})
    assert.deepEqual(errors, [], `${profile}: 도출이 실패했다`)
    const derived = new Map(tasks.map(t => [t.id, t.requires.slice().sort().join(',')]))
    for (const task of entry.tasks) {
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

test('release.assemble은 릴리스를 게이트하는 evidence의 합집합이다', () => {
  // 2026-08-27: "모든 evidence"가 아니다. `gatesRelease: false`인 것은 빠진다 —
  // typecheck는 빌드가 이미 요구하므로 전이적으로 강제되고, 어댑터 선언도 그렇게 돼 있다.
  // 직접 요구하면 선언과 어긋나 등가가 깨진다(간선 비교가 잡는다).
  const checks = checksFor(['web-app'])
  const {tasks} = deriveGraph({checks})
  const release = tasks.find(t => t.id === 'release.assemble')
  const gating = new Set(checks.filter(check => check.gatesRelease !== false).map(check => check.id))
  const evidence = tasks
    .filter(task => gating.has(task.id))
    .flatMap(task => task.provides)
    .filter(name => name.startsWith('evidence.'))
  assert.deepEqual(release.requires, [...evidence].sort())
  assert.deepEqual(release.provides, ['release.candidate'])
  assert.ok(
    !release.requires.includes('evidence.typecheck'),
    'gatesRelease:false가 무시됐다 — 어댑터 선언과 간선이 어긋난다',
  )
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
  // 메시지는 어느 검사가 어느 산출물을 못 찾는지 둘 다 말해야 한다 — 2026-08-27 이름 있는
  // 산출물 도입으로 산출물이 하나가 아니게 됐고, "빌드가 없다"만으로는 어느 것인지 모른다.
  assert.match(errors[0], /x\.runtime/)
  assert.match(errors[0], /artifact\.built/)
})

test('이름 있는 2차 산출물: 소비자가 그 산출물을 요구한다', () => {
  const {tasks, errors} = deriveGraph({
    checks: [
      {id: 'app.build'},
      {id: 'app.image', producesArtifact: 'artifact.image', needsArtifact: true},
      {id: 'app.image-smoke', needsArtifact: 'artifact.image'},
    ],
  })
  assert.deepEqual(errors, [])
  const smoke = tasks.find(task => task.id === 'app.image-smoke')
  assert.deepEqual(smoke.requires, ['artifact.image'], '2차 산출물 소비가 기본 빌드로 퇴화했다')
})

test('배포 타깃별 릴리스: 활성 검사만 요구하고 smoke는 게이트하지 않는다', () => {
  const {tasks, errors} = deriveGraph({
    checks: [
      {id: 'app.build'},
      {id: 'app.node-run', needsArtifact: true, requires: ['node-server']},
      {id: 'app.node-smoke', needsArtifact: true, requires: ['node-server'], gatesRelease: false},
      {id: 'app.static-run', needsArtifact: true, requires: ['static-export']},
    ],
    capabilities: [],
    deploymentTargets: ['node-server', 'static-export'],
    defaultTarget: 'node-server',
  })
  assert.deepEqual(errors, [])
  // 기본 타깃을 품은 그룹만 release.candidate를 낸다 — 어댑터 선언 형상과 같다.
  const node = tasks.find(task => task.id === 'release.assemble')
  const staticRelease = tasks.find(task => task.id === 'release.static-export')
  assert.deepEqual(node.requires, ['evidence.app-node-run'], 'smoke가 릴리스를 게이트하거나 타깃 필터가 새고 있다')
  assert.deepEqual(node.provides, ['release.candidate', 'release.node-server'])
  assert.deepEqual(staticRelease.requires, ['evidence.app-static-run'])
  assert.deepEqual(staticRelease.provides, ['release.static-export'])
})
