import {existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync} from 'node:fs'
import {homedir} from 'node:os'
import {join, relative, resolve, sep} from 'node:path'

// 워크스페이스가 repo 하나로 끝나지 않는다 — 프론트 repo 옆에 API 서버 repo가 있는 구성이
// 흔하고, 그 스키마·라우트·DTO를 읽지 못하면 계약 설계가 추측이 된다(2026-08-27 사용자 지적).
//
// 종전에는 프로젝트 밖 경로를 **한 줄로 전부** 막았다: `.ssh/id_rsa`와 이웃 repo의
// `package.json`이 같은 코드·같은 이유(DENY_PATH_OUTSIDE)로 막혔다. 경계 두 개가 뭉쳐 있었다.
//
// 가르는 방식: **사용자가 파일로 선언한 루트만** 읽기 전용으로 연다.
//   · 기본은 여전히 닫혀 있다 — 파일이 없으면 종전 동작 그대로다
//   · 선언은 모델이 런타임에 넓힐 수 없다(파일 쓰기는 소유권 훅이 막는다)
//   · 비밀 검사는 **연 루트 안에서도 그대로 적용된다** — .env·.ssh·키는 어디에 있든 막힌다
//   · 쓰기·실행은 이 파일과 무관하다. 읽기(Read/Grep/Glob)만이다
const WORKSPACE_ROOTS_FILE = 'workspace-roots.json'

const readDeclaredRoots = projectRoot => {
  let raw
  try {
    raw = readFileSync(join(projectRoot, '.claude', WORKSPACE_ROOTS_FILE), 'utf8')
  } catch {
    return []
  }
  let document
  try {
    document = JSON.parse(raw)
  } catch {
    return []
  }
  const declared = Array.isArray(document?.readRoots) ? document.readRoots : []
  const home = resolve(homedir())
  const roots = []
  for (const entry of declared) {
    if (typeof entry !== 'string' || entry.trim() === '') continue
    let real
    try {
      real = realpathSync(resolve(projectRoot, entry))
    } catch {
      continue // 없는 경로는 조용히 무시한다 — 여는 쪽이므로 실패는 닫힘이다
    }
    // 너무 넓은 루트는 선언해도 열지 않는다 — 홈·루트·프로젝트의 조상은 사실상 전면 개방이다.
    if (real === home || real === resolve('/') || isInside(real, projectRoot)) continue
    roots.push(real)
  }
  return roots
}

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
  const declaredRoots = readDeclaredRoots(projectRoot)
  // 어느 루트 안인가. 프로젝트 루트가 항상 첫 번째다(선언 없이도 성립).
  const containingRoot = target => [projectRoot, ...declaredRoots].find(root => isInside(root, target)) ?? null
  if (typeof rawPath === 'string') {
    const target = resolve(projectRoot, rawPath)
    const root = containingRoot(target)
    if (root === null) return {allowed: false, code: 'DENY_PATH_OUTSIDE'}
    // 비밀 판정은 **그 루트 기준 상대경로**로 한다 — 프로젝트 기준으로 재면 `../`가 섞여
    // 세그먼트 판정이 흐려진다.
    const lexical = relative(root, target)
    if (isSecretPath(lexical)) return {allowed: false, code: 'DENY_SECRET_PATH'}
    if (existsSync(target)) {
      let real
      try {
        real = realpathSync(target)
      } catch {
        return {allowed: false, code: 'DENY_PATH_UNRESOLVED'}
      }
      // 심볼릭 링크가 어느 루트 밖으로도 나가면 차단한다 — 선언은 링크 탈출을 허용하지 않는다.
      const realRoot = containingRoot(real)
      if (realRoot === null) return {allowed: false, code: 'DENY_PATH_OUTSIDE'}
      if (isSecretPath(relative(realRoot, real))) return {allowed: false, code: 'DENY_SECRET_PATH'}
      if (input.tool_name === 'Read' && statSync(real).isFile() && statSync(real).size > 5 * 1024 * 1024) {
        return {allowed: false, code: 'DENY_FILE_TOO_LARGE'}
      }
      if (input.tool_name === 'Grep' && lstatSync(real).isDirectory() && scanDirectoryForSensitiveEntries(realRoot, real)) {
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
