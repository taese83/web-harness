#!/usr/bin/env node
// test-init-workspace.mjs — 최소 환경 생성 회귀.
//
// 고정하는 사실:
//   (1) 디렉토리 6종 + web-harness.md 하나가 최소 환경이다 — 문서 사슬을 미리 만들지 않는다
//   (2) 기존 마커를 덮어쓰지 않는다 (사람이 적은 내용이 있을 수 있다)
//   (3) 실측되지 않은 것은 마커에 적지 않는다 — 빈 값을 지어내지 않는다
//   (4) 확정된 스팩이 있으면 그 값을 싣는다
import assert from 'node:assert/strict'
import test from 'node:test'
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {mkdtempSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {WORKSPACE_DIRS, MARKER, collectBasics, initWorkspace, renderMarker} from './init-workspace.mjs'

const withProject = (files, run) => {
  const root = mkdtempSync(join(tmpdir(), 'wh-init-'))
  try {
    for (const [rel, body] of Object.entries(files)) {
      const path = join(root, rel)
      mkdirSync(join(path, '..'), {recursive: true})
      writeFileSync(path, typeof body === 'string' ? body : JSON.stringify(body))
    }
    run(root)
  } finally { rmSync(root, {recursive: true, force: true}) }
}

test('최소 환경은 디렉토리 6종 + 마커 하나다', () => {
  withProject({'package.json': {name: 'x'}}, root => {
    const result = initWorkspace({projectRoot: root, at: '2026-08-26'})
    for (const dir of WORKSPACE_DIRS) assert.ok(existsSync(join(root, '_workspace', dir)), dir)
    assert.ok(existsSync(join(root, MARKER)))
    assert.equal(result.marker, 'written')
    // 문서 사슬을 미리 만들지 않는다 — 요청이 있을 때 만든다
    for (const doc of ['01_plan/requirements.md', '01_plan/project-brief.md', '02_design/design-system.md']) {
      assert.equal(existsSync(join(root, '_workspace', doc)), false, `${doc}를 미리 만들면 안 된다`)
    }
  })
})

test('회귀 반증: 기존 마커를 덮어쓰지 않는다', () => {
  withProject({'package.json': {name: 'x'}, '_workspace/web-harness.md': '# 손으로 적은 내용\n'}, root => {
    const result = initWorkspace({projectRoot: root, at: '2026-08-26'})
    assert.equal(result.marker, 'kept')
    assert.match(readFileSync(join(root, MARKER), 'utf8'), /손으로 적은 내용/)
  })
})

test('--force면 다시 쓴다', () => {
  withProject({'package.json': {name: 'x'}, '_workspace/web-harness.md': '# 옛것\n'}, root => {
    initWorkspace({projectRoot: root, at: '2026-08-26', force: true})
    assert.match(readFileSync(join(root, MARKER), 'utf8'), /# web-harness/)
  })
})

test('회귀 반증: 실측되지 않은 것은 적지 않는다', () => {
  withProject({'package.json': {name: 'x'}}, root => {
    const text = renderMarker(collectBasics(root), {at: '2026-08-26'})
    assert.equal(/targetShapes/.test(text), false, '스팩이 없으면 형태를 지어내지 않는다')
    assert.equal(/substrate\(실측\)/.test(text), false, '실측 substrate가 없으면 그 줄이 없다')
    assert.match(text, /- project: x/)
  })
})

test('확정된 스팩이 있으면 그 값을 싣는다', () => {
  withProject({
    'package.json': {name: '@scope/sdk', version: '1.0.0'},
    '_workspace/03_dev/spec.json': {
      targetShapes: ['library'], specTier: 'unverifiable',
      constitution: {substrate: {
        bundler: {value: 'vite', source: 'measured'},
        formatter: {value: 'prettier', source: 'default'},
      }},
    },
  }, root => {
    const text = renderMarker(collectBasics(root), {at: '2026-08-26'})
    assert.match(text, /targetShapes: library/)
    assert.match(text, /bundler=vite/)
    // default는 실측이 아니다 — 실측 목록에 넣지 않는다
    assert.equal(/formatter=prettier/.test(text), false, 'source가 measured가 아닌 것을 실측으로 적으면 안 된다')
  })
})

test('재실행은 디렉토리만 보강한다', () => {
  withProject({'package.json': {name: 'x'}}, root => {
    initWorkspace({projectRoot: root, at: '2026-08-26'})
    rmSync(join(root, '_workspace/04_qa'), {recursive: true})
    const again = initWorkspace({projectRoot: root, at: '2026-08-27'})
    assert.deepEqual(again.created, ['_workspace/04_qa'])
    assert.equal(again.marker, 'kept')
  })
})
