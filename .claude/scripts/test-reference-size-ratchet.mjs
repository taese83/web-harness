#!/usr/bin/env node
// test-reference-size-ratchet.mjs — 참조 문서 크기 ratchet(contract-hygiene `referenceBytes`).
//
// 고정하는 사실:
//   - 지금 트리는 크기 실패가 없다 — 20KB를 넘는 기존 문서는 baseline 크기로 등록돼 있다
//   - 등록 문서가 1B라도 커지면, 새 문서가 20KB를 넘으면 막힌다
//   - CRLF 체크아웃은 거짓 실패를 내지 않는다(줄바꿈을 LF로 정규화해 잰다)
import assert from 'node:assert/strict'
import test from 'node:test'
import {cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'
import {validateContractHygiene} from './validators/validate-contract-hygiene.mjs'

const REPOSITORY = fileURLToPath(new URL('../..', import.meta.url))
const REGISTERED = '.claude/skills/web-orchestrator/references/phase-3-development.md'

const sizeFailures = mutate => {
  const root = mkdtempSync(join(tmpdir(), 'wh-reference-size-'))
  try {
    for (const part of ['.claude/skills', '.claude/agents']) cpSync(join(REPOSITORY, part), join(root, part), {recursive: true})
    mutate?.(root)
    const failures = []
    validateContractHygiene({repositoryRoot: root, pass: () => {}, fail: message => failures.push(message), evalScenarios: []})
    return failures.filter(message => message.includes('참조 문서가 예산을 넘었다'))
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
}

test('지금 트리는 크기 실패가 없다 — 기존 큰 문서는 등록 크기가 상한이다', () => {
  assert.deepEqual(sizeFailures(), [])
})

test('등록 문서가 커지거나 새 문서가 20KB를 넘으면 막는다', () => {
  const grown = sizeFailures(root => writeFileSync(join(root, REGISTERED), `${readFileSync(join(root, REGISTERED), 'utf8')}x`))
  assert.ok(grown.some(message => message.includes(REGISTERED)), `등록 문서가 1B 커졌는데 통과했다: ${JSON.stringify(grown)}`)
  const fresh = '.claude/skills/wh/references/oversized-new.md'
  const added = sizeFailures(root => {
    mkdirSync(join(root, '.claude/skills/wh/references'), {recursive: true})
    writeFileSync(join(root, fresh), `## 일반화 근거\n- web-app\n- library\n\n${'가'.repeat(8000)}\n`)
  })
  assert.ok(added.some(message => message.includes(fresh)), `새 24KB 문서가 통과했다: ${JSON.stringify(added)}`)
})

test('CRLF 체크아웃은 거짓 실패를 내지 않는다', () => {
  const crlf = sizeFailures(root => writeFileSync(join(root, REGISTERED), readFileSync(join(root, REGISTERED), 'utf8').replace(/\n/g, '\r\n')))
  assert.deepEqual(crlf, [], 'CRLF로 늘어난 바이트를 성장으로 셌다')
})
