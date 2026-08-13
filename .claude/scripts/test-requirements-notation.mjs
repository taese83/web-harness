#!/usr/bin/env node
// test-requirements-notation.mjs — 요구사항 의무 진술 검사 회귀 (EARS 착안).
//
// 이 파일이 고정하는 것의 절반은 **내가 틀렸던 방식**이다. 실제 파일럿에 걸었을 때 세 번
// 오탐했고(줄끝 마커로 $ 앵커 실패 → 100% 오탐 / AC 줄을 헤드라인으로 오인 → 본문 강탈 /
// 종결 어미 뒤 여는 괄호 미허용), 그 각각을 케이스로 남긴다. 게이트가 문서를 틀렸다고
// 말하기 전에 게이트 자신이 맞는지부터 검증해야 한다.
import assert from 'node:assert/strict'
import test from 'node:test'
import {analyzeAcceptanceCriteria, analyzeRequirements, classifyPattern, earsPatternOf, splitRequirements, statesObligation} from './validate-requirements-notation.mjs'

test('의무 진술: 영어 shall/must', () => {
  assert.ok(statesObligation('The system shall display the list.'))
  assert.ok(statesObligation('The system must reject the request.'))
})

test('의무 진술: 한국어 서술체·의무체', () => {
  assert.ok(statesObligation('목록이 표시된다.'))
  assert.ok(statesObligation('정원 초과를 차단해야 한다'))
})

test('회귀(오탐1): 줄 끝 마커가 있어도 종결을 인식한다', () => {
  // $ 앵커를 썼다가 실제 파일럿에서 100% 오탐이 났다.
  assert.ok(statesObligation('- Given 진입할 때, Then 목록이 표시된다. `[LOCAL_VERIFIABLE]`'))
})

test('회귀(오탐3): 종결 어미 뒤 여는 괄호도 종결이다', () => {
  assert.ok(statesObligation('Then 승격 처리가 트리거된다(REQ-F-012 참조).'))
})

test('라벨만 있으면 의무 진술이 아니다', () => {
  assert.equal(statesObligation('- [ ] REQ-F-014 대기열 순서 FIFO'), false)
  assert.equal(statesObligation('- [ ] REQ-NFR-003 접근성: WCAG 2.2 AA'), false)
})

test('어두 `다`는 종결로 오인하지 않는다', () => {
  assert.equal(statesObligation('다른 다양한 항목'), false)
})

test('회귀(오탐2): AC 줄이 REQ ID를 참조해도 헤드라인이 아니다', () => {
  // 참조를 헤드라인으로 오인하면 상위 REQ가 본문을 빼앗겨 양쪽 다 오탐이 난다.
  const blocks = splitRequirements([
    '- [ ] REQ-F-004 신청 취소',
    '  - Given 취소할 때, Then 승격이 트리거된다(REQ-F-012 참조).',
  ].join('\n'))
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].id, 'REQ-F-004')
  assert.equal(blocks[0].body.length, 1)
})

test('헤드라인은 체크박스 유무와 무관하게 인식된다', () => {
  assert.equal(splitRequirements('- REQ-F-001 조회\n- [x] REQ-F-002 생성\n').length, 2)
})

test('패턴 분류: event / state / optional', () => {
  assert.equal(classifyPattern('When the user submits, the system shall save.'), 'event')
  assert.equal(classifyPattern('While uploading, the system shall show progress.'), 'state')
  assert.equal(classifyPattern('Where premium is enabled, the system shall unlock.'), 'optional')
})

test('패턴 분류: 키워드 없으면 ubiquitous (상시 요구사항은 EARS의 정당한 패턴)', () => {
  assert.equal(classifyPattern('The system shall meet WCAG 2.2 AA.'), 'ubiquitous')
})

test('unwanted는 의미로 잡는다 — 한국어는 event와 구문이 같다', () => {
  assert.equal(classifyPattern('Given 파싱이 실패했을 때, Then 복구 안내가 표시된다.'), 'unwanted')
  assert.equal(classifyPattern('정원을 초과하면 승인을 차단한다.'), 'unwanted')
})

