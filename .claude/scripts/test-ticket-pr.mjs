// 통합 빌드 C단계 회귀 — 아웃바운드 PR/status 코어.
//
// 고정하는 사실: (1) summarizeEvidence가 존재 산출물만 정직 요약(위조 없음)·fail TC 식별,
// (2) completionGate가 STALE·failing-TC를 하드 차단(no-evidence는 차단 아닌 표기),
// (3) computeCloseLink가 원장 대조로 대상 정합(불일치 거부·미기록 unverified),
// (4) computePrLinkPlan 멱등(이미 링크면 재링크 금지), (5) buildPrBody가 Closes #N +
// 정직 tier(검증 통과 미주장), (6) 실행부 argv(prCreate·issueComment) 구조 고정.
import assert from 'node:assert/strict'
import test from 'node:test'
import {summarizeEvidence, completionGate, computeCloseLink, computePrLinkPlan, buildPrBody} from './ticket/pr.mjs'
import {renderCloseReference} from './ticket/provider-github.mjs'
import {buildChangeScope} from './ticket/pickup.mjs'
import {ledgerState} from './ticket/ledger.mjs'
import {prCreateArgs, issueCommentArgs} from './ticket/provider-github-exec.mjs'

const unit = {featureId: 'FEAT-007', title: '모터 상세', body: '모터 선택 시 상세 표시', testCaseIds: ['TC-007-1'], type: 'feature'}
const issue = {number: 42, title: '모터 상세', body: 'x'}
const changeScope = buildChangeScope({issue, unit, testCaseIds: ['TC-007-1']})

test('summarizeEvidence: 존재만 정직 요약, fail TC 식별', () => {
  assert.equal(summarizeEvidence().tier, 'no-evidence')
  assert.equal(summarizeEvidence({tcResults: [{id: 'TC-007-1', verdict: 'pass'}]}).tier, 'diagnostic-only')
  assert.equal(summarizeEvidence({releaseReceipt: {sig: '...'}}).tier, 'release-receipt-referenced')
  const s = summarizeEvidence({tcResults: [{id: 'TC-007-1', verdict: 'fail'}, {id: 'TC-007-2', verdict: 'pass'}]})
  assert.deepEqual(s.failingTcs, ['TC-007-1'])
})

test('completionGate: STALE·failing-TC 하드 차단, clean은 통과', () => {
  // clean + 통과 TC → ok
  const ok = completionGate({changeScope, currentUnit: unit, evidence: {tcResults: [{id: 'TC-007-1', verdict: 'pass'}]}})
  assert.equal(ok.ok, true)
  assert.deepEqual(ok.blockers, [])
  // 상류 기획 변경 → STALE 차단
  const stale = completionGate({changeScope, currentUnit: {...unit, body: '명세 바뀜'}, evidence: {}})
  assert.equal(stale.ok, false)
  assert.ok(stale.blockers.includes('stale-change-scope'))
  // FEAT 삭제(unit 없음) → STALE 차단
  assert.equal(completionGate({changeScope, currentUnit: null, evidence: {}}).ok, false)
  // fail TC → 차단
  const fail = completionGate({changeScope, currentUnit: unit, evidence: {tcResults: [{id: 'TC-007-1', verdict: 'fail'}]}})
  assert.equal(fail.ok, false)
  assert.ok(fail.blockers.includes('failing-tc'))
  // no-evidence는 차단 아님(표기만)
  assert.equal(completionGate({changeScope, currentUnit: unit, evidence: {}}).ok, true)
})

test('computeCloseLink: 원장 대조 — 정합/불일치/미기록', () => {
  const state = ledgerState([{schemaVersion: 1, featureId: 'FEAT-007', ticketKey: '42', contentHash: 'h', createdAt: 't'}])
  const good = computeCloseLink({featureId: 'FEAT-007', ticketKey: 42, ledgerState: state})
  assert.equal(good.ok, true)
  assert.equal(good.closes, '42')
  assert.equal(good.verified, true)
  // 불일치 → 거부(엉뚱한 이슈 안 닫음)
  const bad = computeCloseLink({featureId: 'FEAT-007', ticketKey: 99, ledgerState: state})
  assert.equal(bad.ok, false)
  assert.equal(bad.error, 'CLOSE_TARGET_MISMATCH')
  // 원장 미기록 → 링크하되 unverified(정직)
  const unrec = computeCloseLink({featureId: 'FEAT-009', ticketKey: 7, ledgerState: state})
  assert.equal(unrec.ok, true)
  assert.equal(unrec.verified, false)
})

