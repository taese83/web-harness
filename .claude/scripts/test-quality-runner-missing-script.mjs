#!/usr/bin/env node
// test-quality-runner-missing-script.mjs — 프로필이 요구하는 스크립트가 없어도 `--all`은 끝까지 돈다.
//
// 없는 스크립트는 그 check 하나의 BLOCKED다. 러너가 영수증을 쓰다 죽으면 나머지 check의 영수증도
// 남지 않아, 사용자는 check를 하나씩 따로 돌리게 되고 `--all` 묶음 증거는 영영 만들어지지 않는다.
import assert from 'node:assert/strict'
import test from 'node:test'
import {spawnSync} from 'node:child_process'
import {cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'

const runner = fileURLToPath(new URL('./run-quality-gates.mjs', import.meta.url))
const fixture = fileURLToPath(new URL('../../golden/vite-serverless-hybrid', import.meta.url))

test('--all: 프로필 스크립트가 없으면 그 check만 BLOCKED이고 나머지 영수증도 남는다', () => {
  const root = mkdtempSync(join(tmpdir(), 'wh-missing-script-'))
  const project = join(root, 'p')
  try {
    cpSync(fixture, project, {recursive: true, filter: source => !source.includes('/node_modules')})
    const packagePath = join(project, 'package.json')
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'))
    assert.equal(typeof packageJson.scripts['test:production-boundary'], 'string', '픽스처가 바뀌었다 — 지울 프로필 스크립트를 다시 고른다')
    delete packageJson.scripts['test:production-boundary']
    writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`)

    const result = spawnSync(process.execPath, [runner, '--project', project, '--all'], {
      encoding: 'utf8',
      env: {...process.env, WEB_HARNESS_ISOLATED_EXECUTION: '1'},
    })
    assert.doesNotMatch(result.stderr, /TypeError|ERR_INVALID_ARG_TYPE/, `러너가 영수증을 쓰다 죽었다:\n${result.stderr}`)
    assert.equal(result.status, 1, `PASS 아닌 check가 있으면 exit 1이어야 한다:\n${result.stderr}`)

    const evidence = join(project, '_workspace/04_qa/evidence')
    const receipt = JSON.parse(readFileSync(join(evidence, 'vite.production-mock-boundary.json'), 'utf8'))
    assert.equal(receipt.status, 'BLOCKED')
    assert.equal(receipt.runMode, 'all')
    assert.deepEqual(receipt.packageScript, {name: 'test:production-boundary', sha256: null, commandContractSha256: null})
    for (const id of ['typecheck', 'test', 'coverage', 'audit']) {
      assert.ok(existsSync(join(evidence, `${id}.json`)), `${id} 영수증이 남지 않았다`)
    }
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})
