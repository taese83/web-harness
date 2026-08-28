// capture-base-snapshot의 순수 함수 — 치환 극성(fail-closed)과 앵커 검사가 핵심이다.
// 계약: skills/web-orchestrator/references/design-approval-contract.md
import {strict as assert} from 'node:assert'
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {test} from 'node:test'
import {
  collectPreservedStrings, finalizeCapture, findOrphanedAnchors, findSlugCollisions,
  maskValue, normalizeRoute, readAnchorMap, shouldPreserve, slugFor, substituteValue,
} from '../skills/web-orchestrator/assets/capture-base-snapshot.mjs'

const withTempDir = body => {
  const dir = mkdtempSync(join(tmpdir(), 'wh-capture-'))
  try { return body(dir) } finally { rmSync(dir, {recursive: true, force: true}) }
}

test('치환은 형태를 보존한다 — 레이아웃이 검토 대상이기 때문', () => {
  assert.equal(substituteValue('김철수'), '○○○')
  assert.equal(substituteValue('128,000'), '000,000')
  assert.equal(substituteValue('Kim Chulsoo'), 'Xxx Xxxxxxx')
  // 이메일도 전용 분기 없이 일반 규칙으로 길이가 그대로 남는다
  assert.equal(substituteValue('chulsoo.kim@realmail.com'), 'xxxxxxx.xxx@xxxxxxxx.xxx')
  assert.equal(substituteValue('a@b.kr'), 'x@x.xx')
})

test('치환은 스크립트를 가리지 않는다 — 한글만 덮고 나머지를 흘려보내지 않는다', () => {
  // 종전 규칙(`[가-힣]`·`[A-Za-z]`·`\d`)은 아래를 전부 identity로 통과시키면서
  // substitutedCount만 올렸다 — "치환됨"이 마스킹을 뜻하지 않았다(적대 리뷰 HIGH).
  assert.equal(substituteValue('山田太郎'), '○○○○')
  assert.equal(substituteValue('やまだ'), '○○○')
  assert.equal(substituteValue('Иванов'), 'Xxxxxx')
  assert.equal(substituteValue('José'), 'Xxxx')
  assert.equal(substituteValue('０１２'), '000')
  for (const raw of ['山田太郎', 'Иванов', 'José', '０１２']) {
    assert.notEqual(substituteValue(raw), raw, `${raw}가 원문 그대로 통과했다`)
  }
})

test('보존은 allowlist다 — 미등록 문자열은 치환된다(fail-closed)', () => {
  const preserved = new Set(['주문 관리', '고객명'])
  assert.equal(shouldPreserve('주문 관리', preserved), true)
  assert.equal(shouldPreserve('김철수', preserved), false)
  assert.equal(shouldPreserve('', preserved), true)
})

test('보존 어휘가 비면 모든 것이 치환된다 — 빈 allowlist가 열리지 않는다', () => {
  assert.equal(shouldPreserve('주문 관리', new Set()), false)
  assert.equal(maskValue('김철수', new Set()), '○○○')
})

test('부분 일치는 **구간만** 보존한다 — 템플릿 접두사가 실데이터를 업고 나가지 않는다', () => {
  // 이것이 fail-open이던 자리다: 종전에는 6자 이상 리터럴이 포함되기만 하면 문자열
  // 전체를 보존해서 `Signed in as jane@corp.com`이 통째로 커밋됐다(적대 리뷰 HIGH).
  const preserved = new Set(['Signed in as ', '주문번호: '])
  const masked = maskValue('Signed in as jane@corp.com', preserved)
  assert.equal(masked.startsWith('Signed in as '), true, '고정부는 읽혀야 한다')
  assert.equal(masked.includes('jane'), false, '변수부가 남았다')
  assert.equal(masked.includes('corp'), false, '변수부가 남았다')
  assert.equal(masked.length, 'Signed in as jane@corp.com'.length, '길이가 보존되지 않았다')

  const order = maskValue('주문번호: 20250815', preserved)
  assert.equal(order, '주문번호: 00000000')
})

test('astral 문자도 마스킹된다 — surrogate 반쪽 처리로 새지 않는다', () => {
  const masked = maskValue('𠮷田', new Set())
  assert.equal(masked.includes('𠮷'), false)
})

test('collectPreservedStrings는 소스 리터럴과 템플릿 텍스트를 모은다', () => {
  withTempDir(dir => {
    mkdirSync(join(dir, 'node_modules'), {recursive: true})
    writeFileSync(join(dir, 'node_modules', 'leak.ts'), 'const a = "노드모듈문구"')
    writeFileSync(join(dir, 'a.tsx'), 'const label = "고객명"\nexport const C = () => <p>주문이 없습니다</p>')
    const preserved = collectPreservedStrings(dir)
    assert.equal(preserved.has('고객명'), true)
    assert.equal(preserved.has('주문이 없습니다'), true)
    assert.equal(preserved.has('노드모듈문구'), false)
  })
})

test('수집은 JSX 밖 프레임워크도 읽는다 — .vue/.svelte에서 allowlist가 비면 화면이 뭉개진다', () => {
  withTempDir(dir => {
    writeFileSync(join(dir, 'Orders.vue'), '<template><p>주문이 없습니다</p></template>')
    writeFileSync(join(dir, 'Cart.svelte'), '<h1>장바구니</h1>')
    const preserved = collectPreservedStrings(dir)
    assert.equal(preserved.has('주문이 없습니다'), true)
    assert.equal(preserved.has('장바구니'), true)
  })
})

test('collectPreservedStrings는 없는 경로에서 빈 집합이다', () => {
  assert.equal(collectPreservedStrings(join(tmpdir(), 'wh-absent-dir-xyz')).size, 0)
  assert.equal(collectPreservedStrings(null).size, 0)
})

