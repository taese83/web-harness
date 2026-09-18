#!/usr/bin/env node
// test-work-routes-e2e.mjs — WORK 흐름을 **실제 Jira provider 코드**로 처음부터 끝까지 돈다(T62).
//
// 구간별 회귀는 provider stub을 주입해 **Jira provider 코드를 타지 않는다** — AOA-3(조회 필드 누락)이 정확히
// 그 틈으로 지나갔다. 여기서는 메모리 Jira(HTTP 수준 stub)에 실제 `createJiraProvider`를 붙인다. stub은 실 Jira처럼
// `fields=`로 응답을 거르고, 모르는 JQL·틀린 배정 형식에 400을 준다(관대하면 요청 쪽 결함이 안 보인다).
//
//   claim(분석·계획 검토) → claim --publish --confirm(발행) → 기획자가 트래커에 코멘트 → pickup → 작업 → link
//   → link --sync(머지 관측) → 후속 작업 pickup: 선행 하나가 아직 머지되지 않아 되돌림이 트래커로 간다
//
// 여기서 고정하는 사실:
//   (1) 발행한 티켓에 WORK 라벨이 **실제 Jira 필드로** 실린다 — 재개 조회의 축이 살아 있다
//   (2) 기획자 코멘트가 change-scope에 실린다(격리 블록) — 본문 밖의 결정이 개발 에이전트에 닿는다
//   (3) 트래커 쓰기는 **정해진 것뿐이다** — 발행·배정·in-progress 전이·되돌림 코멘트. `done`이 매핑돼 있어도
//       부르지 않는다(머지·닫기는 사람·close 흐름의 몫)
//   (4) 원장의 링크 기록이 change-scope의 개발 기준 개정을 싣고, 완료는 머지 관측 뒤에만 생긴다
//
// `WEB_HARNESS_E2E_RECEIPT=<경로>`를 주면 실행 요약을 JSON으로 쓴다(사람이 보는 receipt — 게이트가 아니다).
import assert from 'node:assert/strict'
import test from 'node:test'
import {cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {tmpdir} from 'node:os'
import {createJiraProvider} from './ticket/provider-jira-exec.mjs'
import {createJiraStub} from './ticket/jira-memory-stub.mjs'
import {readChangeScopeFile} from './ticket/cli.mjs'
import {runClaimWork} from './ticket/work-claim.mjs'
import {runWorkPublish} from './ticket/work-publish-run.mjs'
import {runWorkPickup} from './ticket/work-pickup-run.mjs'
import {runWorkLink, runWorkMergeSync} from './ticket/work-link-run.mjs'
import {foldWorkState, readWorkEvents, WORK_EVENTS_PATH} from './ticket/work-events.mjs'

const repoRoot = new URL('../..', import.meta.url).pathname
const jiraConfig = {
  baseUrl: 'https://jira.test', projectKey: 'PF', issueType: 'Task', apiVersion: '2', assigneeField: 'name',
  // `done`도 매핑돼 있다 — 매핑이 있어도 개발 흐름이 완료 전이를 부르지 않는지 보려는 것이다.
  transitions: {'in-progress': '31', done: '41'},
  workLink: {mode: 'issue-link', linkType: 'Relates'},
}
const ticketConfig = {provider: 'jira', jira: jiraConfig}
const W = n => `WORK-0000000${n}-0000-4000-8000-00000000000${n}`


const describeWrites = writes => writes.map(write => {
  if (write.path.endsWith('/transitions')) return `transition ${write.path.split('/')[2]} → ${write.body.transition.id}`
  if (write.path.endsWith('/assignee')) return `assign ${write.path.split('/')[2]} → ${write.body.name}`
  if (write.path.endsWith('/comment')) return `comment ${write.path.split('/')[2]}`
  if (write.method === 'POST' && write.path === '/issue') return 'create issue'
  return `${write.method} ${write.path}`
})
// git 쪽 사실은 주입한다 — 이 테스트가 재는 것은 트래커 계약이지 저장소 상태가 아니다.
const gitIo = {currentBranch: async () => 'feature/members', worktree: async () => ({dirty: false, conflicted: false}), refresh: async () => ({ok: true})}

test('WORK 흐름: 분해 검토 → 발행 → 픽업 → 완료 → 머지 관측 → 후속 선행 게이트가 실제 Jira provider로 닿는다', async () => {
  const root = mkdtempSync(join(tmpdir(), 'wh-work-e2e-'))
  const jira = createJiraStub()
  const provider = createJiraProvider({config: jiraConfig, fetchImpl: jira.fetchImpl, env: {JIRA_TOKEN: 't'}})
  const summary = {}
  try {
    cpSync(join(repoRoot, '.claude/evals/fixtures/work-plan/crud'), root, {recursive: true})
    // ① 분해 검토(외부 쓰기 0)
    assert.equal((await runClaimWork({root, flags: {}})).phase, 'P1_REVIEW')
    assert.equal(jira.writes.length, 0, '검토 단계가 트래커에 썼다')
    // ② 기반 두 작업과 그 후속(목록 조회 연결)을 발행
    const published = await runWorkPublish({root, flags: {'work-ids': `${W(1)},${W(3)},${W(4)}`, confirm: true}, io: {provider, ticketConfig}})
    assert.equal(published.phase, 'PUBLISHED', JSON.stringify(published))
    const keyOf = workId => published.published.find(item => item.workId === workId).ticketKey
    // (1) 실제 Jira 필드: 라벨은 역할뿐, 설명은 개발자용 위키 섹션, 마커는 이슈 속성, AI 맥락은 첨부 파일이다.
    const created = jira.issues.get(keyOf(W(1)))
    assert.deepEqual([...created.fields.labels].sort(), ['be', 'fe'], JSON.stringify(created.fields.labels))
    assert.match(created.fields.description, /h3\. 완료 조건[\s\S]*h3\. 수정 범위[\s\S]*h3\. 참고/)
    assert.equal(created.fields.description.includes('web-harness:'), false, '설명에 기계 마커가 보인다')
    assert.match(created.properties['web-harness.work']?.marker ?? '', /web-harness:work .*work=WORK-00000001/)
    assert.equal(created.attachments.length, 1, 'AI 맥락이 첨부되지 않았다')
    assert.match(created.attachments[0].content, /"writePaths"/)
    const lookup = await provider.findByWorkId({workId: W(1), since: new Date(Date.now() - 60000).toISOString()})
    assert.deepEqual(lookup.matches.map(item => item.ticketKey), [keyOf(W(1))])
    // ③-b 개발자가 트래커에서 완료 조건을 **더한다** — 픽업이 개발 범위에 싣는다.
    created.fields.description = created.fields.description.replace(/(h3\. 완료 조건\n)/, '$1* ☐ 정지 회원은 목록에서 회색으로 보인다\n')
    // ③ 기획자가 트래커에서 결정을 코멘트로 남긴다(사람의 행동 — 하네스 쓰기가 아니다)
    jira.humanComment(keyOf(W(1)), '기획자', '회원 상태 값은 active/suspended 두 가지로 확정합니다')
    // ④ 픽업
    const picked = await runWorkPickup({root, ticketKey: keyOf(W(1)), developer: 'dev1', flags: {}, io: {provider, ...gitIo}})
    assert.equal(picked.ok, true, JSON.stringify(picked.bounce ?? picked))
    const scope = readChangeScopeFile(root)
    assert.equal(scope.workId, W(1))
    assert.deepEqual(scope.ticketAcceptance.added, [{section: 'acceptance', text: '정지 회원은 목록에서 회색으로 보인다'}], '개발자가 더한 완료 조건이 개발 범위에 없다')
    // (2) 코멘트가 격리 블록 안에 실렸다
    assert.match(scope.TARGET_BEHAVIOR, /untrusted-ticket-comments[\s\S]*active\/suspended/)
    assert.equal(scope.ticket.revisionStage, 'settled-at-pickup')
    assert.equal(scope.ticket.provider, 'jira', 'change-scope가 어느 트래커의 티켓인지 모른다')
    assert.equal(jira.issues.get(keyOf(W(1))).fields.assignee?.name, 'dev1', '배정 어휘(DC name)가 실제 요청에 실리지 않았다')
    // ⑤ 작업 산출물 → 완료 주장
    mkdirSync(join(root, 'src/entities/member'), {recursive: true})
    writeFileSync(join(root, 'src/entities/member/api.ts'), 'export type Member = {id: string; status: "active" | "suspended"}\n')
    const linked = await runWorkLink({root, ticketKey: keyOf(W(1)), prUrl: 'https://github.com/acme/web/pull/11', flags: {},
      io: {prInfo: async () => ({state: 'OPEN', baseRefName: 'feature/members'})}})
    assert.equal(linked.ok, true, JSON.stringify(linked))
    assert.match(linked.closeLine, /Relates to PF-/, 'Jira 키에 닫는 줄을 적었다')
    assert.equal(linked.ticketAcceptance?.verification, 'not-automated', '사람이 더한 조건을 검증한 것처럼 접었다')
    let state = foldWorkState(readWorkEvents(join(root, WORK_EVENTS_PATH)))
    // (4) 링크 기록이 개발 기준 개정을 싣는다 — 완료는 아직 없다
    const linkEvent = readWorkEvents(join(root, WORK_EVENTS_PATH)).find(event => event.eventType === 'work-linked')
    assert.deepEqual(linkEvent.payload.ticket, scope.ticket)
    assert.equal(state.works.get(W(1)).completed, null)
    // ⑥ 머지 관측
    const sync = await runWorkMergeSync({root, io: {prStates: async urls => new Map(urls.map(url => [url, {state: 'MERGED', baseRefName: 'feature/members'}]))}})
    assert.deepEqual(sync.completed, [W(1)])
    // ⑦ 후속 픽업: W3이 아직 머지되지 않았다 — 막히고 되돌림이 트래커로 간다
    await import('node:fs').then(fs => fs.rmSync(join(root, '_workspace/03_dev/change-scope.md')))
    const blocked = await runWorkPickup({root, ticketKey: keyOf(W(4)), developer: 'dev1', flags: {}, io: {provider, ...gitIo}})
    assert.equal(blocked.bounce.reason, 'dependency-incomplete')
    assert.deepEqual(blocked.bounce.missing, [W(3)])
    assert.ok(jira.issues.get(keyOf(W(4))).fields.comment.comments.some(comment => /아직 머지되지 않았습니다|not merged/.test(comment.body)),
      '되돌림이 트래커에 남지 않았다')
    // (3) 트래커 쓰기는 정해진 것뿐이다
    const writes = describeWrites(jira.writes)
    summary.writes = writes
    const allowed = /^(create issue|assign PF-\d+ → dev1|transition PF-\d+ → 31|comment PF-\d+|POST \/issue\/PF-\d+\/attachments)$/
    assert.deepEqual(writes.filter(write => !allowed.test(write)), [], `허용 밖 트래커 쓰기: ${writes.join(' | ')}`)
    assert.equal(writes.some(write => /→ 41$/.test(write)), false, '완료 전이를 불렀다')
    assert.equal(writes.filter(write => write === 'create issue').length, 3)
    summary.result = {published: published.published.length, picked: scope.workId, linked: linkEvent.payload.prUrl, completed: sync.completed, downstream: blocked.bounce.reason}
  } finally {
    rmSync(root, {recursive: true, force: true})
    if (process.env.WEB_HARNESS_E2E_RECEIPT) {
      mkdirSync(dirname(process.env.WEB_HARNESS_E2E_RECEIPT), {recursive: true})
      writeFileSync(process.env.WEB_HARNESS_E2E_RECEIPT, `${JSON.stringify({kind: 'work-routes-e2e', measuredAt: new Date().toISOString(), ...summary,
        limits: ['메모리 Jira(REST v2 일부) — 실 Jira NOT_RUN', 'PR 머지 상태는 주입(gh 미호출)', 'git 사실(브랜치·워크트리·fetch)은 주입', 'feature-planner·system-architect 단계는 fixture 계획 파일로 대신']}, null, 2)}\n`)
    }
  }
})

test('사람이 만든 개발 티켓: 판정 요구 → 기획 필요 요청 → 미리보기 → 지문 확인 → WORK 완성 → 완료 → 머지 관측 → 보드 (계획 없는 프로젝트)', async () => {
  const {writeFileSync: write} = await import('node:fs')
  const {assessmentDigest, assessmentPath} = await import('./ticket/ticket-work.mjs')
  const {runWorkBoard} = await import('./ticket/work-board.mjs')
  const root = mkdtempSync(join(tmpdir(), 'wh-ticket-work-e2e-'))
  const jira = createJiraStub()
  const config = {...jiraConfig, componentAxis: {PLAN: '기획 입력', DEVELOP: '개발 티켓'}}
  const provider = createJiraProvider({config, fetchImpl: jira.fetchImpl, env: {JIRA_TOKEN: 't'}})
  const io = {provider, ticketConfig: {provider: 'jira', jira: config}, ...gitIo}
  try {
    // 기획 없이 스팩만 확정한 브라운필드 — 소유 경계는 스팩이 준다.
    mkdirSync(join(root, '_workspace/03_dev/ticket-assessments'), {recursive: true})
    write(join(root, '_workspace/03_dev/spec.json'), JSON.stringify({specTier: 'unverifiable', layerMap: {ui: 'src', tests: 'tests'}}))
    const key = jira.humanTicket({summary: '정지 회원 표시', components: ['DEVELOP'],
      description: '회원 목록에서 정지된 회원을 구분하고 싶습니다.\n\n완료 조건: 정지 회원은 목록에서 회색으로 보인다'})
    // ① 판정서가 없다 — 트래커에 쓰지 않고 판정을 요구한다.
    const required = await runWorkPickup({root, ticketKey: key, developer: 'dev1', flags: {}, io})
    assert.equal(required.phase, 'TICKET_ASSESSMENT_REQUIRED', JSON.stringify(required))
    assert.equal(required.next.agent, 'system-architect')
    assert.equal(jira.writes.length, 0, '판정 전에 트래커에 썼다')
    // ② 기획이 필요하다고 판정 — 착수하지 않고 무엇이 필요한지 티켓에 요청한다.
    const selfCheck = ['new-route', 'new-data-contract', 'new-auth-path', 'new-external-dependency', 'public-contract-change'].map(id => ({id, answer: 'no', evidence: ['src/members/list.tsx:1']}))
    const base = {schemaVersion: 1, ticket: {key, provider: 'jira'}, selfCheck, planningNeeds: [], designNeeds: [], nonGoals: [], dependsOn: []}
    write(join(root, assessmentPath(key)), JSON.stringify({...base, verdict: 'needs-planning', lane: null, planningNeeds: [{what: '정지 기준', why: '며칠 미접속이 정지인지 정해져 있지 않다'}]}))
    const needs = await runWorkPickup({root, ticketKey: key, developer: 'dev1', flags: {}, io})
    assert.equal(needs.phase, 'TICKET_NOT_STARTABLE')
    assert.equal(needs.bounce.reason, 'ticket-needs-planning')
    assert.ok(jira.issues.get(key).fields.comment.comments.some(comment => /정해야 할 것이 있습니다[\s\S]*정지 기준/.test(comment.body)), '기획 요청이 티켓에 남지 않았다')
    assert.equal(jira.issues.get(key).fields.assignee, null, '착수 불가인데 배정했다')
    assert.ok(jira.issues.get(key).fields.labels.includes('needs-planning'), '착수 불가 판정이 티켓에 표시되지 않았다 — 트래커가 판정 기록이다')
    // 같은 판정서로 다시 불러도 요청 코멘트를 또 달지 않는다 — 새 판정일 때만 알린다.
    const commentsBefore = jira.issues.get(key).fields.comment.comments.length
    const again = await runWorkPickup({root, ticketKey: key, developer: 'dev1', flags: {}, io})
    assert.equal(again.phase, 'TICKET_NOT_STARTABLE')
    assert.equal(jira.issues.get(key).fields.comment.comments.length, commentsBefore, '같은 판정으로 요청 코멘트를 반복했다')
    // ③ 기획이 답해 착수 가능으로 다시 판정 — 미리보기는 쓰지 않는다.
    const assessment = {...base, verdict: 'startable', lane: 'change', objective: '정지 회원을 목록에서 구분해 보인다', roles: ['fe'],
      writePaths: ['src/members/'], acceptance: [{text: '정지 회원은 목록에서 회색으로 보인다', source: 'ticket'}],
      testItems: [{id: `TT-${key}-1`, text: '정지 회원을 불러오면 회색 행으로 보인다', source: 'proposed'}]}
    write(join(root, assessmentPath(key)), JSON.stringify(assessment))
    const before = jira.writes.length
    const preview = await runWorkPickup({root, ticketKey: key, developer: 'dev1', flags: {}, io})
    assert.equal(preview.phase, 'TICKET_WORK_PREVIEW', JSON.stringify(preview))
    assert.equal(jira.writes.length, before, '미리보기가 트래커에 썼다')
    assert.match(preview.body, /h3\. 완료 조건[\s\S]*h3\. 원문/)
    // ④ 다른 지문으로는 착수하지 않는다.
    assert.equal((await runWorkPickup({root, ticketKey: key, developer: 'dev1', flags: {assessment: 'f'.repeat(64)}, io})).phase, 'TICKET_ASSESSMENT_MISMATCH')
    // ⑤ 확인한 지문으로 착수 — 티켓이 WORK 모양으로 완성되고 기존 픽업으로 이어진다.
    const picked = await runWorkPickup({root, ticketKey: key, developer: 'dev1', flags: {assessment: assessmentDigest(assessment)}, io})
    assert.equal(picked.ok, true, JSON.stringify(picked))
    const issue = jira.issues.get(key)
    assert.match(issue.fields.description, /h3\. 완료 조건[\s\S]*h3\. 테스트 항목[\s\S]*TT-PF-\d+-1[\s\S]*h3\. 원문\n회원 목록에서 정지된 회원을 구분하고 싶습니다/)
    assert.equal(issue.fields.description.includes('web-harness:'), false, '설명에 기계 마커가 보인다')
    assert.match(issue.properties['web-harness.work']?.marker ?? '', /work=WORK-/)
    assert.deepEqual(issue.fields.labels, ['fe'])
    assert.equal(issue.attachments.length, 0, '사람 티켓에 AI 맥락을 첨부했다 — 티켓 본문이 등록 기록이다')
    // 티켓이 등록 기록이다 — 사람 티켓 판정·등록은 원장에 남지 않는다(개발자 커밋에 하네스 기록이 섞이지 않는다).
    const ledger = existsSync(join(root, WORK_EVENTS_PATH)) ? readFileSync(join(root, WORK_EVENTS_PATH), 'utf8') : ''
    assert.equal(/"eventType":"(ticket-assessed|ticket-work-registered|context-attached)"/.test(ledger), false, '사람 티켓 판정·등록을 원장에 썼다')
    assert.equal(issue.fields.assignee?.name, 'dev1')
    const scope = readChangeScopeFile(root)
    assert.equal(scope.origin, 'ticket')
    assert.match(scope.definitionDigest ?? '', /^[0-9a-f]{64}$/, '티켓 작업의 정의 지문을 적지 않았다 — 집은 뒤 편집을 link가 모른다')
    assert.ok(readFileSync(new URL('../skills/team-flow/references/ticket-kinds.md', import.meta.url), 'utf8').includes('`definitionDigest`'), 'change-scope 키 표에 없는 키를 냈다')
    assert.equal(scope.lane, 'change')
    assert.deepEqual(scope.testCaseIds, [`TT-${key}-1`])
    assert.deepEqual(scope.ALLOWED_PATHS, ['src/members/'])
    // ⑥ 작업 → 완료 주장: 수정 범위가 바뀌었고 테스트가 TT를 인용한다.
    mkdirSync(join(root, 'src/members'), {recursive: true})
    write(join(root, 'src/members/list.tsx'), 'export const Suspended = () => null\n')
    write(join(root, 'src/members/list.test.tsx'), `// TT-${key}-1 정지 회원 회색 행\n`)
    // 비교할 커밋이 없으면 「깨끗함」이 아니라 점검하지 못했다고 적는다.
    const empty = await runWorkLink({root, ticketKey: key, prUrl: 'https://github.com/acme/web/pull/21', flags: {'dry-run': true},
      io: {provider, prInfo: async () => ({state: 'OPEN', baseRefName: 'main'}), commitLog: async () => ''}})
    assert.equal(empty.commitSplit.checked, false)
    assert.match(empty.commitSplit.guidance, /점검하지 못했습니다/)
    // 티켓이 정의다 — 집은 뒤 누가 테스트 항목을 지우면 그 정의로 끝났다고 말하지 않는다(STALE). 되돌리면 다시 연결된다.
    const described = jira.issues.get(key).fields.description
    jira.issues.get(key).fields.description = described.replace(/\n\* ☐ TT-[^\n]*/, '')
    assert.notEqual(jira.issues.get(key).fields.description, described, '전제: 테스트 항목 줄을 지웠다')
    const shrunk = await runWorkLink({root, ticketKey: key, prUrl: 'https://github.com/acme/web/pull/21', flags: {},
      io: {provider, prInfo: async () => ({state: 'OPEN', baseRefName: 'main'}), commitLog: async () => ''}})
    assert.equal(shrunk.blocked, 'stale-change-scope', '집은 뒤 줄어든 정의로 연결했다')
    jira.issues.get(key).fields.description = described
    const mixedLog = ['@@commit 0f9e8d7 한꺼번에 올림', 'src/members/list.tsx', '_workspace/03_dev/work-item-events.jsonl', ''].join('\n')
    const linked = await runWorkLink({root, ticketKey: key, prUrl: 'https://github.com/acme/web/pull/21', flags: {},
      io: {provider, prInfo: async () => ({state: 'OPEN', baseRefName: 'main'}), commitLog: async () => mixedLog}})
    assert.equal(linked.ok, true, JSON.stringify(linked))
    // 컨벤션 점검이라 연결을 막지 않지만, 섞인 커밋은 결과에 드러난다.
    assert.deepEqual(linked.commitSplit.mixed, [{commit: '0f9e8d7', subject: '한꺼번에 올림'}])
    assert.match(linked.commitSplit.guidance, /나눠 커밋/)
    assert.equal(linked.completion.testCases.missing.length, 0)
    // ⑦ 머지 관측 — 계획 파일 없이도 완료가 기록된다.
    const sync = await runWorkMergeSync({root, io: {prStates: async urls => new Map(urls.map(url => [url, {state: 'MERGED', baseRefName: 'main'}]))}})
    assert.equal(sync.completed.length, 1, JSON.stringify(sync))
    assert.equal(existsSync(join(root, assessmentPath(key))), false, '머지로 끝난 작업의 판정서가 남았다')
    // ⑧ 보드: 계획이 없어도 사람 티켓 절을 그린다 — 완료된 작업과 판정 전 개발 티켓을 구분한다.
    const other = jira.humanTicket({summary: '검색 결과 정렬', components: ['DEVELOP'], description: '정렬 기준을 추가해 주세요'})
    jira.humanTicket({summary: '기획 입력', components: ['PLAN'], description: '기획 티켓'})
    const board = await runWorkBoard({root, developer: 'dev1', flags: {}, io: {provider, ticketConfig: {provider: 'jira', jira: config}}})
    assert.equal(board.ok, true, JSON.stringify(board))
    const rows = new Map(board.tickets.map(row => [row.ticketKey, row]))
    assert.equal(rows.get(key).stage, 'registered')
    assert.equal(rows.get(key).blockedReason, 'completed')
    assert.equal(rows.get(other).stage, 'unassessed')
    assert.equal(rows.get(other).blockedReason, null, '판정 전 티켓을 막힌 것으로 그렸다')
    assert.equal(rows.get(other).pickupable, false, '판정 전 티켓을 착수 가능으로 보였다')
    assert.equal(board.tickets.length, 2, '기획 티켓을 개발 티켓 절에 넣었다')
    // 트래커 쓰기는 정해진 것뿐이다 — 요청 코멘트 · 본문 완성(설명·속성) · 역할 라벨 · 첨부 · 배정 · 전이.
    const allowed = /^(comment PF-\d+|PUT \/issue\/PF-\d+|PUT \/issue\/PF-\d+\/properties\/web-harness\.work|POST \/issue\/PF-\d+\/attachments|assign PF-\d+ → dev1|transition PF-\d+ → 31)$/
    assert.deepEqual(describeWrites(jira.writes).filter(write => !allowed.test(write)), [], describeWrites(jira.writes).join(' | '))
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})

