import {realpathSync, statSync} from 'node:fs'
import {extname, relative, resolve, sep} from 'node:path'

const MAX_COMMAND_LENGTH = 8192
const MAX_TOKENS = 128
const SIMPLE_ID = /^[a-z0-9][a-z0-9-]*$/
const CAPABILITY_ID = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/
const POSITIVE_INTEGER = /^[1-9]\d{0,5}$/

const AI_STAGES = new Set(['foundation', 'routing', 'services', 'policy', 'eval-contracts', 'all'])
const TEST_STAGES = new Set(['baseline', ...AI_STAGES])
const QUALITY_CHECKS = new Set([
  'build', 'typecheck', 'lint', 'test', 'coverage', 'browser', 'audit',
  'quality.lint', 'quality.typecheck', 'quality.unit',
  'vite.build', 'vite.browser', 'vite.production-mock-boundary', 'api.unit', 'api.guards',
  'next.build', 'next.route-contract', 'next.client-boundary', 'next.secret-boundary',
  'next.production-start', 'next.node-browser', 'next.node-hydration', 'next.node-authz',
  'next.node-cache-isolation', 'next.node-smoke', 'next.node-shutdown', 'next.docker-build',
  'next.docker-smoke', 'next.docker-browser', 'next.docker-hydration', 'next.docker-authz',
  'next.docker-cache-isolation', 'next.docker-shutdown', 'next.export-artifact',
  'next.static-host-smoke', 'next.static-browser', 'next.static-hydration',
])
const BUILT_IN_ADAPTERS = new Set(['react-vite-spa', 'next-app-fullstack', 'vite-serverless-hybrid'])
const NETWORK_COMMANDS = new Set([
  'curl', 'wget', 'nc', 'ncat', 'netcat', 'ssh', 'scp', 'sftp', 'ftp', 'telnet',
  'rsync', 'gh', 'hub', 'npm', 'npx', 'yarn', 'bun', 'git',
])

// pnpm: 네트워크/변경 작업은 차단하고 스크립트 실행만 허용
const PNPM_NETWORK_SUBCOMMANDS = new Set([
  'install', 'i', 'add', 'remove', 'uninstall', 'un', 'update', 'up', 'upgrade',
  'publish', 'pack', 'audit', 'outdated', 'dedupe', 'prune', 'fetch', 'patch',
  'patch-commit', 'store', 'link', 'unlink', 'rebuild', 'dlx', 'create', 'init',
  'exec', 'deploy',
])
const PNPM_ALLOWED_SCRIPTS = new Set([
  'build', 'dev', 'preview', 'typecheck', 'lint', 'test', 'coverage',
  'start', 'serve', 'check', 'format',
])

const validatePnpmCommand = (args, _context) => {
  if (args.length === 0) fail('DENY_ARGUMENTS', 'pnpm requires a subcommand.')
  // strip leading flags: --dir <path>, --filter <pattern>, -C <path>, --recursive/-r
  let remaining = [...args]
  while (remaining.length > 0 && remaining[0].startsWith('-')) {
    const flag = remaining[0]
    if (flag === '--dir' || flag === '--filter' || flag === '-C') {
      remaining = remaining.slice(2) // flag + value
    } else if (flag === '--recursive' || flag === '-r') {
      remaining = remaining.slice(1)
    } else {
      fail('DENY_ARGUMENTS', `Unsupported pnpm flag: ${flag}`)
    }
  }
  if (remaining.length === 0) fail('DENY_ARGUMENTS', 'pnpm requires a subcommand after flags.')
  const sub = remaining[0]
  if (PNPM_NETWORK_SUBCOMMANDS.has(sub)) {
    fail('DENY_NETWORK', `pnpm ${sub} is blocked; only script execution is allowed.`)
  }
  // pnpm run <script> or pnpm <script> (shorthand)
  const script = sub === 'run' ? remaining[1] : sub
  if (!script) fail('DENY_ARGUMENTS', 'pnpm run requires a script name.')
  if (!PNPM_ALLOWED_SCRIPTS.has(script)) {
    fail('DENY_ARGUMENTS', `pnpm script not in allowlist: ${script}. Allowed: ${[...PNPM_ALLOWED_SCRIPTS].join(', ')}`)
  }
}
const DESTRUCTIVE_COMMANDS = new Set([
  'rm', 'mv', 'cp', 'dd', 'chmod', 'chown', 'truncate', 'tee', 'touch', 'mkdir',
  'rmdir', 'install', 'ln', 'kill', 'pkill', 'killall', 'shutdown', 'reboot',
])
// grep은 rg의 대체가 아니라 **동급 1순위**다. rg는 별도 설치가 필요한 비표준 바이너리라
// 아키텍처 불일치·미설치 환경에서 exit 127로 조용히 죽고, 그러면 verifier의 전수 검사가
// 통째로 무력화된다(실사고: x86_64 rg + arm64 호스트에서 모든 subagent content 검색 불가).
// POSIX grep은 어디에나 있으므로 검색 능력이 단일 바이너리에 의존하지 않게 한다.
const READ_COMMANDS = new Set(['pwd', 'ls', 'cat', 'head', 'tail', 'wc', 'rg', 'grep'])
const SECRET_SEGMENTS = new Set([
  'secret', 'secrets', '.secret', '.secrets', 'credential', 'credentials',
  '.credentials', '.git', '.ssh', '.aws', '.azure', '.docker', '.gnupg', '.kube',
])
const SECRET_BASENAMES = new Set([
  '.dev.vars', '.npmrc', '.netrc', '.pypirc', '.git-credentials', 'credentials.json',
  'service-account.json', 'id_rsa', 'id_ed25519', 'id_ecdsa', 'id_dsa',
])
const SAFE_ENV_TEMPLATES = new Set(['.env.example', '.env.sample', '.env.template'])
const SECRET_EXTENSIONS = new Set(['.pem', '.key', '.p12', '.pfx', '.jks', '.keystore'])

