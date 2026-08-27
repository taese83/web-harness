#!/usr/bin/env node
// test-orchestration-surface.mjs — 오케스트레이션 표면 정의의 회귀.
//
// 여기서 고정하는 사실:
//   (1) 표면은 SKILL.md 하나가 아니다 — `references/phase-*.md`를 전부 포함한다.
//       2026-08-27 Phase 2/3/4 본문을 시점 로드로 강등했을 때 검사 8곳이 SKILL.md 경로를
//       하드코딩하고 있어 전부 눈이 멀었다(게이트가 15건 FAIL로 잡았다).
//   (2) 정의는 glob이다 — 새 Phase 파일이 생기면 자동으로 표면에 들어온다. 하드코딩으로
//       되돌리면 다음 강등에서 같은 실명이 반복된다.
//   (3) 표면 본문에는 검사들이 의존하는 문자열이 실제로 들어 있다(공허한 PASS 방지).
import assert from 'node:assert/strict'
import test from 'node:test'
import {existsSync} from 'node:fs'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {orchestrationSurface, orchestrationSurfaceFiles} from './validators/orchestration-surface.mjs'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

test('표면은 SKILL.md와 Phase 참조를 모두 포함한다', () => {
  const files = orchestrationSurfaceFiles(repositoryRoot)
  assert.ok(files.includes('.claude/skills/web-orchestrator/SKILL.md'), 'SKILL.md가 표면에 없다')
  const phases = files.filter(path => /references\/phase-.+\.md$/.test(path))
  assert.ok(phases.length >= 3, `Phase 참조가 ${phases.length}종 — SKILL.md만 보는 하드코딩으로 되돌아갔다`)
  for (const relativePath of files) {
    assert.ok(existsSync(join(repositoryRoot, relativePath)), `${relativePath}: 표면 파일이 실존하지 않는다`)
  }
})

test('표면 본문에 검사들이 의존하는 계약 문자열이 실제로 있다', () => {
  const surface = orchestrationSurface(repositoryRoot)
  // 각 문자열은 SKILL.md가 아니라 Phase 참조 쪽으로 이동한 것들이다 — SKILL.md만 읽으면 전부 실패한다.
  for (const needle of [
    'change-scope.md',
    'TARGET_BEHAVIOR',
    'PUBLIC_CONTRACTS_TO_PRESERVE',
    'TEST_EVIDENCE',
    'state-contract-designer',
    'ingestion-contract-designer',
    'analytics-domain-architect',
    'analytics-verifier',
    'qa-analytics.md',
    'visual-contract-designer',
    'minimal-change-contract.md',
  ]) {
    assert.ok(surface.includes(needle), `표면에 '${needle}'가 없다 — 검사가 눈이 먼다`)
  }
})
