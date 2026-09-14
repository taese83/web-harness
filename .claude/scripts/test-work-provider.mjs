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
import {issueLinkBody, parseCursor, parseWorkSearch, workJql, workKeysJql, workLabel, workProviderReadiness, workRelationMode, workSearchArgs} from './ticket/work-provider.mjs'

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

test('WORK 조회는 계획·작업 라벨로 찾는다 — FEAT 라벨 질의를 재사용하지 않는다', async () => {
  const {provider, seen} = jira(jiraConfig, () => ({json: {issues: [{key: 'PF-30', fields: {summary: 'WORK 회원 타입', labels: [workLabel(WORK)]}}], total: 1}}))
  const found = await provider.findByWorkId({planId: PLAN, workId: WORK})
  const jql = decodeURIComponent(new URL(seen[0].url).searchParams.get('jql'))
  assert.match(jql, /labels = "work-00000001-0000-4000-8000-000000000001"/)
  assert.match(jql, /labels = "plan-22222222-2222-4222-8222-222222222222"/)
  assert.doesNotMatch(jql, /feat-/, 'FEAT 라벨로 WORK를 찾고 있다 — 축이 다르다')
  assert.deepEqual(found.matches.map(item => item.ticketKey), ['PF-30'])
  assert.equal(found.complete, true)
  assert.equal(workJql(jiraConfig, {workId: WORK}).includes('plan-'), false, '계획을 안 주면 계획 조건을 붙이지 않는다')
  // 매칭이 더 남았으면 조회도 불완전하다 — 「이 작업의 티켓은 이것뿐」이라고 말하지 않는다.
  const partial = jira(jiraConfig, () => ({json: {issues: [{key: 'PF-30', fields: {}}], total: 2}}))
  assert.equal((await partial.provider.findByWorkId({workId: WORK})).complete, false)
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
// FEAT 빌더는 `sourceKey`를 FEAT로 보고 `feat-<키>` 라벨과 `web-harness:refs` 마커를 덧붙인다.
// WORK를 그 빌더로 내면 ① 조회 축(`work-…` 라벨)이 사라져 재개 조회가 「완전·0건」을 돌려주고(부재로
// 읽혀 중복 발행) ② 본문에 두 모델의 마커가 함께 실려 판독 입구가 conflict로 거부한다.
// 그래서 **두 형태 모두** 같은 케이스로 잰다 — 한쪽만 고치면 다른 트래커에서 같은 사고가 난다.
const workDraft = {
  title: '회원 타입·API 계약',
  body: `요약\n\n<!-- web-harness:work plan=${PLAN} work=${WORK} feat=FEAT-001,FEAT-002 tc= rev=${'a'.repeat(64)} -->`,
  labels: [workLabel(WORK), `plan-${PLAN}`, 'feat-FEAT-001', 'feat-FEAT-002'],
}
for (const [name, build, read] of [
  ['jira', draft => buildWorkIssueFieldsFor(jiraConfig, draft), built => ({labels: built.fields.labels, body: built.fields.description, title: built.fields.summary})],
  ['github', draft => buildWorkIssueFields(draft), built => ({labels: built.labels, body: built.body, title: built.title})],
]) {
  test(`${name}: WORK 필드 빌더가 호출자 라벨을 보존하고 FEAT 마커를 붙이지 않는다`, () => {
    const built = read(build(workDraft))
    assert.equal(built.title, workDraft.title)
    for (const label of workDraft.labels) {
      assert.ok(built.labels.includes(label), `${label} 라벨이 사라졌다 — 이 축으로 재개 조회를 한다`)
    }
    assert.equal(built.labels.some(label => /^feat-WORK-/.test(label)), false, '없는 축의 라벨을 만들었다')
    assert.equal(built.body.includes('web-harness:refs'), false, 'WORK 본문에 FEAT 왕복 마커를 덧붙였다 — 판독 입구가 conflict로 거부한다')
    assert.ok(built.body.includes('web-harness:work'), 'WORK 마커가 본문에서 사라졌다')
  })
}

test('발행 전 판정은 WORK 전용 빌더가 있는지도 본다', () => {
  const {provider} = jira(jiraConfig, () => ({json: {}}))
  assert.equal(workProviderReadiness(provider, {workLink: {mode: 'issue-link', linkType: 'Relates'}}).ok, true)
  const {buildWorkFields, ...withoutBuilder} = provider
  assert.deepEqual(workProviderReadiness(withoutBuilder, {workLink: {mode: 'issue-link', linkType: 'Relates'}}).missing,
    ['provider.buildWorkFields'])
})
