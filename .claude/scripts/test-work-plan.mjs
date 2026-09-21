#!/usr/bin/env node
// test-work-plan.mjs — WORK 분해의 선행 분석(P0)·계획(P1) 검증기가 **막아야 할 것을 막는가**.
//
// 두 fixture(서버 데이터 중심 회원 관리 CRUD · 로컬 문서 상태 중심 편집기)의 분석·계획은 system-architect
// 산출물의 대역이다. 유효한 원본이 통과함을 먼저 보이고(공허 방지), 한 곳씩 망가뜨려 해당 인수 시나리오가
// 막히는지 본다. 번호는 docs 설계안의 T01~T62.
import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {canonicalDigest, validateWorkAnalysis, WORK_ANALYSIS_KEYS} from './ticket/work-analysis.mjs'
import {computeWorkView, validateWorkPlan, WORK_PLAN_KEYS} from './ticket/work-plan.mjs'
import {parseFeaturePlanUnits} from './ticket/plan-units.mjs'
import {unitContentHash} from './ticket/emit.mjs'
import {validateDesignBinding} from './design-binding-lib.mjs'
import {deferredTestCases} from './ticket/completion.mjs'

const repo = new URL('../..', import.meta.url).pathname
const fixture = name => join(repo, '.claude/evals/fixtures/work-plan', name)
const readJson = (name, rel) => JSON.parse(readFileSync(join(fixture(name), rel), 'utf8'))
const clone = value => structuredClone(value)

/** fixture 하나의 입력 묶음. mutate(analysis, plan)로 한 곳을 망가뜨린 뒤 두 검증을 돌린다. */
function evaluate(name, mutate = () => {}, {knownWorkIds = new Set(), scope = null, planText = null} = {}) {
  const text = planText ?? readFileSync(join(fixture(name), '_workspace/01_plan/feature-plan.md'), 'utf8')
  const units = parseFeaturePlanUnits(text)
  const analysis = clone(readJson(name, '_workspace/03_dev/work-analysis.json'))
  const plan = clone(readJson(name, '_workspace/03_dev/work-plan.json'))
  let designBinding = null
  try { designBinding = readJson(name, '_workspace/00_source/design-binding.json') } catch { /* 편집기: 디자인 부재 */ }
  const reanchor = mutate(analysis, plan) === 'reanchor'
  if (reanchor) plan.analysisRef.digest = canonicalDigest(analysis) // 분석을 고친 뒤 계획이 새 판본을 가리키게
  const scopeFeatureIds = scope ?? units.map(unit => unit.featureId)
  const a = validateWorkAnalysis(analysis, {scopeFeatureIds, io: {exists: () => true}})
  const p = validateWorkPlan(plan, {analysis, analysisIds: a.ids, units, deferredTcs: deferredTestCases(text), unitDigest: unitContentHash,
    designBinding, knownWorkIds, io: {exists: () => true}})
  return {a, p, analysis, plan, errors: [...a.errors, ...p.errors]}
}
const W = n => `WORK-0000000${n}-0000-4000-8000-00000000000${n}`
const work = (plan, n) => plan.workItems.find(item => item.workId === W(n))
const expectError = (result, pattern, message) => assert.ok(result.errors.some(error => pattern.test(error)),
  `${message}\n실제 오류: ${JSON.stringify(result.errors, null, 1)}`)

test('유효한 두 fixture는 통과한다 — 이하 모든 거부 검사의 공허 방지', () => {
  for (const name of ['crud', 'editor']) {
    const {errors, a} = evaluate(name)
    assert.deepEqual(errors, [], `${name}: 유효한 계획이 거부됐다`)
    assert.deepEqual(a.scopeBlocked, [])
  }
  const binding = readJson('crud', '_workspace/00_source/design-binding.json')
  assert.deepEqual(validateDesignBinding(binding).errors, [], 'fixture의 design-binding이 기존 스키마를 어긴다')
})

