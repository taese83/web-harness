#!/usr/bin/env node
// test-pr-criteria.mjs — 티켓 없는 change 라운드의 PR 완료 기준 문단 CLI(프로세스로 실행).
import assert from 'node:assert/strict'
import test from 'node:test'
import {spawnSync} from 'node:child_process'
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'

const script = fileURLToPath(new URL('./pr-criteria.mjs', import.meta.url))
const run = (...args) => spawnSync(process.execPath, [script, ...args], {encoding: 'utf8'})

test('pr-criteria: change-scope의 라운드 기준을 번호·문장·검증 테스트로 내고, 없으면 빈 출력과 안내, 인자가 틀리면 2', () => {
  const root = mkdtempSync(join(tmpdir(), 'wh-pr-criteria-'))
  try {
    const empty = run('--project-root', root)
    assert.equal(empty.status, 0)
    assert.equal(empty.stdout, '')
    assert.match(empty.stderr, /라운드 완료 기준\(ACC-R\)이 없다/)
    mkdirSync(join(root, '_workspace/03_dev'), {recursive: true})
    writeFileSync(join(root, '_workspace/03_dev/change-scope.md'),
      '- ACC-R1-1 목록을 열면 각 예약의 끝 시각이 보인다. · LOCAL_VERIFIABLE — TT-R1-1\n')
    const result = run('--project-root', root)
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /^완료 기준\(라운드 1, 승인 단계에서 확인, 1개\):\n1\. 목록을 열면 각 예약의 끝 시각이 보인다\. — 검증 테스트 TT-R1-1\n/)
    assert.match(run('--project-root', root, '--lang', 'en').stdout, /^Acceptance criteria/)
    assert.equal(run('--lang', 'ko').status, 2, 'project-root 없이 받았다')
    assert.equal(run('--help').status, 0)
  } finally { rmSync(root, {recursive: true, force: true}) }
})
