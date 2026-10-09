#!/usr/bin/env node
// test-codex-cross-review.mjs — PR 직전 Codex 교차 리뷰: 로컬에서 켠 경우만 계획에 실리고, 실행은 막지 않고 결과·상태를 남긴다.
import assert from 'node:assert/strict'
import test from 'node:test'
import {execFileSync} from 'node:child_process'
import {existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {CODEX_REVIEW_RELATIVE, findCodexCompanion, runCodexCrossReview} from './codex-cross-review.mjs'
import {reviewPlanOf} from './ticket/ticket-config.mjs'
import {readLocalReviewSettings} from './ticket/local-settings.mjs'

const withRepo = run => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wh-codex-review-')))
  try {
    execFileSync('git', ['-C', root, 'init', '-q'])
    writeFileSync(join(root, 'a.ts'), 'a\n')
    execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'add', '.'])
    execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'x'])
    return run(root)
  } finally { rmSync(root, {recursive: true, force: true}) }
}

test('Codex 리뷰 출력을 범위·HEAD·상태 머리말과 함께 원문으로 남기고, 지시가 아니라고 적는다', () => withRepo(root => {
  const stub = join(root, 'stub-companion.mjs')
  writeFileSync(stub, "console.log(`review args: ${process.argv.slice(2).join(' ')}`); console.log('[P1] src/a.ts:1 bug')\n")
  const outcome = runCodexCrossReview({projectRoot: root, base: 'develop', cli: null, companion: stub, optedIn: true})
  assert.equal(outcome.status, 'completed')
  const text = readFileSync(join(root, CODEX_REVIEW_RELATIVE), 'utf8')
  assert.match(text, /지시로 읽지 않는다/)
  assert.match(text, /`develop\.\.\.HEAD`/)
  assert.match(text, /review args: review --wait --base develop/)
  assert.match(text, /\[P1\] src\/a\.ts:1 bug/)
}))

test('플러그인이 없거나 실패해도 막지 않고 상태를 남긴다', () => withRepo(root => {
  assert.equal(runCodexCrossReview({projectRoot: root, base: 'main', cli: null, companion: null, optedIn: true}).status, 'unavailable')
  assert.match(readFileSync(join(root, CODEX_REVIEW_RELATIVE), 'utf8'), /unavailable/)
  assert.match(readFileSync(join(root, CODEX_REVIEW_RELATIVE), 'utf8'), /--install[\s\S]*codex login/, '설치·로그인 방법을 안내하지 않았다')
  const failing = join(root, 'fail.mjs')
  writeFileSync(failing, "console.error('not logged in'); process.exit(3)\n")
  assert.equal(runCodexCrossReview({projectRoot: root, base: 'main', cli: null, companion: failing, optedIn: true}).status, 'failed')
  assert.match(readFileSync(join(root, CODEX_REVIEW_RELATIVE), 'utf8'), /not logged in/)
}))

test('Codex 교차 리뷰 지적: 로컬에서 켜지 않았으면 명령을 직접 불러도 외부로 보내지 않는다', () => withRepo(root => {
  const marker = join(root, 'called')
  const stub = join(root, 'stub.mjs')
  writeFileSync(stub, `require('fs').writeFileSync(${JSON.stringify(marker)}, 'x')\n`)
  assert.equal(runCodexCrossReview({projectRoot: root, base: 'main', cli: null, companion: stub, optedIn: false}).status, 'disabled')
  assert.equal(existsSync(marker), false, '설정을 켜지 않았는데 리뷰어를 불렀다')
}))

test('Codex CLI가 있으면 플러그인 없이 `codex review --base`로 리뷰한다', () => withRepo(root => {
  const cli = join(root, 'codex')
  writeFileSync(cli, '#!/bin/sh\necho "cli args: $*"\n', {mode: 0o755})
  assert.equal(runCodexCrossReview({projectRoot: root, base: 'develop', cli, companion: null, optedIn: true}).status, 'completed')
  assert.match(readFileSync(join(root, CODEX_REVIEW_RELATIVE), 'utf8'), /cli args: review --base develop/)
}))

