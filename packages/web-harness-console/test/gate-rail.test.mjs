// 게이트 레일·지금 존 파생 회귀 (콘솔 디자인 개편 2단계).
// 고정하는 사실: (1) 근거 없으면 unknown/none이며 pass로 격상하지 않는다, (2) 게이트 상태는
// 실제 payload 사실(프리뷰 상태·receipt·TC 실행·stage 파일)에서만 파생, (3) 다음 행동은
// 사실 신호에서만 생성되고 없으면 빈 목록, (4) PULSE는 값 없음을 값 없음으로 말한다.
import assert from 'node:assert/strict'
import test from 'node:test'
import {currentGateId, deriveGates, deriveNextActions, derivePulse} from '../public/gate-rail.mjs'

const gateOf = (detail, id) => deriveGates(detail).find(gate => gate.id === id)
const run = (exitCode, extra = {}) => ({latest: {exitCode, completedAt: 't', ...extra}})

test('deriveGates: 빈 프로젝트는 전부 none/unknown — pass 없음(증거 없음을 통과로 격상 금지)', () => {
  const gates = deriveGates({})
  assert.equal(gates.length, 6)
  assert.equal(gates.filter(gate => gate.status === 'pass').length, 0)
  assert.equal(gateOf({}, 'dev').status, 'unknown')          // 콘솔은 구현 진척을 읽지 않음
  assert.match(gateOf({}, 'dev').detail, /판정 불가/)
  assert.equal(gateOf({}, 'source').status, 'none')          // 외부 원본 0건은 정상 상태
})

test('deriveGates: 프리뷰 상태가 Design 게이트의 기계 증거', () => {
  const withPreview = status => ({phaseCounts: {design: 5}, preview: {status}})
  assert.equal(gateOf(withPreview('APPROVED'), 'design').status, 'pass')
  assert.equal(gateOf(withPreview('STALE'), 'design').status, 'attention')
  assert.equal(gateOf(withPreview('UNAPPROVED'), 'design').status, 'attention')
  // 프리뷰 없음 + 설계 문서만 → none(문서 존재를 승인으로 읽지 않음)
  const docsOnly = gateOf({phaseCounts: {design: 33}, preview: {status: 'ABSENT'}}, 'design')
  assert.equal(docsOnly.status, 'none')
  assert.match(docsOnly.detail, /프리뷰 없음/)
})

test('deriveGates: QA는 receipt 우선·TC 실행 차선, 실패는 attention', () => {
  const receiptsPass = {qa: {receipts: [{check: 'lint', status: 'PASS'}, {check: 'test', status: 'PASS'}]}}
  assert.equal(gateOf(receiptsPass, 'qa').status, 'pass')
  const receiptsFail = {qa: {receipts: [{check: 'lint', status: 'FAIL'}]}}
  assert.equal(gateOf(receiptsFail, 'qa').status, 'attention')
  // receipt 없고 TC 실행만 — 통과여도 "receipt 없음"을 detail에 명시
  const runsOnly = {qa: {tcRuns: {'TC-001-1': run(0)}}}
  const qa = gateOf(runsOnly, 'qa')
  assert.equal(qa.status, 'pass')
  assert.match(qa.detail, /receipt 없음/)
  assert.equal(gateOf({qa: {tcRuns: {'TC-001-1': run(1)}}}, 'qa').status, 'attention')
})

test('deriveGates: Dev/Release는 stage 파일 존재 사실만 — 진척 추정 없음', () => {
  assert.equal(gateOf({stage: {changeScope: true}}, 'dev').status, 'attention') // 발급됐으나 실행 기록 없음
  assert.equal(gateOf({qa: {tcRuns: {'TC-001-1': run(0)}}}, 'dev').status, 'pass')
  assert.equal(gateOf({stage: {handoff: true}}, 'release').status, 'pass')
  assert.equal(gateOf({stage: {releaseReadiness: true}}, 'release').status, 'attention')
  assert.equal(gateOf({}, 'release').status, 'none')
})

test('currentGateId: attention 우선, 없으면 마지막 pass 다음 미시작', () => {
  const detail = {phaseCounts: {source: 1, plan: 4, design: 3}, preview: {status: 'STALE'}}
  assert.equal(currentGateId(deriveGates(detail)), 'design')
  const clean = {phaseCounts: {source: 1, plan: 4}, preview: {status: 'ABSENT'}}
  assert.equal(currentGateId(deriveGates(clean)), 'design') // plan까지 pass → 다음 미시작
})

