#!/usr/bin/env node
// resolve-commands.mjs — 검사 id → 실행 명령을 **즉시 판단**한다.
//
// 종전에는 `.claude/adapters/{id}/adapter.json`의 `commands`가 이 매핑을 선언했다. 실측
// (2026-08-26): 45개 명령 중 42개가 `pnpm run <script>`였다 — 빌드 방법이 아니라 **receipt
// 이름과 package.json script 이름의 이름표**였다. 선언은 프로젝트가 script를 바꾸면 낡고,
// 형태가 늘 때마다 새 어댑터 파일을 요구했다.
//
// 두 종류로 갈린다:
//   프로젝트가 정하는 것 — script 이름. package.json에서 읽는다.
//   도구가 정하는 것     — `npm pack --dry-run` 같은 것. 하네스가 안다.
//
// 없는 것을 지어내지 않는다. script가 없으면 명령이 없고, 그 사실을 보고한다 —
// receipt가 안 나오는 것이 조용한 통과보다 낫다.
import {existsSync, readFileSync} from 'node:fs'
import {join, resolve} from 'node:path'

// 검사 id → package.json script 후보(우선순위 순). 프로젝트마다 이름이 다르므로 후보를 둔다.
export const SCRIPT_CANDIDATES = {
  'quality.lint': ['lint'],
  'quality.typecheck': ['typecheck', 'type-check'],
  'quality.unit': ['test:unit', 'test'],
  'ingestion.validate': ['validate:ingestion'],
  'api.unit': ['test:api'],
  'api.guards': ['test:api-guards'],
  'vite.build': ['build'],
  'lib.build': ['build'],
  'next.build': ['build'],
  'vite.browser': ['test:e2e'],
  'vite.production-mock-boundary': ['test:production-boundary'],
}

// 도구가 정하는 것 — package.json과 무관하게 하네스가 아는 명령.
export const TOOL_COMMANDS = {
  'dependencies.install': {executable: 'pnpm', args: ['install', '--frozen-lockfile']},
  'pack.contents': {executable: 'npm', args: ['pack', '--dry-run', '--json']},
}

const readManifest = root => {
  const path = join(resolve(root), 'package.json')
  if (!existsSync(path)) return null
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return null }
}

// next.* 는 스크립트 이름이 곧 검사 이름이다(next.node-browser → test:e2e:node 같은 규약이
// 아니라 프로젝트가 정의한 이름). 규약으로 못 잡는 것은 동명 script를 찾아본다.
const fallbackScriptName = checkId => checkId.replace(/^[^.]+\./, '')

// 형태 카탈로그가 검사 옆에 script 이름표를 둘 수 있다(`scriptCandidates`) — 규약으로 못 가르는
// 이름은 검사와 같은 자리에 적는 것이 맞다. 전역 표(SCRIPT_CANDIDATES)는 형태와 무관한 공통 검사용.
export const resolveCommand = (checkId, manifest, {scriptCandidates = null} = {}) => {
  const tool = TOOL_COMMANDS[checkId]
  if (tool) return {id: checkId, ...tool, source: 'tool'}
  const scripts = manifest?.scripts ?? {}
  const candidates = scriptCandidates ?? SCRIPT_CANDIDATES[checkId] ?? [fallbackScriptName(checkId)]
  for (const name of candidates) {
    if (typeof scripts[name] === 'string' && scripts[name].trim() !== '') {
      return {id: checkId, executable: 'pnpm', args: ['run', name], source: 'script'}
    }
  }
  return {id: checkId, status: 'NO_SCRIPT', candidates, source: 'absent'}
}

// checkIds는 문자열 또는 `{id, scriptCandidates}` 형태를 받는다(형태 카탈로그 항목을 그대로 넘길 수 있게).
export const resolveCommands = ({projectRoot, checkIds}) => {
  const manifest = readManifest(projectRoot)
  const normalized = checkIds.map(entry => (typeof entry === 'string' ? {id: entry} : entry))
  if (manifest === null) return {resolved: [], missing: normalized.map(({id}) => ({id, reason: 'package.json이 없다'}))}
  const all = normalized.map(entry => resolveCommand(entry.id, manifest, {scriptCandidates: entry.scriptCandidates ?? null}))
  return {
    resolved: all.filter(entry => entry.status !== 'NO_SCRIPT'),
    missing: all.filter(entry => entry.status === 'NO_SCRIPT'),
  }
}


// 어댑터가 `commands`를 선언하지 않는다(2026-08-27 도출 전환) — script 이름은 프로젝트가 정하므로
// 실행 시점에 `resolve-commands`가 해석한다. binding.commandId는 곧 check id다.
export const resolveProfileCommands = ({projectRoot, adapter}) => {
  const {resolved, missing} = resolveCommands({
    projectRoot,
    checkIds: adapter.checks.map(check => ({id: check.id, scriptCandidates: check.scriptCandidates ?? null})),
  })
  const commands = new Map(resolved.map(command => [command.id, command]))
  // script가 없는 검사도 **이름을 붙여 돌려준다**. 지어내는 것이 아니라 "이 검사는 이 script를
  // 기대했는데 없다"를 하류가 BLOCKED receipt로 적을 수 있게 하는 것이다 — 명령을 빼버리면
  // receipt 자체가 안 나오고 침묵이 된다. 침묵은 BLOCKED보다 나쁘다(2026-08-27 실측: 어댑터
  // 선언을 걷어내자 fixture의 BLOCKED 증거가 통째로 사라졌다).
  for (const entry of missing) {
    if (commands.has(entry.id)) continue
    commands.set(entry.id, {
      id: entry.id,
      executable: 'pnpm',
      args: ['run', entry.candidates?.[0] ?? entry.id],
      source: 'absent',
    })
  }
  return commands
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2)
  const rootIndex = argv.indexOf('--project-root')
  const checksIndex = argv.indexOf('--checks')
  const projectRoot = rootIndex >= 0 ? argv[rootIndex + 1] : '.'
  if (checksIndex < 0) { process.stderr.write('사용법: --project-root <path> --checks <a,b,c>\n'); process.exit(2) }
  const checkIds = argv[checksIndex + 1].split(',').map(v => v.trim()).filter(Boolean)
  const {resolved, missing} = resolveCommands({projectRoot, checkIds})
  for (const c of resolved) process.stdout.write(`${c.id}\t${c.executable} ${c.args.join(' ')}\t(${c.source})\n`)
  for (const m of missing) process.stdout.write(`${m.id}\tNO_SCRIPT (후보: ${m.candidates.join(', ')})\n`)
}
