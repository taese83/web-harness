#!/usr/bin/env node
// test-resume-manifest.mjs — resume-manifest.mjs 순수 코어 회귀 테스트.
// seminar-booking 실증 시나리오: 빌더가 선언 산출물 중 일부만 쓰고 truncate → 남은 것만 재개.
import assert from 'node:assert/strict'
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import test from 'node:test'
import {classifyOutput, computeRemaining, crossCheckOwned, inspectPlanSpecBinding, scanOwned, verifyPlanLock} from './resume-manifest.mjs'
import {planDigest, specDigestOf} from './validate-spawn-plan.mjs'

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'wh-resume-'))
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel)
    mkdirSync(dirname(abs), {recursive: true})
    writeFileSync(abs, content)
  }
  return root
}

test('classifyOutput: 완결 .ts → done', () => {
  const root = fixture({'a.ts': 'export const x = 1\n'})
  try { assert.equal(classifyOutput(root, 'a.ts').status, 'done') } finally { rmSync(root, {recursive: true, force: true}) }
})

test('classifyOutput: 없는 파일 → missing', () => {
  const root = fixture({})
  try { assert.equal(classifyOutput(root, 'nope.ts').status, 'missing') } finally { rmSync(root, {recursive: true, force: true}) }
})

test('classifyOutput: truncate된 .ts(미종결 괄호) → truncated', () => {
  const root = fixture({'b.ts': 'export function f() {\n  return {\n'})
  try { assert.equal(classifyOutput(root, 'b.ts').status, 'truncated') } finally { rmSync(root, {recursive: true, force: true}) }
})

test('classifyOutput: 비-code(.md/.json)는 존재+비어있지 않으면 done', () => {
  const root = fixture({'c.md': '# spec\n', 'd.json': '{"a":1}'})
  try {
    assert.equal(classifyOutput(root, 'c.md').status, 'done')
    assert.equal(classifyOutput(root, 'd.json').status, 'done')
  } finally { rmSync(root, {recursive: true, force: true}) }
})

test('classifyOutput: 빈 파일 → missing', () => {
  const root = fixture({'e.ts': ''})
  try { assert.equal(classifyOutput(root, 'e.ts').status, 'missing') } finally { rmSync(root, {recursive: true, force: true}) }
})

test('computeRemaining: 도메인 빌더 truncate 시나리오 — 일부만 쓰고 남은 것 계산', () => {
  // 선언: types/derive/store/invariants/index. 빌더가 types·derive만 쓰고 store는 미종결로 truncate,
  // invariants·index는 미작성 → remaining = [store(truncated), invariants, index(missing)]
  const root = fixture({
    'src/entities/booking/model/types.ts': 'export type Session = {id: string}\n',
    'src/entities/booking/model/derive.ts': 'export const derive = () => 1\n',
    'src/entities/booking/model/store.ts': 'export const store = {\n  commands: {\n', // truncated
  })
  try {
    const outputs = [
      'src/entities/booking/model/types.ts',
      'src/entities/booking/model/derive.ts',
      'src/entities/booking/model/store.ts',
      'src/entities/booking/model/invariants.ts',
      'src/entities/booking/index.ts',
    ]
    const {done, truncated, missing, remaining} = computeRemaining(root, outputs)
    assert.deepEqual(done.sort(), ['src/entities/booking/model/derive.ts', 'src/entities/booking/model/types.ts'])
    assert.deepEqual(truncated.map(r => r.file), ['src/entities/booking/model/store.ts'])
    assert.deepEqual(missing.sort(), ['src/entities/booking/index.ts', 'src/entities/booking/model/invariants.ts'])
    // remaining = missing ∪ truncated (완성분 2개는 제외 — 재작성 금지)
    assert.equal(remaining.length, 3)
    assert.ok(remaining.includes('src/entities/booking/model/store.ts'))
    assert.ok(!remaining.includes('src/entities/booking/model/types.ts'))
  } finally { rmSync(root, {recursive: true, force: true}) }
})

test('computeRemaining: 전부 완결 → remaining 0 (COMPLETE)', () => {
  const root = fixture({'a.ts': 'export const a = 1\n', 'b.ts': 'export const b = 2\n'})
  try {
    const {remaining} = computeRemaining(root, ['a.ts', 'b.ts'])
    assert.equal(remaining.length, 0)
  } finally { rmSync(root, {recursive: true, force: true}) }
})

// --- GIGO 대응 (2026-08-12): 계획 스팩 확정 + owned 교차검증 ---

