#!/usr/bin/env node
// test-team-human-tickets-e2e.mjs — 계획 없이 사람이 만든 개발 티켓만 쓰는 3인 팀. 실제 git clone·메모리 Jira.
//
// 티켓 원본은 고치지 않고, 판정·등록·연결은 개발자 로컬(git 제외)에 둔다. 고정하는 사실:
//   (1) 판정 전에 배정한다 — 같은 티켓을 둘이 동시에 집으면 한 사람만 판정하고, 남이 맡은 티켓은 판정하지 않는다
//   (2) 착수 불가 판정은 요청 코멘트를 먼저 보여 주고, 확인한 뒤에만 남긴다(라벨 없음, 배정은 그대로)
//   (3) 티켓 본문의 「디자인은 임의로」 지시가 있으면 새 화면도 착수하고, 임의 디자인 알림을 코멘트로 남긴다
//   (4) 내 클론의 진행 중 작업과 수정 범위가 겹치면 착수하지 않고, 그 PR이 머지되면(티켓이 열려 있어도) 착수한다
//   (5) 어느 티켓의 설명·속성·라벨도 바뀌지 않고, 어느 클론의 원장·커밋에도 개발자 기록이 없다
import assert from 'node:assert/strict'
import test from 'node:test'
import {execFileSync} from 'node:child_process'
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createJiraStub} from './ticket/jira-memory-stub.mjs'
import {createJiraProvider} from './ticket/provider-jira-exec.mjs'
import {pickupOutcome, runWorkPickup} from './ticket/work-pickup-run.mjs'
import {runWorkLink} from './ticket/work-link-run.mjs'
import {runWorkBoard} from './ticket/work-board.mjs'
import {assessmentDigest, assessmentPath, registrationPath} from './ticket/ticket-work.mjs'
import {checkTeamSharing} from './validate-development-readiness.mjs'

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim()
const jiraConfig = {baseUrl: 'https://jira.test', projectKey: 'PF', issueType: 'Task', apiVersion: '2', assigneeField: 'name',
  transitions: {'in-progress': '31', done: '41'}, workLink: {mode: 'issue-link', linkType: 'Relates'}, componentAxis: {DEVELOP: '개발 티켓'}}
const ticketConfig = {provider: 'jira', jira: jiraConfig}
const selfCheck = (newRoute = 'no') => ['new-route', 'new-data-contract', 'new-auth-path', 'new-external-dependency', 'public-contract-change']
  .map(id => ({id, answer: id === 'new-route' ? newRoute : 'no', evidence: ['src/shared/ui/Table.tsx:1']}))
const assessment = (key, {acceptance, writePaths = ['src/shared/ui/Table.tsx'], ...over} = {}) => ({schemaVersion: 1, ticket: {key, provider: 'jira'},
  verdict: 'startable', lane: 'change', objective: '표 개선', roles: ['fe'], selfCheck: selfCheck(),
  planningNeeds: [], designNeeds: [], reasons: [], writePaths, nonGoals: [], dependsOn: [],
  acceptance: [{text: acceptance, source: 'ticket'}], testItems: [{id: `TT-${key}-1`, text: acceptance, source: 'proposed'}], ...over})

