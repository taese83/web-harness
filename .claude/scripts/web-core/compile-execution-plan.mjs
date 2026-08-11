#!/usr/bin/env node

import {isAbsolute, relative, resolve, sep} from 'node:path'
import {loadBuiltinAdapter} from './adapter-lib.mjs'
import {parseArgv, runCli, WebCoreError} from './core-lib.mjs'
import {compileCapabilityDag} from './dag-lib.mjs'
import {adapterCheckBindings, projectProfileSha256, readLockedProjectProfile} from './profile-policy-lib.mjs'

runCli(() => {
  const args = parseArgv(process.argv.slice(2), {
    '--profile': 'value',
    '--profile-file': 'value',
    '--target': 'repeatable',
  })
  if (!args.profile && !args['profile-file']) {
    throw new WebCoreError('PROFILE_REQUIRED', '--profile or --profile-file is required')
  }
  let profileBinding = null
  let adapter
  let targets
  if (args['profile-file']) {
    const root = resolve(process.cwd())
    const profilePath = resolve(root, args['profile-file'])
    const offset = relative(root, profilePath)
    if (offset === '..' || offset.startsWith(`..${sep}`) || isAbsolute(offset)) {
      throw new WebCoreError('PROFILE_PATH_OUTSIDE_PROJECT', '--profile-file must stay inside the project root')
    }
    const locked = readLockedProjectProfile(profilePath)
    if (args.profile && args.profile !== locked.adapter.id) {
      throw new WebCoreError('PROFILE_CONFLICT', '--profile does not match --profile-file')
    }
    adapter = locked.adapter
    const requiredEvidence = adapterCheckBindings({
      adapter,
      deploymentProvider: locked.selection.provider.id,
      deploymentTarget: locked.selection.target.id,
      capabilities: locked.selection.selectedCapabilities,
    }).map(binding => binding.evidenceCapability)
    targets = [...(args.target ?? [locked.selection.releaseTarget]), ...requiredEvidence]
    profileBinding = {
      adapterSha256: locked.profile.adapter.sha256,
      profileSha256: projectProfileSha256(locked.profile),
      deploymentProvider: locked.selection.provider.id,
      deploymentTarget: locked.selection.target.id,
      selectedCapabilities: locked.selection.selectedCapabilities,
    }
  } else {
    if (args.target) {
      throw new WebCoreError('PROFILE_FILE_REQUIRED_FOR_TARGET', 'Custom target compilation requires --profile-file capability binding')
    }
    adapter = loadBuiltinAdapter(args.profile)
    targets = args.target ?? adapter.targetCapabilities
  }
  return {...compileCapabilityDag(adapter, targets), profileBinding}
})
