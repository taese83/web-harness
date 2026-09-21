#!/usr/bin/env node
// test-pilot-report.mjs — 팀 흐름 실측 기록과 집계.
//
// 고정하는 사실:
//   - 흐름 로그는 결과의 모양(명령·키·결과·멈춘 이유)만 남기고 티켓 내용은 싣지 않는다 · 쓰기 실패가 흐름을 막지 않는다
//   - CLI가 실제로 기록한다(배선) · dry-run은 기록하지 않는다
//   - 집계는 흐름 로그·판정서·등록·연결 기록과 트래커·PR을 티켓별로 잇고, 가정 뒤 다른 사람의 답글을 정정 신호로 센다
import assert from 'node:assert/strict'
import test from 'node:test'
import {spawnSync} from 'node:child_process'
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'
import {FLOW_LOG_PATH, flowEntry, readFlowLog, recordFlow} from './ticket/flow-log.mjs'
import {buildPilotReport, renderPilotReport, repliesAfterAssumption, runPilotReport} from './ticket/pilot-report.mjs'
import {assessmentPath, registrationPath} from './ticket/ticket-work.mjs'

const cli = join(dirname(fileURLToPath(import.meta.url)), 'ticket/cli.mjs')
const withRoot = async run => {
  const root = mkdtempSync(join(tmpdir(), 'wh-pilot-'))
  try { return await run(root) } finally { rmSync(root, {recursive: true, force: true}) }
}

test('흐름 로그는 결과의 모양만 남긴다 — 티켓 본문·코멘트·change-scope는 싣지 않는다', () => {
  const entry = flowEntry({command: 'pickup', ticketKey: 'AOA-47', developer: 'dev1', at: 't',
    result: {outcome: 'stopped', bounce: {reason: 'dependency-incomplete', missing: ['X']}, body: '비밀 본문', changeScope: {TARGET_BEHAVIOR: '원문'}}})
  assert.deepEqual(entry, {at: 't', command: 'pickup', ticketKey: 'AOA-47', developer: 'dev1', outcome: 'stopped', phase: null, reason: 'dependency-incomplete'})
  assert.equal(flowEntry({command: 'link', ticketKey: 'A-1', result: {ok: false, blocked: 'work-not-registered'}}).outcome, 'stopped')
  assert.deepEqual(flowEntry({command: 'create', result: {ok: true, phase: 'CREATED', created: [{ticketKey: 'A-9', title: '제목'}]}}).created, ['A-9'])
})

test('기록 실패는 던지지 않고 이유를 돌려준다 · git 제외가 안 된 클론에는 쓰지 않는다', async () => {
  await withRoot(async root => {
    assert.deepEqual(recordFlow(root, {command: 'pickup'}), {recorded: false, reason: 'not-gitignored'}, 'git 제외 전에 로그를 만들면 다음 커밋에 딸려 간다')
    assert.equal(readFlowLog(root).entries.length, 0)
    writeFileSync(join(root, '.gitignore'), `${FLOW_LOG_PATH}\n`)
    writeFileSync(join(root, '_workspace'), '디렉터리가 아니다')
    assert.equal(recordFlow(root, {command: 'pickup'}).recorded, false)
  })
})

test('배선: CLI의 link가 결과를 흐름 로그에 남기고, dry-run은 남기지 않는다', async () => {
  await withRoot(async root => {
    mkdirSync(join(root, '_workspace/03_dev'), {recursive: true})
    writeFileSync(join(root, '.gitignore'), `${FLOW_LOG_PATH}\n`)
    const run = extra => spawnSync(process.execPath, [cli, 'link', 'PF-1', 'https://github.com/o/r/pull/1', '--root', root, ...extra], {encoding: 'utf8'})
    run(['--dry-run'])
    assert.equal(readFlowLog(root).entries.length, 0, 'dry-run을 흐름으로 기록했다')
    run([])
    const {entries} = readFlowLog(root)
    assert.equal(entries.length, 1, `CLI가 기록하지 않았다: ${readFileSync(join(root, FLOW_LOG_PATH), 'utf8').slice(0, 200)}`)
    assert.equal(entries[0].command, 'link')
    assert.equal(entries[0].ticketKey, 'PF-1')
    assert.equal(entries[0].outcome, 'stopped')
  })
})

test('가정 뒤 답글: 알림을 단 사람 말고 다른 사람의 코멘트만 센다', () => {
  const comments = [
    {author: 'dev1', body: '다른 코멘트'},
    {author: 'dev1', body: '아래 미정 사항을 가정하고 진행합니다. 가정이 틀렸으면…'},
    {author: 'dev1', body: '보충'},
    {author: 'planner', body: '쿼리가 아니라 헤더로 옵니다'},
  ]
  assert.equal(repliesAfterAssumption(comments), 1)
  assert.equal(repliesAfterAssumption([{author: 'dev1', body: '없음'}]), null, '알림이 없는데 0으로 셌다')
  assert.equal(repliesAfterAssumption(null), null, '못 읽은 것을 0으로 셌다')
  assert.equal(repliesAfterAssumption(comments, {omitted: 3}), null, '일부만 받은 코멘트로 셌다')
  assert.equal(repliesAfterAssumption([...comments, {author: 'github-actions[bot]', body: '자동'}]), 1, '봇을 정정으로 셌다')
})

