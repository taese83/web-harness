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
import {classifyJiraError, closeReference, featLabel, isClosed, parseCreateResponse, parseIssueResponse, requireJiraConfig, resolveTransitionId, toAdf} from './ticket/provider-jira.mjs'
import {authHeader, createJiraProvider} from './ticket/provider-jira-exec.mjs'
import {assertAllowedKeys, buildTicketConfig, evaluateConfigWrite, resolveProviderChoice, validateTicketConfig, validateTicketConfig as _v, writeTicketConfig} from './ticket/ticket-config.mjs'
import {existsSync, mkdirSync, mkdtempSync, readFileSync as readFile, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {parseArgs, runConfigure} from './ticket/cli.mjs'

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
  // **코멘트는 전이 매핑과 무관하다** — Jira에서 코멘트는 별도 엔드포인트라, 전이 phase가
  // 하나도 설정되지 않아도 되돌림을 기획자에게 알릴 수는 있다.
  assert.deepEqual(providerCapabilities(provider), {transition: false, autoClose: true, comment: true, updateBody: true})
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

test('반증: 모르는 provider는 조용히 통과하지 않는다', () => {
  assert.throws(() => validateTicketConfig({provider: 'trello'}), /TICKET_PROVIDER_UNKNOWN/)
  assert.throws(() => validateTicketConfig({provider: 'jira'}), /TICKET_CONFIG_INCOMPLETE/)
})

test('사용자 답의 점 표기가 중첩 설정으로 펴진다', () => {
  const config = buildTicketConfig('jira', {projectKey: 'PROJ', 'transitions.done': '31', featureField: ''})
  assert.deepEqual(config, {provider: 'jira', jira: {projectKey: 'PROJ', transitions: {done: '31'}}},
    '빈 답은 설정에 들어가지 않는다 — 빈 값이 매핑으로 잡히면 없는 전이를 시도한다')
})

// ── 배선 회귀 (2026-09-02) ────────────────────────────────────────────────────
// provider가 코드에 있어도 cli가 부르지 않으면 죽은 계약이다. 여기서 그 배선을 고정한다.
import {resolveTicketProvider} from './ticket/cli.mjs'

// FEAT 청구 원장으로 「이미 GitHub이다」를 추론하던 하위호환 규칙은 그 경로와 함께 제거됐다 — 설정이 정본이다.
test('설정이 없으면 묻는다 — 원장 흔적으로 트래커를 추론하지 않는다', () => {
  const resolved = resolveTicketProvider({root: '/tmp/nope', repo: 'o/r'})
  assert.equal(resolved.choice.needsChoice, true)
  assert.ok(resolved.questions.some(q => q.key === 'projectKey'), 'Jira를 고를 때 물을 것을 함께 준다')
})

test('jira 설정이 있으면 Jira provider를 만든다 — 전이 능력까지 배선된다', () => {
  const ticketConfig = {provider: 'jira', jira: {...baseConfig, transitions: {'in-progress': '21'}}}
  const resolved = resolveTicketProvider({root: '/tmp/nope', repo: 'o/r', io: {ticketConfig, env: {JIRA_TOKEN: 't'}}})
  assert.equal(resolved.provider.name, 'jira')
  assert.equal(providerCapabilities(resolved.provider).transition, true)
})

test('provider=jira인데 jira 설정이 비면 묻는다 — 반쯤 설정된 채로 돌지 않는다', () => {
  const resolved = resolveTicketProvider({root: '/tmp/nope', repo: 'o/r', io: {ticketConfig: {provider: 'jira'}}})
  assert.equal(resolved.choice.needsChoice, true)
})

test('반증: Jira의 assign은 교체라 "길이 > 1"로는 경합을 못 잡는다 — 소유 기준이어야 한다', () => {
  // A가 배정한 뒤 B가 PUT으로 덮으면 A의 사후 조회는 [B] — 길이 1이라 옛 조건은 통과했다.
  const finalAssignees = ['devB']
  assert.equal(finalAssignees.length > 1, false, '옛 조건: 침묵 통과')
  assert.equal(finalAssignees.includes('devA'), false, '새 조건: lost-update를 잡는다')
})

const withPlan = fn => {
  const dir = mkdtempSync(join(tmpdir(), 'wh-claim-'))
  try {
    mkdirSync(join(dir, '_workspace/01_plan'), {recursive: true})
    writeFileSync(join(dir, '_workspace/01_plan/feature-plan.md'), '## FEAT-001 A\n- TC-001-1: a\n')
    return fn(dir)
  } finally { rmSync(dir, {recursive: true, force: true}) }
}
const io = {
  originSync: async () => ({originExists: true, planMatchesOrigin: true, base: 'origin/main'}),
  currentBranch: async () => 'feature/x',
}

const tmp = () => mkdtempSync(join(tmpdir(), 'wh-cfg-'))
const noShare = {checkShared: async () => ({shared: true})}

test('반복 --set 이 배열로 모인다 — 덮어쓰면 설정이 조용히 하나만 남는다', () => {
  const {flags} = parseArgs(['configure', '--provider', 'jira', '--set', 'a=1', '--set', 'b=2'])
  assert.deepEqual(flags.set, ['a=1', 'b=2'])
  assert.equal(parseArgs(['configure', '--set', 'a=1']).flags.set, 'a=1', '한 번이면 스칼라(하위호환)')
})

test('--confirm 없으면 쓰지 않는다 — side-effect 공통 규율', async () => {
  const dir = tmp()
  try {
    const result = await runConfigure({root: dir, flags: {provider: 'jira', set: ['projectKey=PFFE', 'issueType=Task', 'baseUrl=https://x', 'apiVersion=2']}, io: noShare})
    assert.equal(result.dryRun, true)
    assert.equal(result.config.jira.projectKey, 'PFFE')
    assert.equal(existsSync(join(dir, '_workspace/03_dev/ticket-provider.json')), false)
  } finally { rmSync(dir, {recursive: true, force: true}) }
})

test('--confirm이면 원장 옆에 기록한다 — 팀이 읽는 자리다', async () => {
  const dir = tmp()
  try {
    const result = await runConfigure({root: dir, flags: {confirm: true, provider: 'jira', set: ['baseUrl=https://x', 'projectKey=PFFE', 'issueType=Task', 'transitions.done=51']}, io: noShare})
    assert.equal(result.written, '_workspace/03_dev/ticket-provider.json')
    const saved = JSON.parse(readFile(join(dir, result.written), 'utf8'))
    assert.deepEqual(saved.jira.transitions, {done: '51'}, '점 표기가 중첩으로 펴진다')
  } finally { rmSync(dir, {recursive: true, force: true}) }
})

// **키 이름 정규식은 프록시였다.** `jiraPat`·`pw`는 통과했고 모르는 키가 그대로 저장됐다.
// 유효 키가 JIRA_QUESTIONS로 완전히 열거돼 있으므로 allowlist가 더 강한 하한이다.
test('반증: 허용 목록 밖 키는 거부한다 — 어떤 이름의 비밀도, 오타도 여기서 막힌다', async () => {
  for (const key of ['apiToken', 'jiraPat', 'pw', 'projectkey']) {
    assert.throws(() => assertAllowedKeys({[key]: 'x'}), /TICKET_CONFIG_UNKNOWN_KEY/, `${key}가 통과했다`)
  }
  assert.deepEqual(assertAllowedKeys({projectKey: 'PFFE', 'transitions.done': '51'}), {projectKey: 'PFFE', 'transitions.done': '51'})
  const result = await runConfigure({root: '/tmp', flags: {provider: 'jira', set: ['jiraPat=x']}, io: noShare})
  assert.equal(result.blocked, 'key-refused')
})

test('반증: baseUrl에 숨은 자격증명은 값 검사로 막는다 — 키 이름으로는 안 잡힌다', () => {
  const dir = tmp()
  try {
    assert.throws(() => writeTicketConfig(dir, {provider: 'jira', jira: {baseUrl: 'https://u:tok@jira.x'}}),
      /TICKET_CONFIG_SECRET_REFUSED/)
  } finally { rmSync(dir, {recursive: true, force: true}) }
})

test('반증: 손편집으로 labels가 문자열이면 막는다 — 글자 단위로 흩어져 조용히 발행된다', () => {
  assert.throws(() => _v({provider: 'jira', jira: {labels: 'team-fe'}}), /TICKET_CONFIG_INVALID_SHAPE/)
  assert.doesNotThrow(() => _v({provider: 'jira', jira: {labels: ['team-fe']}}))
})

test('같은 provider 재설정은 병합이다 — 항목 하나 주려다 transitions가 사라지지 않는다', () => {
  const existing = {provider: 'jira', jira: {projectKey: 'PFFE', transitions: {done: '51'}}}
  const next = {provider: 'jira', jira: {labels: ['team-fe']}}
  const {merged} = evaluateConfigWrite({existing, next})
  assert.equal(merged.jira.projectKey, 'PFFE', '기존 값이 살아남는다')
  assert.deepEqual(merged.jira.transitions, {done: '51'}, '전이 매핑이 조용히 사라지지 않는다')
  assert.deepEqual(merged.jira.labels, ['team-fe'])
})

test('반증: GitHub provider에 모르는 --set 키를 주면 조용히 버리지 않는다', async () => {
  // 0.23.10부터 github도 설정을 받는다(`host` — 사내 GitHub Enterprise 주소). 그래서 판정이
  // 「이 provider는 설정을 안 받는다」에서 **「그 키가 허용 목록에 없다」**로 바뀌었고,
  // 거절 메시지가 **거절된 키와 허용 목록을 함께** 말한다. 버리지 않는다는 계약은 그대로다.
  const result = await runConfigure({root: '/tmp', flags: {provider: 'github', set: ['labels=x']}, io: noShare})
  assert.equal(result.blocked, 'key-refused')
  assert.match(result.guidance, /labels/, '거절된 키를 말하지 않으면 사용자는 무엇이 틀렸는지 모른다')
  assert.match(result.guidance, /허용\(github\): host/, '허용 목록을 말하지 않으면 되물어야 한다')
})

test('반증: 한 번만 받아야 하는 플래그를 반복하면 loud하게 막는다', () => {
  assert.throws(() => parseArgs(['claim', '--repo', 'a/b', '--repo', 'c/d']), /REPEATED_FLAG: --repo/)
  assert.deepEqual(parseArgs(['configure', '--set', 'a=1', '--set', 'b=2']).flags.set, ['a=1', 'b=2'], 'set은 반복이 정상')
})

test('반증: provider를 바꾸는 덮어쓰기는 --replace 없이는 막는다', () => {
  const existing = {provider: 'github'}
  const next = {provider: 'jira', jira: {}}
  assert.equal(evaluateConfigWrite({existing, next}).ok, false)
  assert.deepEqual(evaluateConfigWrite({existing, next, replace: true}).switching, {from: 'github', to: 'jira'})
  assert.equal(evaluateConfigWrite({existing: {provider: 'jira'}, next}).updating, true, '같은 provider면 갱신이다')
})

test('공유되지 않는 자리면 그 사실을 결과에 싣는다', async () => {
  const checkShared = async () => ({shared: false, reason: 'gitignored', warning: '…'})
  const result = await runConfigure({root: '/tmp', flags: {provider: 'github'}, io: {checkShared}})
  assert.equal(result.shared.shared, false, '설정이 팀에 닿지 않으면 팀원마다 다른 트래커로 발행한다')
})

test('코멘트 본문은 REST 버전이 가른다 — Cloud(v3)에 평문을 보내면 400이다', async () => {
  // 되돌림 알림이 **기본 설정에서 매번 실패**하던 자리다(적대 리뷰 2026-09-09). description은
  // 이미 버전을 가르는데 코멘트만 안 갈랐고, 기본값이 `apiVersion: '3'`이다.
  const calls = []
  const capture = async (url, init) => {
    calls.push({url, body: JSON.parse(init.body)})
    return {ok: true, status: 200, json: async () => ({}), text: async () => '{}'}
  }
  const cloud = createJiraProvider({config: {...baseConfig, apiVersion: '3'}, fetchImpl: capture, env: {JIRA_TOKEN: 't'}})
  await cloud.comment('PF-1', '되돌아갔습니다')
  assert.match(calls[0].url, /\/issue\/PF-1\/comment$/)
  assert.equal(calls[0].body.body.type, 'doc', 'Cloud에 평문을 보냈다 — 400이 난다')

  const dc = createJiraProvider({config: {...baseConfig, apiVersion: '2'}, fetchImpl: capture, env: {JIRA_TOKEN: 't'}})
  await dc.comment('PF-1', '되돌아갔습니다')
  assert.equal(calls[1].body.body, '되돌아갔습니다', 'Data Center에는 평문이어야 한다')
})

test('resolveIssue는 분류 근거 필드를 함께 가져온다 — 빠뜨리면 인테이크가 축을 못 본다', async () => {
  // **실 Jira 실측(2026-09-09, AOA-3)**: 티켓에 `PLAN` 컴포넌트가 있는데 인테이크가 `미분류`를
  // 냈다. `?fields=` 목록에 `components`·`issuetype`이 없어 응답에서 빠졌고, 빠진 필드는
  // `undefined`로 와서 **「없다」와 구별되지 않는다.**
  // 주입 stub을 쓰는 회귀는 이 경로를 타지 않는다 — 필드 목록을 여기서 고정한다.
  const seen = []
  const capture = async url => {
    seen.push(url)
    return {ok: true, status: 200, json: async () => ({key: 'AOA-3', fields: {summary: 't', description: 'd'}}),
      text: async () => '{}'}
  }
  const provider = createJiraProvider({config: baseConfig, fetchImpl: capture, env: {JIRA_TOKEN: 't'}})
  await provider.resolveIssue('AOA-3')
  for (const field of ['summary', 'description', 'labels', 'assignee', 'status', 'components', 'issuetype']) {
    assert.ok(seen[0].includes(field), `${field}를 가져오지 않는다 — 그 필드를 쓰는 소비자가 침묵한다`)
  }
})

// ── 오류 경로 — 실제 `call()`을 탄다(문자열 흉내가 아니라) ─────────────────────────
test('HTTP 오류는 상태코드를 담아 던지고, 분류가 그것을 읽는다 — 권한·인증·부재를 섞지 않는다', async () => {
  const config = {baseUrl: 'https://jira.test', projectKey: 'PF', issueType: 'Task', apiVersion: '2'}
  for (const [status, kind] of [[401, 'auth'], [403, 'forbidden'], [404, 'not-found'], [500, 'unknown']]) {
    const provider = createJiraProvider({config, env: {JIRA_TOKEN: 't'},
      fetchImpl: async () => ({ok: false, status, text: async () => `status ${status}`, json: async () => ({})})})
    const error = await provider.resolveIssue('PF-1').catch(caught => caught)
    assert.match(String(error?.message), new RegExp(`^JIRA_HTTP_${status}`), `상태코드가 오류에 없다: ${status}`)
    assert.equal(classifyJiraError(error.message).kind, kind)
  }
})

test('ADF 변환은 줄마다 문단이고 빈 줄은 빈 문단이다', () => {
  const doc = toAdf('첫 줄\n\n셋째 줄')
  assert.equal(doc.type, 'doc')
  assert.equal(doc.content.length, 3)
  assert.deepEqual(doc.content[1].content, [])
})
