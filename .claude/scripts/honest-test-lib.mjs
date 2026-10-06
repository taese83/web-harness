// honest-test-lib.mjs — 통과해도 결함을 잡지 못하는 테스트 모양을 정적으로 찾는다(알림 — 판정에 반영하지 않는다).
//
// 커버리지는 실행만 재고, 변이 표본은 결과만 잰다. 이 스캔은 **왜** 잡지 못하는지의 흔한 모양 셋을 테스트 파일에서 찾는다:
//   - source-text-read      렌더·실행 대신 소스 파일 텍스트를 읽어 단언한다 — 구현 모양이 바뀌면 깨지고 동작 결함은 못 잡는다
//   - mocks-subject         테스트 대상 모듈 자체를 mock한다 — 실제 경로가 실행되지 않는다
//   - tautological-constant 구현이 export한 상수를 그 정의와 같은 리터럴로 단언한다 — 기대값이 구현에서 왔으니 틀릴 수 없다
//
// **신호이지 판정이 아니다.** 정적 패턴이라 의도한 구조 검사(소스에 금지 API가 없음을 읽는 테스트)나 공개 상수를
// 계약으로 고정하는 테스트도 걸린다. 그래서 막지 않고 위치를 실어 사람이 가리게 한다(rule-tiers 「새 규칙은 알림부터」).
// 모듈을 끝까지 풀지 못하면(선언 없는 별칭·재수출·계산된 값) 걸지 않는다 — 놓침이 오탐보다 싸다. 별칭은 프로젝트
// `tsconfig*.json`의 `paths`로만 푼다(`validate-layer-boundaries`와 같은 해석).
import {existsSync, readFileSync} from 'node:fs'
import {join, posix, relative, resolve, sep} from 'node:path'
import {readPathAliases} from './validate-layer-boundaries.mjs'

export const HONESTY_KINDS = {
  'source-text-read': '렌더·실행 대신 소스 텍스트를 읽어 단언한다 — 구현 모양이 바뀌면 깨지고 동작 결함은 못 잡는다',
  'mocks-subject': '테스트 대상 모듈 자체를 mock했다 — 실제 경로가 실행되지 않는다',
  'tautological-constant': '구현이 export한 상수를 같은 리터럴로 단언한다 — 기대값이 구현에서 왔으니 틀릴 수 없다',
}