test('readAnchorMap은 필드 누락을 거부한다', () => {
  withTempDir(dir => {
    const path = join(dir, 'a.json')
    writeFileSync(path, JSON.stringify({anchors: [{anchorId: 'a', featureId: 'F', route: '/'}]}))
    assert.throws(() => readAnchorMap(path), /selector/)
    writeFileSync(path, JSON.stringify({anchors: [{anchorId: '  ', featureId: 'F', route: '/', selector: '#x'}]}))
    assert.throws(() => readAnchorMap(path), /anchorId/)
  })
})

test('readAnchorMap은 경로가 없으면 빈 배열이다 — 앵커는 선택이다', () => {
  assert.deepEqual(readAnchorMap(null), [])
})

test('findOrphanedAnchors는 캡처하지 않는 route의 앵커를 잡는다', () => {
  const map = [
    {anchorId: 'a', featureId: 'F', route: '/orders', selector: '#x'},
    {anchorId: 'b', featureId: 'F', route: '/', selector: '#y'},
  ]
  assert.deepEqual(findOrphanedAnchors(map, ['/']), ['a(/orders)'])
  assert.deepEqual(findOrphanedAnchors(map, ['/', '/orders']), [])
})

test('route 정규화는 슬래시 유무 불일치로 헛경보를 내지 않는다', () => {
  assert.equal(normalizeRoute('orders'), '/orders')
  assert.equal(normalizeRoute('/orders'), '/orders')
  assert.deepEqual(findOrphanedAnchors([{anchorId: 'a', featureId: 'F', route: 'orders', selector: '#x'}], ['/orders']), [])
})

test('slug 충돌은 조용한 덮어쓰기다 — 캡처 전에 잡는다', () => {
  assert.equal(slugFor('/a/b'), 'a-b')
  assert.deepEqual(findSlugCollisions(['/']), [])
  assert.equal(findSlugCollisions(['/a/b', '/a-b']).length, 1)
})

// ── finalizeCapture: 브라우저 결과 → 파일. main()의 발화 지점을 결박한다 ──────────
const capturedOf = (overrides = {}) => ({
  html: '<html><head></head><body><p>본문</p></body></html>',
  css: 'p { color: red }',
  styleMode: 'stylesheets',
  title: '제목',
  stamped: [],
  unmatched: [],
  ambiguous: [],
  ...overrides,
})

const finalize = (overrides, preserved = new Set()) =>
  finalizeCapture({captured: capturedOf(overrides), route: '/', url: 'http://127.0.0.1:1/', preserved})

test('미매칭 앵커는 문서를 만들기 전에 죽는다', () => {
  assert.throws(() => finalize({unmatched: ['wh-a']}), /매칭되지 않았다/)
})

test('한 셀렉터가 여러 요소에 걸리면 죽는다 — 엉뚱한 요소에 배지가 붙는다', () => {
  assert.throws(() => finalize({ambiguous: ['wh-a(3)']}), /여러 요소에 걸린다/)
})

test('앵커가 있으면 오버레이 부트스트랩이 정확히 하나 들어간다', () => {
  const withAnchor = finalize({stamped: ['wh-a']})
  assert.equal(withAnchor.overlayBootstrapped, true)
  assert.equal(withAnchor.html.split('data-wh-overlay-bootstrap').length - 1, 1)
  // 부트스트랩은 치환 뒤에 들어가야 한다 — 먼저 넣으면 import 문이 치환돼 깨진다
  assert.equal(withAnchor.html.includes("import {initWhOverlay} from '../wh-overlay.mjs'"), true)
})

test('앵커가 없으면 스냅샷에 script가 하나도 없다', () => {
  const plain = finalize({})
  assert.equal(plain.overlayBootstrapped, false)
  assert.equal(/<script/i.test(plain.html), false)
})

test('title도 마스킹된다 — meta.json에 원문이 실리던 경로다', () => {
  const result = finalize({title: '김철수님 주문 관리 대시보드'}, new Set(['주문 관리 대시보드']))
  assert.equal(result.title.includes('김철수'), false)
  assert.equal(result.title.includes('주문 관리 대시보드'), true)
})

test('구간 보존 하한은 6자다 — 짧은 리터럴은 전체 일치로만 보존된다', () => {
  // 하한을 낮추면 짧은 어휘가 실데이터 안에서 우연히 걸려 조각이 살아남는다.
  // 짧은 문구가 아쉬우면 어휘를 늘리는 게 아니라 **전체 일치**로 보존된다.
  const preserved = new Set(['이름'])
  assert.equal(maskValue('이름', preserved), '이름', '전체 일치는 보존된다')
  assert.equal(maskValue('이름: 김철수', preserved), '○○: ○○○', '부분 일치는 하한 미만이라 보존되지 않는다')
})

test('민감 속성값도 마스킹된다 — 텍스트 노드 치환이 닿지 않는 경로다', () => {
  const result = finalize({
    html: '<html><head></head><body><input value="김철수" placeholder="이름" title="010-1234-5678"></body></html>',
  }, new Set(['이름']))
  assert.equal(result.html.includes('김철수'), false)
  assert.equal(result.html.includes('010-1234-5678'), false)
  assert.equal(result.html.includes('placeholder="이름"'), true)
})

test('1자 텍스트 노드도 마스킹된다 — 인라인 태그로 쪼개진 이름이 남지 않는다', () => {
  const result = finalize({html: '<html><head></head><body><span>김</span><span>철</span></body></html>'})
  assert.equal(result.html.includes('>김<'), false)
  assert.equal(result.html.includes('>철<'), false)
})

test('수집한 CSS는 문서에 실린다 — 반응형이 검토 대상이다', () => {
  assert.equal(finalize({}).html.includes('<style>p { color: red }</style>'), true)
})
