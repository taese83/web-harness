import {
  accessSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
} from 'node:fs'
import {createHash} from 'node:crypto'
import {delimiter, dirname, isAbsolute, join, relative, resolve, sep} from 'node:path'
import {sha256} from './evidence-lib.mjs'

const PACKAGE_EXECUTABLES = new Set([
  'cypress', 'eslint', 'jest', 'knip', 'next', 'playwright', 'stylelint', 'tsc', 'tsx', 'turbo', 'vite', 'vitest',
])
const SYSTEM_EXECUTABLES = new Set(['docker', 'node'])
const SAFE_EXECUTABLES = new Set([...PACKAGE_EXECUTABLES, ...SYSTEM_EXECUTABLES])
const SAFE_ASSIGNMENT = /^(?:CI|COLORTERM|FORCE_COLOR|LANG|LC_ALL|NODE_ENV|NEXT_TELEMETRY_DISABLED|NO_COLOR|TZ|NEXT_PUBLIC_[A-Z0-9_]+|PUBLIC_[A-Z0-9_]+|VITE_[A-Z0-9_]+)$/
const ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s
const SIMPLE_EXECUTABLE = /^[a-z][a-z0-9-]*$/
const MAX_DEPENDENCY_FILES = 300_000
const MAX_DEPENDENCY_FILE_BYTES = 512 * 1024 * 1024
const MAX_DEPENDENCY_BYTES = 4 * 1024 * 1024 * 1024
const fileDigestCache = new Map()

const normalizedExecutable = source => source.replace(/\.(?:cmd|exe)$/i, '').toLowerCase()
const parseError = error => ({ok: false, error, commands: [], executionCommands: []})

// ── pnpm 위임 ────────────────────────────────────────────────────────────────
// 모노레포 루트 script는 멤버에 위임한다(`pnpm --filter <pkg> build`, `pnpm run type-check`). 러너는 pnpm을 실행하지 않고
// 위임을 정적으로 풀어 "패키지 디렉터리 + 명령"으로 펼친다 — 펼친 명령은 루트 명령과 같은 argv 계약을 통과해야 한다.
// 형태는 둘뿐이다: `pnpm run <script>`(같은 패키지), `pnpm --filter|-F <정확한 멤버 이름> [run] <script>`. 추가 인자·
// selector 문법(glob·`...`·경로)·재귀 실행·pre/post 스크립트는 거부한다 — pnpm이 실제로 할 일과 달라질 수 있는 형태다.
// `run` 없이 쓴 이름이 이 목록에 있으면 pnpm은 script가 아니라 내장 명령(또는 그 별칭)을 돈다 — pnpm 10·11의 명령·별칭
// 스냅샷이다. 목록에 없는 새 내장 명령은 §4 등록부의 한계이고, `run`을 명시한 위임은 이 목록과 무관하다.
const PNPM_BUILTIN_COMMANDS = new Set(['add', 'approve-builds', 'audit', 'bin', 'c', 'cache', 'cat-file', 'cat-index', 'catalog',
  'completion', 'config', 'create', 'dedupe', 'deploy', 'deprecate', 'dist-tag', 'dlx', 'docs', 'doctor', 'env', 'exec', 'fetch',
  'find-hash', 'help', 'i', 'ignored-builds', 'import', 'info', 'init', 'install', 'install-test', 'it', 'licenses', 'link', 'list', 'ln',
  'login', 'logout', 'ls', 'm', 'multi', 'outdated', 'owner', 'pack', 'patch', 'patch-commit', 'patch-remove', 'prune', 'publish', 'rb',
  'rebuild', 'recursive', 'remove', 'repo', 'restart', 'rm', 'root', 'sbom', 'search', 'self-update', 'server', 'setup', 'store', 't', 'tst',
  'un', 'uninstall', 'unlink', 'unpublish', 'up', 'update', 'upgrade', 'version', 'view', 'whoami', 'why'])
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/
const SCRIPT_NAME = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/
const MAX_DELEGATION_DEPTH = 8
const MAX_MANIFEST_BYTES = 1024 * 1024

const readManifest = (projectRoot, packageDirectory) => {
  const path = join(projectRoot, packageDirectory, 'package.json')
  const stats = lstatSync(path)
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error(`package manifest must be a regular file: ${packageDirectory}/package.json`)
  if (stats.size > MAX_MANIFEST_BYTES) throw new Error(`package manifest is too large: ${packageDirectory}/package.json`)
  return JSON.parse(readFileSync(path, 'utf8'))
}

/**
 * 프로젝트 루트의 pnpm-workspace.yaml이 선언한 멤버(`dir`·`dir/*` 항목만). 멤버는 심링크가 아닌 디렉터리와 정규 package.json을
 * 가져야 하고, 이름이 겹치면 거부한다(위임 대상이 모호하다).
 * @returns {Array<{directory: string, name: string|null}>}
 */
