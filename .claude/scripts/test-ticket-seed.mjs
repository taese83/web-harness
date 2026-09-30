#!/usr/bin/env node
// test-ticket-seed.mjs — `create`가 만든 티켓에 초안 판정을 미리 두고, `pickup`이 만든 시점의 지문이 그대로일 때만 쓴다.
//
// 고정하는 사실:
//   - 초안 판정이 있으면 만든 티켓마다 판정서와 지문 기록을 둔다(`TT-DRAFT-n` → `TT-<키>-n`) — pickup은 판정 에이전트 없이 미리보기로 간다
//   - 트래커 본문·스팩·수정 범위 코드 중 하나라도 바뀌면 미리 둔 판정을 버리고 판정 에이전트를 부른다(fail-closed)
//   - 미리 둔 판정이 지금 검증을 통과하지 못해도 오류로 멈추지 않고 판정 에이전트에게 넘긴다
//   - 판정 에이전트가 판정서를 새로 쓰면 지문 기록은 무관하다(일반 판정 경로)
import assert from 'node:assert/strict'
import test from 'node:test'
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {runTicketCreate} from './ticket/ticket-create-run.mjs'
import {runWorkPickup} from './ticket/work-pickup-run.mjs'
import {createJiraStub} from './ticket/jira-memory-stub.mjs'
import {createJiraProvider} from './ticket/provider-jira-exec.mjs'
import {assessmentPath} from './ticket/ticket-work.mjs'
import {seedPath, writePathsFingerprint} from './ticket/ticket-seed.mjs'

const draftText = `## 진입 컨텍스트
### 목적
서비스 진입 경로를 한 곳에서 판정한다
### 수정 범위
- src/shared/entryContext/
### 작업 내용
- 진입 판정 모듈을 둔다
### 완료 조건
- userAgent 를 읽는 파일이 이 모듈뿐이다
### 선행·협의
선행: 없음
`
const selfCheck = ['new-route', 'new-data-contract', 'new-auth-path', 'new-external-dependency', 'public-contract-change']
  .map(id => ({id, answer: 'no', evidence: ['src/shared/index.ts:1']}))
const draftAssessment = {verdict: 'startable', lane: 'fix', objective: '진입 판정을 한 모듈로 모은다', roles: ['fe'], selfCheck,
  planningNeeds: [], designNeeds: [], writePaths: ['src/shared/entryContext/'], nonGoals: [],
  acceptance: [{text: 'userAgent 를 읽는 파일이 이 모듈뿐이다', source: 'ticket'}],
  testItems: [{id: 'TT-DRAFT-1', text: 'userAgent 접근이 한 파일뿐이다', source: 'ticket'}], dependsOn: []}
const spec = {schemaVersion: 2, digest: 'd'.repeat(64), layerMap: {shared: 'src/shared'}, testLayers: {unit: 'tests'}}

const setup = async ({withAssessments = true} = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'wh-ticket-seed-'))
  mkdirSync(join(root, '_workspace/03_dev/ticket-drafts'), {recursive: true})
  mkdirSync(join(root, 'src/shared/entryContext'), {recursive: true})
  writeFileSync(join(root, 'src/shared/entryContext/index.ts'), 'export const entry = 1\n')
  writeFileSync(join(root, '_workspace/03_dev/spec.json'), JSON.stringify(spec))
  writeFileSync(join(root, '_workspace/03_dev/ticket-drafts/entry.md'), draftText)
  if (withAssessments) {
    writeFileSync(join(root, '_workspace/03_dev/ticket-drafts/entry.assessments.json'),
      JSON.stringify({schemaVersion: 1, tickets: {'진입 컨텍스트': draftAssessment}}))
  }
  const jira = createJiraStub()
  const jiraConfig = {baseUrl: 'https://jira.test', projectKey: 'PF', issueType: 'Task', apiVersion: '2', assigneeField: 'name',
    transitions: {'in-progress': '31'}, componentAxis: {DEVELOP: '개발 티켓'}, labels: []}
  const io = () => ({provider: createJiraProvider({config: jiraConfig, fetchImpl: jira.fetchImpl, env: {JIRA_TOKEN: 't'}}), ticketConfig: {provider: 'jira', jira: jiraConfig}})
  const preview = await runTicketCreate({root, flags: {draft: '_workspace/03_dev/ticket-drafts/entry.md'}, io: io()})
  assert.equal(preview.phase, 'CREATE_PREVIEW', JSON.stringify(preview))
  const created = await runTicketCreate({root, flags: {draft: '_workspace/03_dev/ticket-drafts/entry.md', confirm: true, digest: preview.confirmWith.flags[2]}, io: io()})
  assert.equal(created.phase, 'CREATED', JSON.stringify(created))
  const key = created.created[0].ticketKey
  return {root, jira, io, key, preview, created, pickup: (flags = {}) => runWorkPickup({root, ticketKey: key, developer: 'dev1', flags, io: io()})}
}

