#!/usr/bin/env node
// test-import-source.mjs — 사용자가 준 프로젝트 밖 파일을 `_workspace/00_source/imported/`로 들이는 길을 고정한다.
import assert from 'node:assert/strict'
import test from 'node:test'
import {spawnSync} from 'node:child_process'
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const cli = join(here, 'import-source.mjs')
const withDirs = run => {
  const top = mkdtempSync(join(tmpdir(), 'wh-import-source-'))
  try {
    const project = join(top, 'proj')
    const downloads = join(top, 'Downloads')
    mkdirSync(project); mkdirSync(downloads)
    return run({project, downloads})
  } finally { rmSync(top, {recursive: true, force: true}) }
}
const importFile = (project, ...args) => spawnSync(process.execPath, [cli, '--project-root', project, ...args], {encoding: 'utf8'})

test('사용자 파일을 imported/로 복사하고 원본은 그대로 둔다', () => {
  withDirs(({project, downloads}) => {
    writeFileSync(join(downloads, '개발 분석 보고서.pdf'), 'pdf')
    const result = importFile(project, '--from', join(downloads, '개발 분석 보고서.pdf'))
    assert.equal(result.status, 0, result.stdout)
    assert.equal(readFileSync(join(project, '_workspace/00_source/imported/개발 분석 보고서.pdf'), 'utf8'), 'pdf')
    assert.ok(existsSync(join(downloads, '개발 분석 보고서.pdf')))
    assert.equal(importFile(project, '--from', join(downloads, '개발 분석 보고서.pdf')).status, 1, '같은 이름을 덮었다')
  })
})

test('비밀로 보이는 경로·링크·상대 경로는 들이지 않는다', () => {
  withDirs(({project, downloads}) => {
    writeFileSync(join(downloads, '.env'), 'SECRET=1')
    assert.equal(JSON.parse(importFile(project, '--from', join(downloads, '.env')).stdout).code, 'SECRET_PATH')
    writeFileSync(join(downloads, 'real.txt'), 'x')
    symlinkSync(join(downloads, 'real.txt'), join(downloads, 'link.txt'))
    assert.equal(JSON.parse(importFile(project, '--from', join(downloads, 'link.txt')).stdout).code, 'NOT_REGULAR_FILE')
    assert.equal(JSON.parse(importFile(project, '--from', 'real.txt').stdout).code, 'FROM_NOT_ABSOLUTE')
  })
})

test('승인 훅이 import-source 실행을 사용자 확인으로 묻는다', () => {
  const approval = join(here, 'enforce-human-approval.mjs')
  const out = spawnSync(process.execPath, [approval], {encoding: 'utf8',
    input: JSON.stringify({tool_name: 'Bash', tool_input: {command: 'node .claude/scripts/import-source.mjs --project-root . --from /Users/u/Downloads/a.pdf'}})}).stdout
  assert.match(out, /"permissionDecision":"ask"/)
})

test('평범한 이름의 링크 디렉터리가 비밀 디렉터리를 가리키면 실제 경로로 막는다', () => {
  withDirs(({project, downloads}) => {
    const secretDir = join(downloads, '..', '.ssh')
    mkdirSync(secretDir)
    writeFileSync(join(secretDir, 'config'), 'Host x')
    symlinkSync(secretDir, join(downloads, 'notes'))
    assert.equal(JSON.parse(importFile(project, '--from', join(downloads, 'notes', 'config')).stdout).code, 'SECRET_PATH')
  })
})
