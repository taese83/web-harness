import {existsSync, lstatSync, readdirSync, realpathSync, statSync} from 'node:fs'
import {relative, resolve, sep} from 'node:path'

const SECRET_SEGMENTS = new Set([
  '.aws', '.azure', '.docker', '.git', '.gnupg', '.kube', '.ssh', 'credential', 'credentials', 'secret', 'secrets',
])
const SECRET_NAMES = new Set([
  '.dev.vars', '.git-credentials', '.netrc', '.npmrc', '.pypirc', 'credentials.json', 'service-account.json',
])
const SECRET_EXTENSIONS = new Set(['.jks', '.key', '.keystore', '.p12', '.pem', '.pfx'])
const SKIP_SCAN_DIRECTORIES = new Set(['.git', '.next', '.pnpm-store', 'dist', 'node_modules'])

const isInside = (root, target) => {
  const offset = relative(root, target)
  return offset === '' || (offset !== '..' && !offset.startsWith(`..${sep}`))
}
const isSecretPath = value => {
  const segments = value.replaceAll('\\', '/').split('/').filter(Boolean).map(segment => segment.toLowerCase())
  return segments.some(segment => SECRET_SEGMENTS.has(segment)) || segments.some((segment, index) => {
    if (index !== segments.length - 1) return false
    if (SECRET_NAMES.has(segment) || segment === '.env' || segment.startsWith('.env.')) return true
    return SECRET_EXTENSIONS.has(segment.slice(segment.lastIndexOf('.')))
  })
}
const globSegmentMayMatch = (pattern, candidate) => {
  const memo = new Map()
  const visit = (patternIndex, candidateIndex) => {
    const key = `${patternIndex}:${candidateIndex}`
    if (memo.has(key)) return memo.get(key)
    let result
    if (patternIndex === pattern.length) result = candidateIndex === candidate.length
    else if (pattern[patternIndex] === '*') {
      result = visit(patternIndex + 1, candidateIndex) || (
        candidateIndex < candidate.length && visit(patternIndex, candidateIndex + 1)
      )
    }
    else if (pattern[patternIndex] === '?') {
      result = candidateIndex < candidate.length && visit(patternIndex + 1, candidateIndex + 1)
    }
    else if (pattern[patternIndex] === '[') {
      const closingIndex = pattern.indexOf(']', patternIndex + 1)
      if (closingIndex === -1 || candidateIndex >= candidate.length) result = true
      else {
        const body = pattern.slice(patternIndex + 1, closingIndex)
        const negated = body.startsWith('!') || body.startsWith('^')
        const values = negated ? body.slice(1) : body
        let matched = false
        for (let index = 0; index < values.length; index += 1) {
          if (index + 2 < values.length && values[index + 1] === '-') {
            matched ||= candidate[candidateIndex] >= values[index] && candidate[candidateIndex] <= values[index + 2]
            index += 2
          }
          else matched ||= candidate[candidateIndex] === values[index]
        }
        result = (negated ? !matched : matched) && visit(closingIndex + 1, candidateIndex + 1)
      }
    }
    else if ('{}()|'.includes(pattern[patternIndex])) result = true
    else {
      result = candidateIndex < candidate.length &&
        pattern[patternIndex] === candidate[candidateIndex] &&
        visit(patternIndex + 1, candidateIndex + 1)
    }
    memo.set(key, result)
    return result
  }
  return visit(0, 0)
}
const globMaySelectGitConfig = patternValue => {
  if (typeof patternValue !== 'string' || patternValue.includes('\0') || patternValue.includes('\\')) return true
  const normalized = patternValue.replace(/^\.\/+/, '').replace(/\/{2,}/g, '/')
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) return true
  const patternSegments = normalized.split('/')
  if (patternSegments.includes('..')) return true
  const candidateSegments = ['.git', 'config']
  const memo = new Map()
  const visit = (patternIndex, candidateIndex) => {
    const key = `${patternIndex}:${candidateIndex}`
    if (memo.has(key)) return memo.get(key)
    let result
    if (patternIndex === patternSegments.length) result = candidateIndex === candidateSegments.length
    else if (patternSegments[patternIndex] === '**') {
      result = visit(patternIndex + 1, candidateIndex) || (
        candidateIndex < candidateSegments.length && visit(patternIndex, candidateIndex + 1)
      )
    }
    else {
      result = candidateIndex < candidateSegments.length &&
        globSegmentMayMatch(patternSegments[patternIndex], candidateSegments[candidateIndex]) &&
        visit(patternIndex + 1, candidateIndex + 1)
    }
    memo.set(key, result)
    return result
  }
  return visit(0, 0)
}
const scanDirectoryForSensitiveEntries = (projectRoot, start) => {
  const pending = [start]
  let visited = 0
  while (pending.length) {
    const directory = pending.pop()
    for (const entry of readdirSync(directory, {withFileTypes: true})) {
      const path = resolve(directory, entry.name)
      const offset = relative(projectRoot, path)
      if (isSecretPath(offset) || entry.isSymbolicLink()) return true
      if (SKIP_SCAN_DIRECTORIES.has(entry.name)) continue
      if (entry.isDirectory()) pending.push(path)
      visited += 1
      if (visited > 50_000) return true
    }
  }
  return false
}

