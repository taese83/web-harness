import {createHash} from 'node:crypto'
import {
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join, relative, resolve, sep} from 'node:path'

const RUN_ID_PATTERN = /^RUN-CHG-\d{8}-\d{3}-apply-[0-9a-f-]{36}$/i
const MAX_SOURCE_FILES = 20_000
const MAX_SOURCE_BYTES = 128 * 1024 * 1024
const MAX_SOURCE_FILE_BYTES = 16 * 1024 * 1024
const MAX_CHANGED_FILES = 512
const MAX_CHANGED_BYTES = 32 * 1024 * 1024
const SHA256_PATTERN = /^[0-9a-f]{64}$/
const EXCLUDED_DIRECTORIES = new Set(['.git', '.next', '.turbo', 'build', 'cache', 'coverage', 'dist', 'node_modules', 'out'])
const EXCLUDED_AUDIT_PREFIXES = [
  '_workspace/01_plan/change-requests',
  '_workspace/01_plan/change-request-revisions',
  '_workspace/03_dev/change-candidates',
  '_workspace/03_dev/change-request-decisions',
  '_workspace/03_dev/codex-runs',
]

export class ChangeCandidateError extends Error {
  constructor(code, message, status = 409) {
    super(message)
    this.name = 'ChangeCandidateError'
    this.code = code
    this.status = status
  }
}

const normalizeRelative = value => value.split(sep).join('/')

const isExcluded = path => {
  const segments = path.split('/')
  if (segments.some(segment => EXCLUDED_DIRECTORIES.has(segment))) return true
  return EXCLUDED_AUDIT_PREFIXES.some(prefix => path === prefix || path.startsWith(`${prefix}/`))
}

const hashBuffer = value => createHash('sha256').update(value).digest('hex')

const assertContainedPath = (root, path) => {
  const candidate = resolve(root, path)
  if (candidate !== root && !candidate.startsWith(root + sep)) {
    throw new ChangeCandidateError('CANDIDATE_PATH_UNSAFE', 'Candidate path is outside the project boundary')
  }
  return candidate
}

const safeDirectory = path => {
  try {
    const stat = lstatSync(path)
    return stat.isDirectory() && !stat.isSymbolicLink()
  } catch {
    return false
  }
}

const safeFile = path => {
  try {
    const stat = lstatSync(path)
    return stat.isFile() && !stat.isSymbolicLink()
  } catch {
    return false
  }
}

const snapshotTree = rootPath => {
  const root = realpathSync(rootPath)
  const entries = new Map()
  let totalBytes = 0
  const walk = directory => {
    for (const entry of readdirSync(directory, {withFileTypes: true})) {
      const absolute = join(directory, entry.name)
      const path = normalizeRelative(relative(root, absolute))
      if (isExcluded(path)) continue
      const stat = lstatSync(absolute)
      if (stat.isSymbolicLink()) throw new ChangeCandidateError('CANDIDATE_SYMLINK_UNSUPPORTED', `Candidate source contains a symlink: ${path}`)
      if (stat.isDirectory()) {
        walk(absolute)
        continue
      }
      if (!stat.isFile()) throw new ChangeCandidateError('CANDIDATE_FILE_UNSUPPORTED', `Candidate source contains an unsupported file: ${path}`)
      if (stat.size > MAX_SOURCE_FILE_BYTES) throw new ChangeCandidateError('CANDIDATE_FILE_TOO_LARGE', `Candidate source file is too large: ${path}`)
      totalBytes += stat.size
      if (entries.size + 1 > MAX_SOURCE_FILES || totalBytes > MAX_SOURCE_BYTES) {
        throw new ChangeCandidateError('CANDIDATE_SOURCE_LIMIT', 'Project exceeds the candidate snapshot file or byte budget')
      }
      const bytes = readFileSync(absolute)
      entries.set(path, {path, digest: hashBuffer(bytes), size: stat.size, mode: stat.mode & 0o777})
    }
  }
  walk(root)
  const digest = createHash('sha256')
  for (const entry of [...entries.values()].sort((left, right) => left.path.localeCompare(right.path))) {
    digest.update(`${entry.path}\0${entry.digest}\0${entry.size}\0${entry.mode}\n`)
  }
  return {root, entries, digest: digest.digest('hex'), fileCount: entries.size, totalBytes}
}