test('verifyPlanLock: 스팩 확정 없는 매니페스트는 unlocked로 정직 보고', () => {
  assert.equal(verifyPlanLock({task: 'x', outputs: ['a.ts']}).status, 'unlocked')
})

test('verifyPlanLock: 확정한 그대로면 locked', () => {
  const plan = {task: 'x', outputs: ['a.ts', 'b.ts'], reads: ['spec']}
  const locked = {...plan, planLock: {digest: planDigest(plan), at: '2026-08-12T00:00:00.000Z'}}
  const result = verifyPlanLock(locked)
  assert.equal(result.status, 'locked')
  assert.equal(result.at, '2026-08-12T00:00:00.000Z')
})

test('verifyPlanLock: 사후 축소(outputs 줄이기)는 TAMPERED', () => {
  const plan = {task: 'x', outputs: ['a.ts', 'b.ts', 'c.ts'], reads: ['spec']}
  const locked = {...plan, planLock: {digest: planDigest(plan), at: 'now'}}
  const shrunk = {...locked, outputs: ['a.ts']} // 실제로 쓰인 것만 남기는 위조 시도
  assert.equal(verifyPlanLock(shrunk).status, 'TAMPERED')
})

test('verifyPlanLock: outputs 추가·reads 변경도 TAMPERED', () => {
  const plan = {task: 'x', outputs: ['a.ts'], reads: ['spec']}
  const locked = {...plan, planLock: {digest: planDigest(plan), at: 'now'}}
  assert.equal(verifyPlanLock({...locked, outputs: ['a.ts', 'z.ts']}).status, 'TAMPERED')
  assert.equal(verifyPlanLock({...locked, reads: ['other']}).status, 'TAMPERED')
})

test('planDigest: 키 순서·서식이 달라도 같은 내용이면 같은 digest', () => {
  const a = {task: 'x', outputs: ['a.ts'], reads: ['s']}
  const b = {reads: ['s'], outputs: ['a.ts'], task: 'x'}
  assert.equal(planDigest(a), planDigest(b))
})

test('scanOwned/crossCheckOwned: 선언되지 않은 산출물을 잡아낸다', () => {
  const root = fixture({'src/e/a.ts': 'export const a = 1\n', 'src/e/helper.ts': 'export const h = 1\n'})
  try {
    assert.deepEqual(scanOwned(root, ['src/e']), ['src/e/a.ts', 'src/e/helper.ts'])
    const cross = crossCheckOwned(root, ['src/e/a.ts'], ['src/e'])
    assert.deepEqual(cross.undeclared, ['src/e/helper.ts'])
  } finally { rmSync(root, {recursive: true, force: true}) }
})

test('crossCheckOwned: owned 미지정이면 null(기존 동작 보존)', () => {
  const root = fixture({'src/e/a.ts': 'export const a = 1\n'})
  try { assert.equal(crossCheckOwned(root, ['src/e/a.ts'], []), null) } finally { rmSync(root, {recursive: true, force: true}) }
})

test('scanOwned: node_modules 등은 제외한다', () => {
  const root = fixture({'src/e/a.ts': 'x\n', 'src/e/node_modules/pkg/i.js': 'x\n'})
  try { assert.deepEqual(scanOwned(root, ['src/e']), ['src/e/a.ts']) } finally { rmSync(root, {recursive: true, force: true}) }
})

// --- 스팩 원장: 매니페스트 내부 스팩의 두 우회를 막는다 (2026-08-12 실측) ---

test('원장 우선: planLock을 지워도 원장이 있으면 TAMPERED', () => {
  const plan = {task: 'x', outputs: ['a.ts', 'b.ts', 'c.ts'], reads: ['spec']}
  const ledger = [{task: 'x', digest: planDigest(plan), at: 'T0'}]
  const shrunkNoLock = {task: 'x', outputs: ['a.ts'], reads: ['spec']} // planLock 삭제 + 축소
  const result = verifyPlanLock(shrunkNoLock, ledger)
  assert.equal(result.status, 'TAMPERED')
  assert.equal(result.source, 'ledger')
})

