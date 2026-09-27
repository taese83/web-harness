#!/usr/bin/env node
// test-refusal-fixes.mjs — 거부는 해법을 말하고, 배포 스크립트의 --help는 부작용 없이 사용법만 답한다.
//
// 거부를 받은 쪽(오케스트레이터)이 해법을 찾으려고 스크립트 소스를 읽지 않게 하는 것이 목적이다.
import assert from 'node:assert/strict'
import test from 'node:test'
import {spawnSync} from 'node:child_process'
import {existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'
import {LOCK_ERROR_FIXES} from './spec.mjs'

const scripts = fileURLToPath(new URL('.', import.meta.url))
const claude = join(scripts, '..')
const withTemp = fn => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wh-refusal-')))
  try { return fn(root) } finally { rmSync(root, {recursive: true, force: true}) }
}

test('spec: 던지는 거부 코드마다 해법이 있다', () => {
  const source = readFileSync(join(scripts, 'spec.mjs'), 'utf8')
  const codes = new Set([...source.matchAll(/(?:LockError\(\s*|requireNonEmptyString\([^,]+,\s*)'([A-Z][A-Z0-9_]+)'/g)].map(match => match[1]))
  assert.ok(codes.size > 40, `거부 코드 추출이 비었다(${codes.size})`)
  const missing = [...codes].filter(code => !(LOCK_ERROR_FIXES[code] ?? '').trim())
  assert.deepEqual(missing, [], '해법 없는 거부 코드')
})

test('spec CLI: 거부 JSON에 fix가 실린다', () => {
  withTemp(root => {
    mkdirSync(join(root, '_workspace/02_design'), {recursive: true})
    const result = spawnSync(process.execPath, [join(scripts, 'spec.mjs'), '--project-root', root], {encoding: 'utf8'})
    assert.equal(result.status, 1)
    const payload = JSON.parse(result.stderr)
    assert.equal(payload.error.code, 'SOLUTION_DESIGN_MISSING')
    assert.match(payload.error.fix, /system-architect/)
  })
})

// 배포 문서가 부르는 스크립트 = build-plugin이 web-harness-script 목록에 싣는 것과 같은 규칙으로 모은다.
const dispatched = () => {
  const invocation = /node (?:"\$CLAUDE_PROJECT_DIR"\/|\{[a-zA-Z]+\}\/)?\.claude\/scripts\/([a-z0-9/-]+\.mjs)/g
  const names = new Set()
  const walk = directory => {
    for (const entry of readdirSync(directory, {withFileTypes: true})) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.name.endsWith('.md')) for (const match of readFileSync(path, 'utf8').matchAll(invocation)) names.add(match[1])
    }
  }
  walk(join(claude, 'skills'))
  walk(join(claude, 'agents'))
  return [...names].filter(name => existsSync(join(scripts, name))).sort()
}

test('배포 스크립트의 --help: exit 0 · 사용법 출력 · 파일 변화 0', () => {
  const names = dispatched()
  assert.ok(names.length > 20, `배포 스크립트 목록이 비었다(${names.length})`)
  for (const name of names) {
    withTemp(cwd => {
      const result = spawnSync(process.execPath, [join(scripts, name), '--help'], {cwd, encoding: 'utf8', timeout: 20_000})
      assert.equal(result.status, 0, `${name} --help exit ${result.status}: ${(result.stderr || result.stdout).slice(0, 200)}`)
      assert.match(result.stdout, /사용법|Usage/i, `${name} --help가 사용법을 말하지 않는다`)
      assert.deepEqual(readdirSync(cwd), [], `${name} --help가 파일을 만들었다`)
    })
  }
})

test('다른 CLI가 import한 모듈은 --help를 가로채지 않는다', () => {
  withTemp(root => {
    const entry = join(root, 'entry.mjs')
    writeFileSync(entry, `import {answerHelp} from ${JSON.stringify(join(scripts, 'cli-help-lib.mjs'))}\n`
      + `answerHelp(${JSON.stringify(new URL('./spec.mjs', import.meta.url).href)})\nprocess.stdout.write('entry-own-help')\n`)
    const result = spawnSync(process.execPath, [entry, '--help'], {encoding: 'utf8'})
    assert.equal(result.stdout, 'entry-own-help')
  })
})