const copySnapshot = (snapshot, destination) => {
  mkdirSync(destination, {recursive: true, mode: 0o700})
  for (const entry of snapshot.entries.values()) {
    const source = assertContainedPath(snapshot.root, entry.path)
    const target = assertContainedPath(destination, entry.path)
    mkdirSync(dirname(target), {recursive: true, mode: 0o700})
    copyFileSync(source, target, constants.COPYFILE_FICLONE)
  }
}

const candidateStorageRoot = (projectRoot, {create = false} = {}) => {
  const root = realpathSync(projectRoot)
  const workspace = join(root, '_workspace')
  if (!safeDirectory(workspace)) throw new ChangeCandidateError('WORKSPACE_DIRECTORY_NOT_FOUND', 'Project workspace is unavailable')
  const development = join(workspace, '03_dev')
  if (create) mkdirSync(development, {recursive: true, mode: 0o700})
  if (!safeDirectory(development)) throw new ChangeCandidateError('CANDIDATE_STORAGE_UNSAFE', 'Candidate audit directory is unavailable')
  const candidates = join(development, 'change-candidates')
  if (create) mkdirSync(candidates, {recursive: true, mode: 0o700})
  if (!safeDirectory(candidates)) return null
  const real = realpathSync(candidates)
  if (real !== root && !real.startsWith(root + sep)) throw new ChangeCandidateError('CANDIDATE_STORAGE_UNSAFE', 'Candidate storage is outside the project boundary')
  return real
}

const candidateDirectory = (projectRoot, runId, {create = false} = {}) => {
  if (!RUN_ID_PATTERN.test(runId ?? '')) throw new ChangeCandidateError('CANDIDATE_RUN_INVALID', 'Candidate run ID is invalid')
  const storage = candidateStorageRoot(projectRoot, {create})
  if (!storage) return null
  const directory = join(storage, runId)
  if (create) mkdirSync(directory, {mode: 0o700})
  return directory
}

const changedEntries = (before, after) => {
  const paths = new Set([...before.entries.keys(), ...after.entries.keys()])
  const changes = []
  let changedBytes = 0
  for (const path of [...paths].sort()) {
    const previous = before.entries.get(path) ?? null
    const next = after.entries.get(path) ?? null
    if (previous?.digest === next?.digest && previous?.mode === next?.mode) continue
    const kind = previous && next ? 'modified' : next ? 'added' : 'deleted'
    changedBytes += next?.size ?? 0
    changes.push({
      path,
      kind,
      beforeDigest: previous?.digest ?? null,
      afterDigest: next?.digest ?? null,
      size: next?.size ?? 0,
      mode: next?.mode ?? previous?.mode ?? 0o600,
    })
  }
  if (changes.length > MAX_CHANGED_FILES || changedBytes > MAX_CHANGED_BYTES) {
    throw new ChangeCandidateError('CANDIDATE_CHANGE_LIMIT', 'Candidate exceeds the changed file or byte budget')
  }
  return changes
}

export const createCandidateWorkspace = projectRoot => {
  const baseline = snapshotTree(projectRoot)
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'web-harness-candidate-'))
  const worktreeRoot = join(temporaryRoot, 'project')
  try {
    copySnapshot(baseline, worktreeRoot)
    if (snapshotTree(worktreeRoot).digest !== baseline.digest) {
      throw new ChangeCandidateError('CANDIDATE_SOURCE_CHANGED', 'Project changed while the candidate snapshot was being created')
    }
    return {temporaryRoot, worktreeRoot, baseline}
  } catch (error) {
    rmSync(temporaryRoot, {recursive: true, force: true})
    throw error
  }
}

export const removeCandidateWorkspace = session => {
  if (session?.temporaryRoot) rmSync(session.temporaryRoot, {recursive: true, force: true})
}

