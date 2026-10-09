import {existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync} from 'node:fs'
import {homedir} from 'node:os'
import {join, relative, resolve, sep} from 'node:path'
import {DEFAULT_PAYLOAD_ROOT, harnessVersion} from './harness-version.mjs'

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

// 플러그인으로 돌 때 자기 문서 루트는 읽기 전용으로 연다. 스킬이 가리키는 계약은 플러그인 캐시(프로젝트 밖)에 있어서
// 막으면 메인 스레드도 계약을 못 읽는다. 스크립트 폴더는 열지 않고, 비밀 검사는 이 안에서도 그대로다.
export const PAYLOAD_DOCUMENT_ROOTS = ['skills', 'agents', 'adapters', 'schemas']
const readPayloadRoots = payloadRoot => {
  if (harnessVersion(payloadRoot) === null) return []
  // 표기 경로와 실제 경로를 둘 다 둔다 — 대상은 표기 경로로, 링크 해석 뒤에는 실제 경로로 대조한다.
  return PAYLOAD_DOCUMENT_ROOTS.flatMap(name => {
    const lexical = resolve(payloadRoot, name)
    try {
      return [...new Set([lexical, realpathSync(lexical)])]
    } catch {
      return []
    }
  })
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
// 비밀을 담지 않는 계약의 템플릿 — Bash 정책(hasSecretSegment)과 같은 예외다.
const SAFE_ENV_TEMPLATES = new Set(['.env.example', '.env.sample', '.env.template'])
const isSecretPath = value => {
  const segments = value.replaceAll('\\', '/').split('/').filter(Boolean).map(segment => segment.toLowerCase())
  return segments.some(segment => SECRET_SEGMENTS.has(segment)) || segments.some((segment, index) => {
    if (index !== segments.length - 1) return false
    if (SAFE_ENV_TEMPLATES.has(segment)) return false
    if (SECRET_NAMES.has(segment) || segment === '.env' || segment.startsWith('.env.')) return true
    return SECRET_EXTENSIONS.has(segment.slice(segment.lastIndexOf('.')))
  })
}
const globSegmentMayMatch = (pattern, candidate) => {
  // extglob(`!(…)`·`@(…)`·`+(…)`·`*(…)`·`?(…)`)·대안 기호는 해석하지 않고 무엇이든 맞는 것으로 본다 — 접두 글자가 리터럴 비교에서
  // 먼저 실패해 괄호에 닿지 못하는 일이 없게 세그먼트 전체를 먼저 본다.
  if (/[{}()|]/.test(pattern)) return true
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
// `{a,b}` 대안을 펼친다(중첩 포함) — 펼친 각 패턴을 따로 대조하면 `{src,e2e}/**`가 `.git/config`를 고를 수 있다고 보지 않는다.
// 짝이 안 맞거나, 대안이 상한을 넘거나, 범위 표기(`{a..z}` — 엔진이 `.git`을 포함한 대안으로 펼친다)면 null(부른 쪽이 막는다).
const MAX_BRACE_EXPANSIONS = 256
const MAX_BRACE_PATTERN = 4096
export const expandBraces = pattern => {
  if (pattern.length > MAX_BRACE_PATTERN) return null
  let results = ['']
  let index = 0
  const expandGroup = () => {
    // pattern[index] === '{' — 최상위 쉼표로 나눈 대안 각각을 재귀로 펼친다.
    let depth = 0
    let start = index + 1
    const alternatives = []
    for (let cursor = index + 1; cursor < pattern.length; cursor += 1) {
      const character = pattern[cursor]
      if (character === '{') depth += 1
      else if (character === '}' && depth > 0) depth -= 1
      else if (character === ',' && depth === 0) { alternatives.push(pattern.slice(start, cursor)); start = cursor + 1 }
      else if (character === '}' && depth === 0) {
        alternatives.push(pattern.slice(start, cursor))
        if (alternatives.some(alternative => alternative.includes('..'))) return null
        index = cursor + 1
        const expanded = []
        for (const alternative of alternatives) {
          const inner = expandBraces(alternative)
          if (inner === null) return null
          expanded.push(...inner)
          if (expanded.length > MAX_BRACE_EXPANSIONS) return null
        }
        return expanded
      }
    }
    return null
  }
  while (index < pattern.length) {
    const character = pattern[index]
    if (character === '}') return null
    if (character !== '{') {
      results = results.map(prefix => prefix + character)
      index += 1
      continue
    }
    const group = expandGroup()
    if (group === null || results.length * group.length > MAX_BRACE_EXPANSIONS) return null
    results = results.flatMap(prefix => group.map(alternative => prefix + alternative))
  }
  return results
}
const braceFreeGlobMaySelectGitConfig = patternValue => {
  if (typeof patternValue !== 'string' || patternValue.includes('\0') || patternValue.includes('\\')) return true
  const normalized = patternValue.replace(/^\.\/+/, '').replace(/\/{2,}/g, '/')
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) return true
  // `.` 세그먼트는 경로를 바꾸지 않는다 — `././.g?t/config`가 `.`에 걸려 대조를 벗어나지 않게 버린다.
  const patternSegments = normalized.split('/').filter(segment => segment !== '.')
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
const globMaySelectGitConfig = patternValue => {
  if (typeof patternValue !== 'string') return true
  const alternatives = expandBraces(patternValue)
  return alternatives === null || alternatives.some(alternative => braceFreeGlobMaySelectGitConfig(alternative))
}
// 비밀 경로를 빼는 ripgrep 제외 glob — Grep 대상 트리에 비밀 경로가 있어도 이 glob을 붙이면 그 파일은 검색되지 않는다.
// rg의 glob은 대소문자를 가리므로, 실제로 찾은 비밀 경로가 이 표기로 정확히 빠지는지(excludedBySecretGlob) 먼저 확인한다.
export const SECRET_EXCLUDE_GLOB = `!**/{${[
  '.env', '.env.*', ...SECRET_NAMES, ...[...SECRET_EXTENSIONS].map(extension => `*${extension}`),
  // 디렉터리 이름이 같은 일반 파일(`secrets`)도 빼야 한다 — `secrets/**`는 그 아래만 고른다.
  ...[...SECRET_SEGMENTS].flatMap(segment => [segment, `${segment}/**`]),
  // 트리 검사가 건너뛰는 디렉터리(빌드 산출물·의존성)는 안을 보지 않았으니 검색에서도 뺀다 — 그 안의 비밀을 판정하지 않았다.
  ...[...SKIP_SCAN_DIRECTORIES].flatMap(directory => [directory, `${directory}/**`]),
].join(',')}}`
const excludedBySecretGlob = offset => {
  const segments = offset.replaceAll('\\', '/').split('/').filter(Boolean)
  const name = segments.at(-1) ?? ''
  if (segments.slice(0, -1).some(segment => SECRET_SEGMENTS.has(segment))) return true
  if (SECRET_SEGMENTS.has(name)) return true
  if (name === '.env' || name.startsWith('.env.') || SECRET_NAMES.has(name)) return true
  return SECRET_EXTENSIONS.has(name.slice(name.lastIndexOf('.')))
}
const secretByName = offset => {
  const segments = offset.replaceAll('\\', '/').split('/').filter(Boolean).map(segment => segment.toLowerCase())
  return !segments.some(segment => SECRET_SEGMENTS.has(segment))
}
// 이름만으로 비밀 파일을 고를 수 없는 확장자 — 이 확장자만 포함하는 glob(`*.ts`·`*.{ts,tsx}`)은 이름 기반 비밀 파일에 닿지 않는다.
const SAFE_INCLUDE_EXTENSIONS = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts', 'css', 'scss', 'less', 'md', 'mdx', 'html',
  'vue', 'svelte', 'yml', 'yaml', 'txt', 'sql', 'graphql', 'gql', 'py', 'go', 'java', 'kt', 'swift', 'sh', 'rb', 'rs', 'php', 'astro'])
// 안전 포함 glob(`*.ext`·`*.{a,b}`, 선택적 디렉터리 접두)이 이 파일 이름을 고르는가 — 확장자만 본다.
const includeGlobMatches = (glob, offset) => {
  const match = String(glob).match(/\*\.(?:([a-z0-9]+)|\{([a-z0-9,]+)\})$/i)
  if (!match) return true
  const name = offset.replaceAll('\\', '/').split('/').at(-1).toLowerCase()
  return (match[1] ? [match[1]] : match[2].split(',')).some(extension => name.endsWith(`.${extension.toLowerCase()}`))
}
// 포함 glob의 확장자들이 rg type 하나로 모이면 그 type — 제외 glob으로 바꿀 때 검색 범위를 지킨다. 모이지 않으면 null.
const RG_TYPE_BY_EXTENSION = {ts: 'ts', tsx: 'ts', mts: 'ts', cts: 'ts', js: 'js', jsx: 'js', mjs: 'js', cjs: 'js', css: 'css',
  scss: 'sass', less: 'less', md: 'markdown', mdx: 'markdown', html: 'html', vue: 'vue', svelte: 'svelte', yml: 'yaml', yaml: 'yaml',
  py: 'py', go: 'go', java: 'java', kt: 'kotlin', swift: 'swift', sh: 'sh', rb: 'ruby', rs: 'rust', php: 'php', sql: 'sql'}
const rgTypeOf = glob => {
  const match = String(glob ?? '').match(/^(?:\*\*\/)?(?:[\w./-]+\/)*\*\.(?:([a-z0-9]+)|\{([a-z0-9,]+)\})$/i)
  if (!match) return null
  const types = new Set((match[1] ? [match[1]] : match[2].split(',')).map(extension => RG_TYPE_BY_EXTENSION[extension.toLowerCase()]))
  return types.size === 1 && !types.has(undefined) ? [...types][0] : null
}
const safeIncludeGlob = glob => {
  const match = String(glob ?? '').match(/^(?:\*\*\/)?(?:[\w./-]+\/)*\*\.(?:([a-z0-9]+)|\{([a-z0-9,]+)\})$/i)
  if (!match) return false
  return (match[1] ? [match[1]] : match[2].split(',')).every(extension => SAFE_INCLUDE_EXTENSIONS.has(extension.toLowerCase()))
}

/**
 * Grep 대상 트리의 비밀 경로(최대 200개)와, glob으로 뺄 수 없는 위험(심볼릭 링크·5만 항목 초과)이 있는지.
 */
export const inspectSensitiveTree = (projectRoot, start) => {
  const pending = [start]
  const secrets = []
  let skipped = 0
  let visited = 0
  while (pending.length) {
    const directory = pending.pop()
    for (const entry of readdirSync(directory, {withFileTypes: true})) {
      const path = resolve(directory, entry.name)
      const offset = relative(projectRoot, path)
      if (entry.isSymbolicLink()) return {unsafe: 'symlink', secrets}
      if (isSecretPath(offset)) {
        secrets.push(offset)
        if (secrets.length > 200) return {unsafe: 'too-many-secrets', secrets}
        continue
      }
      if (SKIP_SCAN_DIRECTORIES.has(entry.name)) { skipped += 1; continue }
      if (entry.isDirectory()) pending.push(path)
      visited += 1
      if (visited > 50_000) return {unsafe: 'too-large', secrets, skipped}
    }
  }
  return {unsafe: null, secrets, skipped}
}

/**
 * 비밀 경로가 있는 트리의 Grep 판정. 비밀 경로가 전부 제외 glob으로 정확히 빠질 때만 연다:
 *   - 에이전트의 포함 glob(`*.ts`)이 찾은 비밀 어느 것에도 걸리지 않고 비밀이 전부 이름 기반이면 그대로 허용
 *   - 그 밖(glob 없음·제외 glob·넓거나 비밀에 걸리는 포함 glob)은 제외 glob으로 바꿔 허용한다. 확장자 하나짜리 포함 glob이었고
 *     `type`이 비어 있으면 그 확장자의 rg type을 넣어 범위를 지킨다(제외 glob이 type보다 먼저 판정돼 `.env.ts`는 그대로 빠진다)
 *   - glob으로 정확히 뺄 수 없는 비밀(대소문자)·링크·초대형 트리는 거부
 */
export const decideSensitiveTreeGrep = (realRoot, real, toolInput) => {
  const tree = inspectSensitiveTree(realRoot, real)
  if (tree.unsafe) return {allowed: false, code: 'DENY_SENSITIVE_TREE_GREP', reason: tree.unsafe}
  if (tree.secrets.length === 0) return {allowed: true, code: 'ALLOW_TREE_CLEAN'}
  if (!tree.secrets.every(excludedBySecretGlob)) return {allowed: false, code: 'DENY_SENSITIVE_TREE_GREP', reason: 'secret-not-excludable'}
  const glob = toolInput?.glob
  // 포함 glob을 그대로 두는 것은 **실제로 찾은 비밀 파일 어느 것도 그 glob에 걸리지 않을 때만**이다(`.env.ts`는 `*.ts`에 걸린다).
  // 건너뛴 디렉터리가 있으면 그 안은 판정하지 않았다 — 포함 glob을 그대로 두지 않고 제외 glob(그 디렉터리 포함)으로 바꾼다.
  if (glob && tree.skipped === 0 && safeIncludeGlob(glob) && tree.secrets.every(secretByName) && !tree.secrets.some(offset => includeGlobMatches(glob, offset))) {
    return {allowed: true, code: 'ALLOW_GREP_SAFE_INCLUDE'}
  }
  // 그 밖(넓은 포함 glob·비밀에 걸리는 포함 glob·제외 glob·glob 없음)은 비밀 제외 glob으로 바꿔 연다 — 막으면 에이전트가 재시도로 턴을 쓴다.
  const type = toolInput?.type ?? rgTypeOf(glob)
  return {allowed: true, code: 'ALLOW_GREP_SECRETS_EXCLUDED', ...(glob ? {replacedGlob: String(glob)} : {}),
    updatedInput: {...toolInput, glob: SECRET_EXCLUDE_GLOB, ...(type ? {type} : {})}}
}

export const scanDirectoryForSensitiveEntries = (projectRoot, start) => {
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

export const evaluateSensitiveAccess = (input, environment = process.env, {payloadRoot = DEFAULT_PAYLOAD_ROOT} = {}) => {
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
  const declaredRoots = [...readDeclaredRoots(projectRoot), ...readPayloadRoots(payloadRoot)]
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
      if (input.tool_name === 'Grep' && lstatSync(real).isDirectory()) {
        const decision = decideSensitiveTreeGrep(realRoot, real, input.tool_input)
        if (!decision.allowed || decision.updatedInput) return decision
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
