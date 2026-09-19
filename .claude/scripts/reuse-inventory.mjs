#!/usr/bin/env node
// reuse-inventory.mjs — developer 스폰 전에 **이미 있는 재사용 자산**을 보이고, 스폰 뒤 새 export를 대조한다.
//
// 스폰은 앞 스폰의 산출을 모른다 — 있는 것을 보여주지 않으면 다시 만든다. 목록은 모델이 코드를
// 훑어 만들지 않고 이 스크립트가 결정적으로 만든다 — 탐색을 모델에 맡기면 컨텍스트를 태운다.
//
// 범위는 스팩 `layerMap`이 덮는 소스다. 레이어 이름·경로 어휘는 프로젝트의 것이라 FSD를 가정하지 않는다.
//
// `--since <이전 목록 JSON>`이면 그 뒤 새로 생긴 export에서 두 신호를 낸다(진행은 막지 않는다, exit 0):
//   UNUSED_NEW_EXPORT — 새 export인데 가져다 쓰는 소스 파일이 없다
//   DUPLICATE_NAME    — 새 export와 같은 이름이 다른 파일에서도 정의된다
// **프록시 표기**: 사용처는 import 구문에 그 이름이 나오는 비테스트 소스 파일 수다(모듈 해석은 하지
// 않는다). `import * as ns`로만 쓰이는 이름은 0으로 센다(과대 경고 방향). 프레임워크가 소비하는
// export(default·라우트 규약 이름)는 `entry`로 표시해 두 신호에서 뺀다. 책임이 겹치는지는 기계가
// 모른다 — 목록을 읽는 developer·code-reviewer의 판단이다. 등록부: protected-core §4.
//
// 사용법:
//   node .claude/scripts/reuse-inventory.mjs --project-root <path> [--since <file>] [--json]
// 종료 코드: 0 = 보고(경고 포함), 2 = 사용법 오류.
import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs'
import {join, relative, resolve, sep} from 'node:path'
import {pathToFileURL} from 'node:url'
import {isLayerPathDeclared} from './agent-registry.mjs'

const SPEC_LOCK_PATH = '_workspace/03_dev/spec.json'
const SOURCE_EXTENSION = /\.(?:[cm]?[jt]sx?)$/
const NON_PRODUCT_FILE = /(?:\.(?:test|spec|stories)\.[cm]?[jt]sx?|\.d\.ts)$/
const IGNORED_DIRECTORIES = new Set([
  'node_modules', '__tests__', '__mocks__', 'dist', 'build', 'coverage', '.git', '.next', '.turbo', '.vercel',
  '_workspace', '.claude', 'playwright-report', 'test-results',
])

// 파일 라우팅·서버 핸들러가 import 없이 소비하는 이름 — 사용처 0이 정상이다.
const ENTRY_NAMES = new Set([
  'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'fetch', 'guards', 'config',
  'metadata', 'generateMetadata', 'generateStaticParams', 'loader', 'action', 'handler', 'middleware',
])

const toPosix = path => path.split(sep).join('/')

const collectFiles = (path, out) => {
  if (!existsSync(path)) return out
  const stat = statSync(path)
  if (stat.isFile()) {
    if (SOURCE_EXTENSION.test(path) && !NON_PRODUCT_FILE.test(path)) out.add(path)
    return out
  }
  if (!stat.isDirectory()) return out
  for (const entry of readdirSync(path, {withFileTypes: true})) {
    if (entry.isSymbolicLink() || IGNORED_DIRECTORIES.has(entry.name)) continue
    collectFiles(join(path, entry.name), out)
  }
  return out
}

const stripComments = text => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

const specifierNames = list => list
  .split(',')
  .map(part => part.trim().replace(/^type\s+/, ''))
  .filter(Boolean)
  .map(part => {
    const [original, alias] = part.split(/\s+as\s+/)
    return {original: original.trim(), local: (alias ?? original).trim()}
  })