test('analyzeRequirements: Must 범위만 대상으로 한다', () => {
  const text = [
    '### Must Have',
    '- [ ] REQ-F-001 조회',
    '  - Given 진입할 때, Then 목록이 표시된다.',
    '### Could Have',
    '- [ ] REQ-F-900 나중에',
  ].join('\n')
  const r = analyzeRequirements(text)
  assert.equal(r.total, 1)
  assert.deepEqual(r.violations, [])
})

test('analyzeRequirements: 라벨만 있는 요구사항을 NO_OBLIGATION으로 잡는다', () => {
  const r = analyzeRequirements('### Must Have\n- [ ] REQ-F-016 정원 초과 방지 불변식\n')
  assert.deepEqual(r.violations, [{code: 'NO_OBLIGATION', id: 'REQ-F-016'}])
})

test('REQ 블록이 없으면 total 0 — 호출부가 검사 미수행으로 보고한다', () => {
  assert.equal(analyzeRequirements('### Must Have\n(작성 전)\n').total, 0)
})

// --- AC 층 EARS 구조 검사 (2026-08-12 — "의무 존재"에서 "구조 적합"으로 확장) ---

test('AC 분해: Given/When/Then이 EARS 요소로 대응된다', () => {
  const acs = analyzeAcceptanceCriteria(['  - Given 로그인 상태에서, When 저장을 누르면, Then 문서가 저장된다.'])
  assert.equal(acs.length, 1)
  assert.deepEqual([acs[0].precondition, acs[0].trigger, acs[0].response], [true, true, true])
  assert.equal(earsPatternOf(acs[0]), 'complex')
})

test('earsPatternOf: trigger만 → event, precondition만 → state, 둘 다 없으면 ubiquitous', () => {
  assert.equal(earsPatternOf({precondition: false, trigger: true}), 'event')
  assert.equal(earsPatternOf({precondition: true, trigger: false}), 'state')
  assert.equal(earsPatternOf({precondition: false, trigger: false}), 'ubiquitous')
})

test('의무는 진술했으나 AC가 없으면 NO_ACCEPTANCE_CRITERIA', () => {
  const r = analyzeRequirements('### Must Have\n- [ ] REQ-F-001 목록 조회가 동작한다\n')
  assert.deepEqual(r.violations.map(v => v.code), ['NO_ACCEPTANCE_CRITERIA'])
})

test('결과(Then/서술체)를 말하지 않는 AC는 AC_NO_RESPONSE', () => {
  const r = analyzeRequirements('### Must Have\n- [ ] REQ-F-001 조회가 동작한다\n  - 상세 화면 관련 참고\n')
  assert.ok(r.violations.some(v => v.code === 'AC_NO_RESPONSE'))
})

test('구조를 갖춘 AC는 위반 0 + 패턴 분포에 계상', () => {
  const r = analyzeRequirements([
    '### Must Have',
    '- [ ] REQ-F-001 조회',
    '  - Given 진입할 때, Then 목록이 표시된다.',
    '  - When 검색하면, Then 결과가 갱신된다.',
  ].join('\n'))
  assert.deepEqual(r.violations, [])
  assert.equal(r.acTotal, 2)
})

test('unwanted는 AC의 위험 어휘로 분류된다 (한국어 구문 한계 보완)', () => {
  const r = analyzeRequirements('### Must Have\n- [ ] REQ-F-001 신청\n  - Given 정원이 초과됐을 때, Then 신청이 거부된다.\n')
  assert.equal(r.distribution.unwanted, 1)
})

test('회귀(오탐4): 볼드로 감싼 헤드라인도 REQ 블록이다 (첫 영어 실전 문서)', () => {
  const blocks = splitRequirements('- [ ] **REQ-F-001 — Client-side file intake**\n  - Given a file, Then it loads.\n')
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].id, 'REQ-F-001')
})