test('원장 우선: 축소 후 재확정해도 최초 항목과 대조해 TAMPERED + relocked', () => {
  const plan = {task: 'x', outputs: ['a.ts', 'b.ts'], reads: ['spec']}
  const shrunk = {task: 'x', outputs: ['a.ts'], reads: ['spec']}
  const ledger = [
    {task: 'x', digest: planDigest(plan), at: 'T0'},
    {task: 'x', digest: planDigest(shrunk), at: 'T1'}, // 재확정 시도
  ]
  const result = verifyPlanLock({...shrunk, planLock: {digest: planDigest(shrunk), at: 'T1'}}, ledger)
  assert.equal(result.status, 'TAMPERED')
  assert.equal(result.relocked, true, '재확정이 드러나야 한다')
})

test('원장 일치면 locked(source=ledger)', () => {
  const plan = {task: 'x', outputs: ['a.ts'], reads: ['spec']}
  const result = verifyPlanLock(plan, [{task: 'x', digest: planDigest(plan), at: 'T0'}])
  assert.equal(result.status, 'locked')
  assert.equal(result.source, 'ledger')
  assert.equal(result.relocked, false)
})

test('원장 없으면 매니페스트 planLock으로 폴백(source=manifest)', () => {
  const plan = {task: 'x', outputs: ['a.ts'], reads: ['spec']}
  const locked = {...plan, planLock: {digest: planDigest(plan), at: 'T0'}}
  assert.equal(verifyPlanLock(locked, null).source, 'manifest')
})

test('원장은 같은 task 항목만 대조한다(다른 task 오염 방지)', () => {
  const mine = {task: 'mine', outputs: ['a.ts'], reads: ['s']}
  const ledger = [
    {task: 'other', digest: 'deadbeefdeadbeef', at: 'T0'},
    {task: 'mine', digest: planDigest(mine), at: 'T1'},
  ]
  assert.equal(verifyPlanLock(mine, ledger).status, 'locked')
})

// ── 계획 ↔ 스팩 결속 (2026-08-30) ───────────────────────────────────────────
// 매니페스트가 스팩보다 먼저 잠기면 그 계획은 낡은 전제 위에 선다. 종전에는 아무것도 그
// 어긋남을 보지 않아서, 개발 세션이 사용자에게 "어느 쪽이 정본이냐"를 물었다.

const SPEC = {schemaVersion: 2, layerMap: {domain: 'src/entities'}, testLayers: {unit: 'src'}}

const withSpec = (spec, fn) => {
  const root = fixture({})
  try {
    if (spec) {
      mkdirSync(join(root, '_workspace/03_dev'), {recursive: true})
      writeFileSync(join(root, '_workspace/03_dev/spec.json'), JSON.stringify(spec))
    }
    return fn(root)
  } finally { rmSync(root, {recursive: true, force: true}) }
}

test('결속도 스팩도 없으면 NO_SPEC — 결속을 주장하지 않는다', () => {
  withSpec(null, root => {
    assert.equal(inspectPlanSpecBinding(root, {digest: 'x', at: 'T0'}).state, 'NO_SPEC')
  })
})

// 결속이 있는데 스팩이 없다 = 잠금 시점엔 있었다는 뜻이다. 부재로 강등하면 STALE에 몰린
// 세션이 spec.json을 지워 결박을 끌 수 있다(§4 INVALID_SPEC 판례와 같은 클래스).
test('결속은 있는데 스팩이 사라지면 SPEC_GONE — 부재로 강등하지 않는다', () => {
  withSpec(null, root => {
    const lock = {digest: 'x', at: 'T0', specDigest: 'a'.repeat(64)}
    assert.equal(inspectPlanSpecBinding(root, lock).state, 'SPEC_GONE')
  })
})

test('결속 없는 옛 잠금은 UNBOUND — 통과가 아니라 미검사다', () => {
  withSpec(SPEC, root => {
    assert.equal(inspectPlanSpecBinding(root, {digest: 'x', at: 'T0'}).state, 'UNBOUND')
  })
})

test('같은 스팩 위에서 잠겼으면 OK', () => {
  withSpec(SPEC, root => {
    const lock = {digest: 'x', at: 'T0', specDigest: specDigestOf(SPEC)}
    assert.equal(inspectPlanSpecBinding(root, lock).state, 'OK')
  })
})

test('스팩이 그 뒤로 바뀌었으면 STALE — 계획이 낡은 것이지 스팩이 틀린 게 아니다', () => {
  withSpec(SPEC, root => {
    const lock = {digest: 'x', at: 'T0', specDigest: specDigestOf({...SPEC, layerMap: {domain: 'src/other'}})}
    const result = inspectPlanSpecBinding(root, lock)
    assert.equal(result.state, 'STALE')
    assert.notEqual(result.bound, result.current)
  })
})
