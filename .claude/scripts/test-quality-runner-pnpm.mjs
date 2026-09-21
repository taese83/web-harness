#!/usr/bin/env node
// test-quality-runner-pnpm.mjs — "프로젝트가 핀한 pnpm으로 돈다"의 회귀.
//
// 브라운필드 계약: 기존 관례(`packageManager` 선언)가 러너 환경보다 우선한다.
// 그리고 **핀을 못 찾으면 프로젝트 안에서 pnpm을 부르지 않는다** — 부르면 pnpm이 그 버전을
// registry에서 받아와 실행하므로, 그 시점에 무엇이 도는지를 러너가 정한 것이 아니게 된다.
import assert from 'node:assert/strict'
import test from 'node:test'
import {spawnSync} from 'node:child_process'
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'

const runner = join(dirname(fileURLToPath(import.meta.url)), 'run-quality-gates.mjs')
const {resolvePinnedPackageManager} = await import('./quality-policy-lib.mjs')

// 순수 판정 — 서로 다른 버전을 주입해 고정한다. 머신에 같은 버전만 있으면 프로세스 테스트로는
// 이 판정이 죽은 것을 알 수 없다(반증 시드가 발화하지 않는다).
const compare = (left, right) => (left === right ? 0 : left < right ? -1 : 1)
const versions = {'/a/pnpm': '11.18.0', '/b/pnpm': '10.23.0', '/c/pnpm': '9.0.0'}
const resolve = pinnedVersion =>
  resolvePinnedPackageManager({
    candidates: Object.keys(versions),
    versionOf: candidate => versions[candidate] ?? null,
    pinnedVersion,
    compare,
  })

test('첫 후보가 아니라 핀과 일치하는 후보를 고른다', () => {
  assert.deepEqual(resolve('10.23.0'), {executable: '/b/pnpm', matched: true})
  assert.deepEqual(resolve('9.0.0'), {executable: '/c/pnpm', matched: true})
})

test('핀과 일치하는 후보가 없으면 matched=false다 — 호출부가 막을 수 있어야 한다', () => {
  assert.deepEqual(resolve('99.99.99'), {executable: '/a/pnpm', matched: false})
})

test('핀 선언이 없으면 첫 후보를 쓴다', () => {
  assert.deepEqual(resolve(null), {executable: '/a/pnpm', matched: false})
  assert.deepEqual(resolvePinnedPackageManager({candidates: [], versionOf: () => null, pinnedVersion: '1.0.0', compare}),
    {executable: null, matched: false})
})
const ambientPnpm = spawnSync('pnpm', ['--version'], {encoding: 'utf8', cwd: tmpdir()})
const installedVersion = ambientPnpm.status === 0 ? ambientPnpm.stdout.trim() : null

const receiptFor = (pin, manager = 'pnpm') => {
  const root = mkdtempSync(join(tmpdir(), 'wh-pnpm-pin-'))
  try {
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({name: 'p', private: true, packageManager: `${manager}@${pin}`, scripts: {typecheck: 'tsc'}, dependencies: {}}),
    )
    spawnSync(process.execPath, [runner, '--project', root, '--check', 'typecheck'], {
      encoding: 'utf8',
      env: {...process.env, WEB_HARNESS_ISOLATED_EXECUTION: '1'},
    })
    return JSON.parse(readFileSync(join(root, '_workspace/04_qa/evidence/typecheck.json'), 'utf8'))
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
}

test('머신에 있는 핀을 존중한다 — 러너 환경이 아니라 프로젝트 선언을 따른다', {skip: !installedVersion}, () => {
  const receipt = receiptFor(installedVersion)
  assert.equal(receipt.packageManagerSatisfied, true)
  assert.equal(receipt.pnpmVersion, installedVersion)
  assert.doesNotMatch(receipt.blockedReason ?? '', /packageManager|pins pnpm/)
})

// 없는 버전을 네트워크에서 받아오지 않는다. 막되, 무엇을 하라는지 알려 준다 —
// 사유만 적고 처방이 없으면 도입 첫날 여기서 멈춘다.
// **실재하는** 버전으로 고정한다. 없는 버전(99.99.99)은 pnpm이 받아오려다 실패해서 통과하므로
// "받아오지 않는다"를 증명하지 못한다 — 실재하는데 이 머신에 없는 버전이라야 증명이 된다.
const absentRealVersion = installedVersion?.startsWith('11.') ? '10.1.0' : '11.18.0'

test('실재하는 핀이 머신에 없으면 막는다 — 받아오지 않는다', {skip: !installedVersion}, () => {
  const receipt = receiptFor(absentRealVersion)
  assert.equal(receipt.status, 'BLOCKED')
  assert.equal(receipt.packageManagerSatisfied, false)
  assert.equal(
    receipt.pnpmVersion,
    installedVersion,
    '핀한 버전이 영수증에 찍혔다면 pnpm이 그것을 받아와 실행한 것이다',
  )
  assert.match(receipt.blockedReason, /corepack prepare/, '처방이 없으면 막기만 하는 것이다')
})

test('pnpm이 아닌 핀은 pnpm 처방을 내지 않는다', {skip: !installedVersion}, () => {
  const receipt = receiptFor('4.1.0', 'yarn')
  assert.equal(receipt.packageManagerSatisfied, false)
  assert.match(receipt.blockedReason, /pnpm only/)
  assert.doesNotMatch(receipt.blockedReason, /corepack prepare yarn/)
})
