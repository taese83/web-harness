#!/usr/bin/env node
// test-ticket-routes-e2e.mjs — 기획 티켓과 개발 티켓이 **같은 계약**으로 개발 에이전트에 닿는가(종단).
//
// 계기(2026-09-11 운영 모델 점검): 경로별 단위 회귀는 있었지만 `io.resolveIssue` 같은 주입 stub을 써서
// **Jira provider 코드를 타지 않았다** — AOA-3(조회 필드 누락)이 정확히 그 틈으로 지나갔다. 여기서는
// 메모리 Jira(HTTP 수준 stub)에 **실제 `createJiraProvider`**를 붙여 두 경로를 처음부터 끝까지 돈다.
// stub은 실 Jira처럼 `fields=`로 응답을 거르고, 깨진 JQL·틀린 배정 형식에 400을 준다 — 관대하면 AOA-3 같은
// 요청 쪽 결함이 여기서도 안 보인다(적대 리뷰 2026-09-11). 남은 관대함은 receipt `limits`에 적는다.
//
//   기획 경로: 기획 티켓 intake → (feature-planner가 FEAT를 쓴다 — LLM 단계라 여기서는 계획 파일을 쓴다)
//              → bind → claim(개발 티켓 발행) → 기획자가 트래커에서 준비 항목을 채우고 코멘트 → pickup → link
//   개발 경로: 개발자가 직접 쓴 개발 티켓 adopt --normalize → 기획자 코멘트 → pickup → link
//
// 여기서 고정하는 사실:
//   (1) 두 경로의 change-scope가 **같은 키 집합**이다 — 발급자가 하나이므로 그래야 하고, 실제로 그렇다
//   (2) 기획자의 코멘트가 change-scope에 실린다(격리 블록) — 본문 밖의 결정이 개발 에이전트에 닿는다
//   (3) 트래커 쓰기는 **정해진 것뿐이다** — 스탬프·발행·배정·in-progress 전이. `done` 전이가 설정돼 있어도
//       부르지 않고, 머지·닫기·코멘트는 없다(되돌림이 없는 골든 경로)
//   (4) 원장에 청구와 링크가 남고, 링크 기록의 `ticket`이 change-scope의 개발 기준 개정과 같다
//
// `WEB_HARNESS_E2E_RECEIPT=<경로>`를 주면 실행 요약을 JSON으로 쓴다(사람이 보는 receipt — 게이트가 아니다).
import assert from 'node:assert/strict'
import test from 'node:test'
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {tmpdir} from 'node:os'
import {createJiraProvider} from './ticket/provider-jira-exec.mjs'
import {LEDGER_RELATIVE, PLAN_RELATIVE, readChangeScopeFile, runAdopt, runBind, runClaim, runIntake, runLink, runPickup} from './ticket/cli.mjs'
import {readLedger} from './ticket/ledger-writer.mjs'

const repoRoot = new URL('../..', import.meta.url).pathname
const AXIS = {PLAN: '기획 입력', DEVELOP: '개발 티켓'}
const jiraConfig = {
  baseUrl: 'https://jira.test', projectKey: 'PF', issueType: 'Task', apiVersion: '2', assigneeField: 'name',
  components: ['DEVELOP'],
  // `done`도 매핑돼 있다 — 매핑이 있어도 개발 흐름이 완료 전이를 부르지 않는지 보려는 것이다.
  transitions: {'in-progress': '31', done: '41'},
  componentAxis: AXIS,
}
const ticketConfig = {provider: 'jira', jira: jiraConfig}

