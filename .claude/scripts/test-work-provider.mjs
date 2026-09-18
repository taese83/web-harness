#!/usr/bin/env node
// test-work-provider.mjs — WORK 축의 provider 능력(조회·관계·목록)과 정직한 미지원·절단 표기.
//
// 고정하는 사실:
//   (1) WORK 조회는 FEAT 조회를 재사용하지 않는다 — 계획·작업 라벨로 찾고 **실제 질의**에 그것이 실린다
//   (2) T16 절단: 받은 수 < total이면 `complete:false`와 다음 커서 — 「없음」이나 「전부」로 읽지 않는다
//   (3) T15 미지원: 관계 설정이 없으면 무엇을 설정해야 하는지 돌려주고 성공을 위장하지 않는다
//   (4) GitHub 본문 검색은 색인 지연이 있다 — 결과가 비어도 부재를 단정하지 않는다(link-only 표기)
//   (5) 두 트래커의 **WORK 필드 빌더**가 같은 계약을 지킨다 — 호출자 라벨 보존·FEAT 마커 미부착
import assert from 'node:assert/strict'
import test from 'node:test'
import {createJiraProvider} from './ticket/provider-jira-exec.mjs'
import {buildWorkIssueFieldsFor} from './ticket/provider-jira.mjs'
import {buildWorkIssueFields} from './ticket/provider-github.mjs'
import {createGithubProvider} from './ticket/provider-github-exec.mjs'
import {issueLinkBody, parseCursor, parseWorkSearch, workKeysJql, workProviderReadiness, workRelationMode, workSearchArgs} from './ticket/work-provider.mjs'

const WORK = 'WORK-00000001-0000-4000-8000-000000000001'
const PLAN = '22222222-2222-4222-8222-222222222222'
const jiraConfig = {baseUrl: 'https://jira.test', projectKey: 'PF', issueType: 'Task', apiVersion: '2'}
const jira = (config, respond) => {
  const seen = []
  const fetchImpl = async (url, init = {}) => {
    seen.push({url, method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : null})
    const {status = 200, json = {}} = respond({url, init}) ?? {}
    return {ok: status < 400, status, json: async () => json, text: async () => JSON.stringify(json)}
  }
  return {provider: createJiraProvider({config, fetchImpl, env: {JIRA_TOKEN: 't'}}), seen}
}

