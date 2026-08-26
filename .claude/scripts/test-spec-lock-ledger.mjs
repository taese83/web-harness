#!/usr/bin/env node
// test-spec-lock-ledger.mjs — 잠금 원장 결박 회귀.
//
// 배경: sourceDigest는 잠금의 *입력*만 다이제스트하고 잠금 *자신*은 아니었다. 그래서
// layerMap·libraries를 사후에 고쳐 써도, 잠금 파일을 지워도 어떤 기계도 잡지 못했다.
// planLock 삭제 우회와 같은 클래스이며 같은 해법(append-only 원장)을 쓴다.
//
// 여기서 고정하는 사실:
//   (1) 잠금 시 원장에 잠금 자신의 해시가 기록된다
//   (2) 사후 수정 → TAMPERED
//   (3) 삭제 → DELETED (NOT_LOCKED로 강등되지 않는다)
//   (4) 원장 없음은 실패가 아니라 결박 부재로 보고된다
//   (5) 재잠금은 정상이다 — 원장의 어느 기록과든 맞으면 OK
import assert from 'node:assert/strict'
import test from 'node:test'
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {
  inspectSpecLockLedger, lockSpec, recordSpecLock, SPEC_LOCK_LEDGER, specLockDigest,
} from './lock-spec.mjs'
import {inspectSpecConformance} from './validate-spec-conformance.mjs'

const decision = {
  targetShapes: ['web-app'],
  architecture: {pattern: 'existing', rationale: '기존 관례'},
  layerMap: {}, libraries: {}, moduleBoundaries: [],
  acceptanceSource: 'absent', acceptanceRefs: [], nonGoals: [], openDecisions: [],
}

const withLocked = (run, {record = true} = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'web-harness-lock-ledger-'))
  try {
    mkdirSync(join(root, '_workspace/02_design'), {recursive: true})
    mkdirSync(join(root, '_workspace/03_dev'), {recursive: true})
    writeFileSync(join(root, 'package.json'), `${JSON.stringify({name: 'fixture'})}\n`)
    writeFileSync(join(root, '_workspace/02_design/solution-design.md'),
      ['```json web-harness:solution-design', JSON.stringify(decision, null, 2), '```', ''].join('\n'))
    const specLock = lockSpec(root)
    if (record) recordSpecLock(root, specLock)
    writeFileSync(join(root, '_workspace/03_dev/spec-lock.json'), `${JSON.stringify(specLock, null, 2)}\n`)
    return run(root, specLock)
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
}

// ── (1) 기록 ────────────────────────────────────────────────────────────────
test('잠금 시 원장에 잠금 자신의 해시가 기록된다', () => {
  withLocked((root, specLock) => {
    const path = join(root, SPEC_LOCK_LEDGER)
    assert.ok(existsSync(path))
    const row = JSON.parse(readFileSync(path, 'utf8').trim().split('\n')[0])
    assert.equal(row.lockDigest, specLockDigest(specLock))
    assert.equal(row.sourceDigest, specLock.sourceDigest.combined)
    assert.equal(inspectSpecLockLedger(root, specLock).state, 'OK')
  })
})

// ── (2) 사후 수정 ───────────────────────────────────────────────────────────
test('회귀 반증: 잠금을 사후에 고치면 TAMPERED', () => {
  withLocked((root, specLock) => {
    const tampered = {...specLock, layerMap: {core: '.'}}   // 소유권을 루트로 넓히는 수정
    assert.equal(inspectSpecLockLedger(root, tampered).state, 'TAMPERED',
      '사후 수정이 통과하면 잠금이 구속력을 잃는다')
    writeFileSync(join(root, '_workspace/03_dev/spec-lock.json'), `${JSON.stringify(tampered, null, 2)}\n`)
    const result = inspectSpecConformance({projectRoot: root})
    assert.equal(result.status, 'FAIL')
    assert.ok(result.failures.some(f => f.reason.includes('SPEC_LOCK_TAMPERED')))
  })
})

// ── (3) 삭제 ────────────────────────────────────────────────────────────────
test('회귀 반증: 잠금을 지우면 NOT_LOCKED가 아니라 DELETED', () => {
  withLocked(root => {
    unlinkSync(join(root, '_workspace/03_dev/spec-lock.json'))
    assert.equal(inspectSpecLockLedger(root, null).state, 'DELETED')
    const result = inspectSpecConformance({projectRoot: root})
    assert.equal(result.status, 'FAIL', '삭제가 opt-out으로 통과하면 결박을 마음대로 풀 수 있다')
    assert.ok(result.failures.some(f => f.reason.includes('SPEC_LOCK_DELETED')))
  })
})

// ── (4) 원장 부재 ───────────────────────────────────────────────────────────
test('원장이 없으면 실패가 아니라 결박 부재로 보고된다', () => {
  withLocked(root => {
    assert.equal(inspectSpecLockLedger(root, {a: 1}).state, 'NO_LEDGER')
    const result = inspectSpecConformance({projectRoot: root})
    assert.ok(result.notes.some(n => n.includes('결박되지 않는다')),
      '결박 부재를 침묵으로 두면 잠긴 것처럼 보인다')
  }, {record: false})
})

test('잠금도 원장도 없으면 NOT_LOCKED다 — 잠그지 않은 프로젝트는 영향받지 않는다', () => {
  const root = mkdtempSync(join(tmpdir(), 'web-harness-lock-ledger-none-'))
  try {
    assert.equal(inspectSpecConformance({projectRoot: root}).status, 'NOT_LOCKED')
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})

// ── (5) 재잠금 ──────────────────────────────────────────────────────────────
test('재잠금은 정상이다 — 원장의 어느 기록과든 맞으면 OK', () => {
  withLocked((root, first) => {
    const second = {...first, targetShapes: ['web-app', 'library']}
    recordSpecLock(root, second)
    assert.equal(inspectSpecLockLedger(root, second).state, 'OK', '새 잠금')
    assert.equal(inspectSpecLockLedger(root, first).state, 'OK', '이전 잠금도 원장에 있다')
  })
})