export const listWorkspaceMembers = projectRoot => {
  const manifestPath = join(projectRoot, 'pnpm-workspace.yaml')
  if (!existsSync(manifestPath) || !lstatSync(manifestPath).isFile()) return []
  const directories = new Set()
  // 최상위 `packages:` 블록의 목록 항목만 읽는다 — 다른 키(onlyBuiltDependencies 등)의 항목은 멤버가 아니다.
  const lines = readFileSync(manifestPath, 'utf8').split(/\r?\n/)
  const start = lines.findIndex(line => /^packages\s*:\s*(?:#.*)?$/.test(line))
  const block = []
  for (const line of start < 0 ? [] : lines.slice(start + 1)) {
    if (/^\S/.test(line) && !line.startsWith('#')) break
    block.push(line)
  }
  for (const [, glob] of block.join('\n').matchAll(/^\s*-\s*['"]?([^'"\s#!][^'"\s#]*)['"]?\s*$/gm)) {
    const starred = glob.endsWith('/*')
    const base = glob.replace(/\/\*$/, '').replace(/^\.\//, '')
    if (base.includes('*') || base.split('/').some(segment => segment === '..' || segment === '')) continue
    // 보호 경로(하네스 기록·제어면·VCS·설치 트리)는 멤버가 될 수 없다.
    if (['.git', '.claude', '_workspace', 'node_modules'].includes(base.split('/')[0])) continue
    const baseStats = existsSync(join(projectRoot, base)) ? lstatSync(join(projectRoot, base)) : null
    if (!baseStats?.isDirectory() || baseStats.isSymbolicLink()) continue
    const candidates = starred
      ? readdirSync(join(projectRoot, base), {withFileTypes: true}).filter(entry => entry.isDirectory() && !entry.isSymbolicLink()).map(entry => `${base}/${entry.name}`)
      : [base]
    for (const candidate of candidates) {
      const manifest = join(projectRoot, candidate, 'package.json')
      if (existsSync(manifest) && lstatSync(manifest).isFile()) directories.add(candidate)
    }
  }
  const members = [...directories].sort().map(directory => {
    const name = readManifest(projectRoot, directory).name
    return {directory, name: typeof name === 'string' ? name : null}
  })
  const names = members.map(member => member.name).filter(Boolean)
  if (new Set(names).size !== names.length) throw new Error('workspace members declare duplicate package names')
  return members
}

const resolvePnpmDelegation = (args, context) => {
  let selector = null
  let rest = args
  if (rest[0] === '--filter' || rest[0] === '-F') {
    selector = rest[1] ?? ''
    rest = rest.slice(2)
  } else if (rest[0]?.startsWith('--filter=')) {
    selector = rest[0].slice('--filter='.length)
    rest = rest.slice(1)
  }
  const explicitRun = rest[0] === 'run'
  if (explicitRun) rest = rest.slice(1)
  else if (selector === null) throw new Error('pnpm delegation must be `pnpm run <script>` or `pnpm --filter <package> [run] <script>`')
  if (rest.length !== 1 || !SCRIPT_NAME.test(rest[0])) throw new Error('pnpm delegation takes exactly one script name and no other arguments')
  const script = rest[0]
  if (!explicitRun && PNPM_BUILTIN_COMMANDS.has(script)) throw new Error(`pnpm shorthand names a pnpm command, not a script: ${script}`)
  let packageDirectory = context.packageDirectory
  if (selector !== null) {
    if (!PACKAGE_NAME.test(selector)) throw new Error(`pnpm --filter must name exactly one workspace package: ${selector}`)
    const member = listWorkspaceMembers(context.projectRoot).find(candidate => candidate.name === selector)
    if (!member) throw new Error(`pnpm --filter target is not a workspace member: ${selector}`)
    packageDirectory = member.directory
  }
  const key = `${packageDirectory}#${script}`
  if (context.stack.includes(key)) throw new Error(`pnpm delegation cycle: ${[...context.stack, key].join(' -> ')}`)
  if (context.stack.length >= MAX_DELEGATION_DEPTH) throw new Error('pnpm delegation is nested too deeply')
  const scripts = readManifest(context.projectRoot, packageDirectory).scripts ?? {}
  const source = scripts[script]
  if (typeof source !== 'string') throw new Error(`pnpm delegation target script is missing: ${packageDirectory}#${script}`)
  if (typeof scripts[`pre${script}`] === 'string' || typeof scripts[`post${script}`] === 'string') {
    throw new Error(`pnpm delegation target has pre/post lifecycle scripts the runner would not replay: ${packageDirectory}#${script}`)
  }
  return analyzePackageScript(source, {...context, packageDirectory, stack: [...context.stack, key]})
}

/**
 * package script를 argv 명령 목록으로 분석한다. `context.projectRoot`를 주면 pnpm 위임을 풀어 펼친다 — 주지 않으면
 * pnpm은 허용 실행 파일이 아니다. 멤버에서 실행될 명령은 `cwd`(프로젝트 기준 상대 경로)를 가진다.
 */
export const analyzePackageScript = (source, context = null) => {
  if (typeof source !== 'string' || source.trim() === '') return parseError('package script is empty')
  const commandTokens = []
  let tokens = []
  let token = ''
  let tokenStarted = false
  let quote = null
  let escaped = false
  const pushToken = () => {
    if (!tokenStarted) return
    tokens.push(token)
    token = ''
    tokenStarted = false
  }
  const pushCommand = () => {
    pushToken()
    if (tokens.length === 0) throw new Error('empty command segment is not allowed')
    commandTokens.push(tokens)
    tokens = []
  }

  try {
    for (let index = 0; index < source.length; index += 1) {
      const character = source[index]
      if (escaped) {
        if (character === '\n' || character === '\r') throw new Error('line continuations are not allowed')
        token += character
        tokenStarted = true
        escaped = false
        continue
      }
      if (quote) {
        if (character === quote) {
          quote = null
          tokenStarted = true
        } else if (character === '\\' && quote === '"') {
          escaped = true
        } else if ((character === '$' || character === '`') && quote === '"') {
          throw new Error('shell expansion is not allowed')
        } else {
          token += character
          tokenStarted = true
        }
        continue
      }
      if (character === "'" || character === '"') {
        quote = character
        tokenStarted = true
        continue
      }
      if (character === '\\') {
        escaped = true
        tokenStarted = true
        continue
      }
      if (/\s/.test(character)) {
        if (character === '\n' || character === '\r') throw new Error('multiple shell statements are not allowed')
        pushToken()
        continue
      }
      if (character === '&' && source[index + 1] === '&') {
        pushCommand()
        index += 1
        continue
      }
      if (';&|<>`$(){}*?[]~%^!'.includes(character) || (character === '#' && !tokenStarted)) {
        throw new Error(`unsupported shell syntax: ${character}`)
      }
      token += character
      tokenStarted = true
    }
    if (quote) throw new Error('unterminated quote')
    if (escaped) throw new Error('unterminated escape')
    pushCommand()
  } catch (error) {
    return parseError(error instanceof Error ? error.message : String(error))
  }

  const commands = []
  const executionCommands = []
  for (const segment of commandTokens) {
    const assignments = []
    const executionAssignments = []
    let executableIndex = 0
    while (executableIndex < segment.length) {
      const match = segment[executableIndex].match(ASSIGNMENT)
      if (!match) break
      if (!SAFE_ASSIGNMENT.test(match[1])) return parseError(`unsafe environment assignment: ${match[1]}`)
      assignments.push({name: match[1], valueSha256: sha256(match[2])})
      executionAssignments.push({name: match[1], value: match[2]})
      executableIndex += 1
    }
    if (executableIndex >= segment.length) return parseError('environment assignments must be followed by an executable')
    const executable = normalizedExecutable(segment[executableIndex])
    const args = segment.slice(executableIndex + 1)
    if (executable === 'pnpm' && context?.projectRoot) {
      if (assignments.length > 0) return parseError('environment assignments cannot prefix a pnpm delegation')
      let delegated
      try {
        delegated = resolvePnpmDelegation(args, {packageDirectory: '.', stack: [], ...context})
      } catch (error) {
        return parseError(error instanceof Error ? error.message : String(error))
      }
      if (!delegated.ok) return delegated
      commands.push(...delegated.commands)
      executionCommands.push(...delegated.executionCommands)
      continue
    }
    if (!SIMPLE_EXECUTABLE.test(executable) || !SAFE_EXECUTABLES.has(executable)) {
      return parseError(`package script executable is not allowed: ${segment[executableIndex]}`)
    }
    // 루트 명령은 cwd를 싣지 않는다 — 위임이 없는 script의 명령 계약 digest는 그대로다.
    const cwd = context?.packageDirectory && context.packageDirectory !== '.' ? {cwd: context.packageDirectory} : {}
    commands.push({executable, args, assignments, ...cwd})
    executionCommands.push({executable, args, assignments: executionAssignments, ...cwd})
  }
  return {ok: true, error: null, commands, executionCommands}
}

const hasAny = (args, denied) => args.some(argument => denied.has(argument))
const turboTask = args => args[0] === 'run' ? args[1] : args[0]
const isTsc = command => command.executable === 'tsc' && !hasAny(command.args, new Set(['--help', '-h', '--init', '--showConfig', '--version', '-v']))
const isEslint = command => command.executable === 'eslint' &&
  command.args.some(argument => !argument.startsWith('-')) &&
  !hasAny(command.args, new Set(['--help', '-h', '--print-config', '--version', '-v']))
// stylelint는 eslint와 같은 등급이다(설정이 플러그인 코드를 불러온다) — lint에서 eslint 곁에서만 의미 있는 검사로 센다.
const isStylelint = command => command.executable === 'stylelint' &&
  command.args.some(argument => !argument.startsWith('-')) &&
  !hasAny(command.args, new Set(['--help', '-h', '--print-config', '--version', '-v']))
const isUnit = command =>
  (command.executable === 'vitest' && command.args[0] === 'run' && !command.args.includes('--passWithNoTests')) ||
  (command.executable === 'jest' && !hasAny(command.args, new Set(['--help', '--listTests', '--passWithNoTests', '--version']))) ||
  (command.executable === 'node' && command.args.includes('--test')) ||
  (command.executable === 'turbo' && turboTask(command.args) === 'test')
const isBrowser = command =>
  (command.executable === 'playwright' &&
    command.args[0] === 'test' &&
    !hasAny(command.args, new Set(['--help', '--list', '--update-snapshots', '--version', '-u'])) &&
    !command.args.some(argument => argument.startsWith('--update-snapshots='))) ||
  (command.executable === 'cypress' && command.args[0] === 'run') ||
  (command.executable === 'turbo' && turboTask(command.args) === 'test:e2e')
const isNodeFile = command => {
  if (!['node', 'tsx'].includes(command.executable)) return false
  if (hasAny(command.args, new Set(['-e', '--eval', '-p', '--print']))) return false
  return command.args.some(argument => !argument.startsWith('-') && /\.(?:c?js|mjs|c?ts|mts|tsx)$/.test(argument))
}
const allCommandsMatch = (commands, predicate) => commands.length > 0 && commands.every(predicate)

export const hasMeaningfulProfileScript = (id, definition, source, suppliedAnalysis = null) => {
  const analysis = suppliedAnalysis ?? analyzePackageScript(source)
  if (!analysis.ok) return false
  const {commands} = analysis
  if (id === 'quality.lint') {
    const isEslintLint = command => isEslint(command) || (command.executable === 'turbo' && turboTask(command.args) === 'lint')
    return commands.some(isEslintLint) && allCommandsMatch(commands, command => isEslintLint(command) || isStylelint(command))
  }
  if (id === 'quality.typecheck') {
    return allCommandsMatch(commands, command => isTsc(command) || (command.executable === 'turbo' && turboTask(command.args) === 'typecheck'))
  }
  if (id === 'quality.unit') return allCommandsMatch(commands, isUnit)
  // 진단은 읽기 전용이어야 한다 — knip --fix 계열은 파일을 지우고 package.json 의존성을 뺀다.
  if (id === 'deadcode') {
    return allCommandsMatch(commands, command => command.executable === 'knip' &&
      !command.args.some(arg => /^--(?:fix|fix-type|allow-remove-files|format)(?:=|$)/.test(arg)))
  }
  if (id === 'vite.build') {
    return commands.some(command => command.executable === 'vite' && command.args[0] === 'build') &&
      allCommandsMatch(commands, command => isTsc(command) || (command.executable === 'vite' && command.args[0] === 'build')) ||
      allCommandsMatch(commands, command => command.executable === 'turbo' && turboTask(command.args) === 'build')
  }
  if (id === 'next.build') {
    return commands.some(command => command.executable === 'next' && command.args[0] === 'build') &&
      allCommandsMatch(commands, command => isTsc(command) || (command.executable === 'next' && command.args[0] === 'build')) ||
      allCommandsMatch(commands, command => command.executable === 'turbo' && turboTask(command.args) === 'build')
  }
  if (id === 'vite.browser' || definition.kind === 'browser') return allCommandsMatch(commands, isBrowser)
  if (id === 'vite.production-mock-boundary') {
    return allCommandsMatch(commands, command => isUnit(command) || isBrowser(command))
  }
  if (['artifact', 'contract', 'runtime', 'security'].includes(definition.kind)) {
    return allCommandsMatch(commands, command => isUnit(command) || isBrowser(command) || isNodeFile(command) || command.executable === 'docker')
  }
  return commands.length > 0
}

export const cleanProfileBuildArtifacts = (projectRoot, artifacts) => {
  const selected = []
  for (const declaration of [...artifacts].sort((left, right) => left.path.length - right.path.length)) {
    const normalized = declaration.path.replaceAll('\\', '/').replace(/\/$/, '')
    if (selected.some(parent => normalized === parent || normalized.startsWith(`${parent}/`))) continue
    const absolute = resolve(projectRoot, normalized)
    const offset = relative(projectRoot, absolute)
    if (offset === '..' || offset.startsWith(`..${sep}`)) throw new Error(`Build artifact escapes project: ${normalized}`)
    if (existsSync(absolute)) {
      if (!lstatSync(absolute).isDirectory()) throw new Error(`Build artifact is not a directory: ${normalized}`)
      rmSync(absolute, {recursive: true, force: true})
    }
    selected.push(normalized)
  }
  return selected
}

const statIdentity = stats => [stats.dev, stats.ino, stats.mode, stats.size, stats.mtimeNs, stats.ctimeNs].join(':')
const cachedFileSha256 = (path, stats) => {
  const identity = statIdentity(stats)
  const cached = fileDigestCache.get(path)
  if (cached?.identity === identity) return cached.sha256
  if (stats.size > BigInt(MAX_DEPENDENCY_FILE_BYTES)) {
    throw new Error(`installed dependency file exceeds 512 MiB: ${path}`)
  }
  const descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  const hash = createHash('sha256')
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  try {
    const current = fstatSync(descriptor, {bigint: true})
    if (!current.isFile() || statIdentity(current) !== identity) {
      throw new Error(`installed dependency changed during hashing: ${path}`)
    }
    for (;;) {
      const bytesRead = readSync(descriptor, buffer, 0, buffer.length, null)
      if (bytesRead === 0) break
      hash.update(buffer.subarray(0, bytesRead))
    }
  } finally {
    closeSync(descriptor)
  }
  const digest = hash.digest('hex')
  fileDigestCache.set(path, {identity, sha256: digest})
  return digest
}
const updateDigest = (hash, values) => {
  for (const value of values) {
    hash.update(String(value))
    hash.update('\0')
  }
}

function canonicalPath(path) {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}
function within(root, path) {
  const offset = relative(canonicalPath(root), canonicalPath(path))
  return offset === '' || (offset !== '..' && !offset.startsWith(`..${sep}`) && !isAbsolute(offset))
}
const protectedDependencyTarget = (projectRoot, target) => {
  const offset = relative(canonicalPath(projectRoot), canonicalPath(target)).split(sep).join('/')
  if (offset === '..' || offset.startsWith('../') || isAbsolute(offset)) return true
  const segments = offset.split('/')
  return ['.git', '.claude', '_workspace'].includes(segments[0]) ||
    segments.some(segment => /^\.env(?:\..*)?$/.test(segment) || [
      '.npmrc', '.pypirc', '.netrc', 'credentials', 'id_rsa', 'id_ed25519',
    ].includes(segment))
}

// `storeRoot`를 주면 워크스페이스 멤버의 node_modules를 읽는다 — 멤버의 최상위 링크는 루트 가상 저장소를 가리키고,
// 저장소 밖 워크스페이스 안을 가리키는 링크(멤버끼리의 workspace: 의존)는 실행 파일 공급자로 보지 않고 건너뛴다.
const installedPackageGraph = (projectRoot, {storeRoot = null} = {}) => {
  const dependencyRoot = join(projectRoot, 'node_modules')
  const virtualStoreRoot = storeRoot ?? join(dependencyRoot, '.pnpm')
  const workspaceRoot = storeRoot ? dirname(dirname(storeRoot)) : null
  if (!existsSync(dependencyRoot) || !existsSync(virtualStoreRoot)) return null
  if (!lstatSync(dependencyRoot).isDirectory() || lstatSync(dependencyRoot).isSymbolicLink()) {
    throw new Error('node_modules must be a real directory')
  }
  if (!lstatSync(virtualStoreRoot).isDirectory() || lstatSync(virtualStoreRoot).isSymbolicLink()) {
    throw new Error('node_modules/.pnpm must be a real directory')
  }

  const packages = []
  const binaryOwnerCandidates = new Map()
  const addBinaryOwner = (binaryName, owner) => {
    const candidates = binaryOwnerCandidates.get(binaryName) ?? []
    const existing = candidates.find(candidate => candidate.path === owner.path)
    if (existing) {
      existing.wrapperAliases = [...new Set([...existing.wrapperAliases, ...owner.wrapperAliases])]
    } else {
      candidates.push(owner)
    }
    binaryOwnerCandidates.set(binaryName, candidates)
  }
  const readPackageManifest = (name, packageRoot) => {
    const manifestPath = join(packageRoot, 'package.json')
    if (!existsSync(manifestPath) || !lstatSync(manifestPath).isFile()) {
      throw new Error(`installed package manifest is missing: ${name}`)
    }
    const source = readFileSync(manifestPath)
    if (source.length > 2 * 1024 * 1024) throw new Error(`installed package manifest is too large: ${name}`)
    let manifest
    try {
      manifest = JSON.parse(source.toString('utf8'))
    } catch {
      throw new Error(`installed package manifest is invalid: ${name}`)
    }
    return {manifest, source}
  }
  const registerBins = (name, packageRoot, manifest, {linkPath = null} = {}) => {
    const declaredBins = typeof manifest.bin === 'string'
      ? {[name.split('/').at(-1)]: manifest.bin}
      : manifest.bin && typeof manifest.bin === 'object' && !Array.isArray(manifest.bin)
        ? manifest.bin
        : {}
    const bins = []
    for (const [binaryName, relativeTarget] of Object.entries(declaredBins).sort(([left], [right]) => left.localeCompare(right))) {
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(binaryName) || typeof relativeTarget !== 'string') {
        throw new Error(`installed package declares an unsafe binary: ${name}`)
      }
      const target = resolve(packageRoot, relativeTarget)
      if (!within(packageRoot, target) || !existsSync(target)) {
        throw new Error(`installed package binary escapes or is missing: ${name}/${binaryName}`)
      }
      const canonicalTarget = realpathSync(target)
      const targetStats = lstatSync(canonicalTarget, {bigint: true})
      if (!targetStats.isFile()) throw new Error(`installed package binary is not a regular file: ${name}/${binaryName}`)
      const owner = {
        path: canonicalTarget,
        packageName: name,
        packageVersion: manifest.version,
        wrapperAliases: linkPath ? [resolve(linkPath, relativeTarget)] : [],
      }
      addBinaryOwner(binaryName, owner)
      bins.push({
        name: binaryName,
        path: relative(dependencyRoot, canonicalTarget).split(sep).join('/'),
        contentSha256: cachedFileSha256(canonicalTarget, targetStats),
      })
    }
    return bins
  }
  const registerPackage = (name, linkPath) => {
    const stats = lstatSync(linkPath)
    if (!stats.isSymbolicLink()) throw new Error(`top-level installed package must be a pnpm virtual-store symlink: ${name}`)
    const rawTarget = readlinkSync(linkPath)
    const resolvedTarget = realpathSync(linkPath)
    if (workspaceRoot && !within(virtualStoreRoot, resolvedTarget) && within(workspaceRoot, resolvedTarget) &&
      !within(dependencyRoot, resolvedTarget)) return
    const targetClass = within(virtualStoreRoot, resolvedTarget) ? 'virtual-store' : null
    if (!targetClass) throw new Error(`top-level installed package must target the pnpm virtual-store graph: ${name}`)
    const {manifest, source: manifestSource} = readPackageManifest(name, resolvedTarget)
    if (manifest.name !== name || typeof manifest.version !== 'string' || !manifest.version) {
      throw new Error(`installed package identity does not match its top-level link: ${name}`)
    }
    const bins = registerBins(name, resolvedTarget, manifest, {linkPath})
    packages.push({
      name,
      version: manifest.version,
      targetClass,
      rawTarget,
      resolvedTarget: relative(virtualStoreRoot, resolvedTarget).split(sep).join('/'),
      packageJsonSha256: sha256(manifestSource),
      bins,
    })
  }

  const rootEntries = readdirSync(dependencyRoot, {withFileTypes: true})
    .sort((left, right) => left.name.localeCompare(right.name))
  for (const entry of rootEntries) {
    if (entry.name === '.pnpm' || entry.name === '.bin' || entry.name.startsWith('.')) continue
    const entryPath = join(dependencyRoot, entry.name)
    if (entry.name.startsWith('@')) {
      const scopeStats = lstatSync(entryPath)
      if (!scopeStats.isDirectory() || scopeStats.isSymbolicLink()) {
        throw new Error(`installed package scope must be a real directory: ${entry.name}`)
      }
      for (const child of readdirSync(entryPath, {withFileTypes: true}).sort((left, right) => left.name.localeCompare(right.name))) {
        registerPackage(`${entry.name}/${child.name}`, join(entryPath, child.name))
      }
    } else {
      registerPackage(entry.name, entryPath)
    }
  }

  for (const storeEntry of readdirSync(virtualStoreRoot, {withFileTypes: true})) {
    if (!storeEntry.isDirectory() || storeEntry.isSymbolicLink()) continue
    const storeNodeModules = join(virtualStoreRoot, storeEntry.name, 'node_modules')
    if (!existsSync(storeNodeModules) || !lstatSync(storeNodeModules).isDirectory()) continue
    for (const entry of readdirSync(storeNodeModules, {withFileTypes: true})) {
      const entryPath = join(storeNodeModules, entry.name)
      if (entry.name.startsWith('@') && entry.isDirectory() && !entry.isSymbolicLink()) {
        for (const child of readdirSync(entryPath, {withFileTypes: true})) {
          if (!child.isDirectory() || child.isSymbolicLink()) continue
          const packageRoot = join(entryPath, child.name)
          const {manifest} = readPackageManifest(`${entry.name}/${child.name}`, packageRoot)
          if (manifest.name === `${entry.name}/${child.name}` && typeof manifest.version === 'string') {
            registerBins(manifest.name, packageRoot, manifest)
          }
        }
      } else if (entry.isDirectory() && !entry.isSymbolicLink()) {
        const {manifest} = readPackageManifest(entry.name, entryPath)
        if (manifest.name === entry.name && typeof manifest.version === 'string') {
          registerBins(manifest.name, entryPath, manifest)
        }
      }
    }
  }

  const binEntries = []
  const binaryOwners = new Map()
  const binRoot = join(dependencyRoot, '.bin')
  if (existsSync(binRoot)) {
    const binRootStats = lstatSync(binRoot)
    if (!binRootStats.isDirectory() || binRootStats.isSymbolicLink()) {
      throw new Error('node_modules/.bin must be a real directory')
    }
    for (const entry of readdirSync(binRoot, {withFileTypes: true}).sort((left, right) => left.name.localeCompare(right.name))) {
      const normalizedName = entry.name.replace(/\.(?:cmd|ps1)$/i, '')
      const candidates = binaryOwnerCandidates.get(normalizedName) ?? []
      if (candidates.length === 0) throw new Error(`node_modules/.bin entry has no installed package owner: ${entry.name}`)
      const path = join(binRoot, entry.name)
      const stats = lstatSync(path, {bigint: true})
      let owner
      if (stats.isSymbolicLink()) {
        const resolvedTarget = realpathSync(path)
        owner = candidates.find(candidate => candidate.path === resolvedTarget)
        if (!owner) throw new Error(`node_modules/.bin symlink does not match package bin: ${entry.name}`)
        binEntries.push({name: entry.name, type: 'symlink', rawTarget: readlinkSync(path), owner: owner.packageName})
      } else if (stats.isFile()) {
        if (process.platform !== 'win32' && (stats.mode & 0o111n) === 0n) {
          throw new Error(`node_modules/.bin wrapper is not executable: ${entry.name}`)
        }
        if (stats.size > 64n * 1024n) throw new Error(`node_modules/.bin wrapper is too large: ${entry.name}`)
        const source = readFileSync(path, 'utf8')
        const matchedOwners = candidates.filter(candidate => {
          const targets = [candidate.path, ...candidate.wrapperAliases]
          return targets.some(target => {
            const relativeTarget = relative(binRoot, target).split(sep).join('/')
            return source.includes(relativeTarget) || source.includes(target.split(sep).join('/'))
          })
        })
        if (matchedOwners.length !== 1) {
          throw new Error(`node_modules/.bin wrapper provenance is ambiguous or missing: ${entry.name}`)
        }
        owner = matchedOwners[0]
        binEntries.push({
          name: entry.name,
          type: 'wrapper',
          owner: owner.packageName,
          contentSha256: cachedFileSha256(path, stats),
        })
      } else {
        throw new Error(`unsupported node_modules/.bin entry: ${entry.name}`)
      }
      const existingOwner = binaryOwners.get(normalizedName)
      if (existingOwner && existingOwner.path !== owner.path) {
        throw new Error(`node_modules/.bin platform shims disagree on package owner: ${normalizedName}`)
      }
      binaryOwners.set(normalizedName, owner)
    }
  }

  return {
    dependencyRoot,
    virtualStoreRoot,
    packages: packages.sort((left, right) => left.name.localeCompare(right.name)),
    binEntries,
    binaryOwners,
  }
}

// node_modules 최상위의 도구 스크래치 디렉토리 — 의존성 그래프가 아니라 빌드 도구의
// 휘발성 작업 공간이다. vite는 TS config를 .vite-temp에 번들했다 지우므로(생성·삭제로
// 디렉토리 mtime이 영구히 변함) 이를 바인딩에 포함하면 모든 vite 계열 quality run이
// 거짓 "dependency graph changed"로 FAIL한다 (hybrid-api-probe E2E 실측). 정확한 이름의
// 최상위 항목만 제외한다 — 패키지 디렉토리는 계속 전수 해시된다.
const INSTALLED_SCRATCH_DIRECTORIES = new Set(['.cache', '.vite', '.vite-temp', '.vitest'])

const dependencyInventory = projectRoot => {
  const graph = installedPackageGraph(projectRoot)
  if (!graph) return null
  const {dependencyRoot, packages, binEntries} = graph
  // pnpm 워크스페이스는 멤버를 가상 저장소에 링크한다(`.pnpm/node_modules/<멤버>` → 멤버 디렉터리). 선언된 멤버를 정확히
  // 가리키는 링크만 받고 따라 들어가지 않는다 — 멤버 내용은 소스 지문의 몫이다.
  const workspaceMemberRoots = new Set(listWorkspaceMembers(projectRoot).map(member => realpathSync(join(projectRoot, member.directory))))
  const content = createHash('sha256')
  const metadata = createHash('sha256')
  const pending = [dependencyRoot]
  let fileCount = 0
  let totalBytes = 0
  while (pending.length > 0) {
    const directory = pending.pop()
    const atDependencyRoot = directory === dependencyRoot
    const entries = readdirSync(directory, {withFileTypes: true})
      .sort((left, right) => left.name.localeCompare(right.name))
      .filter(entry => !(atDependencyRoot && entry.isDirectory() && INSTALLED_SCRATCH_DIRECTORIES.has(entry.name)))
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index]
      const absolute = join(directory, entry.name)
      const path = relative(dependencyRoot, absolute).split(sep).join('/')
      const stats = lstatSync(absolute, {bigint: true})
      const type = stats.isDirectory() ? 'directory' : stats.isFile() ? 'file' : stats.isSymbolicLink() ? 'symlink' : 'unsupported'
      updateDigest(metadata, [path, type, stats.mode, stats.size, stats.mtimeNs, stats.ctimeNs, stats.dev, stats.ino])
      if (type === 'directory') {
        updateDigest(content, [path, type, stats.mode])
        pending.push(absolute)
      } else if (type === 'file') {
        fileCount += 1
        totalBytes += Number(stats.size)
        if (fileCount > MAX_DEPENDENCY_FILES || totalBytes > MAX_DEPENDENCY_BYTES) {
          throw new Error('installed dependency inventory exceeds the quality binding budget')
        }
        updateDigest(content, [path, type, stats.mode, stats.size, cachedFileSha256(absolute, stats)])
      } else if (type === 'symlink') {
        fileCount += 1
        const linkTarget = readlinkSync(absolute)
        const resolvedTarget = realpathSync(absolute)
        if (!within(dependencyRoot, resolvedTarget)) {
          if (!workspaceMemberRoots.has(resolvedTarget)) throw new Error(`installed dependency symlink escapes node_modules: ${path}`)
          updateDigest(content, [path, 'workspace-link', linkTarget, relative(projectRoot, resolvedTarget)])
          continue
        }
        if (protectedDependencyTarget(projectRoot, resolvedTarget)) {
          throw new Error(`installed dependency symlink targets a protected project path: ${path}`)
        }
        updateDigest(content, [path, type, linkTarget, relative(projectRoot, resolvedTarget)])
      } else {
        throw new Error(`unsupported installed dependency entry: ${path}`)
      }
    }
  }
  return {
    installedDependencyContentSha256: content.digest('hex'),
    installedDependencyMetadataSha256: metadata.digest('hex'),
    installedDependencyFileCount: fileCount,
    installedDependencyBytes: totalBytes,
    effectivePackageGraphSha256: sha256(JSON.stringify(packages)),
    effectiveBinGraphSha256: sha256(JSON.stringify(binEntries)),
  }
}

export const readDependencyBinding = (projectRoot, packageJson) => {
  const dependencyCount = Object.keys({
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
    ...packageJson.optionalDependencies,
    ...packageJson.peerDependencies,
  }).length
  const empty = {
    lockfileSha256: null,
    installedLockfileSha256: null,
    installedDependencyContentSha256: null,
    installedDependencyMetadataSha256: null,
    installedDependencyFileCount: 0,
    installedDependencyBytes: 0,
    effectivePackageGraphSha256: null,
    effectiveBinGraphSha256: null,
    inventoryError: null,
  }
  if (dependencyCount === 0) return {required: false, satisfied: true, ...empty}
  const projectLockfilePath = join(projectRoot, 'pnpm-lock.yaml')
  const installedLockfilePath = join(projectRoot, 'node_modules/.pnpm/lock.yaml')
  if (!existsSync(projectLockfilePath) || !existsSync(installedLockfilePath)) {
    return {required: true, satisfied: false, ...empty}
  }
  const lockfileSha256 = sha256(readFileSync(projectLockfilePath))
  const installedLockfileSha256 = sha256(readFileSync(installedLockfilePath))
  try {
    const inventory = dependencyInventory(projectRoot)
    return {
      required: true,
      satisfied: lockfileSha256 === installedLockfileSha256 && inventory !== null,
      lockfileSha256,
      installedLockfileSha256,
      ...inventory,
      inventoryError: null,
    }
  } catch (error) {
    return {
      required: true,
      satisfied: false,
      ...empty,
      lockfileSha256,
      installedLockfileSha256,
      inventoryError: error instanceof Error ? error.message : String(error),
    }
  }
}

const displayPath = (projectRoot, path, category) => {
  if (!within(projectRoot, path)) return `[${category}]/${path.split(sep).at(-1)}`
  const rawOffset = relative(projectRoot, path)
  const offset = rawOffset === '' || (rawOffset !== '..' && !rawOffset.startsWith(`..${sep}`) && !isAbsolute(rawOffset))
    ? rawOffset
    : relative(canonicalPath(projectRoot), canonicalPath(path))
  return offset.split(sep).join('/')
}
const executableMetadata = (projectRoot, path, category) => {
  const stats = lstatSync(path, {bigint: true})
  const linkTarget = stats.isSymbolicLink() ? readlinkSync(path) : null
  const resolvedPath = stats.isSymbolicLink() ? realpathSync(path) : path
  const resolvedStats = lstatSync(resolvedPath, {bigint: true})
  if (!resolvedStats.isFile()) throw new Error(`execution target is not a regular file: ${displayPath(projectRoot, path, category)}`)
  return {
    path: displayPath(projectRoot, path, category),
    linkTargetSha256: linkTarget === null ? null : sha256(linkTarget),
    resolvedPath: displayPath(projectRoot, resolvedPath, category),
    contentSha256: cachedFileSha256(resolvedPath, resolvedStats),
    metadataSha256: sha256([resolvedStats.mode, resolvedStats.size, resolvedStats.mtimeNs, resolvedStats.ctimeNs, resolvedStats.dev, resolvedStats.ino].join(':')),
  }
}
const packageIdentity = (projectRoot, binaryPath) => {
  for (let directory = dirname(binaryPath); within(projectRoot, directory); directory = dirname(directory)) {
    const manifestPath = join(directory, 'package.json')
    if (existsSync(manifestPath)) {
      try {
        const source = readFileSync(manifestPath)
        const manifest = JSON.parse(source.toString('utf8'))
        return {name: manifest.name ?? null, version: manifest.version ?? null, packageJsonSha256: sha256(source)}
      } catch {
        return {name: null, version: null, packageJsonSha256: null}
      }
    }
    if (dirname(directory) === directory) break
  }
  return null
}
const findOnPath = (name, searchPath) => {
  for (const directory of String(searchPath ?? '').split(delimiter).filter(Boolean)) {
    const candidates = process.platform === 'win32' ? [`${name}.exe`, `${name}.cmd`, name] : [name]
    for (const candidate of candidates) {
      const path = join(directory, candidate)
      try {
        accessSync(path, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
        return path
      } catch {}
    }
  }
  return null
}

export const readExecutionTargetBinding = ({projectRoot, analysis, pnpmExecutable, searchPath}) => {
  const errors = []
  const targets = []
  const addTarget = (executable, path, category) => {
    if (!path || !existsSync(path)) {
      errors.push(`execution target is missing: ${executable}`)
      return
    }
    try {
      const metadata = executableMetadata(projectRoot, path, category)
      const resolvedAbsolute = lstatSync(path).isSymbolicLink() ? realpathSync(path) : path
      if (category === 'package' && !within(join(projectRoot, 'node_modules'), resolvedAbsolute)) {
        throw new Error(`package execution target escapes node_modules: ${executable}`)
      }
      targets.push({executable, category, ...metadata, package: packageIdentity(projectRoot, resolvedAbsolute)})
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }

  addTarget('pnpm', pnpmExecutable, 'package-manager')
  for (const command of analysis?.commands ?? []) {
    if (command.executable === 'node') addTarget('node', process.execPath, 'node-runtime')
    else if (command.executable === 'docker') addTarget('docker', findOnPath('docker', searchPath), 'system')
    else {
      try {
        addTarget(command.executable, resolvePackageExecutionTarget(projectRoot, command.executable, command.cwd), 'package')
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error))
      }
    }
  }
  const normalizedTargets = targets.sort((left, right) => `${left.executable}:${left.path}`.localeCompare(`${right.executable}:${right.path}`))
  return {
    satisfied: errors.length === 0,
    sha256: sha256(JSON.stringify(normalizedTargets)),
    targets: normalizedTargets,
    errors,
  }
}

// 멤버 명령은 pnpm run과 같은 순서로 찾는다 — 멤버 node_modules/.bin, 그다음 워크스페이스 루트.
export const resolvePackageExecutionTarget = (projectRoot, executable, cwd = undefined) => {
  const memberOwner = cwd && cwd !== '.'
    ? installedPackageGraph(join(projectRoot, cwd), {storeRoot: join(projectRoot, 'node_modules', '.pnpm')})?.binaryOwners.get(executable)
    : null
  const owner = memberOwner ?? installedPackageGraph(projectRoot)?.binaryOwners.get(executable)
  if (!owner) throw new Error(`package binary is not linked to a top-level installed package: ${executable}`)
  return owner.path
}

// ── 프로젝트 패키지 설정(.npmrc·pnpm 훅) ──────────────────────────────────────
// 사내 registry 프로젝트는 레지스트리·인증 줄을 담은 .npmrc를 커밋한다. 러너는 패키지 스크립트를 pnpm 없이 걸러낸 env로
// 직접 실행하므로(`executeVerifiedPackageScript`) .npmrc가 닿는 곳은 pnpm으로 도는 `audit` 하나다. 그래서 audit 판정을 바꿀 수
// 있는 설정(audit-level·TLS 신뢰·프록시·registry)을 러너가 막거나 env로 고정한다. 허용 목록 밖의 키·섹션·pnpm 훅 파일은
// 거부하고(모르는 키는 막는다), 값은 읽어도 출력·기록하지 않는다(키 분류만 남긴다). 줄 나누기는 pnpm(ini)과 같게 한다 —
// 다르게 나누면 거부할 키가 허용 키의 값 안에 숨는다.
const REGISTRY_AUTH_FIELDS = new Set(['_authToken', '_auth', 'username', '_password', 'email', 'always-auth', 'certfile', 'keyfile'])
const NPMRC_KEY_CLASSES = new Map([
  ...['always-auth', 'email', 'strict-ssl', 'fetch-retries', 'fetch-retry-factor', 'fetch-retry-mintimeout',
    'fetch-retry-maxtimeout', 'fetch-timeout', 'network-concurrency'].map(key => [key, 'transport']),
  ...['auto-install-peers', 'strict-peer-dependencies', 'shamefully-hoist', 'public-hoist-pattern', 'hoist-pattern',
    'dedupe-peer-dependents', 'save-exact', 'save-prefix', 'engine-strict', 'resolution-mode', 'prefer-offline',
    'link-workspace-packages', 'prefer-workspace-packages'].map(key => [key, 'install-option']),
])

/** .npmrc 키 하나의 분류 — 허용 목록 밖이면 null(거부). */
export const classifyNpmrcKey = key => {
  if (key === 'registry') return 'registry'
  if (/^@[a-z0-9][\w.-]*:registry$/i.test(key)) return 'scoped-registry'
  const auth = key.match(/^\/\/\S+\/:([\w-]+)$/)
  if (auth) return REGISTRY_AUTH_FIELDS.has(auth[1]) ? 'registry-auth' : null
  return NPMRC_KEY_CLASSES.get(key) ?? null
}

/** .npmrc 원문에서 키 이름만 뽑는다(값은 버린다). 섹션 머리는 `[섹션]` 키로 남겨 거부되게 한다. */
export const parseNpmrcKeys = source => (source.includes('\0') ? ['<NUL byte>'] : source.split(/[\r\n]+/))
  .map(line => line.trim())
  .filter(line => line && !line.startsWith('#') && !line.startsWith(';'))
  .map(line => (line.startsWith('[') ? line : line.split('=')[0].trim().replace(/^["']|["']$/g, '').replace(/\[\]$/, '')))

// pnpm-workspace.yaml의 설정은 env 고정보다 우선한다(pnpm 10.23·11.18 실측) — 최상위 키를 허용 목록으로 판정한다.
// 허용: 작업공간 구성과 설치 시점에만 쓰이는 해석 키. audit·실행·네트워크를 바꾸는 키와 모호한 YAML은 거부한다.
const WORKSPACE_ALLOWED_KEYS = new Set(['packages', 'catalog', 'catalogs', 'onlyBuiltDependencies', 'ignoredBuiltDependencies',
  'neverBuiltDependencies', 'strictDepBuilds', 'allowBuilds', 'overrides', 'patchedDependencies', 'packageExtensions', 'peerDependencyRules',
  'autoInstallPeers', 'strictPeerDependencies', 'shamefullyHoist', 'publicHoistPattern', 'hoistPattern', 'dedupePeerDependents',
  'saveExact', 'savePrefix', 'engineStrict', 'resolutionMode', 'preferOffline', 'linkWorkspacePackages', 'preferWorkspacePackages'])
// 판정은 pnpm(js-yaml)이 읽는 루트 매핑 키와 같아야 한다 — 들여쓴 루트·`---` 줄의 내용·BOM은 js-yaml이 받아들이므로
// (pnpm 10.23·11.18 실측) 0번째 칸의 `키:` 줄·주석·빈 줄만 허용하고 나머지 형태는 거부한다(fail-closed).
export const workspaceDisallowedKeys = source => {
  if (/[\0\t\\\uFEFF]/.test(source) || /(?:^|\s)(?:!![^\s]+|&[\w-]+|\*[\w-]+)|^\s*(?:<<\s*:|\?\s)/m.test(source)) return ['<ambiguous YAML>']
  const lines = source.split(/[\r\n]+/).filter(line => line.trim() && !line.trimStart().startsWith('#'))
  if (lines.length > 0 && /^\s/.test(lines[0])) return ['<indented root>']
  return lines
    .filter(line => !/^\s/.test(line))
    .map(line => line.match(/^([A-Za-z][\w-]*)\s*:/)?.[1] ?? '<unsupported top-level line>')
    .filter(key => !WORKSPACE_ALLOWED_KEYS.has(key))
}

/**
 * 프로젝트에서 저장소 경계(.git)까지 올라가며 .npmrc·pnpm 훅·pnpm-workspace.yaml을 찾아 판정한다.
 * @returns {{files: Array<{path: string, kind: 'npmrc'|'pnpmfile'|'workspace', classes: string[], disallowedKeys: string[]}>, blocked: boolean}}
 */
export const inspectPackageConfig = projectRoot => {
  let repositoryBoundary = projectRoot
  for (let directory = projectRoot; ; directory = dirname(directory)) {
    if (existsSync(join(directory, '.git'))) {
      repositoryBoundary = directory
      break
    }
    if (dirname(directory) === directory) break
  }
  const files = []
  for (let directory = projectRoot; ; directory = dirname(directory)) {
    for (const name of ['.pnpmfile.cjs', '.pnpmfile.mjs']) {
      if (existsSync(join(directory, name))) files.push({path: join(directory, name), kind: 'pnpmfile', classes: [], disallowedKeys: ['<pnpm hook file>']})
    }
    if (existsSync(join(directory, '.npmrc'))) {
      let keys
      try { keys = parseNpmrcKeys(readFileSync(join(directory, '.npmrc'), 'utf8')) } catch { keys = ['<unreadable>'] }
      const classes = [...new Set(keys.map(classifyNpmrcKey).filter(Boolean))].sort()
      files.push({path: join(directory, '.npmrc'), kind: 'npmrc', classes, disallowedKeys: keys.filter(key => !classifyNpmrcKey(key))})
    }
    if (existsSync(join(directory, 'pnpm-workspace.yaml'))) {
      let disallowedKeys
      try { disallowedKeys = workspaceDisallowedKeys(readFileSync(join(directory, 'pnpm-workspace.yaml'), 'utf8')) } catch { disallowedKeys = ['<unreadable>'] }
      files.push({path: join(directory, 'pnpm-workspace.yaml'), kind: 'workspace', classes: [], disallowedKeys})
    }
    if (directory === repositoryBoundary || dirname(directory) === directory) break
  }
  return {files, blocked: files.some(file => file.disallowedKeys.length > 0)}
}

/**
 * 프로젝트가 핀한 package manager를 **머신에 있는 후보 중에서** 고른다.
 * 브라운필드 계약: 기존 관례(`packageManager` 선언)가 러너 환경보다 우선한다.
 * 후보와 버전 조회를 주입받는 순수 함수다 — 실행 환경에 같은 버전만 있으면 이 판정이
 * 무력해진 것을 알 수 없어, 회귀는 서로 다른 버전을 주입해 고정한다.
 * @returns {{executable: string | null, matched: boolean}}
 */
export const resolvePinnedPackageManager = ({candidates, versionOf, pinnedVersion, compare}) => {
  if (!Array.isArray(candidates) || candidates.length === 0) return {executable: null, matched: false}
  if (!pinnedVersion) return {executable: candidates[0], matched: false}
  for (const candidate of candidates) {
    const version = versionOf(candidate)
    if (version !== null && version !== undefined && compare(version, pinnedVersion) === 0) {
      return {executable: candidate, matched: true}
    }
  }
  return {executable: candidates[0], matched: false}
}