test('결과를 모르는 발행의 조회는 라벨이 아니라 시도 시각 이후의 내 이슈를 끝까지 읽어 작업 ID로 찾는다', async () => {
  const since = new Date(Date.now() - 3 * 60000).toISOString()
  const {provider, seen} = jira(jiraConfig, () => ({json: {issues: [
    {key: 'PF-30', fields: {summary: '회원 타입', description: `설명\n\n작업 ID: ${WORK}`}},
    {key: 'PF-31', fields: {summary: '다른 작업', description: '작업 ID: WORK-00000009-0000-4000-8000-000000000009'}}], total: 2}}))
  const found = await provider.findByWorkId({planId: PLAN, workId: WORK, since})
  const jql = decodeURIComponent(new URL(seen[0].url).searchParams.get('jql'))
  assert.match(jql, /AND created >= -\d+m/)
  assert.doesNotMatch(jql, /reporter/, '보고자로 좁히면 다른 계정의 재개가 「완전·0건」이 된다')
  assert.doesNotMatch(jql, /labels/, '라벨로 찾고 있다 — 조회 키 라벨은 없앴다')
  assert.deepEqual(found.matches.map(item => item.ticketKey), ['PF-30'])
  assert.equal(found.complete, true)
  // 매칭이 더 남았으면 조회도 불완전하다 — 「이 작업의 티켓은 이것뿐」이라고 말하지 않는다.
  const partial = jira(jiraConfig, ({url}) => ({json: {issues: new URL(url).searchParams.get('startAt') === '0' ? [{key: 'PF-30', fields: {description: WORK}}] : [], total: 2}}))
  const cut = await partial.provider.findByWorkId({workId: WORK, since})
  assert.equal(cut.complete, false)
  // Cloud(v3)는 설명을 ADF 객체로 준다 — 문자열로 대조하면 늘 불일치라 「완전·0건」→재발행이 된다.
  const cloud = jira({...jiraConfig, apiVersion: '3'}, () => ({json: {issues: [{key: 'PF-40', fields: {summary: 's',
    description: {type: 'doc', version: 1, content: [{type: 'paragraph', content: [{type: 'text', text: `작업 ID: ${WORK}`}]}]}}}], total: 1}}))
  assert.deepEqual((await cloud.provider.findByWorkId({workId: WORK, since})).matches.map(item => item.ticketKey), ['PF-40'], 'ADF 설명에서 작업 ID를 찾지 못했다')
  // 시도 시각을 모르면 범위를 좁힐 수 없다 — 부재를 단정하지 않는다(트래커도 부르지 않는다).
  const blind = jira(jiraConfig, () => ({json: {issues: [], total: 0}}))
  assert.equal((await blind.provider.findByWorkId({workId: WORK})).complete, false)
  assert.equal(blind.seen.length, 0)
  // GitHub: 시각이 있으면 REST 목록(색인 지연 없음)을 끝까지 돌고 마커의 work=로 대조한다.
  const calls = []
  const marker = `<!-- web-harness:work plan=${PLAN} work=${WORK} feat=FEAT-001 tc= rev=${'a'.repeat(64)} -->`
  const gh = createGithubProvider({repo: 'o/r', exec: async args => {
    calls.push(args)
    return [JSON.stringify({number: 7, title: 't', body: `본문\n\n${marker}`}), JSON.stringify({number: 8, title: 'x', body: `본문 ${WORK} 언급만`})].join('\n')
  }})
  const ghFound = await gh.findByWorkId({workId: WORK, since})
  assert.deepEqual(ghFound.matches.map(item => item.ticketKey), ['7'], '산문 언급을 마커로 읽었다')
  assert.equal(ghFound.complete, true)
  assert.ok(calls[0].includes('--paginate') && calls[0].some(arg => arg.includes('since=')))
  // GitHub 경로는 형식이 아닌 workId를 트래커로 보내지 않는다.
  assert.throws(() => workSearchArgs('o/r', 'WORK-not-a-uuid'), /INVALID_WORK_ID/)
})

test('T16: 페이지가 남았으면 complete:false와 다음 커서다 — 빈 결과를 「없음」으로 읽지 않는다', async () => {
  const pages = [{issues: [{key: 'PF-1', fields: {}}, {key: 'PF-2', fields: {}}], total: 3},
    {issues: [{key: 'PF-3', fields: {}}], total: 3}]
  const {provider, seen} = jira(jiraConfig, ({url}) => ({json: pages[Number(new URL(url).searchParams.get('startAt') ?? 0) === 0 ? 0 : 1]}))
  const first = await provider.listWorkIssues({keys: ['PF-1', 'PF-2', 'PF-3'], pageSize: 2})
  assert.equal(first.complete, false, '절단을 완전으로 셌다')
  assert.equal(first.nextCursor, '2')
  const second = await provider.listWorkIssues({keys: ['PF-1', 'PF-2', 'PF-3'], cursor: first.nextCursor, pageSize: 2})
  assert.equal(second.complete, true)
  assert.equal(new URL(seen[1].url).searchParams.get('startAt'), '2')
  // 요청한 키 중 못 본 것을 드러낸다 — 「조회했는데 없다」와 「이 페이지에 없다」는 다르다.
  assert.deepEqual(second.missing, ['PF-1', 'PF-2'], '완결 페이지에서 못 본 키를 보고하지 않는다')
  assert.equal(first.missing, null, '불완전한 조회로 부재를 단정했다')
  // total을 주지 않는 응답은 **완전하다고 말할 수 없다**.
  assert.equal(parseWorkSearch({issues: []}).complete, false, 'total 없는 응답을 완전으로 셌다')
  // 0건인데 남았다고 하는 응답은 커서를 전진시키지 못한다 — 같은 페이지를 무한히 읽지 않는다.
  const stalled = parseWorkSearch({issues: [], total: 5}, {fetched: 2})
  assert.equal(stalled.stalled, true)
  assert.equal(stalled.nextCursor, null, '전진하지 않는 커서를 돌려줬다')
  assert.throws(() => parseCursor('abc'), /INVALID_CURSOR/, '손상된 커서를 0으로 접어 1페이지를 다시 읽었다')
  assert.throws(() => workKeysJql([]), /EMPTY_WORK_KEYS/)
  // 형식이 아닌 키를 조용히 버리면 그 키를 「없다」로 읽는다 — loud하게 막는다.
  assert.throws(() => workKeysJql(['PF-1', '나쁜 키']), /INVALID_WORK_KEY/)
  assert.equal(workKeysJql(['PF-1', 'PF-1']), 'key in (PF-1) ORDER BY created ASC')
})

