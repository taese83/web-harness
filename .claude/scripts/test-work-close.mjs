#!/usr/bin/env node
// test-work-close.mjs — 자동 닫기(대상 프로젝트 CI에서 도는 자산)를 **실제 프로세스**로 돌린다.
//
// 가짜 `gh`를 PATH 앞에 둬 호출을 기록한다 — 실 GitHub은 NOT_RUN이다. 고정하는 사실:
//   (1) 근거는 PR 제목의 티켓 키와 기대 base — 커밋된 계획의 baseBranch(없으면 기본 브랜치)에 머지된 PR만 닫는다(T18)
//   (2) 제목에 키가 없거나 되돌림 PR이거나 집계 티켓이면 닫지 않는다 · 계획을 못 읽으면 멈춘다
//   (3) 이미 닫힌 이슈는 다시 닫지 않고, 닫지 못하면 exit 1로 알린다
//   (4) 옛 판본 사본은 설치됨으로 세지 않고 알린다(T25) — 덮어쓰지는 않는다
import assert from 'node:assert/strict'
import test from 'node:test'
import {chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {spawnSync} from 'node:child_process'
import {installTicketCloseAssets, planTicketCloseInstall, TICKET_CLOSE_VERSION_MARKER} from './ticket/cli.mjs'
import {checkTicketAssets} from './validate-development-readiness.mjs'

const repo = new URL('../..', import.meta.url).pathname
const SCRIPT = join(repo, '.claude/skills/team-flow/assets/close-merged-tickets.mjs')
const PR = 'https://github.com/acme/web/pull/42'
const issue = ({state = 'OPEN', body = '정지 회원 표시'} = {}) => ({state, body})

function run(issues, {title = '[#12] 정지 회원 표시', base = 'feature/members', planBase = 'feature/members', defaultBranch = 'main', failClose = null, plan = undefined} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'wh-close-'))
  try {
    if (plan !== null) {
      mkdirSync(join(root, '_workspace/03_dev'), {recursive: true})
      writeFileSync(join(root, '_workspace/03_dev/work-plan.json'), plan ?? JSON.stringify({baseBranch: planBase}))
    }
    const bin = join(root, 'bin')
    mkdirSync(bin)
    mkdirSync(join(root, 'issues'))
    for (const [number, value] of Object.entries(issues)) writeFileSync(join(root, 'issues', `${number}.json`), JSON.stringify(value))
    const calls = join(root, 'gh-calls.log')
    writeFileSync(join(bin, 'gh'), `#!/bin/sh\necho "$@" >> "${calls}"\n`
      + `if [ "$1" = "issue" ] && [ "$2" = "view" ]; then if [ -f "${root}/issues/$3.json" ]; then cat "${root}/issues/$3.json"; exit 0; fi; echo "not found" >&2; exit 1; fi\n`
      + (failClose ? `if [ "$1" = "issue" ] && [ "$2" = "close" ] && [ "$3" = "${failClose}" ]; then echo "HTTP 403" >&2; exit 1; fi\n` : ''))
    chmodSync(join(bin, 'gh'), 0o755)
    const result = spawnSync(process.execPath, [SCRIPT], {cwd: root, encoding: 'utf8', timeout: 30000,
      env: {PATH: `${bin}:${process.env.PATH}`, TICKET_REPO: 'acme/web', TICKET_PR_URL: PR, TICKET_BASE_REF: base, TICKET_PR_TITLE: title, TICKET_DEFAULT_BRANCH: defaultBranch}})
    let ghCalls = []
    try { ghCalls = readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean) } catch { /* 호출 없음 */ }
    return {status: result.status, stdout: result.stdout, ghCalls, closes: ghCalls.filter(call => call.startsWith('issue close'))}
  } finally { rmSync(root, {recursive: true, force: true}) }
}

