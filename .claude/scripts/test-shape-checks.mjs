#!/usr/bin/env node
// test-shape-checks.mjs — 형태별 정적 검증 회귀.
//
// 여기서 고정하는 사실:
//   (1) static·implemented 검사만 수행한다 — runtime을 정적으로 흉내내지 않는다
//   (2) 실제 결함을 잡는다(진입점 부재·shebang 부재·license 부재·files 미통제)
//   (3) 판정할 수 없으면 receipt를 쓰지 않는다 — 미판정을 PASS로 승격하지 않는다
//   (4) 경로가 패키지 루트를 벗어나면 거부한다
import assert from 'node:assert/strict'
import test from 'node:test'
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {
  checkBinEntrypoint, checkPublicApi, checkPublishMetadata,
  collectTargets, readShapeChecks, runShapeChecks,
} from './validate-shape-checks.mjs'

const withPackage = ({manifest, files = {}}, run) => {
  const root = mkdtempSync(join(tmpdir(), 'web-harness-shape-'))
  try {
    writeFileSync(join(root, 'package.json'), `${JSON.stringify(manifest)}\n`)
    for (const [path, content] of Object.entries(files)) {
      const parent = path.includes('/') ? path.replace(/\/[^/]*$/, '') : ''
      if (parent) mkdirSync(join(root, parent), {recursive: true})
      writeFileSync(join(root, path), content)
    }
    return run(root)
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
}

// ── (1) static만 수행 ────────────────────────────────────────────────────────
test('runtime 검사는 수행하지 않는다 — 정적 근사로 PASS를 내지 않는다', () => {
  withPackage({manifest: {name: 'x', version: '1.0.0', license: 'MIT', main: './i.js', files: ['i.js']},
    files: {'i.js': 'export {}\n'}}, root => {
    const {receipts} = runShapeChecks({projectRoot: root, targetShapes: ['library']})
    const ids = receipts.map(r => r.id)
    assert.ok(ids.includes('pack.publish-metadata'))
    assert.equal(ids.includes('pack.contents'), false, 'runtime 검사를 정적으로 흉내내면 프록시다')
  })
})

test('카탈로그의 static·implemented 항목만 구현체를 갖는다', () => {
  const catalog = readShapeChecks()
  const all = [...catalog.common.checks, ...Object.values(catalog.shapes).flatMap(s => s.checks)]
  for (const entry of all) {
    assert.ok(['static', 'runtime'].includes(entry.kind), `${entry.id}의 kind가 없다`)
    assert.equal(typeof entry.implemented, 'boolean', `${entry.id}의 implemented가 없다`)
  }
})

// ── (2) 실제 결함 탐지 ──────────────────────────────────────────────────────
test('회귀 반증: 진입점 파일이 없으면 FAIL', () => {
  withPackage({manifest: {name: 'x', exports: './dist/index.js'}}, root => {
    const problems = checkPublicApi({exports: './dist/index.js'}, root)
    assert.equal(problems.length, 1)
    assert.match(problems[0], /진입점 파일이 없다/)
  })
})

test('회귀 반증: bin에 shebang이 없으면 FAIL', () => {
  withPackage({manifest: {name: 'x', bin: {x: './cli.js'}}, files: {'cli.js': 'console.log(1)\n'}}, root => {
    const problems = checkBinEntrypoint({bin: {x: './cli.js'}}, root)
    assert.ok(problems.some(p => /shebang이 없다/.test(p)))
  })
})

test('shebang이 있으면 통과한다', () => {
  withPackage({manifest: {name: 'x', bin: {x: './cli.js'}}, files: {'cli.js': '#!/usr/bin/env node\n'}}, root => {
    assert.deepEqual(checkBinEntrypoint({bin: {x: './cli.js'}}, root), [])
  })
})

test('private:true·license 부재·files 미통제를 각각 잡는다', () => {
  const problems = checkPublishMetadata({private: true, name: 'x', version: '1.0.0', main: './i.js'})
  assert.ok(problems.some(p => /private/.test(p)))
  assert.ok(problems.some(p => /license/.test(p)))
  assert.ok(problems.some(p => /files 허용목록/.test(p)))
})

test('조건부 exports의 중첩 경로를 전부 모은다', () => {
  const targets = collectTargets({'.': {import: './a.js', require: './b.cjs'}, './sub': './c.js'})
  assert.deepEqual(targets.sort(), ['./a.js', './b.cjs', './c.js'])
})

// ── (3) 미판정을 PASS로 승격하지 않는다 ─────────────────────────────────────
test('package.json이 없으면 receipt를 쓰지 않는다', () => {
  const root = mkdtempSync(join(tmpdir(), 'web-harness-shape-empty-'))
  try {
    const {receipts, skipped} = runShapeChecks({projectRoot: root, targetShapes: ['library']})
    assert.equal(receipts.length, 0, '미판정을 PASS receipt로 만들면 안 된다')
    assert.ok(skipped.length > 0, '건너뛴 사실은 보고한다')
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})

// ── (4) 경로 이탈 ───────────────────────────────────────────────────────────
test('진입점·bin이 패키지 루트를 벗어나면 거부한다', () => {
  withPackage({manifest: {name: 'x'}}, root => {
    assert.ok(checkPublicApi({exports: '../outside.js'}, root).some(p => /벗어난다/.test(p)))
    assert.ok(checkBinEntrypoint({bin: {x: '../outside.js'}}, root).some(p => /벗어난다/.test(p)))
  })
})
