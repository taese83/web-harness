#!/usr/bin/env node
// test-output-language.mjs — 산출물 언어 일치 검사 회귀.
//
// 고정하는 사실: (1) en 선언에 한글 헤딩이 있으면 잡는다, (2) 코드 펜스 안 한글은 오탐하지
// 않는다(샘플 데이터·주석은 규약 대상 아님), (3) ko 선언은 영어 헤딩을 문제 삼지 않는다,
// (4) 미선언은 통과가 아니라 검사 미수행이다.
import assert from 'node:assert/strict'
import test from 'node:test'
import {extractHeadings, findLanguageViolations, stripFences} from './validate-output-language.mjs'

const f = (file, text) => ({file, text})

test('en 선언: 한글 헤딩을 잡는다', () => {
  const v = findLanguageViolations([f('a.md', '# Feature Plan\n## 기능 명세\n본문\n')], 'en')
  assert.equal(v.length, 1)
  assert.equal(v[0].heading, '기능 명세')
})

test('en 선언: 영어 헤딩만 있으면 위반 0', () => {
  const v = findLanguageViolations([f('a.md', '# Feature Plan\n## Behavior spec\n')], 'en')
  assert.deepEqual(v, [])
})

test('코드 펜스 안 한글 헤딩은 오탐하지 않는다(샘플·주석)', () => {
  const text = '# Plan\n\n```markdown\n## 색상 팔레트\n```\n\n```ts\n// 한글 주석\nconst a = 1\n```\n'
  assert.deepEqual(findLanguageViolations([f('a.md', text)], 'en'), [])
})

test('펜스 밖 한글 헤딩은 펜스가 있어도 잡힌다', () => {
  const text = '# Plan\n\n```ts\nconst a = 1\n```\n\n## 엔드포인트 목록\n'
  const v = findLanguageViolations([f('a.md', text)], 'en')
  assert.equal(v.length, 1)
  assert.equal(v[0].heading, '엔드포인트 목록')
})

test('ko 선언은 영어 헤딩을 문제 삼지 않는다(단방향 검사)', () => {
  assert.deepEqual(findLanguageViolations([f('a.md', '## API Schema\n')], 'ko'), [])
})

test('미선언(null)은 위반 0 — 호출부가 "검사 미수행"으로 보고한다', () => {
  assert.deepEqual(findLanguageViolations([f('a.md', '## 기능 명세\n')], null), [])
})

test('extractHeadings: 레벨과 줄 번호를 보존한다', () => {
  const h = extractHeadings('intro\n# A\ntext\n### B\n')
  assert.deepEqual(h, [{line: 2, level: 1, text: 'A'}, {line: 4, level: 3, text: 'B'}])
})

test('stripFences: 펜스 블록만 제거하고 나머지는 남긴다', () => {
  const out = stripFences('a\n```\nb\n```\nc\n')
  assert.ok(!out.includes('b'))
  assert.ok(out.includes('a') && out.includes('c'))
})

test('여러 파일의 위반을 파일별로 보고한다', () => {
  const v = findLanguageViolations([f('a.md', '## 하나\n'), f('b.md', '## Two\n'), f('c.md', '## 셋\n')], 'en')
  assert.deepEqual(v.map(x => x.file), ['a.md', 'c.md'])
})
