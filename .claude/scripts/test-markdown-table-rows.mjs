#!/usr/bin/env node
// test-markdown-table-rows.mjs — 에이전트·스킬 문서의 표 행이 `||`로 시작하지 않는다.
//
// 고정하는 사실:
//   - `|| a | b ||` 행은 첫 칸이 비어, 양식을 옮긴 보고서의 검사 행을 릴리스 게이트(parseChecks)가 건너뛴다
//   - 하네스의 에이전트·스킬 문서에는 그런 행이 없다
import assert from 'node:assert/strict'
import test from 'node:test'
import {readdirSync, readFileSync, statSync} from 'node:fs'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {doublePipeTableRows} from './validators/validate-contract-hygiene.mjs'

test('`||`로 시작하는 표 행만 잡는다', () => {
  assert.deepEqual(doublePipeTableRows('| a | b |\n|---|---|\n|| typecheck | 0 ||\nx || y'), [3])
})

test('하네스 에이전트·스킬 문서에 `||` 표 행이 없다', () => {
  const claudeDirectory = fileURLToPath(new URL('..', import.meta.url))
  const markdown = root => readdirSync(root).flatMap(name => {
    const path = join(root, name)
    return statSync(path).isDirectory() ? markdown(path) : name.endsWith('.md') ? [path] : []
  })
  const offenders = [...markdown(join(claudeDirectory, 'agents')), ...markdown(join(claudeDirectory, 'skills'))]
    .filter(path => doublePipeTableRows(readFileSync(path, 'utf8')).length > 0)
  assert.deepEqual(offenders, [])
})
