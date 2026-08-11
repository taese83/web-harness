#!/usr/bin/env node
// test-resume-manifest.mjs — resume-manifest.mjs 순수 코어 회귀 테스트.
// seminar-booking 실증 시나리오: 빌더가 선언 산출물 중 일부만 쓰고 truncate → 남은 것만 재개.
import assert from 'node:assert/strict'
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import test from 'node:test'
import {classifyOutput, computeRemaining} from './resume-manifest.mjs'

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'wh-resume-'))
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel)
    mkdirSync(dirname(abs), {recursive: true})
    writeFileSync(abs, content)
  }
  return root
}

test('classifyOutput: 완결 .ts → done', () => {
  const root = fixture({'a.ts': 'export const x = 1\n'})
  try { assert.equal(classifyOutput(root, 'a.ts').status, 'done') } finally { rmSync(root, {recursive: true, force: true}) }
})

test('classifyOutput: 없는 파일 → missing', () => {
  const root = fixture({})
  try { assert.equal(classifyOutput(root, 'nope.ts').status, 'missing') } finally { rmSync(root, {recursive: true, force: true}) }
})

test('classifyOutput: truncate된 .ts(미종결 괄호) → truncated', () => {
  const root = fixture({'b.ts': 'export function f() {\n  return {\n'})
  try { assert.equal(classifyOutput(root, 'b.ts').status, 'truncated') } finally { rmSync(root, {recursive: true, force: true}) }
})

test('classifyOutput: 비-code(.md/.json)는 존재+비어있지 않으면 done', () => {
  const root = fixture({'c.md': '# spec\n', 'd.json': '{"a":1}'})
  try {
    assert.equal(classifyOutput(root, 'c.md').status, 'done')
    assert.equal(classifyOutput(root, 'd.json').status, 'done')
  } finally { rmSync(root, {recursive: true, force: true}) }
})

test('classifyOutput: 빈 파일 → missing', () => {
  const root = fixture({'e.ts': ''})
  try { assert.equal(classifyOutput(root, 'e.ts').status, 'missing') } finally { rmSync(root, {recursive: true, force: true}) }
})

test('computeRemaining: 도메인 빌더 truncate 시나리오 — 일부만 쓰고 남은 것 계산', () => {
  // 선언: types/derive/store/invariants/index. 빌더가 types·derive만 쓰고 store는 미종결로 truncate,
  // invariants·index는 미작성 → remaining = [store(truncated), invariants, index(missing)]
  const root = fixture({
    'src/entities/booking/model/types.ts': 'export type Session = {id: string}\n',
    'src/entities/booking/model/derive.ts': 'export const derive = () => 1\n',
    'src/entities/booking/model/store.ts': 'export const store = {\n  commands: {\n', // truncated
  })
  try {
    const outputs = [
      'src/entities/booking/model/types.ts',
      'src/entities/booking/model/derive.ts',
      'src/entities/booking/model/store.ts',
      'src/entities/booking/model/invariants.ts',
      'src/entities/booking/index.ts',
    ]
    const {done, truncated, missing, remaining} = computeRemaining(root, outputs)
    assert.deepEqual(done.sort(), ['src/entities/booking/model/derive.ts', 'src/entities/booking/model/types.ts'])
    assert.deepEqual(truncated.map(r => r.file), ['src/entities/booking/model/store.ts'])
    assert.deepEqual(missing.sort(), ['src/entities/booking/index.ts', 'src/entities/booking/model/invariants.ts'])
    // remaining = missing ∪ truncated (완성분 2개는 제외 — 재작성 금지)
    assert.equal(remaining.length, 3)
    assert.ok(remaining.includes('src/entities/booking/model/store.ts'))
    assert.ok(!remaining.includes('src/entities/booking/model/types.ts'))
  } finally { rmSync(root, {recursive: true, force: true}) }
})

test('computeRemaining: 전부 완결 → remaining 0 (COMPLETE)', () => {
  const root = fixture({'a.ts': 'export const a = 1\n', 'b.ts': 'export const b = 2\n'})
  try {
    const {remaining} = computeRemaining(root, ['a.ts', 'b.ts'])
    assert.equal(remaining.length, 0)
  } finally { rmSync(root, {recursive: true, force: true}) }
})
