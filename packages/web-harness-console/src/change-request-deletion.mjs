import {existsSync, lstatSync, mkdtempSync, readdirSync, realpathSync, renameSync, rmSync} from 'node:fs'
import {basename, join, sep} from 'node:path'

const CHANGE_REQUEST_ID = /^CHG-\d{8}-\d{3}$/
const CHANGE_REQUEST_DIRECTORY = 'change-requests'
const REVISION_DIRECTORY = 'change-request-revisions'
const RUN_DIRECTORY = 'codex-runs'
const DECISION_DIRECTORY = 'change-request-decisions'
const CANDIDATE_DIRECTORY = 'change-candidates'

export class ChangeRequestDeletionError extends Error {
  constructor(code, message, status = 409) {
    super(message)
    this.name = 'ChangeRequestDeletionError'
    this.code = code
    this.status = status
  }
}

const isContained = (path, root) => path === root || path.startsWith(root + sep)

const safeDirectory = (path, containmentRoot, {required = false} = {}) => {
  if (!existsSync(path)) {
    if (required) throw new ChangeRequestDeletionError('CHANGE_REQUEST_DELETE_UNSAFE', 'Required Change Request storage is unavailable')
    return null
  }
  const stat = lstatSync(path)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new ChangeRequestDeletionError('CHANGE_REQUEST_DELETE_UNSAFE', 'Change Request storage is not a safe directory')
  const real = realpathSync(path)
  if (!isContained(real, containmentRoot)) throw new ChangeRequestDeletionError('CHANGE_REQUEST_DELETE_UNSAFE', 'Change Request storage escapes the project boundary')
  return real
}

const safeArtifact = (path, storageRoot, type) => {
  const stat = lstatSync(path)
  const valid = type === 'directory' ? stat.isDirectory() : stat.isFile()
  if (!valid || stat.isSymbolicLink()) throw new ChangeRequestDeletionError('CHANGE_REQUEST_DELETE_UNSAFE', 'A Change Request artifact is not a safe filesystem entry')
  const real = realpathSync(path)
  if (!isContained(real, storageRoot)) throw new ChangeRequestDeletionError('CHANGE_REQUEST_DELETE_UNSAFE', 'A Change Request artifact escapes its storage boundary')
  return real
}

const matchingArtifacts = (directory, pattern, type) => {
  if (!directory) return []
  return readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
    if (!pattern.test(entry.name)) return []
    return [safeArtifact(join(directory, entry.name), directory, type)]
  })
}

export const deleteChangeRequestArtifacts = (projectRoot, changeRequestId, {beforeMove = null} = {}) => {
  if (!CHANGE_REQUEST_ID.test(changeRequestId ?? '')) {
    throw new ChangeRequestDeletionError('CHANGE_REQUEST_DELETE_INVALID', 'Change Request ID is invalid', 400)
  }
  const root = realpathSync(projectRoot)
  const workspace = safeDirectory(join(root, '_workspace'), root, {required: true})
  const plan = safeDirectory(join(workspace, '01_plan'), workspace, {required: true})
  const requestRoot = safeDirectory(join(plan, CHANGE_REQUEST_DIRECTORY), plan)
  const requestPath = requestRoot ? join(requestRoot, `${changeRequestId}.md`) : null
  if (!requestPath || !existsSync(requestPath)) return {deleted: false, artifactCount: 0}

  const development = safeDirectory(join(workspace, '03_dev'), workspace)
  const revisionRoot = safeDirectory(join(plan, REVISION_DIRECTORY), plan)
  const runRoot = development ? safeDirectory(join(development, RUN_DIRECTORY), development) : null
  const decisionRoot = development ? safeDirectory(join(development, DECISION_DIRECTORY), development) : null
  const candidateRoot = development ? safeDirectory(join(development, CANDIDATE_DIRECTORY), development) : null
  const escapedId = changeRequestId.replaceAll('-', '\\-')
  const revisionPattern = new RegExp(`^${escapedId}-REV-\\d{3}\\.md$`)
  const runPattern = new RegExp(`^RUN-${escapedId}-(?:impact|apply)-[0-9a-f-]{36}\\.jsonl$`, 'i')
  const candidatePattern = new RegExp(`^RUN-${escapedId}-apply-[0-9a-f-]{36}$`, 'i')
  const artifacts = [
    ...matchingArtifacts(candidateRoot, candidatePattern, 'directory'),
    ...matchingArtifacts(runRoot, runPattern, 'file'),
    ...matchingArtifacts(revisionRoot, revisionPattern, 'file'),
  ]
  if (decisionRoot) {
    const decisionPath = join(decisionRoot, `${changeRequestId}.jsonl`)
    if (existsSync(decisionPath)) artifacts.push(safeArtifact(decisionPath, decisionRoot, 'file'))
  }
  artifacts.push(safeArtifact(requestPath, requestRoot, 'file'))

  const staging = mkdtempSync(join(plan, '.change-request-delete-'))
  const moved = []
  try {
    for (const [index, artifact] of artifacts.entries()) {
      beforeMove?.(artifact, index)
      const staged = join(staging, `${String(index).padStart(4, '0')}-${basename(artifact)}`)
      renameSync(artifact, staged)
      moved.push({artifact, staged})
    }
  } catch (error) {
    let rollbackError = null
    for (const item of [...moved].reverse()) {
      try {
        if (existsSync(item.staged)) renameSync(item.staged, item.artifact)
      } catch (failure) {
        rollbackError ??= failure
      }
    }
    rmSync(staging, {recursive: true, force: true})
    throw new ChangeRequestDeletionError(
      'CHANGE_REQUEST_DELETE_FAILED',
      rollbackError ? 'Change Request deletion failed and could not be fully rolled back' : 'Change Request deletion failed; no artifacts were removed',
    )
  }
  rmSync(staging, {recursive: true, force: true})
  return {deleted: true, artifactCount: artifacts.length}
}
