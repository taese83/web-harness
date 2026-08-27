#!/usr/bin/env node
// test-always-read-marker.mjs — always-read 마커의 언어 독립성 회귀 (영문화 선행 작업).
//
// 왜 이 테스트가 있나: 계약 본문을 영어로 옮기면 한국어 문자열에 의존하던 마커가 매칭에
// 실패해 **참조 0건 = 조용히 통과**가 된다(번역이 게이트를 끄는데 CI는 green). 여기서
// 고정하는 사실은 두 가지다 — (1) 중립 앵커가 언어와 무관하게 정확히 세어진다,
// (2) 영어 자연어 매칭은 경계가 없어 부정확하며 **느슨한 쪽이 아니라 엄격한 쪽으로** 틀린다.
//
// 실측 근거: 한국어는 SOV라 `항상 … 읽는다`가 always-read 목록을 감싸 조건부 읽기와
// 구분된다. 영어는 SVO라 그 경계가 없어 같은 줄의 조건부 참조까지 삼킨다(과대계수 → FAIL).
import assert from 'node:assert/strict'
import test from 'node:test'
import {countAlwaysReadRefs} from './validators/validate-contract-hygiene.mjs'

test('한국어 SOV 마커: 감싼 범위의 참조만 센다(조건부 읽기 제외)', () => {
  const line = '항상 `references/a.md`와 `references/b.md`를 읽는다. 구현은 `references/c.md`를 따른다.'
  assert.equal(countAlwaysReadRefs(line), 2)
})

test('중립 앵커: 언어와 무관하게 정확히 센다(권장 경로)', () => {
  const en = '<!-- always-read -->\n- `references/a.md`\n- `references/b.md`\n<!-- /always-read -->\nSee `references/c.md` when relevant.'
  assert.equal(countAlwaysReadRefs(en), 2)
})

test('중립 앵커는 앵커 밖 참조를 세지 않는다', () => {
  const text = 'Prelude `references/z.md`\n<!-- always-read -->\n- `references/a.md`\n<!-- /always-read -->\nAlso `references/y.md`'
  assert.equal(countAlwaysReadRefs(text), 1)
})

test('마커 부재 → 0 (호출부의 MARKER_LOST 가드가 이 0을 FAIL로 처리한다)', () => {
  assert.equal(countAlwaysReadRefs('No marker here, just `references/a.md`.'), 0)
})

test('영어 자연어: 경계가 없어 같은 줄 조건부 참조까지 삼킨다 — 느슨한 쪽이 아니라 과대계수로 틀린다', () => {
  const line = 'Always read `references/a.md` and `references/b.md`. Implementation follows `references/c.md`.'
  // 3 > 실제 2 — 과대계수는 ratchet에서 FAIL로 드러나므로 저자가 중립 앵커로 옮기게 된다.
  // (조용히 통과하는 과소계수보다 안전한 방향)
  assert.equal(countAlwaysReadRefs(line), 3)
})

test('영어 자연어라도 한 줄에 always-read만 있으면 정확하다', () => {
  assert.equal(countAlwaysReadRefs('Always read `references/a.md` and `references/b.md`.'), 2)
})

// ── 앵커 우선 + 바이트 실측 (2026-08-20, protected-core §4 "always-read 카운터" TODO 해소)
test('앵커가 있으면 산문 휴리스틱을 이긴다 — 뒤쪽 무관한 "항상…읽는다"에 걸리지 않는다', () => {
  // 실측 회귀: web-orchestrator SKILL.md에서 정규식이 129행 "plan-reviewer를 항상 실행하고…"에
  // 걸려 실제 목록(앵커 안)이 전혀 집계되지 않았고, baseline 2가 그 오집계와 self-consistent했다.
  const text = [
    '<!-- always-read -->',
    '- `references/a.md`, `references/b.md`',
    '<!-- /always-read -->',
    '',
    '- plan-reviewer를 항상 실행하고 결과는 `references/decoy.md`에 남긴다고 읽는다',
  ].join('\n')
  assert.equal(countAlwaysReadRefs(text), 2)  // decoy.md는 앵커 밖이라 미집계
})

test('앵커 없는 문서는 종전 산문 매칭으로 하위 호환된다', () => {
  assert.equal(countAlwaysReadRefs('항상 `references/a.md`를 읽는다'), 1)
})

test('바이트 실측: SKILL.md 본문 + 앵커 안 참조를 합산하고, 경로 오타는 0이 아니라 missing이다', async () => {
  const {mkdtempSync, mkdirSync, writeFileSync, rmSync} = await import('node:fs')
  const {tmpdir} = await import('node:os')
  const {join} = await import('node:path')
  const {measureAlwaysReadBytes} = await import('./validators/validate-contract-hygiene.mjs')
  const root = mkdtempSync(join(tmpdir(), 'always-read-bytes-'))
  try {
    mkdirSync(join(root, 'references'), {recursive: true})
    writeFileSync(join(root, 'references', 'a.md'), 'x'.repeat(100))
    writeFileSync(join(root, 'references', 'b.md'), 'y'.repeat(250))
    const text = '<!-- always-read -->\n- `references/a.md`, `references/b.md`\n<!-- /always-read -->'
    // 2026-08-26: 진입 비용에 **SKILL.md 본문**이 포함된다. 종전에는 참조만 세서
    // web-orchestrator 공표 진입 비용이 실제의 43%였다 — 예산 게이트가 가장 큰
    // 항목(SKILL.md 38KB)을 보지 않았다.
    const bodyBytes = Buffer.byteLength(text, 'utf8')
    assert.deepEqual(measureAlwaysReadBytes(text, root), {bytes: 350 + bodyBytes, files: 3, missing: []})

    // 경로 오타가 "비용 0"으로 조용히 집계되면 진입 비용 공표가 거짓이 된다 — missing으로 드러난다.
    const typo = '<!-- always-read -->\n- `references/nope.md`\n<!-- /always-read -->'
    assert.deepEqual(measureAlwaysReadBytes(typo, root),
      {bytes: Buffer.byteLength(typo, 'utf8'), files: 1, missing: ['references/nope.md']})
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})
