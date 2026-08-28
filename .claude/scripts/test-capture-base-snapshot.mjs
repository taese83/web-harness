// capture-base-snapshot의 순수 함수 — 치환 극성(fail-closed)과 앵커 검사가 핵심이다.
// 계약: skills/web-orchestrator/references/design-approval-contract.md
import {strict as assert} from 'node:assert'
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {test} from 'node:test'
import {
  collectPreservedStrings, findOrphanedAnchors, normalizeRoute,
  readAnchorMap, shouldPreserve, substituteValue,
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

test('보존은 allowlist다 — 미등록 문자열은 치환된다(fail-closed)', () => {
  const preserved = new Set(['주문 관리', '고객명'])
  assert.equal(shouldPreserve('주문 관리', preserved), true)
  assert.equal(shouldPreserve('김철수', preserved), false)
  assert.equal(shouldPreserve('', preserved), true)
})

test('보존 어휘가 비면 모든 것이 치환된다 — 빈 allowlist가 열리지 않는다', () => {
  assert.equal(shouldPreserve('주문 관리', new Set()), false)
})

test('collectPreservedStrings는 소스 리터럴과 JSX 텍스트를 모은다', () => {
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
