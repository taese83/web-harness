// test-layer-boundaries.mjs — 레이어 방향 검사가 스팩(layerMap·layerDependencies)만으로 서는가.
// FSD 어휘(별칭·슬라이스)와 헥사고날 어휘(상대경로·평면 레이어) 두 형태에서 같은 판정을 본다.
import assert from 'node:assert/strict'
import test from 'node:test'
import {spawnSync} from 'node:child_process'
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {importSpecifiers, inspectLayerBoundaries} from './validate-layer-boundaries.mjs'
import {validateLayerDependencies} from './spec.mjs'

const script = resolve(import.meta.dirname, 'validate-layer-boundaries.mjs')

const project = files => {
  const root = mkdtempSync(join(tmpdir(), 'layer-boundaries-'))
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), {recursive: true})
    writeFileSync(join(root, path), typeof content === 'string' ? content : JSON.stringify(content))
  }
  return root
}

const FSD = {
  layerMap: {pages: 'src/pages', features: 'src/features', entities: 'src/entities', shared: 'src/shared'},
  layerDependencies: {pages: ['features', 'entities', 'shared'], features: ['entities', 'shared'], entities: ['shared'], shared: ['shared']},
}

test('importSpecifiers: 정적·재노출·동적 import를 읽고 주석은 건너뛰며 줄 번호를 지킨다', () => {
  const found = importSpecifiers([
    "import {a} from './a'",
    '/* import {b} from "./b" */',
    "export {c} from '../c'",
    "// import d from './d'",
    "const e = import('./e')",
    "import './side-effect.css'",
  ].join('\n'))
  assert.deepEqual(found.map(item => `${item.line}:${item.specifier}`), ['1:./a', '3:../c', '5:./e', '6:./side-effect.css'])
})