const CODE_LITERAL = /['"`][^'"`\n]+\.(?:[cm]?[jt]sx?|vue|svelte)['"`]/
const RAW_CODE_IMPORT = /(?:from\s+|import\s*\(\s*)['"][^'"\n]+\.(?:[cm]?[jt]sx?|vue|svelte)\?raw['"]/g
const READ_CALL = /\breadFile(?:Sync)?\s*\(/g
const MOCK_CALL = /\b(?:vi|jest)\.(?:mock|doMock)\(\s*['"]([^'"\n]+)['"]/g
const NAMED_IMPORT = /import\s*(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"\n]+)['"]/g
const CONSTANT_ASSERT = /\bexpect\(\s*([A-Za-z_$][\w$]*)\s*\)\s*\.\s*(?:toBe|toEqual|toStrictEqual)\(\s*(-?\d+(?:\.\d+)?|'[^'\n]*'|"[^"\n]*"|true|false)\s*\)/g
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/
const MODULE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']
const ARGUMENT_WINDOW = 400

const lineOf = (text, index) => text.slice(0, index).split('\n').length
const evidenceAt = (text, index) => text.split('\n')[lineOf(text, index) - 1].trim().slice(0, 120).replace(/`/g, "'")
const normalizeLiteral = literal => (/^['"]/.test(literal) ? `s:${literal.slice(1, -1)}` : `v:${literal}`)
const withoutExtension = path => path.replace(/\.(?:[cm]?[jt]sx?)$/, '').replace(/\/index$/, '')

/** 여는 괄호 위치에서 짝이 맞는 닫는 괄호까지의 인자 텍스트 — 호출 뒤의 코드는 보지 않는다. */
const callArguments = (text, openIndex) => {
  let depth = 0
  const end = Math.min(text.length, openIndex + ARGUMENT_WINDOW)
  for (let index = openIndex; index < end; index += 1) {
    if (text[index] === '(') depth += 1
    else if (text[index] === ')' && (depth -= 1) === 0) return text.slice(openIndex + 1, index)
  }
  return text.slice(openIndex + 1, end)
}

/**
 * 프로젝트 루트 기준 모듈 지정자를 확장자·`/index` 없는 경로로 푼다. 상대 경로와 tsconfig `paths` 별칭만 푼다 —
 * 패키지·선언 없는 별칭은 null(걸지 않는다). `aliases`는 `readPathAliases` 결과(절대 경로 target).
 */
export function resolveSpecifier(testFile, specifier, {projectRoot = '.', aliases = []} = {}) {
  if (specifier === '.' || specifier.startsWith('./') || specifier.startsWith('../')) return withoutExtension(posix.join(posix.dirname(testFile), specifier))
  for (const {pattern, target} of aliases) {
    let absolute = null
    if (pattern.endsWith('/*') && specifier.startsWith(pattern.slice(0, -1))) {
      const rest = specifier.slice(pattern.length - 1)
      absolute = target.endsWith('*') ? `${target.slice(0, -1)}${rest}` : join(target, rest)
    } else if (specifier === pattern) {
      absolute = target
    }
    if (absolute !== null) return withoutExtension(relative(resolve(projectRoot), absolute).split(sep).join('/'))
  }
  return null
}

/** 테스트 파일이 겨누는 대상 모듈 후보(확장자 없는 경로) — 같은 폴더의 같은 이름, `__tests__` 안이면 부모 폴더의 같은 이름. */
export function subjectCandidates(testFile) {
  const match = /^(.*?)([^/]+)\.(?:test|spec)\.[cm]?[jt]sx?$/.exec(testFile)
  if (!match) return []
  const [, directory, name] = match
  const candidates = [`${directory}${name}`]
  if (/(?:^|\/)__tests__\/$/.test(directory)) candidates.push(`${directory.replace(/__tests__\/$/, '')}${name}`)
  return candidates.map(candidate => candidate.replace(/\/index$/, ''))
}

/** source-text-read (순수) — readFile 호출의 인자가 코드 파일 경로 리터럴이거나, 코드 파일을 `?raw`로 들인다. */
export function findSourceTextReads(text) {
  const found = []
  for (const match of text.matchAll(READ_CALL)) {
    const argument = callArguments(text, match.index + match[0].length - 1)
    if (CODE_LITERAL.test(argument)) found.push({line: lineOf(text, match.index), evidence: evidenceAt(text, match.index)})
  }
  for (const match of text.matchAll(RAW_CODE_IMPORT)) found.push({line: lineOf(text, match.index), evidence: evidenceAt(text, match.index)})
  return found
}

/** mocks-subject (순수) — mock한 모듈이 이 테스트 파일의 대상 모듈과 같다. `resolution`은 resolveSpecifier 옵션. */
export function findSubjectMocks(text, testFile, resolution = {}) {
  const subjects = new Set(subjectCandidates(testFile))
  const found = []
  for (const match of text.matchAll(MOCK_CALL)) {
    if (subjects.has(resolveSpecifier(testFile, match[1], resolution))) found.push({line: lineOf(text, match.index), evidence: evidenceAt(text, match.index)})
  }
  return found
}

/** 이름 붙은 import(지역 이름 → 모듈 지정자·원래 이름). 식별자가 아닌 조각(주석·문법 오류)은 버린다. */
const namedImports = text => {
  const imports = new Map()
  for (const match of text.matchAll(NAMED_IMPORT)) {
    for (const part of match[1].split(',')) {
      const [imported, local = imported] = part.replace(/^\s*type\s+/, '').split(/\s+as\s+/).map(name => name.trim())
      if (IDENTIFIER.test(imported ?? '') && IDENTIFIER.test(local)) imports.set(local, {specifier: match[2], imported})
    }
  }
  return imports
}

/** 모듈 소스에서 `export const NAME = 리터럴`의 리터럴. 못 찾으면 null. */
export function exportedConstantLiteral(source, name) {
  if (!IDENTIFIER.test(name)) return null
  const match = new RegExp(`export\\s+const\\s+${name.replace(/\$/g, '\\$')}\\s*(?::[^=\\n]+)?=\\s*(-?\\d+(?:\\.\\d+)?|'[^'\\n]*'|"[^"\\n]*"|true|false)\\s*(?:as\\s+const\\s*)?[;\\n]`).exec(source)
  return match ? match[1] : null
}

/** tautological-constant — 단언한 식별자가 import한 상수이고, 그 정의의 리터럴과 기대 리터럴이 같다. `readModule`은 확장자 없는 경로 → 소스. */
export function findTautologicalConstants(text, testFile, readModule, resolution = {}) {
  const imports = namedImports(text)
  const found = []
  for (const match of text.matchAll(CONSTANT_ASSERT)) {
    const origin = imports.get(match[1])
    const modulePath = origin && resolveSpecifier(testFile, origin.specifier, resolution)
    const source = modulePath && readModule(modulePath)
    const defined = source && exportedConstantLiteral(source, origin.imported)
    if (defined !== null && defined !== undefined && normalizeLiteral(defined) === normalizeLiteral(match[2])) {
      found.push({line: lineOf(text, match.index), evidence: evidenceAt(text, match.index)})
    }
  }
  return found
}

const readModuleFrom = projectRoot => modulePath => {
  for (const candidate of [...MODULE_EXTENSIONS.map(ext => `${modulePath}${ext}`), ...MODULE_EXTENSIONS.map(ext => `${modulePath}/index${ext}`)]) {
    const absolute = join(projectRoot, candidate)
    if (existsSync(absolute)) { try { return readFileSync(absolute, 'utf8') } catch { return null } }
  }
  return null
}

/**
 * 테스트 파일들(프로젝트 루트 기준 경로)을 훑어 신호를 낸다. 알림 장치라 판정 스크립트를 멈추지 않는다 —
 * 읽을 수 없거나 스캔 중 예외가 난 파일은 건너뛴다(놓침 방향).
 */
export function scanTestHonesty(projectRoot, testFiles) {
  const readModule = readModuleFrom(projectRoot)
  let aliases = []
  try { aliases = readPathAliases(resolve(projectRoot)) } catch {}
  const resolution = {projectRoot, aliases}
  const signals = []
  for (const file of [...new Set(testFiles)].sort()) {
    try {
      const text = readFileSync(join(projectRoot, file), 'utf8')
      const fileSignals = []
      const add = (kind, hits) => hits.forEach(hit => fileSignals.push({file, kind, ...hit}))
      add('source-text-read', findSourceTextReads(text))
      add('mocks-subject', findSubjectMocks(text, file, resolution))
      add('tautological-constant', findTautologicalConstants(text, file, readModule, resolution))
      signals.push(...fileSignals)
    } catch {
      continue
    }
  }
  return signals
}
