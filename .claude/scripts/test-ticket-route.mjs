// 통합 빌드 증분 4 회귀 — 선택→라우팅 판정(§4-3 결정표).
// 고정: (1) computeSwitchPlan 결정표 전체(현재 브랜치=none/컨플릭·dirty=blocked/진행중=경고+확인/
// 클린=확인 1회), (2) describeRoute가 전환 뒤에도 픽업 게이트를 건너뛰지 않음, (3) porcelain
// 파싱(dirty/conflicted/untracked-only), (4) checkout argv·switchBranch 실행부.
import assert from 'node:assert/strict'
import test from 'node:test'
import {computeSwitchPlan, describeRoute} from './ticket/route.mjs'
import {parseWorktreeStatus, resolveWorktreeStatus, checkoutArgs, switchBranch, worktreeStatusArgs} from './ticket/git-origin.mjs'

test('computeSwitchPlan: §4-3 결정표 전체', () => {
  // 현재 브랜치 티켓 → 전환 불필요·확인 불필요(바로 픽업 게이트로)
  assert.deepEqual(computeSwitchPlan({targetBranch: 'main', currentBranch: 'main', worktree: {}}),
    {action: 'none', needsConfirm: false, warnings: [], guidance: null})
  // 컨플릭 → 차단(해결 먼저 — dirty보다 우선 판정)
  const cf = computeSwitchPlan({targetBranch: 'f/x', currentBranch: 'main', worktree: {dirty: true, conflicted: true}})
  assert.equal(cf.action, 'blocked')
  assert.equal(cf.reason, 'conflicts-unresolved')
  // dirty → 차단 + 침묵 스태시 금지 안내
  const dirty = computeSwitchPlan({targetBranch: 'f/x', currentBranch: 'main', worktree: {dirty: true}})
  assert.equal(dirty.reason, 'dirty-worktree')
  assert.match(dirty.guidance, /침묵 스태시 금지/)
  // 다른 티켓 진행 중 → 전환 가능하되 강한 경고 + 명시 확인
  const active = computeSwitchPlan({targetBranch: 'f/x', currentBranch: 'main', worktree: {}, activePickup: {featureId: 'FEAT-001'}})
  assert.equal(active.action, 'switch')
  assert.equal(active.needsConfirm, true)
  assert.deepEqual(active.warnings, ['active-pickup:FEAT-001'])
  // 클린 → 전환 + 확인 1회(자동이되 침묵 아님)
  const clean = computeSwitchPlan({targetBranch: 'f/x', currentBranch: 'main', worktree: {}})
  assert.deepEqual(clean, {action: 'switch', needsConfirm: true, warnings: [], guidance: null})
  // untracked-only → 차단 아님 + 표기
  assert.deepEqual(computeSwitchPlan({targetBranch: 'f/x', currentBranch: 'main', worktree: {untrackedOnly: true}}).warnings, ['untracked-files'])
  // 대상 브랜치 미상 → 차단
  assert.equal(computeSwitchPlan({targetBranch: null, currentBranch: 'main'}).reason, 'no-target-branch')
})

test('describeRoute: 전환해도 픽업 게이트는 그대로(라우팅≠게이트 우회)', () => {
  const route = describeRoute({targetBranch: 'f/x', currentBranch: 'main', worktree: {}, featureId: 'FEAT-002'})
  assert.equal(route.ok, true)
  assert.deepEqual(route.steps.map(step => step.step), ['switch:f/x', 'pickup-readiness', 'pickup:FEAT-002'])
  assert.ok(route.steps.every(step => step.step !== 'switch:f/x' || step.needsConfirm)) // 전환은 확인 필수
  // 현재 브랜치면 전환 단계 없음 — 게이트 2단계만
  const same = describeRoute({targetBranch: 'main', currentBranch: 'main', worktree: {}, featureId: 'FEAT-002'})
  assert.deepEqual(same.steps.map(step => step.step), ['pickup-readiness', 'pickup:FEAT-002'])
  // 차단이면 단계 없이 사유·안내
  const blocked = describeRoute({targetBranch: 'f/x', currentBranch: 'main', worktree: {dirty: true}, featureId: 'FEAT-002'})
  assert.equal(blocked.ok, false)
  assert.equal(blocked.blocked.reason, 'dirty-worktree')
})

test('parseWorktreeStatus: porcelain → dirty/conflicted/untracked-only', () => {
  assert.deepEqual(parseWorktreeStatus(''), {dirty: false, conflicted: false, untrackedOnly: false})
  assert.deepEqual(parseWorktreeStatus(' M src/a.ts\n'), {dirty: true, conflicted: false, untrackedOnly: false})
  assert.deepEqual(parseWorktreeStatus('?? notes.txt\n'), {dirty: false, conflicted: false, untrackedOnly: true})
  assert.equal(parseWorktreeStatus('UU src/a.ts\n').conflicted, true)
  assert.equal(parseWorktreeStatus('AA src/b.ts\n').conflicted, true)
})

test('실행부: checkout argv·switchBranch·상태 조회 실패는 dirty 보수 폴백', async () => {
  assert.deepEqual(checkoutArgs('f/x'), ['checkout', 'f/x'])
  assert.deepEqual(worktreeStatusArgs(), ['status', '--porcelain'])
  const calls = []
  const done = await switchBranch({repoRoot: '.', branch: 'f/x', exec: async args => { calls.push(args); return {code: 0, out: ''} }})
  assert.deepEqual(done, {switched: true, branch: 'f/x'})
  assert.deepEqual(calls, [['checkout', 'f/x']])
  // 상태 조회 실패 → dirty 폴백(라우팅이 보수적으로 차단하게)
  const fallback = await resolveWorktreeStatus({repoRoot: '.', exec: async () => { throw new Error('no git') }})
  assert.equal(fallback.dirty, true)
})