test('(1) 제목의 티켓이 기대 base에 머지되면 닫는다 — 근거를 코멘트로 남긴다 · 계획이 없으면 기본 브랜치가 기대 base다', () => {
  const result = run({12: issue()})
  assert.equal(result.status, 0, result.stdout)
  assert.ok(result.closes.some(call => call.startsWith('issue close 12 --repo acme/web --comment')), result.ghCalls.join('\n'))
  assert.match(result.stdout, /done: 1\/1 closed/)
  for (const title of ['#12 정지 회원 표시', '[12] 정지 회원 표시']) assert.equal(run({12: issue()}, {title}).closes.length, 1, title)
  assert.equal(run({12: issue()}, {plan: null, base: 'main'}).closes.length, 1, '계획 없는 저장소의 기본 브랜치 머지를 닫지 않았다')
})

test('(2) 다른 base·키 없는 제목·되돌림 PR·집계 티켓은 닫지 않고, 계획을 못 읽으면 멈춘다', () => {
  const otherBase = run({12: issue()}, {base: 'main'})
  assert.equal(otherBase.closes.length, 0, '다른 브랜치 머지로 작업을 닫았다')
  assert.match(otherBase.stdout, /기대 base feature\/members ≠ 머지 base main/)
  for (const title of ['정지 회원 표시 (#12)', 'Revert "[#12] 정지 회원 표시"', '[#12a] 오타', '#123 다른 이슈'.replace('#123', 'x #12')]) {
    assert.equal(run({12: issue()}, {title}).closes.length, 0, `닫지 말아야 할 제목으로 닫았다: ${title}`)
  }
  assert.equal(run({12: issue({body: '<!-- web-harness:aggregate plan=x feat=FEAT-001 -->'})}).closes.length, 0, '집계 티켓을 닫았다')
  assert.equal(run({12: issue()}, {title: 'Revert "Revert "[#12] 정지 회원 표시""'}).closes.length, 1, '되돌림을 되돌린 재착륙 PR로 닫지 않았다')
  const broken = run({12: issue()}, {plan: '{깨짐'})
  assert.equal(broken.status, 1)
  assert.equal(broken.closes.length, 0, '기대 base를 모른 채 닫았다')
})

test('(3) 이미 닫힌 이슈는 다시 닫지 않고, 닫지 못하면 exit 1로 알린다', () => {
  const closed = run({12: issue({state: 'CLOSED'})})
  assert.equal(closed.closes.length, 0)
  assert.match(closed.stdout, /이미 CLOSED/)
  const failed = run({12: issue()}, {failClose: '12'})
  assert.equal(failed.status, 1)
  assert.match(failed.stdout, /failed #12/)
})

test('(4) 옛 청구 원장 기반 사본은 설치됨으로 세지 않고 알린다 — 덮어쓰지 않는다(T25)', () => {
  const root = mkdtempSync(join(tmpdir(), 'wh-close-install-'))
  try {
    mkdirSync(join(root, '_workspace/03_dev'), {recursive: true})
    writeFileSync(join(root, '_workspace/03_dev/work-item-events.jsonl'), '')
    const fresh = planTicketCloseInstall(root)
    assert.deepEqual(installTicketCloseAssets(root, fresh).length, 2)
    assert.ok(readFileSync(join(root, '.github/scripts/close-merged-tickets.mjs'), 'utf8').includes(TICKET_CLOSE_VERSION_MARKER))
    assert.equal(checkTicketAssets(root).state, 'PASS')
    // 옛 사본(v1 — 판본 표지 없음)으로 바꿔 놓는다.
    const old = '// 머지된 PR에 묶인 티켓 이슈를 닫는다.\nconst LEDGER = \'_workspace/03_dev/identity-ledger.jsonl\'\n'
    writeFileSync(join(root, '.github/scripts/close-merged-tickets.mjs'), old)
    const plan = planTicketCloseInstall(root)
    assert.deepEqual(plan.outdated, ['.github/scripts/close-merged-tickets.mjs'])
    assert.deepEqual(plan.install, [])
    const verdict = checkTicketAssets(root, {install: true})
    assert.equal(verdict.state, 'FAIL', '옛 사본을 설치됨으로 셌다')
    assert.equal(readFileSync(join(root, '.github/scripts/close-merged-tickets.mjs'), 'utf8'), old, '손봤을 수 있는 사본을 덮었다')
  } finally { rmSync(root, {recursive: true, force: true}) }
})
