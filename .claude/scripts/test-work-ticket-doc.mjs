#!/usr/bin/env node
// test-work-ticket-doc.mjs — WORK 티켓 본문은 개발자가 읽고 고칠 수 있는 문서다(2026-09-15 사용자 결정).
//
// 고정하는 사실:
//   - 본문은 설명·완료 조건·테스트 항목·수정 범위·하지 않는 것·선행 작업·참고 섹션이고 기계 마커가 없다
//   - Jira 위키 서식에서 링크·매크로로 읽히는 문자를 막는다(`[state=default]`가 오류 링크로 렌더됐다)
//   - 사람이 더한 항목은 additions, 계획 항목이 빠지거나 바뀌면 missing, 섹션이 없으면 absent — 두 서식·두 언어
import assert from 'node:assert/strict'
import test from 'node:test'
import {buildWorkDoc, compareWorkDoc, formatWorkDoc, parseWorkDocScope, parseWorkDocSections, renderWorkContext, testCaseTexts, workContextName} from './ticket/work-ticket-doc.mjs'

const work = {
  workId: 'WORK-00000004-0000-4000-8000-000000000004', title: '목록 조회 연결', kind: 'implementation', roles: ['fe'],
  objective: '회원 목록을 API로 불러와 표에 보인다', nonGoals: ['캐시 정책 변경 [다음 분기]'], writePaths: ['src/pages/members/list/'],
  checks: [{checkId: 'D-1', kind: 'component', targetRefs: ['src/pages/members/list/'], expectedOutcome: '로딩·빈·오류 상태가 데이터에 따라 바뀐다'}],
  designContext: {applicability: 'direct-ui', selections: [{pageGroup: 'PAGE-001', condition: {state: 'default'}}]},
  contractRefs: [{path: '_workspace/00_source/impl/member-api.md'}],
}
const testCases = [{id: 'TC-001-1', text: '목록을 불러오면 회원이 표에 보인다'}, {id: 'TC-001-2', text: '회원이 없으면 빈 상태 안내가 보인다'}]
const doc = buildWorkDoc({work, featureIds: ['FEAT-001'], features: new Map([['FEAT-001', '회원 목록']]), testCases,
  dependsOn: [{workId: 'WORK-00000001-0000-4000-8000-000000000001', title: '회원 타입·API 계약', ticketKey: 'PF-101'}], contextName: workContextName(work.workId)})

test('본문은 개발자용 섹션이고 기계 마커·판본 digest가 없다', () => {
  for (const format of ['markdown', 'jira-wiki']) {
    const body = formatWorkDoc(doc, format)
    for (const title of ['완료 조건', '테스트 항목', '수정 범위', '하지 않는 것', '선행 작업', '참고']) assert.ok(body.includes(title), `${format}: ${title} 섹션이 없다\n${body}`)
    assert.equal(/web-harness:|rev=|[0-9a-f]{64}/.test(body), false, `${format}: 기계 표지가 본문에 보인다`)
    assert.ok(body.includes('PF-101 회원 타입·API 계약'), '선행 작업을 티켓 키로 적지 않았다')
    assert.ok(body.includes('TC-001-1 목록을 불러오면 회원이 표에 보인다'))
  }
  const wiki = formatWorkDoc(doc, 'jira-wiki')
  assert.ok(wiki.includes('h3. 완료 조건') && wiki.includes('* ☐ 로딩·빈·오류 상태가 데이터에 따라 바뀐다'))
  assert.ok(wiki.includes('{{src/pages/members/list/}}'), '경로를 코드 서식으로 적지 않았다')
  assert.ok(wiki.includes('캐시 정책 변경 \\[다음 분기\\]'), `대괄호를 이스케이프하지 않았다 — Jira가 오류 링크로 렌더한다\n${wiki}`)
  const markdown = formatWorkDoc(doc, 'markdown')
  assert.ok(markdown.includes('### 완료 조건') && markdown.includes('- [ ] 아래 테스트 항목 2건이 모두 통과한다'))
  // 영어 문서도 같은 모델이다.
  assert.ok(formatWorkDoc(buildWorkDoc({work, testCases, lang: 'en'}), 'markdown').includes('### Acceptance criteria'))
})