test('T15: 관계 설정이 없으면 발행 전에 필요한 설정을 돌려준다 — 성공을 위장하지 않는다', async () => {
  const {provider, seen} = jira(jiraConfig, () => ({json: {}}))
  const unsupported = await provider.linkRelated({parentKey: 'PF-1', childKey: 'PF-30'})
  assert.equal(unsupported.applied, false)
  assert.equal(unsupported.mode, 'unsupported')
  assert.ok(unsupported.needsConfig.some(item => /workLink\.mode/.test(item)))
  assert.equal(seen.length, 0, '설정도 없이 트래커를 불렀다')
  // 하위 작업은 발행 시점의 부모 필드라 연결 시점에 붙일 수 없다 — 지원한다고 말하지 않는다.
  assert.equal(workRelationMode('jira', {workLink: {mode: 'subtask'}}).mode, 'unsupported')
  // 본문 참조(link-only)도 **명시 선언**이라야 한다 — 트래커 이름으로 면제되지 않는다.
  assert.equal(workRelationMode('github', {}).mode, 'unsupported', 'GitHub만 기본 통과를 받았다 — 게이트 강도가 트래커 이름으로 갈린다')
  assert.equal(workRelationMode('github', {workLink: {mode: 'link-only'}}).mode, 'link-only')
  assert.equal(workRelationMode('github', {workLink: {mode: 'issue-link', linkType: 'Relates'}}).mode, 'unsupported', 'GitHub에 없는 능력을 받아들였다')
  // 부모가 어느 쪽인지는 **가정**이다 — 설정으로 뒤집을 수 있어야 한다.
  assert.deepEqual(issueLinkBody({parentKey: 'PF-1', childKey: 'PF-30', linkType: 'R', parentSide: 'inward'}),
    {type: {name: 'R'}, inwardIssue: {key: 'PF-1'}, outwardIssue: {key: 'PF-30'}})
  // 설정이 있으면 실제로 이슈 링크를 만든다(부모가 outward).
  const linked = jira({...jiraConfig, workLink: {mode: 'issue-link', linkType: 'Relates'}}, () => ({status: 201, json: {}}))
  const applied = await linked.provider.linkRelated({parentKey: 'PF-1', childKey: 'PF-30'})
  assert.deepEqual({applied: applied.applied, mode: applied.mode}, {applied: true, mode: 'issue-link'})
  assert.match(linked.seen[0].url, /\/issueLink$/)
  assert.deepEqual(linked.seen[0].body, {type: {name: 'Relates'}, outwardIssue: {key: 'PF-1'}, inwardIssue: {key: 'PF-30'}})
  // 실패는 삼키지 않는다 — 분류해서 올린다.
  const failing = jira({...jiraConfig, workLink: {mode: 'issue-link', linkType: 'Relates'}}, () => ({status: 403, json: {errorMessages: ['Forbidden']}}))
  const denied = await failing.provider.linkRelated({parentKey: 'PF-1', childKey: 'PF-30'})
  assert.equal(denied.applied, false)
  assert.equal(denied.mode, 'unknown')
  assert.equal(denied.classified.kind, 'forbidden')
})