/** 메모리 Jira — REST v2의 쓰는 부분만. 모르는 요청은 던진다(조용히 200을 주면 회귀가 거짓 green이다). */
function createJiraStub() {
  const issues = new Map()
  const writes = []
  let clock = 0
  let sequence = 100
  const touch = issue => { issue.fields.updated = `2026-09-11T00:00:${String(++clock).padStart(2, '0')}.000+0000` }
  const add = (key, fields) => {
    const issue = {key, fields: {labels: [], components: [], issuelinks: [], comment: {total: 0, comments: []},
      assignee: null, status: {name: 'Open', statusCategory: {key: 'new'}}, ...fields}}
    touch(issue)
    issues.set(key, issue)
    return issue
  }
  /** 트래커 쪽 사람의 행동(기획자가 코멘트를 단다) — 하네스의 쓰기가 아니므로 `writes`에 넣지 않는다. */
  const humanComment = (key, author, body) => {
    const issue = issues.get(key)
    issue.fields.comment.comments.push({author: {displayName: author}, created: `c${clock}`, body})
    issue.fields.comment.total += 1
    touch(issue)
  }
  const humanEdit = (key, edit) => { const issue = issues.get(key); issue.fields.description = edit(issue.fields.description); touch(issue) }
  const respond = (status, json) => ({ok: status < 400, status, json: async () => json, text: async () => JSON.stringify(json ?? '')})
  const fetchImpl = async (url, {method = 'GET', body = null} = {}) => {
    const parsed = new URL(url)
    const path = parsed.pathname.replace(/^\/rest\/api\/2/, '')
    const data = body ? JSON.parse(body) : null
    if (method !== 'GET') writes.push({method, path, body: data})
    let match
    if (method === 'GET' && path === '/search') {
      const label = parsed.searchParams.get('jql').match(/labels = "([^"]+)"/)?.[1]
      // 실 Jira는 깨진 JQL에 400을 준다 — 빈 결과로 답하면 「기존 티켓 없음 → 새로 발행」으로 조용히 지나간다.
      if (!label) return respond(400, {errorMessages: [`stub이 모르는 JQL: ${parsed.searchParams.get('jql')}`]})
      return respond(200, {issues: [...issues.values()].filter(issue => issue.fields.labels.includes(label))})
    }
    if (method === 'POST' && path === '/issue') {
      const key = `PF-${++sequence}`
      add(key, {...data.fields})
      return respond(201, {key, self: `https://jira.test/rest/api/2/issue/${key}`})
    }
    if ((match = path.match(/^\/issue\/([^/]+)$/))) {
      const issue = issues.get(decodeURIComponent(match[1]))
      if (!issue) return respond(404, {errorMessages: ['없는 이슈']})
      if (method === 'GET') {
        // **요청한 필드만 준다** — 실 Jira처럼. 통째로 주면 조회 필드가 빠진 결함(AOA-3)이 여기서 안 보인다.
        const wanted = parsed.searchParams.get('fields')
        if (!wanted) return respond(200, structuredClone(issue))
        const fields = Object.fromEntries(wanted.split(',').filter(name => name in issue.fields).map(name => [name, structuredClone(issue.fields[name])]))
        return respond(200, {key: issue.key, fields})
      }
      if (method === 'PUT') { Object.assign(issue.fields, data.fields); touch(issue); return respond(204, null) }
    }
    if ((match = path.match(/^\/issue\/([^/]+)\/assignee$/)) && method === 'PUT') {
      // Data Center는 `name`으로 배정한다 — 다른 형식이면 실 Jira처럼 400이다(조용히 비우지 않는다).
      if (typeof data?.name !== 'string') return respond(400, {errorMessages: ['assignee에는 name이 필요하다(DC)']})
      const issue = issues.get(match[1]); issue.fields.assignee = {name: data.name}; touch(issue); return respond(204, null)
    }
    if ((match = path.match(/^\/issue\/([^/]+)\/transitions$/))) {
      const issue = issues.get(match[1])
      if (method === 'GET') return respond(200, {transitions: [{id: '31', name: '진행'}, {id: '41', name: '완료'}]})
      issue.fields.status = {name: data.transition.id, statusCategory: {key: data.transition.id === '41' ? 'done' : 'indeterminate'}}
      touch(issue)
      return respond(204, null)
    }
    if ((match = path.match(/^\/issue\/([^/]+)\/comment$/)) && method === 'POST') {
      humanComment(match[1], 'web-harness', data.body)
      return respond(201, {})
    }
    throw new Error(`jira stub: 모르는 요청 ${method} ${path}`)
  }
  return {issues, writes, add, humanComment, humanEdit, fetchImpl}
}

