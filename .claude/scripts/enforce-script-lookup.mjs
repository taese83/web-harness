#!/usr/bin/env node
// enforce-script-lookup.mjs — PreToolUse(Bash): 하네스 스크립트 파일을 파일시스템 전역에서 찾는 검색을 막고 실행 명령을 준다.
//
// 스크립트는 이름으로 실행한다(플러그인: `web-harness-script <name>`, 저장소: `node .claude/scripts/<name>.mjs`).
// 막는 것: 시작 경로가 넓은(`/`, 최상위 디렉터리, 홈과 그 조상, `/Users/<x>`·`/home/<x>`, 플러그인 캐시와 그 조상) `find`와
// 전역 색인 검색(`locate`·`mdfind`) 중 스크립트 파일(`*.mjs|*.js|*.cjs` 또는 최상위 하네스 스크립트 이름 — 같은 파이프의
// 뒤 단계 포함)을 찾는 것. 프로젝트 루트 안 검색은 통과한다. 메인·서브에이전트 모두 대상이다.
// 범위 밖(알려진 한계): `fd`·`rg --files`·`ls -R`·Glob 도구. 효율 장치라 어떤 오류도 명령을 막지 않는다(침묵하고 통과).
import {existsSync, readdirSync} from 'node:fs'
import {homedir} from 'node:os'
import {basename, dirname, isAbsolute, join, resolve} from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'
import {recordHookDenial} from './hook-denial-log-lib.mjs'

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = resolve(SCRIPTS_DIR, '..', '..')
const IS_PLUGIN = existsSync(join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json'))

/** 이 배치에서 스크립트를 실행하는 명령 — SessionStart 안내(detect-harness-project.mjs)도 이 문장을 쓴다.
 * 플러그인은 bare 이름이 먼저다 — 검증 에이전트 Bash 정책은 bare `web-harness-script`만 받는다. */
export const scriptRunCommand = ({plugin = IS_PLUGIN, root = PLUGIN_ROOT} = {}) => plugin
  ? `web-harness-script <script-name> [args] (not on PATH: ${join(root, 'bin', 'web-harness-script')})`
  : `node ${join(root, '.claude', 'scripts')}/<script-name>.mjs [args]`

const harnessScriptNames = () => {
  try {
    return new Set(readdirSync(SCRIPTS_DIR).filter(name => name.endsWith('.mjs') && !name.startsWith('test-')).map(name => name.slice(0, -4)))
  } catch { return new Set() }
}

// 셸 단계 경계(`;` `&&` `||` `|` 줄바꿈 `$(` 백틱 괄호)로 자르고 따옴표를 벗긴다. `piped` = 앞 단계와 `|`로 이어졌다.
export function commandStages(command) {
  const stages = [{words: [], piped: false}]
  let token = null
  let quote = null
  const push = () => { if (token !== null) stages.at(-1).words.push(token); token = null }
  const cut = (piped = false) => { push(); if (stages.at(-1).words.length) stages.push({words: [], piped}); else stages.at(-1).piped = piped }
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]
    if (quote) {
      if (char === quote) quote = null
      else if (char === '\\' && quote === '"' && index + 1 < command.length) token = (token ?? '') + command[++index]
      else token = (token ?? '') + char
    } else if (char === "'" || char === '"') { quote = char; token = token ?? '' }
    else if (char === '\\' && index + 1 < command.length) token = (token ?? '') + command[++index]
    else if (char === '$' && command[index + 1] === '(') { cut(); index += 1 }
    else if (char === '|') {
      if (command[index + 1] === '|') { cut(); index += 1 } else cut(true)
    } else if (';&\n`()'.includes(char)) cut()
    else if (/\s/.test(char)) push()
    else token = (token ?? '') + char
  }
  push()
  return stages.filter(stage => stage.words.length)
}

const expandVariables = (path, {home, configDir}) => {
  let expanded = path.replace(/^~(?=\/|$)/, home).replace(/^\$\{?HOME\}?(?=\/|$)/, home)
  if (configDir) expanded = expanded.replace(/^\$\{?CLAUDE_CONFIG_DIR\}?(?=\/|$)/, configDir)
  return expanded
}

const isWithin = (path, parent) => path === parent || path.startsWith(`${parent === '/' ? '' : parent}/`)

