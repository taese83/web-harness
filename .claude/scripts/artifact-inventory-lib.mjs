import {createHash} from 'node:crypto'
import {closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readSync, readdirSync} from 'node:fs'
import {isAbsolute, join, relative, resolve, sep} from 'node:path'

const normalize = value => value.split(sep).join('/')
const MAX_ARTIFACT_FILE_BYTES = 2 * 1024 * 1024 * 1024
const MAX_ARTIFACT_TOTAL_BYTES = 4 * 1024 * 1024 * 1024
const metadataDigest = stats => `mode:${stats.mode & 0o7777}\0uid:${stats.uid}\0gid:${stats.gid}\0`

const updateHashFromFile = (hash, path, remainingBytes) => {
  const descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  try {
    const stats = fstatSync(descriptor)
    if (!stats.isFile()) throw new Error(`Deployment artifact entry changed during inventory: ${path}`)
    if (stats.size > MAX_ARTIFACT_FILE_BYTES) throw new Error(`Deployment artifact file exceeds 2 GiB: ${path}`)
    if (stats.size > remainingBytes) throw new Error('Deployment artifact exceeds 4 GiB')
    hash.update(metadataDigest(stats))
    for (;;) {
      const bytesRead = readSync(descriptor, buffer, 0, buffer.length, null)
      if (bytesRead === 0) break
      hash.update(buffer.subarray(0, bytesRead))
    }
    return stats.size
  } finally {
    closeSync(descriptor)
  }
}

export const inspectDeploymentArtifact = (projectPath, declaration) => {
  const projectRoot = resolve(projectPath)
  const absoluteRoot = resolve(projectRoot, declaration.path)
  const offset = relative(projectRoot, absoluteRoot)
  if (offset === '..' || offset.startsWith(`..${sep}`) || isAbsolute(offset)) {
    throw new Error(`Deployment artifact escapes the project: ${declaration.path}`)
  }
  if (!existsSync(absoluteRoot)) return null
  const rootStats = lstatSync(absoluteRoot)
  if (!rootStats.isDirectory()) throw new Error(`Deployment artifact must be a directory: ${declaration.path}`)

  const files = []
  const directories = [['', rootStats]]
  const pending = [[absoluteRoot, '']]
  let entryCount = 0
  while (pending.length) {
    const [directory, prefix] = pending.pop()
    for (const entry of readdirSync(directory, {withFileTypes: true})) {
      const relativePath = normalize(join(prefix, entry.name))
      const absolutePath = join(directory, entry.name)
      entryCount += 1
      if (entryCount > 50_000) throw new Error(`Deployment artifact exceeds 50000 entries: ${declaration.path}`)
      if (entry.isSymbolicLink()) throw new Error(`Deployment artifact contains a symlink: ${declaration.path}/${relativePath}`)
      if (entry.isDirectory()) {
        const stats = lstatSync(absolutePath)
        if (!stats.isDirectory()) throw new Error(`Deployment artifact entry changed during inventory: ${declaration.path}/${relativePath}`)
        directories.push([relativePath, stats])
        pending.push([absolutePath, relativePath])
      }
      else if (entry.isFile()) files.push([relativePath, absolutePath])
      else throw new Error(`Deployment artifact contains an unsupported entry: ${declaration.path}/${relativePath}`)
    }
  }
  if (files.length === 0) throw new Error(`Deployment artifact is empty: ${declaration.path}`)

  const hash = createHash('sha256')
  let totalBytes = 0
  for (const [relativePath, stats] of directories.sort((left, right) => left[0].localeCompare(right[0]))) {
    hash.update(`directory:${relativePath || '.'}\0`)
    hash.update(metadataDigest(stats))
  }
  for (const [relativePath, absolutePath] of files.sort((left, right) => left[0].localeCompare(right[0]))) {
    hash.update(relativePath)
    hash.update('\0')
    try {
      totalBytes += updateHashFromFile(hash, absolutePath, MAX_ARTIFACT_TOTAL_BYTES - totalBytes)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`${message}: ${declaration.path}/${relativePath}`)
    }
    hash.update('\0')
  }
  return {
    id: declaration.id,
    path: declaration.path,
    kind: declaration.kind,
    sha256: hash.digest('hex'),
    fileCount: files.length,
    directoryCount: directories.length,
    totalBytes,
  }
}

export const collectDeploymentArtifacts = (projectRoot, declarations, {requireAll = false} = {}) => {
  const artifacts = []
  const errors = []
  for (const declaration of declarations) {
    try {
      const artifact = inspectDeploymentArtifact(projectRoot, declaration)
      if (artifact) artifacts.push(artifact)
      else if (requireAll) errors.push(`Required deployment artifact is missing: ${declaration.path}`)
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }
  return {
    artifacts: artifacts.sort((left, right) => left.path.localeCompare(right.path)),
    errors,
  }
}
