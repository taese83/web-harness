// Development › Work flow 데이터 조립 회귀 (증분 3).
// 고정: (1) foldBranchTickets가 로컬 증명 가능 상태만(unclaimed/claimed/pr-linked/closed/
// plan-removed)·stale 판정, (2) selfMatchedBranches가 원장 자기-일치만 등록(임시 브랜치의
// 상속 원장·구세대 무branch 원장·원장 없음 배제 — §4-1 청구=등록).
import assert from 'node:assert/strict'
import test from 'node:test'
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {buildRoutePayload, detectActivePickup, foldBranchTickets, selfMatchedBranches} from '../src/workflow.mjs'
import {serializeLedgerRecord} from '../../../.claude/scripts/ticket/ledger.mjs'
import {unitContentHash} from '../../../.claude/scripts/ticket/emit.mjs'

const unit = {featureId: 'FEAT-001', title: '모터 상세', body: '상세 표시', testCaseIds: ['TC-001-1'], type: 'feature'}

test('foldBranchTickets: 기준은 push된 형상(origin) — 발행 상태 + 로컬 차이 표기', () => {
  const claimedFresh = {schemaVersion: 1, featureId: 'FEAT-001', ticketKey: '3', contentHash: unitContentHash(unit), createdAt: 't'}
  const rows = foldBranchTickets([unit], [claimedFresh], {localUnits: [unit]})
  assert.equal(rows[0].status, 'claimed')     // 배정은 미상 — claimed는 "청구됨"만
  assert.equal(rows[0].stale, false)          // 청구 시점 해시 = origin 해시
  assert.equal(rows[0].localDrift, null)      // 로컬 = origin 일치
  // push된 상류 계획 변경 → stale true (origin 기준 — 로컬 편집은 stale이 아님)
  assert.equal(foldBranchTickets([{...unit, body: 'push된 명세 변경'}], [claimedFresh], {localUnits: [unit]})[0].stale, true)
  // 원장 없음 → unclaimed(발행 대기 — 청구 가능한 유일한 미발급) / prUrl / closed
  assert.equal(foldBranchTickets([unit], [], {localUnits: [unit]})[0].status, 'unclaimed')
  assert.equal(foldBranchTickets([unit], [{...claimedFresh, prUrl: 'https://x/pull/9'}], {localUnits: [unit]})[0].status, 'pr-linked')
  assert.equal(foldBranchTickets([unit], [{...claimedFresh, closed: true}], {localUnits: [unit]})[0].status, 'closed')
  // 원장엔 있는데 push된 계획에서 사라진 청구 → plan-removed(침묵 실종 금지)
  const removed = foldBranchTickets([], [claimedFresh], {localUnits: []})
  assert.equal(removed[0].status, 'plan-removed')
})

test('foldBranchTickets: 로컬 차이 3분할 — 발행/미푸시 혼재 금지(사용자 지적)', () => {
  const other = {featureId: 'FEAT-002', title: '신규', body: 'y', testCaseIds: ['TC-002-1'], type: 'feature'}
  // 로컬 전용(origin에 없음) → local-new "push 안 됨" — unclaimed와 섞이지 않음
  const mixed = foldBranchTickets([unit], [], {localUnits: [unit, other]})
  const byId = Object.fromEntries(mixed.map(r => [r.featureId, r]))
  assert.equal(byId['FEAT-001'].status, 'unclaimed')   // push됨·발행 대기(청구 가능)
  assert.equal(byId['FEAT-002'].status, 'local-new')   // 미푸시 — 청구 불가
  // 로컬 수정(origin과 다름) + 미발행 → local-modified(청구 불가 — push 먼저)
  assert.equal(foldBranchTickets([unit], [], {localUnits: [{...unit, body: '로컬 수정'}]})[0].status, 'local-modified')
  // 발행된 행의 로컬 수정은 상태 유지 + localDrift 배지(표기)
  const claimed = {schemaVersion: 1, featureId: 'FEAT-001', ticketKey: '3', contentHash: unitContentHash(unit), createdAt: 't'}
  const drift = foldBranchTickets([unit], [claimed], {localUnits: [{...unit, body: '로컬 수정'}]})[0]
  assert.equal(drift.status, 'claimed')
  assert.equal(drift.localDrift, 'modified-locally')
  // 로컬 삭제 → deleted-locally 표기(침묵 소실 금지)
  assert.equal(foldBranchTickets([unit], [], {localUnits: []})[0].localDrift, 'deleted-locally')
  // origin에 브랜치/계획 없음(미푸시 브랜치) → 기준 0 + 로컬 전부 local-new
  const unpushed = foldBranchTickets(null, [], {localUnits: [unit, other]})
  assert.deepEqual(unpushed.map(r => r.status), ['local-new', 'local-new'])
  // 타 브랜치(origin 스냅샷) 카드 — 로컬 오버레이 없음 → drift 미표기
  assert.equal(foldBranchTickets([unit], [])[0].localDrift, null)
})

