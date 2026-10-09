// review-impact-lib.mjs — 리뷰 묶음의 영향 범위: diff로 바뀐 소스 파일마다 그 파일을 import하는 파일 목록.
//
// 리뷰어는 묶음의 diff만 받으면 변경점 위주로 본다 — 바뀐 export·시그니처·반환값이 diff 밖의 호출부를 깨는지는 놓치기 쉽다.
// 이 목록이 「어디를 더 열어 봐야 하는가」를 준다. 근사다: 상대 경로 import는 해석해 맞추고, 별칭(`@/…`·`~/…`·`#…`)은 경로 꼬리가
// 바뀐 파일과 겹치면 후보로 센다(tsconfig를 풀지 않는다). 동적 import·재export 체인·문자열 조립 경로는 못 본다.
import {readdirSync, readFileSync, statSync} from 'node:fs'
import {dirname, join, relative, resolve, sep} from 'node:path'

const SOURCE = /\.(?:[cm]?[jt]sx?|vue|svelte)$/
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '_workspace', '.pnpm-store', '.turbo'])
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)['"]([^'"\n]+)['"]/gm
const MAX_FILES = 20_000
const MAX_IMPORTERS = 30

const withoutExtension = path => path.replace(/\.(?:[cm]?[jt]sx?|vue|svelte)$/, '').replace(/\/index$/, '')
const toPosix = path => path.split(sep).join('/')

function sourceFiles(root) {
  const out = []
  const pending = [root]
  while (pending.length && out.length < MAX_FILES) {
    const directory = pending.pop()
    let entries
    try { entries = readdirSync(directory, {withFileTypes: true}) } catch { continue }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const path = join(directory, entry.name)
      if (entry.isDirectory()) { if (!SKIP.has(entry.name)) pending.push(path) } else if (SOURCE.test(entry.name)) out.push(path)
    }
  }
  return out
}

/** diff-names 출력(한 줄에 한 경로, JSON 따옴표일 수 있다) → 경로 목록. 안내 줄은 버린다. */
export function parseDiffNames(text) {
  return String(text ?? '').split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('['))
    .map(line => { try { return line.startsWith('"') ? JSON.parse(line) : line } catch { return line } })
    .filter(path => path !== 'No matching changes.')
}

/** 바뀐 소스 파일 → 그 파일을 import하는 파일들. */
export function computeImpact(projectRoot, changedPaths) {
  const root = resolve(projectRoot)
  const changed = changedPaths.map(toPosix).filter(path => SOURCE.test(path) && !path.startsWith('_workspace/'))
  const targets = new Map(changed.map(path => [withoutExtension(path), path]))
  const importers = new Map(changed.map(path => [path, new Set()]))
  if (changed.length === 0) return {changed, importers, scanned: 0}
  const files = sourceFiles(root)
  for (const file of files) {
    const from = toPosix(relative(root, file))
    let text
    try { if (statSync(file).size > 1024 * 1024) continue; text = readFileSync(file, 'utf8') } catch { continue }
    for (const match of text.matchAll(SPECIFIER)) {
      const specifier = match[1]
      let hit = null
      if (specifier.startsWith('.')) {
        hit = targets.get(withoutExtension(toPosix(relative(root, resolve(dirname(file), specifier)))))
      } else if (/^(?:@\/|~\/|#|@[\w-]+\/)/.test(specifier)) {
        // 별칭 — 접두를 떼고 남은 꼬리가 바뀐 파일 경로의 끝과 같으면 후보다.
        const tail = withoutExtension(specifier.replace(/^(?:@\/|~\/|#\/?|@[\w-]+\/)/, ''))
        hit = [...targets.entries()].find(([stem]) => tail && (stem === tail || stem.endsWith(`/${tail}`)))?.[1] ?? null
      }
      if (hit && hit !== from) importers.get(hit).add(from)
    }
  }
  return {changed, importers, scanned: files.length}
}

export function renderImpact({changed, importers, scanned}) {
  if (changed.length === 0) return '바뀐 소스 파일이 없다.\n'
  const lines = [`# 영향 범위 — 바뀐 소스 파일을 import하는 파일(근사: 상대 경로 해석·별칭 꼬리 대조, 소스 ${scanned}개 훑음)`, '']
  for (const path of changed) {
    const list = [...importers.get(path)].sort()
    lines.push(`## ${path} — 사용처 ${list.length}개${list.length > MAX_IMPORTERS ? `(앞 ${MAX_IMPORTERS}개만)` : ''}`)
    for (const importer of list.slice(0, MAX_IMPORTERS)) lines.push(`- ${importer}`)
    if (list.length === 0) lines.push('- (찾지 못함 — 진입점이거나 동적·별칭 import일 수 있다. export 이름으로 한 번 더 찾는다)')
    lines.push('')
  }
  return `${lines.join('\n')}\n`
}