test('T01·T03·T43: FEAT·TC는 그대로, 공통 WORK는 하나이고 소비하는 FEAT 전부가 같은 ID를 참조한다', () => {
  const {plan, p} = evaluate('crud')
  const units = parseFeaturePlanUnits(readFileSync(join(fixture('crud'), '_workspace/01_plan/feature-plan.md'), 'utf8'))
  assert.deepEqual(units.map(unit => unit.featureId), ['FEAT-001', 'FEAT-002', 'FEAT-003', 'FEAT-004', 'FEAT-005'], '기획 FEAT가 바뀌었다')
  assert.equal(p.featureOfWork.get(W(1)).size, 3, '공통 기반이 소비 FEAT 셋에 하나로 연결되지 않았다')
  assert.equal(plan.workItems.filter(item => item.title === '회원 타입·API 계약').length, 1, '공통 WORK가 FEAT마다 복제됐다')
})

test('T02: 기반 작업은 사용자 TC 없이 checks로 유효하다 — checks가 없으면 막는다', () => {
  assert.deepEqual(work(evaluate('crud').plan, 1).contributesTo, [], 'fixture가 전제를 잃었다')
  expectError(evaluate('crud', (analysis, plan) => { work(plan, 1).checks = [] }), /checks가 비었다/, '검증 기준 없는 기반 작업을 통과시켰다')
  expectError(evaluate('crud', (analysis, plan) => { work(plan, 1).contributesTo = ['TC-999-1'] }), /TC가 아니다/, '가짜 TC를 통과시켰다')
})

test('작업마다 누가 집는지(roles)를 적는다 — 트래커 라벨이 되어 개발자가 fe·be로 거른다', () => {
  expectError(evaluate('crud', (analysis, plan) => { delete work(plan, 4).roles }), /roles가 없다/, '역할 없는 작업을 통과시켰다')
  expectError(evaluate('crud', (analysis, plan) => { work(plan, 4).roles = [] }), /roles가 없다/, '빈 역할을 통과시켰다')
  expectError(evaluate('crud', (analysis, plan) => { work(plan, 4).roles = ['Front End'] }), /소문자 식별자/, '라벨로 못 쓰는 역할을 통과시켰다')
  expectError(evaluate('crud', (analysis, plan) => { work(plan, 4).roles = ['fe', 'fe'] }), /중복/, '중복 역할을 통과시켰다')
})

test('T04: 필수 TC의 최종 검증 책임이 빠지거나 둘이면 막는다', () => {
  expectError(evaluate('crud', (analysis, plan) => { plan.featureBindings[0].acceptanceOwners.pop() }), /책임이 없는 TC — TC-001-3/, 'TC 책임 누락을 통과시켰다')
  expectError(evaluate('crud', (analysis, plan) => { plan.featureBindings[0].acceptanceOwners.push({testCaseId: 'TC-001-1', workId: W(7)}) }), /책임이 둘이다/, '책임 중복을 통과시켰다')
})

test('T05: 검토 계보에 있던 작업을 배열에서 지우면 막는다 — 취소로 남기면 통과하고, 취소 뒤 지우는 2단 삭제도 막는다', () => {
  const knownWorkIds = new Set(readJson('crud', '_workspace/03_dev/work-plan.json').workItems.map(item => item.workId))
  const removed = evaluate('crud', (analysis, plan) => { plan.workItems = plan.workItems.filter(item => item.workId !== W(5)) }, {knownWorkIds})
  expectError(removed, /사라졌다/, '작업 삭제로 분모를 줄였다')
  const cancel = plan => {
    work(plan, 5).lifecycle = 'cancelled'
    plan.featureBindings[1].requiredWorkIds = plan.featureBindings[1].requiredWorkIds.filter(id => id !== W(5))
    plan.featureBindings[1].acceptanceOwners = [{testCaseId: 'TC-002-1', workId: W(4)}]
  }
  const cancelled = evaluate('crud', (analysis, plan) => cancel(plan), {knownWorkIds})
  assert.ok(!cancelled.errors.some(error => /사라졌다/.test(error)), '취소로 남긴 작업까지 막았다')
  // 1회차에 취소 → 2회차에 배열에서 삭제: 직전 판본에서는 이미 취소라 판본 하나만 보면 놓친다.
  const twoStep = evaluate('crud', (analysis, plan) => { cancel(plan); plan.workItems = plan.workItems.filter(item => item.workId !== W(5)) }, {knownWorkIds})
  expectError(twoStep, /사라졌다/, '취소 뒤 지우는 2단 삭제를 통과시켰다')
})

