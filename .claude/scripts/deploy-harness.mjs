#!/usr/bin/env node

import {
  closeSync,
  constants,
  copyFileSync,
  cpSync,
  existsSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  lstatSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import {spawnSync} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import {dirname, join, relative, resolve, sep} from 'node:path'
import {fileURLToPath} from 'node:url'

const args = process.argv.slice(2)
if (args.length !== 2 || args[0] !== '--target') {
  process.stderr.write('Usage: node .claude/scripts/deploy-harness.mjs --target <existing-project-directory>\n')
  process.exit(2)
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const sourceRoot = realpathSync(resolve(scriptDirectory, '..', '..'))
const sourceValidation = spawnSync(process.execPath, [join(scriptDirectory, 'validate-harness.mjs')], {
  cwd: sourceRoot,
  encoding: 'utf8',
  env: {...process.env, PATH: [dirname(process.execPath), process.env.PATH].filter(Boolean).join(process.platform === 'win32' ? ';' : ':')},
  timeout: 120_000,
})
if (sourceValidation.status !== 0) {
  process.stderr.write('Source control plane must pass validate-harness.mjs before deployment.\n')
  process.exit(1)
}
let targetRoot
try {
  targetRoot = realpathSync(resolve(args[1]))
} catch {
  process.stderr.write('Harness target must be an existing directory.\n')
  process.exit(2)
}

const offset = relative(sourceRoot, targetRoot)
const insideSource = offset !== '..' && !offset.startsWith(`..${sep}`)
const firstSegment = offset.split(sep)[0]
if (
  !insideSource ||
  targetRoot === sourceRoot ||
  ['.claude', '.git', '_workspace'].includes(firstSegment) ||
  !statSync(targetRoot).isDirectory()
) {
  process.stderr.write('Harness target must be a child project directory inside the current repository.\n')
  process.exit(2)
}

const targetClaude = join(targetRoot, '.claude')
if (existsSync(targetClaude)) {
  process.stderr.write('Target .claude already exists; refusing to overwrite an existing control plane.\n')
  process.exit(2)
}

for (const pin of ['.node-version', '.nvmrc']) {
  const sourceValue = readFileSync(join(sourceRoot, pin), 'utf8')
  const targetPath = join(targetRoot, pin)
  if (existsSync(targetPath) && readFileSync(targetPath, 'utf8') !== sourceValue) {
    process.stderr.write(`${pin} conflicts with the harness toolchain pin.\n`)
    process.exit(2)
  }
}

const deploymentToken = randomUUID()
const deploymentLockPath = join(targetRoot, '.web-harness-deploy.lock')
try {
  const descriptor = openSync(deploymentLockPath, 'wx', 0o600)
  try {
    writeFileSync(descriptor, `${deploymentToken}\n`)
  } finally {
    closeSync(descriptor)
  }
} catch {
  process.stderr.write('Another harness deployment or an unreviewed deployment lock exists for this target.\n')
  process.exit(2)
}
const stagingRoot = mkdtempSync(join(targetRoot, '.web-harness-stage-'))
const createdPins = []
let promoted = false
const deploymentOwnerPath = join(targetClaude, '.web-harness-deployment-owner')
const removeOwnedLock = () => {
  try {
    if (readFileSync(deploymentLockPath, 'utf8').trim() === deploymentToken) rmSync(deploymentLockPath, {force: true})
  } catch {}
}
const rejectSymlinks = directory => {
  for (const entry of readdirSync(directory, {withFileTypes: true})) {
    const path = join(directory, entry.name)
    if (lstatSync(path).isSymbolicLink()) throw new Error(`Control-plane symlink is not deployable: ${relative(sourceRoot, path)}`)
    if (entry.isDirectory()) rejectSymlinks(path)
  }
}
try {
  rejectSymlinks(join(sourceRoot, '.claude'))
  for (const directory of ['skills', 'agents', 'scripts', 'evals', 'adapters', 'schemas']) {
    cpSync(join(sourceRoot, '.claude', directory), join(stagingRoot, directory), {
      recursive: true,
      errorOnExist: true,
      force: false,
    })
  }
  copyFileSync(join(sourceRoot, '.claude', 'README.md'), join(stagingRoot, 'README.md'))
  copyFileSync(join(sourceRoot, '.claude', 'settings.project.json'), join(stagingRoot, 'settings.json'))
  copyFileSync(join(sourceRoot, '.claude', 'settings.project.json'), join(stagingRoot, 'settings.project.json'))
  // 배포된 control plane 판별 마커 — validate-adapter-hygiene가 source repo 전용 검사
  // (README inventory 등)를 배포 target에서 건너뛰는 명시적 근거다.
  writeFileSync(
    join(stagingRoot, 'deployment.json'),
    `${JSON.stringify({schemaVersion: 1, source: 'web-harness-control-plane', deployedAt: new Date().toISOString()}, null, 2)}\n`,
  )
  writeFileSync(join(stagingRoot, '.web-harness-deployment-owner'), `${deploymentToken}\n`, {mode: 0o600})
  if (existsSync(targetClaude)) throw new Error('Target .claude appeared while deployment was staged')
  renameSync(stagingRoot, targetClaude)
  promoted = true
  for (const pin of ['.node-version', '.nvmrc']) {
    const targetPath = join(targetRoot, pin)
    if (!existsSync(targetPath)) {
      copyFileSync(join(sourceRoot, pin), targetPath, constants.COPYFILE_EXCL)
      const pinStats = lstatSync(targetPath)
      createdPins.push({path: targetPath, ino: pinStats.ino})
    }
  }
  const targetValidation = spawnSync(process.execPath, [join(targetClaude, 'scripts/validate-harness.mjs')], {
    cwd: targetRoot,
    encoding: 'utf8',
    env: {...process.env, PATH: [dirname(process.execPath), process.env.PATH].filter(Boolean).join(process.platform === 'win32' ? ';' : ':')},
    timeout: 120_000,
  })
  if (targetValidation.status !== 0) {
    throw new Error(`deployed control plane validation failed: ${targetValidation.stderr || targetValidation.stdout}`)
  }
  rmSync(deploymentOwnerPath, {force: true})
  removeOwnedLock()
} catch (error) {
  rmSync(stagingRoot, {recursive: true, force: true})
  let ownsPromotedControlPlane = false
  try {
    ownsPromotedControlPlane = promoted &&
      lstatSync(deploymentOwnerPath).isFile() &&
      readFileSync(deploymentOwnerPath, 'utf8').trim() === deploymentToken
  } catch {}
  if (ownsPromotedControlPlane) rmSync(targetClaude, {recursive: true, force: true})
  for (const pin of createdPins) {
    try {
      if (
        lstatSync(pin.path).isFile() &&
        lstatSync(pin.path).ino === pin.ino &&
        readFileSync(pin.path, 'utf8') === readFileSync(join(sourceRoot, pin.path.split(sep).at(-1)), 'utf8')
      ) rmSync(pin.path, {force: true})
    } catch {}
  }
  removeOwnedLock()
  if (promoted && !ownsPromotedControlPlane) {
    process.stderr.write('Harness rollback did not remove target .claude because deployment ownership could not be proven.\n')
  }
  process.stderr.write(`Harness deployment failed: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  target: offset.split(sep).join('/'),
  copied: ['README.md', 'skills', 'agents', 'scripts', 'evals', 'adapters', 'schemas', 'settings.json', 'settings.project.json', 'deployment.json'],
  toolchainPins: ['.node-version', '.nvmrc'],
})}\n`)
