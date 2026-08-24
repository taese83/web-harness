// 통합 빌드 3단계 회귀 — GitHub Issues provider 순수 부분.
//
// 고정하는 사실: (1) buildIssueFields가 draft→gh 이슈 필드(본문에 왕복 마커·AC 체크박스,
// FEAT 고유 라벨), (2) assignee 미지정 시 null(혼자 개발/나중 분배), (3) parseIssueRefs가
// 왕복 마커에서 FEAT/TC 되읽기·마커 없으면 본문 폴백, (4) ghCreateArgs가 gh 인자 구성(실행 아님),
// (5) featLabel이 FEAT당 고유 라벨(claim 경쟁 키).
import assert from 'node:assert/strict'
import test from 'node:test'
import {buildIssueFields, parseIssueRefs, ghCreateArgs, featLabel, branchLabel, parseBranchFromLabels, parseIssueListJson, parseCreatedIssueUrl} from './ticket/provider-github.mjs'
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

test('브랜치 스탬프(§4-1 레지스트리): 마커 branch= 필드 + branch: 라벨 왕복', () => {
  const f = buildIssueFields(draft, {branch: 'feature/motor-dashboard'})
  // 마커에 branch= 정본 스탬프 + 라벨(50자 이내) 병행
  assert.match(f.body, /<!-- web-harness:refs feat=FEAT-042 tc=TC-008-1,TC-008-2 branch=feature\/motor-dashboard -->/)
  assert.ok(f.labels.includes('branch:feature/motor-dashboard'))
  // 되읽기: parseIssueRefs가 branch 복원(왕복), 라벨 파서도 동일 값
  assert.equal(parseIssueRefs(f.body).branch, 'feature/motor-dashboard')
  assert.equal(parseBranchFromLabels(f.labels), 'feature/motor-dashboard')
  // branch 미지정 → 기존 마커 형식 그대로(하위호환), branch null
  const bare = buildIssueFields(draft)
  assert.doesNotMatch(bare.body, /branch=/)
  assert.equal(parseIssueRefs(bare.body).branch, null)
  // 50자 초과 브랜치명 → 라벨 생략(자르지 않음 — 충돌 방지), 마커는 전체 유지
  const long = 'feature/' + 'x'.repeat(60)
  assert.equal(branchLabel(long), null)
  const longFields = buildIssueFields(draft, {branch: long})
  assert.ok(!longFields.labels.some(l => l.startsWith('branch:')))
  assert.equal(parseIssueRefs(longFields.body).branch, long) // 마커가 정본
  // 본문 산문의 branch= 언급은 마커 밖이라 무시(오탐 방지)
  assert.equal(parseIssueRefs('산문에 branch=main 이 있어도\n\n<!-- web-harness:refs feat=FEAT-001 tc=TC-001-1 -->').branch, null)
})

test('브랜치 스탬프 방어(리뷰 LOW 3건): 마커 손상 loud·빈 라벨 잔여·절단 마커 fail-closed', () => {
  // 마커를 침묵 손상시키는 브랜치명(공백·-->)은 조용히 틀리는 대신 loud 거부
  assert.throws(() => buildIssueFields(draft, {branch: 'a-->b'}), /INVALID_BRANCH_STAMP/)
  assert.throws(() => buildIssueFields(draft, {branch: 'has space'}), /INVALID_BRANCH_STAMP/)
  // 빈 라벨 잔여('branch:')는 ''가 아니라 null(반환 계약 준수)
  assert.equal(parseBranchFromLabels(['branch:']), null)
  // 마커 시작만 있고 --> 부재(절단 본문) → refs 빈 값(→ pickup spec-incomplete 되돌림, fail-closed 방향)
  const truncated = parseIssueRefs('<!-- web-harness:refs feat=FEAT-001 tc=TC-001-1 branch=main')
  assert.deepEqual(truncated, {featureIds: [], testCaseIds: [], branch: null})
})

test('assignee 지정 시 반영 (선택적 분배)', () => {
  assert.equal(buildIssueFields(draft, {assignee: 'devX'}).assignee, 'devX')
})

test('parseIssueRefs: 왕복 마커에서 FEAT/TC 되읽기', () => {
  const body = buildIssueFields(draft).body
  assert.deepEqual(parseIssueRefs(body), {featureIds: ['FEAT-042'], testCaseIds: ['TC-008-1', 'TC-008-2'], branch: null})
})

test('parseIssueRefs: 마커 없는 맨몸 이슈 → 본문 폴백(형식 엄격)', () => {
  const refs = parseIssueRefs('사람이 쓴 이슈. FEAT-005 관련, TC-005-1을 만족해야 함. (TC-QA는 비규격이라 미추출)')
  assert.deepEqual(refs, {featureIds: ['FEAT-005'], testCaseIds: ['TC-005-1'], branch: null})
  assert.deepEqual(parseIssueRefs(null), {featureIds: [], testCaseIds: [], branch: null})
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
