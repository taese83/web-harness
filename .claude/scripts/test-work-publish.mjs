#!/usr/bin/env node
// test-work-publish.mjs — WORK 발행: 확인한 판본만, 재개 가능하게, 불확실을 부재로 읽지 않게.
//
// 고정하는 사실(설계 §8·§4.5):
//   T58  확인 전에는 외부 쓰기 0 · 검토 뒤 계획이 바뀌면 사전 승인으로 발행하지 않는다
//   T45  선행이 이번 발행에도 없고 등록되지도 않았으면 막는다 — 미등록 선행을 완료로 치지 않는다
//   T12  생성 실패·응답 유실은 `unknown`으로 남고 다음 실행이 **조회로 확인**한다(재발행 금지)
//   T13  일부만 발행된 배치는 성공분을 유지하고 나머지만 재개한다
//   T43·T48 공유 작업은 티켓 하나이고 소비 FEAT 라벨을 모두 단다
import assert from 'node:assert/strict'
import test from 'node:test'
import {chmodSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {runWorkPublish} from './ticket/work-publish-run.mjs'
import {runClaimWork} from './ticket/work-claim.mjs'
import {canonicalDigest} from './ticket/work-analysis.mjs'
import {appendWorkEvent, foldWorkState, readWorkEvents} from './ticket/work-events.mjs'
import {randomUUID} from 'node:crypto'
import {payloadDigest, planPublish, reconcileAttempt, workIssueFields} from './ticket/work-publish.mjs'
import {parseWorkMarker} from './ticket/work-refs.mjs'
import {buildWorkIssueFieldsFor} from './ticket/provider-jira.mjs'

const repo = new URL('../..', import.meta.url).pathname
const EVENTS = '_workspace/03_dev/work-item-events.jsonl'
const ticketConfig = {jira: {projectKey: 'PF', workLink: {mode: 'issue-link', linkType: 'Relates'}}}
const W = n => `WORK-0000000${n}-0000-4000-8000-00000000000${n}`

// 필드는 **실제 Jira 순수 빌더**로 만든다 — stub이 자기만의 빌더를 쓰면 실 provider가 라벨을 버리는
// 것을 못 본다(리뷰 실측: FEAT 빌더는 `draft.labels`를 무시하고 refs 마커를 덧붙인다).
const JIRA = {projectKey: 'PF', issueType: 'Task', apiVersion: '2'}

/** 메모리 트래커 — provider 계약만 만족한다. 실패를 주입해 재개 경로를 돈다. */
function tracker({failOn = new Set(), noKeyOn = new Set(), lockLedgerAfter = new Set(), lookup = null, ledger = null} = {}) {
  const created = new Map()
  const calls = []
  let sequence = 100
  // 「쓰기 전에 시도를 남긴다」를 **호출 시점에** 잰다 — 원장 안의 앞뒤 순서만 보면 성공 경로에서
  // 생성 뒤에 시도를 적는 구현도 통과한다(프록시).
  const attemptSeenAtCall = fields => {
    if (!ledger) return null
    const digest = payloadDigest(fields)
    return readWorkEvents(ledger).some(event => event.eventType === 'publish-attempted' && event.payload?.payloadDigest === digest)
  }
  return {
    created, calls,
    provider: {
      name: 'jira',
      docFormat: 'jira-wiki',
      buildWorkFields: draft => buildWorkIssueFieldsFor(JIRA, draft),
      async createIssue(fields) {
        const title = fields.fields.summary
        calls.push({kind: 'create', title, labels: fields.fields.labels, attemptRecorded: attemptSeenAtCall(fields)})
        if (failOn.has(title)) throw new Error('JIRA_HTTP_502: 게이트웨이 오류')
        const key = `PF-${++sequence}`
        created.set(key, {...fields.fields, marker: fields.properties?.[0]?.value?.marker ?? null})
        // 생성은 됐는데 **확정을 원장에 못 남기는** 순간을 만든다 — 티켓은 이미 트래커에 있다.
        if (lockLedgerAfter.has(title)) chmodSync(ledger, 0o444)
        return noKeyOn.has(title) ? {} : {ticketKey: key, key, url: `https://jira.test/${key}`}
      },
      async findByWorkId({workId, since}) {
        calls.push({kind: 'find', workId, since})
        if (lookup) return lookup(workId, created)
        const hit = [...created.entries()].filter(([, fields]) => fields.description.includes(workId))
        return {matches: hit.map(([key]) => ({ticketKey: key})), complete: true}
      },
      async linkRelated({parentKey, childKey}) {
        calls.push({kind: 'link', parentKey, childKey})
        return {applied: true, mode: 'issue-link'}
      },
      async listWorkIssues() { return {items: [], complete: true} },
      async resolveIssue(key) {
        const fields = created.get(key)
        return {ticketKey: key, title: fields?.summary ?? '', body: fields ? `${fields.description}${fields.marker ? `\n\n${fields.marker}` : ''}` : ''}
      },
      async updateBody(key, body, {marker = null} = {}) {
        calls.push({kind: 'update-body', key, body})
        if (failOn.has(`body:${key}`)) throw new Error('JIRA_HTTP_502: 본문 갱신 실패')
        if (created.has(key)) created.set(key, {...created.get(key), description: body, ...(marker ? {marker} : {})})
        return {updated: true}
      },
      async updateMarker(key, marker) {
        calls.push({kind: 'update-marker', key})
        if (failOn.has(`body:${key}`)) throw new Error('JIRA_HTTP_502: 표지 갱신 실패')
        if (created.has(key)) created.set(key, {...created.get(key), marker})
        return {updated: true}
      },
      async attachContext(key, {name, content, previous = null}) {
        calls.push({kind: 'attach', key, name, previous})
        if (failOn.has(`attach:${key}`)) throw new Error('JIRA_HTTP_500: 첨부 실패')
        if (created.has(key)) created.set(key, {...created.get(key), context: {name, content}})
        return {ref: `att-${key}-${calls.length}`}
      },
      async comment(key, text) { calls.push({kind: 'comment', key, text}); return {commented: true} },
      async updateLabels(key, {add, remove}) {
        calls.push({kind: 'update-labels', key, add, remove})
        if (created.has(key)) { const fields = created.get(key); created.set(key, {...fields, labels: [...fields.labels.filter(label => !remove.includes(label)), ...add]}) }
        return {added: add, removed: remove}
      },
    },
  }
}

const fixture = name => {
  const root = mkdtempSync(join(tmpdir(), `wh-pub-${name}-`))
  cpSync(join(repo, '.claude/evals/fixtures/work-plan', name), root, {recursive: true})
  return root
}
const within = async (root, fn) => { try { return await fn(root) } finally { rmSync(root, {recursive: true, force: true}) } }
const review = async root => {
  const result = await runClaimWork({root, flags: {}})
  assert.equal(result.phase, 'P1_REVIEW', JSON.stringify(result.errors ?? result))
  return result
}
const events = root => readWorkEvents(join(root, EVENTS))

test('T58: 확인 전에는 외부 쓰기 0이고, 무엇을 어디에 낼지 보여준다', async () => {
  const root = fixture('crud')
  await within(root, async () => {
    await review(root)
    const {provider, calls} = tracker()
    const preview = await runWorkPublish({root, flags: {'work-ids': `${W(1)},${W(3)}`}, io: {provider, ticketConfig}})
    assert.equal(preview.ok, true)
    assert.equal(preview.phase, 'PUBLISH_PREVIEW')
    assert.equal(preview.externalWrites, 0)
    assert.deepEqual(preview.publish.map(item => item.workId), [W(1), W(3)])
    assert.equal(calls.length, 0, '미리보기가 트래커를 불렀다')
    assert.equal(events(root).filter(event => event.eventType.startsWith('publish-')).length, 0, '미리보기가 발행 이벤트를 남겼다')
  })
})

test('T58: 검토 뒤 계획이 바뀌면 사전 승인으로 발행하지 않는다', async () => {
  const root = fixture('editor')
  await within(root, async () => {
    await review(root)
    const planPath = join(root, '_workspace/03_dev/work-plan.json')
    const plan = JSON.parse(readFileSync(planPath, 'utf8'))
    plan.workItems[0].title = '검토 뒤 바뀐 제목'
    writeFileSync(planPath, JSON.stringify(plan))
    const {provider, calls} = tracker()
    const blocked = await runWorkPublish({root, flags: {confirm: true}, io: {provider, ticketConfig}})
    assert.equal(blocked.ok, false)
    assert.equal(blocked.phase, 'PUBLISH_BLOCKED')
    assert.ok(blocked.errors.some(error => /검토 뒤 계획이 바뀌었다/.test(error)), JSON.stringify(blocked.errors))
    assert.equal(calls.length, 0, '확인받지 않은 안을 트래커에 냈다')
  })
})

test('T45: 선행이 이번 발행에도 없고 등록되지도 않았으면 막는다', async () => {
  const root = fixture('crud')
  await within(root, async () => {
    await review(root)
    const {provider} = tracker()
    // 목록 조회 연결(W4)은 회원 타입(W1)·페이지 틀(W3)을 기다린다 — 혼자 발행할 수 없다.
    const blocked = await runWorkPublish({root, flags: {'work-ids': W(4), confirm: true}, io: {provider, ticketConfig}})
    assert.equal(blocked.ok, false)
    assert.ok(blocked.errors.some(error => /선행이 이번 발행에도 없고/.test(error)), JSON.stringify(blocked.errors))
  })
})

test('T45: 사람이 만든 개발 티켓 키 선행은 발행을 막지 않는다 — 트래커에 이미 있고, 착수 때 완료를 잰다', async () => {
  const root = fixture('crud')
  await within(root, async () => {
    const planPath = join(root, '_workspace/03_dev/work-plan.json')
    const plan = JSON.parse(readFileSync(planPath, 'utf8'))
    plan.workItems.find(item => item.workId === W(1)).dependsOn = ['AOA-47']
    writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`)
    await review(root)
    const {provider} = tracker()
    const alone = await runWorkPublish({root, flags: {'work-ids': W(1)}, io: {provider, ticketConfig}})
    assert.equal(alone.errors?.some(error => /선행이 이번 발행에도 없고/.test(error)) ?? false, false, JSON.stringify(alone.errors))
  })
})

test('T12·T13: 일부 실패는 성공분을 유지하고 불확실로 남으며, 재개는 조회로 확인한다(재발행 없음)', async () => {
  const root = fixture('crud')
  await within(root, async () => {
    await review(root)
    // 페이지 틀 발행만 실패시킨다.
    const first = tracker({failOn: new Set(['회원 페이지 틀'])})
    const partial = await runWorkPublish({root, flags: {'work-ids': `${W(1)},${W(3)}`, confirm: true},
      io: {provider: first.provider, ticketConfig}})
    assert.equal(partial.phase, 'PUBLISHED_WITH_PENDING')
    assert.deepEqual(partial.published.map(item => item.workId), [W(1)])
    assert.deepEqual(partial.pending.map(item => item.workId), [W(3)])
    const state = foldWorkState(events(root))
    assert.equal(state.works.get(W(1)).status, 'published')
    assert.equal(state.works.get(W(3)).status, 'unknown')
    // 쓰기 **전에** 시도를 남겼는가 — 요청 지문과 시도 id로 결박한다(§8-3).
    const ledger = events(root)
    const attempted = ledger.filter(event => event.eventType === 'publish-attempted' && event.workId === W(3))
    const unknown = ledger.filter(event => event.eventType === 'publish-unknown' && event.workId === W(3))
    assert.equal(attempted.length, 1)
    assert.match(attempted[0].payload.payloadDigest, /^[0-9a-f]{64}$/, '요청 지문 없이 시도를 남겼다')
    assert.ok(ledger.indexOf(attempted[0]) < ledger.indexOf(unknown[0]), '쓰기 전에 시도를 남기지 않았다')
    assert.equal(attempted[0].operationId, unknown[0].operationId, '같은 시도가 다른 id로 갈렸다')

    // 재개: 트래커에 실제로 없다(조회 완전) → 다시 낸다. 성공한 W1은 재발행하지 않는다.
    const second = tracker()
    for (const [key, fields] of first.created) second.created.set(key, fields)
    const resumed = await runWorkPublish({root, flags: {'work-ids': `${W(1)},${W(3)}`, confirm: true},
      io: {provider: second.provider, ticketConfig}})
    assert.equal(resumed.ok, true)
    assert.deepEqual(resumed.reuse.map(item => item.workId), [W(1)], '이미 발행된 작업을 재사용하지 않았다')
    assert.equal(second.calls.filter(call => call.kind === 'create').length, 1, '성공했던 티켓을 다시 냈다')
    assert.equal(foldWorkState(events(root)).works.get(W(3)).status, 'published')
  })
})

test('T12: 조회가 불완전하면 재발행하지 않고 사람 조정으로 남긴다', async () => {
  const root = fixture('editor')
  await within(root, async () => {
    await review(root)
    const first = tracker({failOn: new Set(['문서 모델·명령·실행 취소'])})
    await runWorkPublish({root, flags: {'work-ids': W(1), confirm: true}, io: {provider: first.provider, ticketConfig}})
    assert.equal(foldWorkState(events(root)).works.get(W(1)).status, 'unknown')
    // 색인 지연: 조회가 불완전하다 — 없다고 단정하면 중복이 생긴다.
    const second = tracker({lookup: () => ({matches: [], complete: false})})
    const held = await runWorkPublish({root, flags: {'work-ids': W(1), confirm: true}, io: {provider: second.provider, ticketConfig}})
    assert.equal(held.ok, false)
    assert.equal(held.phase, 'PUBLISHED_WITH_PENDING')
    assert.match(held.pending[0].reason, /UNKNOWN_REMOTE_RESULT/)
    assert.equal(second.calls.filter(call => call.kind === 'create').length, 0, '불확실한 상태에서 재발행했다')
    // 같은 작업의 티켓이 둘이면 사람이 정리한다 — 자동으로 하나를 고르지 않는다.
    assert.match(reconcileAttempt({lookup: {matches: [{ticketKey: 'PF-1'}, {ticketKey: 'PF-2'}], complete: true}}).reason, /DUPLICATE_REMOTE/)
  })
})

test('T43·T48: 공유 작업은 티켓 하나다 · 라벨은 역할·팀뿐 · 본문은 개발자용 섹션 · 마커는 속성 · AI 맥락은 첨부', async () => {
  const root = fixture('crud')
  await within(root, async () => {
    await review(root)
    const {provider, created, calls} = tracker({ledger: join(root, EVENTS)})
    const published = await runWorkPublish({root, flags: {'work-ids': `${W(1)},${W(3)}`, confirm: true, parent: 'PF-1'},
      io: {provider, ticketConfig}})
    assert.equal(published.ok, true)
    const shared = [...created.values()].find(fields => fields.summary === '회원 타입·API 계약')
    // 라벨은 개발자가 거르는 축(역할)과 팀 라벨뿐이다 — 조회 키·FEAT 라벨은 달지 않는다(2026-09-15 사용자 결정).
    assert.deepEqual([...shared.labels].sort(), ['be', 'fe'], JSON.stringify(shared.labels))
    // 본문은 개발자가 읽는 섹션이다 — 완료 조건·테스트 항목·수정 범위·참고(소비 FEAT 전부).
    for (const heading of ['h3. 완료 조건', 'h3. 수정 범위', 'h3. 참고']) assert.ok(shared.description.includes(heading), `${heading} 섹션이 없다:\n${shared.description}`)
    for (const feat of ['FEAT-001', 'FEAT-002', 'FEAT-003']) assert.ok(shared.description.includes(`기능: ${feat}`), `${feat}가 참고에 없다 — 공유 작업이 소비 FEAT 전부와 연결되지 않았다`)
    assert.equal(shared.description.includes('web-harness:work'), false, '설명에 기계 마커가 보인다')
    assert.ok(shared.context?.name && /"workId": "WORK-00000001/.test(shared.context.content), 'AI 맥락이 첨부되지 않았다')
    const context = foldWorkState(events(root)).works.get(W(1)).context
    assert.ok(context?.ref && context?.digest, '첨부를 원장에 남기지 않았다 — 동기화가 교체할 대상을 모른다')
    assert.equal(calls.filter(call => call.kind === 'create' && call.title === '회원 타입·API 계약').length, 1, '공유 작업을 FEAT마다 복제했다')
    assert.ok(calls.filter(call => call.kind === 'create').every(call => call.attemptRecorded === true),
      '외부 쓰기 시점에 그 요청의 시도가 원장에 없었다 — 응답이 유실되면 흔적 없이 사라진다')
    const marker = parseWorkMarker(shared.marker)
    assert.equal(marker.workId, W(1))
    assert.deepEqual(marker.featureIds, ['FEAT-001', 'FEAT-002', 'FEAT-003'])
    // 부모를 주면 관계를 걸고 그 사실을 원장에 남긴다.
    assert.equal(calls.filter(call => call.kind === 'link').length, 2)
    assert.equal(foldWorkState(events(root)).works.get(W(1)).relation.applied, true)
  })
})

test('T47: 계획 개정 뒤 이미 발행한 티켓의 소비 메타데이터만 맞춘다 — 우리 라벨만, 둘 다 된 뒤에만 원장을 옮기고 코멘트로 알린다', async () => {
  const root = fixture('crud')
  await within(root, async () => {
    await review(root)
    const ledger = join(root, EVENTS)
    const {provider, created, calls} = tracker({ledger})
    const team = labels => ({jira: {...ticketConfig.jira, labels}})
    const ids = {'work-ids': `${W(1)},${W(3)}`}
    const first = await runWorkPublish({root, flags: {...ids, confirm: true}, io: {provider, ticketConfig: team(['team-a'])}})
    assert.equal(first.ok, true, JSON.stringify(first.results))
    const keyOf = workId => foldWorkState(events(root)).works.get(workId).ticketKey
    const [sharedKey, otherKey] = [keyOf(W(1)), keyOf(W(3))]
    created.set(sharedKey, {...created.get(sharedKey), labels: [...created.get(sharedKey).labels, 'human-label']})

    // 계획 개정(발행하지 않은 다른 작업을 고쳤다) → 재검토. 원장은 옛 판본이라 픽업·보드가 `stale-plan`이다.
    const planPath = join(root, '_workspace/03_dev/work-plan.json')
    const revise = mutate => {
      const plan = JSON.parse(readFileSync(planPath, 'utf8'))
      mutate(plan)
      writeFileSync(planPath, JSON.stringify(plan))
      return canonicalDigest(plan)
    }
    const revised = revise(plan => { plan.workItems.find(work => work.workId === W(4)).title = '개정된 제목' })
    await review(root)
    assert.notEqual(foldWorkState(events(root)).works.get(W(1)).planDigest, revised)

    // 미리보기: 무엇을 맞출지 보이고 쓰기는 없다.
    calls.length = 0
    const preview = await runWorkPublish({root, flags: ids, io: {provider, ticketConfig: team(['team-b'])}})
    assert.deepEqual(preview.sync.map(item => item.workId).sort(), [W(1), W(3)].sort())
    assert.deepEqual(preview.sync.find(item => item.workId === W(1)).remove, ['team-a'])
    assert.match(preview.guidance, /sync/)
    assert.equal(calls.length, 0, '미리보기가 트래커를 불렀다')

    // 본문 갱신이 실패하면 그 작업의 원장은 옛 판본 그대로이고 라벨도 쓰지 않는다.
    const broken = tracker({ledger, failOn: new Set([`body:${sharedKey}`])})
    const partial = await runWorkPublish({root, flags: {...ids, confirm: true}, io: {provider: broken.provider, ticketConfig: team(['team-b'])}})
    assert.equal(partial.ok, false)
    assert.equal(partial.results.find(item => item.workId === W(1)).outcome, 'hold')
    assert.notEqual(foldWorkState(events(root)).works.get(W(1)).planDigest, revised, '쓰지 못한 동기화를 원장에 옮겼다')
    assert.equal(broken.calls.some(call => call.kind === 'update-labels' && call.key === sharedKey), false, '본문 실패 뒤에도 라벨을 썼다')

    calls.length = 0
    const synced = await runWorkPublish({root, flags: {...ids, confirm: true}, io: {provider, ticketConfig: team(['team-b'])}})
    assert.equal(synced.ok, true, JSON.stringify(synced.results))
    assert.equal(synced.results.find(item => item.workId === W(1)).outcome, 'synced')
    assert.equal(calls.some(call => call.kind === 'create'), false, '동기화가 새 티켓을 만들었다')
    // 다른 작업만 바뀐 개정이다 — 이 티켓의 소비 FEAT·TC는 그대로라 알리지 않는다(실 왕복에서 소음으로 드러났다).
    assert.equal(calls.filter(call => call.kind === 'comment').length, 0, '판본 표지만 바뀐 동기화에 코멘트를 붙였다')
    assert.equal(foldWorkState(events(root)).works.get(W(1)).planDigest, revised)
    const fields = created.get(sharedKey)
    assert.equal(parseWorkMarker(fields.marker).planDigest, revised, '마커(이슈 속성)가 새 판본이 아니다')
    assert.equal(fields.description.includes('web-harness:work'), false, 'Jira 설명에 마커가 들어갔다 — 글자로 보인다')
    assert.ok(fields.labels.includes('team-b') && !fields.labels.includes('team-a'), JSON.stringify(fields.labels))
    assert.ok(fields.labels.includes('human-label'), '사람이 단 라벨을 뗐다')
    assert.deepEqual(fields.labels.filter(label => !['team-b', 'human-label'].includes(label)).sort(), ['be', 'fe'], '역할 라벨 밖의 라벨을 달았다')
    assert.ok(calls.some(call => call.kind === 'attach' && call.key === sharedKey && call.previous), 'AI 맥락을 새 판본으로 교체하지 않았다')

    // 이 작업이 **책임지는 TC가 바뀌면** 개발자가 읽는 계약 메타데이터가 바뀐 것이다 — 그때는 코멘트로 알린다(티켓 언어로).
    revise(plan => {
      const owner = plan.featureBindings.find(binding => binding.featureId === 'FEAT-001').acceptanceOwners.find(entry => entry.testCaseId === 'TC-001-1')
      owner.workId = W(1)
    })
    const reviewedOwners = await runClaimWork({root, flags: {}})
    assert.equal(reviewedOwners.phase, 'P1_REVIEW', JSON.stringify(reviewedOwners.errors))
    calls.length = 0
    const owners = await runWorkPublish({root, flags: {...ids, confirm: true}, io: {provider, ticketConfig: team(['team-b'])}})
    assert.equal(owners.results.find(item => item.workId === W(1)).notified, true, JSON.stringify(owners.results))
    const notice = calls.find(call => call.kind === 'comment' && call.key === sharedKey)
    assert.ok(notice, '책임 TC가 바뀌었는데 알리지 않았다')
    assert.match(notice.text, /소비 FEAT·책임 TC/, '한국어 작업에 다른 언어로 알렸다')
    assert.equal(calls.some(call => call.kind === 'comment' && call.key === otherKey), false, 'TC가 그대로인 작업에도 알렸다')

    // 맞춘 뒤 다시 부르면 쓰지 않는다.
    assert.deepEqual((await runWorkPublish({root, flags: ids, io: {provider, ticketConfig: team(['team-b'])}})).sync, [])
    calls.length = 0
    await runWorkPublish({root, flags: {...ids, confirm: true}, io: {provider, ticketConfig: team(['team-b'])}})
    assert.equal(calls.filter(call => call.kind.startsWith('update-') || call.kind === 'comment' || call.kind === 'attach').length, 0, '같은 판본을 다시 썼다')

    // **사람이 본문을 고쳤으면 덮어쓰지 않는다** — 판본 표지(속성)만 옮기고, 계획이 새로 요구하는 항목은 코멘트로 넘긴다.
    const humanLine = '* ☐ 오류 응답도 타입으로 다룬다'
    created.set(sharedKey, {...created.get(sharedKey), description: created.get(sharedKey).description.replace(/(h3\. 완료 조건\n)/, `$1${humanLine}\n`)})
    const edited = created.get(sharedKey).description
    revise(plan => {
      plan.workItems.find(work => work.workId === W(4)).title = '사람 편집 뒤 개정'
      plan.featureBindings.find(binding => binding.featureId === 'FEAT-001').acceptanceOwners.find(entry => entry.testCaseId === 'TC-001-2').workId = W(1)
    })
    assert.equal((await runClaimWork({root, flags: {}})).phase, 'P1_REVIEW')
    calls.length = 0
    const kept = await runWorkPublish({root, flags: {...ids, confirm: true}, io: {provider, ticketConfig: team(['team-b'])}})
    const keptRow = kept.results.find(item => item.workId === W(1))
    assert.equal(keptRow.bodyPreserved, true, JSON.stringify(keptRow))
    assert.equal(calls.some(call => call.kind === 'update-body' && call.key === sharedKey), false, '사람이 고친 본문을 덮어썼다')
    assert.equal(created.get(sharedKey).description, edited, '사람 편집이 사라졌다')
    assert.ok(calls.some(call => call.kind === 'update-marker' && call.key === sharedKey), '판본 표지를 옮기지 않았다 — 픽업이 계속 막는다')
    const handOver = calls.find(call => call.kind === 'comment' && call.key === sharedKey)
    assert.ok(handOver && /TC-001-2/.test(handOver.text), `계획이 새로 요구한 항목을 사람에게 넘기지 않았다: ${handOver?.text}`)

    // 끝난 작업은 라벨만 맞춘다 — 닫힌 티켓의 본문을 구현하지 않은 판본으로 바꾸지 않는다. 끝남은 원장이 아니라 트래커에서 읽는다.
    provider.listWorkIssues = async ({keys}) => ({items: keys.filter(key => key === otherKey)
      .map(ticketKey => ({ticketKey, statusCategory: 'done', resolution: 'Fixed', doneAt: new Date().toISOString()})), complete: true})
    revise(plan => { plan.workItems.find(work => work.workId === W(4)).title = '두 번째 개정' })
    await review(root)
    calls.length = 0
    const labelsOnly = await runWorkPublish({root, flags: {...ids, confirm: true}, io: {provider, ticketConfig: team(['team-c'])}})
    assert.equal(labelsOnly.results.find(item => item.workId === W(3)).scope, 'labels-only')
    assert.equal(calls.some(call => call.kind === 'update-body' && call.key === otherKey), false, '끝난 작업의 본문을 바꿨다')
    assert.ok(calls.some(call => call.kind === 'update-labels' && call.key === otherKey))

    // 작업 **내용**이 바뀌었으면 제자리로 고치지 않는다 — 대체로 간다(원장·트래커 불변).
    revise(plan => { plan.workItems.find(work => work.workId === W(1)).objective = '개정된 목표 — 회원 타입에 상태 필드를 더한다' })
    await review(root)
    calls.length = 0
    const refused = await runWorkPublish({root, flags: {...ids, confirm: true}, io: {provider, ticketConfig: team(['team-c'])}})
    const shared = refused.results.find(item => item.workId === W(1))
    assert.equal(shared.refused, 'supersede-required', JSON.stringify(shared))
    assert.equal(calls.some(call => call.key === sharedKey), false, '내용이 바뀐 작업의 티켓을 제자리로 고쳤다')

    // 원장이 기록한 트래커가 아니면 같은 키로 쓰지 않는다.
    calls.length = 0
    const other = await runWorkPublish({root, flags: {...ids, confirm: true},
      io: {provider: {...provider, name: 'github'}, ticketConfig: {github: {workLink: {mode: 'link-only'}}}}})
    const mismatched = other.results.filter(item => item.outcome === 'hold')
    assert.equal(mismatched.length, 2, JSON.stringify(other.results))
    assert.ok(mismatched.every(item => item.refused === 'provider-mismatch'), JSON.stringify(other.results))
    assert.equal(calls.filter(call => call.kind.startsWith('update-') || call.kind === 'comment').length, 0, '다른 트래커의 같은 키에 썼다')
  })
  // 확정되지 않은 작업의 동기화 줄은 원장 파손이다 — 조용히 상태를 만들지 않는다.
  const planId = '22222222-2222-4222-8222-222222222222'
  assert.throws(() => foldWorkState([{eventType: 'publish-synced', workId: W(1), planId, planDigest: 'a'.repeat(64),
    payload: {ticketKey: 'PF-1', payloadDigest: 'b'.repeat(64), labels: []}}]), /WORK_EVENTS_CORRUPT/)
  // 확정되지 않은 작업의 첨부 기록도 파손이다 — 어느 티켓의 첨부인지 원장이 모른다.
  assert.throws(() => foldWorkState([{eventType: 'context-attached', workId: W(1), planId, planDigest: 'a'.repeat(64),
    payload: {ticketKey: 'PF-1', ref: '9', contentDigest: 'c'.repeat(64)}}]), /WORK_EVENTS_CORRUPT/)
})

test('계획 없이 발행을 부르면 계획부터 요구한다 · 이미 발행된 것은 다시 내지 않는다', async () => {
  const root = mkdtempSync(join(tmpdir(), 'wh-pub-empty-'))
  await within(root, async () => {
    const {provider} = tracker()
    const result = await runWorkPublish({root, flags: {confirm: true}, io: {provider, ticketConfig}})
    assert.equal(result.ok, false)
    assert.equal(result.phase, 'PLAN_REQUIRED')
    assert.equal(result.externalWrites, 0)
  })
  // 순수 판정: 이미 발행된 작업은 publish가 아니라 reuse다.
  const plan = {planId: '22222222-2222-4222-8222-222222222222', workItems: [{workId: W(1), dependsOn: [], lifecycle: 'active'}]}
  const state = {works: new Map([[W(1), {status: 'published', ticketKey: 'PF-101'}]])}
  const decision = planPublish({plan, planDigest: 'a'.repeat(64), state,
    reviewed: {planId: plan.planId, planDigest: 'a'.repeat(64)}})
  assert.deepEqual(decision.publish, [])
  assert.deepEqual(decision.reuse, [{workId: W(1), ticketKey: 'PF-101'}])
})

test('생성 응답에 키가 없으면 `unknown`이다 — 성공으로도 실패로도 읽지 않는다', async () => {
  const root = fixture('editor')
  await within(root, async () => {
    await review(root)
    const {provider} = tracker({noKeyOn: new Set(['문서 모델·명령·실행 취소'])})
    const result = await runWorkPublish({root, flags: {'work-ids': W(1), confirm: true}, io: {provider, ticketConfig}})
    assert.equal(result.ok, false)
    assert.equal(result.phase, 'PUBLISHED_WITH_PENDING')
    assert.match(result.pending[0].reason, /키가 없다/)
    assert.equal(foldWorkState(events(root)).works.get(W(1)).status, 'unknown')
  })
})

test('원장에 시도를 남기지 못하면 외부 쓰기를 하지 않는다', async () => {
  const root = fixture('editor')
  await within(root, async () => {
    await review(root)
    chmodSync(join(root, EVENTS), 0o444) // 원장에 더 쓸 수 없다
    const {provider, calls} = tracker()
    const result = await runWorkPublish({root, flags: {'work-ids': W(1), confirm: true}, io: {provider, ticketConfig}})
    chmodSync(join(root, EVENTS), 0o644)
    assert.equal(result.ok, false)
    assert.equal(result.externalWrites, 0, '원장을 못 쓰는데 트래커에 썼다')
    assert.equal(calls.length, 0)
    assert.match(result.pending[0].reason, /원장에 시도를 남기지 못해/)
  })
})

test('미해결 결정이 남은 작업을 이름 대고 고르면 거절한다 — 조용히 빼지 않는다', async () => {
  const root = fixture('crud')
  await within(root, async () => {
    await review(root)
    const {provider, calls} = tracker()
    // W6(상세·수정)은 디자인 조건이 미정이라 blocked-decision이다.
    const blocked = await runWorkPublish({root, flags: {'work-ids': W(6), confirm: true}, io: {provider, ticketConfig}})
    assert.equal(blocked.ok, false)
    assert.equal(blocked.phase, 'PUBLISH_BLOCKED')
    assert.ok(blocked.errors.some(error => /미해결 결정이 남아 있다/.test(error)), JSON.stringify(blocked.errors))
    assert.equal(calls.length, 0)
  })
})

test('발행 뒤 확정을 원장에 남기지 못하면 티켓 키를 결과에 실어 보류한다 — 만든 것을 잊지 않는다', async () => {
  if (typeof process.getuid === 'function' && process.getuid() === 0) return // root는 읽기전용을 무시한다
  const root = fixture('editor')
  await within(root, async () => {
    await review(root)
    const ledger = join(root, EVENTS)
    const {provider, created} = tracker({ledger, lockLedgerAfter: new Set(['문서 모델·명령·실행 취소'])})
    const result = await runWorkPublish({root, flags: {'work-ids': W(1), confirm: true}, io: {provider, ticketConfig}})
    chmodSync(ledger, 0o644)
    assert.equal(result.ok, false)
    assert.equal(created.size, 1, '티켓은 만들어졌어야 한다')
    assert.match(result.pending[0].reason, /원장에 확정을 남기지 못했다/)
    assert.ok(result.results.some(item => typeof item.ticketKey === 'string'), '만든 티켓 키를 결과에서 잃었다')
    // 원장은 시도까지만 안다 — 다음 실행이 조회로 잇는다(재발행하지 않는다).
    assert.equal(foldWorkState(events(root)).works.get(W(1)).status, 'attempted')
  })
})

test('결과를 모르는 작업의 후손은 손자까지 이번에 내지 않는다', async () => {
  const root = fixture('crud')
  await within(root, async () => {
    await review(root)
    // ① 회원 타입(W1) 발행이 실패해 불확실로 남는다.
    const first = tracker({failOn: new Set(['회원 타입·API 계약'])})
    await runWorkPublish({root, flags: {'work-ids': W(1), confirm: true}, io: {provider: first.provider, ticketConfig}})
    assert.equal(foldWorkState(events(root)).works.get(W(1)).status, 'unknown')
    // ② 재개 조회가 불완전해 보류된다 — 그 후손(W4)도, 손자(W5·W6·W7)도 나가면 안 된다.
    const second = tracker({lookup: () => ({matches: [], complete: false})})
    const result = await runWorkPublish({root, flags: {confirm: true}, io: {provider: second.provider, ticketConfig}})
    const publishedTitles = second.calls.filter(call => call.kind === 'create').map(call => call.title)
    assert.deepEqual(publishedTitles, ['회원 페이지 틀'], '선행의 결과를 모르는데 후손을 냈다')
    const heldIds = new Set(result.pending.map(item => item.workId))
    for (const [id, label] of [[W(4), '목록 조회 연결'], [W(5), '검색·필터']]) {
      assert.ok(heldIds.has(id), `${label}이 보류 목록에 없다`)
    }
    // W6는 미해결 결정으로 애초에 빠지고, W7은 그 후손이라 함께 빠진다 — 둘 다 사유가 남는다.
    const skippedIds = new Set(result.skipped.map(item => item.workId))
    assert.ok(skippedIds.has(W(6)) && skippedIds.has(W(7)), JSON.stringify(result.skipped))
    assert.equal(result.phase, 'PUBLISHED_WITH_PENDING')
  })
})

test('결정이 안 난 작업은 전체 발행에서도 목록에 남는다 — 뺀 사실이 사라지지 않는다', async () => {
  const root = fixture('crud')
  await within(root, async () => {
    await review(root)
    const {provider} = tracker()
    const preview = await runWorkPublish({root, flags: {}, io: {provider, ticketConfig}})
    const skipped = new Map(preview.skipped.map(item => [item.workId, item.reason]))
    assert.equal(skipped.get(W(6)), 'blocked-unresolved', JSON.stringify(preview.skipped))
    assert.match(skipped.get(W(7)) ?? '', /blocked-predecessor/)
    assert.equal(preview.publish.some(item => item.workId === W(6)), false)
  })
})

test('부모를 주면 본문에 부모 티켓이 남는다 — `link-only`는 그 참조가 관계의 전부다', async () => {
  const root = fixture('editor')
  await within(root, async () => {
    await review(root)
    const {provider, created} = tracker()
    await runWorkPublish({root, flags: {'work-ids': W(1), confirm: true, parent: 'PF-9'},
      io: {provider, ticketConfig: {jira: {projectKey: 'PF', workLink: {mode: 'link-only'}}}}})
    const body = [...created.values()][0].description
    assert.match(body, /부모 티켓: PF-9 \(본문 참조 — 트래커 관계 아님\)/)
  })
})

test('발행 필드의 라벨은 호출자가 준 것뿐이다 — 조회 키·FEAT 라벨을 덧붙이지 않는다', () => {
  const work = {workId: W(1), title: '공통 타입'}
  const fields = workIssueFields({work, body: '', labels: ['fe', 'team-web', 'fe']})
  assert.deepEqual(fields.labels, ['fe', 'team-web'])
})
