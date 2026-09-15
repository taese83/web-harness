#!/usr/bin/env node
// test-work-close.mjs — 자동 닫기(대상 프로젝트 CI에서 도는 자산)를 **실제 프로세스**로 돌린다.
//
// 가짜 `gh`를 PATH 앞에 둬 호출을 기록한다 — 실 GitHub은 NOT_RUN이다. 고정하는 사실:
//   (1) 근거는 WORK 원장뿐 — link가 결속했고 기대 base가 머지 base와 같은 WORK 티켓만 닫는다(T18)
//   (2) 기대 base가 없는 링크·다른 base 머지·GitHub이 아닌 트래커·집계 티켓은 닫지 않는다(뒤의 둘은 PENDING/무시)
//   (3) 원장 파손 위에서는 멈춘다 — 버리고 진행하면 지나간 상태로 닫는다
//   (4) 옛 청구 원장 기반 사본은 설치됨으로 세지 않고 알린다(T25) — 덮어쓰지는 않는다
import assert from 'node:assert/strict'
import test from 'node:test'
import {chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {randomUUID} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import {installTicketCloseAssets, planTicketCloseInstall, TICKET_CLOSE_VERSION_MARKER} from './ticket/cli.mjs'
import {checkTicketAssets} from './validate-development-readiness.mjs'

const repo = new URL('../..', import.meta.url).pathname
const SCRIPT = join(repo, '.claude/skills/team-flow/assets/close-merged-tickets.mjs')
const PLAN = '22222222-2222-4222-8222-222222222222'
const DIGEST = 'a'.repeat(64)
const W = n => `WORK-0000000${n}-0000-4000-8000-00000000000${n}`
const PR = 'https://github.com/acme/web/pull/42'

const event = (eventType, extra) => JSON.stringify({schemaVersion: 1, eventId: randomUUID(), planId: PLAN, eventType, at: '2026-09-14T00:00:00Z', planDigest: DIGEST, ...extra})
const published = (workId, ticketKey, provider) => event('publish-confirmed', {workId, operationId: randomUUID(), payload: {ticketKey, provider}})
const reviewedAll = event('plan-reviewed', {payload: {workIds: [W(1), W(2)]}})
const linked = (workId, baseRef, prUrl = PR) => event('work-linked', {workId, payload: {prUrl, ticketKey: 'x', staleCheck: 'verified', completion: {ok: true}, ...(baseRef === undefined ? {} : {baseRef})}})

function run(lines, {base = 'feature/members', issueState = 'OPEN', withReview = true, failClose = false} = {}) {
  if (withReview) lines = [reviewedAll, ...lines]
  const root = mkdtempSync(join(tmpdir(), 'wh-close-'))
  try {
    mkdirSync(join(root, '_workspace/03_dev'), {recursive: true})
    writeFileSync(join(root, '_workspace/03_dev/work-item-events.jsonl'), `${lines.join('\n')}\n`)
    const bin = join(root, 'bin')
    mkdirSync(bin)
    const calls = join(root, 'gh-calls.log')
    writeFileSync(join(bin, 'gh'), `#!/bin/sh\necho "$@" >> "${calls}"\nif [ "$1" = "issue" ] && [ "$2" = "view" ]; then echo '{"state":"${issueState}"}'; fi\n`
      + (failClose ? `if [ "$1" = "issue" ] && [ "$2" = "close" ] && [ "$3" = "12" ]; then echo "HTTP 403" >&2; exit 1; fi\n` : ''))
    chmodSync(join(bin, 'gh'), 0o755)
    const result = spawnSync(process.execPath, [SCRIPT], {cwd: root, encoding: 'utf8', timeout: 30000,
      env: {PATH: `${bin}:${process.env.PATH}`, TICKET_REPO: 'acme/web', TICKET_PR_URL: PR, TICKET_BASE_REF: base}})
    let ghCalls = []
    try { ghCalls = readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean) } catch { /* 호출 없음 */ }
    return {status: result.status, stdout: result.stdout, ghCalls}
  } finally { rmSync(root, {recursive: true, force: true}) }
}

test('(1) 기대 base에 머지된 GitHub WORK 티켓만 닫는다 — 근거를 코멘트로 남긴다', () => {
  const result = run([published(W(1), '12', 'github'), linked(W(1), 'feature/members')])
  assert.equal(result.status, 0, result.stdout)
  assert.ok(result.ghCalls.some(call => call.startsWith('issue close 12 --repo acme/web --comment')), result.ghCalls.join('\n'))
  assert.match(result.stdout, /closed WORK-00000001/)
})