test('selfMatchedBranches: 원장 자기-일치만 등록(§4-1 청구=등록)', () => {
  const record = branch => serializeLedgerRecord({featureId: 'FEAT-001', ticketKey: '3', contentHash: 'h', createdAt: 't', ...(branch ? {branch} : {})})
  const texts = new Map([
    ['feature/dash', record('feature/dash')],   // 자기-일치 → 등록
    ['tmp/from-dash', record('feature/dash')],  // 임시 브랜치(상속 원장 — 부모를 가리킴) → 배제
    ['feature/legacy', record(null)],           // 구세대(branch 미기록) → 배제(정직 갭)
    ['feature/no-ledger', null],                // 원장 없음 → 배제
  ])
  assert.deepEqual(selfMatchedBranches(texts), ['feature/dash'])
})

test('buildRoutePayload: 판정 read-only + statusUnknown 정직 + activePickup 소스(§4-3 리뷰 조건)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wh-route-'))
  try {
    const gitRun = (out = {}) => (root, args) => {
      if (args[0] === 'rev-parse') return out.branch ?? 'main\n'
      if (args[0] === 'status') return out.porcelain ?? ''
      return null
    }
    // 현재 브랜치 티켓 + 클린 → 전환 없이 픽업 단계만
    const ok = buildRoutePayload(dir, {targetBranch: 'main', featureId: 'FEAT-001'}, {gitRun: gitRun()})
    assert.equal(ok.ok, true)
    assert.deepEqual(ok.steps.map(step => step.step), ['pickup-readiness', 'pickup:FEAT-001'])
    // dirty → 차단
    const dirty = buildRoutePayload(dir, {targetBranch: 'f/x', featureId: 'FEAT-001'}, {gitRun: gitRun({porcelain: ' M a.ts\n'})})
    assert.equal(dirty.blocked.reason, 'dirty-worktree')
    // git 조회 실패 → statusUnknown(미상을 미상으로 — "미커밋 변경" 오처방 아님)
    const unknown = buildRoutePayload(dir, {targetBranch: 'f/x', featureId: 'FEAT-001'}, {gitRun: () => null})
    assert.equal(unknown.blocked.reason, 'worktree-status-unknown')
    assert.equal(unknown.worktree.statusUnknown, true)
    // 활성 픽업(change-scope.md 존재) → 다른 티켓 선택 시 active-pickup 경고, 같은 티켓이면 미경고
    mkdirSync(join(dir, '_workspace', '03_dev'), {recursive: true})
    writeFileSync(join(dir, '_workspace', '03_dev', 'change-scope.md'), '# change-scope\nfeatureId: FEAT-007\n')
    assert.deepEqual(detectActivePickup(dir), {featureId: 'FEAT-007'})
    const other = buildRoutePayload(dir, {targetBranch: 'f/x', featureId: 'FEAT-001'}, {gitRun: gitRun()})
    assert.deepEqual(other.steps[0].warnings, ['active-pickup:FEAT-007'])
    const same = buildRoutePayload(dir, {targetBranch: 'f/x', featureId: 'FEAT-007'}, {gitRun: gitRun()})
    assert.deepEqual(same.steps[0].warnings, []) // 같은 티켓 재픽업은 "다른 티켓 진행"이 아님
  } finally {
    rmSync(dir, {recursive: true, force: true})
  }
})