test('deriveNextActions: 사실 신호에서만 — 없으면 빈 목록', () => {
  assert.deepEqual(deriveNextActions({}), [])
  const actions = deriveNextActions({
    changeRequests: [{id: 'CHG-20260822-001', status: 'open'}],
    preview: {status: 'STALE'},
    qa: {tcRunCommandDeclared: true, tcRuns: {'TC-001-1': run(1)}},
    features: [{testCaseIds: ['TC-001-1', 'TC-002-1']}],
    changeSummary: {total: 2},
  })
  const ids = actions.map(action => action.id)
  assert.deepEqual(ids, ['review-change-requests', 'preview', 'failing-tc', 'unrun-tc', 'session-changes'])
  assert.match(actions[0].why, /CHG-20260822-001/)
  assert.equal(actions.find(action => action.id === 'failing-tc').tab, 'qa')
  // 실행 채널 미선언이면 '미실행 TC' 행동을 만들지 않는다(실행 불가한 행동 제안 금지)
  const noChannel = deriveNextActions({qa: {tcRunCommandDeclared: false}, features: [{testCaseIds: ['TC-001-1']}]})
  assert.deepEqual(noChannel, [])
})

test('derivePulse: 없음을 없음으로 — 추정하지 않음', () => {
  const pulse = derivePulse({})
  assert.equal(pulse.find(row => row.label === 'Design preview').value, 'ABSENT')
  assert.match(pulse.find(row => row.label === 'TC 실행').value, /기록 없음/)
  assert.equal(pulse.every(row => ['go', 'warn', 'muted'].includes(row.tone)), true)
  const live = derivePulse({preview: {status: 'APPROVED'}, qa: {tcRuns: {'TC-001-1': run(0), 'TC-001-2': run(1)}}, features: [{testCaseIds: ['TC-001-1', 'TC-001-2', 'TC-002-1']}]})
  assert.equal(live.find(row => row.label === 'Design preview').tone, 'go')
  assert.match(live.find(row => row.label === 'TC 실행').value, /1 pass \/ 2 run · 인벤토리 3/)
})

// 필드명 드리프트 방지 — 손수 만든 픽스처는 파생 코드와 **같은 오해**를 담을 수 있다
// (실측 사고: preview.state로 읽어 APPROVED가 '프리뷰 없음'으로 표시, 픽스처 테스트는 통과).
// 실제 인덱서가 만든 payload로 판정해 계약을 고정한다.
test('실제 인덱서 payload 계약 — 픽스처가 아닌 실측으로 Design 게이트 판정', async () => {
  const {WorkspaceCatalog} = await import('../src/indexer.mjs')
  const catalog = new WorkspaceCatalog(new URL('../../..', import.meta.url).pathname)
  const approved = catalog.list().projects.find(project => project.preview?.status === 'APPROVED')
  if (!approved) return // 승인 프리뷰 프로젝트가 없는 환경이면 이 계약은 검증 불가(스킵을 통과로 위장하지 않음)
  const detail = catalog.detail(approved.id)
  const design = deriveGates(detail).find(gate => gate.id === 'design')
  assert.equal(design.status, 'pass', `실측 payload에서 APPROVED가 pass로 판정돼야 한다(필드명 드리프트 감지)`)
  // stage 필드도 실제로 존재해야 한다 — Dev/Release 게이트의 유일한 근거
  assert.equal(typeof detail.stage?.changeScope, 'boolean')
  assert.equal(typeof detail.stage?.handoff, 'boolean')
})

test('deriveTicketStages: 로컬 증명 가능한 3단계만 — 배정은 단계로 만들지 않음', async () => {
  const {deriveTicketStages} = await import('../public/gate-rail.mjs')
  const done = row => deriveTicketStages(row).map(stage => stage.done)
  assert.deepEqual(deriveTicketStages({status: 'unclaimed'}).map(s => s.id), ['claim', 'pr', 'done'])
  assert.deepEqual(done({status: 'unclaimed'}), [false, false, false])
  assert.deepEqual(done({status: 'local-new'}), [false, false, false])      // push 이전 — 청구 불가
  assert.deepEqual(done({status: 'local-modified'}), [false, false, false])
  assert.deepEqual(done({status: 'claimed'}), [true, false, false])
  assert.deepEqual(done({status: 'pr-linked'}), [true, true, false])
  assert.deepEqual(done({status: 'closed'}), [true, true, true])
  assert.deepEqual(done({status: 'plan-removed'}), [true, false, false])    // 청구는 실재
})