test('GitHub: 본문 검색은 색인 지연이라 부재를 단정하지 않고, 관계는 link-only다', async () => {
  const provider = createGithubProvider({repo: 'o/r', exec: async () => JSON.stringify([])})
  const found = await provider.findByWorkId({workId: WORK})
  assert.deepEqual(found.matches, [])
  assert.equal(found.complete, false, '빈 검색 결과를 「없음」으로 확정했다 — 색인 지연이면 재발행으로 중복이 생긴다')
  assert.equal(found.indexLag, true)
  const relation = await provider.linkRelated({parentKey: '1', childKey: '2'})
  assert.equal(relation.mode, 'link-only')
  assert.equal(relation.applied, false, 'link-only를 적용된 관계로 셌다')
  // 상한에 닿으면 잘렸을 수 있다고 말한다.
  const views = []
  const many = createGithubProvider({repo: 'o/r', exec: async args => {
    if (args[1] !== 'view') return JSON.stringify(Array.from({length: 5}, (unused, index) => ({number: index + 1, title: 't', labels: [], state: 'OPEN'})))
    views.push(args[2])
    if (args[2] === '99') throw new Error('gh exit 1: GraphQL: Could not resolve to an issue or pull request with the number of 99.')
    if (args[2] === '77') throw new Error('gh exit 1: HTTP 403: Resource not accessible by integration')
    return JSON.stringify({number: Number(args[2]), title: '오래된 WORK', labels: [{name: 'work-x'}], state: 'OPEN', body: 'b', assignees: [{login: 'dev'}]})
  }})
  const listed = await many.listWorkIssues({pageSize: 5})
  assert.equal(listed.complete, false)
  assert.equal(listed.truncated, true)
  // 잘린 목록에서 못 본 키는 **직접 조회한다** — 목록에 있는 키는 다시 부르지 않고, 「없다」는 gh가 그렇게 답한 것만이다.
  const filtered = await many.listWorkIssues({keys: ['1', '150', '99'], pageSize: 5})
  assert.deepEqual(filtered.items.map(item => item.ticketKey), ['1', '150'])
  assert.deepEqual(filtered.items[1].assignees, ['dev'])
  assert.deepEqual(views, ['150', '99'], '목록에서 이미 본 키를 다시 조회했다')
  assert.equal(filtered.complete, true)
  assert.deepEqual(filtered.missing, ['99'])
  // 권한 실패는 부재가 아니다 — 던져서 보드가 「조회 실패」로 적게 한다.
  await assert.rejects(() => many.listWorkIssues({keys: ['77'], pageSize: 5}), /403/, '권한 실패를 부재로 접었다')
  await assert.rejects(() => many.listWorkIssues({keys: ['PF-1'], pageSize: 5}), /INVALID_WORK_KEY/)
  const small = createGithubProvider({repo: 'o/r', exec: async () => JSON.stringify([{number: 1, title: 't', labels: [], state: 'OPEN'}])})
  assert.deepEqual((await small.listWorkIssues({keys: ['1', '2'], pageSize: 5})).missing, ['2'], '완결 목록에서 못 본 키를 보고하지 않는다')
})

