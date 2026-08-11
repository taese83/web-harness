#!/usr/bin/env node

import {spawnSync} from 'node:child_process'
import {cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join, relative, resolve, sep} from 'node:path'
import {fileURLToPath} from 'node:url'
import {atomicWriteProjectFile} from './safe-project-file-lib.mjs'
import {validateIsolatedCohort} from './validate-isolated-cohort.mjs'

const args = process.argv.slice(2)
const profileIndex = args.indexOf('--profile')
const profileId = profileIndex >= 0 ? args[profileIndex + 1] : null
const checkIndex = args.indexOf('--check')
const checkId = checkIndex >= 0 ? args[checkIndex + 1] : null
const allowHostExecution = args.includes('--allow-host-execution')
const writeEvidence = args.includes('--write-evidence')
const verifyT1 = args.includes('--verify-t1')
const revisionIndex = args.indexOf('--expected-revision')
const expectedRevision = revisionIndex >= 0 ? args[revisionIndex + 1] : null
const count = value => args.filter(argument => argument === value).length
const expectedLength = 2 + Number(allowHostExecution) + Number(writeEvidence) + Number(verifyT1) +
  (checkId ? 2 : 0) + (expectedRevision ? 2 : 0)

if (
  !profileId ||
  !/^[a-z0-9][a-z0-9-]{0,63}$/.test(profileId) ||
  profileIndex + 1 >= args.length ||
  count('--profile') !== 1 ||
  count('--check') > 1 ||
  (checkIndex >= 0 && (!checkId || !/^[a-z0-9][a-z0-9.-]{0,127}$/.test(checkId))) ||
  count('--allow-host-execution') > 1 ||
  count('--write-evidence') > 1 ||
  count('--verify-t1') > 1 ||
  count('--expected-revision') > 1 ||
  (verifyT1 !== Boolean(expectedRevision)) ||
  (verifyT1 && (checkId || !writeEvidence || !/^[0-9a-f]{40}$/i.test(expectedRevision))) ||
  args.length !== expectedLength
) {
  process.stderr.write(
    'Usage: run-golden-profile.mjs --profile <id> [--check <id>] [--allow-host-execution] [--write-evidence] ' +
    '[--verify-t1 --expected-revision <full-sha>]\n',
  )
  process.exit(2)
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = realpathSync(resolve(scriptDirectory, '..', '..'))
const goldenRoot = realpathSync(join(repositoryRoot, 'golden'))
let sourceRoot
try {
  sourceRoot = realpathSync(join(goldenRoot, profileId))
} catch {
  process.stderr.write(`Unknown golden profile: ${profileId}\n`)
  process.exit(2)
}
const sourceOffset = relative(goldenRoot, sourceRoot)
if (
  sourceOffset === '..' ||
  sourceOffset.startsWith(`..${sep}`) ||
  sourceOffset !== profileId ||
  lstatSync(sourceRoot).isSymbolicLink() ||
  !existsSync(join(sourceRoot, 'node_modules/.pnpm/lock.yaml'))
) {
  process.stderr.write('Golden profile must be a real installed directory directly under golden/.\n')
  process.exit(2)
}

const scratchRoot = mkdtempSync(join(tmpdir(), `web-harness-golden-${profileId}-`))
const isolatedProject = join(scratchRoot, profileId)
const excludedRoots = new Set([
  '.vite',
  'coverage',
  'playwright-report',
  'test-results',
  '_workspace/04_qa/evidence',
])

try {
  cpSync(sourceRoot, isolatedProject, {
    recursive: true,
    verbatimSymlinks: true,
    filter: source => {
      const offset = relative(sourceRoot, source).split(sep).join('/')
      if (offset === 'dist' || offset.startsWith('dist/')) {
        return ['browser', 'vite.production-mock-boundary'].includes(checkId)
      }
      return ![...excludedRoots].some(root => offset === root || offset.startsWith(`${root}/`))
    },
  })

  const qualityArgs = [
    join(scriptDirectory, 'run-quality-gates.mjs'),
    '--project',
    isolatedProject,
    ...(checkId ? ['--check', checkId] : ['--all']),
    ...(allowHostExecution ? ['--allow-host-execution'] : []),
  ]
  const result = spawnSync(process.execPath, qualityArgs, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 40 * 1024 * 1024,
    timeout: 30 * 60 * 1000,
  })
  process.stdout.write(result.stdout ?? '')
  process.stderr.write(result.stderr ?? result.error?.message ?? '')
  let finalStatus = result.status ?? 1

  const isolatedEvidence = join(isolatedProject, '_workspace/04_qa/evidence')
  if (verifyT1 && finalStatus === 0) {
    try {
      const summary = validateIsolatedCohort({
        projectRoot: isolatedProject,
        declaredRevision: expectedRevision,
      })
      atomicWriteProjectFile(
        isolatedProject,
        '_workspace/04_qa/evidence/t1-summary.json',
        `${JSON.stringify(summary, null, 2)}\n`,
      )
      process.stdout.write('T1 isolated cohort prerequisites: PASS\n')
    } catch (error) {
      finalStatus = 1
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
      if (error?.details?.errors) {
        for (const detail of error.details.errors) process.stderr.write(`- ${detail}\n`)
      }
    }
  }
  if (writeEvidence && existsSync(isolatedEvidence)) {
    const destination = join(sourceRoot, '_workspace/04_qa/evidence')
    if (checkId) {
      mkdirSync(destination, {recursive: true})
      cpSync(join(isolatedEvidence, `${checkId}.json`), join(destination, `${checkId}.json`))
    } else {
      rmSync(destination, {recursive: true, force: true})
      mkdirSync(dirname(destination), {recursive: true})
      cpSync(isolatedEvidence, destination, {recursive: true})
    }
    process.stdout.write(`Golden evidence copied to golden/${profileId}/_workspace/04_qa/evidence.\n`)
  }
  const isolatedArtifact = join(isolatedProject, 'dist')
  if (writeEvidence && finalStatus === 0 && (!checkId || checkId === 'build') && existsSync(isolatedArtifact)) {
    const destination = join(sourceRoot, 'dist')
    rmSync(destination, {recursive: true, force: true})
    cpSync(isolatedArtifact, destination, {recursive: true})
    process.stdout.write(`Golden build artifact copied to golden/${profileId}/dist.\n`)
  }
  process.exitCode = finalStatus
} finally {
  rmSync(scratchRoot, {recursive: true, force: true})
}
