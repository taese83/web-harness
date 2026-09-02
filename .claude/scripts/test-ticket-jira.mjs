#!/usr/bin/env node
// Jira provider 회귀 — 순수부 + exec(fetch 주입, 네트워크 무접촉).
//
// 여기서 고정하는 사실:
//   (1) 설정이 없으면 loud하게 막는다 — status 이름을 지어내지 않는다
//   (2) 닫힘 판정은 status **이름**이 아니라 statusCategory다(이름은 팀마다 다르고 번역된다)
//   (3) 전이 매핑이 없으면 `transition` 능력을 **노출하지 않는다** — 없는 능력을 흉내 내지 않는다
//   (4) 설정값이 현재 워크플로우에 없으면 조용히 건너뛰지 않고 던진다
//   (5) Jira의 `closeReference`는 null이다 — 자동 닫기가 없다는 사실 자체가 반환값이다
//   (6) 선택의 영속 — 저장된 provider를 다시 묻지 않고, 다른 것을 요청하면 전환으로 표시한다
import assert from 'node:assert/strict'
import test from 'node:test'
import {requireTicketProvider, providerCapabilities} from './ticket/ticket-provider.mjs'
import {
  buildIssueFieldsFor, classifyJiraError, closeReference, featLabel, featureJql,
  isClosed, parseCreateResponse, parseSearchResponse, requireJiraConfig, resolveTransitionId, toAdf,
} from './ticket/provider-jira.mjs'
import {authHeader, createJiraProvider} from './ticket/provider-jira-exec.mjs'
import {buildTicketConfig, recordProvider, resolveProviderChoice, validateTicketConfig} from './ticket/ticket-config.mjs'

const baseConfig = {baseUrl: 'https://jira.example.com', projectKey: 'PROJ', issueType: 'Task'}
const draft = {sourceKey: 'FEAT-042', title: '메뉴 추가', body: '동작 명세', acceptanceCriteria: ['TC-042-1'], harnessRefs: {featureIds: ['FEAT-042'], testCaseIds: ['TC-042-1']}}

// ── (1) 설정 ──────────────────────────────────────────────────────────────────
test('반증: 필수 설정이 없으면 loud하게 막는다 — 이름을 지어내지 않는다', () => {
  assert.throws(() => requireJiraConfig({baseUrl: 'x'}), /JIRA_CONFIG_INCOMPLETE.*projectKey.*issueType/s)
})

test('전이 매핑은 선택이다 — 없어도 설정은 유효하다(능력만 줄어든다)', () => {
  assert.equal(requireJiraConfig(baseConfig), baseConfig)
})

// ── (2) 닫힘 판정 ─────────────────────────────────────────────────────────────
test('닫힘은 statusCategory로 판정한다 — status 이름은 팀마다 다르고 번역된다', () => {
  assert.equal(isClosed({fields: {status: {statusCategory: {key: 'done'}, name: '완료'}}}), true)
  assert.equal(isClosed({fields: {status: {statusCategory: {key: 'indeterminate'}, name: 'Done'}}}), false,
    '이름이 Done이어도 카테고리가 진행중이면 닫힌 게 아니다')
})

// ── (3)(5) 능력 정직성 ────────────────────────────────────────────────────────
test('전이 매핑이 없으면 transition 능력을 노출하지 않는다', () => {
  const provider = createJiraProvider({config: baseConfig, fetchImpl: async () => {}, env: {JIRA_TOKEN: 't'}})
  assert.equal(requireTicketProvider(provider), provider)
  assert.deepEqual(providerCapabilities(provider), {reopen: false, transition: false, autoClose: true})
  assert.equal(typeof provider.transition, 'undefined', '없는 능력을 노출하면 호출자가 전이했다고 보고한다')
})

test('전이 매핑이 있으면 노출한다', () => {
  const config = {...baseConfig, transitions: {'in-progress': '21', done: 'Done'}}
  const provider = createJiraProvider({config, fetchImpl: async () => {}, env: {JIRA_TOKEN: 't'}})
  assert.equal(providerCapabilities(provider).transition, true)
  assert.deepEqual(provider.transitionPhases, ['in-progress', 'done'])
})

