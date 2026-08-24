// 통합 빌드 증분 5 회귀 — executor CLI 게이트 경로(주입 io, 실 gh/git 없음).
//
// 고정: (1) claim — origin 미동기 fail-closed(발행 미도달)·미confirm은 dry-run·confirm 순서
// 발행, (2) pickup — 미청구/준비 게이트 차단·TOCTOU 재조회 양보·사후 다중배정 감지·성공 시
// change-scope.md 발급, (3) link — STALE 차단·멱등·verified closeLine, (4) 원장 rebind 가드.
import assert from 'node:assert/strict'
import test from 'node:test'
import {mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {parseArgs, runClaim, runPickup, runLink, readChangeScopeFile, LEDGER_RELATIVE, CHANGE_SCOPE_RELATIVE} from './ticket/cli.mjs'
import {appendClaimRecord, appendLedgerRecord, readLedger} from './ticket/ledger-writer.mjs'
import {buildIssueFields} from './ticket/provider-github.mjs'
import {buildTicketDraft, unitContentHash} from './ticket/emit.mjs'

const unit = {featureId: 'FEAT-001', title: '모터 상세', body: '상세 표시', testCaseIds: ['TC-001-1'], type: 'feature'}
const tmpRoot = () => mkdtempSync(join(tmpdir(), 'wh-cli-'))
const withUnits = dir => {
  const path = join(dir, 'units.json')
  writeFileSync(path, JSON.stringify([unit]))
  return path
}
const seedClaim = (dir, extra = {}) => {
  mkdirSync(join(dir, '_workspace', '03_dev'), {recursive: true})
  appendLedgerRecord(join(dir, LEDGER_RELATIVE), {featureId: 'FEAT-001', ticketKey: '7', contentHash: unitContentHash(unit), createdAt: 't', branch: 'feature/dash', ...extra})
}
const issueBody = buildIssueFields(buildTicketDraft(unit), {branch: 'feature/dash'}).body

test('parseArgs: 명령·위치·플래그', () => {
  assert.deepEqual(parseArgs(['pickup', 'FEAT-001', '--developer', 'me', '--confirm']),
    {command: 'pickup', positional: ['FEAT-001'], flags: {developer: 'me', confirm: true}})
})

test('runClaim: origin 미동기 fail-closed(발행 미도달) · dry-run · confirm 발행', async () => {
  const dir = tmpRoot()
  try {
    const units = withUnits(dir)
    let providerTouched = false
    const base = {
      root: dir, repo: 'o/r',
      io: {
        currentBranch: async () => 'feature/dash',
        permission: async () => 'write',
        provider: {findByLabel: async () => { providerTouched = true; return null }, createIssue: async () => { providerTouched = true; return {number: 7, url: 'https://x/issues/7'} }},
      },
    }
    // 점 1 미충족 → 차단, provider 미호출(fail-closed)
    const blocked = await runClaim({...base, flags: {units, confirm: true}, io: {...base.io, originSync: async () => ({originExists: true, planMatchesOrigin: false, base: 'origin/feature/dash'})}})
    assert.equal(blocked.ok, false)
    assert.equal(blocked.blocked, 'local-plan-not-pushed')
    assert.equal(providerTouched, false)
    // 동기 OK + confirm 없음 → dry-run(발행 0)
    const okIo = {...base.io, originSync: async () => ({originExists: true, planMatchesOrigin: true, base: 'origin/feature/dash'})}
    const dry = await runClaim({...base, flags: {units}, io: okIo})
    assert.equal(dry.dryRun, true)
    assert.equal(providerTouched, false)
    // confirm → 발행 + 원장 append(브랜치 스탬프)
    const done = await runClaim({...base, flags: {units, confirm: true}, io: okIo})
    assert.equal(done.dryRun, false)
    assert.equal(done.results[0].claimed, true)
    const entries = readLedger(join(dir, LEDGER_RELATIVE))
    assert.equal(entries[0].branch, 'feature/dash')
  } finally { rmSync(dir, {recursive: true, force: true}) }
})

test('runPickup: 미청구·준비 게이트 차단 · TOCTOU 양보 · 다중배정 감지 · 성공 발급', async () => {
  const dir = tmpRoot()
  try {
    const units = withUnits(dir)
    const flags = {units, confirm: true}
    // 미청구 → 차단
    const none = await runPickup({root: dir, repo: 'o/r', featureId: 'FEAT-001', developer: 'me', flags})
    assert.equal(none.bounce.reason, 'not-claimed')
    seedClaim(dir)
    const cleanIo = {currentBranch: async () => 'feature/dash', worktree: async () => ({dirty: false, conflicted: false})}
    // 브랜치 불일치(점 2) → 차단
    const wrongBranch = await runPickup({root: dir, repo: 'o/r', featureId: 'FEAT-001', developer: 'me', flags,
      io: {...cleanIo, currentBranch: async () => 'main'}})
    assert.equal(wrongBranch.bounce.reason, 'branch-mismatch')
    // TOCTOU: 최초 조회는 미배정, 재조회에서 남이 선점 → 양보(assign 미실행)
    let ghCalls = 0
    const resolveSeq = [{number: 7, title: 't', body: issueBody, assignees: []}, {number: 7, title: 't', body: issueBody, assignees: ['other']}]
    const yielded = await runPickup({root: dir, repo: 'o/r', featureId: 'FEAT-001', developer: 'me', flags,
      io: {...cleanIo, resolveIssue: async () => resolveSeq.shift(), gh: async () => { ghCalls++; return '' }}})
    assert.equal(yielded.ok, false)
    assert.equal(yielded.bounce.reason, 'assigned-to-other')
    assert.equal(ghCalls, 0) // assign 미도달
    // 사후 다중배정 감지 → 정직 경고(자동 판정 안 함)
    const multiSeq = [
      {number: 7, title: 't', body: issueBody, assignees: []},
      {number: 7, title: 't', body: issueBody, assignees: []},
      {number: 7, title: 't', body: issueBody, assignees: ['me', 'other']},
    ]
    const multi = await runPickup({root: dir, repo: 'o/r', featureId: 'FEAT-001', developer: 'me', flags,
      io: {...cleanIo, resolveIssue: async () => multiSeq.shift(), gh: async () => ''}})
    assert.equal(multi.bounce.reason, 'multi-assign-detected')
    // 성공 — self-assign 1회 + change-scope.md 발급
    const okSeq = [
      {number: 7, title: 't', body: issueBody, assignees: []},
      {number: 7, title: 't', body: issueBody, assignees: []},
      {number: 7, title: 't', body: issueBody, assignees: ['me']},
    ]
    const done = await runPickup({root: dir, repo: 'o/r', featureId: 'FEAT-001', developer: 'me', flags,
      io: {...cleanIo, resolveIssue: async () => okSeq.shift(), gh: async args => { assert.deepEqual(args.slice(0, 3), ['issue', 'edit', '7']); return '' }}})
    assert.equal(done.ok, true)
    assert.ok(existsSync(join(dir, CHANGE_SCOPE_RELATIVE)))
    assert.equal(readChangeScopeFile(dir).featureId, 'FEAT-001') // fenced JSON 왕복
  } finally { rmSync(dir, {recursive: true, force: true}) }
})

test('runLink: STALE 차단 · verified closeLine · 멱등 · confirm append', async () => {
  const dir = tmpRoot()
  try {
    const units = withUnits(dir)
    seedClaim(dir)
    // change-scope가 현재 단위와 일치(신선) → 진행, verified Closes
    const {buildChangeScope} = await import('./ticket/pickup.mjs')
    const {writeChangeScopeFile} = await import('./ticket/cli.mjs')
    writeChangeScopeFile(dir, buildChangeScope({issue: {number: 7, title: 't', body: 'x'}, unit, testCaseIds: ['TC-001-1']}))
    const dry = await runLink({root: dir, featureId: 'FEAT-001', prUrl: 'https://x/pull/9', flags: {units}})
    assert.equal(dry.dryRun, true)
    assert.match(dry.closeLine, /Closes #7/) // 원장 대조 verified
    const done = await runLink({root: dir, featureId: 'FEAT-001', prUrl: 'https://x/pull/9', flags: {units, confirm: true}})
    assert.equal(done.dryRun, false)
    // 멱등 — 재링크 금지
    const again = await runLink({root: dir, featureId: 'FEAT-001', prUrl: 'https://x/pull/10', flags: {units, confirm: true}})
    assert.equal(again.idempotent, true)
    assert.equal(again.existing, 'https://x/pull/9')
    // STALE(계획 변경) → 완료 차단
    writeFileSync(join(dir, 'units.json'), JSON.stringify([{...unit, body: '명세 변경'}]))
    rmSync(join(dir, LEDGER_RELATIVE)) // 새 시나리오용 초기화
    seedClaim(dir)
    const stale = await runLink({root: dir, featureId: 'FEAT-001', prUrl: 'https://x/pull/9', flags: {units}})
    assert.equal(stale.blocked, 'stale-change-scope')
    assert.equal(stale.staleCheck, 'stale')
    // 대조 미수행은 침묵 스킵이 아니다(리뷰 HIGH fail-open 금지): change-scope 부재 + confirm → 차단
    rmSync(join(dir, CHANGE_SCOPE_RELATIVE))
    const unavailable = await runLink({root: dir, featureId: 'FEAT-001', prUrl: 'https://x/pull/9', flags: {units, confirm: true}})
    assert.equal(unavailable.blocked, 'stale-check-unavailable')
    assert.match(unavailable.staleCheck, /not-performed/)
    // 명시 인수(--accept-unverified-scope)만 통과 — staleCheck 정직 표기 유지
    const accepted = await runLink({root: dir, featureId: 'FEAT-001', prUrl: 'https://x/pull/9', flags: {units, confirm: true, 'accept-unverified-scope': true}})
    assert.equal(accepted.ok, true)
    assert.match(accepted.staleCheck, /not-performed/)
  } finally { rmSync(dir, {recursive: true, force: true}) }
})

test('runClaim: 권한 차단은 부분 성공이 아니라 ok:false(exit 2 정렬) + 내역 보존', async () => {
  const dir = tmpRoot()
  try {
    const units = withUnits(dir)
    const blocked = await runClaim({
      root: dir, repo: 'o/r', flags: {units, confirm: true},
      io: {
        currentBranch: async () => 'feature/dash',
        originSync: async () => ({originExists: true, planMatchesOrigin: true, base: 'origin/feature/dash'}),
        permission: async () => 'read', // 이슈 생성 불가 등급 → runner가 blocked 반환
        provider: {findByLabel: async () => null, createIssue: async () => { throw new Error('도달하면 안 됨') }},
      },
    })
    assert.equal(blocked.ok, false)                       // 기계 신호 정렬(exit 2 방향)
    assert.match(blocked.blocked, /^claim-blocked:/)
    assert.equal(blocked.results.length, 1)               // 차단 내역 보존(유실 없음)
    assert.equal(blocked.results[0].blocked, true)
  } finally { rmSync(dir, {recursive: true, force: true}) }
})

test('runPickup: 다른 FEAT의 활성 change-scope 침묵 덮어쓰기 금지(--replace-scope 명시만)', async () => {
  const dir = tmpRoot()
  try {
    const units = withUnits(dir)
    seedClaim(dir)
    const {writeChangeScopeFile} = await import('./ticket/cli.mjs')
    writeChangeScopeFile(dir, {featureId: 'FEAT-002', ticketKey: '9', sourceDigest: 'x'}) // 진행 중인 다른 FEAT
    const okSeq = () => {
      const seq = [
        {number: 7, title: 't', body: issueBody, assignees: []},
        {number: 7, title: 't', body: issueBody, assignees: []},
        {number: 7, title: 't', body: issueBody, assignees: ['me']},
      ]
      return async () => seq.shift()
    }
    const cleanIo = {currentBranch: async () => 'feature/dash', worktree: async () => ({dirty: false, conflicted: false}), gh: async () => ''}
    const guarded = await runPickup({root: dir, repo: 'o/r', featureId: 'FEAT-001', developer: 'me', flags: {units, confirm: true}, io: {...cleanIo, resolveIssue: okSeq()}})
    assert.equal(guarded.ok, false)
    assert.equal(guarded.bounce.reason, 'active-change-scope')
    assert.equal(guarded.bounce.activeFeatureId, 'FEAT-002')
    assert.equal(readChangeScopeFile(dir).featureId, 'FEAT-002') // 미덮어씀
    const replaced = await runPickup({root: dir, repo: 'o/r', featureId: 'FEAT-001', developer: 'me', flags: {units, confirm: true, 'replace-scope': true}, io: {...cleanIo, resolveIssue: okSeq()}})
    assert.equal(replaced.ok, true)
    assert.equal(readChangeScopeFile(dir).featureId, 'FEAT-001') // 명시 교체만 허용
  } finally { rmSync(dir, {recursive: true, force: true}) }
})

test('appendClaimRecord: 최초 digest 불일치 재청구 REBIND_REFUSED(§4 가드 배선)', () => {
  const dir = tmpRoot()
  try {
    const path = join(dir, 'ledger.jsonl')
    appendClaimRecord(path, {featureId: 'FEAT-001', ticketKey: '7', contentHash: 'aaaa', createdAt: 't'})
    assert.throws(() => appendClaimRecord(path, {featureId: 'FEAT-001', ticketKey: '8', contentHash: 'bbbb', createdAt: 't'}), /LEDGER_REBIND_REFUSED/)
    // 같은 digest 재append(멱등 경로)·비가드 append(링크)는 허용
    appendClaimRecord(path, {featureId: 'FEAT-001', ticketKey: '7', contentHash: 'aaaa', createdAt: 't2'})
    appendLedgerRecord(path, {featureId: 'FEAT-001', ticketKey: '7', contentHash: 'bbbb', createdAt: 't3', prUrl: 'https://x/pull/1'})
  } finally { rmSync(dir, {recursive: true, force: true}) }
})
