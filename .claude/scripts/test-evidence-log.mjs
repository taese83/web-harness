import assert from 'node:assert/strict'
import {mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {test} from 'node:test'
import {appendEvidenceLine, readEvidenceLog, detectRebind, DEFAULT_MAX_LEDGER_BYTES} from './evidence-log-lib.mjs'

const tmp = () => mkdtempSync(join(tmpdir(), 'evlog-'))

test('appendEvidenceLine: append-only, JSON per line, creates parent dirs', () => {
  const root = tmp()
  try {
    const p = join(root, 'nested', 'log.jsonl')
    appendEvidenceLine(p, {id: 'a', digest: '1'})
    appendEvidenceLine(p, {id: 'b', digest: '2'})
    const lines = readFileSync(p, 'utf8').trimEnd().split('\n')
    assert.equal(lines.length, 2)
    assert.deepEqual(JSON.parse(lines[0]), {id: 'a', digest: '1'})
    assert.deepEqual(JSON.parse(lines[1]), {id: 'b', digest: '2'})
  } finally { rmSync(root, {recursive: true, force: true}) }
})

test('appendEvidenceLine: accepts pre-serialized string, adds newline once', () => {
  const root = tmp()
  try {
    const p = join(root, 'log.jsonl')
    appendEvidenceLine(p, '{"x":1}\n')
    appendEvidenceLine(p, '{"x":2}')
    assert.equal(readFileSync(p, 'utf8'), '{"x":1}\n{"x":2}\n')
  } finally { rmSync(root, {recursive: true, force: true}) }
})

test('appendEvidenceLine: size cap fails closed', () => {
  const root = tmp()
  try {
    const p = join(root, 'log.jsonl')
    appendEvidenceLine(p, {a: 'x'.repeat(50)})
    assert.throws(() => appendEvidenceLine(p, {b: 1}, {maxBytes: 10}), /EVIDENCE_LOG_FULL/)
  } finally { rmSync(root, {recursive: true, force: true}) }
})

test('appendEvidenceLine: validate hook rejects bad line before write', () => {
  const root = tmp()
  try {
    const p = join(root, 'log.jsonl')
    const validate = line => { if (!line.includes('"ok"')) throw new Error('BAD') }
    assert.throws(() => appendEvidenceLine(p, {nope: 1}, {validate}), /BAD/)
    // 검증 실패 시 파일이 생기지 않아야 한다(쓰기 전 거부)
    assert.equal(readEvidenceLog(p).length, 0)
  } finally { rmSync(root, {recursive: true, force: true}) }
})

test('appendEvidenceLine: refuses to follow a symlink (O_NOFOLLOW, POSIX only)', (t) => {
  if (process.platform === 'win32') { t.skip('O_NOFOLLOW is a no-op on win32 (flag absent)'); return }
  const root = tmp()
  try {
    const real = join(root, 'real.jsonl')
    writeFileSync(real, '')
    const link = join(root, 'link.jsonl')
    try { symlinkSync(real, link) } catch (e) { t.skip(`symlink unavailable: ${e.code}`); return }
    assert.throws(() => appendEvidenceLine(link, {x: 1}), /ELOOP|EMLINK|symlink|EINVAL|EEXIST/i)
  } finally { rmSync(root, {recursive: true, force: true}) }
})

test('readEvidenceLog: skips blanks, skips corrupt by default, keeps with flag', () => {
  const root = tmp()
  try {
    const p = join(root, 'log.jsonl')
    writeFileSync(p, '{"a":1}\n\n  \nnot-json\n{"b":2}\n')
    assert.deepEqual(readEvidenceLog(p), [{a: 1}, {b: 2}])
    const kept = readEvidenceLog(p, {keepCorrupt: true})
    assert.equal(kept.length, 3)
    assert.equal(kept[1].__corrupt, 'not-json')
  } finally { rmSync(root, {recursive: true, force: true}) }
})

test('detectRebind: null when first digest matches current', () => {
  const rows = [{digest: 'aaa'}, {digest: 'aaa'}]
  assert.equal(detectRebind(rows, 'aaa'), null)
})

test('detectRebind: reports first≠current (re-lock/re-snapshot)', () => {
  const rows = [{digest: 'aaa'}, {digest: 'bbb'}]
  assert.deepEqual(detectRebind(rows, 'bbb'), {firstDigest: 'aaa', currentDigest: 'bbb'})
})

test('detectRebind: null on empty log (first lock is legitimate)', () => {
  assert.equal(detectRebind([], 'aaa'), null)
})

test('detectRebind: keyed — only compares same-key entries', () => {
  const rows = [
    {task: 'x', digest: 'x1'},
    {task: 'y', digest: 'y1'},
    {task: 'x', digest: 'x2'},
  ]
  // task x가 x1으로 최초 잠겼는데 현재 x2 → 재잠금 실측
  assert.deepEqual(
    detectRebind(rows, 'x2', {key: {field: 'task', value: 'x'}}),
    {firstDigest: 'x1', currentDigest: 'x2'},
  )
  // task y는 y1이 최초이자 현재 → 위반 없음
  assert.equal(detectRebind(rows, 'y1', {key: {field: 'task', value: 'y'}}), null)
})

test('detectRebind: custom digestField', () => {
  const rows = [{beforeDigest: 'p'}]
  assert.deepEqual(
    detectRebind(rows, 'q', {digestField: 'beforeDigest'}),
    {firstDigest: 'p', currentDigest: 'q'},
  )
})

test('DEFAULT_MAX_LEDGER_BYTES is 1MB (matches prior ledger idioms)', () => {
  assert.equal(DEFAULT_MAX_LEDGER_BYTES, 1024 * 1024)
})
