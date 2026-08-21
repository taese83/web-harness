// 통합 빌드 — 원장 실파일 append-only writer 회귀.
// 고정: (1) append→read 왕복, (2) 여러 줄 append 후 ledgerState 최신-이김, (3) 스키마 위반
// 레코드는 LEDGER_INVALID_RECORD로 거부(파서가 조용히 버릴 줄을 쓰지 않음), (4) 파일 없으면 빈.
import assert from 'node:assert/strict'
import test from 'node:test'
import {mkdtempSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {appendLedgerRecord, readLedger, readLedgerState} from './ticket/ledger-writer.mjs'

function tmpLedger() {
  const dir = mkdtempSync(join(tmpdir(), 'wh-ledger-'))
  return {path: join(dir, 'nested', 'identity-ledger.jsonl'), dir}
}

test('appendLedgerRecord: append→read 왕복 + 디렉토리 자동 생성', () => {
  const {path, dir} = tmpLedger()
  try {
    assert.deepEqual(readLedger(path), []) // 없으면 빈
    appendLedgerRecord(path, {featureId: 'FEAT-007', ticketKey: '3', contentHash: 'h1', createdAt: 't1'})
    const entries = readLedger(path)
    assert.equal(entries.length, 1)
    assert.equal(entries[0].featureId, 'FEAT-007')
    assert.equal(entries[0].schemaVersion, 1) // writer가 붙임
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
})

test('appendLedgerRecord: 여러 줄 → ledgerState 최신-이김(prUrl 갱신)', () => {
  const {path, dir} = tmpLedger()
  try {
    appendLedgerRecord(path, {featureId: 'FEAT-007', ticketKey: '3', contentHash: 'h1', createdAt: 't1'})
    appendLedgerRecord(path, {featureId: 'FEAT-007', ticketKey: '3', contentHash: 'h1', createdAt: 't2', prUrl: 'https://x/pull/9'})
    const state = readLedgerState(path)
    assert.equal(state.get('FEAT-007').prUrl, 'https://x/pull/9') // 나중 항목이 이김
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
})

test('appendLedgerRecord: 스키마 위반 레코드 거부(조용히 버릴 줄 안 씀)', () => {
  const {path, dir} = tmpLedger()
  try {
    assert.throws(() => appendLedgerRecord(path, {featureId: 'nope', ticketKey: '3', contentHash: 'h', createdAt: 't'}), /LEDGER_INVALID_RECORD/)
    assert.deepEqual(readLedger(path), []) // 아무것도 안 써짐
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
})
