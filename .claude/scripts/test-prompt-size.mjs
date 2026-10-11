#!/usr/bin/env node
// test-prompt-size.mjs — 에이전트·SKILL.md 크기 ratchet(validate-modularity `promptSizeFailures`, baseline `promptBytes`).
//
// 고정하는 사실:
//   - 지금 트리는 크기 실패가 없다 — 20KB를 넘는 파일은 baseline 크기로 등록돼 있다
//   - 등록 파일이 1B라도 커지면, 새 파일이 20KB를 넘으면 막힌다
//   - 줄 수는 보지 않는다 — 20KB 안이면 300줄을 넘어도 통과한다(문장을 깎거나 줄을 합칠 이유가 없다)
//   - CRLF 체크아웃은 거짓 실패를 내지 않는다
import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync, readdirSync, existsSync} from 'node:fs'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {PROMPT_BYTE_BUDGET, promptSizeFailures} from './validators/validate-modularity.mjs'

const REPOSITORY = fileURLToPath(new URL('../..', import.meta.url))
const baseline = JSON.parse(readFileSync(join(REPOSITORY, '.claude/scripts/validators/contract-hygiene-baseline.json'), 'utf8')).promptBytes
const files = [
  ...readdirSync(join(REPOSITORY, '.claude/agents')).filter(name => name.endsWith('.md')).map(name => `.claude/agents/${name}`),
  ...readdirSync(join(REPOSITORY, '.claude/skills')).map(name => `.claude/skills/${name}/SKILL.md`).filter(path => existsSync(join(REPOSITORY, path))),
]
const REGISTERED = Object.keys(baseline)[0]
const failures = (overrides = {}, list = files) =>
  promptSizeFailures(list, path => overrides[path] ?? readFileSync(join(REPOSITORY, path), 'utf8'), baseline)

test('지금 트리는 크기 실패가 없다 — 20KB를 넘는 파일은 등록 크기가 상한이다', () => {
  assert.deepEqual(failures(), [])
  assert.ok(REGISTERED, '등록 파일이 없어 ratchet을 시험할 수 없다')
})

test('등록 파일이 커지거나 새 파일이 20KB를 넘으면 막는다', () => {
  const grown = failures({[REGISTERED]: `${readFileSync(join(REPOSITORY, REGISTERED), 'utf8')}x`})
  assert.ok(grown.some(message => message.startsWith(REGISTERED)), `등록 파일이 1B 커졌는데 통과했다: ${JSON.stringify(grown)}`)
  const fresh = '.claude/agents/oversized-new.md'
  const added = failures({[fresh]: 'x'.repeat(PROMPT_BYTE_BUDGET + 1)}, [...files, fresh])
  assert.ok(added.some(message => message.startsWith(fresh)), `새 20KB 초과 파일이 통과했다: ${JSON.stringify(added)}`)
})

test('줄 수는 보지 않는다 — 20KB 안이면 300줄을 넘어도 통과한다', () => {
  const long = '.claude/agents/many-short-lines.md'
  assert.deepEqual(failures({[long]: '- 짧은 줄\n'.repeat(400)}, [long]), [])
})

test('CRLF 체크아웃은 거짓 실패를 내지 않는다', () => {
  const crlf = failures({[REGISTERED]: readFileSync(join(REPOSITORY, REGISTERED), 'utf8').replace(/\n/g, '\r\n')}, [REGISTERED])
  assert.deepEqual(crlf, [], 'CRLF로 늘어난 바이트를 성장으로 셌다')
})
