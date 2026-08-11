#!/usr/bin/env node

import {parseArgv, runCli} from './core-lib.mjs'
import {resolveProjectProfile} from './profile-lib.mjs'

runCli(() => {
  const args = parseArgv(process.argv.slice(2), {
    '--project-root': 'value',
    '--requested': 'value',
    '--provider': 'value',
    '--deployment': 'value',
    '--capability': 'repeatable',
  })
  return resolveProjectProfile({
    projectRoot: args['project-root'],
    requested: args.requested ?? 'auto',
    deploymentProvider: args.provider,
    deploymentTarget: args.deployment,
    capabilities: args.capability,
  })
})