class PolicyError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

const allow = (code, reason) => ({allowed: true, code, reason})
const deny = (code, reason) => ({allowed: false, code, reason})
const fail = (code, message) => { throw new PolicyError(code, message) }

const isInside = (root, target) => {
  const path = relative(root, target)
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`))
}

const hasSecretSegment = relativePath => {
  const segments = relativePath.split(/[\\/]+/).filter(Boolean).map(part => part.toLowerCase())
  return segments.some((segment, index) => {
    if (SECRET_SEGMENTS.has(segment) || SECRET_BASENAMES.has(segment)) return true
    if (segment === '.env') return true
    if (segment.startsWith('.env.') && !SAFE_ENV_TEMPLATES.has(segment)) return true
    if (index === segments.length - 1 && SECRET_EXTENSIONS.has(extname(segment))) return true
    return false
  })
}

const realDirectory = (candidate, label) => {
  let real
  try {
    real = realpathSync(candidate)
  } catch {
    fail('DENY_CONTEXT', `${label} does not exist.`)
  }
  if (!statSync(real).isDirectory()) fail('DENY_CONTEXT', `${label} must be a directory.`)
  return real
}

const createContext = (input, environment, processCwd) => {
  const projectCandidate = resolve(environment.CLAUDE_PROJECT_DIR ?? input.cwd ?? processCwd)
  const projectRoot = realDirectory(projectCandidate, 'Project root')
  const cwdCandidate = resolve(input.tool_input?.cwd ?? input.cwd ?? projectRoot)
  const cwd = realDirectory(cwdCandidate, 'Bash working directory')
  if (!isInside(projectRoot, cwd)) fail('DENY_PATH_OUTSIDE', 'Bash working directory is outside the project root.')
  return {projectRoot, cwd}
}

const readablePath = (value, context, kind = 'any') => {
  if (typeof value !== 'string' || value.length === 0 || value === '-') {
    fail('DENY_ARGUMENTS', 'Read commands require an explicit filesystem path and may not read stdin.')
  }
  const absolute = resolve(context.cwd, value)
  if (!isInside(context.projectRoot, absolute)) fail('DENY_PATH_OUTSIDE', `Path is outside the project root: ${value}`)
  const lexicalRelative = relative(context.projectRoot, absolute)
  if (hasSecretSegment(lexicalRelative)) fail('DENY_SECRET_PATH', `Secret-bearing path is blocked: ${value}`)

  let real
  try {
    real = realpathSync(absolute)
  } catch {
    fail('DENY_PATH_MISSING', `Read target does not exist: ${value}`)
  }
  if (!isInside(context.projectRoot, real)) fail('DENY_PATH_OUTSIDE', `Path resolves outside the project root: ${value}`)
  const realRelative = relative(context.projectRoot, real)
  if (hasSecretSegment(realRelative)) fail('DENY_SECRET_PATH', `Secret-bearing path is blocked: ${value}`)
  const stat = statSync(real)
  if (stat.isFile() && stat.size > 5 * 1024 * 1024) fail('DENY_FILE_TOO_LARGE', `Read target exceeds 5 MiB: ${value}`)
  if (kind === 'file' && !stat.isFile()) fail('DENY_ARGUMENTS', `Expected a regular file: ${value}`)
  if (kind === 'directory' && !stat.isDirectory()) fail('DENY_ARGUMENTS', `Expected a directory: ${value}`)
  return real
}

export const tokenizeSimpleCommand = command => {
  if (typeof command !== 'string' || command.trim() === '') fail('DENY_INPUT', 'Bash requires a non-empty command string.')
  if (command.length > MAX_COMMAND_LENGTH) fail('DENY_INPUT', 'Bash command exceeds the policy length limit.')

  const tokens = []
  let token = ''
  let tokenActive = false
  let quote = null
  const finishToken = () => {
    if (!tokenActive) return
    tokens.push(token)
    if (tokens.length > MAX_TOKENS) fail('DENY_INPUT', 'Bash command has too many arguments.')
    token = ''
    tokenActive = false
  }

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index]
    const code = character.charCodeAt(0)
    if (character === '\n' || character === '\r' || character === '\0' || (code < 32 && character !== '\t')) {
      fail('DENY_COMPOUND_SYNTAX', 'Control characters and multiline commands are blocked.')
    }
    if (quote === "'") {
      if (character === "'") quote = null
      else token += character
      tokenActive = true
      continue
    }
    if (quote === '"') {
      if (character === '"') quote = null
      else if (character === '$' || character === '`' || character === '\\') {
        fail('DENY_SHELL_EXPANSION', 'Expansion and escape syntax inside double quotes is blocked.')
      } else token += character
      tokenActive = true
      continue
    }
    if (character === "'" || character === '"') {
      quote = character
      tokenActive = true
    } else if (character === ' ' || character === '\t') {
      finishToken()
    } else if (';&|<>'.includes(character)) {
      fail('DENY_COMPOUND_SYNTAX', 'Pipelines, redirections, and compound shell commands are blocked.')
    } else if ('$`\\'.includes(character)) {
      fail('DENY_SHELL_EXPANSION', 'Shell expansion and escape syntax is blocked.')
    } else if ('(){}*?[]~#!'.includes(character)) {
      fail('DENY_AMBIGUOUS_SYNTAX', 'Globbing, subshell, brace, comment, and history syntax is blocked; quote literal data.')
    } else {
      token += character
      tokenActive = true
    }
  }
  if (quote) fail('DENY_AMBIGUOUS_SYNTAX', 'Unterminated shell quote is blocked.')
  finishToken()
  if (tokens.length === 0) fail('DENY_INPUT', 'Bash requires a command.')
  return tokens
}

