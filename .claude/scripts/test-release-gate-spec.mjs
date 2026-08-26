#!/usr/bin/env node
// test-release-gate-spec.mjs — 스팩 정합의 릴리스 게이트 배선 회귀.
//
// 여기서 고정하는 사실:
//   (1) **잠금이 없으면 발화하지 않는다** — 잠금은 opt-in이다. 발화하면 기존 프로젝트가 전부 막힌다
//   (2) 잠금이 있고 정합이 깨지면 릴리스가 막힌다 — 한 번 잠그면 구속력을 갖는다
//   (3) 미판정(unverifiable)은 errors로 올리지 않는다 — 실패로도 통과로도 바꾸지 않는다
//   (4) 검사가 던져도 게이트가 통째로 죽지 않고 그 사실이 error로 남는다
import assert from 'node:assert/strict'
import test from 'node:test'
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {validateReleaseGate} from './release-gate-lib.mjs'
import {lockSpec} from './lock-spec.mjs'

const specErrors = errors => errors.filter(message => message.startsWith('Spec conformance'))

const withProject = ({locked = false, layerMap = {}} = {}, run) => {
  const root = mkdtempSync(join(tmpdir(), 'web-harness-release-spec-'))
  try {
    mkdirSync(join(root, '_workspace/02_design'), {recursive: true})
    mkdirSync(join(root, '_workspace/03_dev'), {recursive: true})
    writeFileSync(join(root, 'package.json'), `${JSON.stringify({name: 'fixture'})}\n`)
    if (locked) {
      const decision = {
        targetShapes: ['web-app'],
        architecture: {pattern: 'existing', rationale: '기존 관례'},
        layerMap,
        libraries: {},
        moduleBoundaries: [],
        acceptanceSource: 'absent',
        acceptanceRefs: [],
        nonGoals: [],
        openDecisions: [],
      }
      writeFileSync(join(root, '_workspace/02_design/solution-design.md'),
        ['```json web-harness:solution-design', JSON.stringify(decision, null, 2), '```', ''].join('\n'))
      writeFileSync(join(root, '_workspace/03_dev/spec-lock.json'),
        `${JSON.stringify(lockSpec(root), null, 2)}\n`)
    }
    return run(root)
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
}

// ── (1) opt-in — 이것이 깨지면 기존 프로젝트가 전부 막힌다 ───────────────────
test('회귀 반증: 잠금이 없으면 스팩 정합이 릴리스를 막지 않는다', () => {
  withProject({locked: false}, root => {
    const {errors} = validateReleaseGate(root)
    assert.deepEqual(specErrors(errors), [],
      '잠금 없는 프로젝트에 스팩 오류가 붙으면 기존 흐름이 전부 막힌다')
  })
})

// ── (2) 잠그면 구속력 ────────────────────────────────────────────────────────
test('회귀 반증: 잠금이 있고 layerMap이 없는 경로를 가리키면 릴리스가 막힌다', () => {
  withProject({locked: true, layerMap: {routes: 'src/definitely-absent/'}}, root => {
    const {errors} = validateReleaseGate(root)
    const spec = specErrors(errors)
    assert.ok(spec.length > 0, '잠금이 구속력을 갖지 않으면 잠글 이유가 없다')
    assert.ok(spec.some(message => message.includes('layerMap')))
  })
})

test('잠금이 있고 정합이 맞으면 스팩 오류가 붙지 않는다', () => {
  withProject({locked: true, layerMap: {}}, root => {
    assert.deepEqual(specErrors(validateReleaseGate(root).errors), [])
  })
})

// ── (3) 미판정은 실패가 아니다 ──────────────────────────────────────────────
test('unverifiable은 릴리스 오류로 올라오지 않는다', () => {
  // targetShapes에 규칙 없는 형태를 넣으면 unverifiable이 생기지만 FAIL은 아니다.
  const root = mkdtempSync(join(tmpdir(), 'web-harness-release-unver-'))
  try {
    mkdirSync(join(root, '_workspace/02_design'), {recursive: true})
    mkdirSync(join(root, '_workspace/03_dev'), {recursive: true})
    writeFileSync(join(root, 'package.json'), `${JSON.stringify({name: 'fixture'})}\n`)
    const decision = {
      targetShapes: ['browser-extension'],
      architecture: {pattern: 'existing', rationale: 'r'},
      layerMap: {}, libraries: {}, moduleBoundaries: [],
      acceptanceSource: 'absent', acceptanceRefs: [], nonGoals: [], openDecisions: [],
    }
    writeFileSync(join(root, '_workspace/02_design/solution-design.md'),
      ['```json web-harness:solution-design', JSON.stringify(decision, null, 2), '```', ''].join('\n'))
    writeFileSync(join(root, '_workspace/03_dev/spec-lock.json'),
      `${JSON.stringify(lockSpec(root), null, 2)}\n`)
    assert.deepEqual(specErrors(validateReleaseGate(root).errors), [],
      '미판정을 실패로 바꾸면 모르는 형태가 릴리스를 막는다')
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})

// ── (4) 손상된 잠금은 잠금 없음이 아니다 ───────────────────────────────────
// 이전 테스트는 assert.ok(Array.isArray(errors))였다 — throw만 없으면 항상 참인 vacuous
// assertion이고, 그 뒤에 "파일 한 바이트를 깨뜨리면 결박이 꺼진다"는 fail-open이 숨어 있었다.
test('회귀 반증: 깨진 spec-lock은 NOT_LOCKED로 강등되지 않고 릴리스를 막는다', () => {
  withProject({locked: false}, root => {
    writeFileSync(join(root, '_workspace/03_dev/spec-lock.json'), '{not json')
    const spec = specErrors(validateReleaseGate(root).errors)
    assert.ok(spec.length > 0, '깨진 잠금이 통과하면 파일 하나 깨뜨려 결박을 끌 수 있다')
    assert.ok(spec.some(message => message.includes('INVALID_SPEC_LOCK')))
  })
})

test('잠금이 배열·null이어도 손상으로 본다', () => {
  for (const bad of ['[]', 'null', '"x"']) {
    withProject({locked: false}, root => {
      writeFileSync(join(root, '_workspace/03_dev/spec-lock.json'), bad)
      assert.ok(specErrors(validateReleaseGate(root).errors).length > 0, `${bad}가 통과했다`)
    })
  }
})

// ── (5) RUN 상태 — 실제 receipt 이름으로 ────────────────────────────────────
// 이 게이트가 유일하게 발화하는 상태다. 이전에는 잠긴 fixture에 evidence가 없어 NOT_RUN만
// 확인했고, 그 사이 요구 id와 실제 receipt 파일명이 어긋난 채로 남아 있었다.
test('회귀 반증: 실제 receipt 이름(lint.json 등)으로 요구가 충족된다', () => {
  withProject({locked: true, layerMap: {}}, root => {
    const dir = join(root, '_workspace/04_qa/evidence')
    mkdirSync(dir, {recursive: true})
    // 러너가 실제로 쓰는 이름 — quality.lint가 아니라 lint
    for (const [name, id] of [['lint', 'lint'], ['typecheck', 'typecheck'], ['test', 'test'],
                              ['build', 'build'], ['browser', 'browser']]) {
      writeFileSync(join(dir, `${name}.json`), JSON.stringify({id, status: 'PASS'}))
    }
    const spec = specErrors(validateReleaseGate(root).errors)
    assert.deepEqual(spec, [],
      '요구 id를 receipt 파일명으로 옮기지 않으면 잠근 프로젝트 전원이 오탐 블록된다')
  })
})

test('RUN 상태에서 실제로 빠진 요구는 잡는다', () => {
  withProject({locked: true, layerMap: {}}, root => {
    const dir = join(root, '_workspace/04_qa/evidence')
    mkdirSync(dir, {recursive: true})
    writeFileSync(join(dir, 'lint.json'), JSON.stringify({id: 'lint', status: 'PASS'}))
    const spec = specErrors(validateReleaseGate(root).errors)
    assert.ok(spec.some(m => m.includes('quality.typecheck')), '빠진 요구는 여전히 잡아야 한다')
  })
})