test('Jira의 closeReference는 null이다 — 자동 닫기가 없다는 사실이 반환값이다', () => {
  assert.equal(closeReference('PROJ-1'), null,
    'null이면 호출자는 머지 후 transition을 능동 호출해야 함을 안다')
})

// ── (4) 전이 해석 ─────────────────────────────────────────────────────────────
const available = [{id: '21', name: '진행중'}, {id: '31', name: 'Done'}]

test('전이는 id로도 이름으로도 지정된다', () => {
  assert.equal(resolveTransitionId({transitions: {a: '21'}}, 'a', available), '21')
  assert.equal(resolveTransitionId({transitions: {a: 'done'}}, 'a', available), '31', '이름은 대소문자 무관')
})

test('반증: 설정값이 현재 워크플로우에 없으면 조용히 건너뛰지 않고 던진다', () => {
  assert.throws(() => resolveTransitionId({transitions: {a: 'In Progress'}}, 'a', available),
    /JIRA_TRANSITION_NOT_AVAILABLE.*21:진행중/s,
    '조용히 넘기면 "전이했다"는 거짓 보고가 된다')
})

// ── 필드 빌드 ─────────────────────────────────────────────────────────────────
test('FEAT 라벨과 왕복 마커가 실린다 — 마커는 트래커 무관 모듈 소유다', () => {
  const {fields} = buildIssueFieldsFor(baseConfig, draft, {branch: 'feature/x'})
  assert.ok(fields.labels.includes(featLabel('FEAT-042')))
  const text = JSON.stringify(fields.description)
  assert.ok(text.includes('web-harness:refs'), '왕복 마커가 없으면 pickup이 FEAT를 되읽지 못한다')
})

test('apiVersion이 본문 형식을 가른다 — Cloud(3)는 ADF, Data Center(2)는 평문', () => {
  assert.equal(typeof buildIssueFieldsFor({...baseConfig, apiVersion: '2'}, draft).fields.description, 'string')
  assert.equal(buildIssueFieldsFor(baseConfig, draft).fields.description.type, 'doc')
  assert.equal(toAdf('a\nb').content.length, 2)
})

test('assignee 표기는 설정이 정한다 — Cloud accountId · Data Center name', () => {
  assert.deepEqual(buildIssueFieldsFor(baseConfig, draft, {assignee: 'abc'}).fields.assignee, {accountId: 'abc'})
  assert.deepEqual(buildIssueFieldsFor({...baseConfig, assigneeField: 'name'}, draft, {assignee: 'abc'}).fields.assignee, {name: 'abc'})
})

// ── 조회 ──────────────────────────────────────────────────────────────────────
test('FEAT 조회는 라벨 JQL이 기본이고 커스텀 필드가 있으면 그쪽을 쓴다', () => {
  assert.match(featureJql(baseConfig, 'FEAT-042'), /labels = "feat-FEAT-042"/)
  assert.match(featureJql({...baseConfig, featureField: 'Feature ID'}, 'FEAT-042'), /"Feature ID" ~ "FEAT-042"/)
})

test('검색 응답 파싱 — 없으면 null', () => {
  assert.equal(parseSearchResponse({issues: []}), null)
  assert.equal(parseSearchResponse({issues: [{key: 'PROJ-7', fields: {summary: 's', labels: []}}]}).ticketKey, 'PROJ-7')
  assert.equal(parseCreateResponse({key: 'PROJ-8'}).ticketKey, 'PROJ-8')
})

// ── 인증 ──────────────────────────────────────────────────────────────────────
test('반증: 토큰이 없으면 호출 전에 막는다 — 설정 파일에 비밀을 두지 않는다', () => {
  assert.throws(() => authHeader({}), /JIRA_AUTH_MISSING/)
})

test('Cloud는 basic, Data Center는 bearer', () => {
  assert.match(authHeader({JIRA_TOKEN: 't', JIRA_EMAIL: 'a@b.c'}), /^Basic /)
  assert.match(authHeader({JIRA_TOKEN: 't'}), /^Bearer t$/)
})

// ── 실제 호출 경로(fetch 주입) ────────────────────────────────────────────────
const okFetch = payload => async () => ({ok: true, status: 200, json: async () => payload, text: async () => ''})