test('(1-b) 사람이 만든 개발 티켓을 확인해 등록한 작업도 닫는다 — 검토 계보는 계획 검토 또는 티켓 등록이다(v3)', () => {
  const registered = event('ticket-work-registered', {workId: W(3), operationId: randomUUID(),
    payload: {ticketKey: '31', provider: 'github', assessmentDigest: DIGEST, definition: {workId: W(3)}}})
  const result = run([registered, linked(W(3), 'feature/members')], {withReview: false})
  assert.equal(result.status, 0, result.stdout)
  assert.ok(result.ghCalls.some(call => call.startsWith('issue close 31 --repo acme/web --comment')), `${result.stdout}\n${result.ghCalls.join('\n')}`)
})

test('(2) 다른 base 머지·기대 base 없는 링크·GitHub이 아닌 트래커·결속 없는 PR은 닫지 않는다', () => {
  const otherBase = run([published(W(1), '12', 'github'), linked(W(1), 'feature/members')], {base: 'main'})
  assert.equal(otherBase.ghCalls.filter(call => call.startsWith('issue close')).length, 0, '다른 브랜치 머지로 작업을 닫았다')
  assert.match(otherBase.stdout, /기대 base feature\/members ≠ 머지 base main/)
  const noBase = run([published(W(1), '12', 'github'), linked(W(1), undefined)])
  assert.equal(noBase.ghCalls.filter(call => call.startsWith('issue close')).length, 0, '기대 base 없는 링크로 닫았다')
  const jira = run([published(W(1), 'PF-12', 'jira'), linked(W(1), 'feature/members')])
  assert.equal(jira.ghCalls.length, 0)
  assert.match(jira.stdout, /PENDING WORK-00000001-0000-4000-8000-000000000001 PF-12: provider=jira/)
  const unknownProvider = run([published(W(1), '12', undefined), linked(W(1), 'feature/members')])
  assert.equal(unknownProvider.ghCalls.length, 0, '트래커를 모르는 발행을 GitHub으로 추측했다')
  const unrelated = run([published(W(1), '12', 'github'), linked(W(1), 'feature/members', 'https://github.com/acme/web/pull/7')])
  assert.equal(unrelated.ghCalls.length, 0)
  // 집계 이벤트는 작업이 아니다 — 닫을 대상에 들어오지 않는다.
  const aggregate = run([event('aggregate-confirmed', {featureId: 'FEAT-001', operationId: randomUUID(), payload: {ticketKey: '99'}}), published(W(1), '12', 'github'), linked(W(1), 'feature/members')])
  assert.equal(aggregate.ghCalls.some(call => call.includes('close 99')), false, '집계 티켓을 닫았다')
  // 이미 닫힌 이슈는 다시 닫지 않는다(멱등).
  const closed = run([published(W(1), '12', 'github'), linked(W(1), 'feature/members')], {issueState: 'CLOSED'})
  assert.equal(closed.ghCalls.filter(call => call.startsWith('issue close')).length, 0)
})

test('(3) 원장 파손 위에서는 멈춘다', () => {
  const result = run([published(W(1), '12', 'github'), '{깨진 줄', linked(W(1), 'feature/members')])
  assert.equal(result.status, 1)
  assert.equal(result.ghCalls.length, 0)
  assert.match(result.stdout, /원장 파손 위에서 티켓을 닫지 않는다/)
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

test('(5) 이슈 번호가 아닌 키·검토 계보에 없는 작업·다른 PR로 재링크된 작업은 닫지 않는다', () => {
  const notNumber = run([published(W(1), 'PF-12', 'github'), linked(W(1), 'feature/members')])
  assert.equal(notNumber.ghCalls.length, 0, 'GitHub 이슈 번호가 아닌 키를 gh에 넘겼다')
  assert.match(notNumber.stdout, /key-not-issue-number/)
  const unreviewed = run([published(W(1), '12', 'github'), linked(W(1), 'feature/members')], {withReview: false})
  assert.equal(unreviewed.ghCalls.filter(call => call.startsWith('issue close')).length, 0, '검토 계보에 없는 작업을 닫았다')
  assert.match(unreviewed.stdout, /검토 계보에 없는 작업/)
  // 이 PR에 링크됐다가 다른 PR로 다시 링크됐다 — 최신 링크가 정본이다.
  const relinked = run([published(W(1), '12', 'github'), linked(W(1), 'feature/members'), linked(W(1), 'feature/members', 'https://github.com/acme/web/pull/99')])
  assert.equal(relinked.ghCalls.filter(call => call.startsWith('issue close')).length, 0, '다른 PR로 옮겨 간 작업을 닫았다')
})

test('(6) 한 건을 닫지 못해도 나머지를 처리하고 실패를 모아 exit 1로 알린다', () => {
  const result = run([published(W(1), '12', 'github'), linked(W(1), 'feature/members'), published(W(2), '13', 'github'), linked(W(2), 'feature/members')], {failClose: true})
  assert.equal(result.status, 1)
  assert.ok(result.ghCalls.some(call => call.startsWith('issue close 13')), '첫 실패에서 나머지를 버렸다')
  assert.match(result.stdout, /failed 1: WORK-00000001/)
})
