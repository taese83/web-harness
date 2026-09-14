#!/usr/bin/env node
// test-change-scope-contract.mjs — 픽업이 발급하는 change-scope가 **하나의 계약**인가.
//
// 계기(2026-09-11 운영 모델 점검): change-scope 키 집합이 문서에만 있으면 코드와 갈라진다.
//
// 여기서 고정하는 사실:
//   (1) 문서(ticket-kinds.md 표)의 키 집합과 `buildWorkChangeScope`의 키 집합이 **양방향으로** 같다
//   (2) **실제 발급 파일**(runWorkPickup이 런타임에 덧붙인 키 포함)도 문서 밖 키를 내지 않는다
// (FEAT 픽업의 `buildChangeScope`는 2026-09-14 제거 — 발급자는 WORK 픽업 하나다.)
//
// 실행 조건(외부 쓰기 승인·쓰기 직렬화)은 키로 두지 않았다 — 읽는 쪽이 없고, bash 정책은 플러그인에
// 실리지 않아 발급 환경에서 강제되지 않는다(적대 리뷰 2026-09-11 HIGH). 문서가 강제의 실체를 적는다.
import assert from 'node:assert/strict'
import test from 'node:test'
import {mkdtempSync, readFileSync, rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {buildWorkChangeScope} from './ticket/work-pickup.mjs'
import {CHANGE_SCOPE_RELATIVE, readChangeScopeFile} from './ticket/cli.mjs'

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

test('문서의 change-scope 키와 WORK 픽업이 내는 키가 양방향으로 같다', () => {
  const plan = {planId: '22222222-2222-4222-8222-222222222222'}
  const work = {workId: 'WORK-00000001-0000-4000-8000-000000000001', writePaths: ['src/shared/'],
    checks: [{kind: 'type-check', expectedOutcome: '통과', targetRefs: []}], dependsOn: [], nonGoals: [],
    contractRefs: [{path: 'src/shared/types.ts', anchor: 'Member'}]}
  const scope = buildWorkChangeScope({issue: {ticketKey: 'PF-1', provider: 'jira', title: 't', body: 'b', revision: 'r1',
    links: [], comments: [], commentsOmitted: 0}, plan, planDigest: 'a'.repeat(64), work,
    featureIds: ['FEAT-001', 'FEAT-002'], testCaseIds: []})
  const {required, optional} = documentedKeys()
  const produced = producedKeys(scope)
  const undocumented = [...produced].filter(key => !required.has(key) && !optional.has(key))
  assert.deepEqual(undocumented, [], `WORK 범위가 문서 밖 키를 낸다: ${undocumented.join(', ')}`)
  const phantom = [...required].filter(key => !produced.has(key))
  assert.deepEqual(phantom, [], `WORK 범위가 약속한 키를 빠뜨린다: ${phantom.join(', ')}`)
  assert.equal(scope.featureId, null, '공유 작업인데 FEAT 하나를 골랐다')
  assert.equal(scope.sourceDigest, 'a'.repeat(64))
})

test('실제 발급 파일도 문서 밖 키를 내지 않는다 — 런타임에 덧붙는 키(재조회 실패·대상 지문)까지', async () => {
  const {runWorkPickup} = await import('./ticket/work-pickup-run.mjs')
  const {buildWorkMarker} = await import('./ticket/work-refs.mjs')
  const {appendWorkEvent, WORK_EVENTS_PATH} = await import('./ticket/work-events.mjs')
  const {canonicalDigest} = await import('./ticket/work-analysis.mjs')
  const {randomUUID} = await import('node:crypto')
  const {cpSync} = await import('node:fs')
  const dir = mkdtempSync(join(tmpdir(), 'wh-scope-file-'))
  try {
    cpSync(join(root, '.claude/evals/fixtures/work-plan/crud'), dir, {recursive: true})
    const plan = JSON.parse(readFileSync(join(dir, '_workspace/03_dev/work-plan.json'), 'utf8'))
    const planDigest = canonicalDigest(plan)
    const workId = 'WORK-00000001-0000-4000-8000-000000000001'
    appendWorkEvent(join(dir, WORK_EVENTS_PATH), {schemaVersion: 1, eventId: randomUUID(), operationId: randomUUID(), planId: plan.planId,
      workId, eventType: 'publish-confirmed', at: new Date().toISOString(), planDigest, payload: {ticketKey: 'PF-7', provider: 'jira'}})
    const issue = {ticketKey: 'PF-7', provider: 'jira', title: 't', revision: 'r1', assignees: ['me'], links: [], comments: [], commentsOmitted: 0,
      body: `요약\n\n${buildWorkMarker({planId: plan.planId, workId, featureIds: ['FEAT-001'], testCaseIds: [], planDigest})}`}
    // 이미 내 배정 → 배정 없이 진행, 끝의 재조회는 던진다 → `revisionError`가 덧붙는다.
    const seq = [issue]
    const provider = {name: 'jira', async resolveIssue() { if (seq.length === 0) throw new Error('tracker down'); return seq.shift() },
      async transition() { return {transitioned: true} }, supportedPhases: ['in-progress']}
    const result = await runWorkPickup({root: dir, ticketKey: 'PF-7', developer: 'me', flags: {}, io: {provider, worktree: async () => ({dirty: false, conflicted: false}), refresh: async () => ({ok: true})}})
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