test('computePrLinkPlan: 멱등(이미 링크면 재링크 금지)', () => {
  const linked = ledgerState([{schemaVersion: 1, featureId: 'FEAT-007', ticketKey: '42', contentHash: 'h', createdAt: 't', prUrl: 'https://x/pull/1'}])
  const already = computePrLinkPlan({featureId: 'FEAT-007', ledgerState: linked, prUrl: 'https://x/pull/2', now: 'n'})
  assert.equal(already.status, 'already-linked')
  assert.equal(already.existing, 'https://x/pull/1') // 첫 링크 보존, 재링크 안 함
  // 미링크 → link + 청구 필드 보존
  const fresh = ledgerState([{schemaVersion: 1, featureId: 'FEAT-007', ticketKey: '42', contentHash: 'h', createdAt: 't'}])
  const plan = computePrLinkPlan({featureId: 'FEAT-007', ledgerState: fresh, prUrl: 'https://x/pull/9', now: 'n'})
  assert.equal(plan.status, 'link')
  assert.equal(plan.record.prUrl, 'https://x/pull/9')
  assert.equal(plan.record.ticketKey, '42') // 기존 청구 보존
})

test('renderCloseReference: verified만 Closes, unverified는 non-closing, mismatch는 가시 사유', () => {
  // verified → Closes(자동 닫힘 허용)
  assert.equal(renderCloseReference({ok: true, closes: '42', verified: true}), 'Closes #42')
  // unverified → Relates to(자동 닫힘 안 함) + 가시 경고(HTML 주석 아님)
  const unv = renderCloseReference({ok: true, closes: '42', verified: false})
  assert.match(unv, /Relates to #42/)
  assert.doesNotMatch(unv, /Closes #42/)         // 자동 닫힘 키워드 없음
  assert.doesNotMatch(unv, /<!--/)               // 비가시 주석 아님
  assert.match(unv, /> ⚠️/)                       // 가시 blockquote 경고
  // mismatch → 링크 생략 + 가시 사유(침묵 fail-closed 방지)
  const mm = renderCloseReference({ok: false, error: 'CLOSE_TARGET_MISMATCH', warning: '원장 5 ≠ 9'})
  assert.match(mm, /생략 — 대상 불일치/)
  assert.doesNotMatch(mm, /Closes|Relates/)
})

test('buildPrBody: provider 렌더 close 줄 + 정직 tier(검증 통과 미주장)', () => {
  const verified = renderCloseReference(computeCloseLink({featureId: 'FEAT-007', ticketKey: 42, ledgerState: ledgerState([{schemaVersion: 1, featureId: 'FEAT-007', ticketKey: '42', contentHash: 'h', createdAt: 't'}])}))
  const body = buildPrBody({summary: '모터 상세 구현', changeScope, closeLine: verified, evidence: {tcResults: [{id: 'TC-007-1', verdict: 'pass'}]}})
  assert.match(body, /Closes #42/)
  assert.match(body, /FEAT-007/)
  assert.match(body, /TC-007-1: pass/)
  assert.match(body, /diagnostic-only/)
  assert.match(body, /검증 통과를 의미하지 않는다/) // 정직 하한
  assert.doesNotMatch(body, /certified|검증 완료/) // 위조 금지
  // 미기록(unverified) FEAT → 본문에 자동 닫힘 키워드 없음(I6 안전 갭 회귀)
  const unvLine = renderCloseReference(computeCloseLink({featureId: 'FEAT-009', ticketKey: 7, ledgerState: ledgerState([])}))
  const unvBody = buildPrBody({summary: 's', changeScope, closeLine: unvLine, evidence: {}})
  assert.doesNotMatch(unvBody, /Closes #7/)      // 미확인 이슈 자동 닫힘 금지
  assert.match(unvBody, /Relates to #7/)
})

test('실행부 argv: prCreate·issueComment 구조 고정', () => {
  assert.deepEqual(
    prCreateArgs('o/r', {title: 't', body: 'b', base: 'main', head: 'feat'}),
    ['pr', 'create', '--repo', 'o/r', '--title', 't', '--body', 'b', '--base', 'main', '--head', 'feat'],
  )
  assert.deepEqual(issueCommentArgs('o/r', 42, 'hi'), ['issue', 'comment', '42', '--repo', 'o/r', '--body', 'hi'])
})
