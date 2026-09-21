#!/usr/bin/env node
// test-spec-ledger.mjs — 스팩 원장 결박 회귀.
//
// 배경: sourceDigest는 스팩의 *입력*만 다이제스트하고 스팩 확정 *자신*은 아니었다. 그래서
// layerMap·libraries를 사후에 고쳐 써도, 스팩 파일을 지워도 어떤 기계도 잡지 못했다.
// planLock 삭제 우회와 같은 클래스이며 같은 해법(append-only 원장)을 쓴다.
//
// 여기서 고정하는 사실:
//   (1) 스팩 확정 시 원장에 스팩 확정 자신의 해시가 기록된다
//   (2) 사후 수정 → TAMPERED
//   (3) 삭제 → DELETED (NO_SPEC로 강등되지 않는다)
//   (4) 원장 없음은 실패가 아니라 결박 부재로 보고된다
//   (5) 재확정은 정상이다 — 원장의 어느 기록과든 맞으면 OK
//   (6) 원장이 확정 버전을 남기고, 판정 버전이 다르면 알린다(모르면 지어내지 않는다)
import assert from 'node:assert/strict'
import test from 'node:test'
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {
  harnessVersion, inspectSpecLedger, lockSpec, recordSpec, SPEC_LEDGER, specDigest,
} from './spec.mjs'
import {inspectSpecConformance} from './validate-spec-conformance.mjs'

const decision = {
  targetShapes: ['web-app'],
  architecture: {pattern: 'existing', rationale: '기존 관례'},
  layerMap: {}, libraries: {}, moduleBoundaries: [],
  testLayers: {unit: 'src/', e2e: 'e2e/'},
  acceptanceSource: 'absent', acceptanceRefs: [], nonGoals: [], openDecisions: [],
}

const withLocked = (run, {record = true, version = '0.35.0'} = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'web-harness-lock-ledger-'))
  try {
    mkdirSync(join(root, '_workspace/02_design'), {recursive: true})
    mkdirSync(join(root, '_workspace/03_dev'), {recursive: true})
    writeFileSync(join(root, 'package.json'), `${JSON.stringify({name: 'fixture'})}\n`)
    writeFileSync(join(root, '_workspace/02_design/solution-design.md'),
      ['```json web-harness:solution-design', JSON.stringify(decision, null, 2), '```', ''].join('\n'))
    const spec = lockSpec(root)
    if (record) recordSpec(root, spec, {version})
    writeFileSync(join(root, '_workspace/03_dev/spec.json'), `${JSON.stringify(spec, null, 2)}\n`)
    return run(root, spec)
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
}

// ── (1) 기록 ────────────────────────────────────────────────────────────────
test('스팩 확정 시 원장에 스팩 확정 자신의 해시가 기록된다', () => {
  withLocked((root, spec) => {
    const path = join(root, SPEC_LEDGER)
    assert.ok(existsSync(path))
    const row = JSON.parse(readFileSync(path, 'utf8').trim().split('\n')[0])
    assert.equal(row.digest, specDigest(spec))
    assert.equal(row.sourceDigest, spec.sourceDigest.combined)
    assert.equal(inspectSpecLedger(root, spec).state, 'OK')
  })
})

// ── (2) 사후 수정 ───────────────────────────────────────────────────────────
test('회귀 반증: 스팩을 사후에 고치면 TAMPERED', () => {
  withLocked((root, spec) => {
    const tampered = {...spec, layerMap: {core: '.'}}   // 소유권을 루트로 넓히는 수정
    assert.equal(inspectSpecLedger(root, tampered).state, 'TAMPERED',
      '사후 수정이 통과하면 스팩이 구속력을 잃는다')
    writeFileSync(join(root, '_workspace/03_dev/spec.json'), `${JSON.stringify(tampered, null, 2)}\n`)
    const result = inspectSpecConformance({projectRoot: root})
    assert.equal(result.status, 'FAIL')
    assert.ok(result.failures.some(f => f.reason.includes('SPEC_TAMPERED')))
  })
})

// ── (3) 삭제 ────────────────────────────────────────────────────────────────
test('회귀 반증: 스팩을 지우면 NO_SPEC가 아니라 DELETED', () => {
  withLocked(root => {
    unlinkSync(join(root, '_workspace/03_dev/spec.json'))
    assert.equal(inspectSpecLedger(root, null).state, 'DELETED')
    const result = inspectSpecConformance({projectRoot: root})
    assert.equal(result.status, 'FAIL', '삭제가 opt-out으로 통과하면 결박을 마음대로 풀 수 있다')
    assert.ok(result.failures.some(f => f.reason.includes('SPEC_DELETED')))
  })
})