export const evaluateSensitiveAccess = (input, environment = process.env) => {
  if (!['Read', 'Grep', 'Glob'].includes(input?.tool_name)) return {allowed: true, code: 'ALLOW_NOT_APPLICABLE'}
  let projectRoot
  try {
    projectRoot = realpathSync(resolve(environment.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd()))
  } catch {
    return {allowed: false, code: 'DENY_CONTEXT'}
  }
  const toolInput = input.tool_input ?? {}
  const rawPath = input.tool_name === 'Read' ? toolInput.file_path : toolInput.path
  if (input.tool_name === 'Grep' && (!rawPath || rawPath === '.')) return {allowed: false, code: 'DENY_RECURSIVE_ROOT_GREP'}
  if (typeof rawPath === 'string') {
    const target = resolve(projectRoot, rawPath)
    if (!isInside(projectRoot, target)) return {allowed: false, code: 'DENY_PATH_OUTSIDE'}
    const lexical = relative(projectRoot, target)
    if (isSecretPath(lexical)) return {allowed: false, code: 'DENY_SECRET_PATH'}
    if (existsSync(target)) {
      let real
      try {
        real = realpathSync(target)
      } catch {
        return {allowed: false, code: 'DENY_PATH_UNRESOLVED'}
      }
      if (!isInside(projectRoot, real) || isSecretPath(relative(projectRoot, real))) {
        return {allowed: false, code: 'DENY_PATH_OUTSIDE'}
      }
      if (input.tool_name === 'Read' && statSync(real).isFile() && statSync(real).size > 5 * 1024 * 1024) {
        return {allowed: false, code: 'DENY_FILE_TOO_LARGE'}
      }
      if (input.tool_name === 'Grep' && lstatSync(real).isDirectory() && scanDirectoryForSensitiveEntries(projectRoot, real)) {
        return {allowed: false, code: 'DENY_SENSITIVE_TREE_GREP'}
      }
    }
  }
  if (
    input.tool_name === 'Glob' &&
    resolve(projectRoot, typeof rawPath === 'string' ? rawPath : '.') === projectRoot &&
    globMaySelectGitConfig(toolInput.pattern)
  ) {
    return {allowed: false, code: 'DENY_GIT_CONFIG_GLOB'}
  }
  if (
    input.tool_name === 'Glob' &&
    (isSecretPath(String(toolInput.pattern ?? '')) || /(?:^|\/)\.env(?:[.*]|$)/i.test(String(toolInput.pattern ?? '')))
  ) {
    return {allowed: false, code: 'DENY_SECRET_GLOB'}
  }
  return {allowed: true, code: 'ALLOW_SENSITIVE_ACCESS_POLICY'}
}