/** 시작 경로가 파일시스템 전역 검색인가. 프로젝트 루트 안과 해석할 수 없는 변수 경로는 넓다고 단정하지 않는다. */
export function isBroadSearchRoot(raw, {cwd = process.cwd(), home = homedir(), configDir = process.env.CLAUDE_CONFIG_DIR, projectRoot = null} = {}) {
  const expanded = expandVariables(raw, {home, configDir})
  if (expanded.includes('$')) return false
  const path = resolve(isAbsolute(expanded) ? expanded : resolve(cwd, expanded))
  const pluginDirs = [join(home, '.claude', 'plugins'), configDir ? join(resolve(configDir), 'plugins') : null].filter(Boolean)
  if (pluginDirs.some(dir => isWithin(path, dir))) return true
  // 프로젝트 루트 안은 넓지 않다(컨테이너의 `/workspace` 같은 최상위 루트 포함) — 루트가 `/`·홈·그 조상이면 면제하지 않는다.
  const root = projectRoot ? resolve(projectRoot) : null
  if (root && root !== '/' && !isWithin(home, root) && isWithin(path, root)) return false
  const depth = path.split('/').filter(Boolean).length
  if (depth <= 1) return true
  if (depth === 2 && /^\/(?:Users|home)\//.test(path)) return true
  if (isWithin(home, path)) return true
  return pluginDirs.some(dir => isWithin(dir, path))
}

const FIND_COMMANDS = new Set(['find', 'gfind'])
const INDEX_COMMANDS = new Set(['locate', 'plocate', 'mlocate', 'mdfind'])
const PREFIX_COMMANDS = new Set(['sudo', 'command', 'env', 'nice', 'time', 'timeout', 'gtimeout', 'nohup', 'caffeinate', 'stdbuf', 'xargs'])
const SCRIPT_EXTENSION = /\.[cm]?js\b|\*\.?[cm]?js\b/i

const findStartPaths = args => {
  const paths = []
  let index = 0
  while (index < args.length && /^-[HLP]$|^-O\d$/.test(args[index])) index += 1
  if (args[index] === '-D') index += 2
  for (; index < args.length; index += 1) {
    const arg = args[index]
    if (arg.startsWith('-') || arg === '!' || arg === '(' || arg === ')') break
    paths.push(arg)
  }
  return paths.length ? paths : ['.']
}

// 앞의 변수 대입과 감싸는 명령(`timeout 30`, `nice -n 10`, `sudo`)을 건너뛴 실행 위치.
const programIndex = words => {
  let at = 0
  while (at < words.length) {
    if (/^[A-Za-z_]\w*=/.test(words[at])) at += 1
    else if (PREFIX_COMMANDS.has(basename(words[at]))) {
      at += 1
      while (at < words.length && (/^-/.test(words[at]) || /^\d+(?:\.\d+)?[smhd]?$/.test(words[at]))) at += 1
    } else break
  }
  return at
}

/** 거부 사유 또는 null. */
export function decide(input, {home = homedir(), names, runCommand = scriptRunCommand(), projectRoot = process.env.CLAUDE_PROJECT_DIR} = {}) {
  if (input?.tool_name !== 'Bash') return null
  const command = String(input?.tool_input?.command ?? '')
  if (!/\b(?:g?find|p?locate|mlocate|mdfind)\b/.test(command)) return null
  const scriptNames = names ?? harnessScriptNames()
  let cwd = input.cwd ?? projectRoot ?? process.cwd()
  const root = projectRoot ?? input.cwd ?? null
  const stages = commandStages(command)
  const seeksScript = words => words.some(word => SCRIPT_EXTENSION.test(word)
    || word.split(/[^A-Za-z0-9-]+/).some(part => part && scriptNames.has(part.replace(/^-+/, ''))))
  for (const [index, {words}] of stages.entries()) {
    const at = programIndex(words)
    const program = basename(words[at] ?? '')
    const args = words.slice(at + 1)
    if (program === 'cd' && args.length === 1) { cwd = resolve(cwd, expandVariables(args[0], {home, configDir: process.env.CLAUDE_CONFIG_DIR})); continue }
    // 같은 파이프의 뒤 단계(`find ~ | grep import-source`)도 무엇을 찾는지에 포함한다.
    const searched = [...args]
    for (let next = index + 1; next < stages.length && stages[next].piped; next += 1) searched.push(...stages[next].words)
    const broad = FIND_COMMANDS.has(program)
      ? findStartPaths(args).some(path => isBroadSearchRoot(path, {cwd, home, projectRoot: root}))
      : INDEX_COMMANDS.has(program)
    if (broad && seeksScript(searched)) {
      return `[web-harness] Do not search the filesystem for harness scripts — run them by name: ${runCommand}. `
        + 'Search only inside the project for project files.'
    }
  }
  return null
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    let source = ''
    for await (const chunk of process.stdin) source += chunk
    const input = JSON.parse(source)
    const reason = decide(input)
    if (reason) {
      recordHookDenial(input, {hook: 'enforce-script-lookup', code: 'SCRIPT_HUNT'})
      process.stdout.write(`${JSON.stringify({hookSpecificOutput: {hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason}})}\n`)
    }
  } catch { /* 효율 장치 — 어떤 오류도 명령을 막지 않는다 */ }
  process.exit(0)
}
