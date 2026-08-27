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
  collectTargets, readShapeChecks, runShapeChecks, inspectShapeCatalog} from './validate-shape-checks.mjs'

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
  // 2026-08-26 계약 변경(실사용 스팩 확정 2호): 산출 디렉토리 자체가 없으면 "미빌드"이지 결함이
  // 아니다. 결함 판정은 디렉토리는 있는데 파일이 없을 때다 — fixture에 dist/를 둔다.
  withPackage({manifest: {name: 'x', exports: './dist/index.js'}, files: {'dist/other.js': 'x'}}, root => {
    const {problems, unbuilt} = checkPublicApi({exports: './dist/index.js'}, root)
    assert.equal(unbuilt.length, 0, 'dist/가 있으면 미빌드가 아니다')
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
    assert.ok(checkPublicApi({exports: '../outside.js'}, root).problems.some(p => /벗어난다/.test(p)))
    assert.ok(checkBinEntrypoint({bin: {x: '../outside.js'}}, root).some(p => /벗어난다/.test(p)))
  })
})

// ── 실사용 스팩 확정 2호 (2026-08-26) ─────────────────────────────────────────────
// 사내 SDK 모노레포 패키지(@kakao/ai-chatkit)를 확정하려다 형태 층의 다른 절반이 처음 돌면서
// 결함 2건이 드러났다. 1호(web-app)는 static 검사가 없어 발화하지 않던 자리다.
test('회귀 반증: 미빌드 라이브러리를 결함으로 보고하지 않는다', () => {
  // lib.public-api는 kind:"static"인데 대상이 빌드 산출물이다. 컴파일해 배포하는 정상
  // 라이브러리는 빌드 전에 반드시 FAIL했다 — 미판정을 FAIL로 강등하는 방향이 뚫려 있었다.
  withPackage({manifest: {
    name: '@scope/sdk', version: '1.0.0', files: ['dist'],
    exports: {'.': {types: './dist/index.d.ts', import: './dist/index.js'}},
  }}, root => {
    const {receipts, skipped} = runShapeChecks({projectRoot: root, targetShapes: ['library']})
    assert.ok(skipped.some(entry => entry.id === 'lib.public-api'), '미빌드는 receipt를 쓰지 않는다')
    assert.equal(receipts.find(entry => entry.id === 'lib.public-api'), undefined)
    // 같은 실행에서 진짜 결함(license 부재)은 그대로 잡는다 — 침묵으로 도피하지 않는다
    const publish = receipts.find(entry => entry.id === 'pack.publish-metadata')
    assert.equal(publish.status, 'FAIL')
    assert.ok(publish.problems.some(problem => /license/.test(problem)))
  })
})

test('회귀 반증: 산출 디렉토리는 있는데 파일이 없으면 여전히 FAIL', () => {
  // "미빌드" 강등이 실제 결함까지 삼키면 게이트 약화다.
  withPackage({
    manifest: {name: 'x', version: '1.0.0', license: 'MIT', files: ['dist'], exports: './dist/index.js'},
    files: {'dist/other.js': 'x'},
  }, root => {
    const {receipts, skipped} = runShapeChecks({projectRoot: root, targetShapes: ['library']})
    assert.equal(skipped.length, 0, 'dist/가 있으면 미빌드가 아니다')
    assert.equal(receipts.find(entry => entry.id === 'lib.public-api').status, 'FAIL')
  })
})

test('회귀 반증: .npmignore 판정이 하네스 cwd에 오염되지 않는다', () => {
  // 이 줄만 상대 경로라 process.cwd()의 .npmignore를 봤다. 외부 project-root 검사에서
  // 대상과 무관하게 판정이 갈렸다(오탐·누락 양방향).
  withPackage({manifest: {name: 'x', version: '1.0.0', license: 'MIT', exports: './i.js'}}, root => {
    const polluted = mkdtempSync(join(tmpdir(), 'npmig-'))
    writeFileSync(join(polluted, '.npmignore'), 'x')
    const before = process.cwd()
    try {
      process.chdir(polluted)
      const problems = checkPublishMetadata({name: 'x', version: '1.0.0', license: 'MIT', exports: './i.js'}, root)
      assert.ok(problems.some(problem => /\.npmignore도 없다/.test(problem)),
        'cwd의 .npmignore가 대상 판정을 바꾸면 안 된다')
    } finally {
      process.chdir(before)
      rmSync(polluted, {recursive: true, force: true})
    }
  })
})

// ── 카탈로그 키 엄격성 (2026-08-27) ─────────────────────────────────────────
// 실행 명세가 어댑터에서 카탈로그로 옮겨오면서 `assertKnownKeys` 보호가 따라오지 않았다.
// 실측: gatesRelease·needsArtifact·evidenceName 오타가 전부 조용히 통과했다. 오타는 기본값으로
// 퇴화하므로 게이트가 약해지는 방향이다 — 이동은 검사 삭제의 이유가 아니다.
test('실제 카탈로그는 키 엄격성을 통과한다', () => {
  assert.deepEqual(inspectShapeCatalog(), [])
})

test('알 수 없는 키·잘못된 타입을 잡는다 (오타가 기본값으로 퇴화하지 못하게)', () => {
  const base = readShapeChecks()
  const mutate = fn => {
    const catalog = JSON.parse(JSON.stringify(base))
    fn(catalog.common.checks.find(check => check.id === 'ingestion.validate'))
    return inspectShapeCatalog(catalog)
  }
  const cases = [
    ['gateRelease 오타', entry => { delete entry.gatesRelease; entry.gateRelease = false }, '알 수 없는 키'],
    ['needArtifact 오타', entry => { delete entry.needsArtifact; entry.needArtifact = true }, '알 수 없는 키'],
    ['evidenceNam 오타', entry => { delete entry.evidenceName; entry.evidenceNam = 'evidence.x' }, '알 수 없는 키'],
    ['receiptKind 값 오류', entry => { entry.receiptKind = 'buildd' }, 'receiptKind'],
    ['gatesRelease 타입 오류', entry => { entry.gatesRelease = 'false' }, 'gatesRelease'],
    ['evidenceName 접두 오류', entry => { entry.evidenceName = 'ingestion' }, 'evidenceName'],
    ['requires 타입 오류', entry => { entry.requires = 'external-ingestion' }, 'requires'],
  ]
  for (const [label, fn, needle] of cases) {
    const errors = mutate(fn)
    assert.ok(errors.some(message => message.includes(needle)), `${label}를 잡지 못했다: ${errors.join(' / ')}`)
  }
})
