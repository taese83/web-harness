#!/usr/bin/env node
// test-honest-test-lib.mjs — 통과해도 결함을 못 잡는 테스트 모양 셋을 찾는 정적 스캔.
//
// 고정하는 사실:
//   - source-text-read: readFile의 인자가 코드 파일 경로 리터럴이거나 코드 파일을 `?raw`로 들이면 걸린다. 데이터 파일·변수 경로·호출 뒤 리터럴은 걸지 않는다
//   - 스캔은 알림 장치라 깨진 import 텍스트에 예외를 던지지 않는다
//   - mocks-subject: 같은 이름의 대상 모듈(같은 폴더·`__tests__`의 부모·tsconfig `paths` 별칭·index)을 mock하면 걸린다. 협력자·패키지·선언 없는 별칭은 걸지 않는다
//   - tautological-constant: import한 상수를 그 정의와 같은 리터럴로 단언하면 걸린다. 다른 값·계산된 상수·풀 수 없는 모듈은 걸지 않는다
import assert from 'node:assert/strict'
import test from 'node:test'
import {mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {exportedConstantLiteral, findSourceTextReads, findSubjectMocks, findTautologicalConstants, resolveSpecifier, scanTestHonesty, subjectCandidates} from './honest-test-lib.mjs'

const lines = (...rows) => rows.join('\n')

test('source-text-read: 코드 파일 텍스트를 읽는 테스트를 찾는다', () => {
  const hits = findSourceTextReads(lines(
    "import {readFileSync} from 'node:fs'",
    "const source = readFileSync(join(__dirname, '../App.tsx'), 'utf8')",
    "const button = readFileSync(new URL('./Button.tsx', import.meta.url), 'utf8')",
    "import appSource from './App.tsx?raw'",
    "expect(source.indexOf('Header')).toBeLessThan(source.indexOf('Footer'))",
  ))
  assert.deepEqual(hits.map(hit => hit.line), [2, 3, 4])
})

test('source-text-read: 데이터 파일·변수 경로·평범한 import는 걸지 않는다', () => {
  assert.deepEqual(findSourceTextReads(lines(
    "const data = JSON.parse(readFileSync('fixtures/orders.json', 'utf8'))",
    'const text = readFileSync(path, "utf8")',
    "import App from './App'",
    "render(<App />); expect(screen.getByRole('heading', {name: 'App.tsx'})).toBeVisible()",
    "const name = readFileSync(manifestPath, 'utf8').replace('.tsx', '')",
    "const body = readFileSync(fixturePath, 'utf8') // see App.tsx",
  )), [])
})

test('mocks-subject: 대상 모듈을 가리키는 지정자를 같은 경로로 푼다', () => {
  assert.deepEqual(subjectCandidates('src/features/cart/model/cart.test.ts'), ['src/features/cart/model/cart'])
  assert.deepEqual(subjectCandidates('src/widgets/x/__tests__/Panel.spec.tsx'), ['src/widgets/x/__tests__/Panel', 'src/widgets/x/Panel'])
  const resolution = {projectRoot: '/r', aliases: [{pattern: '@features/*', target: '/r/src/features/*'}, {pattern: '@/*', target: '/r/*'}]}
  assert.equal(resolveSpecifier('src/features/cart/model/cart.test.ts', '@features/cart/model/cart.ts', resolution), 'src/features/cart/model/cart')
  assert.equal(resolveSpecifier('app/cart/cart.test.ts', '@/app/cart/cart', resolution), 'app/cart/cart', 'Next 루트 매핑(@/* → ./*)을 src로 가정했다')
  assert.equal(resolveSpecifier('src/a/b.test.ts', '@features/x'), null, '선언 없는 별칭을 추측으로 풀었다')
  assert.equal(resolveSpecifier('src/a/b.test.ts', 'axios', resolution), null)
})

test('mocks-subject: 대상 자체를 mock하면 걸고, 협력자·패키지 mock은 두지 않는다', () => {
  const file = 'src/features/cart/model/cart.test.ts'
  const resolution = {projectRoot: '/r', aliases: [{pattern: '@features/*', target: '/r/src/features/*'}, {pattern: '@shared/*', target: '/r/src/shared/*'}]}
  assert.deepEqual(findSubjectMocks(lines(
    "vi.mock('./cart')",
    "vi.mock('@features/cart/model/cart', async importOriginal => ({...await importOriginal(), total: vi.fn()}))",
    "vi.mock('./cartStorage')",
    "vi.mock('@shared/api')",
    "vi.mock('axios')",
  ), file, resolution).map(hit => hit.line), [1, 2])
  assert.deepEqual(findSubjectMocks("jest.mock('../Panel')", 'src/widgets/x/__tests__/Panel.test.tsx').map(hit => hit.line), [1])
  assert.deepEqual(findSubjectMocks("vi.mock('./index')", 'src/shared/lib/index.test.ts').map(hit => hit.line), [1])
})

test('tautological-constant: 정의와 같은 리터럴로 단언한 상수만 건다', () => {
  assert.equal(exportedConstantLiteral('export const MAX_POST_LENGTH = 280\n', 'MAX_POST_LENGTH'), '280')
  assert.equal(exportedConstantLiteral("export const MODE: Mode = 'draft' as const;\n", 'MODE'), "'draft'")
  assert.equal(exportedConstantLiteral('export const LIMIT = BASE + 1\n', 'LIMIT'), null)
  const modules = {
    'src/entities/post/config': "export const MAX_POST_LENGTH = 280\nexport const MODE = 'draft' as const\nexport const LIMIT = BASE + 1\n",
  }
  const hits = findTautologicalConstants(lines(
    "import {MAX_POST_LENGTH, MODE as postMode, LIMIT} from './config'",
    "import {VERSION} from 'some-package'",
    'expect(MAX_POST_LENGTH).toBe(280)',
    'expect(postMode).toEqual("draft")',
    'expect(MAX_POST_LENGTH).toBe(281)',
    'expect(LIMIT).toBe(11)',
    "expect(VERSION).toBe('1.0.0')",
    'expect(countChars(text)).toBe(280)',
  ), 'src/entities/post/config.test.ts', path => modules[path] ?? null)
  assert.deepEqual(hits.map(hit => hit.line), [3, 4])
  assert.deepEqual(findTautologicalConstants(lines(
    "import {Foo /*[x*/ as Bar, (broken} from './config'",
    'expect(Bar).toBe(280)',
  ), 'src/entities/post/config.test.ts', path => modules[path] ?? null), [], '깨진 import 조각으로 정규식을 만들었다')
})

test('scanTestHonesty: 프로젝트의 테스트 파일에서 위치·종류를 모은다', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wh-honest-')))
  try {
    const files = {
      'src/shared/config/limits.ts': 'export const PAGE_SIZE = 20\n',
      'src/shared/config/limits.test.ts': "import {PAGE_SIZE} from './limits'\ntest('x', () => expect(PAGE_SIZE).toBe(20))\n",
      'tsconfig.json': '{\n  // 템플릿 형태 — 프로젝트 참조 구성\n  "references": [{"path": "./tsconfig.web.json"}]\n}\n',
      'tsconfig.web.json': '{"compilerOptions": {"paths": {"@features/*": ["./src/features/*"]}}}\n',
      'src/features/cart/model/cart.test.ts': "vi.mock('@features/cart/model/cart')\n",
      'src/app/layout.test.ts': "const s = readFileSync('src/app/layout.tsx', 'utf8')\n",
      'src/app/clean.test.tsx': "render(<App />)\nexpect(screen.getByRole('button')).toBeEnabled()\n",
    }
    for (const [path, body] of Object.entries(files)) {
      mkdirSync(join(root, path, '..'), {recursive: true})
      writeFileSync(join(root, path), body)
    }
    const signals = scanTestHonesty(root, ['src/shared/config/limits.test.ts', 'src/features/cart/model/cart.test.ts', 'src/app/layout.test.ts', 'src/app/clean.test.tsx', 'src/missing.test.ts'])
    assert.deepEqual(signals.map(signal => `${signal.file}:${signal.line}:${signal.kind}`), [
      'src/app/layout.test.ts:1:source-text-read',
      'src/features/cart/model/cart.test.ts:1:mocks-subject',
      'src/shared/config/limits.test.ts:2:tautological-constant',
    ])
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})
