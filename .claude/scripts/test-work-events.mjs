#!/usr/bin/env node
// test-work-events.mjs — WORK 이벤트 원장과 티켓 종류 선판정.
//
// 고정하는 사실:
//   (1) 파손 줄·모르는 종류·스키마 위반은 **예외다** — 버리면 상태가 이전 완료로 되돌아간다(설계 §8)
//   (2) 같은 eventId가 다른 내용이면 실패 · 같은 내용의 재기록은 재실행의 정상 결과다
//   (3) 순서의 정본은 **파일 순서**다 — 시각은 정보다(겹친 append는 시각이 역전돼도 정상이다)
//   (4) append 원자성: **실제로 겹쳐 실행해도** 줄이 섞이거나 사라지지 않는다
//   (5) WORK 티켓은 legacy FEAT 폴백에서 제외된다(T10) — 마커 파손·중복은 명시적 오류다(T11)
import assert from 'node:assert/strict'
import test from 'node:test'
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {randomUUID} from 'node:crypto'
import {spawn} from 'node:child_process'
import {appendWorkEvent, foldWorkState, parseWorkEvents, readWorkEvents, validateWorkEvent} from './ticket/work-events.mjs'
import {buildWorkMarker, classifyTicketKind, parseWorkMarker} from './ticket/work-refs.mjs'
import {pickupTicket} from './ticket/pickup.mjs'
import {checkAdopt} from './ticket/intake.mjs'

const PLAN = '22222222-2222-4222-8222-222222222222'
const WORK = 'WORK-00000001-0000-4000-8000-000000000001'
const DIGEST = 'a'.repeat(64)
const event = (over = {}) => ({schemaVersion: 1, eventId: randomUUID(), planId: PLAN,
  eventType: 'plan-reviewed', at: '2026-09-11T00:00:00.000Z', planDigest: DIGEST, payload: {workIds: [WORK]}, ...over})
const line = value => `${JSON.stringify(value)}\n`
const withDir = async fn => {
  const dir = mkdtempSync(join(tmpdir(), 'wh-events-'))
  try { return await fn(dir) } finally { rmSync(dir, {recursive: true, force: true}) }
}

test('유효한 이벤트는 통과하고 상태로 접힌다 — 이하 거부 검사의 공허 방지', () => {
  const first = event()
  const second = event({at: '2026-09-11T00:01:00.000Z', payload: {workIds: [WORK, 'WORK-00000002-0000-4000-8000-000000000002']}})
  const events = parseWorkEvents(line(first) + line(second))
  assert.equal(events.length, 2)
  const state = foldWorkState(events)
  assert.deepEqual([...state.knownWorkIds].sort(), [WORK, 'WORK-00000002-0000-4000-8000-000000000002'])
  assert.equal(state.lastReviewed.at, '2026-09-11T00:01:00.000Z')
  assert.equal(state.lastReviewed.planDigest, DIGEST)
})

test('파손·스키마 위반·모르는 종류를 조용히 버리지 않는다', () => {
  assert.throws(() => parseWorkEvents('{깨진 JSON\n'), /WORK_EVENTS_CORRUPT/)
  assert.throws(() => parseWorkEvents(line({...event(), schemaVersion: 2})), /WORK_EVENTS_INVALID/)
  assert.throws(() => parseWorkEvents(line({...event(), eventType: 'made-up'})), /eventType은/)
  assert.throws(() => parseWorkEvents(line({...event(), extra: 1})), /알 수 없는 키/)
  assert.throws(() => parseWorkEvents(line({...event(), eventId: 'not-uuid'})), /eventId는 UUID/)
  // 계보 이벤트의 요체가 손상되면 조용히 건너뛰지 않는다 — fold가 말없이 무시하던 자리다.
  assert.throws(() => parseWorkEvents(line({...event(), payload: {workIds: []}})), /payload\.workIds/)
  assert.throws(() => parseWorkEvents(line({...event(), payload: {workIds: ['FEAT-001']}})), /WORK-<UUID>가 아닌 값/)
  assert.throws(() => parseWorkEvents(line({...event(), planDigest: undefined})), /planDigest가 필요하다/)
  assert.deepEqual(validateWorkEvent(event()), [])
})

test('같은 eventId가 다른 내용이면 실패 · 같은 내용의 재기록은 통과 · 겹친 append의 시각 역전은 정상이다', () => {
  const base = event()
  assert.throws(() => parseWorkEvents(line(base) + line({...base, planDigest: 'b'.repeat(64)})), /WORK_EVENTS_CONFLICT/)
  assert.equal(parseWorkEvents(line(base) + line(base)).length, 1, '같은 내용의 재기록을 막았다 — 재실행이 정상이다')
  // 순서의 정본은 파일 순서다. 시각을 먼저 찍은 프로세스가 나중에 쓰는 것은 정상 인터리빙이고,
  // 여기서 막으면 그 뒤로 원장을 **읽을 수 없어** 복구가 손편집뿐이 된다.
  const later = parseWorkEvents(line(event({at: '2026-09-11T00:05:00.000Z'})) + line(event({at: '2026-09-11T00:04:00.000Z'})))
  assert.equal(later.length, 2, '겹친 append의 시각 역전을 오류로 막았다')
  assert.deepEqual(later.map(item => item.at), ['2026-09-11T00:05:00.000Z', '2026-09-11T00:04:00.000Z'], '파일 순서가 정본이다')
})

