// QA 탭(단계 탭 2단계 — 실행 기반 판정) 회귀.
//
// 고정하는 사실: (1) receipt는 04_qa/evidence/*.json의 표기를 그대로 나르고 손상
// JSON은 제외한다(지어내지 않음), (2) qa-*.md의 "## Result" 첫 토큰만 상태로 읽고
// 미표기는 null이다, (3) TC 판정은 정적 프록시가 아니라 tc-runs.jsonl의 실행 기록
// (exit code)이며 손상 라인은 제외한다, (4) 실행 채널은 package.json의 사전 선언
// test:tc 스크립트뿐이고 미선언은 fail-closed(404)다, (5) 04_qa 부재는 exists:false.
import assert from 'node:assert/strict'
import {existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test from 'node:test'
import {createConsoleServers} from '../server.mjs'
import {WorkspaceCatalog} from '../src/indexer.mjs'

const fixtureRoot = ({withRunScript = true} = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'web-harness-console-qa-'))
  const project = join(root, 'workspace', 'qa-project')
  const qa = join(project, '_workspace', '04_qa')
  mkdirSync(join(project, '_workspace', '01_plan'), {recursive: true})
  mkdirSync(join(qa, 'evidence'), {recursive: true})
  writeFileSync(join(project, '_workspace', '01_plan', 'ux-brief.md'), '# UX\n')
  writeFileSync(join(qa, 'evidence', 'test.json'), JSON.stringify({
    id: 'test',
    command: 'pnpm run test',
    status: 'PASS',
    exitCode: 0,
    startedAt: '2026-08-20T00:38:42.730Z',
    durationMs: 4793,
    qualityCohortId: 'cohort-1',
    sourceFingerprint: 'abcdef0123456789',
  }))
  writeFileSync(join(qa, 'evidence', 'broken.json'), '{not json')
  writeFileSync(join(qa, 'qa-test.md'), '## Result\nWARN\n\n본문\n')
  writeFileSync(join(qa, 'qa-ux.md'), '# 결과 표기 없음\n')
  const validRun = completedAt => JSON.stringify({
    schemaVersion: 1,
    testCaseId: 'TC-001-1',
    command: 'pnpm run test:tc TC-001-1',
    startedAt: '2026-08-20T01:00:00.000Z',
    completedAt,
    durationMs: 1200,
    exitCode: 0,
    signal: null,
    timedOut: false,
    spawnError: null,
    outputTail: '1 passed',
    sourceStamp: null,
  })
  writeFileSync(join(qa, 'tc-runs.jsonl'), `${validRun('2026-08-20T01:00:01.000Z')}\n{broken line\n${validRun('2026-08-20T02:00:01.000Z')}\n`)
  if (withRunScript) {
    writeFileSync(join(project, 'package.json'), JSON.stringify({
      name: 'qa-project',
      private: true,
      scripts: {'test:tc': 'node -e "process.exit(process.argv[1] === \'TC-001-1\' ? 0 : 7)"'},
    }))
  }
  return {root, project}
}

test('QA 요약: receipt·리포트·TC 실행 기록의 정직 경계', t => {
  const fixture = fixtureRoot()
  t.after(() => rmSync(fixture.root, {recursive: true, force: true}))
  const catalog = new WorkspaceCatalog(fixture.root)
  const [project] = catalog.list().projects
  const detail = catalog.detail(project.id)
  assert.equal(detail.qa.exists, true)
  // 손상 JSON은 제외 — 유효 receipt 1건만, 표기 그대로
  assert.equal(detail.qa.receipts.length, 1)
  const receipt = detail.qa.receipts[0]
  assert.equal(receipt.check, 'test')
  assert.equal(receipt.status, 'PASS')
  assert.equal(receipt.exitCode, 0)
  assert.equal(receipt.sourceFingerprint, 'abcdef012345')
  // Result 첫 토큰만 상태로, 미표기는 null
  assert.deepEqual(detail.qa.reports.map(report => [report.name, report.status]), [
    ['qa-test.md', 'WARN'],
    ['qa-ux.md', null],
  ])
  // TC 실행 기록 — 손상 라인 제외, count/latest 정확
  const bucket = detail.qa.tcRuns['TC-001-1']
  assert.equal(bucket.count, 2)
  assert.equal(bucket.latest.completedAt, '2026-08-20T02:00:01.000Z')
  assert.equal(bucket.latest.exitCode, 0)
  // 사전 선언 명령 감지
  assert.equal(detail.qa.tcRunCommandDeclared, true)
})

