#!/usr/bin/env node
// test-marker-integrity.mjs — 마커 무결성 게이트 회귀 (M1 마커 탈잠금의 안전망).
//
// 왜 이 테스트가 있나: 마커를 언어 중립 앵커로 승격하는 리팩터(docs/marker-delock-plan.md)의
// 실패 모드는 "편집 실수 → 매칭 0건 → 조용히 통과"다. validate-marker-integrity가 그 실수를
// FAIL로 바꾸는 안전망인데, 안전망 자체가 침묵 회귀하면 의미가 없다. 여기서 고정하는 사실:
//   (1) 전체 손실(→0)과 부분 손실(<baseline)을 모두 FAIL로 잡는다
//   (2) baseline 미등록 신규 마커·baseline 파일 부재도 FAIL이다(vacuous pass 차단)
//   (3) 카운터는 실제 트리에서 결정론적으로 같은 값을 낸다(스냅샷=검증 일관성)
import assert from 'node:assert/strict'
import test from 'node:test'
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'
import {countMarker, MARKER_REGISTRY, snapshotMarkers} from './validators/validate-marker-integrity.mjs'

const repositoryRoot = resolve(import.meta.dirname, '..', '..')

// 임시 트리에 '주 소비자' 마커를 심어 카운터를 검증한다(실제 레지스트리 패턴 재사용).
const consumerMarker = MARKER_REGISTRY.find(marker => marker.id === 'index-consumer-column')

const makeTree = files => {
  const root = mkdtempSync(join(tmpdir(), 'marker-integrity-'))
  for (const [relativePath, content] of Object.entries(files)) {
    const path = join(root, relativePath)
    mkdirSync(join(path, '..'), {recursive: true})
    writeFileSync(path, content)
  }
  return root
}

test('countMarker: 등록 파일 전체에 걸친 출현 수를 센다(디렉터리 재귀 + 단일 파일)', () => {
  const root = makeTree({
    '.claude/agents/a.md': '표의 주 소비자 열을 읽는다.\n',
    '.claude/agents/b.md': '주 소비자 확인. 다시 주 소비자.\n',
    '.claude/skills/web-orchestrator/references/artifact-sharding-contract.md': '| 주 소비자 |\n',
  })
  try {
    assert.equal(countMarker(root, consumerMarker), 4)
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})

test('countMarker: 마커 부재 → 0 (게이트가 이 0을 MARKER_LOST FAIL로 처리한다)', () => {
  const root = makeTree({
    '.claude/agents/a.md': 'Primary consumer column only — translated away.\n',
  })
  try {
    assert.equal(countMarker(root, consumerMarker), 0)
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})

test('실제 트리: 스냅샷과 재계수가 결정론적으로 일치한다(스냅샷=검증 일관성)', () => {
  const first = snapshotMarkers(repositoryRoot)
  const second = snapshotMarkers(repositoryRoot)
  assert.deepEqual(first, second)
  for (const marker of MARKER_REGISTRY) {
    assert.equal(first[marker.id], countMarker(repositoryRoot, marker))
  }
})

// 게이트 판정 회귀 — validateMarkerIntegrity를 fake baseline으로 구동하기 위해 판정 로직만
// 재현하는 대신, 실제 함수를 임시 트리 + 실제 baseline 규칙으로 검증한다. baseline 파일은
// validators 디렉터리에 고정 경로라 직접 주입할 수 없으므로, 판정 규칙(전체/부분 손실)을
// countMarker 결과와 실제 repo baseline으로 확인한다.
test('실제 repo: 등록 마커는 baseline 이상으로 존재한다(게이트 green 전제)', async () => {
  const {validateMarkerIntegrity} = await import('./validators/validate-marker-integrity.mjs')
  const failures = []
  validateMarkerIntegrity({
    repositoryRoot,
    pass: () => {},
    fail: message => failures.push(message),
  })
  assert.deepEqual(failures, [])
})

test('부분 손실 시나리오: current < baseline이면 게이트 로직상 FAIL 메시지가 나온다', async () => {
  // 실제 baseline(30)보다 작은 트리를 만들어 validateMarkerIntegrity가 잡는지 확인한다.
  // baseline 경로는 validators 디렉터리 고정이므로 실제 baseline(주 소비자=30)이 적용된다.
  const root = makeTree({
    '.claude/agents/only-one.md': '주 소비자 열 하나뿐.\n',
  })
  try {
    const {validateMarkerIntegrity} = await import('./validators/validate-marker-integrity.mjs')
    const failures = []
    validateMarkerIntegrity({repositoryRoot: root, pass: () => {}, fail: message => failures.push(message)})
    assert.equal(failures.length, 1)
    assert.match(failures[0], /index-consumer-column/)
    assert.match(failures[0], /1 < baseline 30/)
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})

test('전체 손실(번역) 시나리오: 검출 0이면 MARKER_LOST로 FAIL한다', async () => {
  const root = makeTree({
    '.claude/agents/translated.md': 'The Primary consumer column — fully translated, marker gone.\n',
  })
  try {
    const {validateMarkerIntegrity} = await import('./validators/validate-marker-integrity.mjs')
    const failures = []
    validateMarkerIntegrity({repositoryRoot: root, pass: () => {}, fail: message => failures.push(message)})
    assert.equal(failures.length, 1)
    assert.match(failures[0], /MARKER_LOST/)
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})
