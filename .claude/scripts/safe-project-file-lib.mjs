import {randomUUID} from 'node:crypto'
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  writeSync,
} from 'node:fs'
import {isAbsolute, join, relative, resolve, sep} from 'node:path'

const inside = (root, target) => {
  const offset = relative(root, target)
  return offset === '' || (offset !== '..' && !offset.startsWith(`..${sep}`) && !isAbsolute(offset))
}

const projectRootPath = projectPath => {
  const root = realpathSync(resolve(projectPath))
  const stats = lstatSync(root)
  if (!stats.isDirectory()) throw new Error('project root must be a real directory')
  return root
}

const safeSegments = relativePath => {
  if (
    typeof relativePath !== 'string' ||
    relativePath.includes('\0') ||
    isAbsolute(relativePath) ||
    /^[A-Za-z]:[\\/]/.test(relativePath)
  ) throw new Error('project file path must be relative')
  const segments = relativePath.split(/[\\/]/)
  if (segments.length === 0 || segments.some(segment => !segment || segment === '.' || segment === '..')) {
    throw new Error('project file path contains an unsafe segment')
  }
  return segments
}

const inspectDirectory = (root, segments, {create}) => {
  let directory = root
  for (const segment of segments) {
    const candidate = join(directory, segment)
    if (!existsSync(candidate)) {
      if (!create) throw new Error('project file parent directory is missing')
      mkdirSync(candidate, {mode: 0o700})
    }
    const stats = lstatSync(candidate)
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error('project file parent must be a real non-symlink directory')
    }
    const canonical = realpathSync(candidate)
    if (!inside(root, canonical)) throw new Error('project file parent escapes the project')
    directory = canonical
  }
  return directory
}

const destinationPath = (projectPath, relativePath, {createParent}) => {
  const root = projectRootPath(projectPath)
  const segments = safeSegments(relativePath)
  const name = segments.pop()
  const directory = inspectDirectory(root, segments, {create: createParent})
  return {root, segments, directory, name, path: join(directory, name)}
}

const assertRegularDestination = path => {
  if (!existsSync(path)) return
  const stats = lstatSync(path)
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error('project file destination must be a regular non-symlink file')
  }
}

export const atomicWriteProjectFile = (projectPath, relativePath, source, {maxBytes = 4 * 1024 * 1024} = {}) => {
  const content = Buffer.isBuffer(source) ? source : Buffer.from(source)
  if (content.length > maxBytes) throw new Error('project file content exceeds the size limit')
  const destination = destinationPath(projectPath, relativePath, {createParent: true})
  assertRegularDestination(destination.path)
  const temporaryPath = join(destination.directory, `.${destination.name}.${randomUUID()}.tmp`)
  let descriptor
  try {
    descriptor = openSync(
      temporaryPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o600,
    )
    let offset = 0
    while (offset < content.length) offset += writeSync(descriptor, content, offset, content.length - offset, offset)
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = undefined

    const confirmedDirectory = inspectDirectory(destination.root, destination.segments, {create: false})
    if (confirmedDirectory !== destination.directory) throw new Error('project file parent changed during writing')
    assertRegularDestination(destination.path)
    renameSync(temporaryPath, destination.path)
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
    rmSync(temporaryPath, {force: true})
  }
  return destination.path
}

export const readProjectRegularFile = (projectPath, relativePath, {maxBytes = 4 * 1024 * 1024} = {}) => {
  const destination = destinationPath(projectPath, relativePath, {createParent: false})
  const before = lstatSync(destination.path, {bigint: true})
  if (before.isSymbolicLink() || !before.isFile()) {
    throw new Error('project file must be a regular non-symlink file')
  }
  let descriptor
  try {
    descriptor = openSync(destination.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    const opened = fstatSync(descriptor, {bigint: true})
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) {
      throw new Error('project file changed while being opened')
    }
    if (opened.size > BigInt(maxBytes)) throw new Error('project file exceeds the size limit')
    const content = Buffer.alloc(Number(opened.size))
    let offset = 0
    while (offset < content.length) {
      const bytesRead = readSync(descriptor, content, offset, content.length - offset, offset)
      if (bytesRead === 0) break
      offset += bytesRead
    }
    if (offset !== content.length) throw new Error('project file changed while being read')

    const confirmedDirectory = inspectDirectory(destination.root, destination.segments, {create: false})
    const after = lstatSync(join(confirmedDirectory, destination.name), {bigint: true})
    if (
      confirmedDirectory !== destination.directory ||
      after.isSymbolicLink() ||
      !after.isFile() ||
      after.dev !== opened.dev ||
      after.ino !== opened.ino
    ) throw new Error('project file changed while being read')
    return content
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}