test('QA 요약: 04_qa 부재는 exists:false, 미선언 스크립트는 false로 정직 보고', t => {
  const root = mkdtempSync(join(tmpdir(), 'web-harness-console-qa-none-'))
  t.after(() => rmSync(root, {recursive: true, force: true}))
  const project = join(root, 'workspace', 'bare-project')
  mkdirSync(join(project, '_workspace', '01_plan'), {recursive: true})
  writeFileSync(join(project, '_workspace', '01_plan', 'ux-brief.md'), '# UX\n')
  const catalog = new WorkspaceCatalog(root)
  const [entry] = catalog.list().projects
  const detail = catalog.detail(entry.id)
  assert.equal(detail.qa.exists, false)
  assert.deepEqual(detail.qa.receipts, [])
  assert.deepEqual(detail.qa.reports, [])
  assert.deepEqual(detail.qa.tcRuns, {})
  assert.equal(detail.qa.tcRunCommandDeclared, false)
})

test('TC 실행 채널: 사전 선언 명령·실행 기록·fail-closed 경계', async t => {
  const fixture = fixtureRoot()
  const servers = createConsoleServers({repositoryRoot: fixture.root, port: 0, previewPort: 0})
  const addresses = await servers.listen()
  t.after(async () => {
    await servers.close()
    rmSync(fixture.root, {recursive: true, force: true})
  })
  const consoleOrigin = `http://127.0.0.1:${addresses.consolePort}`
  const projects = await fetch(`${consoleOrigin}/api/projects`).then(response => response.json())
  const projectId = projects.projects[0].id
  const post = (body, headers = {}) => fetch(`${consoleOrigin}/api/qa/tc-run`, {
    method: 'POST',
    headers: {origin: consoleOrigin, 'x-web-harness-intent': 'run-tc', 'content-type': 'application/json', ...headers},
    body: JSON.stringify(body),
  })
  // intent 누락 → 403
  const forbidden = await fetch(`${consoleOrigin}/api/qa/tc-run`, {
    method: 'POST',
    headers: {origin: consoleOrigin, 'content-type': 'application/json'},
    body: JSON.stringify({project: projectId, testCaseId: 'TC-001-1'}),
  })
  assert.equal(forbidden.status, 403)
  // 형식 오류 TC ID → 400
  const invalid = await post({project: projectId, testCaseId: 'TC-1'})
  assert.equal(invalid.status, 400)
  // 실행 — 선언 스크립트가 TC-001-1이면 exit 0, 아니면 exit 7 (판정은 exit code 그대로)
  const pass = await post({project: projectId, testCaseId: 'TC-001-1'})
  assert.equal(pass.status, 200)
  const passRecord = (await pass.json()).record
  assert.equal(passRecord.exitCode, 0)
  assert.equal(passRecord.timedOut, false)
  const fail = await post({project: projectId, testCaseId: 'TC-002-1'})
  assert.equal(fail.status, 200)
  assert.equal((await fail.json()).record.exitCode, 7)
  // append-only 기록 파일 + 상세 재조회 신선도(기존 2건 + 신규 2건)
  const runsPath = join(fixture.project, '_workspace', '04_qa', 'tc-runs.jsonl')
  assert.ok(existsSync(runsPath))
  assert.equal(readFileSync(runsPath, 'utf8').trim().split('\n').length, 5) // 유효 2 + 손상 1 + 신규 2
  const detail = await fetch(`${consoleOrigin}/api/projects/${encodeURIComponent(projectId)}`).then(response => response.json())
  assert.equal(detail.qa.tcRuns['TC-001-1'].count, 3)
  assert.equal(detail.qa.tcRuns['TC-002-1'].count, 1)
  assert.equal(detail.qa.tcRuns['TC-002-1'].latest.exitCode, 7)
})

test('TC 실행 채널: test:tc 미선언은 fail-closed(404)', async t => {
  const fixture = fixtureRoot({withRunScript: false})
  const servers = createConsoleServers({repositoryRoot: fixture.root, port: 0, previewPort: 0})
  const addresses = await servers.listen()
  t.after(async () => {
    await servers.close()
    rmSync(fixture.root, {recursive: true, force: true})
  })
  const consoleOrigin = `http://127.0.0.1:${addresses.consolePort}`
  const projects = await fetch(`${consoleOrigin}/api/projects`).then(response => response.json())
  const missing = await fetch(`${consoleOrigin}/api/qa/tc-run`, {
    method: 'POST',
    headers: {origin: consoleOrigin, 'x-web-harness-intent': 'run-tc', 'content-type': 'application/json'},
    body: JSON.stringify({project: projects.projects[0].id, testCaseId: 'TC-001-1'}),
  })
  assert.equal(missing.status, 404)
  assert.equal((await missing.json()).error.code, 'TC_RUN_COMMAND_MISSING')
})
