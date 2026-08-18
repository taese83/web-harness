#!/usr/bin/env node
// test-marker-integrity.mjs — 마커 무결성 게이트 회귀 (M1 마커 탈잠금의 안전망).
//
// 왜 이 테스트가 있나: 마커를 언어 중립 앵커로 승격하는 리팩터(docs/marker-delock-plan.md)의
// 실패 모드는 "편집 실수 → 매칭 0건 → 조용히 통과"다. validate-marker-integrity가 그 실수를
// FAIL로 바꾸는 안전망인데, 안전망 자체가 침묵 회귀하면 의미가 없다. 여기서 고정하는 사실:
//   (1) 전체 손실(→0)과 부분 손실(<baseline)을 모두 FAIL로 잡는다
//   (2) baseline 미등록 신규 마커·baseline 파일 부재도 FAIL이다(vacuous pass 차단)
//   (3) 카운터는 실제 트리에서 결정론적으로 같은 값을 낸다(스냅샷=검증 일관성)
//   (4) M1 ③ 승격 후: 앵커는 **언어와 무관**하다 — 산문을 통째로 영어화해도 카운트 불변
import assert from 'node:assert/strict'
import test from 'node:test'
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'
import {countMarker, MARKER_REGISTRY, snapshotMarkers} from './validators/validate-marker-integrity.mjs'

const repositoryRoot = resolve(import.meta.dirname, '..', '..')

// 실제 레지스트리 패턴 재사용 — 테스트가 검증하는 것이 곧 배선된 패턴이다.
const consumerMarker = MARKER_REGISTRY.find(marker => marker.id === 'consumer-read-protocol')
const ANCHOR = '<!-- marker:consumer-read-protocol -->'

const makeTree = files => {
  const root = mkdtempSync(join(tmpdir(), 'marker-integrity-'))
  for (const [relativePath, content] of Object.entries(files)) {
    const path = join(root, relativePath)
    mkdirSync(join(path, '..'), {recursive: true})
    writeFileSync(path, content)
  }
  return root
}

test('countMarker: 등록 파일 전체에 걸친 앵커 출현 수를 센다(디렉터리 재귀 + 단일 파일)', () => {
  const root = makeTree({
    '.claude/agents/a.md': `INDEX를 먼저 읽는다. ${ANCHOR}\n`,
    '.claude/agents/b.md': `첫 줄 ${ANCHOR}\n다른 문맥 ${ANCHOR}\n`,
    '.claude/skills/web-orchestrator/references/artifact-sharding-contract.md': `## 소비자 읽기 프로토콜 ${ANCHOR}\n`,
  })
  try {
    assert.equal(countMarker(root, consumerMarker), 4)
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})

test('언어 독립성(M1 ③의 요점): 산문을 영어화해도 앵커 카운트는 불변이다', () => {
  const korean = makeTree({
    '.claude/agents/a.md': `\`주 소비자\`와 \`담당 범위\`로 절을 고른다. ${ANCHOR}\n`,
  })
  const english = makeTree({
    '.claude/agents/a.md': `Select sections via the consumer and scope columns. ${ANCHOR}\n`,
  })
  try {
    assert.equal(countMarker(korean, consumerMarker), countMarker(english, consumerMarker))
    assert.equal(countMarker(english, consumerMarker), 1)
  } finally {
    rmSync(korean, {recursive: true, force: true})
    rmSync(english, {recursive: true, force: true})
  }
})

test('countMarker: 앵커 부재 → 0 (게이트가 이 0을 MARKER_LOST FAIL로 처리한다)', () => {
  const root = makeTree({
    '.claude/agents/a.md': 'Prose only — the anchor comment was deleted in a refactor.\n',
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
  // 실제 baseline(28 = 27 agents + 계약 1)보다 작은 트리 — baseline 경로는 validators 디렉터리
  // 고정이므로 실제 baseline이 적용된다. 이 숫자는 의식적 baseline 갱신 시 함께 갱신한다(canary).
  // 28이 된 경위: 최초 일괄 편집이 26개(어미 "…프로토콜이다." 패턴)만 잡았고, 리뷰가
  // component-designer.md(어미 "…따른다.")의 누락을 발견해 27번째 에이전트로 추가했다.
  // 존재-류 마커 2종(M1 ④)은 온전한 상태로 포함 — consumer 마커의 부분 손실만 검사한다.
  const root = makeTree({
    '.claude/agents/only-one.md': `한 줄만 남음 ${ANCHOR}\n`,
    '.claude/skills/timeseries-dashboard/references/detection-contract.md':
      'realtime is not required. <!-- marker:timeseries-historical-only -->\n',
    '.claude/skills/web-orchestrator/SKILL.md':
      'defer mock-api-builder. <!-- marker:timeseries-realtime-build-order -->\n',
  })
  try {
    const {validateMarkerIntegrity} = await import('./validators/validate-marker-integrity.mjs')
    const failures = []
    validateMarkerIntegrity({repositoryRoot: root, pass: () => {}, fail: message => failures.push(message)})
    assert.equal(failures.length, 1)
    assert.match(failures[0], /consumer-read-protocol/)
    assert.match(failures[0], /1 < baseline 28/)
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})

test('전체 손실(앵커 삭제) 시나리오: 검출 0이면 마커별로 MARKER_LOST FAIL한다', async () => {
  // 빈 트리 — 등록 마커 전부가 손실이다. 마커마다 독립적으로 잡히는지 확인한다.
  const root = makeTree({
    '.claude/agents/refactored.md': 'All anchors stripped during a bulk rewrite.\n',
  })
  try {
    const {validateMarkerIntegrity, MARKER_REGISTRY} = await import('./validators/validate-marker-integrity.mjs')
    const failures = []
    validateMarkerIntegrity({repositoryRoot: root, pass: () => {}, fail: message => failures.push(message)})
    assert.equal(failures.length, MARKER_REGISTRY.length)
    for (const message of failures) assert.match(message, /MARKER_LOST/)
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})
