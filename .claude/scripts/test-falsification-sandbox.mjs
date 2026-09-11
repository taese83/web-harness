#!/usr/bin/env node
// test-falsification-sandbox.mjs — 반증은 정본에 쓰지 않는다.
//
// 계기(2026-09-10~11): 제자리 변형 + `finally` 복원 구조가 세 번 물렸다 — ① 러너 둘이 겹쳐
// 변이본이 정본으로 굳었고 감사가 CI를 red로 오판정했다 ② 앱 종료로 CI가 강제 종료됐다(`finally`는
// SIGKILL을 덮지 못한다) ③ 락을 못 만드는 환경에서 없는 락을 `pid NaN`으로 읽었다.
//
// 여기서 고정하는 사실:
//   (1) 변형은 사본에서만 한다 — 짝 테스트가 도는 동안 정본은 원형이다
//   (2) 강제 종료(SIGKILL)로 중단돼도 정본은 원형이다
//   (3) 정본이 실행 중 바뀌면 운영 오류로 막는다 — 테스트 실패보다 무겁다
//   (4) 사본 안의 되쓰기가 실패하면 RESTORE_FAILED로 가른다 — 다음 항목을 오염시키지 않는다
//   (5) git이 없으면 디렉터리를 걷되 의존성·산출물·.git은 복사하지 않는다
//   (6) 기준 실행 — 변형 없이도 빨간 짝 테스트의 항목은 OK가 아니라 NOT_MEASURED다
//   (7) 정본에 **추가된** 파일도 트리 변경이다 · (8) 정본 경로를 env로 물려주지 않는다
//   (9) falsifyOne은 root 없이 부를 수 없다 · 사본에 없는 파일은 STALE이다
import assert from 'node:assert/strict'
import test from 'node:test'
import {chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawn} from 'node:child_process'
import {falsifyOne, listSourceFiles, treeDigest, validateFalsification} from './validate-falsification.mjs'

const ORIGINAL = 'export const gate = () => true\n'
const ENTRY = {id: 'g', file: 'lib.mjs', find: '() => true', replace: '() => false', test: 'lib.check.mjs', why: 'w'}

/** git이 아닌 작은 정본. 짝 테스트는 **cwd 기준**으로 읽는다 — 사본에서 돌 때 사본을 본다. */
const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'wh-sbx-src-'))
  writeFileSync(join(root, 'lib.mjs'), ORIGINAL)
  writeFileSync(join(root, 'lib.check.mjs'), [
    "import assert from 'node:assert/strict'",
    "import test from 'node:test'",
    "import {readFileSync} from 'node:fs'",
    "test('gate', () => assert.match(readFileSync('lib.mjs', 'utf8'), /gate = \\(\\) => true/))",
    '',
  ].join('\n'))
  return root
}
// 주입 러너는 **변형을 보고** 판정해야 한다 — 기준 실행(무변형)에는 통과(0), 변형에는 실패(1).
const mutated = cwd => readFileSync(join(cwd, 'lib.mjs'), 'utf8').includes('() => false')
const spies = () => {
  const calls = {pass: [], fail: []}
  return {calls, pass: message => calls.pass.push(message), fail: message => calls.fail.push(message)}
}

test('변형은 사본에서만 한다 — 짝 테스트가 도는 동안 정본은 원형이다', () => {
  const root = fixture()
  try {
    const {calls, pass, fail} = spies()
    let observed = null
    validateFalsification({pass, fail, sourceRoot: root, registry: {entries: [ENTRY]},
      run: (testPath, cwd) => {
        if (!mutated(cwd)) return 0 // 기준 실행
        observed = {
          source: readFileSync(join(root, 'lib.mjs'), 'utf8'),
          sandbox: readFileSync(join(cwd, 'lib.mjs'), 'utf8'),
          cwdIsSource: cwd === root,
        }
        return 1 // 짝 테스트가 변형을 잡았다
      }})
    assert.equal(observed.cwdIsSource, false, '짝 테스트를 정본에서 돌렸다')
    assert.equal(observed.source, ORIGINAL, '변형이 도는 동안 정본이 바뀌었다 — 격리가 아니다')
    assert.match(observed.sandbox, /\(\) => false/, '사본에 변형이 적용되지 않았다 — 반증이 공허하다')
    assert.deepEqual(calls.fail, [])
    assert.equal(calls.pass.length, 1)
  } finally { rmSync(root, {recursive: true, force: true}) }
})

