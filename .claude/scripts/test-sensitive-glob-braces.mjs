#!/usr/bin/env node
// test-sensitive-glob-braces.mjs — 루트 Glob의 `.git/config` 판정이 중괄호 대안을 펼쳐서 본다.
//
// 고정하는 사실: 대안 중 하나라도 `.git/config`를 고를 수 있으면 막는다(중첩·`**` 대안 포함), 범위 표기 `{a..z}`·extglob 접두·
// `./` 반복은 막는다, 짝이 안 맞거나 대안이 상한을
// 넘으면 보수적으로 막는다, 어느 대안도 고를 수 없으면 막지 않는다(흔한 `{src,e2e}/**`·`*.{ts,tsx}` 탐색의 오탐).
import assert from 'node:assert/strict'
import test from 'node:test'
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {evaluateSensitiveAccess, expandBraces} from './sensitive-access-policy-lib.mjs'

const withProject = run => {
  const root = mkdtempSync(join(tmpdir(), 'wh-glob-braces-'))
  try {
    mkdirSync(join(root, '.git'), {recursive: true})
    writeFileSync(join(root, '.git/config'), '[core]\n')
    return run({CLAUDE_PROJECT_DIR: root})
  } finally { rmSync(root, {recursive: true, force: true}) }
}
const glob = (environment, pattern) => evaluateSensitiveAccess({tool_name: 'Glob', tool_input: {pattern}}, environment)

test('중괄호 대안을 펼친다 — 중첩 포함, 짝이 안 맞으면 null', () => {
  assert.deepEqual(expandBraces('src/**/*.{ts,tsx}'), ['src/**/*.ts', 'src/**/*.tsx'])
  assert.deepEqual(expandBraces('{a,{b,c}}/x'), ['a/x', 'b/x', 'c/x'])
  assert.equal(expandBraces('{a,b'), null)
  assert.equal(expandBraces('a}b'), null)
})

test('대안 하나라도 .git/config를 고르면 막는다', () => {
  withProject(environment => {
    for (const pattern of ['{.git,src}/config', '{src,{.g*,e2e}}/config', '.git/{HEAD,config}', '{src,**}/*', '{src,.git/config',
      '.{a..z}it/config', '{x,.g{a..z}t}/config', '!(src)/config', '@(.git)/config', '+(.git|src)/config', '././.g?t/config',
      '{./,}{./,}.g?t/config']) {
      assert.equal(glob(environment, pattern).code, 'DENY_GIT_CONFIG_GLOB', pattern)
    }
  })
})

test('대안이 상한을 넘으면 펼치지 않고 막는다', () => {
  withProject(environment => {
    const many = n => `{${Array.from({length: n}, (_, i) => `d${i}`).join(',')}}`
    assert.equal(glob(environment, `${many(20)}/${many(20)}/x`).code, 'DENY_GIT_CONFIG_GLOB')
  })
})

test('어느 대안도 고를 수 없으면 막지 않는다', () => {
  withProject(environment => {
    for (const pattern of ['{src,e2e}/**/*', 'src/**/*.{ts,tsx}', '{src,{e2e,tests}}/**/*.ts', '{package.json,*.config.*,tsconfig*.json,index.html,e2e/**}',
      '**/{package.json,playwright.config.*,vite.config.*,tsconfig*.json}']) {
      assert.equal(glob(environment, pattern).allowed, true, `${pattern}: ${glob(environment, pattern).code}`)
    }
  })
})
