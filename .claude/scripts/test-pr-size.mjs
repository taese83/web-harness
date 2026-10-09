#!/usr/bin/env node
// test-pr-size.mjs — PR 크기 상한(link의 prSize)과 기계 산출물 git 제외(team-sharing).
// 계기(aoa-web 평가 2026-10-10): 181파일·+6,926줄 PR, 문서 PR +22,924줄의 대부분이 계획 스냅샷·원본 캐시·승인 기록이었다.
import assert from 'node:assert/strict'
import test from 'node:test'
import {execFileSync} from 'node:child_process'
import {mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {PR_SIZE_LIMITS, prSizeCheck} from './ticket/work-link.mjs'
import {TEAM_SHARING} from './validate-development-readiness.mjs'

const repo = () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wh-pr-size-')))
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], {encoding: 'utf8'})
  git('init', '-q', '-b', 'main')
  writeFileSync(join(root, 'README.md'), 'r\n')
  git('add', '.'); git('commit', '-q', '-m', 'base')
  git('checkout', '-q', '-b', 'feature')
  return {root, git}
}
const lines = count => `${Array.from({length: count}, (_, index) => `export const v${index} = ${index}`).join('\n')}\n`

test('PR 크기: 코드 파일만 센다 — 문서·_workspace·lockfile은 크기에 들지 않는다', () => {
  const {root, git} = repo()
  try {
    mkdirSync(join(root, 'src')); mkdirSync(join(root, '_workspace/03_dev'), {recursive: true}); mkdirSync(join(root, 'docs'))
    writeFileSync(join(root, 'src/a.ts'), lines(10))
    writeFileSync(join(root, 'src/a.test.ts'), lines(5))
    writeFileSync(join(root, '_workspace/03_dev/work-plan.json'), lines(5000))
    writeFileSync(join(root, 'docs/spec.md'), lines(5000))
    writeFileSync(join(root, 'pnpm-lock.yaml'), lines(5000))
    git('add', '.'); git('commit', '-q', '-m', 'work')
    const size = prSizeCheck(root, {base: 'main'})
    assert.deepEqual([size.checked, size.files, size.lines, size.testFiles, size.testLines, size.over], [true, 2, 15, 1, 5, false],
      `문서·산출물·lockfile을 PR 크기에 셌다: ${JSON.stringify(size)}`)
    assert.equal(prSizeCheck(root, {base: null}).checked, false, 'base를 모르는데 쟀다')
  } finally { rmSync(root, {recursive: true, force: true}) }
})

test('PR 크기: 상한을 넘으면 over와 나누기 안내를 낸다(막지 않는다) — 파일 수·줄 수 어느 쪽이든', () => {
  const {root, git} = repo()
  try {
    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'src/big.ts'), lines(PR_SIZE_LIMITS.lines + 1))
    git('add', '.'); git('commit', '-q', '-m', 'big')
    const byLines = prSizeCheck(root, {base: 'main'})
    assert.ok(byLines.over && /나누기를 제안/.test(byLines.guidance), `줄 수 상한 초과를 알리지 않았다: ${JSON.stringify(byLines)}`)
    const byFiles = prSizeCheck(root, {base: 'main', limits: {files: 0, lines: 1e9}})
    assert.ok(byFiles.over, '파일 수 상한 초과를 알리지 않았다')
    assert.equal(prSizeCheck(root, {base: 'main', limits: {files: 10, lines: 1e9}}).over, false, '상한 안인데 초과라 했다')
  } finally { rmSync(root, {recursive: true, force: true}) }
})

test('team-sharing: 계획 스냅샷·승인 기록·원본 자료를 git 제외에 넣는다', () => {
  for (const path of ['_workspace/03_dev/work-plan-revisions/', '_workspace/03_dev/work-analysis-revisions/', '_workspace/03_dev/host-execution-grant.json',
    '_workspace/03_dev/workflow-security-acceptance.json', '_workspace/00_source/fetched/', '_workspace/00_source/imported/'])
    assert.ok(TEAM_SHARING.ignores.includes(path), `${path}를 git 제외에 넣지 않는다 — 기계 산출물이 PR을 키운다`)
})
