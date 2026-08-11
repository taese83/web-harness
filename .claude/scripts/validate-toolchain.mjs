#!/usr/bin/env node

import {spawnSync} from 'node:child_process'
import {accessSync, constants, existsSync, readFileSync, realpathSync, statSync} from 'node:fs'
import {delimiter, dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const EXPECTED_NODE_ENGINE = '>=22.22.0'
const EXPECTED_NODE_VERSION = '22.22.3'
const EXPECTED_PNPM_VERSION = '11.18.0'

const args = new Set(process.argv.slice(2))
const jsonOutput = args.delete('--json')
const helpRequested = args.delete('--help') || args.delete('-h')

if (helpRequested) {
  console.log('Usage: node .claude/scripts/validate-toolchain.mjs [--json]')
  console.log('Validates the repository Node and pnpm toolchain without network access or writes.')
  process.exit(0)
}

if (args.size > 0) {
  console.error(`Unknown argument(s): ${[...args].join(', ')}`)
  process.exit(2)
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(scriptDirectory, '..', '..')
const checks = []
const observed = {
  node: process.versions.node,
  nodeVersionFile: null,
  nvmrc: null,
  packageNodeEngine: null,
  packageManager: null,
  pnpm: null,
  pnpmRuntimeVersion: null,
  pnpmExecutable: null,
  pathNodeExecutable: null,
}

const check = (id, ok, message) => checks.push({id, ok, message})

const parseVersion = value => {
  const match = String(value ?? '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/)
  return match ? match.slice(1).map(Number) : null
}

const compareVersions = (left, right) => {
  const leftParts = parseVersion(left)
  const rightParts = parseVersion(right)
  if (!leftParts || !rightParts) return null

  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] > rightParts[index] ? 1 : -1
  }
  return 0
}

const readTrimmed = relativePath => {
  try {
    return readFileSync(join(repositoryRoot, relativePath), 'utf8').trim()
  } catch (error) {
    check(relativePath, false, `${relativePath} could not be read: ${error.message}`)
    return null
  }
}

let packageJson = null
try {
  packageJson = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8'))
  check('package-json', true, 'package.json is readable JSON')
} catch (error) {
  check('package-json', false, `package.json could not be read: ${error.message}`)
}

if (packageJson) {
  observed.packageNodeEngine = packageJson.engines?.node ?? null
  observed.packageManager = packageJson.packageManager ?? null

  check(
    'package-node-engine',
    observed.packageNodeEngine === EXPECTED_NODE_ENGINE,
    observed.packageNodeEngine === EXPECTED_NODE_ENGINE
      ? `package.json declares Node ${EXPECTED_NODE_ENGINE}`
      : `package.json engines.node must be ${EXPECTED_NODE_ENGINE}; found ${observed.packageNodeEngine ?? 'missing'}`,
  )
  check(
    'package-manager',
    observed.packageManager === `pnpm@${EXPECTED_PNPM_VERSION}`,
    observed.packageManager === `pnpm@${EXPECTED_PNPM_VERSION}`
      ? `package.json declares pnpm ${EXPECTED_PNPM_VERSION}`
      : `package.json packageManager must be pnpm@${EXPECTED_PNPM_VERSION}; found ${observed.packageManager ?? 'missing'}`,
  )
}

observed.nodeVersionFile = readTrimmed('.node-version')
if (observed.nodeVersionFile !== null) {
  check(
    'node-version-file',
    observed.nodeVersionFile === EXPECTED_NODE_VERSION,
    observed.nodeVersionFile === EXPECTED_NODE_VERSION
      ? `.node-version pins ${EXPECTED_NODE_VERSION}`
      : `.node-version must be ${EXPECTED_NODE_VERSION}; found ${observed.nodeVersionFile || 'empty'}`,
  )
}

observed.nvmrc = readTrimmed('.nvmrc')
if (observed.nvmrc !== null) {
  check(
    'nvmrc',
    observed.nvmrc === EXPECTED_NODE_VERSION,
    observed.nvmrc === EXPECTED_NODE_VERSION
      ? `.nvmrc pins ${EXPECTED_NODE_VERSION}`
      : `.nvmrc must be ${EXPECTED_NODE_VERSION}; found ${observed.nvmrc || 'empty'}`,
  )
}

const nodeComparison = compareVersions(observed.node, EXPECTED_NODE_VERSION)
check(
  'node-runtime',
  nodeComparison !== null && nodeComparison >= 0,
  nodeComparison !== null && nodeComparison >= 0
    ? `Node ${observed.node} satisfies ${EXPECTED_NODE_ENGINE}`
    : `Node ${observed.node} is unsupported; use Node ${EXPECTED_NODE_ENGINE}`,
)

const executableNames = process.platform === 'win32'
  ? (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').map(extension => `pnpm${extension.toLowerCase()}`)
  : ['pnpm']

const findPnpmExecutable = () => {
  for (const rawDirectory of (process.env.PATH ?? '').split(delimiter)) {
    const directory = rawDirectory.replace(/^"|"$/g, '')
    if (!directory) continue

    for (const executableName of executableNames) {
      const candidate = join(directory, executableName)
      try {
        if (!existsSync(candidate) || !statSync(candidate).isFile()) continue
        accessSync(candidate, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
        return candidate
      } catch {
        // Continue looking for the next usable PATH entry.
      }
    }
  }
  return null
}

const findNodeExecutable = () => {
  const names = process.platform === 'win32'
    ? (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').map(extension => `node${extension.toLowerCase()}`)
    : ['node']
  for (const rawDirectory of (process.env.PATH ?? '').split(delimiter)) {
    const directory = rawDirectory.replace(/^"|"$/g, '')
    if (!directory) continue
    for (const name of names) {
      const candidate = join(directory, name)
      try {
        if (!existsSync(candidate) || !statSync(candidate).isFile()) continue
        accessSync(candidate, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
        return realpathSync(candidate)
      } catch {
        // Continue looking for the next usable PATH entry.
      }
    }
  }
  return null
}

observed.pathNodeExecutable = findNodeExecutable()
let currentNodeExecutable = null
try {
  currentNodeExecutable = realpathSync(process.execPath)
} catch {
  currentNodeExecutable = process.execPath
}
check(
  'path-node-runtime',
  observed.pathNodeExecutable === currentNodeExecutable,
  observed.pathNodeExecutable === currentNodeExecutable
    ? `PATH resolves the active Node runtime: ${currentNodeExecutable}`
    : `PATH resolves ${observed.pathNodeExecutable ?? 'no Node executable'}, but validation runs with ${currentNodeExecutable}; activate .nvmrc before pnpm commands`,
)

const readInstalledPnpmVersion = executablePath => {
  let currentDirectory
  try {
    currentDirectory = dirname(realpathSync(executablePath))
  } catch {
    return null
  }

  for (let depth = 0; depth < 8; depth += 1) {
    const manifestPath = join(currentDirectory, 'package.json')
    if (existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
        if (manifest.name === 'pnpm' && typeof manifest.version === 'string') return manifest.version
      } catch {
        return null
      }
    }

    const parentDirectory = dirname(currentDirectory)
    if (parentDirectory === currentDirectory) break
    currentDirectory = parentDirectory
  }
  return null
}

observed.pnpmExecutable = findPnpmExecutable()
check(
  'pnpm-available',
  observed.pnpmExecutable !== null,
  observed.pnpmExecutable
    ? `pnpm executable is available at ${observed.pnpmExecutable}`
    : 'pnpm executable is not available on PATH',
)

if (observed.pnpmExecutable) {
  observed.pnpm = readInstalledPnpmVersion(observed.pnpmExecutable)
  check(
    'pnpm-version',
    observed.pnpm === EXPECTED_PNPM_VERSION,
    observed.pnpm === EXPECTED_PNPM_VERSION
      ? `pnpm ${EXPECTED_PNPM_VERSION} is installed`
      : observed.pnpm
        ? `pnpm ${observed.pnpm} is installed; required ${EXPECTED_PNPM_VERSION}`
        : 'pnpm version could not be verified read-only; install pnpm directly instead of an unresolved shim',
  )
  const runtimeCheck = spawnSync(observed.pnpmExecutable, ['--version'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: [dirname(process.execPath), process.env.PATH].filter(Boolean).join(delimiter),
    },
    timeout: 10_000,
  })
  observed.pnpmRuntimeVersion = runtimeCheck.status === 0 ? runtimeCheck.stdout.trim() : null
  check(
    'pnpm-runtime',
    runtimeCheck.status === 0 && observed.pnpmRuntimeVersion === EXPECTED_PNPM_VERSION,
    runtimeCheck.status === 0 && observed.pnpmRuntimeVersion === EXPECTED_PNPM_VERSION
      ? `pnpm ${EXPECTED_PNPM_VERSION} executes with the active Node runtime`
      : `pnpm --version failed or returned ${observed.pnpmRuntimeVersion ?? 'no version'}; ${runtimeCheck.stderr?.trim() || 'activate the pinned toolchain'}`,
  )
}

const failedChecks = checks.filter(result => !result.ok)
const result = {
  schemaVersion: 1,
  ok: failedChecks.length === 0,
  required: {
    node: EXPECTED_NODE_ENGINE,
    pnpm: EXPECTED_PNPM_VERSION,
  },
  observed,
  checks,
}

if (jsonOutput) {
  console.log(JSON.stringify(result, null, 2))
} else if (result.ok) {
  console.log(`Toolchain preflight: PASS (Node ${observed.node}, pnpm ${observed.pnpm})`)
} else {
  console.error(`Toolchain preflight: FAIL (${failedChecks.length} check${failedChecks.length === 1 ? '' : 's'})`)
  for (const failedCheck of failedChecks) console.error(`- ${failedCheck.message}`)
}

process.exit(result.ok ? 0 : 1)
