#!/usr/bin/env node

import {join, resolve} from 'node:path'
import {validateRuntimeDataArtifacts} from './runtime-data-contract-lib.mjs'
import {validateStaticRuntimeDataDeployment} from './runtime-data-deployment-lib.mjs'
import {
  readLockedProjectProfile,
  validateLockedProfileProjectState,
} from './web-core/profile-policy-lib.mjs'

const projectRoot = resolve(process.cwd())

try {
  const lockedProfile = readLockedProjectProfile(
    join(projectRoot, '_workspace/01_plan/project-profile.json'),
  )
  validateLockedProfileProjectState(lockedProfile, projectRoot)
  if (
    !lockedProfile.selection.selectedCapabilities.includes('external-ingestion') ||
    !['container-static', 'static-cdn', 'static-export'].includes(lockedProfile.selection.target.id)
  ) {
    throw new Error('Static deployment data validation requires a locked external-ingestion static target')
  }
  const semanticValidation = validateRuntimeDataArtifacts(projectRoot, {
    mutableArtifactRoots: lockedProfile.selection.artifacts.map(artifact => artifact.path),
  })
  if (!semanticValidation.ok) {
    throw new Error(`post-build runtime data is invalid: ${semanticValidation.errors.join('; ')}`)
  }
  const validation = validateStaticRuntimeDataDeployment({
    projectRoot,
    lockedProfile,
  })
  if (!validation.applicable || !validation.ok) {
    throw new Error(validation.errors.join('; ') || 'Static runtime deployment validation is not applicable')
  }
  process.stdout.write(`${JSON.stringify(validation)}\n`)
} catch (error) {
  process.stderr.write(`Static runtime data deployment validation failed: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
}
