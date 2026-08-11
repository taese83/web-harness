import {sha256} from './evidence-lib.mjs'
import {validateRuntimeDataArtifacts} from './runtime-data-contract-lib.mjs'
import {readProjectRegularFile} from './safe-project-file-lib.mjs'

const STATIC_DEPLOYMENT_TARGETS = new Set(['container-static', 'static-cdn', 'static-export'])
const MAX_RUNTIME_DATA_COPY_BYTES = 16 * 1024 * 1024

const readBoundedCopy = (projectRoot, path, errors, label) => {
  try {
    const source = readProjectRegularFile(projectRoot, path, {maxBytes: MAX_RUNTIME_DATA_COPY_BYTES})
    return {source, sha256: sha256(source)}
  } catch (error) {
    errors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

/**
 * Bind promoted public runtime data to the static directory that is actually
 * released. Vite and Next static export copy public/<path> to <output>/<path>;
 * accepting only byte-identical copies prevents a build step from silently
 * dropping, rewriting, or replacing already-validated snapshot data.
 */
export const validateStaticRuntimeDataDeployment = ({
  projectRoot,
  lockedProfile,
}) => {
  const target = lockedProfile?.selection?.target?.id ?? null
  if (!STATIC_DEPLOYMENT_TARGETS.has(target)) {
    return {ok: true, applicable: false, errors: [], runtimeDataEvidenceSha256: null, copies: []}
  }

  const errors = []
  const copies = []
  const outputs = (lockedProfile.selection.artifacts ?? []).filter(artifact => artifact.kind === 'static-directory')
  if (outputs.length !== 1) {
    errors.push('Static runtime data deployment requires exactly one selected static-directory artifact')
    return {ok: false, applicable: true, errors, runtimeDataEvidenceSha256: null, copies}
  }
  const [output] = outputs
  const runtimeDataValidation = validateRuntimeDataArtifacts(projectRoot, {
    mutableArtifactRoots: lockedProfile.selection.artifacts.map(artifact => artifact.path),
  })
  if (!runtimeDataValidation.ok) {
    errors.push(`Static runtime data is not semantically valid: ${runtimeDataValidation.errors.join('; ')}`)
    return {ok: false, applicable: true, errors, runtimeDataEvidenceSha256: null, copies}
  }

  const evidenceByPath = new Map(
    runtimeDataValidation.evidenceFiles.map(file => [file.path.toLowerCase(), file]),
  )
  const deploymentSources = new Map()
  const addDeploymentSource = (path, kind) => {
    const key = path.toLowerCase()
    const evidence = evidenceByPath.get(key)
    if (!evidence || evidence.path !== path) {
      errors.push(`Validated ${kind} evidence is missing or path-aliased: ${path}`)
      return
    }
    if (!path.startsWith('public/') || path === 'public/') {
      errors.push(`Static ${kind} must be promoted under public/: ${path}`)
      return
    }
    deploymentSources.set(key, {path, kind, evidenceSha256: evidence.sha256})
  }

  const generatedArtifacts = runtimeDataValidation.contract?.generatedArtifacts ?? []
  const validatedArtifactPaths = new Set(
    (runtimeDataValidation.evidence?.artifacts ?? []).map(artifact => artifact.path.toLowerCase()),
  )
  for (const artifact of generatedArtifacts) {
    const validated = validatedArtifactPaths.has(artifact.path.toLowerCase())
    if (artifact.required && !validated) {
      errors.push(`Required static runtime artifact lacks current semantic evidence: ${artifact.path}`)
      continue
    }
    if (!validated) continue
    if (artifact.required || artifact.path.startsWith('public/')) {
      addDeploymentSource(artifact.path, artifact.required ? 'runtime artifact' : 'optional runtime artifact')
    }
    const baselinePath = artifact.validation?.diff?.baselinePath
    if (!baselinePath) continue
    if (baselinePath.startsWith('public/')) {
      addDeploymentSource(baselinePath, 'last-known-good baseline')
    } else if (runtimeDataValidation.contract.servingFallback === 'last-known-good' && artifact.required) {
      errors.push(`Static last-known-good fallback must be promoted under public/: ${baselinePath}`)
    }
  }

  for (const {path, kind, evidenceSha256} of deploymentSources.values()) {
    const deployedPath = `${output.path}/${path.slice('public/'.length)}`
    const promoted = readBoundedCopy(projectRoot, path, errors, `Promoted ${kind} ${path}`)
    const deployed = readBoundedCopy(projectRoot, deployedPath, errors, `Deployed runtime artifact ${deployedPath}`)
    if (!promoted || !deployed) continue
    if (promoted.sha256 !== evidenceSha256) {
      errors.push(`Promoted ${kind} changed after semantic validation: ${path}`)
    }
    copies.push({
      kind,
      sourcePath: path,
      sourceSha256: promoted.sha256,
      evidenceSha256,
      deployedPath,
      deployedSha256: deployed.sha256,
    })
    if (promoted.sha256 !== deployed.sha256) {
      errors.push(`Deployed runtime artifact is not byte-identical to its promoted source: ${deployedPath}`)
    }
  }

  if (!generatedArtifacts.some(artifact => artifact.required === true)) {
    errors.push('Static runtime data deployment requires at least one required generated artifact')
  }
  return {
    ok: errors.length === 0,
    applicable: true,
    errors,
    runtimeDataEvidenceSha256: runtimeDataValidation.evidenceSha256,
    copies: copies.sort((left, right) => left.sourcePath.localeCompare(right.sourcePath)),
  }
}
