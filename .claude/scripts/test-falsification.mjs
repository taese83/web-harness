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
  const {mkdtempSync, readFileSync, rmSync, writeFileSync} = await import('node:fs')
  const {join} = await import('node:path')
  // **추적되는 실파일을 변이하지 않는다.** 러너의 락은 CLI 진입점에만 걸리고 이 테스트는
  // `falsifyOne`을 직접 부르므로, 실파일을 쓰면 `pnpm run ci` 두 개가 겹칠 때 락이 막으려던
  // 바로 그 경쟁이 난다(교차 모델 커밋 리뷰 2026-09-10). 저장소 안 임시 경로를 쓴다 —
  // `falsifyOne`이 repositoryRoot 기준 상대 경로를 받기 때문이다.
  //
  // **짝 테스트도 임시 파일이다.** 종전에는 `test`로 이 파일 자신을 줬는데, 그러면 `falsifyOne`이
  // `node --test` 로 자기 자신을 스폰해 **재귀**가 된다(교차 모델 커밋 리뷰 2026-09-10).
  const root = new URL('../..', import.meta.url).pathname
  // **실행별 고유 디렉터리.** 고정 이름이면 CI 둘이 겹칠 때 서로의 probe를 지우고, 같은 이름의
  // untracked 파일도 날린다(교차 모델 커밋 리뷰 2026-09-10). 이름이 `.`으로 시작하면
  // `node --test`가 건너뛰므로(실측) 점 없이 짓는다 — CI 글롭(`test-*.mjs`)과도 겹치지 않는다.
  const scratch = mkdtempSync(join(root, '.claude/scripts/tmp-falsify-'))
  const scratchRelative = scratch.slice(root.replace(/\/$/, '').length + 1)
  const relative = `${scratchRelative}/probe.mjs`
  const probeTest = `${scratchRelative}/probe.check.mjs`
  const absolute = join(root, relative)
  const probeTestPath = join(root, probeTest)
  const before = 'export const readRegistry = () => null\n'
  writeFileSync(absolute, before)
  // 변형이 적용된 동안 **반드시 실패**하는 짝 테스트 — 그래야 falsifyOne이 OK를 내고,
  // 이 회귀가 「복원했는가」만 재는 것이 아니라 실제 반증 경로를 지나간다.
  writeFileSync(probeTestPath, [
    "import assert from 'node:assert/strict'",
    "import test from 'node:test'",
    "import {readFileSync} from 'node:fs'",
    `test('probe', () => assert.match(readFileSync(${JSON.stringify(absolute)}, 'utf8'), /readRegistry = /))`,
    '',
  ].join('\n'))
  try {
    const result = falsifyOne({
      id: 'probe', file: relative,
      find: 'export const readRegistry', replace: 'export const readRegistry_BROKEN',
      test: probeTest, why: 'probe',
    })
    assert.equal(result.status, 'OK', `짝 테스트가 변형을 잡지 못했다: ${result.reason}`)
    assert.equal(readFileSync(absolute, 'utf8'), before, '변형이 남으면 저장소가 오염된다')
  } finally { rmSync(scratch, {recursive: true, force: true}) }
})