const classify = (name, keyword, file) => {
  if (keyword === 'type' || keyword === 'interface' || keyword === 'enum') return 'type'
  if (/^use[A-Z0-9]/.test(name)) return 'hook'
  if (/^[A-Z]/.test(name) && /\.[jt]sx$/.test(file) && keyword !== 'class') return 'component'
  if (keyword === 'class') return 'class'
  return keyword === 'function' ? 'function' : 'value'
}

// 한 파일에서 정의한 export와 다시 내보낸 이름, import한 이름을 읽는다. 정규식 판독이라 동적 export·
// `export default` 익명 값·`export * from`은 목록에 오르지 않는다(과소 보고 방향).
export const parseModule = (text, file = 'module.ts') => {
  const source = stripComments(text)
  const definitions = []
  const reexports = []
  const imports = new Set()
  const importedLocals = new Set()
  for (const match of source.matchAll(/import\s+(?:type\s+)?([^'";]*?)\s+from\s*['"][^'"]+['"]/g)) {
    const clause = match[1]
    const braces = clause.match(/\{([^}]*)\}/)
    if (braces) {
      for (const {original, local} of specifierNames(braces[1])) {
        imports.add(original)
        importedLocals.add(local)
      }
    }
    const head = clause.replace(/\{[^}]*\}/, '').replace(/,/g, ' ').trim()
    if (head && !head.startsWith('*')) {
      imports.add(head.split(/\s+/)[0])
      importedLocals.add(head.split(/\s+/)[0])
    }
  }
  for (const match of source.matchAll(/export\s+(default\s+)?(?:declare\s+)?(?:async\s+)?(function\*?|const\s+enum|const|let|var|class|type|interface|enum|abstract\s+class)\s+([A-Za-z_$][\w$]*)/g)) {
    const keyword = match[2].replace(/\*$/, '').replace(/^abstract\s+/, '').replace(/^const\s+enum$/, 'enum')
    definitions.push({name: match[3], kind: classify(match[3], keyword, file), entry: Boolean(match[1]) || ENTRY_NAMES.has(match[3])})
  }
  for (const match of source.matchAll(/export\s+(type\s+)?\{([^}]*)\}\s*(from\s*['"][^'"]+['"])?/g)) {
    for (const {original, local} of specifierNames(match[2])) {
      // `import {A} from './a'; export {A}`는 barrel 재노출이지 정의가 아니다.
      if (match[3] || importedLocals.has(original)) reexports.push(local)
      else definitions.push({name: local, kind: match[1] ? 'type' : classify(original, 'const', file), entry: ENTRY_NAMES.has(local)})
    }
  }
  return {definitions, reexports, imports: [...imports]}
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

export const buildInventory = ({projectRoot, spec = readSpec(resolve(projectRoot))}) => {
  const root = resolve(projectRoot)
  if (!spec || !spec.layerMap || typeof spec.layerMap !== 'object') {
    return {status: 'NO_SPEC', layers: {}, entries: [], notes: [`${SPEC_LOCK_PATH}의 layerMap이 없다 — 목록을 만들 범위가 없다`]}
  }
  const fileLayer = new Map()
  for (const [layer, value] of Object.entries(spec.layerMap)) {
    if (!isLayerPathDeclared(value)) continue
    const target = resolve(root, value.trim().replace(/\/\*{1,2}$/, ''))
    if (target !== root && !target.startsWith(`${root}${sep}`)) continue
    for (const file of collectFiles(target, new Set())) if (!fileLayer.has(file)) fileLayer.set(file, layer)
  }
  // 사용처는 layerMap 밖(진입점·mock·서버 handler)에도 있다 — 프로젝트 소스 전체에서 센다.
  const parsed = new Map()
  for (const file of collectFiles(root, new Set(fileLayer.keys()))) parsed.set(file, parseModule(readFileSync(file, 'utf8'), file))

  const consumers = new Map()
  for (const [file, module] of parsed) {
    for (const name of module.imports) {
      if (!consumers.has(name)) consumers.set(name, new Set())
      consumers.get(name).add(file)
    }
  }
  const publicVia = new Map()
  for (const [file, module] of parsed) {
    for (const name of module.reexports) {
      if (!publicVia.has(name)) publicVia.set(name, [])
      publicVia.get(name).push(toPosix(relative(root, file)))
    }
  }

  const entries = []
  for (const file of fileLayer.keys()) {
    const module = parsed.get(file)
    const path = toPosix(relative(root, file))
    for (const {name, kind, entry} of module.definitions) {
      const users = [...(consumers.get(name) ?? [])].filter(user => user !== file && !publicVia.get(name)?.includes(toPosix(relative(root, user))))
      entries.push({name, kind, layer: fileLayer.get(file), file: path, publicVia: publicVia.get(name) ?? [], consumers: users.length, ...(entry ? {entry: true} : {})})
    }
  }
  entries.sort((a, b) => a.layer.localeCompare(b.layer) || a.file.localeCompare(b.file) || a.name.localeCompare(b.name))
  const layers = {}
  for (const entry of entries) layers[entry.layer] = (layers[entry.layer] ?? 0) + 1
  return {status: 'OK', layers, entries, notes: []}
}

const entryKey = entry => `${entry.file}#${entry.name}`

// 이전 목록 이후 새로 생긴 export만 본다 — 기존 부채를 캐지 않는다(변경점 범위).
export const compareInventories = (previous, current) => {
  const before = new Set((previous?.entries ?? []).map(entryKey))
  const added = current.entries.filter(entry => !before.has(entryKey(entry)) && entry.kind !== 'type' && !entry.entry)
  const findings = []
  for (const entry of added) {
    if (entry.consumers === 0) {
      findings.push({code: 'UNUSED_NEW_EXPORT', name: entry.name, file: entry.file, detail: '새 export를 가져다 쓰는 소스 파일이 없다'})
    }
    const twins = current.entries.filter(other => other.name === entry.name && other.file !== entry.file && other.kind !== 'type' && !other.entry)
    if (twins.length > 0) {
      findings.push({code: 'DUPLICATE_NAME', name: entry.name, file: entry.file, detail: `같은 이름이 다른 파일에도 정의된다: ${twins.map(twin => twin.file).join(', ')}`})
    }
  }
  return {status: findings.length > 0 ? 'WARN' : 'PASS', added: added.length, findings}
}

const renderText = (inventory, comparison) => {
  const lines = [`reuse inventory: ${inventory.status} — export ${inventory.entries.length}개`]
  for (const note of inventory.notes) lines.push(`  · ${note}`)
  for (const entry of inventory.entries) {
    if (entry.kind === 'type') continue
    lines.push(`  [${entry.layer}] ${entry.kind} ${entry.name} — ${entry.file} (사용처 ${entry.consumers})`)
  }
  if (comparison) {
    lines.push(`since: ${comparison.status} — 새 export ${comparison.added}개`)
    for (const finding of comparison.findings) lines.push(`  WARN [${finding.code}] ${finding.name} — ${finding.file}: ${finding.detail}`)
  }
  return `${lines.join('\n')}\n`
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2)
  const option = name => {
    const index = argv.indexOf(name)
    return index >= 0 ? argv[index + 1] : undefined
  }
  const projectRoot = option('--project-root')
  const since = option('--since')
  if (!projectRoot || (argv.includes('--since') && !since)) {
    process.stderr.write('사용법: node .claude/scripts/reuse-inventory.mjs --project-root <path> [--since <file>] [--json]\n')
    process.exit(2)
  }
  const inventory = buildInventory({projectRoot})
  let comparison = null
  if (since) {
    try {
      comparison = compareInventories(JSON.parse(readFileSync(since, 'utf8')), inventory)
    } catch (error) {
      process.stderr.write(`--since 목록을 읽지 못했다: ${error.message}\n`)
      process.exit(2)
    }
  }
  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(comparison ? {...inventory, since: comparison} : inventory, null, 2)}\n`)
  } else {
    process.stdout.write(renderText(inventory, comparison))
  }
  // process.exit()는 파이프로 나가는 큰 stdout을 자를 수 있다 — 자연 종료한다.
  process.exitCode = 0
}