test('createIssue는 키를 돌려준다 — 없으면 loud', async () => {
  const provider = createJiraProvider({config: baseConfig, fetchImpl: okFetch({key: 'PROJ-9'}), env: {JIRA_TOKEN: 't'}})
  assert.equal((await provider.createIssue({fields: {}})).ticketKey, 'PROJ-9')
  const bad = createJiraProvider({config: baseConfig, fetchImpl: okFetch({}), env: {JIRA_TOKEN: 't'}})
  await assert.rejects(() => bad.createIssue({fields: {}}), /JIRA_CREATE_NO_KEY/)
})

test('transition은 가능한 전이를 먼저 조회한 뒤 그 id로 전이한다', async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push(`${init.method ?? 'GET'} ${url.split('/rest/api/3')[1]}`)
    return {ok: true, status: 200, json: async () => ({transitions: available}), text: async () => ''}
  }
  const provider = createJiraProvider({config: {...baseConfig, transitions: {'in-progress': '21'}}, fetchImpl, env: {JIRA_TOKEN: 't'}})
  const result = await provider.transition('PROJ-9', 'in-progress')
  assert.deepEqual(result, {ticketKey: 'PROJ-9', transitioned: true, phase: 'in-progress', transitionId: '21'})
  assert.deepEqual(calls, ['GET /issue/PROJ-9/transitions', 'POST /issue/PROJ-9/transitions'])
})

test('매핑 없는 phase는 전이하지 않았다고 사실대로 돌려준다', async () => {
  const provider = createJiraProvider({config: {...baseConfig, transitions: {'in-progress': '21'}}, fetchImpl: okFetch({}), env: {JIRA_TOKEN: 't'}})
  assert.deepEqual(await provider.transition('PROJ-9', 'done'), {ticketKey: 'PROJ-9', transitioned: false, reason: 'no-mapping:done'})
})

test('HTTP 오류는 상태코드를 담아 분류된다', async () => {
  const fetchImpl = async () => ({ok: false, status: 403, text: async () => 'Forbidden', json: async () => ({})})
  const provider = createJiraProvider({config: baseConfig, fetchImpl, env: {JIRA_TOKEN: 't'}})
  await assert.rejects(() => provider.findByFeature('FEAT-1'), error => classifyJiraError(error.message).kind === 'forbidden')
})

// ── (6) 선택의 영속 ───────────────────────────────────────────────────────────
test('저장된 선택이 없으면 묻는다', () => {
  assert.deepEqual(resolveProviderChoice({}), {provider: null, needsChoice: true})
})

test('저장된 선택이 있으면 다시 묻지 않는다', () => {
  assert.deepEqual(resolveProviderChoice({stored: {provider: 'jira'}}), {provider: 'jira', needsChoice: false})
})

test('다른 트래커를 요청해도 조용히 바꾸지 않는다 — 기존 티켓이 남아 있다', () => {
  const result = resolveProviderChoice({stored: {provider: 'github'}, requested: 'jira'})
  assert.equal(result.provider, 'github', '전환은 명시적 확인을 거친다')
  assert.deepEqual(result.switching, {from: 'github', to: 'jira'})
})

test('원장의 provider가 없으면 github다 — 이 필드 이전 레코드는 전부 GitHub이다', () => {
  assert.equal(recordProvider({featureId: 'FEAT-1'}), 'github')
  assert.equal(recordProvider({provider: 'jira'}), 'jira')
})

test('반증: 모르는 provider는 조용히 통과하지 않는다', () => {
  assert.throws(() => validateTicketConfig({provider: 'trello'}), /TICKET_PROVIDER_UNKNOWN/)
  assert.throws(() => validateTicketConfig({provider: 'jira'}), /TICKET_CONFIG_INCOMPLETE/)
})

test('사용자 답의 점 표기가 중첩 설정으로 펴진다', () => {
  const config = buildTicketConfig('jira', {projectKey: 'PROJ', 'transitions.done': '31', featureField: ''})
  assert.deepEqual(config, {provider: 'jira', jira: {projectKey: 'PROJ', transitions: {done: '31'}}},
    '빈 답은 설정에 들어가지 않는다 — 빈 값이 매핑으로 잡히면 없는 전이를 시도한다')
})