test('사람 티켓만 쓰는 팀: 배정이 먼저, 요청은 확인 뒤, 임의 디자인은 알리고, 티켓 원본과 원장은 그대로다', async () => {
  const base = mkdtempSync(join(tmpdir(), 'wh-team-human-'))
  const jira = createJiraStub()
  const providerFor = () => createJiraProvider({config: jiraConfig, fetchImpl: jira.fetchImpl, env: {JIRA_TOKEN: 't'}})
  // PR 호스트(메모리) — 머지는 여기에만 있고, 하네스는 기록하지 않고 읽는다.
  const merged = []
  const mergedPrs = async () => merged
  try {
    const origin = join(base, 'origin.git')
    git(base, 'init', '-q', '--bare', '-b', 'main', origin)
    const lead = join(base, 'lead')
    mkdirSync(join(lead, '_workspace/03_dev'), {recursive: true})
    mkdirSync(join(lead, 'src/shared/ui'), {recursive: true})
    writeFileSync(join(lead, 'src/shared/ui/Table.tsx'), 'export const Table = null\n')
    writeFileSync(join(lead, '_workspace/03_dev/spec.json'), JSON.stringify({schemaVersion: 2, specTier: 'unverifiable',
      layerMap: {shared: 'src/shared', pages: 'src/pages'}, testLayers: {unit: 'tests'}}))
    writeFileSync(join(lead, '_workspace/03_dev/work-item-events.jsonl'), '')
    checkTeamSharing(lead, {install: true})
    git(lead, 'init', '-q', '-b', 'main'); git(lead, 'config', 'user.name', 'lead'); git(lead, 'config', 'user.email', 'lead@t')
    git(lead, 'add', '-A'); git(lead, 'commit', '-qm', 'init'); git(lead, 'remote', 'add', 'origin', origin); git(lead, 'push', '-q', 'origin', 'main')
    const devs = {}
    for (const name of ['A', 'B', 'C']) { devs[name] = join(base, name); git(base, 'clone', '-q', origin, devs[name]) }
    const io = () => ({provider: providerFor(), ticketConfig, mergedPrs})
    const pickup = (name, key, flags = {}) => runWorkPickup({root: devs[name], ticketKey: key, developer: name, flags, io: io()})
    const judge = (name, key, judged) => writeFileSync(join(devs[name], assessmentPath(key)), JSON.stringify(judged))
    const confirm = async (name, key, judged) => {
      assert.equal(pickupOutcome(await pickup(name, key)), 'assessing')
      judge(name, key, judged)
      return pickup(name, key, {assessment: assessmentDigest(judged)})
    }

    const empty = jira.humanTicket({summary: '표 빈 상태', components: ['DEVELOP'], description: '완료 조건: 빈 목록이면 안내 문구'})
    const sort = jira.humanTicket({summary: '표 정렬 아이콘', components: ['DEVELOP'], description: '완료 조건: 정렬 방향 아이콘'})
    const pay = jira.humanTicket({summary: '결제 수단 추가', components: ['DEVELOP'], description: '카카오페이를 붙여 주세요'})
    const stats = jira.humanTicket({summary: '회원 통계 화면', components: ['DEVELOP'],
      description: '완료 조건: 가입자 수를 날짜별로 보여 준다\n디자인은 임의로 해 주세요. 기능 먼저 봅니다.'})
    const originals = new Map([empty, sort, pay, stats].map(key => [key, structuredClone(jira.issues.get(key).fields.description)]))

    // (1) A·B가 같은 티켓을 동시에 집는다 — 판정 전에 배정하므로 한 사람만 판정으로 간다.
    const race = await Promise.all([pickup('A', empty), pickup('B', empty)])
    assert.deepEqual(race.map(pickupOutcome).sort(), ['assessing', 'stopped'], JSON.stringify(race.map(item => item.bounce)))
    const owner = pickupOutcome(race[0]) === 'assessing' ? 'A' : 'B'
    assert.equal(jira.issues.get(empty).fields.assignee?.name, owner, '판정하는 사람이 배정돼 있지 않다')
    const late = await pickup('C', empty)
    assert.equal(late.bounce?.reason, 'assigned-to-other', '남이 맡은 티켓을 판정하려 했다')
    const started = await pickup(owner, empty, {assessment: assessmentDigest((judge(owner, empty, assessment(empty, {acceptance: '빈 목록이면 안내 문구'})),
      assessment(empty, {acceptance: '빈 목록이면 안내 문구'})))})
    assert.equal(pickupOutcome(started), 'started', JSON.stringify(started.bounce ?? started.errors))

    // (2) 착수 불가 — 요청 코멘트를 먼저 보여 주고(쓰기 0), 확인한 뒤에만 남긴다. 배정은 그대로다.
    const blocked = {...assessment(pay, {acceptance: '-'}), verdict: 'needs-planning', writePaths: [], acceptance: [], testItems: [],
      planningNeeds: [{what: '붙일 결제 수단과 수수료 정책', why: '어떤 수단을 붙일지 정해지지 않았다'}]}
    assert.equal(pickupOutcome(await pickup('C', pay)), 'assessing')
    judge('C', pay, blocked)
    const preview = await pickup('C', pay)
    assert.equal(preview.bounce?.reason, 'ticket-needs-planning')
    assert.match(preview.requestComment, /결제 수단과 수수료 정책/)
    assert.equal((jira.issues.get(pay).fields.comment?.comments ?? []).length, 0, '확인 전에 요청 코멘트를 남겼다')
    const sent = await pickup('C', pay, {assessment: assessmentDigest(blocked)})
    assert.equal(sent.notified?.done, true, JSON.stringify(sent))
    const comments = (jira.issues.get(pay).fields.comment?.comments ?? []).map(comment => comment.body)
    assert.equal(comments.length, 1)
    assert.match(comments[0], /결제 수단과 수수료 정책/)
    assert.doesNotMatch(comments[0], /<!--|web-harness:/, '사람이 읽는 코멘트에 기계 문자열이 섞였다')
    await pickup('C', pay, {assessment: assessmentDigest(blocked)})
    assert.equal((jira.issues.get(pay).fields.comment?.comments ?? []).length, 1, '같은 판정으로 코멘트를 또 남겼다')
    assert.equal(jira.issues.get(pay).fields.assignee?.name, 'C', '착수 불가로 판정한 사람의 배정을 풀었다')

    // 판정한 사람은 이미 진행 중인 범위가 있다 — 이어지는 단계는 A·B 중 판정하지 않은 사람이 맡는다(누가 이기는지는 경합이 정한다).
    const spare = owner === 'A' ? 'B' : 'A'
    // (3) 본문에 「디자인은 임의로」가 있으면 새 화면도 착수한다 — 원문 인용이 근거이고, 알림 코멘트를 남긴다.
    const free = assessment(stats, {acceptance: '가입자 수를 날짜별로 보여 준다', writePaths: ['src/pages/stats/'], selfCheck: selfCheck('yes'),
      designNeeds: [{what: '차트 모양과 색', why: '디자인이 없다', blocking: false}],
      designByImplementer: {source: 'ticket', quote: '디자인은 임의로 해 주세요.'}})
    const invented = {...free, designByImplementer: {source: 'ticket', quote: '디자인은 알아서'}}
    assert.equal(pickupOutcome(await pickup(spare, stats)), 'assessing')
    judge(spare, stats, invented)
    assert.equal((await pickup(spare, stats)).phase, 'TICKET_ASSESSMENT_INVALID', '원문에 없는 임의 디자인 지시를 받았다')
    judge(spare, stats, free)
    const freeStart = await pickup(spare, stats, {assessment: assessmentDigest(free)})
    assert.equal(pickupOutcome(freeStart), 'started', JSON.stringify(freeStart.bounce ?? freeStart.errors))
    const notice = (jira.issues.get(stats).fields.comment?.comments ?? []).map(comment => comment.body).join('\n')
    assert.match(notice, /디자인 없이 기능을 먼저 구현합니다/)
    assert.match(notice, /차트 모양과 색/)

    // (3-1) 기획이 정하지 않은 세부는 가정하고 진행한다 — 확인한 뒤 가정 알림 코멘트를 남긴다.
    const entry = jira.humanTicket({summary: '진입 컨텍스트', components: ['DEVELOP'],
      description: '완료 조건: 진입점을 한 곳에서 판정한다\n착수 전 확인: 톡이 진입점을 어떻게 전달하는지 미정이다'})
    originals.set(entry, structuredClone(jira.issues.get(entry).fields.description))
    const assumed = assessment(entry, {acceptance: '진입점을 한 곳에서 판정한다', writePaths: ['src/shared/entry/'],
      assumptions: [{what: '진입점 전달 방식', assumed: '쿼리 파라미터 entry로 받는다', why: '톡 전달 방식이 미정이다'}]})
    const assumedPreview = await confirm('C', entry, assumed)
    assert.equal(pickupOutcome(assumedPreview), 'started', JSON.stringify(assumedPreview.bounce ?? assumedPreview.errors))
    const assumeNotice = (jira.issues.get(entry).fields.comment?.comments ?? []).map(comment => comment.body).join('\n')
    assert.match(assumeNotice, /미정 사항을 가정하고 진행합니다/)
    assert.match(assumeNotice, /쿼리 파라미터 entry로 받는다/)
    assert.doesNotMatch(assumeNotice, /<!--|web-harness:/, '사람이 읽는 코멘트에 기계 문자열이 섞였다')
    const scopeText = readFileSync(join(devs.C, '_workspace/03_dev/change-scope.md'), 'utf8')
    assert.match(scopeText, /쿼리 파라미터 entry로 받는다/, '가정이 개발자의 change-scope에 없으면 원문의 「미정」만 보고 다른 가정을 한다')

    // (4) 내 클론의 진행 중 작업과 겹치면 착수하지 않는다 — 그 PR이 머지되면 티켓이 열려 있어도 착수한다.
    const sortJudged = assessment(sort, {acceptance: '정렬 방향 아이콘'})
    const overlapped = await confirm(owner, sort, sortJudged)
    assert.equal(overlapped.bounce?.reason, 'ticket-overlaps-active-work', JSON.stringify(overlapped.bounce ?? overlapped.errors))
    writeFileSync(join(devs[owner], 'src/shared/ui/Table.tsx'), 'export const Table = () => "빈 목록"\n')
    mkdirSync(join(devs[owner], 'tests'), {recursive: true})
    writeFileSync(join(devs[owner], 'tests/table.test.ts'), `// TT-${empty}-1\n`)
    const prUrl = 'https://github.com/acme/web/pull/5'
    const linked = await runWorkLink({root: devs[owner], ticketKey: empty, prUrl, flags: {},
      io: {...io(), prInfo: async () => ({state: 'OPEN', baseRefName: 'main', title: `[${empty}] 빈 상태 문구`}), commitLog: async () => ''}})
    assert.equal(linked.ok, true, JSON.stringify(linked.blocked ?? linked.completion))
    assert.match(linked.prBody, new RegExp(`Relates to ${empty}`))
    merged.push({number: 5, title: `[${empty}] 빈 상태 문구`, mergedAt: new Date().toISOString(), url: prUrl})
    assert.equal(jira.issues.get(empty).fields.status?.statusCategory?.key === 'done', false, '전제: 티켓은 열려 있다')
    const after = await pickup(owner, sort, {assessment: assessmentDigest(sortJudged), 'replace-scope': true})
    assert.equal(pickupOutcome(after), 'started', `머지된 작업이 아직 수정 범위를 쥐었다: ${JSON.stringify(after.bounce)}`)

    // 다른 클론의 보드 — 남의 사람 티켓은 배정으로만 안다(판정·등록은 그 사람의 로컬에 있다).
    const other = spare
    const board = await runWorkBoard({root: devs.C, developer: 'C', flags: {}, io: io()})
    const row = key => board.tickets.find(item => item.ticketKey === key)
    assert.equal(row(empty)?.blockedReason, 'assigned-to-other', JSON.stringify(board.tickets))
    assert.equal(row(pay)?.verdict, 'needs-planning', '내 착수 불가 판정이 내 보드에 없다')
    const ownBoard = await runWorkBoard({root: devs[other], developer: other, flags: {}, io: io()})
    assert.equal(ownBoard.tickets.find(item => item.ticketKey === empty)?.stage, 'unassessed', '다른 클론의 로컬 등록이 보였다')

    // (5) 티켓 원본은 그대로 — 설명·속성·라벨. 개발자 기록은 로컬에만 있고 커밋되지 않는다.
    for (const [key, description] of originals) {
      assert.deepEqual(jira.issues.get(key).fields.description, description, `${key}의 본문을 고쳤다`)
      assert.deepEqual(Object.keys(jira.issues.get(key).properties ?? {}), [], `${key}에 속성을 썼다`)
      assert.deepEqual(jira.issues.get(key).fields.labels ?? [], [], `${key}에 라벨을 달았다`)
    }
    for (const name of ['A', 'B', 'C']) {
      assert.equal(readFileSync(join(devs[name], '_workspace/03_dev/work-item-events.jsonl'), 'utf8'), '', `${name}의 원장에 기록이 생겼다`)
      git(devs[name], 'add', '-A')
      const staged = git(devs[name], 'diff', '--cached', '--name-only')
      assert.doesNotMatch(staged, /ticket-assessments|work-links|change-scope/, `${name}의 로컬 기록이 커밋에 올라간다: ${staged}`)
    }
    assert.ok(readFileSync(join(devs[owner], registrationPath(empty)), 'utf8').includes(empty), '전제: 등록은 로컬에 있다')
  } finally {
    rmSync(base, {recursive: true, force: true})
  }
})
