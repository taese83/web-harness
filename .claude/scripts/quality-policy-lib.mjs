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
  'cypress', 'eslint', 'jest', 'next', 'playwright', 'tsc', 'tsx', 'turbo', 'vite', 'vitest',
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

export const analyzePackageScript = source => {
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
    if (!SIMPLE_EXECUTABLE.test(executable) || !SAFE_EXECUTABLES.has(executable)) {
      return parseError(`package script executable is not allowed: ${segment[executableIndex]}`)
    }
    const args = segment.slice(executableIndex + 1)
    commands.push({executable, args, assignments})
    executionCommands.push({executable, args, assignments: executionAssignments})
  }
  return {ok: true, error: null, commands, executionCommands}
}

const hasAny = (args, denied) => args.some(argument => denied.has(argument))
const turboTask = args => args[0] === 'run' ? args[1] : args[0]
const isTsc = command => command.executable === 'tsc' && !hasAny(command.args, new Set(['--help', '-h', '--init', '--showConfig', '--version', '-v']))
const isEslint = command => command.executable === 'eslint' &&
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
    return allCommandsMatch(commands, command => isEslint(command) || (command.executable === 'turbo' && turboTask(command.args) === 'lint'))
  }
  if (id === 'quality.typecheck') {
    return allCommandsMatch(commands, command => isTsc(command) || (command.executable === 'turbo' && turboTask(command.args) === 'typecheck'))
  }
  if (id === 'quality.unit') return allCommandsMatch(commands, isUnit)
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

const installedPackageGraph = projectRoot => {
  const dependencyRoot = join(projectRoot, 'node_modules')
  const virtualStoreRoot = join(dependencyRoot, '.pnpm')
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
          throw new Error(`installed dependency symlink escapes node_modules: ${path}`)
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
        const graph = installedPackageGraph(projectRoot)
        const owner = graph?.binaryOwners.get(command.executable)
        if (!owner) throw new Error(`package binary is not linked to a top-level installed package: ${command.executable}`)
        addTarget(command.executable, owner.path, 'package')
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

export const resolvePackageExecutionTarget = (projectRoot, executable) => {
  const graph = installedPackageGraph(projectRoot)
  const owner = graph?.binaryOwners.get(executable)
  if (!owner) throw new Error(`package binary is not linked to a top-level installed package: ${executable}`)
  return owner.path
}

export const findUnsafePackageConfig = projectRoot => {
  let repositoryBoundary = projectRoot
  for (let directory = projectRoot; ; directory = dirname(directory)) {
    if (existsSync(join(directory, '.git'))) {
      repositoryBoundary = directory
      break
    }
    if (dirname(directory) === directory) break
  }
  for (let directory = projectRoot; ; directory = dirname(directory)) {
    for (const name of ['.npmrc', '.pnpmfile.cjs', '.pnpmfile.mjs']) {
      if (existsSync(join(directory, name))) return join(directory, name)
    }
    if (directory === repositoryBoundary || dirname(directory) === directory) break
  }
  return null
}
