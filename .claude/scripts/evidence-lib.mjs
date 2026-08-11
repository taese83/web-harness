import {createHash} from 'node:crypto'
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  readdirSync,
  readlinkSync,
  realpathSync,
} from 'node:fs'
import {basename, join, relative, resolve, sep} from 'node:path'

const SOURCE_IGNORED_DIRECTORIES = new Set([
  '.aws',
  '.azure',
  '.docker',
  '.git',
  '.gnupg',
  '.kube',
  '.next',
  '.nuxt',
  '.output',
  '.parcel-cache',
  '.pnpm-store',
  '.ssh',
  '.turbo',
  '.vite',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'playwright-report',
  'secrets',
  'test-results',
])
const SOURCE_IGNORED_PREFIXES = ['_workspace/04_qa/', '_workspace/RELEASE/']
const SAFE_ENV_TEMPLATES = new Set(['.env.example', '.env.sample', '.env.template'])
const SECRET_BASENAMES = new Set([
  '.dev.vars', '.git-credentials', '.netrc', '.npmrc', '.pypirc', 'credentials.json', 'service-account.json',
])
const SECRET_EXTENSIONS = new Set(['.jks', '.key', '.keystore', '.p12', '.pem', '.pfx'])
const PROTECTED_GENERATED_ROOTS = new Set([
  '.aws', '.azure', '.claude', '.docker', '.git', '.github', '.gnupg', '.kube', '.ssh',
  '_workspace', 'node_modules', 'scripts', 'src',
])
const PACKAGE_METADATA_NAMES = new Set(['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'])
const MAX_SOURCE_FILES = 50_000
const MAX_SOURCE_FILE_BYTES = 64 * 1024 * 1024
const MAX_SOURCE_TOTAL_BYTES = 1024 * 1024 * 1024

export const normalizePath = value => value.split(sep).join('/')
export const sha256 = source => createHash('sha256').update(source).digest('hex')
export const normalizeGeneratedArtifactPath = value => {
  if (typeof value !== 'string' || value.includes('\0')) return null
  const normalized = value.replaceAll('\\', '/').replace(/^\.\/+/, '').replace(/\/+$/, '')
  if (
    !normalized ||
    normalized === '.' ||
    normalized.startsWith('/') ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.split('/').some(segment => !segment || segment === '..')
  ) return null
  const segments = normalized.split('/')
  const name = segments.at(-1).toLowerCase()
  if (PROTECTED_GENERATED_ROOTS.has(segments[0].toLowerCase())) return null
  if (PACKAGE_METADATA_NAMES.has(name) || SECRET_BASENAMES.has(name) || SECRET_EXTENSIONS.has(name.slice(name.lastIndexOf('.')))) return null
  if ((name === '.env' || name.startsWith('.env.')) && !SAFE_ENV_TEMPLATES.has(name)) return null
  return normalized
}

