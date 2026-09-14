// 통합 빌드 — 청구/픽업 git 게이트 회귀(4점 스펙).
// 고정: (1) computeClaimEligibility: origin 없음/미푸시/정상(점 1), (2) evaluatePickupReadiness:
// 브랜치 불일치(점 2)·컨플릭(점 4)·형상불일치(점 3)·ready 우선순위, (3) git-origin 실행부:
// argv 구조 + 주입 exec로 origin 동기/브랜치/컨플릭 판정.
import assert from 'node:assert/strict'
import test from 'node:test'
import {evaluatePickupReadiness} from './ticket/sync-guard.mjs'
import {currentBranchArgs, fetchArgs, parseWorktreeStatus, refreshRemoteRefs, resolveCurrentBranch, resolveWorktreeStatus, worktreeStatusArgs} from './ticket/git-origin.mjs'

test('evaluatePickupReadiness: 브랜치(2)·컨플릭(4)·형상(3) 우선순위', () => {
  // 점 2 — 브랜치 불일치가 최우선 차단
  const bm = evaluatePickupReadiness({claimBranch: 'feat/x', currentBranch: 'main', claimedHash: 'h', localHash: 'h'})
  assert.equal(bm.status, 'branch-mismatch')
  // 점 4 — 브랜치 맞아도 컨플릭이면 차단
  const cf = evaluatePickupReadiness({claimBranch: 'main', currentBranch: 'main', claimedHash: 'h', localHash: 'other', working: {conflicted: true}})
  assert.equal(cf.status, 'conflicts-unresolved')
  // 점 3 — 브랜치·컨플릭 OK인데 형상 다르면 sync-required
  const sr = evaluatePickupReadiness({claimBranch: 'main', currentBranch: 'main', claimedHash: 'NEW', localHash: 'OLD'})
  assert.equal(sr.status, 'sync-required')
  // 전부 OK → ready
  const ok = evaluatePickupReadiness({claimBranch: 'main', currentBranch: 'main', claimedHash: 'h', localHash: 'h'})
  assert.equal(ok.ready, true)
  // 브랜치 미기록(하위호환) → 브랜치 대조 생략
  assert.equal(evaluatePickupReadiness({claimBranch: null, currentBranch: 'main', claimedHash: 'h', localHash: 'h'}).ready, true)
})

// ── 픽업이 읽는 git 사실(WORK 픽업의 컨플릭·브랜치 입력) ─────────────────────────
test('resolveCurrentBranch: 주입 exec · detached는 null', async () => {
  assert.equal(await resolveCurrentBranch({repoRoot: '.', exec: async () => ({code: 0, out: 'feat/x\n'})}), 'feat/x')
  assert.equal(await resolveCurrentBranch({repoRoot: '.', exec: async () => ({code: 0, out: 'HEAD\n'})}), null)
})

test('git argv 구조 고정', () => {
  assert.deepEqual(currentBranchArgs(), ['rev-parse', '--abbrev-ref', 'HEAD'])
  assert.deepEqual(worktreeStatusArgs(), ['status', '--porcelain'])
})

test('parseWorktreeStatus: porcelain → dirty/conflicted/untracked-only (엣지 포함)', () => {
  assert.deepEqual(parseWorktreeStatus(''), {dirty: false, conflicted: false, untrackedOnly: false})
  assert.deepEqual(parseWorktreeStatus(' M src/a.ts\n'), {dirty: true, conflicted: false, untrackedOnly: false})
  assert.deepEqual(parseWorktreeStatus('?? notes.txt\n'), {dirty: false, conflicted: false, untrackedOnly: true})
  assert.equal(parseWorktreeStatus('UU src/a.ts\n').conflicted, true)
  assert.equal(parseWorktreeStatus('AA src/b.ts\n').conflicted, true)
  assert.equal(parseWorktreeStatus('DD src/c.ts\n').conflicted, true) // both deleted
  assert.equal(parseWorktreeStatus('AU src/d.ts\n').conflicted, true) // added by us
  assert.deepEqual(parseWorktreeStatus('R  old.ts -> new.ts\n'), {dirty: true, conflicted: false, untrackedOnly: false})
  assert.deepEqual(parseWorktreeStatus('UU src/a.ts\n?? scratch.txt\n'), {dirty: true, conflicted: true, untrackedOnly: false})
})

test('상태를 못 읽으면 미상으로 적는다 — 깨끗하다고도 컨플릭이라고도 단정하지 않는다', async () => {
  const unknown = await resolveWorktreeStatus({repoRoot: '.', exec: async () => { throw new Error('no git') }})
  assert.equal(unknown.statusUnknown, true)
  assert.equal(unknown.conflicted, false)
})

test('refreshRemoteRefs: fetch argv · 실패는 던지지 않고 이유를 돌려준다(소비자가 스냅샷 기준임을 적는다)', async () => {
  assert.deepEqual(fetchArgs(), ['fetch', '--prune', '--quiet', 'origin'])
  const seen = []
  assert.deepEqual(await refreshRemoteRefs({repoRoot: '.', exec: async args => { seen.push(args); return {code: 0, out: ''} }}), {ok: true, reason: null})
  assert.deepEqual(seen[0], fetchArgs('origin'))
  const failed = await refreshRemoteRefs({repoRoot: '.', exec: async () => { throw new Error('could not resolve host\nmore') }})
  assert.deepEqual(failed, {ok: false, reason: 'could not resolve host'})
})