const requireNoUnexpectedToolInput = toolInput => {
  const allowedKeys = new Set(['command', 'description', 'timeout', 'cwd'])
  for (const key of Object.keys(toolInput)) {
    if (!allowedKeys.has(key)) fail('DENY_INPUT', `Unsupported Bash tool input field: ${key}`)
  }
  if (
    toolInput.timeout !== undefined &&
    (!Number.isInteger(toolInput.timeout) || toolInput.timeout < 1 || toolInput.timeout > 120_000)
  ) fail('DENY_INPUT', 'Bash timeout must be an integer from 1 to 120000 milliseconds.')
}

const validateLs = (args, context) => {
  const allowedFlags = new Set(['-a', '-A', '-l', '-1', '-d', '-la', '-al'])
  let optionsEnded = false
  const paths = []
  for (const arg of args) {
    if (!optionsEnded && arg === '--') optionsEnded = true
    else if (!optionsEnded && arg.startsWith('-')) {
      if (!allowedFlags.has(arg)) fail('DENY_ARGUMENTS', `Unsupported ls option: ${arg}`)
    } else paths.push(arg)
  }
  if (paths.length > 16) fail('DENY_ARGUMENTS', 'ls path count exceeds the policy limit.')
  for (const path of paths) readablePath(path, context)
}

const validateFileReader = (command, args, context) => {
  let optionsEnded = false
  const paths = []
  for (const arg of args) {
    if (!optionsEnded && arg === '--') optionsEnded = true
    else if (!optionsEnded && arg.startsWith('-')) fail('DENY_ARGUMENTS', `${command} options are not allowed.`)
    else paths.push(arg)
  }
  if (paths.length === 0 || paths.length > 16) fail('DENY_ARGUMENTS', `${command} requires 1-16 regular files.`)
  for (const path of paths) readablePath(path, context, 'file')
}

const validateHeadOrTail = (command, args, context) => {
  const paths = []
  let index = 0
  let optionsEnded = false
  while (index < args.length) {
    const arg = args[index]
    if (!optionsEnded && arg === '--') {
      optionsEnded = true
      index += 1
    } else if (!optionsEnded && (arg === '-n' || arg === '--lines')) {
      const value = args[index + 1]
      if (!POSITIVE_INTEGER.test(value ?? '') || Number(value) > 1000) fail('DENY_ARGUMENTS', `${command} line count must be 1-1000.`)
      index += 2
    } else if (!optionsEnded && arg.startsWith('--lines=')) {
      const value = arg.slice('--lines='.length)
      if (!POSITIVE_INTEGER.test(value) || Number(value) > 1000) fail('DENY_ARGUMENTS', `${command} line count must be 1-1000.`)
      index += 1
    } else if (!optionsEnded && arg.startsWith('-')) {
      fail('DENY_ARGUMENTS', `Unsupported ${command} option: ${arg}`)
    } else {
      paths.push(arg)
      index += 1
    }
  }
  if (paths.length === 0 || paths.length > 16) fail('DENY_ARGUMENTS', `${command} requires 1-16 regular files.`)
  for (const path of paths) readablePath(path, context, 'file')
}

const validateWc = (args, context) => {
  const allowedFlags = new Set(['-l', '-w', '-c', '-m', '-lw', '-wl', '--lines', '--words', '--bytes', '--chars'])
  let optionsEnded = false
  const paths = []
  for (const arg of args) {
    if (!optionsEnded && arg === '--') optionsEnded = true
    else if (!optionsEnded && arg.startsWith('-')) {
      if (!allowedFlags.has(arg)) fail('DENY_ARGUMENTS', `Unsupported wc option: ${arg}`)
    } else paths.push(arg)
  }
  if (paths.length === 0 || paths.length > 16) fail('DENY_ARGUMENTS', 'wc requires 1-16 regular files.')
  for (const path of paths) readablePath(path, context, 'file')
}

// 재귀 rg 검색이 반드시 동반해야 하는 보호 glob (아래 validateRg가 전수 요구)
const RG_RECURSIVE_EXCLUDE_GLOBS = [
  '!**/.env*', '!**/*.pem', '!**/*.key', '!**/id_*', '!**/*secret*', '!**/*credential*',
]

// 재귀 grep이 반드시 동반해야 하는 보호 exclude.
// rg보다 요구가 **강하다**: rg는 기본적으로 hidden 파일과 .gitignore 대상을 건너뛰지만
// grep -r은 `.env`·`.git/`·`node_modules/`까지 그대로 내려간다. 따라서 파일 패턴 6종에
// 디렉터리 2종(.git — 오브젝트에 전체 히스토리와 자격증명 캐시, node_modules — 서드파티 코드)을 더한다.
const GREP_RECURSIVE_EXCLUDES = [
  '--exclude=.env*', '--exclude=*.pem', '--exclude=*.key', '--exclude=id_*',
  '--exclude=*secret*', '--exclude=*credential*',
  '--exclude-dir=.git', '--exclude-dir=node_modules',
]

