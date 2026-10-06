#!/usr/bin/env node
// validate-layer-boundaries.mjs — 소스의 import가 스팩이 정한 레이어 방향을 지키는가.
//
// 규칙의 정본은 스팩이다: `layerMap`(레이어 → 경로)과 `layerDependencies`(레이어 → import 허용 레이어).
// 레이어 이름·방향을 하네스가 정하지 않으므로 FSD·레이어드·헥사고날 어디에나 같은 검사가 선다.
// import 문자열이 아니라 **해석한 경로**로 판정한다 — 상대경로(`../../features/x`)와 tsconfig
// `paths` 별칭이 같은 결과를 낸다. 문자열 패턴 lint는 별칭만 보고 상대경로를 놓친다.
//
// 판정:
//   다른 레이어로의 import — 허용 목록에 그 레이어가 없으면 위반
//   같은 레이어의 다른 슬라이스(레이어 경로 바로 아래 **디렉터리**)로의 import — 허용 목록에 자기
//   레이어가 없으면 위반. 레이어 바로 아래 파일끼리(평면 레이어)는 슬라이스가 아니다
// 테스트 파일은 방향을 대조하지 않는다. layerMap 밖으로의 import와 외부 패키지는 판정 대상이 아니다.
//
// 알림(판정·종료 코드에 반영하지 않는다) — `deepImports`: 다른 슬라이스의 **공개 진입점을 우회한** import.
// 슬라이스 루트에 `index.*`가 있으면 그 슬라이스가 공개 API를 선언한 것으로 보고, 루트 파일·`@x/` 밖의
// 하위 디렉터리로 들어가는 import를 싣는다(`@x/`는 FSD의 교차 공개 API 어휘 — 다른 형태에서는 쓰이지 않는다). 테스트 파일도 본다 — 테스트가 남의 내부를 붙잡으면 구현을
// 바꿀 때 깨지고 동작은 못 잡는다(진입점이 테스트 표면이다). 자기 슬라이스 안은 대상이 아니다.
// **해석하지 못한 별칭**(tsconfig에 없는 `@x/…`·`~/…`·`#…`)이 있으면 PASS가 아니라 INCOMPLETE다.
//
// 사용법:
//   node .claude/scripts/validate-layer-boundaries.mjs --project-root <path> [--json]
// 종료 코드: 0 = PASS, 1 = 위반, 2 = 사용법 오류, 3 = 미판정(NO_SPEC·NOT_DECLARED·INCOMPLETE — 통과가 아니다).
import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs'
import {dirname, join, relative, resolve, sep} from 'node:path'
import {pathToFileURL} from 'node:url'
import {isLayerPathDeclared} from './agent-registry.mjs'
import {answerHelp} from './cli-help-lib.mjs'

answerHelp(import.meta.url)

const SPEC_LOCK_PATH = '_workspace/03_dev/spec.json'
const SOURCE_EXTENSION = /\.(?:[cm]?[jt]sx?)$/
const TEST_FILE = /(?:\.(?:test|spec|stories)\.[cm]?[jt]sx?|\.d\.ts)$/
const IGNORED_DIRECTORIES = new Set(['node_modules', '__tests__', '__mocks__', 'dist', 'build', 'coverage', '.git'])

const toPosix = path => path.split(sep).join('/')
const stripExtension = path => path.replace(/\.[cm]?[jt]sx?$/, '')
const isDirectory = path => existsSync(path) && statSync(path).isDirectory()

const collectFiles = (path, out = [], {tests = false} = {}) => {
  if (!existsSync(path)) return out
  const stat = statSync(path)
  if (stat.isFile()) {
    if (SOURCE_EXTENSION.test(path) && (tests || !TEST_FILE.test(path)) && !path.endsWith('.d.ts')) out.push(path)
    return out
  }
  if (!stat.isDirectory()) return out
  for (const entry of readdirSync(path, {withFileTypes: true})) {
    if (entry.isSymbolicLink() || IGNORED_DIRECTORIES.has(entry.name)) continue
    collectFiles(join(path, entry.name), out, {tests})
  }
  return out
}

const INDEX_FILES = ['index.ts', 'index.tsx', 'index.js', 'index.jsx', 'index.mjs']
const hasIndex = directory => INDEX_FILES.some(name => existsSync(join(directory, name)))

/** 슬라이스 안 경로(`inner`)가 공개 진입점 밖인가 — 루트 파일·index·`@x/`는 진입점이다(순수 + 디렉터리 확인). */
export const bypassesEntry = (slicePath, inner) => {
  if (!inner || inner === 'index') return false
  const parts = inner.split('/')
  if (parts[0] === '@x') return false
  return parts.length >= 2 || isDirectory(join(slicePath, parts[0]))
}