// ── (4) 원장 부재 ───────────────────────────────────────────────────────────
test('원장이 없으면 실패가 아니라 결박 부재로 보고된다', () => {
  withLocked(root => {
    assert.equal(inspectSpecLedger(root, {a: 1}).state, 'NO_LEDGER')
    const result = inspectSpecConformance({projectRoot: root})
    assert.ok(result.notes.some(n => n.includes('결박되지 않는다')),
      '결박 부재를 침묵으로 두면 확정된 것처럼 보인다')
  }, {record: false})
})

test('스팩도 원장도 없으면 NO_SPEC다 — 잠그지 않은 프로젝트는 영향받지 않는다', () => {
  const root = mkdtempSync(join(tmpdir(), 'web-harness-lock-ledger-none-'))
  try {
    assert.equal(inspectSpecConformance({projectRoot: root}).status, 'NO_SPEC')
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})

// ── (5) 재확정 ──────────────────────────────────────────────────────────────
test('재확정은 정상이다 — 원장의 어느 기록과든 맞으면 OK', () => {
  withLocked((root, first) => {
    const second = {...first, targetShapes: ['web-app', 'library']}
    recordSpec(root, second)
    assert.equal(inspectSpecLedger(root, second).state, 'OK', '새 스팩 확정')
    assert.equal(inspectSpecLedger(root, first).state, 'OK', '이전 스팩도 원장에 있다')
  })
})

// ── (6) 확정 버전 ───────────────────────────────────────────────────────────
test('원장이 스팩을 확정한 하네스 버전을 남긴다', () => {
  withLocked(root => {
    const row = JSON.parse(readFileSync(join(root, SPEC_LEDGER), 'utf8').trim().split('\n')[0])
    assert.equal(row.harnessVersion, '0.35.0')
  })
})

test('판정 버전이 확정 버전과 다르면 note로 알리고, 실패로 만들지 않는다', () => {
  withLocked(root => {
    const differ = inspectSpecConformance({projectRoot: root, runningVersion: '0.36.0'})
    assert.ok(differ.notes.some(n => n.includes('0.35.0') && n.includes('0.36.0')),
      '버전이 갈린 사실을 숨기면 판정 차이의 원인을 원장에서 읽을 수 없다')
    assert.ok(!differ.failures.some(f => f.reason.includes('0.36.0')), '버전 차이는 결함이 아니다')
    const same = inspectSpecConformance({projectRoot: root, runningVersion: '0.35.0'})
    assert.ok(!same.notes.some(n => n.includes('로 확정됐고')))
  })
})

test('기본값은 실행 중인 하네스 버전을 기록한다', () => {
  withLocked((root, spec) => {
    assert.equal(recordSpec(root, spec).harnessVersion, harnessVersion())
  }, {record: false})
})

test('버전을 모르면 null로 남기고 비교하지 않는다', () => {
  withLocked(root => {
    assert.equal(inspectSpecLedger(root, JSON.parse(readFileSync(join(root, '_workspace/03_dev/spec.json'), 'utf8'))).harnessVersion, null)
    const result = inspectSpecConformance({projectRoot: root, runningVersion: '0.36.0'})
    assert.ok(!result.notes.some(n => n.includes('로 확정됐고')))
  }, {version: null})
})

test('버전 키가 없는 옛 원장 기록도 OK이고 비교하지 않는다', () => {
  withLocked((root, spec) => {
    const legacy = {at: new Date().toISOString(), digest: specDigest(spec), sourceDigest: spec.sourceDigest.combined, specTier: spec.specTier, targetShapes: spec.targetShapes}
    writeFileSync(join(root, SPEC_LEDGER), `${JSON.stringify(legacy)}\n`)
    const ledger = inspectSpecLedger(root, spec)
    assert.equal(ledger.state, 'OK')
    assert.equal(ledger.harnessVersion, null)
    assert.ok(!inspectSpecConformance({projectRoot: root, runningVersion: '0.36.0'}).notes.some(n => n.includes('로 확정됐고')))
  }, {record: false})
})

test('harnessVersion은 web-harness 매니페스트만 읽고, 아니면 null이다', () => {
  const root = mkdtempSync(join(tmpdir(), 'web-harness-plugin-root-'))
  try {
    assert.equal(harnessVersion(root), null, '소스 checkout에는 매니페스트가 없다')
    mkdirSync(join(root, '.claude-plugin'))
    const manifest = join(root, '.claude-plugin/plugin.json')
    writeFileSync(manifest, JSON.stringify({name: 'web-harness', version: '1.2.3'}))
    assert.equal(harnessVersion(root), '1.2.3')
    writeFileSync(manifest, JSON.stringify({name: 'consumer-plugin', version: '9.9.9'}))
    assert.equal(harnessVersion(root), null, 'deploy 사본 위치에서 소비자 플러그인 버전을 하네스 버전으로 적으면 안 된다')
    writeFileSync(manifest, JSON.stringify({name: 'web-harness', version: 3}))
    assert.equal(harnessVersion(root), null)
    writeFileSync(manifest, '{broken')
    assert.equal(harnessVersion(root), null)
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})
