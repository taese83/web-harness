#!/usr/bin/env node
// test-quality-runner-root-lock.mjs — 워크스페이스 루트에서 잠근 낡은 프로필(패키지는 멤버에만 있다)을 러너가 어떻게 다루는지 고정한다.
//   - 개발 게이트(--check)는 공유 파일을 지우게 하지 않고 기본 검사로 넘어간다(영수증에 profileLockIgnored)
//   - 배포 증거(--all)는 그대로 거부한다
//   - 해법으로 migrate-profile-lock을 가리키고, 손으로 지우라고 하지 않는다
import assert from 'node:assert/strict'
import test from 'node:test'
import {spawnSync} from 'node:child_process'
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const runner = join(here, 'run-quality-gates.mjs')

const withRootLock = run => {
  const root = mkdtempSync(join(tmpdir(), 'wh-runner-root-lock-'))
  try {
    writeFileSync(join(root, 'package.json'), JSON.stringify({name: 'mono', private: true, scripts: {typecheck: 'tsc -b'}}))
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n')
    mkdirSync(join(root, 'apps/web'), {recursive: true})
    writeFileSync(join(root, 'apps/web/package.json'), JSON.stringify({name: 'web', dependencies: {react: '19.0.0'}, devDependencies: {vite: '6.0.0'}}))
    mkdirSync(join(root, '_workspace/01_plan'), {recursive: true})
    writeFileSync(join(root, '_workspace/01_plan/project-profile.json'), readFileSync(join(here, '../evals/fixtures/migrate-profile-lock/root-locked-profile.json')))
    return run(root)
  } finally { rmSync(root, {recursive: true, force: true}) }
}
const gate = (root, ...args) => spawnSync(process.execPath, [runner, '--project', root, ...args], {encoding: 'utf8', cwd: root, env: {...process.env, CLAUDE_PROJECT_DIR: root, WEB_HARNESS_ISOLATED_EXECUTION: '1'}})

test('개발 게이트(--check)는 낡은 루트 잠금을 건너뛰고 기본 검사로 넘어간다', () => {
  withRootLock(root => {
    const result = gate(root, '--check', 'typecheck')
    assert.match(result.stderr, /migrate-profile-lock/, '해법 명령을 알리지 않았다')
    assert.match(result.stderr, /continuing with the base checks/, `기본 검사로 넘어가지 않았다:\n${result.stderr}`)
    assert.doesNotMatch(result.stderr, /remove the stale/, '공유 파일을 손으로 지우라고 안내했다')
  })
})

test('배포 증거(--all)는 낡은 루트 잠금을 그대로 거부한다', () => {
  withRootLock(root => {
    const result = gate(root, '--all')
    assert.equal(result.status, 2)
    assert.match(result.stderr, /Invalid locked project profile/)
    assert.doesNotMatch(result.stderr, /continuing with the base checks/, '배포 증거가 어댑터 검사 없이 진행했다')
  })
})