const projectRoot = () => {
  const root = mkdtempSync(join(tmpdir(), 'wh-routes-'))
  mkdirSync(join(root, '_workspace', '03_dev'), {recursive: true})
  return root
}
// git 쪽 사실은 주입한다 — 이 테스트가 재는 것은 트래커 계약이지 저장소 상태가 아니다.
const gitIo = {
  currentBranch: async () => 'feature/seminar',
  worktree: async () => ({dirty: false, conflicted: false}),
  originSync: async () => ({originExists: true, planMatchesOrigin: true, base: 'origin/feature/seminar'}),
  permission: async () => 'write',
  merged: async () => [],
  refresh: async () => ({ok: true}),
}
// 준비 항목(`- [ ]`) 아래에 기획자가 값을 채운다 — 트래커에서 사람이 하는 일이다.
const fillReadiness = text => String(text).split('\n')
  .flatMap(line => (/^- \[ \] /.test(line) ? [line, '      (기획자가 채운 값)'] : [line])).join('\n')
/** 개발이 수용 기준을 인용한다 — link의 완료 판정이 이것을 본다. */
const citeTestCases = (root, ids) => {
  mkdirSync(join(root, 'src'), {recursive: true})
  writeFileSync(join(root, 'src/feature.test.ts'), ids.map(id => `it('${id}', () => {})`).join('\n'))
}
/** change-scope 키(1단 중첩은 점 표기). */
const keysOf = scope => [...Object.entries(scope)].flatMap(([key, value]) =>
  value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).map(child => `${key}.${child}`) : [key]).sort()
/** 하네스의 트래커 쓰기를 사람이 읽는 꼴로. */
const describeWrites = writes => writes.map(write => {
  if (write.path.endsWith('/transitions')) return `transition ${write.path.split('/')[2]} → ${write.body.transition.id}`
  if (write.path.endsWith('/assignee')) return `assign ${write.path.split('/')[2]} → ${write.body.name}`
  if (write.method === 'POST' && write.path === '/issue') return 'create issue'
  if (write.method === 'PUT') return `update body ${write.path.split('/')[2]}`
  return `${write.method} ${write.path}`
})

