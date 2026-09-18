#!/usr/bin/env node
// test-team-human-tickets-e2e.mjs — 계획 없이 사람이 만든 개발 티켓만 쓰는 3인 팀. 실제 git clone·메모리 Jira.
//
// 원장은 브랜치마다 따로 자라므로, 한 사람의 판정·등록은 머지되기 전까지 다른 클론에 없다. 고정하는 사실:
//   (1) 같은 티켓을 둘이 동시에 확정하면 한 사람만 착수하고, 진 쪽은 「계획이 없다」가 아니라 남이 등록했다고 듣는다
//   (2) 남이 다른 클론에서 방금 등록한 티켓과 수정 범위가 겹치면 착수하지 않는다(트래커 본문의 수정 범위로 잰다)
//   (3) 겹치지 않는 티켓은 그대로 착수하고, 착수 불가 판정은 티켓에 필요한 것을 남긴다
import assert from 'node:assert/strict'
import test from 'node:test'
import {execFileSync} from 'node:child_process'
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createJiraStub} from './ticket/jira-memory-stub.mjs'
import {createJiraProvider} from './ticket/provider-jira-exec.mjs'
import {pickupOutcome, runWorkPickup} from './ticket/work-pickup-run.mjs'
import {assessmentDigest, assessmentPath} from './ticket/ticket-work.mjs'
import {checkTeamSharing} from './validate-development-readiness.mjs'

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim()
const jiraConfig = {baseUrl: 'https://jira.test', projectKey: 'PF', issueType: 'Task', apiVersion: '2', assigneeField: 'name',
  transitions: {'in-progress': '31', done: '41'}, workLink: {mode: 'issue-link', linkType: 'Relates'}, componentAxis: {DEVELOP: '개발 티켓'}}
const ticketConfig = {provider: 'jira', jira: jiraConfig}
const assessment = (key, {acceptance, writePaths = ['src/shared/ui/Table.tsx'], ...over} = {}) => ({schemaVersion: 1, ticket: {key, provider: 'jira'},
  verdict: 'startable', lane: 'change', objective: '표 개선', roles: ['fe'],
  selfCheck: ['new-route', 'new-data-contract', 'new-auth-path', 'new-external-dependency', 'public-contract-change']
    .map(id => ({id, answer: 'no', evidence: ['src/shared/ui/Table.tsx:1']})),
  planningNeeds: [], designNeeds: [], reasons: [], writePaths, nonGoals: [], dependsOn: [],
  acceptance: [{text: acceptance, source: 'ticket'}], testItems: [{id: `TT-${key}-1`, text: acceptance, source: 'proposed'}], ...over})

test('사람 티켓만 쓰는 팀: 동시 확정은 한 사람만, 다른 클론이 방금 집은 같은 파일은 막고, 착수 불가는 티켓에 남긴다', async () => {
  const base = mkdtempSync(join(tmpdir(), 'wh-team-human-'))
  const jira = createJiraStub()
  const providerFor = () => createJiraProvider({config: jiraConfig, fetchImpl: jira.fetchImpl, env: {JIRA_TOKEN: 't'}})
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
    const pickup = (name, key, flags = {}) => runWorkPickup({root: devs[name], ticketKey: key, developer: name, flags, io: {provider: providerFor(), ticketConfig}})
    const confirm = async (name, key, judged) => {
      assert.equal(pickupOutcome(await pickup(name, key)), 'assessing')
      writeFileSync(join(devs[name], assessmentPath(key)), JSON.stringify(judged))
      return pickup(name, key, {assessment: assessmentDigest(judged)})
    }

    const empty = jira.humanTicket({summary: '표 빈 상태', components: ['DEVELOP'], description: '완료 조건: 빈 목록이면 안내 문구'})
    const sort = jira.humanTicket({summary: '표 정렬 아이콘', components: ['DEVELOP'], description: '완료 조건: 정렬 방향 아이콘'})
    const badge = jira.humanTicket({summary: '페이지 제목 배지', components: ['DEVELOP'], description: '완료 조건: 제목 옆에 개수 배지'})
    const pay = jira.humanTicket({summary: '결제 수단 추가', components: ['DEVELOP'], description: '카카오페이를 붙여 주세요'})

    // (1) A·B가 같은 티켓을 동시에 판정하고 확정한다
    const judged = assessment(empty, {acceptance: '빈 목록이면 안내 문구'})
    assert.deepEqual((await Promise.all([pickup('A', empty), pickup('B', empty)])).map(pickupOutcome), ['assessing', 'assessing'])
    for (const name of ['A', 'B']) writeFileSync(join(devs[name], assessmentPath(empty)), JSON.stringify(judged))
    // 순서를 명시한다: B는 A가 티켓 본문을 완성한 뒤, A가 배정하기 전에 티켓을 읽는다(실제로 일어나는 창).
    const plain = providerFor()
    let firstRead = true
    const lateReader = {...plain, async resolveIssue(key) {
      if (firstRead) {
        firstRead = false
        while (!/web-harness:work|WORK-/.test(jira.issues.get(key).fields.description ?? '') && !Object.keys(jira.issues.get(key).properties ?? {}).length) await new Promise(resolve => setTimeout(resolve, 5))
        return {...(await plain.resolveIssue(key)), assignees: []}
      }
      return plain.resolveIssue(key)
    }}
    const race = await Promise.all([
      pickup('A', empty, {assessment: assessmentDigest(judged)}),
      runWorkPickup({root: devs.B, ticketKey: empty, developer: 'B', flags: {assessment: assessmentDigest(judged)}, io: {provider: lateReader, ticketConfig}})])
    assert.deepEqual(race.map(pickupOutcome), ['started', 'stopped'])
    const lost = race[1]
    assert.equal(lost.bounce?.reason, 'ticket-registered-elsewhere', `진 쪽이 엉뚱한 이유로 멈췄다: ${JSON.stringify(lost.bounce)}`)

    // (2) C는 그 등록을 원장에 갖고 있지 않다 — 같은 파일을 쓰는 다른 티켓은 트래커의 수정 범위로 막힌다
    const overlapped = await confirm('C', sort, assessment(sort, {acceptance: '정렬 방향 아이콘'}))
    assert.equal(overlapped.bounce?.reason, 'ticket-overlaps-active-work', JSON.stringify(overlapped.bounce ?? overlapped.errors))
    assert.equal(overlapped.bounce.overlaps[0].ticketKey, empty, '겹친 상대 티켓을 알려주지 않았다')
    // (3) 겹치지 않는 티켓은 착수한다
    const separate = await confirm('C', badge, assessment(badge, {acceptance: '제목 옆에 개수 배지', writePaths: ['src/pages/members/']}))
    assert.equal(pickupOutcome(separate), 'started', JSON.stringify(separate.bounce ?? separate.errors))
    // 착수 불가 판정은 티켓에 필요한 것을 남긴다
    const blocked = await confirm('B', pay, {...assessment(pay, {acceptance: '-'}), verdict: 'needs-planning', writePaths: [], acceptance: [], testItems: [],
      planningNeeds: [{what: '붙일 결제 수단과 수수료 정책', why: '어떤 수단을 붙일지 정해지지 않았다'}]})
    assert.equal(blocked.bounce?.reason, 'ticket-needs-planning')
    assert.match((jira.issues.get(pay).fields.comment?.comments ?? []).map(comment => comment.body).join('\n'), /결제 수단과 수수료 정책/)
  } finally {
    rmSync(base, {recursive: true, force: true})
  }
})
