#!/usr/bin/env node
// test-plugin-dispatcher.mjs — 배포본 스크립트 디스패처(`bin/web-harness-script`)를 실제로 빌드해 부른다.
//
// 고정하는 사실:
//   - `--help`는 배포 문서가 부르는 스크립트 이름을 보여 주고 0으로 끝난다 — 이름은 전부 배포본에 있고 개발 전용은 없다
//   - 이름 없이 부르면 사용법을 stderr로 내고 2로 끝난다
//   - 없는 이름은 2로 끝나며 `--help`를 가리킨다 — 평가의 환경 오류 판정(dispatchMisses)이 읽는 문장 형식은 그대로다
//   - 있는 이름은 그 스크립트로 넘어간다
import assert from 'node:assert/strict'
import test from 'node:test'
import {execFileSync, spawnSync} from 'node:child_process'
import {existsSync, mkdtempSync, realpathSync, rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'
import {dispatchMisses} from './plugin-eval-checks-lib.mjs'

const buildScript = fileURLToPath(new URL('./build-plugin.mjs', import.meta.url))

test('디스패처: --help가 부를 수 있는 이름을 보여 주고, 없는 이름은 목록을 가리킨다', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wh-dispatcher-')))
  try {
    const plugin = join(root, 'web-harness')
    execFileSync(process.execPath, [buildScript, '--out', plugin], {stdio: 'ignore'})
    const scripts = join(plugin, '.claude/scripts')
    const bin = join(plugin, 'bin', 'web-harness-script')
    const run = args => spawnSync(bin, args, {encoding: 'utf8'})

    const help = run(['--help'])
    assert.equal(help.status, 0, help.stderr)
    const names = help.stdout.split('\n').filter(line => line.startsWith('  ')).flatMap(line => line.trim().split(/\s+/))
    for (const expected of ['spec', 'ticket/cli', 'run-quality-gates']) assert.ok(names.includes(expected), `--help에 ${expected}가 없다`)
    for (const name of names) assert.ok(existsSync(join(scripts, `${name}.mjs`)), `--help가 배포본에 없는 ${name}을 안내한다`)
    assert.doesNotMatch(help.stdout, /build-plugin|run-plugin-evals|validate-harness/, '개발 전용 스크립트를 안내했다')

    const bare = run([])
    assert.equal(bare.status, 2)
    assert.match(bare.stderr, /usage: web-harness-script <name>/)

    const unknown = run(['nope'])
    assert.equal(unknown.status, 2)
    assert.match(unknown.stderr, /not part of the plugin runtime: nope/)
    assert.match(unknown.stderr, /--help/, '없는 이름이 목록을 가리키지 않는다')
    assert.deepEqual(dispatchMisses(unknown.stderr, scripts), [], '없는 이름을 환경 오류로 셌다')
    assert.deepEqual(dispatchMisses('web-harness-script: not part of the plugin runtime: spec (이름 목록: web-harness-script --help)', scripts),
      ['spec'], '문장 형식이 바뀌어 환경 오류 판정이 이름을 못 읽는다')

    const known = run(['spec', '--help'])
    assert.doesNotMatch(known.stderr, /not part of the plugin runtime/, '있는 이름을 스크립트로 넘기지 않았다')
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})
