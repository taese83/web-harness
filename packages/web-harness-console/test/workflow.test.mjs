// Development › Work flow 데이터 조립 회귀 (증분 3).
// 고정: (1) foldBranchTickets가 로컬 증명 가능 상태만(unclaimed/claimed/pr-linked/closed/
// plan-removed)·stale 판정, (2) selfMatchedBranches가 원장 자기-일치만 등록(임시 브랜치의
// 상속 원장·구세대 무branch 원장·원장 없음 배제 — §4-1 청구=등록).
import assert from 'node:assert/strict'
import test from 'node:test'
import {foldBranchTickets, selfMatchedBranches} from '../src/workflow.mjs'
import {serializeLedgerRecord} from '../../../.claude/scripts/ticket/ledger.mjs'
import {unitContentHash} from '../../../.claude/scripts/ticket/emit.mjs'

const unit = {featureId: 'FEAT-001', title: '모터 상세', body: '상세 표시', testCaseIds: ['TC-001-1'], type: 'feature'}

test('foldBranchTickets: 증명 가능 상태만 + stale + plan-removed', () => {
  const claimedFresh = {schemaVersion: 1, featureId: 'FEAT-001', ticketKey: '3', contentHash: unitContentHash(unit), createdAt: 't'}
  const rows = foldBranchTickets([unit], [claimedFresh])
  assert.equal(rows[0].status, 'claimed')     // 배정은 미상 — claimed는 "청구됨"만
  assert.equal(rows[0].stale, false)          // 청구 시점 해시 = 현재 해시
  // 상류 계획 변경 → stale true
  assert.equal(foldBranchTickets([{...unit, body: '명세 변경'}], [claimedFresh])[0].stale, true)
  // 원장 없음 → unclaimed / prUrl → pr-linked / closed → closed
  assert.equal(foldBranchTickets([unit], [])[0].status, 'unclaimed')
  assert.equal(foldBranchTickets([unit], [{...claimedFresh, prUrl: 'https://x/pull/9'}])[0].status, 'pr-linked')
  assert.equal(foldBranchTickets([unit], [{...claimedFresh, closed: true}])[0].status, 'closed')
  // 원장엔 있는데 계획에서 사라진 청구 → plan-removed로 노출(침묵 실종 금지)
  const removed = foldBranchTickets([], [claimedFresh])
  assert.equal(removed[0].status, 'plan-removed')
  assert.equal(removed[0].stale, true)
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
