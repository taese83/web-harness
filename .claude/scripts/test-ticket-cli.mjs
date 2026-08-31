// 통합 빌드 증분 5 회귀 — executor CLI 게이트 경로(주입 io, 실 gh/git 없음).
//
// 고정: (1) claim — origin 미동기 fail-closed(발행 미도달)·미confirm은 dry-run·confirm 순서
// 발행, (2) pickup — 미청구/준비 게이트 차단·TOCTOU 재조회 양보·사후 다중배정 감지·성공 시
// change-scope.md 발급, (3) link — STALE 차단·멱등·verified closeLine, (4) 원장 rebind 가드.
import assert from 'node:assert/strict'
import test from 'node:test'
import {mkdtempSync, readFileSync, mkdirSync, rmSync, writeFileSync, existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {parseArgs, runClaim, runBoard, runPickup, runLink, readChangeScopeFile, resolvePlanLocation, loadUnits, LEDGER_RELATIVE, CHANGE_SCOPE_RELATIVE, PLAN_RELATIVE, PLAN_DIR_RELATIVE} from './ticket/cli.mjs'
import {appendClaimRecord, appendLedgerRecord, readLedger} from './ticket/ledger-writer.mjs'
import {buildIssueFields} from './ticket/provider-github.mjs'
import {buildTicketDraft, unitContentHash} from './ticket/emit.mjs'
import {fileURLToPath} from 'node:url'

const unit = {featureId: 'FEAT-001', title: '모터 상세', body: '상세 표시', testCaseIds: ['TC-001-1'], type: 'feature', dependsOn: [], paths: ['src/features/dash/']}
const ASSETS_DIR = fileURLToPath(new URL('../skills/team-flow/assets/', import.meta.url))
const tmpRoot = () => mkdtempSync(join(tmpdir(), 'wh-cli-'))
// unit 픽스처는 **의존을 명시적으로 선언**한다(`dependsOn: []`). 미선언은 "없음"이 아니라
// "선언 안 함"이라 pickup이 막히는데(2026-08-30 신설), 그것은 아래 전용 테스트가 따로 잰다.
const withUnits = dir => {
  const path = join(dir, 'units.json')
  writeFileSync(path, JSON.stringify([unit]))
  return path
}
// 골든 경로는 완료 게이트를 **실제로 통과해야** 한다 — 통과하지 못하자 탈출 플래그를
// 뿌린 것이 2026-08-30 리뷰의 HIGH였다. 청구 시드는 그 단위의 TC를 인용하는 소스를 함께
// 둔다(실제 개발이 그러하듯이).
const seedClaim = (dir, extra = {}) => {
  mkdirSync(join(dir, '_workspace', '03_dev'), {recursive: true})
  mkdirSync(join(dir, 'src', 'features', 'dash'), {recursive: true})
  writeFileSync(join(dir, 'src/features/dash/detail.test.ts'), "it('TC-001-1 상세를 표시한다', () => {})")
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

test('runLink: STALE 차단 · verified closeLine · 멱등 · 기본 실행', async () => {
  const dir = tmpRoot()
  try {
    const units = withUnits(dir)
    seedClaim(dir)
    // change-scope가 현재 단위와 일치(신선) → 진행, verified Closes
    const {buildChangeScope} = await import('./ticket/pickup.mjs')
    const {writeChangeScopeFile} = await import('./ticket/cli.mjs')
    writeChangeScopeFile(dir, buildChangeScope({issue: {number: 7, title: 't', body: 'x'}, unit, testCaseIds: ['TC-001-1']}))
    // 개발 단계 명령은 **기본 실행**이다 — 미리보기는 명시적으로 요청한다(2026-08-30).
    const dry = await runLink({root: dir, featureId: 'FEAT-001', prUrl: 'https://x/pull/9', flags: {units, 'dry-run': true}})
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
    // 인수 사실이 **원장에 남는다** — 사후에 verified와 구별되지 않으면 휘발성 주장이다.
    assert.equal(accepted.record.acceptedUnverifiedScope, true)
    assert.match(accepted.record.staleCheck, /not-performed/)
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

// sharding 계약 — feature-plan은 flat(.md) 또는 디렉터리 두 형태다. 종전에는 flat만 찾아
// sharded 프로젝트에서 units 로딩과 origin 게이트가 함께 무너졌다(origin에 푸시돼 있는데도
// "푸시하세요"라는 오탐 안내 — 사용자 실측 보고).
const writePlanDir = (dir, files) => {
  mkdirSync(join(dir, PLAN_DIR_RELATIVE), {recursive: true})
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, PLAN_DIR_RELATIVE, name), body)
}

test('resolvePlanLocation: flat 우선, 없으면 sharded 디렉터리, 둘 다 없으면 null', () => {
  const dir = tmpRoot()
  try {
    assert.equal(resolvePlanLocation(dir), null)

    writePlanDir(dir, {'specs-a.md': '## FEAT-001 A\n- TC-001-1: a\n'})
    const sharded = resolvePlanLocation(dir)
    assert.equal(sharded.kind, 'sharded')
    assert.equal(sharded.relative, PLAN_DIR_RELATIVE)
    assert.deepEqual(sharded.shards, [`${PLAN_DIR_RELATIVE}/specs-a.md`])

    // flat이 함께 있으면 flat이 이긴다(기존 동작 보존).
    mkdirSync(join(dir, '_workspace', '01_plan'), {recursive: true})
    writeFileSync(join(dir, PLAN_RELATIVE), '## FEAT-009 Flat\n')
    const flat = resolvePlanLocation(dir)
    assert.equal(flat.kind, 'flat')
    assert.deepEqual(flat.shards, [PLAN_RELATIVE])
  } finally { rmSync(dir, {recursive: true, force: true}) }
})

test('loadUnits: 샤드를 각각 파싱해 이어붙이고, 중복 FEAT는 병합하지 않는다', () => {
  const dir = tmpRoot()
  try {
    writePlanDir(dir, {
      'INDEX.md': '| 절 | 파일 |\n|---|---|\n',                       // 표 형식 → 0 unit
      'specs-b.md': '## FEAT-002 B\n- TC-002-1: b\n',
      'specs-a.md': '## FEAT-001 A\n- TC-001-1: a\n',
      'specs-dup.md': '## FEAT-001 A again\n- TC-001-2: a2\n',
    })
    const units = loadUnits(dir, {})
    // 파일명 정렬 순서: INDEX, specs-a, specs-b, specs-dup
    assert.deepEqual(units.map(u => u.featureId), ['FEAT-001', 'FEAT-002', 'FEAT-001'])
    assert.deepEqual(units[0].testCaseIds, ['TC-001-1'])
    assert.deepEqual(units[2].testCaseIds, ['TC-001-2'])
  } finally { rmSync(dir, {recursive: true, force: true}) }
})

test('loadUnits: 계획이 아예 없으면 두 경로를 모두 알리며 실패', () => {
  const dir = tmpRoot()
  try {
    assert.throws(() => loadUnits(dir, {}), error =>
      /MISSING_PLAN/.test(error.message) && error.message.includes(PLAN_RELATIVE) && error.message.includes(PLAN_DIR_RELATIVE))
  } finally { rmSync(dir, {recursive: true, force: true}) }
})

test('runClaim: sharded 계획에서도 origin 게이트가 디렉터리 경로로 판정한다', async () => {
  const dir = tmpRoot()
  try {
    writePlanDir(dir, {'specs-a.md': '## FEAT-001 A\n- TC-001-1: a\n'})
    const seen = []
    const originSync = async ({planPath}) => { seen.push(planPath); return {originExists: true, planMatchesOrigin: true, base: 'origin/main'} }
    const result = await runClaim({root: dir, repo: 'o/r', flags: {}, io: {originSync, currentBranch: async () => 'feature/x'}})
    assert.deepEqual(seen, [PLAN_DIR_RELATIVE])   // flat이 아니라 디렉터리를 봤다
    assert.equal(result.ok, true)
    assert.equal(result.dryRun, true)             // confirm 없으면 발행하지 않는다
    assert.match(result.preview, /FEAT-001/)
  } finally { rmSync(dir, {recursive: true, force: true}) }
})

// origin 신선도 — git-origin이 "판정 전 fetch를 선행하거나 스냅샷 기준임을 표기하라"고
// 경고하면서 배선을 미뤄뒀고, 실제로는 claim·pickup·board 어디에도 fetch가 없었다.
// 이제 둘 다 한다: 갱신을 시도하고, 실패하면 스냅샷 기준임을 응답에 표기한다.
test('claim: origin 판정 전에 remote-tracking을 갱신하고 기준을 표기한다', async () => {
  const dir = tmpRoot()
  try {
    const order = []
    const io = {
      refresh: async () => { order.push('fetch'); return {ok: true, reason: null} },
      originSync: async () => { order.push('judge'); return {originExists: true, planMatchesOrigin: true, base: 'origin/main'} },
      currentBranch: async () => 'feature/dash',
    }
    const result = await runClaim({root: dir, repo: 'o/r', flags: {units: withUnits(dir)}, io})
    assert.deepEqual(order, ['fetch', 'judge'])          // 갱신이 판정보다 앞선다
    assert.deepEqual(result.freshness, {fetched: true, basis: 'origin'})
  } finally { rmSync(dir, {recursive: true, force: true}) }
})

test('claim: fetch 실패는 판정을 막지 않고 스냅샷 기준으로 표기된다', async () => {
  const dir = tmpRoot()
  try {
    const io = {
      refresh: async () => ({ok: false, reason: 'network unreachable'}),
      originSync: async () => ({originExists: true, planMatchesOrigin: true, base: 'origin/main'}),
      currentBranch: async () => 'feature/dash',
    }
    const result = await runClaim({root: dir, repo: 'o/r', flags: {units: withUnits(dir)}, io})
    assert.equal(result.ok, true)                        // 네트워크 없어도 미리보기는 된다
    assert.equal(result.freshness.fetched, false)
    assert.equal(result.freshness.basis, 'local-snapshot')
    assert.equal(result.freshness.reason, 'network unreachable')
  } finally { rmSync(dir, {recursive: true, force: true}) }
})

test('claim: --no-fetch면 갱신을 시도하지 않고 그 사실을 표기한다', async () => {
  const dir = tmpRoot()
  try {
    let attempted = false
    const io = {
      refresh: async () => { attempted = true; return {ok: true, reason: null} },
      originSync: async () => ({originExists: true, planMatchesOrigin: true, base: 'origin/main'}),
      currentBranch: async () => 'feature/dash',
    }
    const result = await runClaim({root: dir, repo: 'o/r', flags: {units: withUnits(dir), 'no-fetch': true}, io})
    assert.equal(attempted, false)
    assert.equal(result.freshness.basis, 'local-snapshot')
    assert.match(result.freshness.reason, /no-fetch/)
  } finally { rmSync(dir, {recursive: true, force: true}) }
})

test('board: merged 판정 전에도 갱신한다', async () => {
  const dir = tmpRoot()
  try {
    const order = []
    const io = {
      refresh: async () => { order.push('fetch'); return {ok: true, reason: null} },
      merged: async () => { order.push('merged'); return [] },
      issues: async () => [],
      currentBranch: async () => 'feature/dash',
    }
    const result = await runBoard({root: dir, repo: 'o/r', developer: null, flags: {units: withUnits(dir)}, io})
    assert.equal(order[0], 'fetch')
    assert.deepEqual(result.freshness, {fetched: true, basis: 'origin'})
  } finally { rmSync(dir, {recursive: true, force: true}) }
})

// 티켓 이슈 자동 닫기 자산 설치 — claim이 청구 브랜치에 놓는다. 멱등이고 덮어쓰지 않는다.
test('claim: 이슈 자동 닫기 자산을 설치하되 기존 사본은 덮지 않는다', async () => {
  const dir = tmpRoot()
  try {
    const io = {
      refresh: async () => ({ok: true, reason: null}),
      originSync: async () => ({originExists: true, planMatchesOrigin: true, base: 'origin/main'}),
      currentBranch: async () => 'feature/dash',
      permission: async () => 'write',
      provider: {findByLabel: async () => null, ensureLabel: async () => {}, createIssue: async () => ({number: 7, url: 'https://x/issues/7'})},
    }
    const flags = {units: withUnits(dir), confirm: true}

    const dry = await runClaim({root: dir, repo: 'o/r', flags: {units: flags.units}, io})
    assert.deepEqual(dry.closeAssets.install.map(e => e.target),
      ['.github/workflows/ticket-close.yml', '.github/scripts/close-merged-tickets.mjs'])
    assert.equal(existsSync(join(dir, '.github/workflows/ticket-close.yml')), false)  // dry-run은 쓰지 않는다

    const run = await runClaim({root: dir, repo: 'o/r', flags, io})
    assert.deepEqual(run.installedCloseAssets,
      ['.github/workflows/ticket-close.yml', '.github/scripts/close-merged-tickets.mjs'])
    const workflow = readFileSync(join(dir, '.github/workflows/ticket-close.yml'), 'utf8')
    assert.match(workflow, /issues: write/)

    // 손댄 사본은 다시 청구해도 되돌아가지 않는다.
    writeFileSync(join(dir, '.github/workflows/ticket-close.yml'), '# 프로젝트가 손본 사본\n')
    const again = await runClaim({root: dir, repo: 'o/r', flags: {...flags}, io})
    assert.deepEqual(again.installedCloseAssets, [])
    assert.equal(readFileSync(join(dir, '.github/workflows/ticket-close.yml'), 'utf8'), '# 프로젝트가 손본 사본\n')
  } finally { rmSync(dir, {recursive: true, force: true}) }
})

test('설치된 워크플로우는 workflow 보안 검사를 통과한다', async () => {
  const {inspectWorkflowSecurity} = await import('./validators/validate-workflows-and-evals.mjs')
  const source = readFileSync(join(ASSETS_DIR, 'ticket-close.yml'), 'utf8')
  const findings = inspectWorkflowSecurity({source, workflowPath: '.github/workflows/ticket-close.yml', trustedPromotionActions: []})
  assert.deepEqual(findings.map(f => f.code), [])
})

// ── pickup의 청구 범위 강제 (2026-08-30) ────────────────────────────────────
// 종전에는 board만 강등하고 pickup은 그 판정을 보지 않았다 — 보드가 blocked라고 해도 그대로
// 집을 수 있었다. 강등이 표시일 뿐 게이트가 아니었다.
test('pickup: 의존 미선언이면 막는다 — 보드 강등이 표시로만 끝나지 않는다', async () => {
  const dir = tmpRoot()
  try {
    const undeclared = {featureId: 'FEAT-001', title: 'x', body: 'b', testCaseIds: ['TC-001-1'], type: 'feature'}
    const path = join(dir, 'units.json')
    writeFileSync(path, JSON.stringify([undeclared]))
    seedClaim(dir, {contentHash: unitContentHash(undeclared)})
    const result = await runPickup({
      root: dir, repo: 'o/r', featureId: 'FEAT-001', developer: 'me',
      flags: {units: path, confirm: true},
      io: {currentBranch: async () => 'feature/dash', worktree: async () => ({dirty: false, conflicted: false}), resolveIssue: async () => ({number: 7, title: 't', body: issueBody, assignees: ['me']})},
    })
    assert.equal(result.ok, false)
    assert.equal(result.bounce.reason, 'deps-undeclared')
    assert.match(result.guidance, /dependsOn=none/, '무엇을 하면 풀리는지 말해야 한다')
  } finally { rmSync(dir, {recursive: true, force: true}) }
})

test('pickup: 선행 기능이 안 머지됐으면 막고 무엇을 기다리는지 말한다', async () => {
  const dir = tmpRoot()
  try {
    const dependent = {featureId: 'FEAT-001', title: 'x', body: 'b', testCaseIds: ['TC-001-1'], type: 'feature', dependsOn: ['FEAT-004']}
    const path = join(dir, 'units.json')
    writeFileSync(path, JSON.stringify([dependent]))
    seedClaim(dir, {contentHash: unitContentHash(dependent)})
    const result = await runPickup({
      root: dir, repo: 'o/r', featureId: 'FEAT-001', developer: 'me',
      flags: {units: path, confirm: true},
      io: {currentBranch: async () => 'feature/dash', worktree: async () => ({dirty: false, conflicted: false}), resolveIssue: async () => ({number: 7, title: 't', body: issueBody, assignees: ['me']})},
    })
    assert.equal(result.ok, false)
    assert.equal(result.bounce.reason, 'deps-incomplete')
    assert.deepEqual(result.bounce.unmetDeps, ['FEAT-004'])
    assert.match(result.guidance, /FEAT-004/)
  } finally { rmSync(dir, {recursive: true, force: true}) }
})

// ── 개발 단계는 묻지 않는다 (2026-08-30) ────────────────────────────────────
// pickup은 이미 확정된 것을 실행할 뿐이다 — 게이트가 전부 통과했고, 배정 대상은 요청자
// 자신이며, 되돌릴 수 있다. 여기서 한 번 더 묻는 것은 판단 요구가 아니라 의식이다.
// 확인을 받는 지점은 PR 직전 하나뿐이다(phase-3-development 형상 규율).
test('pickup: --confirm 없이도 실행한다 — 미리보기는 --dry-run으로 명시한다', async () => {
  const dir = tmpRoot()
  try {
    const units = withUnits(dir)
    seedClaim(dir)
    const io = {
      currentBranch: async () => 'feature/dash',
      worktree: async () => ({dirty: false, conflicted: false}),
      resolveIssue: async () => ({number: 7, title: 't', body: issueBody, assignees: ['me']}),
    }
    const run = await runPickup({root: dir, repo: 'o/r', featureId: 'FEAT-001', developer: 'me', flags: {units}, io})
    assert.notEqual(run.dryRun, true, 'confirm을 안 줬다고 미리보기로 빠지면 안 된다')
    assert.ok(existsSync(join(dir, '_workspace/03_dev/change-scope.md')), 'change-scope가 실제로 발급돼야 한다')

    const preview = await runPickup({root: dir, repo: 'o/r', featureId: 'FEAT-001', developer: 'me',
      flags: {units, 'dry-run': true, 'replace-scope': true}, io})
    assert.equal(preview.dryRun, true, '--dry-run은 여전히 미리보기다')
  } finally { rmSync(dir, {recursive: true, force: true}) }
})

// ── 완료 조건 게이트의 **배선** ────────────────────────────────────────────
// 순수 코어(test-ticket-completion.mjs)만 회귀가 있고 main 경로가 0건이면, 이 저장소가 §4에
// 세 번 등록한 클래스가 그대로 재발한다: *배선을 시험하는 회귀가 없으면 배선은 조용히 끊긴다.*
// 아래 셋은 runLink를 실제로 태워 차단·통과·유예를 각각 잰다.
test('runLink 배선: TC가 인용되지 않으면 플래그 없이 차단된다', async () => {
  const dir = tmpRoot()
  try {
    const units = withUnits(dir)
    seedClaim(dir)
    rmSync(join(dir, 'src/features/dash/detail.test.ts')) // 인용을 없앤다
    const {buildChangeScope} = await import('./ticket/pickup.mjs')
    const {writeChangeScopeFile} = await import('./ticket/cli.mjs')
    writeChangeScopeFile(dir, buildChangeScope({issue: {number: 7, title: 't', body: 'x'}, unit, testCaseIds: ['TC-001-1']}))
    const blocked = await runLink({root: dir, featureId: 'FEAT-001', prUrl: 'https://x/pull/9', flags: {units, confirm: true}})
    assert.equal(blocked.ok, false)
    assert.equal(blocked.blocked, 'completion:uncited-test-cases')
    assert.deepEqual(blocked.completion.missing, ['TC-001-1'])
    // 명시 인수만 통과 — 그리고 그 사실이 **원장에 남는다**(휘발성 주장 금지).
    const accepted = await runLink({root: dir, featureId: 'FEAT-001', prUrl: 'https://x/pull/9',
      flags: {units, confirm: true, 'accept-incomplete': true}})
    assert.equal(accepted.ok, true)
    assert.equal(accepted.record.acceptedIncomplete, true)
    assert.deepEqual(accepted.record.completion.missing, ['TC-001-1'])
  } finally { rmSync(dir, {recursive: true, force: true}) }
})

test('runLink 배선: 계획이 유예한 TC는 플래그 없이 통과하고 유예로 보고된다', async () => {
  const dir = tmpRoot()
  try {
    const deferredUnit = {...unit, testCaseIds: ['TC-001-1', 'TC-001-2'],
      body: '상세 표시\n- TC-001-2: 실기기 필요. [유예: 장비 확보 전까지]'}
    const units = join(dir, 'units.json')
    mkdirSync(dir, {recursive: true})
    writeFileSync(units, JSON.stringify([deferredUnit]))
    mkdirSync(join(dir, '_workspace', '03_dev'), {recursive: true})
    mkdirSync(join(dir, 'src', 'features', 'dash'), {recursive: true})
    writeFileSync(join(dir, 'src/features/dash/detail.test.ts'), "it('TC-001-1', () => {})")
    appendLedgerRecord(join(dir, LEDGER_RELATIVE), {featureId: 'FEAT-001', ticketKey: '7',
      contentHash: unitContentHash(deferredUnit), createdAt: 't', branch: 'feature/dash'})
    const {buildChangeScope} = await import('./ticket/pickup.mjs')
    const {writeChangeScopeFile} = await import('./ticket/cli.mjs')
    writeChangeScopeFile(dir, buildChangeScope({issue: {number: 7, title: 't', body: 'x'}, unit: deferredUnit, testCaseIds: ['TC-001-1']}))
    const linked = await runLink({root: dir, featureId: 'FEAT-001', prUrl: 'https://x/pull/9', flags: {units, confirm: true}})
    assert.equal(linked.ok, true)
    assert.equal(linked.record.acceptedIncomplete, undefined, '유예는 인수가 아니다')
    assert.deepEqual(linked.record.completion.deferred, ['TC-001-2'], '유예는 숨기지 않고 기록한다')
  } finally { rmSync(dir, {recursive: true, force: true}) }
})

// ── 청구 브랜치 일관성 ──────────────────────────────────────────────────────
// 티켓마다 base가 다르면 PR이 서로 다른 브랜치로 나가 흐름이 갈라진다. 2026-08-30 실측:
// 청구 브랜치가 feature/…(14건)인데 main에서 4건을 발행했고 아무도 막지 않았다.
test('청구 브랜치는 최빈값으로 정한다 — 최신값이면 오탁이 굳는다', async () => {
  const {establishedClaimBranch, checkClaimBranch} = await import('./ticket/claim-guard.mjs')
  const entries = [
    ...Array.from({length: 14}, () => ({branch: 'feature/base'})),
    ...Array.from({length: 4}, () => ({branch: 'main'})), // 나중에 잘못 발행한 것
  ]
  assert.equal(establishedClaimBranch(entries), 'feature/base')
  const blocked = checkClaimBranch({current: 'main', ledgerEntries: entries})
  assert.equal(blocked.ok, false)
  assert.match(blocked.guidance, /feature\/base/)
})

test('첫 청구는 막지 않는다 — 정할 것이 없다', async () => {
  const {checkClaimBranch} = await import('./ticket/claim-guard.mjs')
  assert.equal(checkClaimBranch({current: 'main', ledgerEntries: []}).ok, true)
})

test('의도적 이전은 --claim-branch로 명시하면 통과한다', async () => {
  const {checkClaimBranch} = await import('./ticket/claim-guard.mjs')
  const entries = [{branch: 'feature/base'}, {branch: 'feature/base'}]
  const moved = checkClaimBranch({current: 'main', ledgerEntries: entries, allow: 'main'})
  assert.equal(moved.ok, true)
  assert.equal(moved.migrated, true)
})

test('branch가 없는 레코드(링크 기록)는 청구 브랜치 판정에 세지 않는다', async () => {
  const {establishedClaimBranch} = await import('./ticket/claim-guard.mjs')
  assert.equal(establishedClaimBranch([{branch: 'feature/base'}, {prUrl: 'x'}, {branch: null}]), 'feature/base')
})

// ── 재개(reopen) 경로 ───────────────────────────────────────────────────────
// emit이 `reopen: true`로 create 계획을 내도 runner가 alreadyClaimed로 되돌리면 재청구가
// 조용히 no-op이 된다. 2026-08-30 실측: 그래서 청구 브랜치 정정이 반영되지 않았다.
test('닫힌 원장 레코드는 살아 있는 청구가 아니다 — 재개가 no-op이 되지 않는다', async () => {
  const {claimFeature} = await import('./ticket/runner.mjs')
  const created = []
  const result = await claimFeature({
    unit,
    provider: {findByLabel: async () => null, createIssue: async f => { created.push(f); return {number: 42} }},
    ledger: {find: () => ({ticketKey: '7', closed: true}), append: () => {}},
  })
  assert.equal(result.alreadyClaimed, undefined ?? result.alreadyClaimed, '닫힌 레코드로 막히지 않는다')
  assert.equal(created.length, 1, '새 티켓을 낸다')
})

test('트래커의 닫힌 티켓은 되살린다 — 새 번호를 내지 않는다', async () => {
  const {claimFeature} = await import('./ticket/runner.mjs')
  const reopened = []
  const created = []
  await claimFeature({
    unit,
    provider: {
      findByLabel: async () => ({ticketKey: '7', number: 7, state: 'CLOSED'}),
      reopenIssue: async key => { reopened.push(key); return {number: 7, ticketKey: '7'} },
      createIssue: async f => { created.push(f); return {number: 99} },
    },
    ledger: {find: () => null, append: () => {}},
  })
  assert.deepEqual(reopened, ['7'], '닫힌 티켓을 되살린다')
  assert.equal(created.length, 0, '새 번호를 내지 않는다')
})

test('열린 티켓은 그대로 청구됨으로 본다', async () => {
  const {claimFeature} = await import('./ticket/runner.mjs')
  const result = await claimFeature({
    unit,
    provider: {findByLabel: async () => ({ticketKey: '7', state: 'OPEN'}), createIssue: async () => ({number: 99})},
    ledger: {find: () => null, append: () => {}},
  })
  assert.equal(result.alreadyClaimed, true)
})

// ── 디자인 참고 정본 ────────────────────────────────────────────────────────
// 티켓만 읽고 개발하면 디자인 정본이 있다는 사실조차 모른다는 실측(2026-08-30)에서 나왔다.
// **게이트가 아니라 포인터다** — 디자인은 언제든 추가·수정할 수 있고, 필요한 값이 없으면
// 개발이 판단해 쓴 뒤 정본에 되쓴다.
test('티켓 본문에 존재하는 디자인 정본만 실린다', async () => {
  const {buildIssueFields, designSection} = await import('./ticket/provider-github.mjs')
  const fields = buildIssueFields(buildTicketDraft(unit), {designRefs: ['_workspace/02_design/design-system']})
  assert.match(fields.body, /## 참고 정본 \(디자인\)/)
  assert.match(fields.body, /design-system/)
  assert.match(fields.body, /그대로 구현한다/, '정본 준수를 먼저 말한다')
  assert.match(fields.body, /정본에 추가·수정한다/, '되쓰기를 안내한다')
  assert.equal(designSection([]), null, '디자인 정본이 없으면 절을 만들지 않는다')
  assert.doesNotMatch(buildIssueFields(buildTicketDraft(unit), {}).body, /참고 정본/)
})

test('디자인 정본 탐색은 실제로 존재하는 경로만 돌려준다', async () => {
  const {resolveDesignRefs} = await import('./ticket/cli.mjs')
  const dir = tmpRoot()
  try {
    assert.deepEqual(resolveDesignRefs(dir), [])
    mkdirSync(join(dir, '_workspace/02_design/design-system'), {recursive: true})
    writeFileSync(join(dir, '_workspace/02_design/layout-spec.md'), '#')
    const refs = resolveDesignRefs(dir)
    assert.ok(refs.includes('_workspace/02_design/design-system'))
    assert.ok(refs.includes('_workspace/02_design/layout-spec.md'))
    assert.ok(!refs.includes('_workspace/02_design/component-spec'), '없는 경로는 적지 않는다')
  } finally { rmSync(dir, {recursive: true, force: true}) }
})