test('기획이 명시 유예한 TC는 책임에서 빠지고, 표시를 지우면 다시 필수가 된다', () => {
  assert.equal(evaluate('crud').errors.length, 0, 'TC-003-3([유예])에 책임을 요구했다')
  const text = readFileSync(join(fixture('crud'), '_workspace/01_plan/feature-plan.md'), 'utf8').replace(/ \[유예:[^\]]*\]/, '')
  // 명세가 바뀌므로 sourceDigest도 새 값으로 맞춘 뒤, TC 책임 누락만 남는지 본다.
  const units = parseFeaturePlanUnits(text)
  const result = evaluate('crud', (analysis, plan) => { plan.featureBindings[2].sourceDigest = unitContentHash(units.find(unit => unit.featureId === 'FEAT-003')) }, {planText: text})
  expectError(result, /책임이 없는 TC — TC-003-3/, '유예 표시가 사라졌는데 책임 없이 통과했다')
})

test('T06·T07: 기반끼리 순환·미선언 의존은 종류와 무관하게 막는다 · 명시적 []는 무의존이다', () => {
  expectError(evaluate('crud', (analysis, plan) => { work(plan, 1).dependsOn = [W(3)]; work(plan, 3).dependsOn = [W(1)] }), /의존 순환/, 'foundation 순환을 통과시켰다')
  expectError(evaluate('crud', (analysis, plan) => { delete work(plan, 3).dependsOn }), /dependsOn이 없다/, '미선언 의존을 무의존으로 읽었다')
  expectError(evaluate('crud', (analysis, plan) => { work(plan, 4).dependsOn = [W(1), W(3), W(4)] }), /자기 자신/, '자기 의존을 통과시켰다')
})

test('T08: 같은 경로를 순서 없이 쓰면 막는다 — 의존으로 순서가 있으면 허용한다', () => {
  // fixture: 페이지 틀(W3)과 통합(W7)이 같은 파일을 쓰지만 W7이 W3을 전이적으로 기다린다.
  assert.equal(evaluate('crud').errors.length, 0)
  expectError(evaluate('crud', (analysis, plan) => { work(plan, 5).writePaths = ['src/pages/members/detail/'] }), /경로 충돌/, '순서 없는 동시 수정을 통과시켰다')
})

test('제공 계약을 소비하면 그 제공 작업에 의존해야 한다', () => {
  expectError(evaluate('crud', (analysis, plan) => { work(plan, 6).dependsOn = [W(4)]; work(plan, 4).dependsOn = [W(3)] }), /의존하지 않는다/, '제공자 없이 계약을 소비했다')
})

test('고아 작업 · 근거 없는 작업 · 분석과 다른 판본(T42)을 막는다', () => {
  expectError(evaluate('crud', (analysis, plan) => { plan.featureBindings[1].requiredWorkIds = plan.featureBindings[1].requiredWorkIds.filter(id => id !== W(5)); plan.featureBindings[1].acceptanceOwners = [{testCaseId: 'TC-002-1', workId: W(4)}] }), /고아/, '고아 작업을 통과시켰다')
  expectError(evaluate('crud', (analysis, plan) => { work(plan, 5).basisRefs = [] }), /basisRefs가 비었다/, '근거 없는 작업을 통과시켰다')
  expectError(evaluate('crud', analysis => { analysis.findings[0].capability = '바뀜' }), /analysisRef\.digest가 현재 분석과 다르다/, '분석이 바뀌었는데 옛 계획을 통과시켰다')
})