test('초안 판정을 만든 티켓에 미리 두면 pickup이 판정 에이전트 없이 미리보기로 간다', async () => {
  const ctx = await setup()
  try {
    assert.equal(ctx.preview.seededAssessments.count, 1)
    assert.equal(ctx.created.created[0].assessmentSeeded, true, JSON.stringify(ctx.created))
    const seeded = JSON.parse(readFileSync(join(ctx.root, assessmentPath(ctx.key)), 'utf8'))
    assert.deepEqual(seeded.ticket, {key: ctx.key, provider: 'jira'})
    assert.match(seeded.testItems[0].id, new RegExp(`^TT-${ctx.key}-1$`), '자리표시 테스트 ID를 티켓 키로 바꾸지 않았다')
    const picked = await ctx.pickup()
    assert.equal(picked.phase, 'TICKET_WORK_PREVIEW', JSON.stringify(picked.bounce ?? picked.errors ?? picked))
    assert.ok(picked.seededAssessment, '미리 둔 판정임을 미리보기에 알리지 않았다')
  } finally { rmSync(ctx.root, {recursive: true, force: true}) }
})

for (const [name, mutate, reason] of [
  ['트래커 본문을 고쳤다', ctx => { const issue = ctx.jira.issues.get(ctx.key); issue.fields.description += '\n추가 요구: 로그를 남긴다' }, 'ticket-body-changed'],
  ['스팩이 바뀌었다', ctx => writeFileSync(join(ctx.root, '_workspace/03_dev/spec.json'), JSON.stringify({...spec, digest: 'e'.repeat(64)})), 'spec-changed'],
  ['수정 범위 코드가 바뀌었다', ctx => writeFileSync(join(ctx.root, 'src/shared/entryContext/index.ts'), 'export const entry = 2\n'), 'write-paths-changed'],
]) {
  test(`${name}면 미리 둔 판정을 버리고 판정 에이전트를 부른다`, async () => {
    const ctx = await setup()
    try {
      mutate(ctx)
      const picked = await ctx.pickup()
      assert.equal(picked.phase, 'TICKET_ASSESSMENT_REQUIRED', JSON.stringify(picked))
      assert.ok(picked.seedStale?.includes(reason), `이유를 싣지 않았다: ${JSON.stringify(picked.seedStale)}`)
      assert.equal(existsSync(join(ctx.root, assessmentPath(ctx.key))), false, '낡은 판정서를 남겼다 — 판정 에이전트가 새로 써야 한다')
      assert.equal(existsSync(join(ctx.root, seedPath(ctx.key))), false)
    } finally { rmSync(ctx.root, {recursive: true, force: true}) }
  })
}

test('미리 둔 판정이 지금 검증을 통과하지 못하면 오류가 아니라 판정 요구로 넘긴다', async () => {
  const ctx = await setup()
  try {
    const path = join(ctx.root, assessmentPath(ctx.key))
    const seeded = JSON.parse(readFileSync(path, 'utf8'))
    // 경계를 좁혀 writePaths가 스팩 밖이 되게 한다 — 스팩 digest는 그대로(지문은 통과, 검증은 실패).
    writeFileSync(join(ctx.root, '_workspace/03_dev/spec.json'), JSON.stringify({...spec, layerMap: {shared: 'src/other'}}))
    const picked = await ctx.pickup()
    assert.equal(picked.phase, 'TICKET_ASSESSMENT_REQUIRED', JSON.stringify(picked))
    assert.ok(picked.seedStale?.includes('seeded-assessment-invalid'))
    assert.ok(seeded)
  } finally { rmSync(ctx.root, {recursive: true, force: true}) }
})

test('판정 에이전트가 판정서를 새로 쓰면 지문 기록은 무관하다 — 일반 판정으로 검증한다', async () => {
  const ctx = await setup()
  try {
    const path = join(ctx.root, assessmentPath(ctx.key))
    const rewritten = {...JSON.parse(readFileSync(path, 'utf8')), objective: '판정 에이전트가 다시 쓴 목적'}
    writeFileSync(path, JSON.stringify(rewritten))
    writeFileSync(join(ctx.root, 'src/shared/entryContext/index.ts'), 'export const entry = 3\n')  // 지문은 어긋나지만 무관해야 한다
    const picked = await ctx.pickup()
    assert.equal(picked.phase, 'TICKET_WORK_PREVIEW', JSON.stringify(picked.bounce ?? picked.errors ?? picked))
    assert.equal(picked.seededAssessment, undefined)
    assert.equal(existsSync(join(ctx.root, seedPath(ctx.key))), false, '무관해진 지문 기록을 남겼다')
  } finally { rmSync(ctx.root, {recursive: true, force: true}) }
})

