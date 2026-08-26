#!/usr/bin/env node
// test-execution-binding.mjs — receipt가 실행을 결정한 것에 결박되는가.
//
// 종전 profileBinding의 두 결함을 고정한다:
//   (1) 배포 메타(deploymentProvider·releaseTarget)를 묶고 있었다 — Score·OAM 기준 관심사 혼입,
//       SLSA 기준 build provenance의 필드가 아니다
//   (2) `if (expectedProfile)`로 감싸여 프로필이 없으면 검증 전체가 **조용히 건너뛰어졌다**
import assert from 'node:assert/strict'
import test from 'node:test'
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {computeExecutionBinding, verifyExecutionBinding, harnessIdentity} from './execution-binding-lib.mjs'
import {deriveGraph, readShapeChecks} from './derive-execution-graph.mjs'

const TASKS = deriveGraph({checks: readShapeChecks().common.checks}).tasks
const withSpec = (spec, run) => {
  const root = mkdtempSync(join(tmpdir(), 'wh-bind-'))
  try {
    if (spec !== null) {
      mkdirSync(join(root, '_workspace/03_dev'), {recursive: true})
      writeFileSync(join(root, '_workspace/03_dev/spec.json'), JSON.stringify(spec))
    }
    run(root)
  } finally { rmSync(root, {recursive: true, force: true}) }
}

test('실행을 결정한 셋을 묶는다 — 카탈로그·그래프·스팩', () => {
  withSpec({targetShapes: ['web-app']}, root => {
    const binding = computeExecutionBinding({projectRoot: root, tasks: TASKS})
    for (const key of ['shapeChecksSha256', 'graphSha256', 'specSha256']) {
      assert.match(binding[key], /^[0-9a-f]{64}$/, key)
    }
  })
})

test('회귀 반증: 배포 메타를 묶지 않는다', () => {
  // Score·OAM: 배포는 플랫폼이 실행하지 개발자 스펙에 담지 않는다.
  // SLSA: build provenance는 builder·buildType·externalParameters를 묶지 배포 대상이 아니다.
  withSpec({targetShapes: ['web-app']}, root => {
    const binding = computeExecutionBinding({projectRoot: root, tasks: TASKS})
    for (const gone of ['deploymentProvider', 'deploymentTarget', 'releaseTarget', 'selectedCapabilities']) {
      assert.equal(gone in binding, false, `${gone}는 하네스가 들 자리가 아니다`)
    }
  })
})

test('회귀 반증: 검증이 조건부로 건너뛰어지지 않는다', () => {
  // 종전 if (expectedProfile)의 실패 모드 — 프로필이 없으면 11필드가 통째로 미검증이었다.
  const errors = verifyExecutionBinding({receipt: {}, expected: harnessIdentity(), relativePath: 'x.json'})
  assert.equal(errors.length, 1)
  assert.match(errors[0], /execution binding이 없다/)
})

test('그래프가 바뀌면 stale이다', () => {
  withSpec({targetShapes: ['web-app']}, root => {
    const before = computeExecutionBinding({projectRoot: root, tasks: TASKS})
    const after = computeExecutionBinding({projectRoot: root, tasks: [...TASKS, {id: 'x.new', requires: [], provides: ['evidence.x']}]})
    assert.notEqual(before.graphSha256, after.graphSha256)
    const errors = verifyExecutionBinding({receipt: {executionBinding: before}, expected: after, relativePath: 'x.json'})
    assert.ok(errors.some(e => /graphSha256/.test(e)))
  })
})

test('스팩이 바뀌면 stale이다', () => {
  let first
  withSpec({targetShapes: ['web-app']}, root => { first = computeExecutionBinding({projectRoot: root, tasks: TASKS}) })
  withSpec({targetShapes: ['library']}, root => {
    const second = computeExecutionBinding({projectRoot: root, tasks: TASKS})
    assert.notEqual(first.specSha256, second.specSha256)
  })
})

test('스팩이 없으면 null이며 그 자체가 결속의 일부다', () => {
  withSpec(null, root => {
    const binding = computeExecutionBinding({projectRoot: root, tasks: TASKS})
    assert.equal(binding.specSha256, null)
    // 스팩 없이 만든 증거와 스팩 있는 증거는 서로 교체될 수 없다
    const errors = verifyExecutionBinding({
      receipt: {executionBinding: binding},
      expected: {...binding, specSha256: 'a'.repeat(64)},
      relativePath: 'x.json',
    })
    assert.ok(errors.some(e => /specSha256/.test(e)))
  })
})
