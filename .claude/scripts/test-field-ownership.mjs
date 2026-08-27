#!/usr/bin/env node
// test-field-ownership.mjs — 필드 소유권 회귀.
//
// 경로 소유권으로는 "이 필드를 소유한다"를 표현할 수 없다. `package.json`은 5종이 소유하는데
// 각자 다른 필드를 다룬다 — `version-file-updater`가 `scripts`를 고쳐도 경로 훅은 통과시켰다.
// `scripts`는 **무엇이 검사로 도는지**를 정하므로(`resolve-commands`가 거기서 읽는다) 그 구멍은
// 게이트를 스스로 약화시키는 경로다.
import assert from 'node:assert/strict'
import test from 'node:test'
import {execFileSync} from 'node:child_process'
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import {realpathSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {FIELD_OWNERSHIP, changedTopLevelKeys, unownedFields} from './agent-registry.mjs'

const HOOK = join(dirname(fileURLToPath(import.meta.url)), 'enforce-agent-ownership.mjs')

const runHook = (root, agentType, content) => {
  const payload = JSON.stringify({
    tool_name: 'Write', agent_type: agentType, cwd: root,
    tool_input: {file_path: join(root, 'package.json'), content},
  })
  try {
    execFileSync('node', [HOOK], {input: payload, env: {...process.env, CLAUDE_PROJECT_DIR: root}, encoding: 'utf8'})
    return {status: 0, message: ''}
  } catch (error) {
    return {status: error.status, message: String(error.stdout ?? '') + String(error.stderr ?? '')}
  }
}

const withProject = (manifest, run) => {
  // macOS에서 /tmp는 심링크라 realpath로 맞춰야 훅의 루트 검사를 통과한다
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wh-field-')))
  try {
    writeFileSync(join(root, 'package.json'), JSON.stringify(manifest))
    run(root)
  } finally { rmSync(root, {recursive: true, force: true}) }
}

const BASE = {name: 'x', version: '1.0.0', scripts: {lint: 'eslint .'}}

// ── 순수 함수 ────────────────────────────────────────────────────────────────
test('변경된 최상위 키만 낸다', () => {
  assert.deepEqual(changedTopLevelKeys(JSON.stringify(BASE), JSON.stringify({...BASE, version: '1.0.1'})), ['version'])
  assert.deepEqual(changedTopLevelKeys(JSON.stringify(BASE), JSON.stringify(BASE)), [])
  // 키 추가·삭제도 변경이다
  assert.deepEqual(changedTopLevelKeys(JSON.stringify(BASE), JSON.stringify({...BASE, license: 'MIT'})), ['license'])
})

test('판정할 수 없으면 null이다 — 차단으로도 통과로도 만들지 않는다', () => {
  assert.equal(changedTopLevelKeys('{}', 'not json'), null)
  assert.equal(changedTopLevelKeys('[]', '{}'), null, '배열은 필드 개념이 없다')
})

test('선언되지 않은 에이전트는 전 필드가 미소유다', () => {
  assert.deepEqual(unownedFields('package.json', 'developer', ['scripts']), ['scripts'])
})

test('필드 소유가 없는 파일은 경로 소유권만 적용된다', () => {
  assert.deepEqual(unownedFields('tsconfig.json', 'anyone', ['compilerOptions']), [])
  assert.equal(FIELD_OWNERSHIP['tsconfig.json'], undefined)
})

// ── 훅 배선 ──────────────────────────────────────────────────────────────────
test('배선 회귀: version-file-updater가 scripts를 약화시키면 막힌다', () => {
  withProject(BASE, root => {
    const weakened = JSON.stringify({...BASE, version: '1.0.1', scripts: {lint: 'echo ok'}})
    const result = runHook(root, 'version-file-updater', weakened)
    assert.equal(result.status, 2, 'scripts 약화가 통과하면 게이트를 스스로 끌 수 있다')
    assert.match(result.message, /field\(s\): scripts/)
  })
})

test('배선 회귀: 소유한 필드만 바꾸면 통과한다 — 오탐이 아니어야 한다', () => {
  withProject(BASE, root => {
    const bumped = JSON.stringify({...BASE, version: '1.0.1'})
    assert.equal(runHook(root, 'version-file-updater', bumped).status, 0)
  })
})

test('배선 회귀: environment-scaffolder도 version은 소유하지 않는다', () => {
  withProject(BASE, root => {
    const result = runHook(root, 'environment-scaffolder', JSON.stringify({...BASE, version: '9.9.9'}))
    assert.equal(result.status, 2)
    assert.match(result.message, /field\(s\): version/)
  })
})

test('배선 회귀: 겹치는 필드는 명시된 둘 다 통과한다', () => {
  // scripts는 environment-scaffolder와 lib-scaffolder·lib-story-builder가 공유한다.
  // 겹침 금지가 아니라 **명시**다 — 합의된 공유와 아무도 눈치 못 챈 겹침은 다르다.
  withProject(BASE, root => {
    const changed = JSON.stringify({...BASE, scripts: {lint: 'eslint . --max-warnings 0'}})
    for (const agent of ['environment-scaffolder', 'lib-scaffolder', 'lib-story-builder']) {
      assert.equal(runHook(root, agent, changed).status, 0, `${agent}가 막혔다`)
    }
  })
})
