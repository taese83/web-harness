#!/usr/bin/env node
// test-falsification.mjs — 반증 게이트 자신의 회귀.
//
// 이 게이트가 "반증되지 않는 게이트"를 잡는 도구인데, 자기 자신이 반증되지 않으면 같은 병이다.
import assert from 'node:assert/strict'
import test from 'node:test'
import {falsifyOne, readRegistry} from './validate-falsification.mjs'

test('등록부가 비어 있지 않다 — 반증 0건을 통과로 만들지 않는다', () => {
  const registry = readRegistry()
  assert.ok(Array.isArray(registry.entries))
  assert.ok(registry.entries.length >= 5, `등록 ${registry.entries.length}건 — 게이트 수에 비해 너무 적다`)
  for (const entry of registry.entries) {
    for (const key of ['id', 'file', 'find', 'replace', 'test', 'why']) {
      assert.ok(entry[key], `${entry.id ?? '?'}: ${key}가 없다`)
    }
    assert.notEqual(entry.find, entry.replace, `${entry.id}: 변형이 무변경이면 반증이 아니다`)
  }
})

// STALE 프로브도 **정본이 아니라 임시 작업 공간**에서 한다 — 종전에는 정본의 러너 파일을 대상으로
// 불렀고, find가 우연히 유일해지는 편집 하나면 정본을 제자리 변형하며 이 파일을 재귀 실행할 수
// 있었다(적대 리뷰 2026-09-11).
const staleProbe = async (content, find) => {
  const {mkdtempSync, rmSync, writeFileSync} = await import('node:fs')
  const {join} = await import('node:path')
  const {tmpdir} = await import('node:os')
  const root = mkdtempSync(join(tmpdir(), 'wh-falsify-stale-'))
  writeFileSync(join(root, 'target.mjs'), content)
  try {
    return falsifyOne({id: 'probe', file: 'target.mjs', find, replace: 'x', test: 'never.mjs', why: 'probe'},
      {root, run: () => { throw new Error('STALE인데 짝 테스트를 돌렸다') }})
  } finally { rmSync(root, {recursive: true, force: true}) }
}

test('변형 지점이 사라지면 STALE로 보고한다 — 조용히 통과하지 않는다', async () => {
  const result = await staleProbe('export const a = 1\n', '존재하지 않는 문자열입니다')
  assert.equal(result.status, 'STALE')
  assert.match(result.reason, /변형 지점을 찾지 못했다/)
})

test('변형 지점이 여럿이면 STALE이다 — 어느 것을 끄는지 모호하다', async () => {
  const result = await staleProbe('entry; entry\n', 'entry')
  assert.equal(result.status, 'STALE')
  assert.match(result.reason, /유일하지 않다/)
})

test('원본을 반드시 복원한다 — 실패 경로에서도', async () => {
  const {mkdtempSync, readFileSync, rmSync, writeFileSync} = await import('node:fs')
  const {join} = await import('node:path')
  const {tmpdir} = await import('node:os')
  // **저장소 밖 임시 작업 공간에서 한다(2026-09-11).** 종전에는 `falsifyOne`이 저장소 기준 경로만
  // 받아서 저장소 안(`.claude/scripts/tmp-falsify-*`)에 probe를 만들었다 — 반증이 정본 트리에
  // 쓰는 경로가 테스트에도 남아 있었다. 이제 `root`를 받으므로 정본을 전혀 건드리지 않는다.
  const root = mkdtempSync(join(tmpdir(), 'wh-falsify-probe-'))
  const before = 'export const readRegistry = () => null\n'
  writeFileSync(join(root, 'probe.mjs'), before)
  // 변형이 적용된 동안 **반드시 실패**하는 짝 테스트 — 그래야 falsifyOne이 OK를 내고,
  // 이 회귀가 「복원했는가」만 재는 것이 아니라 실제 반증 경로를 지나간다.
  writeFileSync(join(root, 'probe.check.mjs'), [
    "import assert from 'node:assert/strict'",
    "import test from 'node:test'",
    "import {readFileSync} from 'node:fs'",
    "test('probe', () => assert.match(readFileSync('probe.mjs', 'utf8'), /readRegistry = /))",
    '',
  ].join('\n'))
  try {
    const result = falsifyOne({
      id: 'probe', file: 'probe.mjs',
      find: 'export const readRegistry', replace: 'export const readRegistry_BROKEN',
      test: 'probe.check.mjs', why: 'probe',
    }, {root})
    assert.equal(result.status, 'OK', `짝 테스트가 변형을 잡지 못했다: ${result.reason}`)
    assert.equal(readFileSync(join(root, 'probe.mjs'), 'utf8'), before, '변형이 남으면 작업 공간이 오염된다')
  } finally { rmSync(root, {recursive: true, force: true}) }
})
