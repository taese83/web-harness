#!/usr/bin/env node
// test-plan-delta.mjs — 기획 delta 대조 회귀.
//
// 기준 사건은 §4에 등록된 실패다: "apply가 기존 plan 재작성으로 승인 TC 파괴 — 존재 검사로는
// 미탐". 선언되지 않은 소멸(UNDECLARED_REMOVAL)이 그 실패의 기계적 형태이며, 아래 마지막
// 케이스가 그것을 고정한다.
import assert from 'node:assert/strict'
import test from 'node:test'
import {execFileSync} from 'node:child_process'
import {mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import {classifyDelta, detectLateSnapshot, detectResnapshot, extractIds, inventory, inventoryDigest} from './validate-plan-delta.mjs'

const SCRIPT = new URL('./validate-plan-delta.mjs', import.meta.url).pathname
function project(files) {
  const root = mkdtempSync(join(tmpdir(), 'wh-delta-'))
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel); mkdirSync(dirname(abs), {recursive: true}); writeFileSync(abs, content)
  }
  return root
}
function run(root, args) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, '--project', root, ...args], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']})
    return {code: 0, stdout}
  } catch (error) { return {code: error.status, stdout: `${error.stdout ?? ''}${error.stderr ?? ''}`} }
}

test('extractIds: 안정 ID 형태만 추출한다', () => {
  const ids = extractIds('REQ-F-001과 FEAT-007, FEAT-007-02, TC-007-1, PAGE-002. PC-014는 대장 ID라 제외.')
  assert.deepEqual([...ids].sort(), ['FEAT-007', 'FEAT-007-02', 'PAGE-002', 'REQ-F-001', 'TC-007-1'])
})

test('extractIds: REQ의 분류 접두어를 구분한다', () => {
  const ids = extractIds('REQ-F-001 / REQ-NFR-003')
  assert.deepEqual([...ids].sort(), ['REQ-F-001', 'REQ-NFR-003'])
})

test('inventory: 여러 파일의 ID를 합집합으로 모은다', () => {
  const inv = inventory([
    {file: 'a.md', text: 'FEAT-001 TC-001-1'},
    {file: 'b.md', text: 'FEAT-001 FEAT-002'},
  ])
  assert.deepEqual(inv, ['FEAT-001', 'FEAT-002', 'TC-001-1'])
})

test('변화 없음 → 위반 0', () => {
  const r = classifyDelta(['FEAT-001'], ['FEAT-001'], {})
  assert.deepEqual(r.violations, [])
})

test('선언된 추가는 통과한다', () => {
  const r = classifyDelta(['FEAT-001'], ['FEAT-001', 'FEAT-002'], {added: ['FEAT-002']})
  assert.deepEqual(r.violations, [])
  assert.deepEqual(r.appeared, ['FEAT-002'])
})

test('선언되지 않은 추가 → UNDECLARED_ADDITION', () => {
  const r = classifyDelta(['FEAT-001'], ['FEAT-001', 'FEAT-009'], {})
  assert.deepEqual(r.violations, [{code: 'UNDECLARED_ADDITION', id: 'FEAT-009'}])
})

test('선언된 제거는 통과한다', () => {
  const r = classifyDelta(['FEAT-001', 'FEAT-003'], ['FEAT-001'], {removed: ['FEAT-003']})
  assert.deepEqual(r.violations, [])
})

test('removed로 선언했는데 아직 있으면 DECLARED_BUT_PRESENT', () => {
  const r = classifyDelta(['FEAT-001'], ['FEAT-001'], {removed: ['FEAT-001']})
  assert.deepEqual(r.violations, [{code: 'DECLARED_BUT_PRESENT', id: 'FEAT-001'}])
})

test('added/modified로 선언했는데 없으면 DECLARED_BUT_ABSENT', () => {
  const r = classifyDelta(['FEAT-001'], ['FEAT-001'], {added: ['FEAT-002'], modified: ['FEAT-003']})
  assert.deepEqual(r.violations.map(v => v.code).sort(), ['DECLARED_BUT_ABSENT', 'DECLARED_BUT_ABSENT'])
})

test('회귀(§4 등록 실패): apply가 plan을 재작성해 승인 TC를 파괴하면 UNDECLARED_REMOVAL', () => {
  // 승인된 FEAT-007과 그 TC 3개가 있었는데, 변경 적용이 전체 재작성으로 TC 2개를 날렸다.
  // 선언은 "FEAT-007을 수정한다"뿐이므로 TC 소멸은 선언되지 않았다.
  const before = ['FEAT-007', 'TC-007-1', 'TC-007-2', 'TC-007-3']
  const after = ['FEAT-007', 'TC-007-1']
  const r = classifyDelta(before, after, {modified: ['FEAT-007']})
  assert.deepEqual(r.violations, [
    {code: 'UNDECLARED_REMOVAL', id: 'TC-007-2'},
    {code: 'UNDECLARED_REMOVAL', id: 'TC-007-3'},
  ])
})

test('modified 선언은 소멸을 정당화하지 않는다 (재작성 은폐 방지)', () => {
  const r = classifyDelta(['FEAT-001', 'TC-001-1'], ['FEAT-001'], {modified: ['FEAT-001', 'TC-001-1']})
  assert.deepEqual(r.violations.map(v => v.code), ['UNDECLARED_REMOVAL', 'DECLARED_BUT_ABSENT'])
})

