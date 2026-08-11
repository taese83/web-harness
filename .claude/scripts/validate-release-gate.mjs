#!/usr/bin/env node

import {resolve} from 'node:path'
import {buildReleaseManifest, validateReleaseGate} from './release-gate-lib.mjs'
import {atomicWriteProjectFile} from './safe-project-file-lib.mjs'

const args = process.argv.slice(2)
const projectFlagIndex = args.indexOf('--project')
const projectRoot = resolve(projectFlagIndex >= 0 ? args[projectFlagIndex + 1] ?? '' : process.cwd())
const writeManifest = args.includes('--write-manifest')

if (writeManifest) {
  try {
    const {manifest} = buildReleaseManifest(projectRoot)
    atomicWriteProjectFile(
      projectRoot,
      '_workspace/04_qa/qa-manifest.json',
      `${JSON.stringify(manifest, null, 2)}\n`,
    )
  } catch (error) {
    process.stderr.write(`QA manifest could not be written securely: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(2)
  }
}

const {errors} = validateReleaseGate(projectRoot)
if (errors.length > 0) {
  process.stderr.write(`Release gate blocked with ${errors.length} error(s):\n`)
  for (const error of errors) process.stderr.write(`- ${error}\n`)
  process.exit(1)
}

process.stdout.write('Release gate passed.\n')
