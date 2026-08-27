#!/usr/bin/env node

import {spawnSync} from 'node:child_process'
import {inspectLockfileSource} from './lockfile-source-lib.mjs'
import {accessSync, constants, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {delimiter, dirname, isAbsolute, join, relative, resolve, sep} from 'node:path'
import {fileURLToPath} from 'node:url'

const args = process.argv.slice(2)
const projectIndex = args.indexOf('--project')
const operationIndex = args.indexOf('--operation')
if (args.length !== 4 || projectIndex === -1 || operationIndex === -1) {
  process.stderr.write('Usage: run-package-operation.mjs --project <directory> --operation <lockfile|install|msw-init|husky-init|git-init>\n')
  process.exit(2)
}

const operation = args[operationIndex + 1]
if (!['lockfile', 'install', 'msw-init', 'husky-init', 'git-init'].includes(operation)) {
  process.stderr.write(`Unsupported package operation: ${operation ?? '<missing>'}\n`)
  process.exit(2)
}

const repositoryRoot = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'))
let projectRoot
try {
  projectRoot = realpathSync(resolve(args[projectIndex + 1]))
} catch {
  process.stderr.write('Package operation project must be an existing directory.\n')
  process.exit(2)
}
// 프로젝트는 하니스 저장소 내부(저장소/임베디드 모드) 또는 현재 세션 프로젝트
// (CLAUDE_PROJECT_DIR — 플러그인 모드) 내부여야 한다. 어느 쪽이든 제어면·VCS·산출물
// 디렉터리는 직접 대상이 될 수 없다.
const normalOffsetWithin = root => {
  if (!root) return null
  let realRoot
  try {
    realRoot = realpathSync(resolve(root))
  } catch {
    return null
  }
  const offset = relative(realRoot, projectRoot)
  if (offset === '..' || offset.startsWith(`..${sep}`) || isAbsolute(offset)) return null
  if (['.claude', '.git', '_workspace'].includes(offset.split(sep)[0])) return null
  return offset
}
if (
  !statSync(projectRoot).isDirectory() ||
  (normalOffsetWithin(repositoryRoot) === null && normalOffsetWithin(process.env.CLAUDE_PROJECT_DIR) === null)
) {
  process.stderr.write('Package operation project must stay inside a normal project directory (harness repository or the current session project).\n')
  process.exit(2)
}

let packageJson = null
const packagePath = join(projectRoot, 'package.json')
const lockfilePath = join(projectRoot, 'pnpm-lock.yaml')
const rejectAmbiguousYaml = (source, label) => {
  if (source.includes('\0') || source.includes('\\') || source.includes('\t')) {
    throw new Error(`${label} contains escaped or ambiguous YAML that is outside the broker scope.`)
  }
  if (/(?:^|\s)(?:!![^\s]+|&[A-Za-z0-9_-]+|\*[A-Za-z0-9_-]+)|(?:^|\n)\s*(?:<<\s*:|\?\s+)/m.test(source)) {
    throw new Error(`${label} contains YAML tags, aliases, or explicit mappings that are outside the broker scope.`)
  }
}
const UNSAFE_WORKSPACE_KEY = /(?:^|[\n,{])\s*["']?(?:catalogs?|overrides|patchedDependencies|packageExtensions|pnpmfile|registries?)["']?\s*:/i
const validateWorkspaceSource = source => {
  rejectAmbiguousYaml(source, 'pnpm-workspace.yaml')
  if (UNSAFE_WORKSPACE_KEY.test(source)) {
    throw new Error('pnpm-workspace.yaml resolution customization is outside the public-registry package broker scope.')
  }
}
const validateLockfileSource = () => {
  if (!existsSync(lockfilePath)) return
  const rawLockSource = readFileSync(lockfilePath, 'utf8')
  rejectAmbiguousYaml(rawLockSource, 'Lockfile')
  const violations = inspectLockfileSource(rawLockSource)
  if (violations.length > 0) {
    throw new Error(`Lockfile contains a non-public-registry or local executable dependency source: ${violations.join('; ')}`)
  }
}
if (operation !== 'git-init') {
  try {
    packageJson = JSON.parse(readFileSync(packagePath, 'utf8'))
  } catch {
    process.stderr.write('A readable package.json is required for package operations.\n')
    process.exit(2)
  }
  if (!/^pnpm@\d+\.\d+\.\d+$/.test(packageJson.packageManager ?? '')) {
    process.stderr.write('package.json must pin an exact pnpm packageManager version.\n')
    process.exit(2)
  }
  if (packageJson.pnpm !== undefined || packageJson.resolutions !== undefined) {
    process.stderr.write('package.json resolution overrides are outside the public-registry package broker scope.\n')
    process.exit(2)
  }
  for (let directory = projectRoot; ; directory = dirname(directory)) {
    for (const name of ['.npmrc', '.pnpmfile.cjs', '.pnpmfile.mjs']) {
      if (existsSync(join(directory, name))) {
        process.stderr.write(`${name} is outside the public-registry package broker scope.\n`)
        process.exit(2)
      }
    }
    const workspacePath = join(directory, 'pnpm-workspace.yaml')
    if (existsSync(workspacePath)) {
      const workspaceSource = readFileSync(workspacePath, 'utf8')
      try {
        validateWorkspaceSource(workspaceSource)
      } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
        process.exit(2)
      }
    }
    if (directory === repositoryRoot || dirname(directory) === directory) break
  }
  const dependencyEntries = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']
    .flatMap(field => Object.entries(packageJson[field] ?? {}).map(([name, spec]) => [field, name, spec]))
  for (const [field, name, spec] of dependencyEntries) {
    if (typeof spec !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(spec)) {
      process.stderr.write(`${field}.${name} must use an exact registry version under this broker.\n`)
      process.exit(2)
    }
  }
  if (operation === 'install' && !existsSync(lockfilePath)) {
    process.stderr.write('install requires a reviewed lockfile; run the lockfile operation first.\n')
    process.exit(2)
  }
  try {
    validateLockfileSource()
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(2)
  }
}

const dependencyDeclared = name =>
  Boolean(packageJson?.dependencies?.[name] || packageJson?.devDependencies?.[name])
if (operation === 'msw-init' && !dependencyDeclared('msw')) {
  process.stderr.write('msw-init requires a declared msw dependency.\n')
  process.exit(2)
}
if (operation === 'husky-init' && !dependencyDeclared('husky')) {
  process.stderr.write('husky-init requires a declared husky dependency.\n')
  process.exit(2)
}
const initializerPackage = operation === 'msw-init' ? 'msw' : operation === 'husky-init' ? 'husky' : null
if (initializerPackage && process.env.WEB_HARNESS_ISOLATED_EXECUTION !== '1') {
  process.stderr.write(`${operation} executes dependency code and is BLOCKED without externally isolated execution.\n`)
  process.exit(2)
}

const pnpmExecutable = join(dirname(process.execPath), process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm')
if (operation !== 'git-init') {
  try {
    accessSync(pnpmExecutable, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
  } catch {
    process.stderr.write('Pinned pnpm must be installed beside the active Node runtime.\n')
    process.exit(2)
  }
}
const gitExecutable = existsSync('/usr/bin/git') ? '/usr/bin/git' : 'git'
let initializerExecutable = null
if (initializerPackage) {
  const installedLockfile = join(projectRoot, 'node_modules/.pnpm/lock.yaml')
  const localBinary = join(
    projectRoot,
    'node_modules/.bin',
    process.platform === 'win32' ? `${initializerPackage}.cmd` : initializerPackage,
  )
  try {
    if (
      !existsSync(lockfilePath) ||
      !existsSync(installedLockfile) ||
      readFileSync(installedLockfile).compare(readFileSync(lockfilePath)) !== 0
    ) throw new Error('installed dependency graph is missing or stale')
    accessSync(localBinary, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
    initializerExecutable = realpathSync(localBinary)
    const binaryOffset = relative(projectRoot, initializerExecutable)
    if (
      binaryOffset === '..' ||
      binaryOffset.startsWith(`..${sep}`) ||
      binaryOffset.split(sep)[0] !== 'node_modules' ||
      !statSync(initializerExecutable).isFile()
    ) throw new Error('initializer binary escapes the installed project dependency graph')
  } catch (error) {
    process.stderr.write(`${operation} requires a reviewed installed local binary: ${error instanceof Error ? error.message : String(error)}.\n`)
    process.exit(2)
  }
}
// --ignore-workspace: 생성 프로젝트는 계약상 독립 release root다 — 중첩 dogfood repo에서
// pnpm이 **조상** 워크스페이스로 흡수해 루트 lockfile을 조작하는 것을 차단(search-portal 파일럿
// 실측, 결함 14호: "Scope: all 2 workspace projects"로 프로젝트-로컬 lockfile 미생성).
// 프로젝트가 자기 자신의 pnpm-workspace.yaml을 가지면(모노레포 프로필) 플래그를 넣지 않는다 —
// pnpm은 cwd에서 가장 가까운 workspace 파일에서 탐색을 멈추므로 조상 흡수가 성립하지 않고,
// 무조건 추가하면 자체 workspace:* 의존성 해석까지 무력화된다(적대 검토 HIGH).
const projectWorkspaceFlags = existsSync(join(projectRoot, 'pnpm-workspace.yaml')) ? [] : ['--ignore-workspace']
const command = operation === 'git-init'
  ? [gitExecutable, 'init', '--template=']
  : operation === 'lockfile'
    ? [pnpmExecutable, 'install', '--lockfile-only', '--ignore-scripts', '--ignore-pnpmfile', ...projectWorkspaceFlags]
    : operation === 'install'
      ? [pnpmExecutable, 'install', '--frozen-lockfile', '--ignore-scripts', '--ignore-pnpmfile', ...projectWorkspaceFlags]
    : operation === 'msw-init'
      ? process.platform === 'win32'
        ? [pnpmExecutable, 'exec', 'msw', 'init', 'public', '--save']
        : [initializerExecutable, 'init', 'public', '--save']
      : process.platform === 'win32'
        ? [pnpmExecutable, 'exec', 'husky', 'init']
        : [initializerExecutable, 'init']

const isolatedHome = mkdtempSync(join(tmpdir(), 'web-harness-package-home-'))
const environment = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => [
    'CI', 'COLORTERM', 'COMSPEC', 'FORCE_COLOR', 'LANG', 'LC_ALL', 'NO_COLOR', 'PATH',
    'PATHEXT', 'SYSTEMROOT', 'TERM', 'TMP', 'TEMP', 'TMPDIR', 'TZ',
  ].includes(key)),
)
environment.PATH = [dirname(process.execPath), environment.PATH].filter(Boolean).join(delimiter)
if (initializerPackage) {
  environment.PATH = [join(projectRoot, 'node_modules/.bin'), environment.PATH].filter(Boolean).join(delimiter)
}
environment.HOME = isolatedHome
environment.USERPROFILE = isolatedHome
environment.npm_config_userconfig = join(isolatedHome, '.npmrc')
environment.npm_config_globalconfig = join(isolatedHome, '.global-npmrc')
environment.npm_config_registry = 'https://registry.npmjs.org'
environment.npm_config_ignore_scripts = 'true'
environment.npm_config_verify_store_integrity = 'true'
environment.COREPACK_ENABLE_PROJECT_SPEC = '0'
environment.GIT_CONFIG_NOSYSTEM = '1'
environment.GIT_CONFIG_GLOBAL = join(isolatedHome, '.gitconfig')
environment.GIT_TERMINAL_PROMPT = '0'

if (operation !== 'git-init') {
  const expectedPnpmVersion = packageJson.packageManager.slice('pnpm@'.length)
  const versionResult = spawnSync(pnpmExecutable, ['--version'], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: environment,
    timeout: 10_000,
  })
  if (versionResult.status !== 0 || versionResult.stdout.trim() !== expectedPnpmVersion) {
    rmSync(isolatedHome, {recursive: true, force: true})
    process.stderr.write(`Active pnpm must match packageManager ${packageJson.packageManager}.\n`)
    process.exit(2)
  }
}

const result = spawnSync(command[0], command.slice(1), {
  cwd: projectRoot,
  encoding: 'utf8',
  env: environment,
  maxBuffer: 20 * 1024 * 1024,
  timeout: ['install', 'lockfile'].includes(operation) ? 600_000 : 120_000,
})
let postValidationError = null
if (result.status === 0 && ['install', 'lockfile', 'msw-init', 'husky-init'].includes(operation)) {
  try {
    validateLockfileSource()
    if (['install', 'msw-init', 'husky-init'].includes(operation)) {
      const installedLockfile = join(projectRoot, 'node_modules/.pnpm/lock.yaml')
      if (
        !existsSync(installedLockfile) ||
        readFileSync(installedLockfile).compare(readFileSync(lockfilePath)) !== 0
      ) throw new Error('Installed dependency graph does not match the reviewed frozen lockfile.')
    }
  } catch (error) {
    postValidationError = error instanceof Error ? error.message : String(error)
  }
}
rmSync(isolatedHome, {recursive: true, force: true})

const redact = source => String(source ?? '')
  .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[REDACTED]@')
  .replace(/\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY))\s*[=:]\s*([^\s]+)/gi, '$1=[REDACTED]')
if (result.stdout) process.stdout.write(redact(result.stdout))
if (result.stderr) process.stderr.write(redact(result.stderr))
if (result.error) process.stderr.write(`${redact(result.error.message)}\n`)
if (postValidationError) {
  process.stderr.write(`${redact(postValidationError)}\n`)
  process.exit(1)
}
process.exit(Number.isInteger(result.status) ? result.status : 1)