test('초안 판정이 없으면 지금처럼 pickup이 판정을 요구한다', async () => {
  const ctx = await setup({withAssessments: false})
  try {
    assert.equal(ctx.preview.seededAssessments.count, 0)
    assert.equal((await ctx.pickup()).phase, 'TICKET_ASSESSMENT_REQUIRED')
  } finally { rmSync(ctx.root, {recursive: true, force: true}) }
})

test('파일 지문: 심볼릭 링크·글롭·범위 밖은 셀 수 없음(null)이다', () => {
  const root = mkdtempSync(join(tmpdir(), 'wh-ticket-seed-fp-'))
  try {
    mkdirSync(join(root, 'src'), {recursive: true})
    writeFileSync(join(root, 'src/a.ts'), 'a')
    assert.match(writePathsFingerprint(root, ['src/']), /^[0-9a-f]{64}$/)
    assert.equal(writePathsFingerprint(root, ['src/**/*.ts']), null)
    assert.equal(writePathsFingerprint(root, ['../outside']), null)
  } finally { rmSync(root, {recursive: true, force: true}) }
})

// ── `pickup --reassess`: 본문을 고친 뒤 바뀐 절만 다시 판정한다 ──
const {ASSESSMENT_HISTORY_DIR, assessedBodyPath, changedTicketSections} = await import('./ticket/ticket-reassess.mjs')

test('재판정: 확인한 판정의 원문을 남기고, 본문을 고친 뒤 --reassess는 판정서를 이력으로 옮기고 바뀐 절만 넘긴다', async () => {
  const ctx = await setup()
  try {
    const preview = await ctx.pickup()
    assert.equal(preview.phase, 'TICKET_WORK_PREVIEW', JSON.stringify(preview.errors ?? preview))
    await ctx.pickup({assessment: preview.confirmWith.value})
    assert.ok(existsSync(join(ctx.root, assessedBodyPath(ctx.key))), '판정이 기댄 원문을 남기지 않았다')
    // 트래커에서 완료 조건 한 줄을 고친다.
    const issue = ctx.jira.issues.get(ctx.key)
    issue.fields.description = issue.fields.description.replace('userAgent 를 읽는 파일이 이 모듈뿐이다', 'userAgent 를 읽는 파일이 이 모듈 하나뿐이다')
    const plain = await ctx.pickup()
    assert.equal(plain.ticketWork?.bodyChanged ?? plain.extra?.ticketWork?.bodyChanged ?? JSON.stringify(plain).includes('"bodyChanged":true'), true, '본문이 바뀐 것을 알리지 않았다')
    const again = await ctx.pickup({reassess: true})
    assert.equal(again.phase, 'TICKET_ASSESSMENT_REQUIRED', JSON.stringify(again))
    assert.equal(again.next.mode, 'ticket-reassessment')
    assert.match(again.next.previous, new RegExp(`^${ASSESSMENT_HISTORY_DIR}/`))
    assert.ok(existsSync(join(ctx.root, again.next.previous)), '이전 판정서를 이력으로 옮기지 않았다')
    assert.equal(existsSync(join(ctx.root, assessmentPath(ctx.key))), false)
    assert.deepEqual(again.reassess.changedSections, [{section: '완료 조건', change: 'modified'}])
  } finally { rmSync(ctx.root, {recursive: true, force: true}) }
})

test('바뀐 절 대조: 세 서식(markdown·Jira 위키·평문)을 읽고, 양식 밖이면 null(전체 재판정)', () => {
  assert.deepEqual(changedTicketSections('### 목적\na\n### 완료 조건\n- x', '### 목적\na\n### 완료 조건\n- y'), [{section: '완료 조건', change: 'modified'}])
  assert.deepEqual(changedTicketSections('h3. 목적\na', 'h3. 목적\na\n\nh3. 하지 않는 것\n* z'), [{section: '하지 않는 것', change: 'added'}])
  assert.deepEqual(changedTicketSections('[목적]\na\n[선행·협의]\nb', '[목적]\na'), [{section: '선행·협의', change: 'removed'}])
  assert.equal(changedTicketSections('자유 서술 티켓', '### 목적\na'), null)
})