test('실제 짝 테스트로 반증되고 정본 digest는 불변이다', () => {
  const root = fixture()
  try {
    const files = listSourceFiles(root)
    const before = treeDigest(root, files)
    const {calls, pass, fail} = spies()
    const result = validateFalsification({pass, fail, sourceRoot: root, registry: {entries: [ENTRY]}})
    assert.equal(result.ok, 1, `짝 테스트가 사본의 변형을 잡지 못했다: ${calls.fail.join(' | ')}`)
    assert.equal(result.treeChanged, null)
    assert.equal(treeDigest(root, files), before, '정본 digest가 바뀌었다')
  } finally { rmSync(root, {recursive: true, force: true}) }
})

test('정본이 실행 중 바뀌면 운영 오류로 막는다 — 결과를 믿지 않는다', () => {
  const root = fixture()
  try {
    const {calls, pass, fail} = spies()
    const result = validateFalsification({pass, fail, sourceRoot: root, registry: {entries: [ENTRY]},
      run: (testPath, cwd) => {
        if (!mutated(cwd)) return 0
        writeFileSync(join(root, 'lib.mjs'), `${ORIGINAL}// 누군가의 편집\n`)
        return 1
      }})
    assert.deepEqual(result.treeChanged, ['lib.mjs'], '정본 변경을 보고하지 않았다')
    assert.ok(calls.fail.some(message => message.includes('정본 트리가 실행 중 바뀌었다')), calls.fail.join('\n'))
    assert.equal(calls.pass.length, 0, '정본이 바뀌었는데 통과를 냈다')
  } finally { rmSync(root, {recursive: true, force: true}) }
})

test('사본 안의 되쓰기가 실패하면 RESTORE_FAILED다 — 다음 항목을 오염시키지 않는다', () => {
  const sandbox = fixture()
  try {
    const result = falsifyOne(ENTRY, {root: sandbox, run: () => {
      chmodSync(join(sandbox, 'lib.mjs'), 0o444) // 되쓰기를 막는다
      return 1
    }})
    assert.equal(result.status, 'RESTORE_FAILED', `되쓰기 실패를 판정하지 않았다: ${JSON.stringify(result)}`)
  } finally {
    chmodSync(join(sandbox, 'lib.mjs'), 0o644)
    rmSync(sandbox, {recursive: true, force: true})
  }
})

test('강제 종료(SIGKILL)로 중단돼도 정본은 원형이다 — finally가 못 덮는 경로', async () => {
  const root = fixture()
  const marker = join(root, '..', `${root.split('/').pop()}.started`)
  const driver = join(tmpdir(), `wh-sbx-driver-${process.pid}-${Date.now()}.mjs`)
  // 죽은 러너는 자기 사본을 못 치운다 — 경로를 받아 적어두고 테스트가 치운다(안 그러면 실행마다
  // 임시 디렉터리가 쌓인다: 실측 13개). 그 경로에 변형이 있었다는 것도 함께 단언한다.
  const sandboxRecord = `${marker}.sandbox`
  writeFileSync(driver, [
    `import {readFileSync, writeFileSync} from 'node:fs'`,
    `import {validateFalsification} from ${JSON.stringify(new URL('./validate-falsification.mjs', import.meta.url).href)}`,
    `validateFalsification({pass: () => {}, fail: () => {}, sourceRoot: ${JSON.stringify(root)},`,
    `  onSandbox: path => writeFileSync(${JSON.stringify(sandboxRecord)}, path),`,
    `  registry: {entries: [${JSON.stringify(ENTRY)}]},`,
    // 기준 실행은 곧바로 통과시키고, **변형된 사본에서만** 표지를 남기고 멈춘다.
    `  run: (t, cwd) => { if (!readFileSync(cwd + '/lib.mjs', 'utf8').includes('() => false')) return 0;`,
    `    writeFileSync(${JSON.stringify(marker)}, 'x'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30000); return 1 }})`,
    '',
  ].join('\n'))
  try {
    const child = spawn(process.execPath, [driver], {stdio: 'ignore'})
    const exited = new Promise(resolve => child.on('exit', resolve))
    // 변형이 적용된 상태(짝 테스트 실행 중)까지 기다린다.
    for (let waited = 0; !existsSync(marker) && waited < 10000; waited += 50) await new Promise(r => setTimeout(r, 50))
    assert.ok(existsSync(marker), '드라이버가 변형 단계에 도달하지 못했다')
    child.kill('SIGKILL')
    await exited
    assert.equal(readFileSync(join(root, 'lib.mjs'), 'utf8'), ORIGINAL,
      '강제 종료 뒤 정본에 변형이 남았다 — 제자리 변형 구조로 되돌아갔다')
    // 변형은 **사본에** 남아 있어야 한다 — 그래야 이 테스트가 「아무 일도 없었다」가 아니라
    // 「변형이 정본 밖에서 일어났다」를 증명한다.
    const sandbox = readFileSync(sandboxRecord, 'utf8')
    assert.match(readFileSync(join(sandbox, 'lib.mjs'), 'utf8'), /\(\) => false/, '사본에 변형이 없다 — 증명이 공허하다')
  } finally {
    if (existsSync(sandboxRecord)) rmSync(readFileSync(sandboxRecord, 'utf8'), {recursive: true, force: true})
    rmSync(root, {recursive: true, force: true})
    for (const file of [marker, sandboxRecord, driver]) rmSync(file, {force: true})
  }
})