test('FSD 어휘: 별칭과 상대경로가 같은 위반을 내고, 슬라이스 간 import도 잡는다', () => {
  const root = project({
    'tsconfig.json': '{\n  // 주석과 끝 쉼표를 견딘다\n  "compilerOptions": {"paths": {"@features/*": ["src/features/*"], "@shared/*": ["src/shared/*"],}}\n}',
    'src/shared/ui/button.tsx': "import {useCart} from '@features/cart'\nexport function Button() {}\n",
    'src/entities/user/api.ts': "import {x} from '../../features/cart/model'\nimport {Button} from '@shared/ui/button'\n",
    'src/features/cart/index.ts': "import {login} from '../auth/model'\nimport {Button} from '@shared/ui/button'\nimport {y} from './model'\n",
    'src/features/auth/model.ts': 'export const login = 1\n',
    'src/features/cart/cart.test.ts': "import {z} from '../../pages/home'\n",
    'src/pages/home/index.tsx': "import {cart} from '@features/cart'\n",
  })
  try {
    const result = inspectLayerBoundaries({projectRoot: root, spec: FSD})
    assert.equal(result.status, 'FAIL')
    assert.deepEqual(result.violations.map(item => `${item.file}:${item.line}`).sort(), [
      'src/entities/user/api.ts:1',
      'src/features/cart/index.ts:1',
      'src/shared/ui/button.tsx:1',
    ])
    assert.match(result.violations.find(item => item.file.startsWith('src/features')).reason, /슬라이스끼리/)
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})

test('공개 진입점 우회(deepImports): 다른 슬라이스의 하위 폴더로 들어가면 싣고, 판정·종료 코드는 그대로다(알림)', () => {
  const root = project({
    'tsconfig.json': '{"compilerOptions": {"paths": {"@features/*": ["src/features/*"], "@entities/*": ["src/entities/*"]}}}',
    'src/features/cart/index.ts': "export {useCart} from './model/store'\n",
    'src/features/cart/model/store.ts': 'export const useCart = () => 1\n',
    'src/features/cart/api.ts': 'export const fetchCart = () => 1\n',
    'src/features/cart/cart.test.ts': "import {useCart} from './model/store'\n",
    'src/features/auth/model/session.ts': 'export const session = 1\n',
    'src/entities/user/index.ts': 'export const user = 1\n',
    'src/entities/user/@x/order.ts': 'export const forOrder = 1\n',
    'src/entities/order/index.ts': "import {forOrder} from '../user/@x/order'\nexport const order = forOrder\n",
    'src/pages/home/index.tsx': [
      "import {useCart} from '@features/cart'",
      "import {fetchCart} from '@features/cart/api'",
      "import {useCart as deep} from '@features/cart/model/store'",
      "import * as model from '../../features/cart/model'",
      "import {session} from '@features/auth/model/session'",
    ].join('\n'),
    'src/pages/home/home.test.tsx': "import {useCart} from '@features/cart/model/store'\n",
  })
  try {
    const result = inspectLayerBoundaries({projectRoot: root, spec: {
      layerMap: {pages: 'src/pages', features: 'src/features', entities: 'src/entities'},
      layerDependencies: {pages: ['features', 'entities'], features: ['entities'], entities: ['entities']},
    }})
    assert.equal(result.status, 'PASS', '알림이 판정을 바꿨다')
    assert.deepEqual(result.deepImports.map(item => `${item.file}:${item.line}:${item.toSlice}:${item.test}`).sort(), [
      'src/pages/home/home.test.tsx:1:cart:true',
      'src/pages/home/index.tsx:3:cart:false',
      'src/pages/home/index.tsx:4:cart:false',
    ])
    assert.equal(result.checkedFiles, 8, '테스트 파일을 방향 대조 수에 넣었다')
    const undeclared = inspectLayerBoundaries({projectRoot: root, spec: {layerMap: {pages: 'src/pages', features: 'src/features', entities: 'src/entities'}}})
    assert.equal(undeclared.status, 'NOT_DECLARED')
    assert.equal(undeclared.deepImports.length, 3, '방향 선언이 없다고 공개 진입점 우회까지 건너뛰었다')
    mkdirSync(join(root, '_workspace/03_dev'), {recursive: true})
    writeFileSync(join(root, '_workspace/03_dev/spec.json'), JSON.stringify({
      layerMap: {pages: 'src/pages', features: 'src/features', entities: 'src/entities'},
      layerDependencies: {pages: ['features', 'entities'], features: ['entities'], entities: ['entities']},
    }))
    const cli = spawnSync(process.execPath, [script, '--project-root', root], {encoding: 'utf8'})
    assert.equal(cli.status, 0, '알림이 종료 코드를 바꿨다')
    assert.match(cli.stdout, /NOTE src\/pages\/home\/index\.tsx:3 '@features\/cart\/model\/store'/)
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})

test('project-init 템플릿의 라우트는 페이지 슬라이스의 공개 진입점으로만 들어간다(deepImports 0)', () => {
  const templates = readFileSync(resolve(import.meta.dirname, '../skills/project-init/assets/templates.md'), 'utf8')
  const block = name => {
    const start = templates.indexOf(`\n## ${name}\n`)
    assert.ok(start >= 0, `템플릿 섹션 ${name}이 없다`)
    const open = templates.indexOf('```', start)
    const body = templates.indexOf('\n', open) + 1
    return templates.slice(body, templates.indexOf('\n```', body) + 1)
  }
  const files = {
    'tsconfig.web.json': block('TSCONFIG_WEB'),
    'src/app/routes/Routes.tsx': block('ROUTES_TSX'),
    'src/app/routes/RouteErrorBoundary.tsx': 'export const RouteErrorBoundary = () => null\n',
    'src/pages/home/index.ts': block('HOME_INDEX'),
    'src/pages/home/ui/HomePage.tsx': 'export default function HomePage() { return null }\n',
    'src/pages/not-found/index.ts': block('NOT_FOUND_INDEX'),
    'src/pages/not-found/ui/NotFoundPage.tsx': 'export default function NotFoundPage() { return null }\n',
  }
  const spec = {layerMap: {app: 'src/app', pages: 'src/pages', shared: 'src/shared'}, layerDependencies: {app: ['pages', 'shared'], pages: ['shared'], shared: []}}
  const root = project(files)
  try {
    const result = inspectLayerBoundaries({projectRoot: root, spec})
    assert.equal(result.status, 'PASS', result.notes.join('\n'))
    assert.deepEqual(result.deepImports, [], '하네스 템플릿이 자기 공개 API 규칙(fsd-rules §2)을 어긴다')
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
  const deep = project({...files, 'src/app/routes/Routes.tsx': files['src/app/routes/Routes.tsx'].replace("import('@pages/home')", "import('@pages/home/ui/HomePage')")})
  try {
    assert.equal(inspectLayerBoundaries({projectRoot: deep, spec}).deepImports.length, 1, '템플릿 블록을 읽었지만 우회를 재지 못한다')
  } finally {
    rmSync(deep, {recursive: true, force: true})
  }
})

test('헥사고날 어휘: 레이어 이름·경로를 하네스가 정하지 않고, 평면 레이어 안 파일끼리는 슬라이스가 아니다', () => {
  const root = project({
    'lib/domain/order.ts': "import {db} from '../infrastructure/db'\nimport {Money} from './money'\nexport class Order {}\n",
    'lib/domain/money.ts': 'export class Money {}\n',
    'lib/application/place-order.ts': "import {Order} from '../domain/order'\n",
    'lib/infrastructure/db.ts': "import {Order} from '../domain/order'\nexport const db = 1\n",
    'lib/domain/billing/index.ts': "export {invoice} from './internal/invoice'\n",
    'lib/domain/billing/internal/invoice.ts': 'export const invoice = 1\n',
    'lib/application/charge.ts': "import {invoice} from '../domain/billing/internal/invoice'\nimport {invoice as viaEntry} from '../domain/billing'\n",
  })
  const spec = {
    layerMap: {domain: 'lib/domain', application: 'lib/application', infrastructure: 'lib/infrastructure'},
    layerDependencies: {domain: [], application: ['domain'], infrastructure: ['domain', 'application']},
  }
  try {
    const result = inspectLayerBoundaries({projectRoot: root, spec})
    assert.deepEqual(result.violations.map(item => `${item.fromLayer}→${item.toLayer}`), ['domain→infrastructure'])
    assert.deepEqual(result.deepImports.map(item => `${item.file}:${item.line}`), ['lib/application/charge.ts:1'], '두 번째 어휘에서 공개 진입점 우회를 놓쳤다')
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})

test('세그먼트 레이어: 하위 디렉터리끼리 import하려면 자기 레이어를 허용 목록에 넣는다', () => {
  const root = project({
    'src/app/providers/router.tsx': "import {routes} from '../routes/table'\n",
    'src/app/routes/table.ts': 'export const routes = []\n',
  })
  const layerMap = {app: 'src/app'}
  try {
    assert.equal(inspectLayerBoundaries({projectRoot: root, spec: {layerMap, layerDependencies: {app: []}}}).status, 'FAIL')
    assert.equal(inspectLayerBoundaries({projectRoot: root, spec: {layerMap, layerDependencies: {app: ['app']}}}).status, 'PASS')
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})

test('baseUrl 기준 bare import도 레이어로 해석한다 — 없는 경로는 패키지로 본다', () => {
  const root = project({
    'tsconfig.json': {compilerOptions: {baseUrl: 'src'}},
    'src/shared/a.ts': "import {b} from 'features/x/b'\nimport React from 'react'\n",
    'src/features/x/b.ts': 'export const b = 1\n',
  })
  try {
    const result = inspectLayerBoundaries({projectRoot: root, spec: FSD})
    assert.deepEqual(result.violations.map(item => item.specifier), ['features/x/b'])
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})

test('해석하지 못한 별칭이 있으면 INCOMPLETE다 · 방향 선언이 없으면 NOT_DECLARED', () => {
  const root = project({
    'package.json': {dependencies: {'@tanstack/react-query': '5.0.0'}},
    'src/features/a/index.ts': "import {q} from '@tanstack/react-query'\nimport {x} from '@entities/user'\nimport {y} from '~/shared/y'\n",
  })
  try {
    const result = inspectLayerBoundaries({projectRoot: root, spec: FSD})
    assert.equal(result.status, 'INCOMPLETE', '대조하지 못한 import가 있는데 PASS면 번들러 별칭으로 검사를 벗어난다')
    assert.deepEqual(result.unresolved.map(item => item.specifier), ['@entities/user', '~/shared/y'])
    assert.equal(inspectLayerBoundaries({projectRoot: root, spec: {layerMap: FSD.layerMap}}).status, 'NOT_DECLARED')
    assert.equal(inspectLayerBoundaries({projectRoot: root, spec: null}).status, 'NO_SPEC')
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})

test('스팩 확정: layerDependencies는 layerMap의 레이어 이름만 가리킨다', () => {
  assert.equal(validateLayerDependencies({}, FSD.layerMap), undefined)
  assert.deepEqual(validateLayerDependencies(FSD, FSD.layerMap), FSD.layerDependencies)
  assert.throws(() => validateLayerDependencies({layerDependencies: {widgets: []}}, FSD.layerMap), /LAYER_DEPENDENCIES_UNKNOWN_LAYER|layerMap에 없다/)
  assert.throws(() => validateLayerDependencies({layerDependencies: {pages: ['app']}}, FSD.layerMap), /배열이어야/)
  assert.throws(() => validateLayerDependencies({layerDependencies: ['pages']}, FSD.layerMap), /객체여야/)
  assert.throws(() => validateLayerDependencies({layerDependencies: {pages: ['shared']}}, FSD.layerMap), /빠진 레이어가 있다: features, entities, shared/)
})

test('CLI: 위반이면 exit 1, 스팩이 없으면 exit 3(미판정), 사용법 오류는 2', () => {
  const root = project({
    '_workspace/03_dev/spec.json': FSD,
    'src/shared/a.ts': "import {b} from '../features/x/b'\n",
    'src/features/x/b.ts': 'export const b = 1\n',
  })
  const empty = project({'src/a.ts': 'export const a = 1\n'})
  try {
    const failed = spawnSync(process.execPath, [script, '--project-root', root, '--json'], {encoding: 'utf8'})
    assert.equal(failed.status, 1, failed.stderr)
    assert.equal(JSON.parse(failed.stdout).violations[0].toLayer, 'features')
    const none = spawnSync(process.execPath, [script, '--project-root', empty], {encoding: 'utf8'})
    assert.equal(none.status, 3, 'NO_SPEC을 exit 0으로 내면 종료 코드만 보는 소비자가 통과로 읽는다')
    assert.match(none.stdout, /NO_SPEC/)
    assert.equal(spawnSync(process.execPath, [script], {encoding: 'utf8'}).status, 2)
  } finally {
    rmSync(root, {recursive: true, force: true})
    rmSync(empty, {recursive: true, force: true})
  }
})