test('append는 되읽을 수 없는 줄을 쓰지 않고, 겹쳐 써도 줄이 섞이거나 사라지지 않는다', async () => {
  await withDir(async dir => {
    const path = join(dir, 'events.jsonl')
    assert.throws(() => appendWorkEvent(path, {...event(), eventType: 'made-up'}), /WORK_EVENT_REJECTED/)
    assert.equal(readWorkEvents(path).length, 0, '거부한 이벤트가 파일에 닿았다')
    // read-check-append 원자성: 별도 프로세스 8개가 동시에 append해도 8줄이 온전하다.
    const script = `import {appendWorkEvent} from ${JSON.stringify(new URL('./ticket/work-events.mjs', import.meta.url).pathname)}
import {randomUUID} from 'node:crypto'
// 시각을 **쓰기 전에** 찍는다 — 겹치면 역전되며, 그것이 정상이라는 것이 이 테스트의 주장이다.
const at = new Date().toISOString()
appendWorkEvent(process.argv[2], {schemaVersion: 1, eventId: randomUUID(),
  planId: ${JSON.stringify(PLAN)}, eventType: 'plan-reviewed', at,
  planDigest: ${JSON.stringify(DIGEST)}, payload: {workIds: [${JSON.stringify(WORK)}]}})`
    const runner = join(dir, 'append.mjs')
    writeFileSync(runner, script)
    // **실제로 겹쳐 돌린다** — 하나씩 기다려 돌리면 겹침이 0이라 원자성을 아무것도 증명하지 못한다.
    const codes = await Promise.all(Array.from({length: 8}, () => new Promise(resolve => {
      const child = spawn(process.execPath, [runner, path], {stdio: ['ignore', 'ignore', 'pipe']})
      let stderr = ''
      child.stderr.on('data', chunk => { stderr += chunk })
      child.on('close', code => resolve({code, stderr}))
    })))
    assert.deepEqual(codes.map(run => run.code), Array(8).fill(0), codes.map(run => run.stderr).join('\n'))
    const text = readFileSync(path, 'utf8')
    assert.equal(text.split('\n').filter(Boolean).length, 8, '동시 append에서 줄이 섞이거나 사라졌다')
    assert.equal(parseWorkEvents(text).length, 8, '파서가 되읽지 못하는 줄이 생겼다')
  })
})

test('T10·T11: WORK 티켓은 legacy FEAT 폴백에서 제외되고, 마커 파손·중복·충돌은 명시적 오류다', () => {
  const marker = buildWorkMarker({planId: PLAN, workId: WORK, featureIds: ['FEAT-001'], testCaseIds: ['TC-001-1'], planDigest: DIGEST})
  const body = `회원 타입·API 계약을 만든다. 부모 FEAT-001의 TC-001-1을 연다.\n\n${marker}`
  assert.equal(classifyTicketKind(body).kind, 'work')
  assert.deepEqual(parseWorkMarker(body).featureIds, ['FEAT-001'])
  // 선판정이 없으면 이 본문은 FEAT-001의 legacy 티켓으로 읽힌다 — 픽업이 막아야 한다.
  const picked = pickupTicket({issue: {body, title: 'WORK'}, planUnits: [{featureId: 'FEAT-001', testCaseIds: ['TC-001-1']}]})
  assert.equal(picked.ok, false)
  assert.equal(picked.bounce.reason, 'work-ticket-not-feature')
  // 인수도 같다 — 이미 분해 모델의 티켓을 개발 단위로 다시 만들면 이중 소유다.
  const adopted = checkAdopt({ticketKey: 'PF-9', featureId: 'FEAT-001', unit: {featureId: 'FEAT-001'}, body})
  assert.equal(adopted.ok, false)
  assert.equal(adopted.reason, 'work-ticket-not-adoptable')
  // 파손·중복·두 모델 동시 소속
  assert.match(parseWorkMarker('<!-- web-harness:work plan=x work=y rev=z -->').error, /plan이 UUID가 아니다/)
  assert.match(classifyTicketKind(`${marker}\n${marker}`).error, /둘 이상이다/)
  assert.equal(classifyTicketKind(`${marker}\n<!-- web-harness:refs feat=FEAT-001 tc= -->`).kind, 'conflict')
  assert.equal(classifyTicketKind('사람이 쓴 본문').kind, 'unknown')
  // aggregate도 같은 입구에서 거부된다 — 생산자는 아직 없지만(P2-c) 판독 입구는 지금 닫아 둔다.
  const aggregate = '큰 개발 티켓\n<!-- web-harness:aggregate feat=FEAT-001 -->'
  assert.equal(classifyTicketKind(aggregate).kind, 'aggregate')
  assert.equal(pickupTicket({issue: {body: aggregate}, planUnits: []}).bounce.reason, 'aggregate-ticket-not-feature')
  assert.equal(checkAdopt({ticketKey: 'PF-9', featureId: 'FEAT-001', unit: {featureId: 'FEAT-001'}, body: aggregate}).reason, 'aggregate-ticket-not-adoptable')
  assert.throws(() => buildWorkMarker({planId: PLAN, workId: WORK, featureIds: ['FEAT --> 1'], planDigest: DIGEST}), /INVALID_MARKER_FIELD/)
})
