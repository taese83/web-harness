#!/usr/bin/env node
// test-import-closure.mjs — 배포본의 상대 import 닫힘 검사와 그 배선.
//
// 고정하는 사실:
//   - 없는 파일을 가리키는 정적·동적·여러 줄 import를 잡고, 있는 파일·주석 속 예시·HTML 문자열 속 import는 잡지 않는다
//   - 플러그인 빌드가 이 검사를 돌리고, 걸리면 빌드를 실패시킨다
//   - 실제 배포본에는 풀리지 않는 상대 import가 없고 훅이 전부 로드된다(로드에 실패한 PreToolUse 훅은 exit 1 — 비차단이라
//     게이트가 막지 못하고 조용히 꺼진다)
import assert from 'node:assert/strict'
import test from 'node:test'
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {spawnSync} from 'node:child_process'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'
import {unresolvedRelativeImports} from './import-closure-lib.mjs'

const SCRIPTS = fileURLToPath(new URL('.', import.meta.url))

test('없는 파일을 가리키는 import만 잡고, 주석·HTML 문자열 속 import는 잡지 않는다', () => {
  const root = mkdtempSync(join(tmpdir(), 'wh-import-closure-'))
  try {
    mkdirSync(join(root, 'lib'), {recursive: true})
    writeFileSync(join(root, 'lib/present.mjs'), 'export const x = 1\n')
    writeFileSync(join(root, 'a.mjs'), [
      "import {x} from './lib/present.mjs'",
      "import {y} from './lib/missing.mjs'",
      'import {',
      '  z,',
      "} from './validators/gone.mjs'",
      "const later = await import('./dynamic-missing.mjs')",
      "// import {A} from './comment-example'",
      "const page = ['<script type=\"module\">', \"import {o} from '../page-relative.mjs'\"]",
      '',
    ].join('\n'))
    const found = unresolvedRelativeImports(root).map(({file, specifier}) => `${file} -> ${specifier}`).sort()
    assert.deepEqual(found, ['a.mjs -> ./dynamic-missing.mjs', 'a.mjs -> ./lib/missing.mjs', 'a.mjs -> ./validators/gone.mjs'])
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})

test('배선: 플러그인 빌드가 닫힘 검사를 돌리고 걸리면 실패한다', () => {
  const build = readFileSync(join(SCRIPTS, 'build-plugin.mjs'), 'utf8')
  assert.match(build, /const unresolvedImports = unresolvedRelativeImports\(outputRoot\)/, '빌드가 닫힘 검사를 부르지 않는다')
  assert.match(build, /unresolvedImports\.length > 0\) process\.exitCode = 1/, '걸려도 빌드가 실패하지 않는다')
})

// 훅 이벤트마다 무해한 입력 — 로드되는지만 본다(판정 결과는 각 훅의 회귀가 잰다).
const HOOK_INPUT = {
  SessionStart: {hook_event_name: 'SessionStart', source: 'startup'},
  PreToolUse: {hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: {file_path: 'README.md'}},
  SubagentStop: {hook_event_name: 'SubagentStop', agent_type: 'general-purpose', last_assistant_message: 'done'},
  UserPromptSubmit: {hook_event_name: 'UserPromptSubmit', prompt: 'hello', session_id: 'import-closure-test'},
}
const LOAD_FAILURE = /ERR_MODULE_NOT_FOUND|Cannot find module|SyntaxError/

test('실제 배포본: 풀리지 않는 상대 import가 없고, 훅이 전부 로드된다 — 로드 실패한 훅은 막지 못하고 통과시킨다', () => {
  const out = mkdtempSync(join(tmpdir(), 'wh-import-closure-dist-'))
  const project = mkdtempSync(join(tmpdir(), 'wh-import-closure-project-'))
  const home = mkdtempSync(join(tmpdir(), 'wh-import-closure-home-'))
  try {
    const build = spawnSync(process.execPath, [join(SCRIPTS, 'build-plugin.mjs'), '--out', out], {encoding: 'utf8'})
    assert.equal(build.status, 0, `빌드가 실패했다: ${String(build.stdout).split('\n').slice(-6).join(' | ')}`)
    assert.deepEqual(unresolvedRelativeImports(out), [])
    const hooks = JSON.parse(readFileSync(join(out, 'hooks/hooks.json'), 'utf8')).hooks
    const commands = Object.entries(hooks).flatMap(([event, matchers]) =>
      matchers.flatMap(matcher => matcher.hooks.map(hook => ({event, command: hook.command}))))
    assert.ok(commands.length > 0, '배포본에 훅이 없다')
    for (const {event, command} of commands) {
      const script = command.match(/"\$\{CLAUDE_PLUGIN_ROOT\}"(\/\S+\.mjs)/)?.[1]
      assert.ok(script, `훅 명령을 해석하지 못했다: ${command}`)
      const run = spawnSync(process.execPath, [join(out, script)], {
        encoding: 'utf8', timeout: 20_000, cwd: project,
        input: JSON.stringify({...HOOK_INPUT[event], cwd: project}),
        env: {...process.env, HOME: home, CLAUDE_PROJECT_DIR: project, CLAUDE_PLUGIN_ROOT: out},
      })
      assert.doesNotMatch(`${run.stderr}${run.stdout}`, LOAD_FAILURE, `${event} 훅이 배포본에서 로드되지 않는다: ${script}`)
    }
  } finally {
    for (const directory of [out, project, home]) rmSync(directory, {recursive: true, force: true})
  }
})