const shouldIgnoreSourcePath = relativePath => {
  const normalizedPath = normalizePath(relativePath).replace(/^\.\//, '')
  if (!normalizedPath || normalizedPath === '.') return false
  const name = basename(normalizedPath).toLowerCase()
  if ((name === '.env' || name.startsWith('.env.')) && !SAFE_ENV_TEMPLATES.has(name)) return true
  if (SECRET_BASENAMES.has(name) || SECRET_EXTENSIONS.has(name.slice(name.lastIndexOf('.')))) return true
  if (name === '.eslintcache' || name.endsWith('.tsbuildinfo')) return true
  if (SOURCE_IGNORED_PREFIXES.some(prefix => normalizedPath.startsWith(prefix))) return true
  return normalizedPath.split('/').some(segment => SOURCE_IGNORED_DIRECTORIES.has(segment))
}

const isInside = (root, target) => {
  const offset = relative(root, target)
  return offset === '' || (offset !== '..' && !offset.startsWith(`..${sep}`))
}

const resolveSourceSymlink = (projectRoot, absolutePath, relativePath) => {
  let target
  try {
    target = realpathSync(absolutePath)
  } catch {
    throw new Error(`Source symlink is broken or cyclic: ${relativePath}`)
  }
  if (!isInside(projectRoot, target)) throw new Error(`Source symlink escapes the project: ${relativePath}`)
  const targetRelativePath = normalizePath(relative(projectRoot, target))
  if (shouldIgnoreSourcePath(targetRelativePath)) {
    throw new Error(`Source symlink targets ignored or sensitive content: ${relativePath}`)
  }
  const targetStats = lstatSync(target)
  if (!targetStats.isFile()) throw new Error(`Source directory and special-file symlinks are unsupported: ${relativePath}`)
  return {target, targetRelativePath}
}

const walkSourceFiles = (projectRoot, directory = projectRoot, files = []) => {
  for (const entry of readdirSync(directory, {withFileTypes: true})) {
    const absolutePath = join(directory, entry.name)
    const relativePath = normalizePath(relative(projectRoot, absolutePath))
    if (shouldIgnoreSourcePath(relativePath)) continue
    if (entry.isDirectory()) walkSourceFiles(projectRoot, absolutePath, files)
    else if (entry.isFile() || entry.isSymbolicLink()) {
      if (entry.isSymbolicLink()) resolveSourceSymlink(projectRoot, absolutePath, relativePath)
      files.push(relativePath)
      if (files.length > MAX_SOURCE_FILES) throw new Error(`Source inventory exceeds ${MAX_SOURCE_FILES} files`)
    }
  }
  return files
}

export const listSourceFiles = projectPath => {
  const projectRoot = realpathSync(resolve(projectPath))
  return walkSourceFiles(projectRoot).sort((left, right) => left.localeCompare(right))
}

const hashRegularSourceFile = (hash, absolutePath, relativePath, budget) => {
  const descriptor = openSync(absolutePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  try {
    const current = fstatSync(descriptor)
    if (!current.isFile()) throw new Error(`Source entry changed during fingerprinting: ${relativePath}`)
    hash.update(`mode:${current.mode & 0o777}\0`)
    if (current.size > MAX_SOURCE_FILE_BYTES) throw new Error(`Source file exceeds 64 MiB: ${relativePath}`)
    budget.bytes += current.size
    if (budget.bytes > MAX_SOURCE_TOTAL_BYTES) throw new Error('Source inventory exceeds 1 GiB')
    for (;;) {
      const bytesRead = readSync(descriptor, buffer, 0, buffer.length, null)
      if (bytesRead === 0) break
      hash.update(buffer.subarray(0, bytesRead))
    }
  } finally {
    closeSync(descriptor)
  }
}

const hashSourceFile = (hash, projectRoot, relativePath, budget) => {
  const absolutePath = join(projectRoot, relativePath)
  if (!existsSync(absolutePath)) throw new Error(`Source entry changed during fingerprinting: ${relativePath}`)
  const stats = lstatSync(absolutePath)
  hash.update(relativePath)
  hash.update('\0')
  if (stats.isSymbolicLink()) {
    const {target, targetRelativePath} = resolveSourceSymlink(projectRoot, absolutePath, relativePath)
    hash.update(`mode:${stats.mode & 0o777}\0symlink:${readlinkSync(absolutePath)}\0target:${targetRelativePath}\0`)
    hashRegularSourceFile(hash, target, `${relativePath} -> ${targetRelativePath}`, budget)
  }
  else if (stats.isDirectory()) throw new Error(`Source entry changed into a directory during fingerprinting: ${relativePath}`)
  else hashRegularSourceFile(hash, absolutePath, relativePath, budget)
  hash.update('\0')
}

export const computeSourceFingerprint = (projectPath, options = {}) => {
  const projectRoot = realpathSync(resolve(projectPath))
  const hash = createHash('sha256')
  const budget = {bytes: 0}
  const excludedPaths = [...new Set((options.excludePaths ?? []).map(path => normalizePath(path).replace(/\/$/, '')))]
  for (const relativePath of listSourceFiles(projectRoot)) {
    if (!excludedPaths.some(path => relativePath === path || relativePath.startsWith(`${path}/`))) {
      hashSourceFile(hash, projectRoot, relativePath, budget)
    }
  }
  return hash.digest('hex')
}