test('T30: 초안·현재 설명을 승인된 결정으로 승격하지 않는다', () => {
  expectError(evaluate('crud', analysis => { analysis.decisions[1].status = 'confirmed' }), /승인된 원문이 아니다/, '초안을 confirmed로 승격했다')
})

test('T32: 읽지 못한 자료에 지문을 지어내지 않는다', () => {
  expectError(evaluate('crud', analysis => { analysis.sourceRefs[3].digest = 'a'.repeat(64) }), /읽지 못한 자료에 digest/, '읽지 못한 자료의 지문을 통과시켰다')
})

test('T33·T35: 근거 없는 재사용, 조사가 절단됐는데 신규 확정을 막는다', () => {
  expectError(evaluate('crud', analysis => { analysis.findings[0].evidenceRefs = ['S-design'] }), /코드 관찰 근거가 없다/, '이름만으로 재사용을 판정했다')
  expectError(evaluate('crud', analysis => { analysis.scanCoverage.incompleteReasons = ['동적 import 미추적'] }), /create로 확정했다/, '절단된 조사로 신규를 확정했다')
})

test('반영 연결은 실재하는 분석 항목에서 WORK·분석 항목으로만 간다 · 읽은 자료는 보존본이 있어야 한다', () => {
  expectError(evaluate('crud', analysis => { analysis.resolutionLinks.push({analysisItemId: 'X-ghost', resolution: 'excluded', reason: 'r'}) }), /고아 링크/, '없는 항목의 반영 연결을 통과시켰다')
  expectError(evaluate('crud', analysis => { analysis.resolutionLinks[1].targetRefs = ['아무 문자열'] }), /WORK도 분석 항목도 아니다/, '임의 문자열로 반영을 주장했다')
  expectError(evaluate('crud', analysis => { delete analysis.sourceRefs[0].snapshotRef }), /read인데 보존된 원문/, '보존되지 않은 자료를 읽었다고 적었다')
})

test('T41: 받은 자료·판정이 반영처나 제외 사유 없이 사라지면 막는다', () => {
  expectError(evaluate('crud', analysis => { analysis.resolutionLinks = analysis.resolutionLinks.filter(link => link.analysisItemId !== 'S-figma') }), /resolutionLinks에 S-figma가 없다/, '미반영 자료를 통과시켰다')
  expectError(evaluate('crud', analysis => { analysis.resolutionLinks[0].targetRefs = ['WORK-99999999-0000-4000-8000-999999999999'] }), /반영처 .* 계획에 없다/, '없는 WORK로의 반영을 통과시켰다')
})

test('T44·§4.5: 범위 FEAT 누락·불완전 목록·유예 사유 미구분을 막는다 — 유예 FEAT도 목록에 남는다', () => {
  expectError(evaluate('crud', analysis => { analysis.scope.featureIds = ['FEAT-001', 'FEAT-002', 'FEAT-003'] }), /범위의 FEAT가 빠졌다: FEAT-004/, '범위 누락을 통과시켰다')
  expectError(evaluate('crud', analysis => { delete analysis.scope.featureDisposition[3].deferral }), /사유 종류/, '후속 상세화와 제품 유예를 섞었다')
  // fixture에 두 종류가 모두 있다 — 둘 다 목록에 남는다(검토표는 C가 본다).
  const kinds = readJson('crud', '_workspace/03_dev/work-analysis.json').scope.featureDisposition.map(entry => entry.deferral).filter(Boolean)
  assert.deepEqual(kinds.sort(), ['follow-up-detail', 'product-deferral'])
  const partial = evaluate('crud', analysis => { analysis.scope.inventoryComplete = false; analysis.scope.incompleteReasons = ['Jira 목록 2쪽 조회 실패'] }, {})
  assert.ok(partial.a.scopeBlocked.length > 0, '불완전한 목록으로 전체 범위를 확정했다')
  assert.equal(partial.a.errors.length, 0, '초안 조사까지 막았다 — 확정만 막아야 한다')
})

