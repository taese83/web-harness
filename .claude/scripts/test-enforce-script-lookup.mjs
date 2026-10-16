#!/usr/bin/env node
// test-enforce-script-lookup.mjs — 스크립트 파일 전역 검색 거부 훅 회귀.
//
// 고정하는 사실: (1) 넓은 시작 경로(`/`, 홈, 플러그인 캐시)에서 스크립트 파일을 찾는 `find`·전역 색인 검색은 거부되고
// 문구가 실제 실행 명령을 준다, (2) 프로젝트 안 검색과 스크립트가 아닌 검색은 통과한다, (3) 훅 프로세스가 deny JSON을
// 내고 어떤 입력 오류에도 exit 0이다, (4) 저장소·프로젝트·플러그인 세 배선에 모두 등록돼 있다.
import assert from 'node:assert/strict'
import test from 'node:test'
import {spawnSync} from 'node:child_process'
import {readFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {commandStages, decide, isBroadSearchRoot, scriptRunCommand} from './enforce-script-lookup.mjs'

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const hook = join(scriptsDir, 'enforce-script-lookup.mjs')
const home = '/Users/tester'
const names = new Set(['import-source', 'widen-change-scope', 'spec'])
const runCommand = '/opt/wh/bin/web-harness-script <script-name> [args]'
const verdict = (command, {cwd = '/Users/tester/work/app', agent_type, projectRoot = '/Users/tester/work/app'} = {}) =>
  decide({tool_name: 'Bash', tool_input: {command}, cwd, agent_type}, {home, names, runCommand, projectRoot})

test('넓은 시작 경로에서 스크립트 파일 검색은 거부되고 실행 명령을 준다', () => {
  for (const command of [
    'find / -name x.mjs',
    'find / -path /proc -prune -o -name import-source.mjs -print',
    'find ~/.claude/plugins/cache -name spec.mjs',
    'S=$(find ~/.claude/plugins/cache/web-harness-marketplace -name widen-change-scope.mjs | head -1); node "$S"',
    'find "$HOME" -name "*.mjs" 2>/dev/null',
    'find ${HOME}/.claude -type f -name "widen-change-scope*"',
    'find /Users -name "*.js"',
    'find /Users/someone -name import-source.mjs',
    'find -L / -name "*.cjs"',
    'sudo find / -name import-source.mjs',
    'find ~ -type f | grep widen-change-scope',
    'find ../../.. -name import-source.mjs',
    'mdfind -name import-source.mjs',
    'locate widen-change-scope.mjs',
    'cd ~/.claude/plugins/cache && find . -name widen-change-scope.mjs',
    'timeout 30 find / -name import-source.mjs',
    "nice -n 10 find / -name '*.mjs'",
  ]) {
    const reason = verdict(command)
    assert.ok(reason, `거부되어야 한다: ${command}`)
    assert.ok(reason.includes(runCommand), `거부 문구에 실행 명령이 없다: ${command}`)
  }
  assert.ok(verdict('find . -name x.mjs', {agent_type: 'web-harness:developer', cwd: '/'}), '서브에이전트도 대상이다')
  assert.ok(verdict('find ~/.claude/plugins/cache -name spec.mjs', {cwd: home, projectRoot: home}), '프로젝트 루트가 홈이어도 플러그인 캐시는 넓다')
  assert.ok(verdict('find / -name x.mjs', {cwd: '/', projectRoot: '/'}), '루트가 `/`이면 면제하지 않는다')
})

test('프로젝트 안 검색과 스크립트가 아닌 검색은 통과한다', () => {
  for (const command of [
    "find apps -name '*.ts'",
    'find _workspace -name "*.md"',
    'find . -name "*.mjs" -not -path "*/node_modules/*"',
    'find .claude/scripts -name "*.mjs"',
    'find /Users/tester/work/app/src -name "*.js"',
    'find / -name "*.json" -maxdepth 1',
    'find ~ -maxdepth 1 -name .zshrc',
    'find "$PROJECT_ROOT" -name "*.mjs"',
    'git log --oneline | head',
    'echo "find / -name x.mjs"',
    'rg findings',
    'find ~ -maxdepth 1 -name .zshrc; node foo.js',
  ]) assert.equal(verdict(command), null, `통과해야 한다: ${command}`)
  for (const command of ["find . -name '*.js'", 'find /workspace -name "*.mjs"']) {
    assert.equal(verdict(command, {cwd: '/workspace', projectRoot: '/workspace'}), null, `최상위 프로젝트 루트 안은 통과해야 한다: ${command}`)
  }
  assert.equal(decide({tool_name: 'Read', tool_input: {file_path: '/x.mjs'}}, {home, names, runCommand}), null)
})

test('넓은 시작 경로 판정 — 홈·조상·플러그인 캐시·최상위만', () => {
  const at = (path, cwd = '/Users/tester/work/app') => isBroadSearchRoot(path, {cwd, home, configDir: '/cfg', projectRoot: '/Users/tester/work/app'})
  for (const path of ['/', '/tmp', '/Users', '/Users/tester', '/home/other', '~', '~/', '$HOME', '~/.claude', '~/.claude/plugins/cache/x', '/cfg/plugins/a', '$CLAUDE_CONFIG_DIR/plugins/x', '../../..']) {
    assert.equal(at(path), true, path)
  }
  for (const path of ['.', '..', 'apps', '~/work/app', '/Users/tester/work', '/tmp/wh-fixture', '$UNKNOWN/x']) assert.equal(at(path), false, path)
})

test('단계 분리 — 대입·$()·파이프·따옴표', () => {
  assert.deepEqual(commandStages(`S=$(find ~/a -name 'x y.mjs' | head) || echo "$S"`).map(({words, piped}) => [piped, ...words]),
    [[false, 'S='], [false, 'find', '~/a', '-name', 'x y.mjs'], [true, 'head'], [false, 'echo', '$S']])
})

test('실행 명령 — 플러그인은 bin 래퍼, 저장소는 node 경로', () => {
  assert.equal(scriptRunCommand({plugin: true, root: '/p/web-harness/0.77.0'}), 'web-harness-script <script-name> [args] (not on PATH: /p/web-harness/0.77.0/bin/web-harness-script)')
  assert.equal(scriptRunCommand({plugin: false, root: '/repo'}), 'node /repo/.claude/scripts/<script-name>.mjs [args]')
})

test('훅 프로세스: 거부는 deny JSON, 통과·깨진 입력은 침묵, 항상 exit 0', () => {
  const run = input => spawnSync(process.execPath, [hook], {input, encoding: 'utf8', env: {...process.env, CLAUDE_PROJECT_DIR: '/nonexistent-wh-project'}})
  const denied = run(JSON.stringify({tool_name: 'Bash', tool_input: {command: 'find / -name import-source.mjs'}, cwd: '/tmp'}))
  assert.equal(denied.status, 0)
  const output = JSON.parse(denied.stdout).hookSpecificOutput
  assert.equal(output.permissionDecision, 'deny')
  assert.match(output.permissionDecisionReason, /node \S+\/\.claude\/scripts\/<script-name>\.mjs \[args\]/)
  const allowed = run(JSON.stringify({tool_name: 'Bash', tool_input: {command: "find apps -name '*.ts'"}, cwd: '/tmp/project'}))
  assert.equal(allowed.status, 0)
  assert.equal(allowed.stdout, '')
  const broken = run('{not json')
  assert.equal(broken.status, 0)
  assert.equal(broken.stdout, '')
})

test('저장소·프로젝트·플러그인 배선에 모두 Bash 훅으로 등록돼 있다', () => {
  for (const file of ['settings.json', 'settings.project.json']) {
    const settings = JSON.parse(readFileSync(join(scriptsDir, '..', file), 'utf8'))
    const bash = (settings.hooks.PreToolUse ?? []).filter(entry => entry.matcher === 'Bash').flatMap(entry => entry.hooks)
    assert.ok(bash.some(entry => entry.command.includes('enforce-script-lookup.mjs')), `${file}에 등록이 없다`)
  }
  assert.match(readFileSync(join(scriptsDir, 'build-plugin.mjs'), 'utf8'), /\['Bash', 'enforce-script-lookup\.mjs'\]/)
})
