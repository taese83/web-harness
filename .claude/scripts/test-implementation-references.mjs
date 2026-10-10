#!/usr/bin/env node
// test-implementation-references.mjs — 구현 판단의 외부 기준(허브 + 영역 체크리스트)과 산출물 비노출.
import assert from 'node:assert/strict'
import test from 'node:test'
import {readdirSync, readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {stripReferenceIds} from './ticket/work-link.mjs'

const REFS = fileURLToPath(new URL('../skills/web-orchestrator/references/', import.meta.url))
const AGENTS = fileURLToPath(new URL('../agents/', import.meta.url))
const read = path => readFileSync(path, 'utf8')
const hub = read(`${REFS}implementation-references.md`)
const checklists = readdirSync(REFS).filter(name => /^ref-.+\.md$/.test(name)).sort()

test('허브 표는 영역 체크리스트를 빠짐없이 가리키고, 없는 파일을 가리키지 않는다', () => {
  const listed = [...hub.matchAll(/`(ref-[a-z0-9-]+\.md)`/g)].map(match => match[1])
  assert.deepEqual([...new Set(listed)].sort(), checklists, '허브 표와 체크리스트 파일이 갈라졌다')
  assert.ok(checklists.length >= 4)
})

test('체크리스트: 항목마다 고유 ID, 머리에 출처 URL과 확인 날짜', () => {
  const seen = new Set()
  for (const name of checklists) {
    const text = read(`${REFS}${name}`)
    assert.match(text, /출처: .*https:\/\//, `${name}: 출처 URL이 없다`)
    assert.match(text, /확인 \d{4}-\d{2}/, `${name}: 확인 날짜가 없다 — 바뀌는 원문을 언제 대조했는지 모른다`)
    const ids = [...text.matchAll(/^- \*\*((?:A11Y|SEC|STR|DATA)-\d+)\*\*/gm)].map(match => match[1])
    assert.ok(ids.length > 0, `${name}: 항목이 없다`)
    for (const id of ids) { assert.ok(!seen.has(id), `항목 ID ${id}가 겹친다`); seen.add(id) }
  }
})

test('소비자 네 에이전트가 허브를 읽고, 산출물에는 레퍼런스를 쓰지 않는다고 적혀 있다', () => {
  for (const agent of ['developer', 'system-architect', 'code-reviewer', 'security-reviewer']) {
    assert.match(read(`${AGENTS}${agent}.md`), /implementation-references\.md/, `${agent}가 외부 기준을 읽지 않는다`)
  }
  assert.match(hub, /## 산출물에 드러내지 않는다/)
  assert.match(hub, /QA 보고서\(`_workspace\/04_qa` — 팀 저장소에 커밋된다\)/, 'QA 보고서를 비노출 대상에서 뺐다')
  for (const agent of ['code-reviewer', 'security-reviewer']) {
    assert.match(read(`${AGENTS}${agent}.md`), /항목 ID\(`(?:A11Y|SEC)-\d+` 등\)는 스폰 반환에만/, `${agent}가 보고서에 항목 ID를 쓴다`)
  }
  for (const agent of ['developer', 'system-architect']) {
    assert.match(read(`${AGENTS}${agent}.md`), /레퍼런스 이름·URL·항목 ID를 쓰지 않/, `${agent}가 산출물 비노출 규칙을 모른다`)
  }
})

test('PR 본문 렌더러는 기준 문장에 섞인 레퍼런스 항목 ID를 지운다', async () => {
  assert.equal(stripReferenceIds('대화상자는 Esc로 닫힌다 (A11Y-3)'), '대화상자는 Esc로 닫힌다')
  assert.equal(stripReferenceIds('토큰을 메모리에만 둔다(SEC-1, SEC-2) 기준'), '토큰을 메모리에만 둔다 기준')
  assert.equal(stripReferenceIds('SEC-12 회귀를 막는다'), 'SEC-12 회귀를 막는다', '괄호 없는 트래커 키까지 지웠다')
  assert.equal(stripReferenceIds('목록, 상세(편집) 화면'), '목록, 상세(편집) 화면', 'ID가 없는 문장을 바꿨다')
  const {renderRoundCriteria} = await import('./ticket/work-link.mjs')
  const lines = renderRoundCriteria('- ACC-R1-1 열면 포커스가 안으로 들어간다 (A11Y-1) · LOCAL_VERIFIABLE — TT-R1-1\n')
  assert.equal(lines[1], '1. 열면 포커스가 안으로 들어간다 — 검증 테스트 TT-R1-1', 'PR 본문에 레퍼런스 항목 ID가 샜다')
})