test('T37·T38: 우선순위는 착수 가능한 작업 안에서만 순서를 정하고, 선행 작업에 승계된다', () => {
  const {analysis, plan} = evaluate('crud')
  const view = computeWorkView(plan, analysis)
  const row = id => view.rows.find(item => item.workId === id)
  assert.equal(row(W(4)).status, 'waiting-deps', '최우선 기능(목록)이 선행을 건너뛰고 착수 가능이 됐다')
  assert.equal(row(W(1)).rank, 1, '최우선 기능을 여는 기반에 우선순위가 승계되지 않았다')
  assert.equal(row(W(1)).rankInheritedFrom, W(4))
  assert.equal(row(W(6)).status, 'blocked-decision', '미결이 있는 작업을 착수 가능으로 셌다')
  assert.deepEqual(view.ready, [W(1), W(3)])
  // 우선순위를 올려도 선행은 그대로 막는다.
  const boosted = evaluate('crud', (a, p) => { work(p, 6).priorityRefs = ['P-list-first'] })
  assert.equal(computeWorkView(boosted.plan, boosted.analysis).rows.find(item => item.workId === W(6)).status, 'blocked-decision')
})

test('T50·T52·T54: 디자인 선택은 기존 연결만 승계하고, pending은 미결로 막고, not-applicable은 근거를 요구한다', () => {
  expectError(evaluate('crud', (a, plan) => { work(plan, 3).designContext.selections[0].pageGroup = 'PAGE-009' }), /design-binding에 없다/, '없는 조건을 연결했다')
  expectError(evaluate('crud', (a, plan) => { work(plan, 3).designContext.selections[0].referenceIds = ['detail-edit'] }), /그 조건에 묶인 근거가 아니다/, '다른 조건의 시안을 끌어왔다')
  expectError(evaluate('crud', (a, plan) => { delete work(plan, 6).designContext.unresolvedRefs }), /pending이다/, 'pending 조건을 구현 근거로 확정했다')
  expectError(evaluate('crud', (a, plan) => { delete work(plan, 1).designContext.rationaleRef }), /not-applicable에는 rationaleRef/, '근거 없이 디자인 검사를 우회했다')
  expectError(evaluate('crud', (a, plan) => { work(plan, 3).designContext = {applicability: 'direct-ui'} }), /direct-ui인데/, '링크 없는 UI 작업을 인계 완료로 뒀다')
  expectError(evaluate('crud', (a, plan) => { work(plan, 3).designContext.selections[0].sha256 = 'a'.repeat(64) }), /알 수 없는 키 sha256/, '원격 디자인에 해시를 붙였다')
})

test('T36: 화면 없는 작업과 디자인 부재 프로젝트에 Figma·전역 상태를 강제하지 않는다', () => {
  const {errors, plan} = evaluate('editor')
  assert.deepEqual(errors, [])
  assert.equal(work(plan, 1).designContext.applicability, 'not-applicable')
  // 디자인 연결이 없는 프로젝트에서 선택을 적으면 막는다 — 대신 명세를 contextRefs로 잇는다.
  expectError(evaluate('editor', (a, plan) => { work(plan, 2).designContext = {applicability: 'direct-ui', selections: [{featureIds: ['FEAT-011'], testCaseIds: [], pageGroup: 'PAGE-001', condition: {state: 'default'}, referenceIds: [], purpose: 'implementation'}]} }),
    /design-binding이 없다/, '디자인 부재 프로젝트에 시안 연결을 받았다')
  // 디자인 부재 프로젝트의 UI 작업은 direct-ui + 화면 명세(contextRefs)로 적는다 — 둘 다 없으면 근거 없는 인계다.
  assert.equal(work(plan, 2).designContext.applicability, 'direct-ui')
  expectError(evaluate('editor', (a, plan) => { work(plan, 2).designContext = {applicability: 'direct-ui'} }), /명세 참조\(contextRefs\)도/, '근거 없는 UI 인계를 통과시켰다')
})

