// 팀 워크플로우 통합 빌드 1단계 회귀 — ManualPaste 파서 + NormalizedTicket 검증.
//
// 고정하는 사실: (1) 라벨 필드 파싱과 AC 블록 추출, (2) FEAT/TC ID 왕복 추출·중복 제거,
// (3) 티켓 식별 불가만 하드 실패(ticketId·title), 나머지 부족은 specCompleteness로 보고
// (파서는 게이트하지 않음), (4) 맨몸 티켓(ID 없음)은 파싱 성공하되 ready=false,
// (5) validateNormalizedTicket이 스키마 위반을 잡되 global 정규식 상태 버그가 없다.
import assert from 'node:assert/strict'
import test from 'node:test'
import {parseManualTicket, validateNormalizedTicket} from './ticket/normalize.mjs'

const FULL = `
TICKET: WHC-QA-1
TYPE: ui-change
TITLE: QA 탭 receipt 헤더에 상태별 롤업 표시
BEHAVIOR: QA 탭의 receipt 헤더에 상태 분해를 표시한다.
AC:
- AC1 → TC-QA-1: summarizeQa가 상태별 카운트 제공
- AC2 → TC-QA-2: receipt 부재 시 0
FEAT: FEAT-042
`

test('완전한 티켓: 필드·AC·harnessRefs·준비도 파싱', () => {
  const result = parseManualTicket(FULL)
  assert.equal(result.ok, true)
  const t = result.ticket
  assert.equal(t.ticketId, 'WHC-QA-1')
  assert.equal(t.provider, 'manual')
  assert.equal(t.type, 'ui-change')
  assert.equal(t.title, 'QA 탭 receipt 헤더에 상태별 롤업 표시')
  assert.match(t.body, /상태 분해를 표시/)
  assert.equal(t.acceptanceCriteria.length, 2)
  // 왕복: 스탬프된 FEAT/TC ID 추출 — 하지만 TC-QA-1은 TC-\d{3,}-\d+ 형식이 아니라 미추출
  assert.deepEqual(t.harnessRefs.featureIds, ['FEAT-042'])
  // TC-QA-1/2는 규격 밖(문자 QA) → testCaseIds 비어 있어야(형식 엄격)
  assert.deepEqual(t.harnessRefs.testCaseIds, [])
  assert.deepEqual(validateNormalizedTicket(t), [])
})

test('규격 TC ID 왕복 추출·중복 제거', () => {
  const text = `TICKET: PROJ-9\nTITLE: t\nBEHAVIOR: b\nAC:\n- a → TC-001-2\n- b → TC-001-2 재확인\n- c → TC-003-1\nFEAT: FEAT-001`
  const {ticket} = parseManualTicket(text)
  assert.deepEqual(ticket.harnessRefs.testCaseIds, ['TC-001-2', 'TC-003-1']) // 중복 제거
  assert.deepEqual(ticket.harnessRefs.featureIds, ['FEAT-001'])
  assert.equal(ticket.specCompleteness.ready, true) // body + AC + TC 모두 있음
})

test('맨몸 티켓: ID+제목만 → 파싱 성공하되 준비도 false', () => {
  const {ok, ticket} = parseManualTicket('TICKET: BARE-1\nTITLE: 제목만')
  assert.equal(ok, true)
  assert.equal(ticket.specCompleteness.ready, false)
  assert.deepEqual(ticket.specCompleteness.missing, ['behavior', 'acceptanceCriteria', 'testCaseIds'])
  assert.equal(ticket.type, null)
})

test('식별 불가만 하드 실패: ticketId/title 누락', () => {
  assert.equal(parseManualTicket('TITLE: 제목\nBEHAVIOR: 본문').ok, false) // ticketId 없음
  assert.equal(parseManualTicket('TICKET: X\nBEHAVIOR: 본문').ok, false)   // title 없음
  assert.deepEqual(parseManualTicket('').errors, ['빈 티켓 텍스트'])
  assert.equal(parseManualTicket(null).ok, false)
})

test('AC 블록은 다음 라벨에서 종료', () => {
  const text = `TICKET: T\nTITLE: t\nAC:\n- 첫 기준\nTYPE: feature\nBEHAVIOR: 본문`
  const {ticket} = parseManualTicket(text)
  assert.deepEqual(ticket.acceptanceCriteria, ['첫 기준']) // TYPE 라인에서 종료, BEHAVIOR 안 삼킴
  assert.equal(ticket.type, 'feature')
  assert.equal(ticket.body, '본문')
})

test('validateNormalizedTicket: 스키마 위반 탐지 + global 정규식 상태 무버그', () => {
  assert.deepEqual(validateNormalizedTicket(null), ['ticket이 객체가 아님'])
  const bad = {ticketId: '', provider: 'manual', title: 't', body: '', acceptanceCriteria: [], type: null,
    harnessRefs: {featureIds: ['FEAT-001'], testCaseIds: ['nope']}, specCompleteness: {ready: false, missing: []}}
  const problems = validateNormalizedTicket(bad)
  assert.ok(problems.includes('ticketId 문자열 필요'))
  assert.ok(problems.includes('testCaseIds는 TC-NNN-N 형식'))
  // 유효 ID 여러 개 연속 검증 시 lastIndex 상태로 인한 오탐이 없어야(비-global 패턴 사용)
  const good = {ticketId: 'X', provider: 'manual', title: 't', body: 'b', acceptanceCriteria: ['a'], type: null,
    harnessRefs: {featureIds: ['FEAT-001', 'FEAT-002'], testCaseIds: ['TC-001-1', 'TC-002-3']},
    specCompleteness: {ready: true, missing: []}}
  assert.deepEqual(validateNormalizedTicket(good), [])
})
