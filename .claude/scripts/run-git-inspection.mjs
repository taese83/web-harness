#!/usr/bin/env node

import {spawnSync} from 'node:child_process'
import {existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {delimiter, dirname, relative, resolve, sep} from 'node:path'
import {fileURLToPath} from 'node:url'

const argv = process.argv.slice(2)
const values = new Map()
for (let index = 0; index < argv.length; index += 2) {
  const option = argv[index]
  const value = argv[index + 1]
  if (!['--project', '--operation', '--base'].includes(option) || value === undefined || values.has(option)) {
    process.stderr.write('Usage: run-git-inspection.mjs --project <directory> --operation <status|diff-stat|diff-names|diff|log|ls-files> [--base <branch>]\n')
    process.exit(2)
  }
  values.set(option, value)
}

const operation = values.get('--operation')
if (!values.has('--project') || !['status', 'diff-stat', 'diff-names', 'diff', 'log', 'ls-files'].includes(operation)) {
  process.stderr.write('A project and supported read-only Git operation are required.\n')
  process.exit(2)
}

const base = values.get('--base')
if (base !== undefined && (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(base) || base.includes('..') || base.includes('//'))) {
  process.stderr.write('Git base must be a simple local branch or ref name.\n')
  process.exit(2)
}
if ((operation === 'status' || operation === 'ls-files') && base !== undefined) {
  process.stderr.write(`The ${operation} operation does not accept --base.\n`)
  process.exit(2)
}

const repositoryRoot = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'))
let projectRoot
try {
  projectRoot = realpathSync(resolve(values.get('--project')))
} catch {
  process.stderr.write('Git inspection project must be an existing directory.\n')
  process.exit(2)
}
const offset = relative(repositoryRoot, projectRoot)
if (
  !statSync(projectRoot).isDirectory() ||
  offset === '..' ||
  offset.startsWith(`..${sep}`) ||
  ['.claude', '.git', '_workspace'].includes(offset.split(sep)[0])
) {
  process.stderr.write('Git inspection must stay inside the harness or a normal child project.\n')
  process.exit(2)
}

const isolatedHome = mkdtempSync(resolve(tmpdir(), 'web-harness-git-home-'))
const environment = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => [
    'COLORTERM', 'COMSPEC', 'LANG', 'LC_ALL', 'NO_COLOR', 'PATH', 'PATHEXT',
    'SYSTEMROOT', 'TERM', 'TMP', 'TEMP', 'TMPDIR', 'TZ',
  ].includes(key)),
)
environment.PATH = [dirname(process.execPath), environment.PATH].filter(Boolean).join(delimiter)
environment.HOME = isolatedHome
environment.USERPROFILE = isolatedHome
environment.GIT_CONFIG_NOSYSTEM = '1'
environment.GIT_CONFIG_GLOBAL = resolve(isolatedHome, '.gitconfig')
environment.GIT_PAGER = 'cat'
environment.GIT_TERMINAL_PROMPT = '0'
environment.GIT_OPTIONAL_LOCKS = '0'
environment.GIT_NO_REPLACE_OBJECTS = '1'

const gitExecutable = existsSync('/usr/bin/git') ? '/usr/bin/git' : 'git'

const gitPrefix = [
  '--no-pager',
  '-c', 'core.fsmonitor=false',
  '-c', 'core.untrackedCache=false',
  '-c', 'pager.status=false',
  '-c', 'pager.diff=false',
  '-c', 'pager.log=false',
]
const runGit = args => spawnSync(gitExecutable, [...gitPrefix, ...args], {
  cwd: projectRoot,
  encoding: 'utf8',
  env: environment,
  maxBuffer: 20 * 1024 * 1024,
  timeout: 30_000,
})

const secretPath = value => {
  const path = value.replaceAll('\\', '/').toLowerCase()
  const segments = path.split('/').filter(Boolean)
  const basename = segments.at(-1) ?? ''
  return segments.some(segment => [
    '.ssh', '.aws', '.azure', '.docker', '.gnupg', '.kube', 'secret', 'secrets',
    'credential', 'credentials',
  ].includes(segment)) ||
    basename === '.env' || basename === '.dev.vars' ||
    (basename.startsWith('.env.') && !['.env.example', '.env.sample', '.env.template'].includes(basename)) ||
    ['.npmrc', '.netrc', '.pypirc', '.git-credentials', 'credentials.json', 'service-account.json'].includes(basename) ||
    /(?:^|\/)(?:id_rsa|id_ed25519|id_ecdsa|id_dsa)$/.test(path) ||
    /\.(?:pem|key|p12|pfx|jks|keystore)$/.test(basename)
}

const redact = source => String(source ?? '')
  .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[REDACTED]@')
  .replace(/\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|CREDENTIAL|PRIVATE_KEY|API_KEY))\s*[=:]\s*([^\s]+)/gi, '$1=[REDACTED]')
  .replace(/\b(?:ghp|github_pat|glpat|sk_live|sk_test|sk-proj)-?[A-Za-z0-9_\-]{12,}\b/g, '[REDACTED_TOKEN]')

const finish = result => {
  if (result.stdout) process.stdout.write(redact(result.stdout))
  if (result.stderr) process.stderr.write(redact(result.stderr))
  if (result.error) process.stderr.write(`${redact(result.error.message)}\n`)
  rmSync(isolatedHome, {recursive: true, force: true})
  process.exit(Number.isInteger(result.status) ? result.status : 1)
}