test('T21: 기능 명세가 계획 뒤 바뀌면 그 FEAT의 분해는 낡았다', () => {
  expectError(evaluate('crud', (a, plan) => { plan.featureBindings[2].sourceDigest = '0'.repeat(64) }), /기능 명세가 계획 작성 뒤 바뀌었다/, '낡은 분해를 통과시켰다')
})

test('계약 문서의 키 표와 검증기의 키 집합이 양방향으로 같다', () => {
  const doc = readFileSync(join(repo, '.claude/skills/team-flow/references/work-plan-contract.md'), 'utf8')
  const section = doc.match(/<!-- web-harness:work-keys -->([\s\S]*?)<!-- \/web-harness:work-keys -->/)
  assert.ok(section, '계약 문서에 키 표가 없다')
  const rows = new Map(section[1].split('\n').filter(line => /^\| (analysis|plan)\./.test(line))
    .map(line => { const [, name, keys] = line.split('|'); return [name.trim(), [...keys.matchAll(/`([A-Za-z]+)`/g)].map(m => m[1]).sort()] }))
  const code = new Map([
    ...Object.entries(WORK_ANALYSIS_KEYS).map(([name, keys]) => [`analysis.${name}`, [...keys].sort()]),
    ...Object.entries(WORK_PLAN_KEYS).map(([name, keys]) => [`plan.${name}`, [...keys].sort()]),
  ])
  assert.deepEqual([...rows.keys()].sort(), [...code.keys()].sort(), '문서와 코드의 객체 목록이 다르다')
  for (const [name, keys] of code) assert.deepEqual(rows.get(name), keys, `${name}: 문서와 코드의 키가 다르다`)
})

test('선행은 계획 안의 WORK이거나 사람이 만든 개발 티켓의 키다 — 모르는 WORK ID는 여전히 막는다', () => {
  const accepted = evaluate('crud', (analysis, plan) => { work(plan, 1).dependsOn = [...work(plan, 1).dependsOn, 'AOA-47', '#12'] })
  assert.equal(accepted.errors.some(error => /AOA-47|#12/.test(error)), false, JSON.stringify(accepted.errors))
  expectError(evaluate('crud', (analysis, plan) => { work(plan, 1).dependsOn = ['WORK-99999999-0000-4000-8000-999999999999'] }),
    /계획에 없다 — 사람이 만든 개발 티켓이면 티켓 키로/, '모르는 WORK를 선행으로 받았다')
})

test('하네스 내부 ID(FEAT·TC·분석 항목)는 티켓 키 모양이어도 선행 키로 받지 않는다 — 무기한 대기가 아니라 즉시 오류다', async () => {
  const {isTicketKeyRef} = await import('./ticket/work-refs.mjs')
  for (const id of ['FEAT-001', 'TC-001-1', 'WORK-12']) assert.equal(isTicketKeyRef(id), false, id)
  for (const key of ['AOA-47', '#12', '12']) assert.equal(isTicketKeyRef(key), true, key)
  expectError(evaluate('crud', (analysis, plan) => { work(plan, 1).dependsOn = ['FEAT-001'] }), /의존 FEAT-001가 계획에 없다/, 'FEAT를 사람 티켓 키로 받았다')
  const finding = [...evaluate('crud').a.ids.findingIds].find(id => isTicketKeyRef(id))
  if (finding) expectError(evaluate('crud', (analysis, plan) => { work(plan, 1).dependsOn = [finding] }), /계획에 없다/, '분석 항목 ID를 사람 티켓 키로 받았다')
})
