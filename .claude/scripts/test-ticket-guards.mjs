// 통합 빌드 — 청구/픽업 git 게이트 회귀(4점 스펙).
// 고정: (1) computeClaimEligibility: origin 없음/미푸시/정상(점 1), (2) evaluatePickupReadiness:
// 브랜치 불일치(점 2)·컨플릭(점 4)·형상불일치(점 3)·ready 우선순위, (3) git-origin 실행부:
// argv 구조 + 주입 exec로 origin 동기/브랜치/컨플릭 판정.
import assert from 'node:assert/strict'
import test from 'node:test'
import {computeClaimEligibility, claimEligibilityGuidance} from './ticket/claim-guard.mjs'
import {evaluatePickupReadiness} from './ticket/sync-guard.mjs'
import {resolveOriginPlanSync, resolveCurrentBranch, resolveWorkingState, upstreamArgs, originDiffArgs, conflictArgs} from './ticket/git-origin.mjs'

test('computeClaimEligibility: 청구는 origin 푸시분에만(점 1)', () => {
  assert.equal(computeClaimEligibility({originExists: false, planMatchesOrigin: false}).reason, 'no-origin-plan')
  assert.equal(computeClaimEligibility({originExists: true, planMatchesOrigin: false}).reason, 'local-plan-not-pushed')
  assert.equal(computeClaimEligibility({originExists: true, planMatchesOrigin: true}).eligible, true)
  assert.match(claimEligibilityGuidance('local-plan-not-pushed'), /커밋·푸시/)
})

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

test('git-origin argv 구조 고정', () => {
  assert.deepEqual(upstreamArgs(), ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'])
  assert.deepEqual(originDiffArgs('origin/main', 'p/plan.md'), ['diff', '--quiet', 'origin/main', '--', 'p/plan.md'])
  assert.deepEqual(conflictArgs(), ['diff', '--name-only', '--diff-filter=U'])
})

test('resolveOriginPlanSync: 주입 exec로 존재·일치 판정(점 1)', async () => {
  // upstream 있음, origin에 계획 존재, diff 없음(동일) → 청구 가능 상태
  const okExec = async args => {
    if (args[0] === 'rev-parse') return {code: 0, out: 'origin/main\n'}
    if (args[0] === 'cat-file') return {code: 0, out: ''}       // 존재
    if (args[0] === 'diff') return {code: 0, out: ''}           // 동일
    throw new Error('unexpected')
  }
  const okState = await resolveOriginPlanSync({repoRoot: '.', planPath: 'p', exec: okExec})
  assert.deepEqual(okState, {originExists: true, planMatchesOrigin: true, base: 'origin/main'})
  assert.equal(computeClaimEligibility(okState).eligible, true)

  // diff가 비0 exit(차이) → 미푸시로 판정
  const dirtyExec = async args => {
    if (args[0] === 'rev-parse') return {code: 0, out: 'origin/main\n'}
    if (args[0] === 'cat-file') return {code: 0, out: ''}
    if (args[0] === 'diff') throw Object.assign(new Error('diff'), {code: 1}) // 차이
    throw new Error('unexpected')
  }
  const dirty = await resolveOriginPlanSync({repoRoot: '.', planPath: 'p', exec: dirtyExec})
  assert.equal(dirty.planMatchesOrigin, false)
  assert.equal(computeClaimEligibility(dirty).reason, 'local-plan-not-pushed')

  // upstream 없음 → no-upstream
  const noUp = await resolveOriginPlanSync({repoRoot: '.', planPath: 'p', exec: async () => { throw new Error('no upstream') }})
  assert.equal(noUp.originExists, false)
})

test('resolveCurrentBranch / resolveWorkingState: 주입 exec', async () => {
  assert.equal(await resolveCurrentBranch({repoRoot: '.', exec: async () => ({code: 0, out: 'feat/x\n'})}), 'feat/x')
  assert.equal(await resolveCurrentBranch({repoRoot: '.', exec: async () => ({code: 0, out: 'HEAD\n'})}), null) // detached
  const conflicted = await resolveWorkingState({repoRoot: '.', exec: async () => ({code: 0, out: 'src/a.ts\nsrc/b.ts\n'})})
  assert.equal(conflicted.conflicted, true)
  assert.deepEqual(conflicted.conflicts, ['src/a.ts', 'src/b.ts'])
  const clean = await resolveWorkingState({repoRoot: '.', exec: async () => ({code: 0, out: ''})})
  assert.equal(clean.conflicted, false)
})
