// test-reuse-inventory.mjs — 재사용 목록이 스팩 layerMap 어휘로 export를 모으고, 새 export의
// 미사용·이름 중복을 경고하는가. FSD 어휘와 평면 어휘 두 형태에서 같은 판정이 서는지 본다.
import assert from 'node:assert/strict'
import test from 'node:test'
import {spawnSync} from 'node:child_process'
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {buildInventory, compareInventories, parseModule} from './reuse-inventory.mjs'

const script = resolve(import.meta.dirname, 'reuse-inventory.mjs')

const project = (files, spec) => {
  const root = mkdtempSync(join(tmpdir(), 'reuse-inventory-'))
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), {recursive: true})
    writeFileSync(join(root, path), content)
  }
  if (spec) {
    mkdirSync(join(root, '_workspace/03_dev'), {recursive: true})
    writeFileSync(join(root, '_workspace/03_dev/spec.json'), JSON.stringify(spec))
  }
  return root
}

test('parseModule: 정의·재노출·import를 가르고 주석 속 이름은 세지 않는다', () => {
  const module = parseModule(`
    import {useState, type ReactNode} from 'react'
    import Button, {Icon as Glyph} from './button'
    // import {useGhost} from './ghost'
    export function useCounter() {}
    export const formatDate = () => ''
    export type Props = {a: string}
    export {Panel} from './panel'
    const local = 1
    export {local, Button}
    export const enum Mode {A}
  `, 'counter.tsx')
  assert.deepEqual(module.definitions.map(item => `${item.kind}:${item.name}`), ['hook:useCounter', 'value:formatDate', 'type:Props', 'type:Mode', 'value:local'])
  assert.deepEqual(module.reexports, ['Panel', 'Button'], 'import 뒤 export {x}는 barrel 재노출이다')
  assert.deepEqual(module.imports.sort(), ['Button', 'Icon', 'ReactNode', 'useState'])
})

test('FSD 어휘: 사용처는 barrel 재노출을 빼고 layerMap 밖 진입점까지 센다', () => {
  const root = project({
    'src/shared/hooks/use-debounce.ts': 'export function useDebounce() {}\n',
    'src/shared/hooks/index.ts': "export {useDebounce} from './use-debounce'\n",
    'src/features/search/ui/SearchBar.tsx': "import {useDebounce} from '@shared/hooks'\nexport function SearchBar() {}\n",
    'src/main.tsx': "import {SearchBar} from './features/search/ui/SearchBar'\n",
    'src/features/search/ui/SearchBar.test.tsx': "import {SearchBar} from './SearchBar'\n",
  }, {layerMap: {features: 'src/features', shared: 'src/shared'}})
  try {
    const inventory = buildInventory({projectRoot: root})
    const byName = Object.fromEntries(inventory.entries.map(entry => [entry.name, entry]))
    assert.equal(byName.useDebounce.consumers, 1)
    assert.deepEqual(byName.useDebounce.publicVia, ['src/shared/hooks/index.ts'])
    assert.equal(byName.SearchBar.kind, 'component')
    assert.equal(byName.SearchBar.consumers, 1, 'main.tsx는 layerMap 밖이지만 사용처이고, 테스트는 사용처가 아니다')
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})

test('평면 어휘: 새 export의 미사용·이름 중복만 경고하고 기존 export는 캐지 않는다', () => {
  const root = project({
    'src/hooks/useToggle.ts': 'export function useToggle() {}\nexport function useLegacy() {}\n',
    'src/components/Menu.tsx': "import {useToggle} from '../hooks/useToggle'\nexport function Menu() {}\n",
  }, {layerMap: {hooks: 'src/hooks', components: 'src/components'}})
  try {
    const before = buildInventory({projectRoot: root})
    writeFileSync(join(root, 'src/components/Dropdown.tsx'), 'export function useToggle() {}\nexport function Dropdown() {}\n')
    const after = buildInventory({projectRoot: root})
    const result = compareInventories(before, after)
    assert.equal(result.status, 'WARN')
    assert.equal(result.added, 2)
    const codes = result.findings.map(item => `${item.code}:${item.name}`).sort()
    // 사용처는 이름 수준이라 동명 useToggle은 기존 것의 사용처를 나눠 갖는다 — 그래서 중복 신호가 따로 있다.
    assert.deepEqual(codes, ['DUPLICATE_NAME:useToggle', 'UNUSED_NEW_EXPORT:Dropdown'])
    assert.ok(!codes.some(code => code.endsWith(':useLegacy')), '기존 미사용 export는 변경점이 아니다')
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})

test('스팩이 없으면 목록을 만들지 않고 그 사실을 보고한다', () => {
  const root = project({'src/a.ts': 'export const a = 1\n'})
  try {
    const inventory = buildInventory({projectRoot: root})
    assert.equal(inventory.status, 'NO_SPEC')
    assert.equal(inventory.entries.length, 0)
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})

test('CLI: --json 목록과 --since 대조가 프로세스로 돈다(경고여도 exit 0)', () => {
  const root = project({
    'src/lib/format.ts': 'export function formatPrice() {}\n',
  }, {layerMap: {lib: 'src/lib'}})
  try {
    const first = spawnSync(process.execPath, [script, '--project-root', root, '--json'], {encoding: 'utf8'})
    assert.equal(first.status, 0, first.stderr)
    const baseline = join(root, 'baseline.json')
    writeFileSync(baseline, first.stdout)
    writeFileSync(join(root, 'src/lib/extra.ts'), 'export function unusedHelper() {}\n')
    const second = spawnSync(process.execPath, [script, '--project-root', root, '--since', baseline, '--json'], {encoding: 'utf8'})
    assert.equal(second.status, 0, second.stderr)
    const parsed = JSON.parse(second.stdout)
    assert.equal(parsed.since.status, 'WARN')
    assert.deepEqual(parsed.since.findings.map(item => item.code), ['UNUSED_NEW_EXPORT'])
    const usage = spawnSync(process.execPath, [script], {encoding: 'utf8'})
    assert.equal(usage.status, 2)
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})

test('라우트 규약 형태: default·핸들러 규약 export는 사용처 0이어도 경고하지 않는다', () => {
  const root = project({'api/health.ts': 'export const guards = []\nexport async function fetch() {}\n'}, {layerMap: {api: 'api', app: 'app'}})
  try {
    const before = buildInventory({projectRoot: root})
    writeFileSync(join(root, 'api/notes.ts'), 'export const guards = []\nexport async function fetch() {}\n')
    mkdirSync(join(root, 'app/notes'), {recursive: true})
    writeFileSync(join(root, 'app/notes/page.tsx'), 'export const metadata = {}\nexport default function Page() {}\n')
    const result = compareInventories(before, buildInventory({projectRoot: root}))
    assert.equal(result.status, 'PASS', JSON.stringify(result.findings))
    assert.equal(result.added, 0)
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})