async function runPlanRoute() {
  const jira = createJiraStub()
  const root = projectRoot()
  const provider = createJiraProvider({config: jiraConfig, fetchImpl: jira.fetchImpl, env: {JIRA_TOKEN: 't'}})
  const io = {...gitIo, provider, ticketConfig}
  try {
    jira.add('PF-1', {summary: '세미나 신청', description: '임직원이 세미나를 신청한다.\n마감된 세미나는 신청할 수 없다.',
      components: [{name: 'PLAN'}], issuetype: {name: 'Story'}})
    const intake = await runIntake({root, repo: 'o/r', ticketKey: 'PF-1', flags: {}, io})
    assert.equal(intake.ok, true, JSON.stringify(intake))
    assert.equal(intake.classification, '기획 입력')
    // feature-planner의 몫(LLM) — 스냅샷을 읽고 FEAT·TC를 쓴다. 여기서는 그 산출물을 둔다.
    mkdirSync(join(root, '_workspace/01_plan'), {recursive: true})
    writeFileSync(join(root, PLAN_RELATIVE), ['# Feature Plan', '', '## FEAT-001 세미나 신청', '',
      '<!-- web-harness:unit feat=FEAT-001 dependsOn=none -->', '', '신청 버튼을 누르면 신청된다.',
      'TC-001-1 신청하면 신청 목록에 보인다', 'TC-001-2 마감된 세미나는 버튼이 비활성이다', ''].join('\n'))
    const bind = await runBind({root, repo: 'o/r', featureId: 'FEAT-001', ticketKey: 'PF-1', flags: {}, io})
    assert.equal(bind.ok, true, JSON.stringify(bind))
    const claim = await runClaim({root, repo: 'o/r', flags: {confirm: true, 'no-fetch': true}, io})
    assert.equal(claim.ok, true, JSON.stringify(claim))
    const devKey = readLedger(join(root, LEDGER_RELATIVE)).find(entry => entry.featureId === 'FEAT-001')?.ticketKey
    assert.ok(devKey && devKey !== 'PF-1', `개발 티켓이 발행되지 않았다: ${devKey}`)
    // 기획자가 트래커에서 준비 항목을 채우고 답을 단다.
    jira.humanEdit(devKey, fillReadiness)
    jira.humanComment(devKey, '기획자', '마감 5분 전에는 확인 창을 띄운다')
    const pickup = await runPickup({root, repo: 'o/r', featureId: 'FEAT-001', developer: 'dev1', flags: {'no-fetch': true}, io})
    assert.equal(pickup.ok, true, JSON.stringify(pickup.bounce ?? pickup))
    const scope = readChangeScopeFile(root)
    citeTestCases(root, scope.testCaseIds)
    const link = await runLink({root, featureId: 'FEAT-001', prUrl: 'https://git.test/o/r/pull/11', flags: {}})
    assert.equal(link.ok, true, JSON.stringify(link))
    return {root, jira, devKey, scope, ledger: readLedger(join(root, LEDGER_RELATIVE)), pickup,
      snapshot: readFileSync(join(root, '_workspace', intake.snapshotPath), 'utf8')}
  } catch (error) {
    rmSync(root, {recursive: true, force: true})
    throw error
  }
}

async function runDevelopRoute() {
  const jira = createJiraStub()
  const root = projectRoot()
  const provider = createJiraProvider({config: jiraConfig, fetchImpl: jira.fetchImpl, env: {JIRA_TOKEN: 't'}})
  const io = {...gitIo, provider, ticketConfig}
  try {
    // 개발자가 기획 문서 없이 직접 쓴 개발 티켓(내부 상태·네트워크 로직 같은 것).
    jira.add('PF-5', {summary: '세션 스토어 정리', description: '동작: 만료 세션을 30초마다 비운다\nTC-002-1 만료 후 조회는 null',
      components: [{name: 'DEVELOP'}], issuetype: {name: 'Task'}})
    const adopt = await runAdopt({root, repo: 'o/r', featureId: 'FEAT-002', ticketKey: 'PF-5',
      flags: {normalize: true, 'depends-on': 'none'}, io})
    assert.equal(adopt.ok, true, JSON.stringify(adopt))
    jira.humanComment('PF-5', '기획자', '만료 기준은 마지막 활동 시각이다')
    const pickup = await runPickup({root, repo: 'o/r', featureId: 'FEAT-002', developer: 'dev2', flags: {'no-fetch': true}, io})
    assert.equal(pickup.ok, true, JSON.stringify(pickup.bounce ?? pickup))
    const scope = readChangeScopeFile(root)
    citeTestCases(root, scope.testCaseIds)
    const link = await runLink({root, featureId: 'FEAT-002', prUrl: 'https://git.test/o/r/pull/12', flags: {}})
    assert.equal(link.ok, true, JSON.stringify(link))
    return {root, jira, devKey: 'PF-5', scope, ledger: readLedger(join(root, LEDGER_RELATIVE)), pickup}
  } catch (error) {
    rmSync(root, {recursive: true, force: true})
    throw error
  }
}

