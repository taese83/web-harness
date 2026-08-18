#!/usr/bin/env node
// test-detect-harness-project.mjs — SessionStart 재진입 감지 훅 회귀.
//
// 고정하는 사실: (1) 루트 `_workspace/` 디렉터리가 있으면 reentry-map 절대 경로를 포함한
// 안내를 주입한다, (2) 없으면 stdout이 완전히 비어 있다(침묵), (3) `_workspace`가 파일이면
// 디렉터리가 아니므로 침묵한다, (4) 어떤 경우에도 exit 0이다(안내 층의 fail-safe는 침묵 —
// 훅 실패가 세션을 깨지 않는다).
import assert from 'node:assert/strict'
import test from 'node:test'
import {spawnSync} from 'node:child_process'
import {copyFileSync, mkdirSync, mkdtempSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'

const script = join(dirname(fileURLToPath(import.meta.url)), 'detect-harness-project.mjs')

const run = projectDir =>
  spawnSync(process.execPath, [script], {
    env: {...process.env, CLAUDE_PROJECT_DIR: projectDir},
    encoding: 'utf8',
  })

test('루트 _workspace/ 존재: 안내 + reentry-map 절대 경로 주입, exit 0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wh-detect-'))
  mkdirSync(join(dir, '_workspace'))
  const result = run(dir)
  assert.equal(result.status, 0)
  assert.match(result.stdout, /Harness-managed project detected/)
  assert.match(result.stdout, /reentry-map\.md/)
  assert.match(result.stdout, /web-orchestrator/)
})

test('_workspace 부재: 완전 침묵, exit 0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wh-detect-'))
  const result = run(dir)
  assert.equal(result.status, 0)
  assert.equal(result.stdout, '')
})

test('_workspace가 파일이면 디렉터리 아님 — 침묵, exit 0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wh-detect-'))
  writeFileSync(join(dir, '_workspace'), 'not a directory')
  const result = run(dir)
  assert.equal(result.status, 0)
  assert.equal(result.stdout, '')
})

test('CLAUDE_PROJECT_DIR가 존재하지 않는 경로여도 exit 0 (fail-safe 침묵)', () => {
  const result = run(join(tmpdir(), 'wh-detect-nonexistent-path'))
  assert.equal(result.status, 0)
  assert.equal(result.stdout, '')
})

test('reentry-map 부재(스크립트가 skills 트리 밖에 있음): 폴백 안내로 강등', () => {
  const isolated = mkdtempSync(join(tmpdir(), 'wh-detect-isolated-'))
  const orphanScript = join(isolated, 'detect-harness-project.mjs')
  copyFileSync(script, orphanScript)
  const projectDir = mkdtempSync(join(tmpdir(), 'wh-detect-'))
  mkdirSync(join(projectDir, '_workspace'))
  const result = spawnSync(process.execPath, [orphanScript], {
    env: {...process.env, CLAUDE_PROJECT_DIR: projectDir},
    encoding: 'utf8',
  })
  assert.equal(result.status, 0)
  assert.match(result.stdout, /Harness-managed project detected/)
  assert.match(result.stdout, /Re-enter via the \/web-orchestrator skill/)
  assert.doesNotMatch(result.stdout, /reentry-map\.md/)
})