test('발행 전 능력 판정: 없는 것을 있다고 말하지 않고 무엇을 설정해야 하는지 댄다', () => {
  const {provider} = jira(jiraConfig, () => ({json: {}}))
  const bare = workProviderReadiness(provider, jiraConfig)
  assert.equal(bare.ok, false)
  assert.ok(bare.missing.some(item => /workLink/.test(item)), JSON.stringify(bare.missing))
  const ready = workProviderReadiness(provider, {...jiraConfig, workLink: {mode: 'issue-link', linkType: 'Relates'}})
  assert.deepEqual(ready.missing, [])
  assert.equal(ready.ok, true)
  // 능력이 아예 없는 provider는 그 사실이 그대로 나온다.
  const poor = workProviderReadiness({name: 'jira'}, jiraConfig)
  assert.ok(poor.missing.includes('provider.findByWorkId'))
  assert.ok(poor.missing.includes('provider.updateLabels'), '동기화할 수 없는 provider로 발행을 열었다 — 계획 개정 뒤 티켓이 영영 낡는다')
  // GitHub도 선언 전에는 막힌다 — 선언하면 통과한다(면제가 아니라 opt-in).
  const github = createGithubProvider({repo: 'o/r', exec: async () => '[]'})
  assert.equal(workProviderReadiness(github, {}).ok, false, 'GitHub이 선언 없이 발행 가능으로 통과했다')
  const optedIn = workProviderReadiness(github, {workLink: {mode: 'link-only'}})
  assert.equal(optedIn.ok, true)
  assert.equal(optedIn.relation.mode, 'link-only')
})

// ── WORK 필드 빌더 conformance ──────────────────────────────────────────────────
// 호출자 라벨(역할·팀)을 보존하고, 기계 마커는 **사람 눈에 보이지 않는 곳**에 둔다 — GitHub은 본문 끝 HTML 주석,
// Jira는 이슈 속성(위키 서식이 주석을 숨기지 못해 글자로 보였다). FEAT 왕복 마커는 어느 쪽에도 붙이지 않는다.
const workMarker = `<!-- web-harness:work plan=${PLAN} work=${WORK} feat=FEAT-001,FEAT-002 tc= rev=${'a'.repeat(64)} -->`
const workDraft = {title: '회원 타입·API 계약', body: '### 완료 조건\n- [ ] 응답이 명세 타입과 맞는다', marker: workMarker, labels: ['fe', 'be', 'team-web']}
for (const [name, build, read] of [
  ['jira', draft => buildWorkIssueFieldsFor(jiraConfig, draft), built => ({labels: built.fields.labels, body: built.fields.description, title: built.fields.summary, marker: built.properties?.[0]?.value?.marker})],
  ['github', draft => createGithubProvider({repo: 'o/r', exec: async () => ''}).buildWorkFields(draft), built => ({labels: built.labels, body: built.body, title: built.title, marker: built.body})],
]) {
  test(`${name}: WORK 필드 빌더가 호출자 라벨을 보존하고 마커를 보이지 않는 곳에 둔다`, () => {
    const built = read(build(workDraft))
    assert.equal(built.title, workDraft.title)
    assert.deepEqual([...built.labels].sort(), [...workDraft.labels].sort(), '호출자 라벨이 바뀌었다 — 개발자가 이것으로 거른다')
    assert.equal(built.body.includes('web-harness:refs'), false, 'WORK 본문에 FEAT 왕복 마커를 덧붙였다')
    assert.ok(String(built.marker).includes('web-harness:work'), 'WORK 마커가 사라졌다')
    if (name === 'jira') assert.equal(built.body.includes('web-harness:work'), false, 'Jira 설명에 마커를 넣었다 — 글자로 보인다')
  })
}

test('발행 전 판정은 WORK 전용 빌더가 있는지도 본다', () => {
  const {provider} = jira(jiraConfig, () => ({json: {}}))
  assert.equal(workProviderReadiness(provider, {workLink: {mode: 'issue-link', linkType: 'Relates'}}).ok, true)
  const {buildWorkFields, ...withoutBuilder} = provider
  assert.deepEqual(workProviderReadiness(withoutBuilder, {workLink: {mode: 'issue-link', linkType: 'Relates'}}).missing,
    ['provider.buildWorkFields'])
})