const validateGrep = (args, context) => {
  const booleanOptions = new Set([
    '-n', '--line-number', '-i', '--ignore-case', '-l', '--files-with-matches',
    '-L', '--files-without-match', '-c', '--count', '-o', '--only-matching',
    '-E', '--extended-regexp', '-F', '--fixed-strings', '-w', '--word-regexp',
    '-v', '--invert-match', '-s', '--no-messages', '-H', '--with-filename',
    '-h', '--no-filename', '-r', '-R', '--recursive', '--dereference-recursive',
  ])
  const valueOptions = new Set(['-e', '--regexp', '-m', '--max-count', '-A', '-B', '-C'])
  // 결합 단축 플래그(-rn, -ril 등)는 실사용 기본형이다. 문자 단위로 분해해 전부 허용 집합에
  // 속할 때만 통과시킨다 — 조합을 일일이 열거하면 정당한 사용이 조용히 막힌다.
  const shortBooleanLetters = new Set(['n', 'i', 'l', 'L', 'c', 'o', 'E', 'F', 'w', 'v', 's', 'H', 'h', 'r', 'R'])
  let recursive = false
  let expressionCount = 0
  let optionsEnded = false
  const provided = new Set()
  const positional = []
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (!optionsEnded && arg === '--') {
      optionsEnded = true
    } else if (!optionsEnded && booleanOptions.has(arg)) {
      if (['-r', '-R', '--recursive', '--dereference-recursive'].includes(arg)) recursive = true
    } else if (
      !optionsEnded && /^-[a-zA-Z]{2,}$/.test(arg) &&
      [...arg.slice(1)].every(letter => shortBooleanLetters.has(letter))
    ) {
      if (arg.includes('r') || arg.includes('R')) recursive = true
    } else if (!optionsEnded && valueOptions.has(arg)) {
      const value = args[index + 1]
      if (value === undefined) fail('DENY_ARGUMENTS', `Missing value for grep option: ${arg}`)
      if (arg === '-e' || arg === '--regexp') expressionCount += 1
      if (['-m', '--max-count', '-A', '-B', '-C'].includes(arg) && !POSITIVE_INTEGER.test(value)) {
        fail('DENY_ARGUMENTS', `grep ${arg} requires a positive integer.`)
      }
      index += 1
    } else if (!optionsEnded && (arg.startsWith('--exclude=') || arg.startsWith('--exclude-dir=') || arg.startsWith('--include='))) {
      provided.add(arg)
    } else if (!optionsEnded && arg.startsWith('-') && arg !== '-') {
      fail('DENY_ARGUMENTS', `Unsupported grep option: ${arg}`)
    } else positional.push(arg)
  }
  if (expressionCount === 0 && positional.length === 0) fail('DENY_ARGUMENTS', 'grep requires a search expression.')
  const paths = expressionCount > 0 ? positional : positional.slice(1)
  if (paths.length === 0 || paths.length > 32) {
    fail('DENY_ARGUMENTS', 'grep requires 1-32 explicit paths; stdin search is blocked.')
  }
  let hasDirectoryTarget = false
  for (const path of paths) {
    const real = readablePath(path, context)
    if (statSync(real).isDirectory()) hasDirectoryTarget = true
  }
  if (!recursive && hasDirectoryTarget) {
    fail('DENY_ARGUMENTS', 'grep on a directory requires -r; otherwise pass regular files.')
  }
  if (recursive) {
    const missing = GREP_RECURSIVE_EXCLUDES.filter(flag => !provided.has(flag))
    if (missing.length > 0) {
      fail('DENY_ARGUMENTS', `Recursive grep requires protective exclusions: ${missing.join(' ')}`)
    }
  }
}

const validateRg = (args, context) => {
  const booleanOptions = new Set([
    '--files', '-F', '--fixed-strings', '-n', '--line-number', '--no-heading',
    '-i', '--ignore-case', '-s', '--case-sensitive', '-S', '--smart-case',
    '-w', '--word-regexp', '-v', '--invert-match', '--no-messages',
    '-l', '--files-with-matches', '-c', '--count',
  ])
  const valueOptions = new Set(['-e', '--regexp', '-g', '--glob', '-t', '--type', '-T', '--type-not', '-m', '--max-count'])
  let filesMode = false
  let expressionCount = 0
  let optionsEnded = false
  const globValues = []
  const positional = []
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (!optionsEnded && arg === '--') optionsEnded = true
    else if (!optionsEnded && booleanOptions.has(arg)) {
      if (arg === '--files') filesMode = true
    } else if (!optionsEnded && valueOptions.has(arg)) {
      const value = args[index + 1]
      if (value === undefined) fail('DENY_ARGUMENTS', `Missing value for rg option: ${arg}`)
      if (arg === '-e' || arg === '--regexp') expressionCount += 1
      if (arg === '-g' || arg === '--glob') globValues.push(value)
      if ((arg === '-m' || arg === '--max-count') && !POSITIVE_INTEGER.test(value)) fail('DENY_ARGUMENTS', 'rg max-count must be a positive integer.')
      index += 1
    } else if (!optionsEnded && arg.startsWith('-')) {
      fail('DENY_ARGUMENTS', `Unsupported rg option: ${arg}`)
    } else positional.push(arg)
  }
  if (filesMode) {
    if (expressionCount > 0) fail('DENY_ARGUMENTS', 'rg --files may not include search expressions.')
    for (const path of positional) readablePath(path, context)
    return
  }
  const paths = expressionCount > 0 ? positional : positional.slice(1)
  if (expressionCount === 0 && positional.length === 0) fail('DENY_ARGUMENTS', 'rg requires a search expression.')
  if (paths.length === 0 || paths.length > 32) {
    fail('DENY_ARGUMENTS', 'rg content search requires 1-32 explicit paths.')
  }
  // 디렉터리 대상(재귀 검색)은 보호 glob 전부를 동반할 때만 허용한다 — QA 검증자의 전수 검사 경로.
  // rg는 기본으로 hidden 파일(.env*)과 .gitignore 대상을 읽지 않고 --hidden/--no-ignore/-u는 allowlist 밖이므로,
  // 이 glob들은 non-hidden 비밀 파일(credentials.json, *.pem, id_rsa 등)에 대한 이중 방어다.
  let hasDirectoryTarget = false
  for (const path of paths) {
    const real = readablePath(path, context)
    if (statSync(real).isDirectory()) hasDirectoryTarget = true
  }
  if (hasDirectoryTarget) {
    const provided = new Set(globValues)
    const missing = RG_RECURSIVE_EXCLUDE_GLOBS.filter(glob => !provided.has(glob))
    if (missing.length > 0) {
      fail(
        'DENY_ARGUMENTS',
        `Recursive rg search requires protective exclusion globs: ${missing.map(glob => `-g '${glob}'`).join(' ')}`,
      )
    }
  }
}