test('git이 없으면 걷되 의존성·산출물·.git은 빼고 복사한다', () => {
  const root = fixture()
  try {
    for (const dir of ['node_modules/x', '.git', 'dist', 'eval-runs', 'workspace/p']) {
      mkdirSync(join(root, dir), {recursive: true})
      writeFileSync(join(root, dir, 'f.txt'), 'x')
    }
    mkdirSync(join(root, 'src'), {recursive: true})
    writeFileSync(join(root, 'src/a.mjs'), 'x')
    assert.deepEqual(listSourceFiles(root), ['lib.check.mjs', 'lib.mjs', 'src/a.mjs'])
  } finally { rmSync(root, {recursive: true, force: true}) }
})

test('기준이 빨간 짝 테스트의 항목은 OK가 아니라 NOT_MEASURED다 — 변형 없이도 실패하면 잴 수 없다', () => {
  const root = fixture()
  try {
    const {calls, pass, fail} = spies()
    // 사본에서 원래 빨간 짝 테스트(환경 차이 등). 종전에는 이 항목이 「반증됨」으로 세어졌다.
    const result = validateFalsification({pass, fail, sourceRoot: root, registry: {entries: [ENTRY]}, run: () => 1})
    assert.equal(result.ok, 0, '기준이 빨간데 반증됨으로 셌다 — vacuous 100%로 되돌아갔다')
    assert.ok(calls.fail.some(message => message.includes('NOT_MEASURED')), calls.fail.join('\n'))
    assert.equal(calls.pass.length, 0)
  } finally { rmSync(root, {recursive: true, force: true}) }
})

test('정본에 **추가된** 파일도 트리 변경이다 — 미리 나열한 파일만 보면 못 잡는다', () => {
  const root = fixture()
  try {
    const {calls, pass, fail} = spies()
    const result = validateFalsification({pass, fail, sourceRoot: root, registry: {entries: [ENTRY]},
      run: (testPath, cwd) => { if (mutated(cwd)) writeFileSync(join(root, 'stray.mjs'), 'x'); return mutated(cwd) ? 1 : 0 }})
    assert.ok((result.treeChanged ?? []).includes('stray.mjs(추가됨)'), `추가 파일을 못 잡았다: ${JSON.stringify(result.treeChanged)}`)
    assert.equal(calls.pass.length, 0)
  } finally { rmSync(root, {recursive: true, force: true}) }
})

test('사본의 짝 테스트에 정본 경로를 물려주지 않는다 — CLAUDE_PROJECT_DIR', () => {
  // 정책 lib들이 이 값을 프로젝트 루트로 쓴다. 상속되면 사본에서 도는 테스트가 정본을 루트로 잡는다.
  const root = fixture()
  writeFileSync(join(root, 'lib.check.mjs'), [
    "import assert from 'node:assert/strict'",
    "import test from 'node:test'",
    "import {readFileSync} from 'node:fs'",
    "test('gate', () => {",
    "  assert.equal(process.env.CLAUDE_PROJECT_DIR, undefined, 'env로 정본 경로가 새어 들어왔다')",
    "  assert.match(readFileSync('lib.mjs', 'utf8'), /gate = \\(\\) => true/)",
    "})",
    '',
  ].join('\n'))
  const saved = process.env.CLAUDE_PROJECT_DIR
  process.env.CLAUDE_PROJECT_DIR = root
  try {
    const {calls, pass, fail} = spies()
    const result = validateFalsification({pass, fail, sourceRoot: root, registry: {entries: [ENTRY]}})
    assert.equal(result.ok, 1, `env가 새면 기준 실행이 빨갛게 나온다: ${calls.fail.join(' | ')}`)
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_PROJECT_DIR
    else process.env.CLAUDE_PROJECT_DIR = saved
    rmSync(root, {recursive: true, force: true})
  }
})

test('falsifyOne은 root 없이 부를 수 없다 · 사본에 없는 파일은 STALE이다', () => {
  assert.throws(() => falsifyOne(ENTRY), /root/, 'root 기본값이 정본이면 제자리 변형으로 되돌아간다')
  const root = fixture()
  try {
    assert.equal(falsifyOne({...ENTRY, file: 'gone.mjs'}, {root, run: () => 1}).status, 'STALE')
  } finally { rmSync(root, {recursive: true, force: true}) }
})
