#!/usr/bin/env node
// test-spawn-completion.mjs — verify-spawn-completion.mjs의 게이트 강도 회귀 테스트.
// 특히 "무산출 가드"(2026-08-11): --paths가 산출물 0개면 vacuous PASS가 아니라 FAIL.
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import test from 'node:test'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(scriptDir, 'verify-spawn-completion.mjs')

const run = (args) => {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {encoding: 'utf8'})
    return {code: 0, stdout}
  } catch (error) {
    return {code: error.status ?? 1, stdout: `${error.stdout ?? ''}${error.stderr ?? ''}`}
  }
}

test('무산출 가드: --paths가 스캔 산출물 0개면 FAIL (vacuous PASS 방지)', () => {
  const root = mkdtempSync(join(tmpdir(), 'wh-spawn-empty-'))
  mkdirSync(join(root, 'owned'))
  try {
    const result = run(['--root', root, '--paths', 'owned'])
    assert.equal(result.code, 1)
    assert.match(result.stdout, /MISSING/)
    assert.match(result.stdout, /산출물을 하나도 남기지 않음/)
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})

test('--allow-no-output이면 빈 범위도 통과 (산출물 없는 스폰이 정당한 경우)', () => {
  const root = mkdtempSync(join(tmpdir(), 'wh-spawn-empty2-'))
  mkdirSync(join(root, 'owned'))
  try {
    const result = run(['--root', root, '--paths', 'owned', '--allow-no-output'])
    assert.equal(result.code, 0)
    assert.match(result.stdout, /PASS/)
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})

test('산출물이 있으면 정상 PASS (무산출 가드가 회귀를 만들지 않음)', () => {
  const root = mkdtempSync(join(tmpdir(), 'wh-spawn-ok-'))
  mkdirSync(join(root, 'owned'))
  writeFileSync(join(root, 'owned', 'a.ts'), 'export const x = 1\n')
  try {
    const result = run(['--root', root, '--paths', 'owned'])
    assert.equal(result.code, 0)
    assert.match(result.stdout, /PASS/)
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})

test('비-code 산출물(.md/.json/.yml)만 있어도 PASS — 무산출 가드 오탐 방지', () => {
  // package-scaffolder(package.json/turbo.json/yaml), designer(.md), deploy-ci-writer(.yml)
  // 처럼 owned 산출물이 전부 비-scannable이면 무산출이 아니다(scannable 0개여도 실산출 존재).
  const root = mkdtempSync(join(tmpdir(), 'wh-spawn-noncode-'))
  mkdirSync(join(root, 'owned'))
  writeFileSync(join(root, 'owned', 'package.json'), '{"name":"x"}\n')
  writeFileSync(join(root, 'owned', 'design-system.md'), '# tokens\n')
  writeFileSync(join(root, 'owned', 'deploy.yml'), 'on: push\n')
  try {
    const result = run(['--root', root, '--paths', 'owned'])
    assert.equal(result.code, 0)
    assert.match(result.stdout, /PASS/)
    assert.doesNotMatch(result.stdout, /MISSING [1-9]/) // 요약 "MISSING 0"은 허용, 실제 MISSING 실패만 금지
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})

test('truncation 신호(미종결 괄호)는 여전히 SUSPECT로 검출', () => {
  const root = mkdtempSync(join(tmpdir(), 'wh-spawn-trunc-'))
  mkdirSync(join(root, 'owned'))
  writeFileSync(join(root, 'owned', 'b.ts'), 'export function f() {\n  return {\n')
  try {
    const result = run(['--root', root, '--paths', 'owned'])
    assert.equal(result.code, 1)
    assert.match(result.stdout, /SUSPECT|truncation/)
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})