// --- 순서 우회 검출: 승인 레코드를 before의 바닥값으로 ---

test('LATE_SNAPSHOT: 승인된 TC가 before에 없으면 스냅샷이 늦은 것이다', () => {
  const v = detectLateSnapshot(['FEAT-007', 'TC-007-1'], ['TC-007-1', 'TC-007-2'])
  assert.deepEqual(v, [{code: 'LATE_SNAPSHOT', id: 'TC-007-2'}])
})

test('LATE_SNAPSHOT: 승인 TC가 모두 before에 있으면 위반 0', () => {
  assert.deepEqual(detectLateSnapshot(['TC-007-1', 'TC-007-2'], ['TC-007-1']), [])
})

test('LATE_SNAPSHOT: 승인 레코드가 없으면 검사할 바닥값이 없다(위반 0)', () => {
  assert.deepEqual(detectLateSnapshot(['FEAT-001'], []), [])
})

// --- 원장: delta 파일 삭제 후 재스냅샷 차단 ---

test('detectResnapshot: 원장 최초 digest와 다르면 RESNAPSHOT', () => {
  const led = [{changeId: 'PC-1', beforeDigest: 'aaaa'}]
  assert.deepEqual(detectResnapshot('PC-1', 'bbbb', led).map(v => v.code), ['RESNAPSHOT'])
})

test('detectResnapshot: 같은 digest면 위반 0 (멱등)', () => {
  assert.deepEqual(detectResnapshot('PC-1', 'aaaa', [{changeId: 'PC-1', beforeDigest: 'aaaa'}]), [])
})

test('detectResnapshot: 다른 changeId 기록은 간섭하지 않는다', () => {
  assert.deepEqual(detectResnapshot('PC-2', 'bbbb', [{changeId: 'PC-1', beforeDigest: 'aaaa'}]), [])
})

test('inventoryDigest: 순서가 달라도 같은 집합이면 같은 digest', () => {
  assert.equal(inventoryDigest(['FEAT-002', 'FEAT-001']), inventoryDigest(['FEAT-001', 'FEAT-002']))
})

test('전량 선언 우회는 통하지 않는다 (대칭 검사)', () => {
  // 모든 ID를 added·removed에 다 넣어도 위반 0이 되지 않는다.
  const before = ['FEAT-001', 'TC-001-1']
  const after = ['FEAT-001']
  const r = classifyDelta(before, after, {added: before, modified: before, removed: before})
  assert.ok(r.violations.length > 0, '무차별 선언이 통과를 만들면 안 된다')
  assert.ok(r.violations.some(v => v.code === 'DECLARED_BUT_PRESENT'))
})

// --- CLI 경로 (main) 회귀 ---

test('CLI: --change 형식 오류는 exit 2', () => {
  const root = project({'_workspace/01_plan/a.md': 'FEAT-001\n'})
  try { assert.equal(run(root, ['--change', 'BAD', '--snapshot']).code, 2) } finally { rmSync(root, {recursive: true, force: true}) }
})

test('CLI: snapshot 없이 verify하면 exit 2', () => {
  const root = project({'_workspace/01_plan/a.md': 'FEAT-001\n'})
  try { assert.equal(run(root, ['--change', 'PC-001', '--verify']).code, 2) } finally { rmSync(root, {recursive: true, force: true}) }
})

test('CLI: 같은 changeId 재스냅샷은 exit 2 (delta 파일 존재)', () => {
  const root = project({'_workspace/01_plan/a.md': 'FEAT-001\n'})
  try {
    assert.equal(run(root, ['--change', 'PC-001', '--snapshot']).code, 0)
    assert.equal(run(root, ['--change', 'PC-001', '--snapshot']).code, 2)
  } finally { rmSync(root, {recursive: true, force: true}) }
})

test('CLI 회귀(원장): delta 파일을 지우고 재스냅샷해도 원장이 막는다', () => {
  const root = project({'_workspace/01_plan/a.md': 'FEAT-001\nTC-001-1\n'})
  try {
    assert.equal(run(root, ['--change', 'PC-001', '--snapshot']).code, 0)
    writeFileSync(join(root, '_workspace/01_plan/a.md'), 'FEAT-001\n') // 사고: TC 소멸
    rmSync(join(root, '_workspace/01_plan/plan-delta/PC-001.json'))    // 증거 인멸 시도
    const r = run(root, ['--change', 'PC-001', '--snapshot'])
    assert.equal(r.code, 2)
    assert.match(r.stdout, /재스냅샷 거부/)
  } finally { rmSync(root, {recursive: true, force: true}) }
})

test('CLI: 정상 흐름은 PASS로 끝난다 (오탐 0)', () => {
  const root = project({'_workspace/01_plan/a.md': 'FEAT-001\n'})
  try {
    run(root, ['--change', 'PC-001', '--snapshot'])
    const p = join(root, '_workspace/01_plan/plan-delta/PC-001.json')
    const d = JSON.parse(readFileSync(p, 'utf8'))
    d.declared = {added: ['FEAT-002'], modified: [], removed: []}
    writeFileSync(p, JSON.stringify(d))
    writeFileSync(join(root, '_workspace/01_plan/a.md'), 'FEAT-001\nFEAT-002\n')
    const r = run(root, ['--change', 'PC-001', '--verify'])
    assert.equal(r.code, 0)
    assert.match(r.stdout, /PASS/)
  } finally { rmSync(root, {recursive: true, force: true}) }
})