test('집계: 티켓별로 판정·멈춤·선행·겹침·완료를 잇고 요약한다', () => {
  const flow = [
    {at: '2026-09-22T01:00:00Z', command: 'pickup', ticketKey: 'A-1', outcome: 'confirm'},
    {at: '2026-09-22T02:00:00Z', command: 'pickup', ticketKey: 'A-1', outcome: 'started'},
    {at: '2026-09-22T03:00:00Z', command: 'pickup', ticketKey: 'A-2', outcome: 'stopped', reason: 'dependency-incomplete'},
    {at: '2026-09-22T04:00:00Z', command: 'link', ticketKey: 'A-1', outcome: 'stopped', reason: 'stale-change-scope'},
  ]
  const report = buildPilotReport({keys: ['A-1', 'A-2'], flow,
    assessments: new Map([['A-1', {verdict: 'startable', lane: 'change', assumptions: [{what: 'x', assumed: 'y', why: 'z'}]}], ['A-2', {verdict: 'startable', lane: 'change'}]]),
    registrations: new Map([['A-2', {dependsOnKeys: ['A-1'], acceptedOverlaps: [{workId: 'W'}]}]]),
    tracker: new Map([['A-1', {statusCategory: 'done', completed: {via: 'merge', at: '2026-09-22T12:00:00Z'}}], ['A-2', {statusCategory: 'indeterminate', completed: null}]]),
    replies: new Map([['A-1', 1]])})
  const [first, second] = report.rows
  assert.equal(first.startedAt, '2026-09-22T02:00:00Z')
  assert.equal(first.leadTimeHours, 10)
  assert.deepEqual(first.linkStops, ['stale-change-scope'])
  assert.deepEqual(second.stops, ['dependency-incomplete'])
  assert.deepEqual(second.dependsOn, ['A-1'])
  assert.equal(second.acceptedOverlaps, 1)
  assert.deepEqual(report.summary, {tickets: 2, started: 1, completed: 1, completedVia: {merge: 1}, verdicts: {startable: 2},
    stopReasons: {'dependency-incomplete': 1}, linkStopReasons: {'stale-change-scope': 1}, ticketsWithAssumptions: 1, assumptionRepliesMeasured: 1,
    assumptionReplyRate: 1, unrecorded: [], acceptedOverlaps: 1, medianLeadTimeHours: 10})
  assert.match(renderPilotReport(report), /\| A-2 \| startable\/change \| 0 \| dependency-incomplete \| A-1 \| 1 \|/)
})

test('실행부: 로컬 기록과 트래커·PR을 읽어 표를 만들고, 쓰지 않는다', async () => {
  await withRoot(async root => {
    writeFileSync(join(root, '.gitignore'), `${FLOW_LOG_PATH}\n`)
    recordFlow(root, {at: '2026-09-22T00:00:00Z', command: 'pickup', ticketKey: 'PF-7', outcome: 'started'})
    mkdirSync(join(root, '_workspace/03_dev/ticket-assessments'), {recursive: true})
    writeFileSync(join(root, assessmentPath('PF-7')), JSON.stringify({verdict: 'startable', lane: 'change', assumptions: [{what: 'a', assumed: 'b', why: 'c'}]}))
    writeFileSync(join(root, registrationPath('PF-7')), JSON.stringify({dependsOnKeys: []}))
    const calls = []
    const provider = {
      name: 'jira',
      async listWorkIssues({keys}) { calls.push(['list', keys]); return {items: [{ticketKey: 'PF-7', statusCategory: 'indeterminate', assignees: []}], complete: true} },
      async resolveIssue(key) { calls.push(['resolve', key]); return {comments: [{author: 'dev', body: '아래 미정 사항을 가정하고 진행합니다.'}, {author: 'pm', body: '맞아요'}]} },
    }
    const merged = [{number: 3, title: '[PF-7] 기능', mergedAt: '2026-09-22T06:00:00Z', url: 'https://x/pull/3'}]
    const result = await runPilotReport({root, flags: {}, io: {provider, mergedPrs: async () => merged, repoContext: async () => null}})
    const [row] = result.report.rows
    assert.equal(row.completedVia, 'merge')
    assert.equal(row.leadTimeHours, 6)
    assert.equal(row.repliesAfterAssumption, 1)
    assert.equal(result.externalWrites, 0)
    assert.ok(calls.every(([kind]) => kind === 'list' || kind === 'resolve'), '집계가 트래커에 썼다')
    assert.match(result.markdown, /티켓별 토큰 비용은 이 표에 없다/)
  })
})

test('집계: 답글을 못 잰 티켓은 비율에서 빠진다 — 측정 0건이면 비율이 없다(0이 아니다) · 기록 없는 티켓을 알린다', () => {
  const assessments = new Map([['A-1', {verdict: 'startable', assumptions: [{what: 'x', assumed: 'y', why: 'z'}]}]])
  const unmeasured = buildPilotReport({keys: ['A-1'], flow: [], assessments, replies: new Map([['A-1', null]])})
  assert.equal(unmeasured.summary.assumptionReplyRate, null, '못 잰 것을 「정정 0%」로 냈다 — 사전 규칙이 그것을 읽는다')
  assert.equal(unmeasured.summary.assumptionRepliesMeasured, 0)
  assert.deepEqual(unmeasured.summary.unrecorded, ['A-1'], '판정은 있는데 흐름 기록이 없는 티켓을 숨겼다')
  assert.match(renderPilotReport(unmeasured), /답글 비율 -\(측정 0\/1/)
})

test('실행부: 티켓 키가 아닌 --keys는 읽기 전에 거부한다', async () => {
  await withRoot(async root => {
    assert.equal((await runPilotReport({root, flags: {keys: 'AOA-1,../x'}, io: {}})).phase, 'INVALID_KEYS')
  })
})