export const finalizeCandidateWorkspace = (projectRoot, runId, session) => {
  try {
    const candidate = snapshotTree(session.worktreeRoot)
    const changes = changedEntries(session.baseline, candidate)
    if (changes.length === 0) throw new ChangeCandidateError('CANDIDATE_EMPTY', 'Executor reported a reviewable change but produced no candidate file changes')
    const directory = candidateDirectory(projectRoot, runId, {create: true})
    const files = join(directory, 'files')
    mkdirSync(files, {mode: 0o700})
    for (const change of changes) {
      if (change.kind === 'deleted') continue
      const source = assertContainedPath(session.worktreeRoot, change.path)
      const target = assertContainedPath(files, change.path)
      mkdirSync(dirname(target), {recursive: true, mode: 0o700})
      copyFileSync(source, target, constants.COPYFILE_FICLONE)
    }
    const manifest = {
      schemaVersion: 1,
      runId,
      status: 'READY',
      baseDigest: session.baseline.digest,
      candidateDigest: candidate.digest,
      baseFileCount: session.baseline.fileCount,
      baseBytes: session.baseline.totalBytes,
      changedFiles: changes,
    }
    writeFileSync(join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, {encoding: 'utf8', flag: 'wx', mode: 0o600})
    return {
      status: manifest.status,
      baseDigest: manifest.baseDigest,
      candidateDigest: manifest.candidateDigest,
      changedFiles: manifest.changedFiles.map(({path, kind, size}) => ({path, kind, size})),
    }
  } finally {
    removeCandidateWorkspace(session)
  }
}

const readCandidateManifest = (projectRoot, runId) => {
  const directory = candidateDirectory(projectRoot, runId)
  if (!directory || !safeDirectory(directory)) throw new ChangeCandidateError('CANDIDATE_NOT_FOUND', 'Candidate bundle is unavailable')
  try {
    const manifestPath = join(directory, 'manifest.json')
    if (!safeFile(manifestPath)) throw new ChangeCandidateError('CANDIDATE_INVALID', 'Candidate manifest is not a regular file')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    if (manifest?.schemaVersion !== 1 || manifest.runId !== runId || manifest.status !== 'READY' || !Array.isArray(manifest.changedFiles)) {
      throw new ChangeCandidateError('CANDIDATE_INVALID', 'Candidate manifest is invalid')
    }
    return {directory, manifest}
  } catch (error) {
    if (error instanceof ChangeCandidateError) throw error
    throw new ChangeCandidateError('CANDIDATE_INVALID', 'Candidate manifest could not be read')
  }
}

const validatedManifestChanges = (projectRoot, manifest) => {
  if (manifest.changedFiles.length === 0 || manifest.changedFiles.length > MAX_CHANGED_FILES) {
    throw new ChangeCandidateError('CANDIDATE_INVALID', 'Candidate manifest has an invalid changed-file count')
  }
  if (!SHA256_PATTERN.test(manifest.baseDigest ?? '') || !SHA256_PATTERN.test(manifest.candidateDigest ?? '')) {
    throw new ChangeCandidateError('CANDIDATE_INVALID', 'Candidate manifest digest is invalid')
  }
  const seen = new Set()
  let changedBytes = 0
  for (const change of manifest.changedFiles) {
    if (!change || typeof change !== 'object' || Array.isArray(change)) throw new ChangeCandidateError('CANDIDATE_INVALID', 'Candidate change entry is invalid')
    const path = change.path
    const segments = typeof path === 'string' ? path.split('/') : []
    if (!path || path.includes('\\') || segments.some(segment => !segment || segment === '.' || segment === '..') || isExcluded(path)) {
      throw new ChangeCandidateError('CANDIDATE_PATH_UNSAFE', 'Candidate path is outside the writable project boundary')
    }
    assertContainedPath(projectRoot, path)
    if (seen.has(path)) throw new ChangeCandidateError('CANDIDATE_INVALID', `Candidate path is duplicated: ${path}`)
    seen.add(path)
    if (!['added', 'modified', 'deleted'].includes(change.kind)) throw new ChangeCandidateError('CANDIDATE_INVALID', `Candidate change kind is invalid: ${path}`)
    if (!Number.isSafeInteger(change.size) || change.size < 0 || change.size > MAX_SOURCE_FILE_BYTES) throw new ChangeCandidateError('CANDIDATE_INVALID', `Candidate file size is invalid: ${path}`)
    if (!Number.isSafeInteger(change.mode) || change.mode < 0 || change.mode > 0o777) throw new ChangeCandidateError('CANDIDATE_INVALID', `Candidate file mode is invalid: ${path}`)
    const validBefore = change.beforeDigest === null || SHA256_PATTERN.test(change.beforeDigest ?? '')
    const validAfter = change.afterDigest === null || SHA256_PATTERN.test(change.afterDigest ?? '')
    if (!validBefore || !validAfter) throw new ChangeCandidateError('CANDIDATE_INVALID', `Candidate file digest is invalid: ${path}`)
    if (
      (change.kind === 'added' && (change.beforeDigest !== null || change.afterDigest === null))
      || (change.kind === 'modified' && (change.beforeDigest === null || change.afterDigest === null))
      || (change.kind === 'deleted' && (change.beforeDigest === null || change.afterDigest !== null || change.size !== 0))
    ) throw new ChangeCandidateError('CANDIDATE_INVALID', `Candidate change transition is invalid: ${path}`)
    changedBytes += change.size
  }
  if (changedBytes > MAX_CHANGED_BYTES) throw new ChangeCandidateError('CANDIDATE_CHANGE_LIMIT', 'Candidate exceeds the changed byte budget')
  return manifest.changedFiles
}