test('트래커의 끝남: Jira는 해결 사유로, GitHub은 닫힌 이유로 완료와 취소를 가른다', async () => {
  const {classifyTrackerDone} = await import('./ticket/work-provider.mjs')
  assert.equal(classifyTrackerDone({statusCategory: 'done', resolution: 'Fixed'}), 'completed')
  assert.equal(classifyTrackerDone({statusCategory: 'done', resolution: 'Done'}), 'completed')
  assert.equal(classifyTrackerDone({statusCategory: 'done', resolution: "Won't Fix"}), 'cancelled', 'Won\'t Fix를 완료로 읽었다')
  assert.equal(classifyTrackerDone({statusCategory: 'done', resolution: 'Duplicate'}), 'cancelled')
  assert.equal(classifyTrackerDone({statusCategory: 'indeterminate', resolution: null}), null)
  assert.equal(classifyTrackerDone({statusCategory: 'done', resolution: 'Shipped'}, {completedResolutions: ['Shipped']}), 'completed')
  assert.equal(classifyTrackerDone({state: 'CLOSED', stateReason: 'COMPLETED'}), 'completed')
  assert.equal(classifyTrackerDone({state: 'CLOSED', stateReason: 'NOT_PLANNED'}), 'cancelled')
  assert.equal(classifyTrackerDone({state: 'CLOSED', stateReason: 'DUPLICATE'}), 'cancelled')
  assert.equal(classifyTrackerDone({state: 'CLOSED', stateReason: ''}), 'completed', '닫힌 이유가 없는 옛 이슈는 GitHub 기본값(완료)이다')
  assert.equal(classifyTrackerDone({state: 'OPEN'}), null)
  assert.equal(classifyTrackerDone({statusCategory: 'done', resolution: null}), 'unresolved', '해결 사유 없는 끝남을 취소로 읽었다')
})

test('트래커 끝남 겹치기: 원장 완료가 앞서고, 거둔 완료는 거둔 뒤에 다시 끝났을 때만 되살아난다', async () => {
  const {withTrackerCompletion} = await import('./ticket/work-provider.mjs')
  const works = new Map([
    ['W-merged', {ticketKey: 'K1', status: 'published', completed: {prUrl: 'pr/1'}}],
    ['W-reopened', {ticketKey: 'K2', status: 'published', reopened: {at: '2026-09-18T10:00:00Z', prUrl: 'pr/2', reason: 'r'}}],
    ['W-redone', {ticketKey: 'K3', status: 'published', reopened: {at: '2026-09-18T10:00:00Z', prUrl: 'pr/3', reason: 'r'}}],
    ['W-unresolved', {ticketKey: 'K4', status: 'published'}],
  ])
  const done = (resolution, doneAt = '2026-09-18T09:00:00Z') => ({statusCategory: 'done', resolution, doneAt})
  const state = withTrackerCompletion({works}, [
    {ticketKey: 'K1', ...done("Won't Fix")}, {ticketKey: 'K2', ...done('Fixed')},
    {ticketKey: 'K3', ...done('Fixed', '2026-09-18T11:00:00Z')}, {ticketKey: 'K4', statusCategory: 'done', resolution: null}])
  assert.equal(state.works.get('W-merged').completed.prUrl, 'pr/1', '원장 완료를 트래커 취소가 덮었다')
  assert.equal(state.works.get('W-merged').trackerCancelled, undefined)
  assert.equal(state.works.get('W-reopened').completed, undefined, '되돌린 머지의 옛 Resolved가 거둔 완료를 되살렸다')
  assert.equal(state.works.get('W-redone').completed.via, 'tracker')
  assert.equal(state.works.get('W-unresolved').completed, undefined)
  assert.equal(state.works.get('W-unresolved').trackerUnresolved, true)
})

