#!/usr/bin/env node
// test-validate-plugin-official.mjs — 공식 검증 래퍼가 두 매니페스트를 --strict로 보고, claude가 없거나 실패하면 CI를 멈추는지 고정한다.
// 실제 claude 대신 PATH 앞에 둔 가짜 실행 파일로 돌린다(네트워크·로그인 없이 결정적으로).
import assert from 'node:assert/strict'
import test from 'node:test'
import {spawnSync} from 'node:child_process'
import {chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'

const script = join(dirname(fileURLToPath(import.meta.url)), 'validate-plugin-official.mjs')
const withDist = run => {
  const root = mkdtempSync(join(tmpdir(), 'wh-plugin-official-'))
  try {
    const dist = join(root, 'dist')
    mkdirSync(join(dist, '.claude-plugin'), {recursive: true})
    mkdirSync(join(dist, 'web-harness-plugin/.claude-plugin'), {recursive: true})
    const bin = join(root, 'bin')
    mkdirSync(bin)
    return run({root, dist, bin})
  } finally { rmSync(root, {recursive: true, force: true}) }
}
const fakeClaude = (bin, body) => {
  writeFileSync(join(bin, 'claude'), `#!/bin/sh\n${body}\n`)
  chmodSync(join(bin, 'claude'), 0o755)
}
const run = (dist, path) => spawnSync(process.execPath, [script, '--dist', dist], {encoding: 'utf8', env: {...process.env, PATH: path}})

test('두 매니페스트를 --strict로 보고 둘 다 통과하면 0', () => {
  withDist(({root, dist, bin}) => {
    fakeClaude(bin, `echo "$@" >> "${join(root, 'calls.txt')}"; exit 0`)
    const result = run(dist, `${bin}:/usr/bin:/bin`)
    assert.equal(result.status, 0, result.stderr)
    const calls = readFileSync(join(root, 'calls.txt'), 'utf8').trim().split('\n').filter(call => call.startsWith('plugin '))
    assert.deepEqual(calls, [`plugin validate --strict ${join(dist, 'web-harness-plugin')}`, `plugin validate --strict ${dist}`])
  })
})

test('경고를 실패로 센 검증이 하나라도 실패하면 1', () => {
  withDist(({dist, bin}) => {
    fakeClaude(bin, 'case "$4" in *web-harness-plugin) echo "warning: unknown field"; exit 1;; esac; exit 0')
    const result = run(dist, `${bin}:/usr/bin:/bin`)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /unknown field/)
  })
})

test('claude가 없으면 건너뛰지 않고 1 — 건너뛴 검사는 통과처럼 보인다', () => {
  withDist(({dist, bin}) => {
    const result = run(dist, `${bin}:/usr/bin:/bin`)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /건너뛰지 않는다/)
  })
})

test('배포본이 없으면 2', () => {
  withDist(({root, bin}) => {
    fakeClaude(bin, 'exit 0')
    assert.equal(run(join(root, 'missing'), `${bin}:/usr/bin:/bin`).status, 2)
  })
})