const validateReadCommand = (command, args, context) => {
  if (command === 'pwd') {
    if (args.length > 0) fail('DENY_ARGUMENTS', 'pwd does not accept arguments under this policy.')
  } else if (command === 'ls') validateLs(args, context)
  else if (command === 'cat') validateFileReader(command, args, context)
  else if (command === 'head' || command === 'tail') validateHeadOrTail(command, args, context)
  else if (command === 'wc') validateWc(args, context)
  else if (command === 'rg') validateRg(args, context)
  else if (command === 'grep') validateGrep(args, context)
}

const validateWorkspaceMkdir = (args, context) => {
  const allowed = new Set([
    '_workspace/00_source',
    '_workspace/01_plan',
    '_workspace/02_design',
    '_workspace/03_dev',
    '_workspace/04_qa',
    '_workspace/RELEASE',
  ])
  if (args[0] !== '-p' || args.length !== allowed.size + 1) {
    fail('DENY_ARGUMENTS', 'mkdir is limited to the complete Web Harness workspace initialization contract.')
  }
  const requested = new Set(args.slice(1).map(value => value.split('\\').join('/').replace(/^\.\//, '')))
  if (requested.size !== allowed.size || [...allowed].some(path => !requested.has(path))) {
    fail('DENY_ARGUMENTS', 'mkdir paths do not match the Web Harness workspace initialization contract.')
  }
  for (const value of args.slice(1)) {
    const absolute = resolve(context.cwd, value)
    if (!isInside(context.projectRoot, absolute)) fail('DENY_PATH_OUTSIDE', `Workspace path is outside the project root: ${value}`)
  }
}

const exactPair = (args, option, values) =>
  args.length === 2 && args[0] === option && values.has(args[1])

const withoutDirectoryOption = (args, option, context) => {
  const indexes = args.flatMap((value, index) => value === option ? [index] : [])
  if (indexes.length === 0) return [...args]
  if (indexes.length !== 1) fail('DENY_ARGUMENTS', `${option} may be supplied once.`)
  const index = indexes[0]
  const value = args[index + 1]
  if (!value || value.startsWith('--')) fail('DENY_ARGUMENTS', `${option} requires a directory.`)
  readablePath(value, context, 'directory')
  return [...args.slice(0, index), ...args.slice(index + 2)]
}

const qualityRunnerContract = (args, context) => {
  let commandArgs = withoutDirectoryOption(args, '--project', context)
  const approvalIndexes = commandArgs.flatMap((value, index) => value === '--allow-host-execution' ? [index] : [])
  if (approvalIndexes.length > 1) return false
  if (approvalIndexes.length === 1) {
    const index = approvalIndexes[0]
    commandArgs = [...commandArgs.slice(0, index), ...commandArgs.slice(index + 1)]
  }
  return commandArgs.length === 0 ||
    (commandArgs.length === 1 && commandArgs[0] === '--all') ||
    exactPair(commandArgs, '--check', QUALITY_CHECKS)
}

const releaseGateContract = (args, context) => {
  const commandArgs = withoutDirectoryOption(args, '--project', context)
  return commandArgs.length === 0 ||
    (commandArgs.length === 1 && commandArgs[0] === '--write-manifest')
}

const attestationRequestContract = (args, context) => {
  if (!args.includes('--project')) return false
  const commandArgs = withoutDirectoryOption(args, '--project', context)
  return commandArgs.length === 2 &&
    commandArgs[0] === '--issuer-run-id' &&
    /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(commandArgs[1])
}

const harnessDeploymentContract = (args, context) => {
  if (args.length !== 2 || args[0] !== '--target') return false
  const target = readablePath(args[1], context, 'directory')
  const offset = relative(context.projectRoot, target)
  return target !== context.projectRoot && !['.claude', '.git', '_workspace'].includes(offset.split(sep)[0])
}

const packageOperationContract = (args, context) => {
  if (!args.includes('--project')) return false
  const commandArgs = withoutDirectoryOption(args, '--project', context)
  return commandArgs.length === 2 && commandArgs[0] === '--operation' &&
    ['lockfile', 'install', 'msw-init', 'husky-init', 'git-init'].includes(commandArgs[1])
}

const gitInspectionContract = (args, context) => {
  if (!args.includes('--project') || !args.includes('--operation')) return false
  let commandArgs = withoutDirectoryOption(args, '--project', context)
  const operationIndex = commandArgs.indexOf('--operation')
  if (operationIndex === -1 || !['status', 'diff-stat', 'diff-names', 'diff', 'log', 'ls-files'].includes(commandArgs[operationIndex + 1])) return false
  const operation = commandArgs[operationIndex + 1]
  commandArgs = [...commandArgs.slice(0, operationIndex), ...commandArgs.slice(operationIndex + 2)]
  if (commandArgs.length === 0) return operation === 'status' || operation.startsWith('diff') || operation === 'log' || operation === 'ls-files'
  if (operation === 'status' || operation === 'ls-files' || commandArgs.length !== 2 || commandArgs[0] !== '--base') return false
  return /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(commandArgs[1]) &&
    !commandArgs[1].includes('..') && !commandArgs[1].includes('//')
}

// record-verification.mjs — `--` 뒤의 명령을 실행하는 래퍼다. 감싼 명령을 무제한 허용하면
// 래퍼 하나로 이 정책 전체가 무력화되므로(`-- rm -rf ...`), 감싼 명령은 정책이 이미 허용하는
// pnpm script 실행으로 제한한다. (main 세션은 이 정책 자체가 면제이므로 사람이 쓰는 경로는 영향 없음)
const recordVerificationContract = (args, context) => {
  const separatorIndex = args.indexOf('--')
  if (separatorIndex === -1) return false
  const options = args.slice(0, separatorIndex)
  const wrapped = args.slice(separatorIndex + 1)
  if (options.length !== 4 || wrapped.length === 0) return false
  const values = new Map()
  for (let index = 0; index < options.length; index += 2) {
    const option = options[index]
    const value = options[index + 1]
    if (!['--project', '--label'].includes(option) || value === undefined || values.has(option)) return false
    values.set(option, value)
  }
  if (!values.has('--project') || !values.has('--label')) return false
  readablePath(values.get('--project'), context, 'directory')
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(values.get('--label'))) return false
  if (wrapped[0] !== 'pnpm') return false
  validatePnpmCommand(wrapped.slice(1), context) // 위반 시 throw — 래퍼 경유 우회 차단
  return true
}

const previewServerContract = (args, context) => {
  if (!args.includes('--project')) return false
  const commandArgs = withoutDirectoryOption(args, '--project', context)
  if (commandArgs.length % 2 !== 0) return false
  const seen = new Set()
  for (let index = 0; index < commandArgs.length; index += 2) {
    const option = commandArgs[index]
    const value = commandArgs[index + 1]
    if (!['--port', '--idle-minutes'].includes(option) || seen.has(option)) return false
    seen.add(option)
    if (!POSITIVE_INTEGER.test(value ?? '')) return false
  }
  return true
}

// run-eval-executor.mjs — `--run|--grade|--full`은 중첩 `claude -p`(일부는 bypassPermissions)를
// 기동한다. subagent에 그 권한을 주지 않기 위해 실행하지 않는 모드만 허용한다.
const evalExecutorContract = args => {
  if (args.length === 1 && args[0] === '--list-runs') return true
  if (args.length === 2 || args.length === 3) {
    if (args[0] !== '--scenario' || !SIMPLE_ID.test(args[1] ?? '')) return false
    return args.length === 2 || args[2] === '--dry-run'
  }
  return false
}

const skillSectionContract = args => {
  if (args.length !== 3 && args.length !== 4) return false
  const catalogIndex = args.indexOf('--catalog')
  if (catalogIndex === -1 || !['project-templates', 'library-setup', 'library-catalog'].includes(args[catalogIndex + 1])) return false
  const remaining = [...args.slice(0, catalogIndex), ...args.slice(catalogIndex + 2)]
  if (remaining.length === 1) return remaining[0] === '--list'
  return remaining.length === 2 && remaining[0] === '--section' && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(remaining[1])
}

const resolveProfileContract = (args, context) => {
  if (!args.includes('--project-root')) return false
  const commandArgs = withoutDirectoryOption(args, '--project-root', context)
  if (commandArgs.length % 2 !== 0) return false
  const seen = new Set()
  for (let index = 0; index < commandArgs.length; index += 2) {
    const option = commandArgs[index]
    const value = commandArgs[index + 1]
    if (!['--requested', '--provider', '--deployment', '--capability'].includes(option)) return false
    if (option !== '--capability' && seen.has(option)) return false
    seen.add(option)
    if (option === '--requested' && value !== 'auto' && !BUILT_IN_ADAPTERS.has(value)) return false
    if (option !== '--requested' && !SIMPLE_ID.test(value)) return false
  }
  return true
}

const executionPlanContract = (args, context) => {
  let remaining = [...args]
  const profileIndex = args.indexOf('--profile')
  if (profileIndex !== -1) {
    if (!BUILT_IN_ADAPTERS.has(args[profileIndex + 1])) return false
    remaining = [...remaining.slice(0, profileIndex), ...remaining.slice(profileIndex + 2)]
  }
  const profileFileIndex = remaining.indexOf('--profile-file')
  if (profileFileIndex !== -1) {
    const value = remaining[profileFileIndex + 1]
    if (!value || !value.toLowerCase().endsWith('.json')) return false
    readablePath(value, context, 'file')
    remaining = [...remaining.slice(0, profileFileIndex), ...remaining.slice(profileFileIndex + 2)]
  }
  if (profileIndex === -1 && profileFileIndex === -1) return false
  if (remaining.length === 0) return true
  if (remaining.length % 2 !== 0) return false
  for (let index = 0; index < remaining.length; index += 2) {
    if (remaining[index] !== '--target' || !CAPABILITY_ID.test(remaining[index + 1])) return false
  }
  return true
}

const designPreviewValidationContract = (args, context) => {
  const commandArgs = withoutDirectoryOption(args, '--project', context)
  if (!args.includes('--project')) return false
  if (commandArgs.length === 0) return true
  const flags = new Set(commandArgs)
  if (flags.has('--write-source-snapshot')) {
    return commandArgs.length === 1
  }
  if (flags.has('--record-approval')) {
    if (commandArgs.length !== 3 || commandArgs[0] !== '--record-approval' || commandArgs[1] !== '--approval-text') return false
    const text = commandArgs[2]
    return typeof text === 'string' && text.length > 0 && text.length <= 500 && !/[\r\n\0]/.test(text)
  }
  return commandArgs.every(argument => argument === '--json' || argument === '--allow-unapproved')
    && commandArgs.length === new Set(commandArgs).size
}

const validationScriptContract = (script, args, context) => {
  if (script === '.claude/scripts/validate-harness.mjs') return args.length === 0
  if (script === '.claude/scripts/validate-ai-harness.mjs') {
    return args.length === 0 || exactPair(args, '--stage', AI_STAGES)
  }
  if (script === '.claude/scripts/test-ai-harness.mjs') {
    return args.length === 0 || exactPair(args, '--stage', TEST_STAGES) || exactPair(args, '--through', TEST_STAGES)
  }
  if (script === '.claude/scripts/run-ai-evals.mjs') {
    if (args.length === 1 && (args[0] === '--validate' || args[0] === '--list')) return true
    if (args.length !== 2) return false
    if (['--service', '--stage', '--scenario'].includes(args[0])) return SIMPLE_ID.test(args[1])
    if (args[0] === '--verify-result') {
      readablePath(args[1], context, 'file')
      return args[1].toLowerCase().endsWith('.json')
    }
    return false
  }
  if (script === '.claude/scripts/run-quality-gates.mjs') return qualityRunnerContract(args, context)
  if (script === '.claude/scripts/deploy-harness.mjs') return harnessDeploymentContract(args, context)
  if (script === '.claude/scripts/run-package-operation.mjs') return packageOperationContract(args, context)
  if (script === '.claude/scripts/run-git-inspection.mjs') return gitInspectionContract(args, context)
  if (script === '.claude/scripts/read-skill-section.mjs') return skillSectionContract(args)
  if (script === '.claude/scripts/record-verification.mjs') return recordVerificationContract(args, context)
  if (script === '.claude/scripts/preview-server.mjs') return previewServerContract(args, context)
  if (script === '.claude/scripts/validate-design-preview.mjs') return designPreviewValidationContract(args, context)
  if (script === '.claude/scripts/run-eval-executor.mjs') return evalExecutorContract(args)
  if (script === '.claude/scripts/validate-release-gate.mjs') return releaseGateContract(args, context)
  if (script === '.claude/scripts/prepare-quality-attestation.mjs') return attestationRequestContract(args, context)
  if (script === '.claude/scripts/validate-toolchain.mjs') return args.length === 0 || (args.length === 1 && args[0] === '--json')
  if (script === '.claude/scripts/validate-artifact-sharding.mjs') {
    const commandArgs = withoutDirectoryOption(args, '--project', context)
    return args.includes('--project') && (commandArgs.length === 0 || (commandArgs.length === 1 && commandArgs[0] === '--json'))
  }
  if (script === '.claude/scripts/validate-dependency-pins.mjs') {
    const commandArgs = withoutDirectoryOption(args, '--project', context)
    return args.includes('--project') && (commandArgs.length === 0 || (commandArgs.length === 1 && commandArgs[0] === '--json'))
  }
  if (script === '.claude/scripts/validate-ui-lane.mjs') {
    const commandArgs = withoutDirectoryOption(args, '--project', context)
    return args.includes('--project') && (commandArgs.length === 0 || (commandArgs.length === 1 && commandArgs[0] === '--json'))
  }
  if (script === '.claude/scripts/validate-plan-delta.mjs') {
    if (!args.includes('--project') || !args.includes('--change')) return false
    let rest = withoutDirectoryOption(args, '--project', context)
    const ci = rest.indexOf('--change')
    if (ci === -1 || !/^PC-\d+$/.test(rest[ci + 1] ?? '')) return false
    rest = [...rest.slice(0, ci), ...rest.slice(ci + 2)]
    const modes = rest.filter(a => a === '--snapshot' || a === '--verify')
    if (modes.length !== 1) return false
    const extra = rest.filter(a => a !== '--snapshot' && a !== '--verify')
    const allowed = new Set(['--json', '--allow-no-ids'])
    return extra.every(a => allowed.has(a)) && extra.length === new Set(extra).size
  }
  if (script === '.claude/scripts/validate-requirements-notation.mjs') {
    const commandArgs = withoutDirectoryOption(args, '--project', context)
    return args.includes('--project') && (commandArgs.length === 0 || (commandArgs.length === 1 && commandArgs[0] === '--json'))
  }
  if (script === '.claude/scripts/validate-output-language.mjs') {
    const commandArgs = withoutDirectoryOption(args, '--project', context)
    return args.includes('--project') && (commandArgs.length === 0 || (commandArgs.length === 1 && commandArgs[0] === '--json'))
  }
  if (script === '.claude/scripts/validate-spawn-plan.mjs') {
    if (!args.includes('--project') || !args.includes('--plan')) return false
    let rest = withoutDirectoryOption(args, '--project', context)
    const pi = rest.indexOf('--plan')
    if (pi === -1 || !rest[pi + 1]) return false
    readablePath(rest[pi + 1], context, 'file')
    rest = [...rest.slice(0, pi), ...rest.slice(pi + 2)]
    // 남은 것은 --json 과 수치 임계 옵션뿐이어야 한다(각각 최대 1회, 값은 양의 정수).
    // 임계 완화에는 **상한**이 있다 — 상한이 없으면 `--max-outputs 9999999`로 게이트를
    // 스스로 무력화할 수 있고, 그러면 산문 규칙으로 되돌아간 것과 같다(I2). 상한 근거:
    // 산출물 32개면 이미 "계층 전체" 스폰이고, read 200k tokens는 컨텍스트 창 전체라
    // 그 위의 값은 판정 자체가 무의미하다.
    const OVERRIDE_CEILING = {'--max-outputs': 32, '--max-read-tokens': 200_000}
    const seen = new Set()
    for (let i = 0; i < rest.length; i++) {
      const token = rest[i]
      if (token === '--json' || token === '--lock') { if (seen.has(token)) return false; seen.add(token); continue }
      if (token === '--max-outputs' || token === '--max-read-tokens') {
        if (seen.has(token)) return false
        seen.add(token)
        const value = rest[++i]
        if (typeof value !== 'string' || !/^[1-9][0-9]{0,6}$/.test(value)) return false
        if (Number(value) > OVERRIDE_CEILING[token]) return false
        continue
      }
      return false
    }
    return true
  }
  if (script === '.claude/scripts/resume-manifest.mjs') {
    if (!args.includes('--project') || !args.includes('--manifest')) return false
    let rest = withoutDirectoryOption(args, '--project', context)
    const mi = rest.indexOf('--manifest')
    if (mi === -1 || !rest[mi + 1]) return false
    readablePath(rest[mi + 1], context, 'file')
    rest = [...rest.slice(0, mi), ...rest.slice(mi + 2)]
    // --owned <prefix...> 는 읽기 전용 스캔 범위다. 각 prefix는 읽기 가능 경로여야 한다.
    const oi = rest.indexOf('--owned')
    if (oi !== -1) {
      const prefixes = []
      let end = oi + 1
      while (rest[end] && !rest[end].startsWith('--')) { prefixes.push(rest[end]); end++ }
      if (prefixes.length === 0) return false
      for (const prefix of prefixes) readablePath(prefix, context, 'directory')
      rest = [...rest.slice(0, oi), ...rest.slice(end)]
    }
    return rest.length === 0 || (rest.length === 1 && rest[0] === '--json')
  }
  if (script === '.claude/scripts/validators/validate-global-bash-policy.mjs') return args.length === 0
  if (script === '.claude/scripts/web-core/validate-adapters.mjs') return args.length === 0
  if (script === '.claude/scripts/web-core/validate-next-contracts.mjs') {
    return args.length === 0 || withoutDirectoryOption(args, '--project', context).length === 0
  }
  if (script === '.claude/scripts/web-core/test-web-core.mjs') return args.length === 0
  if (script === '.claude/scripts/web-core/resolve-profile.mjs') return resolveProfileContract(args, context)
  if (script === '.claude/scripts/web-core/compile-execution-plan.mjs') return executionPlanContract(args, context)
  return false
}

const validateNodeCommand = (args, context) => {
  if (context.cwd !== context.projectRoot) fail('DENY_CONTEXT', 'Trusted validation commands must run from the project root.')
  if (args.length === 0) fail('DENY_ARGUMENTS', 'node requires an approved validation script.')
  if (args[0] === '--check') {
    if (args.length !== 2 || !['.js', '.mjs', '.cjs'].includes(extname(args[1]))) {
      fail('DENY_ARGUMENTS', 'node --check requires one JavaScript file.')
    }
    readablePath(args[1], context, 'file')
    return
  }
  if (args[0].startsWith('-')) fail('DENY_ARGUMENTS', 'Node runtime options are blocked; use an approved script contract.')
  const script = relative(context.projectRoot, resolve(context.cwd, args[0])).split(sep).join('/')
  if (script.startsWith('../') || script === '..') fail('DENY_PATH_OUTSIDE', 'Validation script is outside the project root.')
  readablePath(args[0], context, 'file')
  if (!validationScriptContract(script, args.slice(1), context)) {
    fail('DENY_VALIDATION_COMMAND', `Node command is not an approved validation contract: ${script}`)
  }
}

export const evaluateGlobalBashPolicy = (input, options = {}) => {
  try {
    if (!input || typeof input !== 'object') fail('DENY_INPUT', 'Hook input must be a JSON object.')
    if (input.tool_name !== 'Bash') return allow('ALLOW_NOT_BASH', 'Policy does not apply to this tool.')
    if (!input.tool_input || typeof input.tool_input !== 'object') fail('DENY_INPUT', 'Bash tool_input must be an object.')
    requireNoUnexpectedToolInput(input.tool_input)
    if (input.tool_input.run_in_background === true) fail('DENY_INPUT', 'Background Bash execution is blocked.')
    const context = createContext(input, options.environment ?? process.env, options.processCwd ?? process.cwd())
    const tokens = tokenizeSimpleCommand(input.tool_input.command)
    const [command, ...args] = tokens

    if (command === 'pnpm') {
      validatePnpmCommand(args, context)
      return allow('ALLOW_PNPM_SCRIPT', `pnpm script execution allowed: ${args.join(' ')}`)
    }
    if (NETWORK_COMMANDS.has(command)) fail('DENY_NETWORK', `Network, remote, package-manager, and VCS command is blocked: ${command}`)
    if (command === 'mkdir') {
      validateWorkspaceMkdir(args, context)
      return allow('ALLOW_WORKSPACE_INIT', 'Deterministic workspace directory initialization allowed.')
    }
    if (DESTRUCTIVE_COMMANDS.has(command)) fail('DENY_DESTRUCTIVE', `Mutating or destructive command is blocked: ${command}`)
    if (READ_COMMANDS.has(command)) {
      validateReadCommand(command, args, context)
      return allow('ALLOW_BOUNDED_READ', `Bounded read command allowed: ${command}`)
    }
    if (command === 'node') {
      validateNodeCommand(args, context)
      return allow('ALLOW_VALIDATION', 'Approved deterministic validation command allowed.')
    }
    if (command === 'web-harness-script') {
      // 플러그인 배포판 dispatcher — `node .claude/scripts/<name>.mjs`와 같은 인자 계약을
      // 적용한다. 스크립트 존재는 dispatcher가 payload 안에서 자체 검증하므로 여기서는
      // 이름 형식과 validation contract만 판정한다.
      if (context.cwd !== context.projectRoot) fail('DENY_CONTEXT', 'Trusted validation commands must run from the project root.')
      const [scriptName, ...scriptArgs] = args
      if (!scriptName || scriptName.includes('..') || !/^[a-z0-9][a-z0-9/-]*$/.test(scriptName)) {
        fail('DENY_ARGUMENTS', 'web-harness-script requires a valid script name.')
      }
      if (!validationScriptContract(`.claude/scripts/${scriptName}.mjs`, scriptArgs, context)) {
        fail('DENY_VALIDATION_COMMAND', `web-harness-script target is not an approved validation contract: ${scriptName}`)
      }
      return allow('ALLOW_VALIDATION', 'Approved plugin dispatcher validation command allowed.')
    }
    if (command === 'web-harness-read') {
      if (args.length !== 1 || typeof args[0] !== 'string' || args[0].includes('..') || !/^[A-Za-z0-9._/-]+$/.test(args[0])) {
        fail('DENY_ARGUMENTS', 'web-harness-read requires a single bounded plugin-relative path.')
      }
      return allow('ALLOW_BOUNDED_READ', 'Bounded plugin document read allowed.')
    }
    fail('DENY_COMMAND', `Command is not allowlisted: ${command}`)
  } catch (error) {
    if (error instanceof PolicyError) return deny(error.code, error.message)
    return deny('DENY_POLICY_ERROR', `Policy evaluation failed closed: ${error instanceof Error ? error.message : String(error)}`)
  }
}