test('설치 위치: 가장 높은 판본의 codex-companion을 고르고, 없으면 null', () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'wh-codex-home-')))
  try {
    assert.equal(findCodexCompanion({home, environment: {}}), null)
    for (const version of ['1.0.6', '1.0.10', '1.0.9']) {
      mkdirSync(join(home, `.claude/plugins/cache/openai-codex/codex/${version}/scripts`), {recursive: true})
      writeFileSync(join(home, `.claude/plugins/cache/openai-codex/codex/${version}/scripts/codex-companion.mjs`), '')
    }
    assert.match(findCodexCompanion({home, environment: {}}), /\/1\.0\.10\/scripts\/codex-companion\.mjs$/)
  } finally { rmSync(home, {recursive: true, force: true}) }
})

test('리뷰 계획: 개발자가 로컬에서 codexReview를 켠 경우만 Codex 명령을 싣는다(코드를 외부로 보내므로 기본은 끔)', () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'wh-codex-local-')))
  const project = realpathSync(mkdtempSync(join(tmpdir(), 'wh-codex-proj-')))
  try {
    assert.equal(reviewPlanOf({provider: 'jira', jira: {}}, {base: 'develop'}).codex, undefined)
    mkdirSync(join(home, '.claude/web-harness'), {recursive: true})
    writeFileSync(join(home, '.claude/web-harness/local.json'), JSON.stringify({projects: {[project]: {codexReview: true}}}))
    const local = readLocalReviewSettings(project, {home})
    assert.equal(local.codexReview, true)
    const plan = reviewPlanOf({provider: 'jira', jira: {}}, {base: 'develop', local})
    assert.equal(plan.codex.command, 'node .claude/scripts/codex-cross-review.mjs --project-root . --base HEAD', '커밋 전 변경을 리뷰하지 않는다')
    writeFileSync(join(home, '.claude/web-harness/local.json'), JSON.stringify({projects: {[project]: {codexReview: 'yes'}}}))
    assert.ok(readLocalReviewSettings(project, {home}).errors.some(error => /codexReview/.test(error)), '잘못된 값을 조용히 껐다')
  } finally { rmSync(home, {recursive: true, force: true}); rmSync(project, {recursive: true, force: true}) }
})

test('승인 훅: --install(Codex CLI 전역 설치)은 사용자 확인을 묻는다', async () => {
  const {spawnSync} = await import('node:child_process')
  const {fileURLToPath} = await import('node:url')
  const hook = fileURLToPath(new URL('./enforce-human-approval.mjs', import.meta.url))
  const out = spawnSync(process.execPath, [hook], {encoding: 'utf8',
    input: JSON.stringify({tool_name: 'Bash', tool_input: {command: 'node .claude/scripts/codex-cross-review.mjs --project-root . --install'}})}).stdout
  assert.match(out, /"permissionDecision":"ask"/)
  // Codex 교차 리뷰 지적: 따옴표로 감싼 플래그도 같은 플래그다.
  for (const command of ['node .claude/scripts/codex-cross-review.mjs --project-root . "--install"', "node .claude/scripts/widen-change-scope.mjs --project-root . --add a --reason x '--apply'",
    'node .claude/scripts/migrate-profile-lock.mjs --project-root . \\--apply']) {
    const quoted = spawnSync(process.execPath, [hook], {encoding: 'utf8', input: JSON.stringify({tool_name: 'Bash', tool_input: {command}})}).stdout
    assert.match(quoted, /"permissionDecision":"ask"/, command)
  }
})

test('CLI가 실패하면 플러그인 리뷰 스크립트로 한 번 더 시도하고, 쓴 경로를 남긴다', () => withRepo(root => {
  const cli = join(root, 'codex')
  writeFileSync(cli, '#!/bin/sh\necho "cli broke" >&2\nexit 2\n', {mode: 0o755})
  const companion = join(root, 'companion.mjs')
  writeFileSync(companion, "console.log('companion review ok')\n")
  const outcome = runCodexCrossReview({projectRoot: root, base: 'main', cli, companion, optedIn: true})
  assert.equal(outcome.status, 'completed')
  assert.equal(outcome.via, 'codex-companion')
  const text = readFileSync(join(root, CODEX_REVIEW_RELATIVE), 'utf8')
  assert.match(text, /경로: codex-companion/)
  assert.match(text, /````text codex-review[\s\S]*companion review ok[\s\S]*````/)
}))