// 주석을 공백으로 지운다 — 줄 번호가 원문과 맞도록 줄바꿈은 남긴다.
const blankComments = text => text
  .replace(/\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:'"`\\])\/\/.*$/gm, (match, lead) => lead + ' '.repeat(match.length - lead.length))

export const importSpecifiers = text => {
  const source = blankComments(text)
  const found = []
  const patterns = [
    /\bimport\s+(?:type\s+)?[^'";]*?\s+from\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bexport\s+(?:type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s*from\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      found.push({specifier: match[1], line: source.slice(0, match.index).split('\n').length})
    }
  }
  return found.sort((a, b) => a.line - b.line)
}

const readJsonc = path => {
  try {
    const text = readFileSync(path, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:"\\])\/\/.*$/gm, '$1')
      .replace(/,(\s*[}\]])/g, '$1')
    return JSON.parse(text)
  } catch {
    return null
  }
}

// 루트의 tsconfig*.json에서 paths 별칭과 baseUrl을 모은다(프로젝트 참조 구성의 tsconfig.app.json 포함).
export const readPathAliases = root => {
  const aliases = []
  const bases = []
  const configs = existsSync(root) ? readdirSync(root).filter(name => /^tsconfig(?:\.[\w-]+)?\.json$/.test(name)) : []
  for (const name of configs) {
    const options = readJsonc(join(root, name))?.compilerOptions
    if (options?.baseUrl) bases.push(resolve(root, options.baseUrl))
    if (!options?.paths) continue
    const base = resolve(root, options.baseUrl ?? '.')
    for (const [pattern, targets] of Object.entries(options.paths)) {
      if (!Array.isArray(targets) || typeof targets[0] !== 'string') continue
      aliases.push({pattern, target: resolve(base, targets[0])})
    }
  }
  aliases.sort((a, b) => b.pattern.length - a.pattern.length)
  return Object.assign(aliases, {bases})
}

const existsAsModule = path => isDirectory(path) || ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].some(ext => existsSync(`${path}${ext}`))

const resolveSpecifier = (specifier, fromFile, aliases) => {
  if (specifier.startsWith('.')) return resolve(dirname(fromFile), specifier)
  for (const {pattern, target} of aliases) {
    if (pattern.endsWith('/*')) {
      const prefix = pattern.slice(0, -1)
      if (specifier.startsWith(prefix)) return target.endsWith('*') ? target.slice(0, -1) + specifier.slice(prefix.length) : join(target, specifier.slice(prefix.length))
    } else if (specifier === pattern) {
      return target
    }
  }
  // baseUrl 기준 bare import(`features/cart`) — 실제로 있을 때만 그 경로로 본다(없으면 패키지다).
  for (const base of aliases.bases ?? []) {
    const candidate = resolve(base, specifier)
    if (existsAsModule(candidate)) return candidate
  }
  return null
}

// 별칭처럼 보이는데 해석되지 않은 것 — 패키지 이름이 아닌 접두(@x/ 중 의존성에 없는 것, ~/, #).
const looksLikeAlias = (specifier, packages) => {
  if (specifier.startsWith('~/') || specifier.startsWith('#')) return true
  if (!specifier.startsWith('@')) return false
  return !packages.has(specifier.split('/').slice(0, 2).join('/'))
}

const readPackages = root => {
  const manifest = readJsonc(join(root, 'package.json')) ?? {}
  return new Set(Object.keys({...manifest.dependencies, ...manifest.devDependencies, ...manifest.peerDependencies}))
}

