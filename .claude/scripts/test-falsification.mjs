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

test('변형 지점이 사라지면 STALE로 보고한다 — 조용히 통과하지 않는다', () => {
  const result = falsifyOne({
    id: 'probe', file: '.claude/scripts/validate-falsification.mjs',
    find: '존재하지 않는 문자열입니다', replace: 'x',
    test: '.claude/scripts/test-falsification.mjs', why: 'probe',
  })
  assert.equal(result.status, 'STALE')
  assert.match(result.reason, /변형 지점을 찾지 못했다/)
})

test('변형 지점이 여럿이면 STALE이다 — 어느 것을 끄는지 모호하다', () => {
  const result = falsifyOne({
    id: 'probe', file: '.claude/scripts/validate-falsification.mjs',
    find: 'entry', replace: 'x',
    test: '.claude/scripts/test-falsification.mjs', why: 'probe',
  })
  assert.equal(result.status, 'STALE')
  assert.match(result.reason, /유일하지 않다/)
})

test('원본을 반드시 복원한다 — 실패 경로에서도', async () => {
  const {readFileSync} = await import('node:fs')
  const target = '.claude/scripts/validate-falsification.mjs'
  const before = readFileSync(target, 'utf8')
  falsifyOne({
    id: 'probe', file: target,
    find: 'export const readRegistry', replace: 'export const readRegistry_BROKEN',
    test: '.claude/scripts/test-falsification.mjs', why: 'probe',
  })
  assert.equal(readFileSync(target, 'utf8'), before, '변형이 남으면 저장소가 오염된다')
})
