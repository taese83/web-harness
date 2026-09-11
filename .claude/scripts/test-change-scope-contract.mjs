#!/usr/bin/env node
// test-change-scope-contract.mjs — 픽업이 발급하는 change-scope가 **하나의 계약**인가.
//
// 계기(2026-09-11 운영 모델 점검): 기획 티켓 경로(intake→bind→claim)와 개발자가 직접 쓴 티켓 경로
// (adopt · adopt --normalize)가 개발 에이전트에 같은 모양으로 닿는지 아무것도 재지 않았다. 둘 다 픽업이
// 발급하므로 발급자는 하나지만, 키 집합이 문서에만 있으면 코드와 갈라진다.
//
// 여기서 고정하는 사실:
//   (1) 문서(ticket-kinds.md 표)의 키 집합과 `buildChangeScope`의 키 집합이 **양방향으로** 같다
//   (2) **실제 발급 파일**(runPickup이 런타임에 덧붙인 키 포함)도 문서 밖 키를 내지 않는다
//
// 실행 조건(외부 쓰기 승인·쓰기 직렬화)은 키로 두지 않았다 — 읽는 쪽이 없고, bash 정책은 플러그인에
// 실리지 않아 발급 환경에서 강제되지 않는다(적대 리뷰 2026-09-11 HIGH). 문서가 강제의 실체를 적는다.
import assert from 'node:assert/strict'
import test from 'node:test'
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {buildChangeScope} from './ticket/pickup.mjs'
import {CHANGE_SCOPE_RELATIVE, LEDGER_RELATIVE, readChangeScopeFile, runPickup} from './ticket/cli.mjs'
import {appendLedgerRecord} from './ticket/ledger-writer.mjs'
import {buildIssueFields} from './ticket/provider-github.mjs'
import {buildTicketDraft, unitContentHash} from './ticket/emit.mjs'

const root = new URL('../..', import.meta.url).pathname
const doc = readFileSync(join(root, '.claude/skills/team-flow/references/ticket-kinds.md'), 'utf8')

/**
 * 표의 첫 열에서 백틱 키를 모은다 — 마커 사이만 읽는다(다른 절의 백틱을 줍지 않게).
 * 첫 열에 `(선택)`이 있으면 그 행의 키는 **선택**이다 — 늘 나오지는 않지만 나오면 문서에 있어야 한다.
 */
const documentedKeys = () => {
  const section = doc.match(/<!-- web-harness:change-scope-keys -->([\s\S]*?)<!-- \/web-harness:change-scope-keys -->/)
  assert.ok(section, 'ticket-kinds.md에 change-scope 키 표가 없다')
  const required = new Set()
  const optional = new Set()
  for (const row of section[1].split('\n').filter(line => line.startsWith('| `'))) {
    const cell = row.split('|')[1]
    for (const match of cell.matchAll(/`([A-Za-z_.]+)`/g)) (cell.includes('(선택)') ? optional : required).add(match[1])
  }
  return {required, optional}
}

/** 객체의 키를 한 단계 중첩까지 점 표기로(`ticket.key`). 중첩 객체의 부모 키는 넣지 않는다. */
const producedKeys = scope => {
  const keys = new Set()
  for (const [key, value] of Object.entries(scope)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const child of Object.keys(value)) keys.add(`${key}.${child}`)
    } else keys.add(key)
  }
  return keys
}

test('문서의 change-scope 키와 코드의 키가 양방향으로 같다', () => {
  const scope = buildChangeScope({
    issue: {ticketKey: 'PF-1', provider: 'jira', title: 't', body: 'b', revision: 'r1', links: [], comments: [], commentsOmitted: 0},
    unit: {featureId: 'FEAT-1', testCaseIds: ['TC-1']}, testCaseIds: ['TC-1'],
  })
  const {required, optional} = documentedKeys()
  const produced = producedKeys(scope)
  const undocumented = [...produced].filter(key => !required.has(key) && !optional.has(key))
  const phantom = [...required].filter(key => !produced.has(key))
  assert.deepEqual(undocumented, [], `코드가 내는데 문서에 없는 키: ${undocumented.join(', ')} — 개발 에이전트가 모르는 필드다`)
  assert.deepEqual(phantom, [], `문서에만 있는 키: ${phantom.join(', ')} — 약속했는데 발급하지 않는다`)
  assert.equal(scope.ticket.provider, 'jira')
  assert.equal(scope.ticket.revision, 'r1')
})

test('실제 발급 파일도 문서 밖 키를 내지 않는다 — 런타임에 덧붙는 키(재조회 실패)까지', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wh-scope-file-'))
  try {
    const unit = {featureId: 'FEAT-001', title: '모터 상세', body: '상세 표시', testCaseIds: ['TC-001-1'], type: 'feature', dependsOn: [], paths: ['src/features/dash/']}
    const units = join(dir, 'units.json')
    writeFileSync(units, JSON.stringify([unit]))
    mkdirSync(join(dir, '_workspace', '03_dev'), {recursive: true})
    appendLedgerRecord(join(dir, LEDGER_RELATIVE), {featureId: 'FEAT-001', ticketKey: '7', contentHash: unitContentHash(unit), createdAt: 't', branch: 'feature/dash'})
    const body = buildIssueFields(buildTicketDraft(unit), {branch: 'feature/dash'}).body.split('\n')
      .flatMap(line => (/^- \[ \] /.test(line) ? [line, '      (기획자가 채운 값)'] : [line])).join('\n')
    const issue = {number: 7, provider: 'github', title: 't', body, assignees: ['me'], revision: 'r1'}
    // 이미 내 배정 → 배정 없이 진행, 끝의 재조회는 던진다 → `revisionError`가 덧붙는다.
    const seq = [issue]
    const result = await runPickup({root: dir, repo: 'o/r', featureId: 'FEAT-001', developer: 'me', flags: {units},
      io: {currentBranch: async () => 'feature/dash', worktree: async () => ({dirty: false, conflicted: false}),
        resolveIssue: async () => { if (seq.length === 0) throw new Error('tracker down'); return seq.shift() }}})
    assert.equal(result.ok, true, JSON.stringify(result.bounce ?? result))
    const file = readChangeScopeFile(dir)
    assert.ok(file, `${CHANGE_SCOPE_RELATIVE}를 읽지 못했다`)
    assert.ok('revisionError' in file.ticket, '실패 경로를 타지 않았다 — 이 검사는 런타임 키를 보지 못한다')
    const {required, optional} = documentedKeys()
    const undocumented = [...producedKeys(file)].filter(key => !required.has(key) && !optional.has(key))
    assert.deepEqual(undocumented, [], `발급 파일에 문서 밖 키가 있다: ${undocumented.join(', ')}`)
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
})