const readStatus = () => {
  const result = runGit(['status', '--porcelain=v1', '-z', '--untracked-files=all'])
  if (result.status !== 0) finish(result)
  const records = result.stdout.split('\0').filter(Boolean)
  const entries = []
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    const status = record.slice(0, 2)
    const paths = [record.slice(3)]
    if (/[RC]/.test(status) && records[index + 1]) paths.push(records[++index])
    entries.push({status, paths})
  }
  return entries
}
const statusEntries = readStatus()
const displayPath = path => JSON.stringify(path)
if (operation === 'status') {
  const safeEntries = statusEntries.filter(entry => entry.paths.every(path => !secretPath(path))).slice(0, 500)
  const omitted = statusEntries.length - safeEntries.length
  finish({
    status: 0,
    stdout: `${safeEntries.map(entry => `${entry.status} ${entry.paths.map(displayPath).join(' -> ')}`).join('\n')}${safeEntries.length ? '\n' : ''}${omitted ? `[${omitted} secret-bearing or excess path(s) omitted]\n` : ''}`,
    stderr: '',
  })
}

// ls-files — "비밀을 담을 수 있는 파일이 추적되고 있는가"를 답한다 (security-reviewer용).
// 다른 operation은 secret 경로를 출력에서 **제외**하지만 여기서는 그 반대다: 추적 사실 자체가 finding이므로
// 경로 이름을 보고한다. 파일 **내용은 절대 읽지 않는다** — 값 확인·rotate는 사용자 몫이다.
if (operation === 'ls-files') {
  const result = runGit(['ls-files', '-z'])
  if (result.status !== 0) finish(result)
  const tracked = result.stdout.split('\0').filter(Boolean)
  const flagged = tracked.filter(path => secretPath(path)).slice(0, 200)
  const lines = [`tracked files: ${tracked.length}`]
  if (flagged.length === 0) {
    lines.push('tracked secret-bearing paths: none')
  } else {
    lines.push(`tracked secret-bearing paths: ${flagged.length} (names only — contents are never read)`)
    for (const path of flagged) lines.push(`  ${displayPath(path)}`)
  }
  finish({status: 0, stdout: `${lines.join('\n')}\n`, stderr: ''})
}

const headExists = runGit(['rev-parse', '--verify', 'HEAD']).status === 0
if (operation === 'log') {
  if (!headExists) finish({status: 0, stdout: 'No commits.\n', stderr: ''})
  finish(runGit(['log', ...(base ? [`${base}...HEAD`] : []), '--oneline', '--no-decorate', '--max-count=200']))
}

const diffInvocations = extra => base
  ? [['diff', '--no-ext-diff', '--no-textconv', ...extra, base]]
  : headExists
    ? [['diff', '--no-ext-diff', '--no-textconv', ...extra, 'HEAD']]
    : [
        ['diff', '--no-ext-diff', '--no-textconv', ...extra, '--cached'],
        ['diff', '--no-ext-diff', '--no-textconv', ...extra],
      ]
const runDiffs = (extra, paths = []) => {
  const outputs = []
  for (const invocation of diffInvocations(extra)) {
    const result = runGit([...invocation, ...(paths.length ? ['--', ...paths] : [])])
    if (result.status !== 0) finish(result)
    outputs.push(result.stdout)
  }
  return outputs.join('')
}
const trackedPaths = runDiffs(['--name-only', '-z']).split('\0').filter(Boolean)
const untrackedPaths = statusEntries.filter(entry => entry.status === '??').flatMap(entry => entry.paths)
const changedPaths = [...new Set([...trackedPaths, ...untrackedPaths])]
const safePaths = changedPaths.filter(path => !secretPath(path)).slice(0, 500)
const safePathSet = new Set(safePaths)
const safeTrackedPaths = trackedPaths.filter(path => safePathSet.has(path))
const safeUntrackedPaths = untrackedPaths.filter(path => safePathSet.has(path))
const omittedCount = changedPaths.length - safePaths.length

if (operation === 'diff-names') {
  finish({
    status: 0,
    stdout: `${safePaths.map(displayPath).join('\n')}${safePaths.length ? '\n' : ''}${omittedCount ? `[${omittedCount} secret-bearing or excess path(s) omitted]\n` : ''}`,
    stderr: '',
  })
}
if (safePaths.length === 0) {
  finish({status: 0, stdout: omittedCount ? `[${omittedCount} secret-bearing path(s) omitted]\n` : 'No matching changes.\n', stderr: ''})
}

let output = safeTrackedPaths.length
  ? runDiffs(operation === 'diff-stat' ? ['--stat'] : [], safeTrackedPaths)
  : ''
if (operation === 'diff-stat' && safeUntrackedPaths.length) {
  output += `${safeUntrackedPaths.map(path => ` [untracked] ${displayPath(path)}`).join('\n')}\n`
}
if (operation === 'diff') {
  let remainingBytes = 2 * 1024 * 1024
  for (const path of safeUntrackedPaths.slice(0, 100)) {
    const absolutePath = resolve(projectRoot, path)
    let source = null
    try {
      const stats = lstatSync(absolutePath)
      if (stats.isFile() && stats.size <= 256 * 1024 && stats.size <= remainingBytes) {
        source = readFileSync(absolutePath)
        remainingBytes -= source.length
      }
    } catch {}
    if (!source || source.includes(0)) {
      output += `\n[untracked content omitted] ${displayPath(path)}\n`
      continue
    }
    const lines = redact(source.toString('utf8')).split('\n')
    output += `\ndiff --git a/${displayPath(path)} b/${displayPath(path)}\nnew file\n--- /dev/null\n+++ b/${displayPath(path)}\n@@ -0,0 +1,${lines.length} @@\n${lines.map(line => `+${line}`).join('\n')}\n`
  }
}
if (omittedCount) output += `\n[${omittedCount} secret-bearing or excess path(s) omitted]\n`
finish({status: 0, stdout: output || 'No matching changes.\n', stderr: ''})