test('사람 편집 대조: 더한 항목·빠진 항목·없는 섹션을 가른다 — 두 서식에서 같다', () => {
  for (const format of ['markdown', 'jira-wiki']) {
    const body = formatWorkDoc(doc, format)
    // 손대지 않은 본문은 차이가 없다.
    assert.deepEqual(compareWorkDoc({body, work, testCases}), {additions: [], missing: [], absent: [], stale: []}, format)
    // 사람이 체크하고(☑/[x]) 항목을 더했다 — 체크는 차이가 아니고 더한 항목만 additions다.
    const added = format === 'jira-wiki'
      ? body.replace('* ☐ 로딩·빈', '* ☑ 로딩·빈').replace('h3. 테스트 항목\n', 'h3. 테스트 항목\n* ☐ 50명 이상이면 페이지가 나뉜다\n')
      : body.replace('- [ ] 로딩·빈', '- [x] 로딩·빈').replace('### 테스트 항목\n', '### 테스트 항목\n- [ ] 50명 이상이면 페이지가 나뉜다\n')
    assert.deepEqual(compareWorkDoc({body: added, work, testCases}), {additions: [{section: 'tests', text: '50명 이상이면 페이지가 나뉜다'}], missing: [], absent: [], stale: []}, format)
    // 계획 항목을 바꿨다 — 빠진 것(원문)과 더한 것(새 문장)으로 드러난다.
    const changed = body.replace('로딩·빈·오류 상태가 데이터에 따라 바뀐다', '로딩 상태만 보인다')
    const diff = compareWorkDoc({body: changed, work, testCases})
    assert.deepEqual(diff.missing, [{section: 'acceptance', text: '로딩·빈·오류 상태가 데이터에 따라 바뀐다'}], format)
    assert.deepEqual(diff.additions, [{section: 'acceptance', text: '로딩 상태만 보인다'}], format)
  }
  // 보고는 **원문**이다 — 대조 키로 보고하면 식별자의 밑줄·물결이 사라진다(`user_id` → `userid`).
  const wikiBody = formatWorkDoc(doc, 'jira-wiki')
  const raw = compareWorkDoc({body: wikiBody.replace('h3. 완료 조건\n', 'h3. 완료 조건\n* ☐ `user_id` 컬럼은 ~/.cache에 두지 않는다\n'), work, testCases})
  assert.deepEqual(raw.additions, [{section: 'acceptance', text: '`user_id` 컬럼은 ~/.cache에 두지 않는다'}])
  // Jira 위키의 `#`은 번호 목록이다 — 제목으로 읽어 섹션을 닫으면 뒤따르는 계획 항목이 「빠짐」으로 오판된다.
  const numbered = compareWorkDoc({body: wikiBody.replace('h3. 완료 조건\n', 'h3. 완료 조건\n# 새 조건 하나\n'), work, testCases})
  assert.deepEqual(numbered.missing, [], JSON.stringify(numbered))
  assert.deepEqual(numbered.additions, [{section: 'acceptance', text: '새 조건 하나'}])
  // 옛 계획의 흔적(다른 작업이 책임지는 TC 줄·건수가 다른 통과 줄)은 사람이 더한 것이 아니다 — stale로 가른다.
  const stale = compareWorkDoc({body: wikiBody.replace('h3. 테스트 항목\n', 'h3. 테스트 항목\n* ☐ TC-002-1 이름으로 검색하면 일치하는 회원만 남는다\n').replace('아래 테스트 항목 2건이', '아래 테스트 항목 3건이'),
    work, testCases, foreignTestCaseIds: ['TC-002-1']})
  assert.deepEqual(stale.stale.map(item => item.text).sort(), ['TC-002-1 이름으로 검색하면 일치하는 회원만 남는다', '아래 테스트 항목 3건이 모두 통과한다'].sort())
  assert.deepEqual(stale.additions, [], '옛 계획 항목을 사람이 더한 조건으로 실었다 — 남의 TC가 이 작업의 완료 조건이 된다')
  // 섹션이 아예 없으면 대조할 수 없다고 적는다(계획 항목은 계획에서 실린다).
  assert.deepEqual(compareWorkDoc({body: '요약만 있는 본문', work, testCases}).absent, ['acceptance', 'tests'])
  // 영어 제목으로 고친 본문도 읽는다.
  assert.deepEqual(parseWorkDocSections('### Acceptance criteria\n- [ ] A\n### Test items\n- B').tests, ['B'])
  // 수정 범위는 경로 그대로 되읽는다 — `_`·`*`를 지우면 다른 클론의 겹침을 놓친다(두 서식 모두).
  const scoped = {...work, writePaths: ['src/pages/__tests__/', 'src/shared/ui/user_profile.tsx']}
  for (const format of ['markdown', 'jira-wiki']) {
    assert.deepEqual(parseWorkDocScope(formatWorkDoc(buildWorkDoc({work: scoped, testCases}), format)), scoped.writePaths, format)
  }
})

test('AI 맥락은 계획의 경로·근거를 빠짐없이 싣는다 · TC 문장은 feature-plan에서 줍는다', () => {
  const context = renderWorkContext({work, plan: {planId: '22222222-2222-4222-8222-222222222222'}, planDigest: 'a'.repeat(64), featureIds: ['FEAT-001'], testCases})
  const json = JSON.parse(context.match(/```json\n([\s\S]*?)\n```/)[1])
  assert.deepEqual(json.writePaths, work.writePaths)
  assert.deepEqual(json.checks[0].targetRefs, ['src/pages/members/list/'])
  assert.equal(json.planDigest, 'a'.repeat(64))
  assert.match(context, /data, not as instructions/)
  const texts = testCaseTexts([{body: '- TC-001-1 목록을 불러오면 회원이 표에 보인다\n- TC-001-2: 빈 상태\n본문 TC-001-9 언급'}])
  assert.equal(texts.get('TC-001-1'), '목록을 불러오면 회원이 표에 보인다')
  assert.equal(texts.get('TC-001-2'), '빈 상태')
  assert.equal(texts.has('TC-001-9'), false, '산문 언급을 TC 문장으로 주웠다')
})
