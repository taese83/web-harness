// 통합 빌드 3단계 회귀 — GitHub Issues provider 순수 부분.
//
// 고정하는 사실: (1) buildIssueFields가 draft→gh 이슈 필드(본문에 왕복 마커·AC 체크박스,
// FEAT 고유 라벨), (2) assignee 미지정 시 null(혼자 개발/나중 분배), (3) parseIssueRefs가
// 왕복 마커에서 FEAT/TC 되읽기·마커 없으면 본문 폴백, (4) ghCreateArgs가 gh 인자 구성(실행 아님),
// (5) featLabel이 FEAT당 고유 라벨(claim 경쟁 키).
import assert from 'node:assert/strict'
import test from 'node:test'
import {buildIssueFields, parseIssueRefs, ghCreateArgs, featLabel, parseIssueListJson, parseCreatedIssueUrl} from './ticket/provider-github.mjs'
import {buildTicketDraft} from './ticket/emit.mjs'

const draft = buildTicketDraft({featureId: 'FEAT-042', title: '레이스 기록', body: '레이스를 기록한다', testCaseIds: ['TC-008-1', 'TC-008-2']})

test('buildIssueFields: draft → gh 이슈 필드(마커·AC·라벨)', () => {
  const f = buildIssueFields(draft)
  assert.equal(f.title, '레이스 기록')
  assert.match(f.body, /레이스를 기록한다/)
  assert.match(f.body, /- \[ \] TC-008-1/)                    // AC 체크박스
  assert.match(f.body, /<!-- web-harness:refs feat=FEAT-042 tc=TC-008-1,TC-008-2 -->/) // 왕복 마커
  assert.deepEqual(f.labels, ['feat:FEAT-042'])                // FEAT 고유 라벨
  assert.equal(f.assignee, null)                               // 분배 미지정 기본
})

test('assignee 지정 시 반영 (선택적 분배)', () => {
  assert.equal(buildIssueFields(draft, {assignee: 'devX'}).assignee, 'devX')
})

test('parseIssueRefs: 왕복 마커에서 FEAT/TC 되읽기', () => {
  const body = buildIssueFields(draft).body
  assert.deepEqual(parseIssueRefs(body), {featureIds: ['FEAT-042'], testCaseIds: ['TC-008-1', 'TC-008-2']})
})

test('parseIssueRefs: 마커 없는 맨몸 이슈 → 본문 폴백(형식 엄격)', () => {
  const refs = parseIssueRefs('사람이 쓴 이슈. FEAT-005 관련, TC-005-1을 만족해야 함. (TC-QA는 비규격이라 미추출)')
  assert.deepEqual(refs, {featureIds: ['FEAT-005'], testCaseIds: ['TC-005-1']})
  assert.deepEqual(parseIssueRefs(null), {featureIds: [], testCaseIds: []})
})

test('ghCreateArgs: gh 인자 구성(실행 아님)', () => {
  const args = ghCreateArgs(buildIssueFields(draft, {assignee: 'me'}))
  assert.deepEqual(args.slice(0, 2), ['issue', 'create'])
  assert.ok(args.includes('--title') && args.includes('레이스 기록'))
  assert.ok(args.includes('--label') && args.includes('feat:FEAT-042'))
  assert.ok(args.includes('--assignee') && args.includes('me'))
})

test('featLabel: FEAT당 고유 라벨(claim 경쟁 키)', () => {
  assert.equal(featLabel('FEAT-042'), 'feat:FEAT-042')
  assert.notEqual(featLabel('FEAT-042'), featLabel('FEAT-043'))
})

test('parseIssueListJson: gh --json 출력 파싱, 손상/비배열 안전', () => {
  assert.deepEqual(parseIssueListJson('[{"number":7,"title":"t","url":"u"}]'), [{number: 7, title: 't', url: 'u'}])
  assert.deepEqual(parseIssueListJson('[]'), [])
  assert.deepEqual(parseIssueListJson('{not json'), [])
  assert.deepEqual(parseIssueListJson('{"number":1}'), []) // 비배열 → []
})

test('parseCreatedIssueUrl: gh issue create URL에서 번호 추출', () => {
  assert.deepEqual(parseCreatedIssueUrl('https://github.com/taese83/harness-ticket-test/issues/42\n'), {number: 42, url: 'https://github.com/taese83/harness-ticket-test/issues/42'})
  assert.equal(parseCreatedIssueUrl('출력 없음'), null)
})