const restoreBackup = (projectRoot, backupRoot, changes) => {
  for (const change of [...changes].reverse()) {
    const target = assertContainedPath(projectRoot, change.path)
    const backup = assertContainedPath(backupRoot, change.path)
    if (existsSync(backup)) {
      mkdirSync(dirname(target), {recursive: true, mode: 0o700})
      copyFileSync(backup, target, constants.COPYFILE_FICLONE)
    } else {
      rmSync(target, {force: true})
    }
  }
}

export const beginCandidatePromotion = (projectRoot, runId) => {
  const root = realpathSync(projectRoot)
  const {directory, manifest} = readCandidateManifest(root, runId)
  const changes = validatedManifestChanges(root, manifest)
  const current = snapshotTree(root)
  if (current.digest === manifest.candidateDigest) return {alreadyApplied: true, commit() {}, rollback() {}}
  if (current.digest !== manifest.baseDigest) throw new ChangeCandidateError('CANDIDATE_BASE_STALE', 'Project changed after candidate creation; create a new candidate')
  const backupRoot = mkdtempSync(join(tmpdir(), 'web-harness-candidate-backup-'))
  try {
    for (const change of changes) {
      const target = assertContainedPath(root, change.path)
      if (existsSync(target)) {
        const stat = lstatSync(target)
        if (!stat.isFile() || stat.isSymbolicLink()) throw new ChangeCandidateError('CANDIDATE_TARGET_UNSAFE', `Candidate target is not a regular file: ${change.path}`)
        const backup = assertContainedPath(backupRoot, change.path)
        mkdirSync(dirname(backup), {recursive: true, mode: 0o700})
        copyFileSync(target, backup, constants.COPYFILE_FICLONE)
      }
    }
  } catch (error) {
    rmSync(backupRoot, {recursive: true, force: true})
    throw error
  }
  const applied = []
  try {
    for (const change of changes) {
      const target = assertContainedPath(root, change.path)
      applied.push(change)
      if (change.kind === 'deleted') {
        rmSync(target, {force: true})
      } else {
        const source = assertContainedPath(join(directory, 'files'), change.path)
        if (!safeFile(source)) throw new ChangeCandidateError('CANDIDATE_CONTENT_MISMATCH', `Candidate content is not a regular file: ${change.path}`)
        const bytes = readFileSync(source)
        if (hashBuffer(bytes) !== change.afterDigest) throw new ChangeCandidateError('CANDIDATE_CONTENT_MISMATCH', `Candidate content digest is invalid: ${change.path}`)
        mkdirSync(dirname(target), {recursive: true, mode: 0o700})
        copyFileSync(source, target, constants.COPYFILE_FICLONE)
      }
    }
    if (snapshotTree(root).digest !== manifest.candidateDigest) throw new ChangeCandidateError('CANDIDATE_PROMOTION_MISMATCH', 'Promoted project does not match the candidate digest')
  } catch (error) {
    restoreBackup(root, backupRoot, applied)
    rmSync(backupRoot, {recursive: true, force: true})
    throw error
  }
  let settled = false
  return {
    alreadyApplied: false,
    commit() {
      if (settled) return
      settled = true
      rmSync(backupRoot, {recursive: true, force: true})
    },
    rollback() {
      if (settled) return
      settled = true
      restoreBackup(root, backupRoot, changes)
      rmSync(backupRoot, {recursive: true, force: true})
    },
  }
}

export const changeCandidateConstants = {
  MAX_CHANGED_BYTES,
  MAX_CHANGED_FILES,
  MAX_SOURCE_BYTES,
  MAX_SOURCE_FILES,
}