test('기획 티켓과 개발 티켓이 같은 계약으로 닿는다 — 실제 Jira provider, 처음부터 끝까지', async () => {
  const plan = await runPlanRoute()
  const develop = await runDevelopRoute()
  try {
    // (1) 같은 키 집합
    assert.deepEqual(keysOf(plan.scope), keysOf(develop.scope), '두 경로의 change-scope 키가 다르다 — 개발 에이전트가 경로를 가려야 한다')

    for (const [name, route, comment] of [['기획', plan, '마감 5분 전에는 확인 창을 띄운다'], ['개발', develop, '만료 기준은 마지막 활동 시각이다']]) {
      const issue = route.jira.issues.get(route.devKey)
      // (2) 기획자의 답이 격리 블록으로 실린다
      // 펜스 **안에만** 있어야 한다 — 두 조건을 따로 보면 펜스 밖 유출도 통과한다.
      const text = route.scope.TARGET_BEHAVIOR
      const open = text.match(/^(`{3,})text untrusted-ticket-comments$/m)
      assert.ok(open, `${name}: 코멘트 격리 블록이 없다 — 기획자의 코멘트가 개발 에이전트에 닿지 않는다`)
      const start = text.indexOf(open[0]) + open[0].length
      const end = text.indexOf(`\n${open[1]}`, start)
      assert.ok(end > start, `${name}: 코멘트 격리 블록이 닫히지 않았다`)
      assert.ok(text.slice(start, end).includes(comment), `${name}: 기획자의 코멘트가 격리 블록 안에 없다`)
      assert.ok(!(text.slice(0, start) + text.slice(end)).includes(comment), `${name}: 코멘트가 격리 블록 밖에도 실렸다`)
      // 개발 기준 개정 = 픽업이 끝난 뒤 트래커의 개정
      assert.equal(route.scope.ticket.provider, 'jira')
      assert.equal(route.scope.ticket.revisionStage, 'settled-at-pickup')
      assert.equal(route.scope.ticket.revision, issue.fields.updated, `${name}: 개발 기준 개정이 픽업 뒤 트래커 개정과 다르다`)
      // (3) 트래커 쓰기는 정해진 것뿐 — done(41) 전이 없음, 코멘트 없음
      const transitions = route.jira.writes.filter(write => write.path.endsWith('/transitions'))
      assert.deepEqual(transitions.map(write => write.body.transition.id), ['31'], `${name}: in-progress 말고 다른 전이를 불렀다`)
      assert.equal(route.jira.writes.filter(write => write.path.endsWith('/comment')).length, 0, `${name}: 골든 경로에서 코멘트를 썼다`)
      assert.equal(issue.fields.status.statusCategory.key, 'indeterminate', `${name}: 티켓이 완료로 갔다 — 자동 완료는 사람 승인 없이 하지 않는다`)
      assert.deepEqual(issue.fields.assignee, {name: route === plan ? 'dev1' : 'dev2'})
      // (4) 원장 — 청구와 링크, 링크의 ticket = change-scope의 ticket
      const records = route.ledger.filter(entry => entry.ticketKey === route.devKey || entry.prUrl)
      const linkRecord = route.ledger.find(entry => entry.prUrl)
      assert.ok(records.some(entry => !entry.prUrl), `${name}: 원장에 청구 기록이 없다`)
      assert.deepEqual(linkRecord?.ticket, route.scope.ticket, `${name}: 링크 기록이 개발 기준 개정을 싣지 않았다`)
      assert.equal(linkRecord?.completion?.cited, linkRecord?.completion?.total, `${name}: 수용 기준이 다 인용되지 않았는데 링크됐다`)
    }
    // 경로마다 쓰기의 **종류**가 다르다 — 기획 경로는 출처 스탬프와 발행, 개발 경로는 왕복 스탬프.
    assert.deepEqual(describeWrites(plan.jira.writes), ['update body PF-1', 'create issue', `assign ${plan.devKey} → dev1`, `transition ${plan.devKey} → 31`])
    assert.deepEqual(describeWrites(develop.jira.writes), ['update body PF-5', 'assign PF-5 → dev2', 'transition PF-5 → 31'])
    assert.match(plan.snapshot, /세미나를 신청한다/, '기획 원문이 인테이크 스냅샷에 없다')
    // 쓰기의 **내용**: 발행 티켓의 왕복 키 라벨 · 기획 티켓의 출처 마커 · 개발 티켓의 왕복 마커.
    assert.ok(plan.jira.issues.get(plan.devKey).fields.labels.includes('feat-FEAT-001'), '발행 티켓에 왕복 키 라벨이 없다 — 왕복이 끊긴다')
    assert.match(plan.jira.issues.get('PF-1').fields.description, /web-harness:source/, '기획 티켓에 출처 마커가 없다')
    assert.doesNotMatch(plan.jira.issues.get('PF-1').fields.description, /web-harness:refs/, '기획 티켓에 왕복 마커를 찍었다 — 픽업 대상이 갈라진다')
    assert.match(develop.jira.issues.get('PF-5').fields.description, /web-harness:refs feat=FEAT-002/, '개발 티켓에 왕복 마커가 없다')

    const receiptPath = process.env.WEB_HARNESS_E2E_RECEIPT
    if (receiptPath) {
      mkdirSync(dirname(receiptPath), {recursive: true})
      const head = (() => {
        try {
          const ref = readFileSync(join(repoRoot, '.git/HEAD'), 'utf8').trim()
          return ref.startsWith('ref: ') ? readFileSync(join(repoRoot, '.git', ref.slice(5)), 'utf8').trim().slice(0, 7) : ref.slice(0, 7)
        } catch { return null }
      })()
      writeFileSync(receiptPath, `${JSON.stringify({
        kind: 'ticket-routes-inprocess',
        evidenceClass: '프로세스 내 실행 — 트래커는 stub, LLM 단계는 대역, git은 주입. 실제 Claude Code 종단 실행이 아니다',
        measuredAt: new Date().toISOString(),
        harness: {baseCommit: head, note: 'baseCommit 위의 작업 트리에서 생성 — 커밋 전이면 이 파일이 들어가는 커밋의 트리다'},
        tracker: 'jira (메모리 stub, REST v2) — 실제 createJiraProvider 경유', runtime: {node: process.version},
        routes: Object.fromEntries([['plan', plan], ['develop', develop]].map(([name, route]) => [name, {
          devTicket: route.devKey,
          trackerWrites: describeWrites(route.jira.writes),
          changeScopeKeys: keysOf(route.scope),
          ticket: route.scope.ticket,
          ledger: route.ledger.map(entry => ({featureId: entry.featureId, ticketKey: entry.ticketKey ?? null,
            origin: entry.origin ?? null, prUrl: entry.prUrl ?? null, ticket: entry.ticket ?? null, completion: entry.completion ?? null})),
        }])),
        limits: [
          '트래커는 메모리 stub이다 — 실 Jira의 권한·워크플로우·필드 제약은 재지 않는다(실 Jira 실측은 2026-09-09 AOA 프로젝트 1회)',
          'feature-planner(LLM) 단계는 계획 파일을 직접 써서 대신했다 — 스냅샷에서 FEAT·TC를 뽑는 품질은 재지 않는다',
          'git 상태(브랜치·origin 동기·머지)는 주입했다 — 청구 브랜치와 픽업 브랜치가 같은 상수라 브랜치 대조는 자명 통과다',
          'stub이 실 Jira보다 관대한 곳: 전이 목록이 상태와 무관하게 늘 같고 어떤 전이 id도 받는다 · 권한·필수 필드 검사가 없다',
          '사람의 본문 편집은 문자열 변환이다 — Jira 편집기에서 준비 항목·마커가 살아남는지는 재지 않는다',
          '준비 항목을 채우기 전의 content-incomplete 되돌림은 이 실행이 보여주지 않는다(다른 회귀의 몫)',
          '누가 했는가는 트래커 배정자까지다 — 원장은 Claude 세션·에이전트 id를 잇지 않는다',
        ],
      }, null, 2)}\n`)
    }
  } finally {
    rmSync(plan.root, {recursive: true, force: true})
    rmSync(develop.root, {recursive: true, force: true})
  }
})
