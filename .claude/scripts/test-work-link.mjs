#!/usr/bin/env node
// test-work-link.mjs — WORK의 완료 주장(link)과 완료(연결한 PR의 머지): legacy `link`의 게이트를 옮겼는가.
//
// 고정하는 사실:
//   STALE  change-scope가 이 작업의 것이면 계획 digest로 대조하고, 대조할 수 없으면 명시 인수 없이 막는다
//   멱등   이미 연결된 작업의 재실행은 지나간 판정을 다시 심판하지 않는다
//   완료   소유 TC가 인용되지 않았거나 check 대상이 없으면 막는다 — 기준이 하나도 없으면 판정 불가
//   인수   `--accept-*`로 넘긴 사실은 내 연결 기록과 PR 본문 문단에 남는다(리뷰어가 본다)
//   머지   완료는 기록하지 않는다 — 기대 base에 머지된 PR을 제목의 티켓 키로 찾는다(키 없는 제목은 연결하지 않는다)
import assert from 'node:assert/strict'
import test from 'node:test'
import {cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {randomUUID} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import {evaluateWorkCompletion, findMixedCommits, planWorkLink, projectRefDigest} from './ticket/work-link.mjs'
import {resolvePrStates, runWorkLink, workCloseLine} from './ticket/work-link-run.mjs'
import {prEvidenceFromPrs, titleStartsWithKey, withTrackerCompletion} from './ticket/work-provider.mjs'
import {linkRecordPath, readMergedPrs, readTrackerWorkState} from './ticket/work-state-run.mjs'
import {appendWorkEvent, foldWorkState, readWorkEvents, validateWorkEvent, WORK_EVENTS_PATH} from './ticket/work-events.mjs'
import {canonicalDigest} from './ticket/work-analysis.mjs'
import {writeChangeScopeFile} from './ticket/cli.mjs'
import {buildWorkChangeScope} from './ticket/work-pickup.mjs'

const repo = new URL('../..', import.meta.url).pathname
const FIXTURE = join(repo, '.claude/evals/fixtures/work-plan/crud')
const plan = JSON.parse(readFileSync(join(FIXTURE, '_workspace/03_dev/work-plan.json'), 'utf8'))
const planDigest = canonicalDigest(plan)
const W = n => `WORK-0000000${n}-0000-4000-8000-00000000000${n}`
// 개발자 로컬 리뷰 설정(홈의 파일)을 읽는 경로가 실행자 머신 상태에 좌우되지 않게 빈 홈으로 격리한다.
process.env.HOME = mkdtempSync(join(tmpdir(), 'wh-link-empty-home-'))
const PR = 'https://github.com/acme/web/pull/42'
const work = id => plan.workItems.find(entry => entry.workId === id)
const owned = id => plan.featureBindings.flatMap(binding => binding.acceptanceOwners.filter(owner => owner.workId === id).map(owner => owner.testCaseId))
const everything = () => true
const published = (id, extra = {}) => ({works: new Map([[id, {status: 'published', ticketKey: 'PF-104', planDigest, ...extra}]])})
const titled = {prInfo: async () => ({state: 'OPEN', baseRefName: 'develop', title: '[PF-101] 회원 API'})}
const linkRecord = (root, key) => JSON.parse(readFileSync(join(root, linkRecordPath(key)), 'utf8'))
const scopeFor = id => ({workId: id, sourceDigest: planDigest, ticket: {key: 'PF-104', provider: 'jira', revision: 'r1', revisionStage: 'settled-at-pickup'}})

test('완료: 소유 TC가 인용되지 않았거나 check 대상이 없으면 충족이 아니다', () => {
  const tcs = owned(W(4))
  assert.ok(tcs.length > 0, 'fixture 전제: W4는 TC를 소유한다')
  const full = evaluateWorkCompletion({work: work(W(4)), ownedTestCaseIds: tcs, citedIds: tcs, pathExists: everything})
  assert.equal(full.ok, true)
  const uncited = evaluateWorkCompletion({work: work(W(4)), ownedTestCaseIds: tcs, citedIds: tcs.slice(1), pathExists: everything})
  assert.equal(uncited.reason, 'uncited-test-cases')
  assert.deepEqual(uncited.testCases.missing, [tcs[0]])
  // TC가 없는 기반 작업은 check 대상의 실재로 잰다.
  const foundation = evaluateWorkCompletion({work: work(W(1)), ownedTestCaseIds: [], citedIds: [], pathExists: () => false})
  assert.equal(foundation.reason, 'check-targets-missing')
  assert.deepEqual(foundation.checks.missing.map(item => item.checkId), ['A-1'])
  // 대상 경로가 없는 check는 잴 수 없다 — 통과로 접지 않는다.
  const unmeasurable = evaluateWorkCompletion({work: {checks: [{checkId: 'X', targetRefs: []}]}, ownedTestCaseIds: [], citedIds: [], pathExists: everything})
  assert.equal(unmeasurable.ok, false)
  // 기준이 하나도 없으면 판정 불가다.
  assert.equal(evaluateWorkCompletion({work: {checks: []}, ownedTestCaseIds: [], citedIds: [], pathExists: everything}).reason, 'no-acceptance')
})

test('STALE: 픽업 뒤 계획이 바뀌었으면 막고, 대조할 수 없으면 명시 인수 없이 막는다', () => {
  const completion = evaluateWorkCompletion({work: work(W(4)), ownedTestCaseIds: owned(W(4)), citedIds: owned(W(4)), pathExists: everything})
  const base = {baseRef: 'develop', plan, planDigest, state: published(W(4)), ticketKey: 'PF-104', prUrl: PR, completion}
  assert.equal(planWorkLink({baseRef: 'develop', ...base, changeScope: {...scopeFor(W(4)), sourceDigest: 'b'.repeat(64)}}).blocked, 'stale-change-scope')
  const none = planWorkLink({baseRef: 'develop', ...base, changeScope: null})
  assert.equal(none.blocked, 'stale-check-unavailable')
  assert.equal(none.staleCheck, 'not-performed:no-change-scope')
  assert.equal(planWorkLink({baseRef: 'develop', ...base, changeScope: scopeFor(W(1))}).staleCheck, 'not-performed:different-work')
  const accepted = planWorkLink({baseRef: 'develop', ...base, changeScope: null, flags: {'accept-unverified-scope': true}})
  assert.equal(accepted.ok, true)
  assert.equal(accepted.event.payload.acceptedUnverifiedScope, true, '대조 없이 넘긴 사실이 연결 기록에서 사라졌다')
  const verified = planWorkLink({baseRef: 'develop', ...base, changeScope: scopeFor(W(4))})
  assert.equal(verified.event.payload.staleCheck, 'verified')
  assert.deepEqual(verified.event.payload.ticket, scopeFor(W(4)).ticket, '어느 티켓 개정으로 개발했는지 남지 않았다')
})

test('완료 조건 미충족은 막고, 명시 인수로 넘기면 그 사실이 연결 기록에 남는다', () => {
  const partial = evaluateWorkCompletion({work: work(W(4)), ownedTestCaseIds: owned(W(4)), citedIds: [], pathExists: everything})
  const base = {baseRef: 'develop', plan, planDigest, state: published(W(4)), changeScope: scopeFor(W(4)), ticketKey: 'PF-104', prUrl: PR, completion: partial}
  assert.equal(planWorkLink(base).blocked, 'completion:uncited-test-cases')
  const accepted = planWorkLink({baseRef: 'develop', ...base, flags: {'accept-incomplete': true}})
  assert.equal(accepted.event.payload.acceptedIncomplete, true)
  assert.equal(accepted.event.payload.completion.ok, false)
  assert.deepEqual(accepted.event.payload.completion.testCases.missing, owned(W(4)))
})

test('등록·멱등: 원장이 모르는 키는 막고, 이미 연결된 작업은 다시 심판하지 않는다', () => {
  const completion = evaluateWorkCompletion({work: work(W(4)), ownedTestCaseIds: owned(W(4)), citedIds: [], pathExists: everything})
  assert.equal(planWorkLink({baseRef: 'develop', plan, planDigest, state: {works: new Map()}, changeScope: null, ticketKey: 'PF-104', prUrl: PR, completion}).blocked, 'work-not-registered')
  const twice = {works: new Map([[W(4), {status: 'published', ticketKey: 'PF-104'}], [W(5), {status: 'published', ticketKey: 'PF-104'}]])}
  assert.equal(planWorkLink({baseRef: 'develop', plan, planDigest, state: twice, changeScope: null, ticketKey: 'PF-104', prUrl: PR, completion}).blocked, 'ticket-registered-twice')
  const linked = published(W(4), {link: {prUrl: 'https://github.com/acme/web/pull/7'}})
  const again = planWorkLink({baseRef: 'develop', plan, planDigest, state: linked, changeScope: scopeFor(W(4)), ticketKey: 'PF-104', prUrl: PR, completion})
  assert.equal(again.idempotent, true, '미충족인데 재실행이 막혔다 — 지나간 판정을 다시 심판했다')
  assert.equal(again.existing, 'https://github.com/acme/web/pull/7')
  assert.equal(planWorkLink({baseRef: 'develop', plan, planDigest, state: published(W(4)), changeScope: null, ticketKey: 'PF-104', prUrl: 'not-a-url', completion}).blocked, 'pr-url-required')
})

test('머지: 기대 base에 머지된 PR 중 제목이 티켓 키로 시작하는 것만 완료다 — 열린 PR·키 없는 제목은 완료가 아니다', () => {
  const state = {works: new Map([1, 3, 4].map(n => [W(n), {status: 'published', ticketKey: `PF-${n}`}]))}
  const merged = [{number: 1, title: '[PF-1] 회원 API', mergedAt: '2026-09-11T00:00:00.000Z', url: 'https://github.com/o/r/pull/1'},
    {number: 4, title: '회원 목록 (PF-4)', mergedAt: '2026-09-11T00:00:00.000Z', url: 'https://github.com/o/r/pull/4'}]
  const prEvidence = new Map(['PF-1', 'PF-3', 'PF-4'].map(key => [key, prEvidenceFromPrs(merged, {ticketKey: key})]).filter(([, value]) => value))
  const next = withTrackerCompletion(state, [], {prEvidence, links: new Map([['PF-3', {ticketKey: 'PF-3', prUrl: 'https://github.com/o/r/pull/3'}]])})
  assert.deepEqual([...next.works].filter(([, item]) => item.completed).map(([workId]) => workId), [W(1)])
  assert.equal(next.works.get(W(1)).completed.prUrl, 'https://github.com/o/r/pull/1')
  assert.equal(next.works.get(W(3)).link.prUrl, 'https://github.com/o/r/pull/3', '내 연결 기록을 겹치지 않았다(멱등의 근거)')
})

test('원장: 개발 쪽 기록(연결·완료·회수)은 원장에 쓸 수 없다 — 티켓 코멘트가 기록이다', () => {
  const base = {schemaVersion: 1, eventId: randomUUID(), planId: plan.planId, workId: W(1), at: new Date().toISOString()}
  for (const eventType of ['work-linked', 'work-completed', 'work-reopened']) {
    assert.ok(validateWorkEvent({...base, eventType, planDigest, payload: {prUrl: PR}}).some(error => /eventType/.test(error)), `${eventType}가 원장에 들어간다`)
  }
})

test('닫는 줄은 트래커가 정한다 — 모르면 닫는다고 적지 않는다', () => {
  assert.match(workCloseLine('github', '12'), /12/)
  assert.match(workCloseLine('jira', 'PF-104'), /Relates to PF-104[\s\S]*자동 닫히지 않는다/)
  assert.equal(workCloseLine(null, 'PF-104'), null)
})

// ── 실행부: 원장·파일·배선 ──────────────────────────────────────────────
const workspace = () => {
  const root = mkdtempSync(join(tmpdir(), 'wh-work-link-'))
  cpSync(FIXTURE, root, {recursive: true})
  appendWorkEvent(join(root, WORK_EVENTS_PATH), {schemaVersion: 1, eventId: randomUUID(), operationId: randomUUID(), planId: plan.planId,
    workId: W(1), eventType: 'publish-confirmed', at: new Date().toISOString(), planDigest, payload: {ticketKey: 'PF-101'}})
  return root
}

test('다시 연 시각: 머지 근거가 있는데 열린 티켓은 다시 연 시각을 읽고, 그 전의 머지는 완료가 아니다', async () => {
  const merged = [{number: 7, title: '[PF-7] 회원 API', mergedAt: '2026-09-11T00:00:00.000Z', url: 'https://github.com/o/r/pull/7'}]
  const asked = []
  const provider = {name: 'jira', async listWorkIssues({keys}) { return {items: keys.map(ticketKey => ({ticketKey, statusCategory: 'indeterminate'})), complete: true} },
    async listReopens({keys}) { asked.push(...keys); return {reopens: new Map([['PF-7', '2026-09-12T00:00:00.000Z']]), errors: []} }}
  const state = {works: new Map([[W(1), {status: 'published', ticketKey: 'PF-7'}], [W(3), {status: 'published', ticketKey: 'PF-9'}]])}
  const read = await readTrackerWorkState({provider, state, root: tmpdir(), io: {mergedPrs: async () => merged, repoContext: async () => ({repoName: 'r', baseBranch: 'main'})}})
  assert.equal(read.state.works.get(W(1)).completed ?? null, null, '다시 연 뒤에도 그 전 머지를 완료로 읽었다')
  assert.deepEqual(asked, ['PF-7'], '머지 근거 없는 티켓까지 이력을 읽었다')
})

test('머지된 PR 목록: 기대 base로 묻고, 저장소 원격을 모르면 근거 없이 가며 그렇게 알린다', async () => {
  let asked = null
  const read = await readMergedPrs({context: {baseBranch: 'feature/members', slug: 'o/r', host: 'github.com'}, io: {mergedPrs: async ({base}) => { asked = base; return [] }}})
  assert.equal(asked, 'feature/members', '기대 base가 아닌 브랜치의 머지를 물었다')
  assert.equal(read.checked, true)
  const unknown = await readMergedPrs({context: {baseBranch: 'main', slug: null, host: null}})
  assert.equal(unknown.checked, false)
  assert.match(unknown.note, /저장소 원격을 알 수 없어/)
})

test('범위 밖 파일: 작업 범위·테스트 레이어·하네스 산출물 밖에서 고친 파일만 알린다', async () => {
  const {findOutsideScope} = await import('./ticket/work-link.mjs')
  const {layerPattern} = await import('./agent-registry.mjs')
  const log = ['@@commit a1 code', 'src/pages/members/list/List.tsx', 'package.json', 'tests/list.test.ts', '',
    '@@commit b2 harness', '_workspace/03_dev/work-item-events.jsonl', 'src/app/routes.ts'].join('\n')
  assert.deepEqual(findOutsideScope(log, ['src/pages/members/list/', 'tests/'], layerPattern), ['package.json', 'src/app/routes.ts'])
  assert.deepEqual(findOutsideScope(log, ['src/pages/members/list/', 'tests/', 'src/app/routes.ts', 'package.json'], layerPattern), [])
})

test('실행부: 받지 않은 계획 개정이 원격 base에 있으면 연결하지 않는다 — 로컬 계획으로 STALE를 재지 않는다', async () => {
  const root = workspace()
  try {
    writeChangeScopeFile(root, buildWorkChangeScope({issue: {ticketKey: 'PF-101', provider: 'jira', title: 't', body: 'b', revision: 'r1'},
      plan, planDigest, work: work(W(1)), featureIds: ['FEAT-001'], testCaseIds: []}))
    const result = await runWorkLink({root, ticketKey: 'PF-101', prUrl: PR, flags: {base: 'develop'},
      io: {...titled, refresh: async () => ({ok: true}), planRemote: async () => ({checked: true, ref: 'origin/develop', commits: ['abc1234']})}})
    assert.equal(result.blocked, 'plan-behind-remote')
  } finally { rmSync(root, {recursive: true, force: true}) }
})

test('실행부: PR 제목이 티켓 키로 시작하지 않으면 연결하지 않는다 — 머지된 PR을 제목의 키로 찾는다', async () => {
  const root = workspace()
  try {
    writeChangeScopeFile(root, buildWorkChangeScope({issue: {ticketKey: 'PF-101', provider: 'jira', title: 't', body: 'b', revision: 'r1'},
      plan, planDigest, work: work(W(1)), featureIds: ['FEAT-001'], testCaseIds: []}))
    for (const ref of work(W(1)).checks.flatMap(check => check.targetRefs)) { mkdirSync(join(root, ref, '..'), {recursive: true}); writeFileSync(join(root, ref), 'changed') }
    const io = (title, headRefName = 'feature/login') => ({prInfo: async () => ({state: 'OPEN', baseRefName: 'develop', title, headRefName}), refresh: async () => ({ok: true}), planRemote: async () => ({checked: false}), commitLog: async () => ''})
    const missing = await runWorkLink({root, ticketKey: 'PF-101', prUrl: PR, flags: {}, io: io('feat: 회원 API')})
    assert.equal(missing.blocked, 'pr-title-key-required', JSON.stringify(missing.blocked ?? missing.prTitle))
    assert.match(missing.guidance, /PF-101/)
    const trailing = await runWorkLink({root, ticketKey: 'PF-101', prUrl: PR, flags: {}, io: io('feat: 회원 API [PF-101]')})
    assert.equal(trailing.blocked, 'pr-title-key-required', '근거로 세지 않을 제목을 통과시켰다')
    // `--base`를 줘도 제목은 읽는다 — 기대 base만 운영자가 정한다.
    const withBase = await runWorkLink({root, ticketKey: 'PF-101', prUrl: PR, flags: {base: 'develop'}, io: io('feat: 회원 API')})
    assert.equal(withBase.blocked, 'pr-title-key-required', '`--base`로 제목 키 검사를 건너뛰었다')
    // 제목에 키가 없어도 브랜치 이름에 키가 있으면 연결한다(미리보기로 확인).
    const branched = await runWorkLink({root, ticketKey: 'PF-101', prUrl: PR, flags: {'dry-run': true}, io: io('feat: 회원 API', 'feature/PF-101-member-api')})
    assert.equal(branched.prTitle?.ok, true, JSON.stringify(branched.prTitle))
    assert.equal(branched.prTitle.by, 'branch')
    // 연결 전 리뷰 계획: 하네스 리뷰어는 늘, 프로젝트 리뷰어는 팀이 선언한 것만.
    assert.deepEqual(branched.review, {harness: 'code-reviewer', project: [], base: 'develop', head: 'HEAD'}, '리뷰 범위가 link가 판정한 기대 base가 아니다')
    const declared = await runWorkLink({root, ticketKey: 'PF-101', prUrl: PR, flags: {'dry-run': true},
      io: {...io('feat: 회원 API', 'feature/PF-101-member-api'), ticketConfig: {provider: 'jira', jira: {reviewAgents: ['code-reviewer', 'code-reviewer', ' a11y-reviewer ']}}}})
    assert.deepEqual(declared.review.project, ['code-reviewer', 'a11y-reviewer'], '팀이 선언한 프로젝트 리뷰어가 연결 전 리뷰에 실리지 않았다')
    // 개발자 로컬 설정(저장소 밖)이 있으면 그 리뷰어·참고 문서가 합쳐지고 출처가 남는다.
    const home = mkdtempSync(join(tmpdir(), 'wh-link-home-'))
    try {
      mkdirSync(join(home, '.claude/web-harness'), {recursive: true})
      writeFileSync(join(home, '.claude/web-harness/local.json'), JSON.stringify({projects: {[root]: {reviewAgents: ['local-reviewer']}}}))
      const withLocal = await runWorkLink({root, ticketKey: 'PF-101', prUrl: PR, flags: {'dry-run': true}, io: {...io('feat: 회원 API', 'feature/PF-101-member-api'), home}})
      assert.deepEqual(withLocal.review.project, ['local-reviewer'])
      assert.equal(withLocal.review.local?.path, join(home, '.claude/web-harness/local.json'), '로컬 설정 출처가 link 결과에 남지 않았다')
    } finally { rmSync(home, {recursive: true, force: true}) }
    const present = await runWorkLink({root, ticketKey: 'PF-101', prUrl: PR, flags: {}, io: io('[PF-101] feat: 회원 API')})
    assert.equal(present.ok, true, JSON.stringify(present))
    assert.equal(present.prTitle?.ok, true)
    assert.equal(titleStartsWithKey('[#12] 정지 회원', '12'), true, '자동 닫기가 받는 제목 형식을 완료 판정이 받지 않는다')
  } finally { rmSync(root, {recursive: true, force: true}) }
})

test('실행부: 범위도 등록도 없는 티켓을 연결하면 멈춘다 — 판정 전에 던지지 않는다', async () => {
  const root = workspace()
  try {
    const result = await runWorkLink({root, ticketKey: 'PF-999', prUrl: PR, flags: {base: 'develop'}})
    assert.equal(result.ok, false)
    assert.equal(result.blocked, 'work-not-registered')
  } finally { rmSync(root, {recursive: true, force: true}) }
})

test('실행부: 기반 작업을 연결하면 내 로컬에 판정과 함께 남고(원장·티켓엔 없다), 머지된 PR을 읽은 뒤에야 완료가 된다', async () => {
  const root = workspace()
  const calls = []
  const tracker = {name: 'jira', async resolveIssue(key) { calls.push('resolveIssue'); return {ticketKey: key, body: ''} },
    async comment() { calls.push('comment') }, async listWorkIssues({keys}) { return {items: keys.map(ticketKey => ({ticketKey, statusCategory: 'indeterminate'})), complete: true} }}
  try {
    writeChangeScopeFile(root, buildWorkChangeScope({issue: {ticketKey: 'PF-101', provider: 'jira', title: 't', body: 'b', revision: 'r1'},
      plan, planDigest, work: work(W(1)), featureIds: ['FEAT-001'], testCaseIds: []}))
    // check 대상이 아직 없다 — 막힌다.
    const blocked = await runWorkLink({root, ticketKey: 'PF-101', prUrl: PR, flags: {base: 'develop'}, io: {...titled, provider: tracker}})
    assert.equal(blocked.blocked, 'completion:check-targets-missing', JSON.stringify(blocked))
    mkdirSync(join(root, 'src/entities/member'), {recursive: true})
    writeFileSync(join(root, 'src/entities/member/api.ts'), 'export type Member = {id: string}\n')
    // 라운드 완료 기준은 PR 본문에 실린다(change-scope는 로컬이다)
    writeFileSync(join(root, '_workspace/03_dev/change-scope.md'), `${readFileSync(join(root, '_workspace/03_dev/change-scope.md'), 'utf8')}\n- ACC-R1-1 회원 목록을 열면 각 회원의 이름이 보인다 · LOCAL_VERIFIABLE — TT-R1-1\n- ACC-R1-2 배포 환경에서 로그인 쿠키가 유지된다 · DEPLOY_ONLY — TT-R1-2\n`)
    const ledgerBefore = readFileSync(join(root, WORK_EVENTS_PATH), 'utf8')
    const linked = await runWorkLink({root, ticketKey: 'PF-101', prUrl: PR, flags: {base: 'develop'}, io: {...titled, provider: tracker}})
    assert.equal(linked.ok, true, JSON.stringify(linked))
    assert.equal(linked.staleCheck, 'verified')
    assert.equal(readFileSync(join(root, WORK_EVENTS_PATH), 'utf8'), ledgerBefore, '연결이 원장에 쓰였다')
    assert.equal(calls.includes('comment'), false, '연결을 티켓에 썼다')
    assert.equal(linkRecord(root, 'PF-101').baseRef, 'develop')
    assert.match(linked.prBody, /Relates to PF-101/)
    assert.match(linked.prBody, /완료 조건\(계획 작업, \d+개 중 \d+개 (?:대상 파일 변경 확인|대상 경로 존재 확인[^)]*)\):\n1\. /, 'PR 본문에 티켓 완료 조건 문장을 싣지 않았다')
    assert.doesNotMatch(linked.prBody, /ACC-R1-1/, '티켓 작업 PR에 라운드 기준을 섞었다 — 한 PR에는 그 작업의 기준 한 종류만')
    // 다시 연결하면 지나간 판정을 다시 심판하지 않는다 — 내 연결 기록을 읽는다.
    const again = await runWorkLink({root, ticketKey: 'PF-101', prUrl: PR, flags: {base: 'develop'}, io: {...titled, provider: tracker}})
    assert.equal(again.idempotent, true, JSON.stringify(again))
    const read = prs => readTrackerWorkState({provider: tracker, state: foldWorkState(readWorkEvents(join(root, WORK_EVENTS_PATH))), root, plan,
      io: {mergedPrs: async () => prs, repoContext: async () => ({repoName: 'web', baseBranch: 'develop'})}})
    assert.equal((await read([])).state.works.get(W(1)).completed ?? null, null, '머지되지 않았는데 완료로 읽었다')
    const merged = await read([{number: 42, title: '[PF-101] 회원 API', mergedAt: new Date().toISOString(), url: PR}])
    assert.equal(merged.state.works.get(W(1)).completed?.prUrl, PR)
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})

test('배선: `link --work <키> <PR>`가 WORK 입구로 가고, 대조할 수 없으면 exit 2로 막힌다', () => {
  const root = workspace()
  try {
    const run = spawnSync(process.execPath, [join(repo, '.claude/scripts/ticket/cli.mjs'), 'link', '--work', 'PF-101', PR, '--root', root],
      {encoding: 'utf8', env: {PATH: process.env.PATH, HOME: process.env.HOME}, timeout: 30000})
    const result = JSON.parse(run.stdout)
    assert.equal(result.mode, 'work', `--work가 WORK 입구로 가지 않았다: ${run.stdout}${run.stderr}`)
    assert.equal(result.blocked, 'stale-check-unavailable')
    assert.equal(run.status, 2)
    assert.equal(readWorkEvents(join(root, WORK_EVENTS_PATH)).some(event => event.eventType === 'work-linked'), false)
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})

test('기반 작업: 이미 있던 대상을 적어 두고 아무것도 안 하면 완료가 아니다 — 픽업 때 찍은 지문과 같다', async () => {
  const root = workspace()
  try {
    // 브라운필드: 대상 파일이 계획 전부터 있다.
    mkdirSync(join(root, 'src/entities/member'), {recursive: true})
    writeFileSync(join(root, 'src/entities/member/api.ts'), 'export type Member = {id: string}\n')
    const digest = projectRefDigest(root)
    const scope = buildWorkChangeScope({issue: {ticketKey: 'PF-101', provider: 'jira', title: 't', body: 'b', revision: 'r1'},
      plan, planDigest, work: work(W(1)), featureIds: ['FEAT-001'], testCaseIds: []})
    scope.checks = scope.checks.map(check => ({...check, baseline: Object.fromEntries(check.targetRefs.map(ref => [ref, digest(ref)]))}))
    writeChangeScopeFile(root, scope)
    const untouched = await runWorkLink({root, ticketKey: 'PF-101', prUrl: PR, flags: {base: 'develop'}, io: titled})
    assert.equal(untouched.blocked, 'completion:check-targets-unchanged', JSON.stringify(untouched))
    assert.match(untouched.guidance, /바뀌지 않았다/)
    // 작업이 대상을 바꾸면 통과한다.
    writeFileSync(join(root, 'src/entities/member/api.ts'), 'export type Member = {id: string; name: string}\n')
    const changed = await runWorkLink({root, ticketKey: 'PF-101', prUrl: PR, flags: {base: 'develop'}, io: titled})
    assert.equal(changed.ok, true, JSON.stringify(changed))
    assert.equal(changed.completion.checks.baselineCheck, 'verified')
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})

test('실행부: 픽업이 change-scope에 대상 지문 기준선을 남긴다', async () => {
  const root = workspace()
  try {
    const {runWorkPickup} = await import('./ticket/work-pickup-run.mjs')
    const {buildWorkMarker} = await import('./ticket/work-refs.mjs')
    const {readChangeScopeFile} = await import('./ticket/cli.mjs')
    const {buildWorkDoc, formatWorkDoc} = await import('./ticket/work-ticket-doc.mjs')
    const doc = formatWorkDoc(buildWorkDoc({work: work(W(1))}), 'markdown')
    const issue = {ticketKey: 'PF-101', provider: 'jira', title: 't', revision: 'r1', assignees: [], links: [], comments: [], commentsOmitted: 0,
      body: `${doc}\n\n${buildWorkMarker({planId: plan.planId, workId: W(1), featureIds: ['FEAT-001'], testCaseIds: [], planDigest})}`}
    let assignees = []
    const provider = {name: 'jira', async resolveIssue() { return {...issue, assignees: [...assignees]} },
      async assign(key, who) { assignees = [who] }, async transition() { return {transitioned: true} },
      async comment() { return {ok: true} }, supportedPhases: ['in-progress']}
    const picked = await runWorkPickup({root, ticketKey: 'PF-101', developer: 'me', flags: {}, io: {provider}})
    assert.equal(picked.ok, true, JSON.stringify(picked.bounce ?? picked))
    const scope = readChangeScopeFile(root)
    assert.equal(scope.checks[0].checkId, 'A-1')
    assert.ok(Object.hasOwn(scope.checks[0].baseline, 'src/entities/member/api.ts'), '대상 지문을 찍지 않았다')
    assert.equal(scope.checks[0].baseline['src/entities/member/api.ts'], null, '없는 대상은 null이어야 한다')
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})

test('닫는 줄의 트래커는 발행 원장이 정한다 — 지금 설정이 바뀌어도 따르지 않는다', () => {
  const completion = evaluateWorkCompletion({work: work(W(4)), ownedTestCaseIds: owned(W(4)), citedIds: owned(W(4)), pathExists: everything})
  const decision = planWorkLink({baseRef: 'develop', plan, planDigest, state: published(W(4), {provider: 'jira'}),
    changeScope: {...scopeFor(W(4)), ticket: {...scopeFor(W(4)).ticket, provider: 'github'}}, ticketKey: 'PF-104', prUrl: PR, completion})
  assert.equal(decision.provider, 'jira')
  // 원장이 모르면 대조한 범위의 트래커, 그것도 없으면 모른다(닫는 줄을 만들지 않는다).
  const fromScope = planWorkLink({baseRef: 'develop', plan, planDigest, state: published(W(4)), changeScope: scopeFor(W(4)), ticketKey: 'PF-104', prUrl: PR, completion})
  assert.equal(fromScope.provider, 'jira')
  const unknown = planWorkLink({baseRef: 'develop', plan, planDigest, state: published(W(4)), changeScope: null, ticketKey: 'PF-104', prUrl: PR, completion,
    flags: {'accept-unverified-scope': true}})
  assert.equal(unknown.provider, null)
})

test('STALE: 같은 작업이라도 다른 티켓의 범위면 대조한 것으로 치지 않는다', () => {
  const completion = evaluateWorkCompletion({work: work(W(4)), ownedTestCaseIds: owned(W(4)), citedIds: owned(W(4)), pathExists: everything})
  const other = planWorkLink({baseRef: 'develop', plan, planDigest, state: published(W(4)), changeScope: {...scopeFor(W(4)), ticketKey: 'PF-9'},
    ticketKey: 'PF-104', prUrl: PR, completion})
  assert.equal(other.blocked, 'stale-check-unavailable')
  assert.equal(other.staleCheck, 'not-performed:different-ticket')
})

test('PR 상태 조회 실패는 머지가 아니다 — 조회기가 던지면 오류로 남는다', async () => {
  const states = await resolvePrStates(['https://github.com/o/r/pull/9', 'https://github.com/o/r/pull/10'], {
    exec: async args => { if (args.includes('https://github.com/o/r/pull/9')) throw new Error('gh: auth'); return JSON.stringify({state: 'MERGED'}) }})
  assert.equal(states.get('https://github.com/o/r/pull/9').state, undefined)
  assert.match(states.get('https://github.com/o/r/pull/9').error, /auth/)
  assert.equal(states.get('https://github.com/o/r/pull/10').state, 'MERGED')
})

test('기대 base: 모르면 링크하지 않는다(T18) — 다른 브랜치로의 머지는 기대 base로 묻는 PR 목록에 없다', () => {
  const completion = evaluateWorkCompletion({work: work(W(4)), ownedTestCaseIds: owned(W(4)), citedIds: owned(W(4)), pathExists: everything})
  const unknown = planWorkLink({plan, planDigest, state: published(W(4)), changeScope: scopeFor(W(4)), ticketKey: 'PF-104', prUrl: PR, completion})
  assert.equal(unknown.blocked, 'pr-base-unknown')
  const linked = planWorkLink({baseRef: 'feature/members', plan, planDigest, state: published(W(4)), changeScope: scopeFor(W(4)), ticketKey: 'PF-104', prUrl: PR, completion})
  assert.equal(linked.event.payload.baseRef, 'feature/members')
})

test('실행부: `--base`가 없으면 PR을 읽어 기대 base를 정하고, 못 읽으면 막는다', async () => {
  const root = workspace()
  try {
    writeChangeScopeFile(root, buildWorkChangeScope({issue: {ticketKey: 'PF-101', provider: 'jira', title: 't', body: 'b', revision: 'r1'},
      plan, planDigest, work: work(W(1)), featureIds: ['FEAT-001'], testCaseIds: []}))
    mkdirSync(join(root, 'src/entities/member'), {recursive: true})
    writeFileSync(join(root, 'src/entities/member/api.ts'), 'export type Member = {id: string}\n')
    const unreadable = await runWorkLink({root, ticketKey: 'PF-101', prUrl: PR, flags: {}, io: {prInfo: async () => ({error: 'gh: auth'})}})
    assert.equal(unreadable.blocked, 'pr-base-unknown')
    const fromPr = await runWorkLink({root, ticketKey: 'PF-101', prUrl: PR, flags: {}, io: {prInfo: async () => ({state: 'OPEN', baseRefName: 'feature/members', title: '[PF-101] 회원 API'})}})
    assert.equal(fromPr.ok, true, JSON.stringify(fromPr))
    assert.equal(linkRecord(root, 'PF-101').baseRef, 'feature/members')
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})

test('기대 base 없이 남은 옛 링크는 같은 PR에 한해 `--base`로 다시 기록한다 — 다른 PR은 여전히 멱등', () => {
  const completion = evaluateWorkCompletion({work: work(W(4)), ownedTestCaseIds: owned(W(4)), citedIds: owned(W(4)), pathExists: everything})
  const oldLink = published(W(4), {link: {prUrl: PR}})
  const relinked = planWorkLink({baseRef: 'feature/members', plan, planDigest, state: oldLink, changeScope: scopeFor(W(4)), ticketKey: 'PF-104', prUrl: PR, completion})
  assert.equal(relinked.ok, true)
  assert.equal(relinked.idempotent, undefined, '옛 링크를 멱등으로 돌려 기대 base를 영원히 못 남긴다')
  assert.equal(relinked.event.payload.baseRef, 'feature/members')
  const otherPr = planWorkLink({baseRef: 'feature/members', plan, planDigest, state: oldLink, changeScope: scopeFor(W(4)), ticketKey: 'PF-104', prUrl: 'https://github.com/acme/web/pull/77', completion})
  assert.equal(otherPr.idempotent, true)
})

test('PR URL은 정규형만 받고, base의 refs/heads·origin 접두는 떼어 기록한다', () => {
  const completion = evaluateWorkCompletion({work: work(W(4)), ownedTestCaseIds: owned(W(4)), citedIds: owned(W(4)), pathExists: everything})
  const base = {plan, planDigest, state: published(W(4)), changeScope: scopeFor(W(4)), ticketKey: 'PF-104', completion}
  assert.equal(planWorkLink({...base, baseRef: 'develop', prUrl: `${PR}/files`}).blocked, 'pr-url-required')
  assert.equal(planWorkLink({...base, baseRef: 'origin/feature/members', prUrl: PR}).event.payload.baseRef, 'feature/members')
  assert.equal(planWorkLink({...base, baseRef: 'refs/heads/main', prUrl: PR}).event.payload.baseRef, 'main')
})

test('형상 규율: 하네스 산출물(_workspace)과 코드가 한 커밋에 섞였으면 그 커밋을 짚는다', () => {
  const log = [
    '@@commit a1b2c3d 정지 회원 표시', 'src/members/MemberList.tsx', 'tests/members.test.tsx', '',
    '@@commit d4e5f60 원장: 작업 연결', '_workspace/03_dev/work-item-events.jsonl', '',
    '@@commit 0f9e8d7 한꺼번에 올림', 'src/members/api.ts', '_workspace/04_qa/qa-code.md', '',
  ].join('\n')
  const result = findMixedCommits(log)
  assert.equal(result.commits, 3)
  assert.deepEqual(result.mixed, [{commit: '0f9e8d7', subject: '한꺼번에 올림'}], '코드만·산출물만인 커밋을 섞였다고 했거나 섞인 커밋을 놓쳤다')
  assert.deepEqual(findMixedCommits('').mixed, [])
  // 특수 문자로 따옴표가 붙은 산출물 경로도 산출물이다 — 산출물만 담은 커밋을 섞였다고 하지 않는다.
  const quoted = ['@@commit 1a2b3c4 QA 보고', '"_workspace/04_qa/qa \\"final\\".md"', '_workspace/04_qa/qa-code.md', ''].join('\n')
  assert.deepEqual(findMixedCommits(quoted).mixed, [], '따옴표 붙은 산출물 경로를 코드로 읽었다')
})


test('PR 완료 기준(티켓 없는 라운드): 번호·문장·검증 테스트로 싣고 내부 ID는 빼며, 문장은 자르지 않고 15개를 넘으면 「외 N개」', async () => {
  const {renderRoundCriteria} = await import('./ticket/work-link.mjs')
  assert.deepEqual(renderRoundCriteria('기준 없음'), [])
  const long = '가'.repeat(200)
  const many = Array.from({length: 17}, (_, index) => `- ACC-R3-${index + 1} ${index === 0 ? long : `조건 ${index + 1}이면 결과가 보인다`} · LOCAL_VERIFIABLE — TT-R3-${index + 1}`).join('\n')
  const lines = renderRoundCriteria(`${many}\n- ACC-R3-2 배포한 화면에서 쿠키가 유지된다 · DEPLOY_ONLY — TT-R3-2, TT-R3-20\n`)
  assert.equal(lines[0], '완료 기준(라운드 3, 승인 단계에서 확인, 17개):')
  assert.equal(lines[1], `1. ${long} — 검증 테스트 TT-R3-1`, '200자 문장을 잘랐거나 형식이 다르다')
  assert.equal(lines[2], '2. 배포한 화면에서 쿠키가 유지된다 (배포 환경에서만 확인할 수 있다) — 검증 테스트 TT-R3-2, TT-R3-20',
    '같은 ID의 마지막 정의·배포 전용 안내·검증 테스트를 싣지 않았다')
  assert.ok(!lines.join('\n').includes('ACC-'), '내부 ID(ACC-)를 PR 본문에 실었다 — 개발자가 따라갈 곳이 없다')
  assert.equal(lines.at(-2), '- … 외 2개')
  assert.match(lines.at(-1), /테스트 ID\(TT-…\)로 저장소를 검색하면/)
})

test('PR 완료 기준(티켓 작업): 완료 조건 문장과 검증 테스트를 싣고, 대상이 없는 조건·인용 안 된 테스트는 ✗', async () => {
  const {renderWorkCriteria} = await import('./ticket/work-link.mjs')
  const work = {checks: [{checkId: 'ACC-1', expectedOutcome: '내 예약 목록에서 「연장」으로 끝 시각을 1시간 늘린다.'},
    {checkId: 'ACC-2', expectedOutcome: '다른 사람의 예약 연장은 서버가 403으로 거부한다.'}],
  testCases: [{id: 'TT-AOA-1-1', text: '연장하면 끝 시각이 1시간 늘어난다'}, {id: 'TT-AOA-1-2', text: '남의 예약은 403'}]}
  const completion = {checks: {missing: [{checkId: 'ACC-2', missingRefs: ['src/api.ts']}]}, testCases: {cited: ['TT-AOA-1-1'], missing: ['TT-AOA-1-2']}}
  const lines = renderWorkCriteria({work, completion: {...completion, checks: {...completion.checks, baselineCheck: 'verified'}}, label: '티켓 AOA-1'})
  assert.deepEqual(lines.slice(0, 6), ['완료 조건(티켓 AOA-1, 2개 중 1개 대상 파일 변경 확인):',
    '1. 내 예약 목록에서 「연장」으로 끝 시각을 1시간 늘린다.', '2. ✗ (src/api.ts) 다른 사람의 예약 연장은 서버가 403으로 거부한다.',
    '검증 테스트(2개 중 1개의 ID가 코드에 인용됨 — 테스트 파일 여부는 미확인):', '- ✓ TT-AOA-1-1 연장하면 끝 시각이 1시간 늘어난다', '- ✗ TT-AOA-1-2 남의 예약은 403'])
  assert.ok(!lines.join('\n').includes('ACC-'), '내부 ID(ACC-)를 실었다')
  // 픽업 기준선이 없으면 「변경 확인」이라 쓰지 않는다 — 대상 경로가 있는지만 봤다
  assert.match(renderWorkCriteria({work, completion, label: '티켓 AOA-1'})[0], /대상 경로 존재 확인 — 픽업 기준선이 없어 변경 여부는 미확인/)
  assert.match(renderWorkCriteria({work, completion, label: 'ticket AOA-1', lang: 'en'}).join('\n'), /\(no target path\)|src\/api\.ts/)
})

test('PR 완료 기준(라운드): 가장 최근 라운드만 싣고, 하이픈·괄호 TT 표기도 뽑고, 테스트 매핑이 없으면 「검증 테스트 미지정」', async () => {
  const {renderRoundCriteria} = await import('./ticket/work-link.mjs')
  const lines = renderRoundCriteria(['- ACC-R1-1 지난 라운드 기준이다 · LOCAL_VERIFIABLE — TT-R1-1',
    '- ACC-R2-1 목록에서 끝 시각이 보인다 · LOCAL_VERIFIABLE - TT-R2-1',
    '- ACC-R2-2 실패하면 오류를 알린다 (TT-R2-2) · LOCAL_VERIFIABLE',
    '- ACC-R2-3 포커스가 제목으로 간다 · LOCAL_VERIFIABLE'].join('\n'))
  assert.equal(lines[0], '완료 기준(라운드 2, 승인 단계에서 확인, 3개):', '지난 라운드 기준까지 실었다')
  assert.deepEqual(lines.slice(1, 4), ['1. 목록에서 끝 시각이 보인다 — 검증 테스트 TT-R2-1', '2. 실패하면 오류를 알린다 — 검증 테스트 TT-R2-2',
    '3. 포커스가 제목으로 간다 — 검증 테스트 미지정'])
  assert.ok(!lines.join('\n').includes('LOCAL_VERIFIABLE'), '내부 검증 표시가 PR 본문에 샜다')
})