const readSpec = root => {
  const path = join(root, SPEC_LOCK_PATH)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

export const inspectLayerBoundaries = ({projectRoot, spec = readSpec(resolve(projectRoot))}) => {
  const root = resolve(projectRoot)
  if (!spec?.layerMap || typeof spec.layerMap !== 'object') {
    return {status: 'NO_SPEC', violations: [], unresolved: [], deepImports: [], checkedFiles: 0, notes: [`${SPEC_LOCK_PATH}의 layerMap이 없다 — 대조할 규칙이 없다(통과가 아니다)`]}
  }
  const dependencies = spec.layerDependencies
  // 방향 선언이 없어도 공개 진입점 우회(알림)는 layerMap만으로 잰다 — 방향 판정만 건너뛴다.
  const directionDeclared = Boolean(dependencies) && typeof dependencies === 'object'
  const layers = Object.entries(spec.layerMap)
    .filter(([, value]) => isLayerPathDeclared(value))
    .map(([name, value]) => ({name, path: resolve(root, value.trim().replace(/\/\*{1,2}$/, '').replace(/\/+$/, ''))}))
    .sort((a, b) => b.path.length - a.path.length)
  // 슬라이스 = 레이어 바로 아래 디렉터리. 레이어 바로 아래 파일은 슬라이스가 아니다(평면 레이어).
  const locate = absolute => {
    const bare = stripExtension(toPosix(absolute))
    for (const layer of layers) {
      const layerPath = toPosix(layer.path)
      if (SOURCE_EXTENSION.test(layerPath)) {
        if (bare === stripExtension(layerPath) || bare === `${stripExtension(layerPath)}/index`) return {layer: layer.name, slice: ''}
      } else if (bare === layerPath || bare.startsWith(`${layerPath}/`)) {
        const rest = bare.slice(layerPath.length + 1)
        const first = rest.split('/')[0]
        const slice = rest.includes('/') || isDirectory(join(layer.path, first)) ? first : ''
        if (slice === 'index' || slice === '') return {layer: layer.name, slice: ''}
        return {layer: layer.name, slice, slicePath: join(layer.path, slice), inner: rest.slice(slice.length + 1)}
      }
    }
    return null
  }

  const aliases = readPathAliases(root)
  const packages = readPackages(root)
  const violations = []
  const unresolved = []
  const deepImports = []
  let checkedFiles = 0
  for (const layer of layers) {
    for (const file of collectFiles(layer.path, [], {tests: true})) {
      const from = locate(file)
      if (!from || from.layer !== layer.name) continue
      const isTest = TEST_FILE.test(file)
      if (!isTest && directionDeclared) checkedFiles += 1
      const allowed = new Set(directionDeclared ? dependencies[from.layer] ?? [] : [])
      for (const {specifier, line} of importSpecifiers(readFileSync(file, 'utf8'))) {
        const target = resolveSpecifier(specifier, file, aliases)
        if (target === null) {
          if (!isTest && directionDeclared && looksLikeAlias(specifier, packages)) unresolved.push({file: toPosix(relative(root, file)), line, specifier})
          continue
        }
        const to = locate(target)
        if (!to) continue
        const at = {file: toPosix(relative(root, file)), line, specifier, fromLayer: from.layer, toLayer: to.layer}
        const otherSlice = to.slice && (to.layer !== from.layer || to.slice !== from.slice)
        if (otherSlice && hasIndex(to.slicePath) && bypassesEntry(to.slicePath, to.inner)) deepImports.push({...at, toSlice: to.slice, test: isTest})
        if (isTest || !directionDeclared) continue
        if (to.layer !== from.layer) {
          if (!allowed.has(to.layer)) violations.push({...at, reason: `${from.layer}는 ${to.layer}를 import할 수 없다`})
        } else if (from.slice && to.slice && from.slice !== to.slice && !allowed.has(from.layer)) {
          violations.push({...at, reason: `${from.layer}의 슬라이스끼리 import할 수 없다(${from.slice} → ${to.slice})`})
        }
      }
    }
  }
  const notes = []
  if (!directionDeclared) notes.push('스팩에 layerDependencies가 없다 — 레이어 방향을 대조하지 않았다(통과가 아니다)')
  if (unresolved.length > 0) notes.push(`해석하지 못한 별칭 import ${unresolved.length}건 — 대조하지 않았다. tsconfig paths에 등록하면 판정된다`)
  if (deepImports.length > 0) notes.push(`공개 진입점(index)을 우회한 import ${deepImports.length}건 — 알림이다(판정에 반영하지 않는다)`)
  const status = !directionDeclared ? 'NOT_DECLARED' : violations.length > 0 ? 'FAIL' : unresolved.length > 0 ? 'INCOMPLETE' : 'PASS'
  return {status, violations, unresolved, deepImports, checkedFiles, notes}
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2)
  const rootIndex = argv.indexOf('--project-root')
  const projectRoot = rootIndex >= 0 ? argv[rootIndex + 1] : undefined
  if (!projectRoot) {
    process.stderr.write('사용법: node .claude/scripts/validate-layer-boundaries.mjs --project-root <path> [--json]\n')
    process.exit(2)
  }
  const result = inspectLayerBoundaries({projectRoot})
  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } else {
    process.stdout.write(`layer boundaries: ${result.status} — 파일 ${result.checkedFiles}개\n`)
    for (const item of result.violations) process.stdout.write(`  FAIL ${item.file}:${item.line} '${item.specifier}' — ${item.reason}\n`)
    for (const item of result.deepImports) process.stdout.write(`  NOTE ${item.file}:${item.line} '${item.specifier}' — ${item.toLayer}/${item.toSlice}의 공개 진입점을 우회한다${item.test ? '(테스트)' : ''}\n`)
    for (const note of result.notes) process.stdout.write(`  · ${note}\n`)
  }
  process.exitCode = {PASS: 0, FAIL: 1}[result.status] ?? 3
}
