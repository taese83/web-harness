#!/usr/bin/env node
// test-spawn-plan.mjs — validate-spawn-plan.mjs 순수 코어 회귀 테스트.
// 회귀 기준은 seminar-booking 실측이다: "계층 전체"(도메인 스토어 command 10개) 스폰이
// 스펙 재독에 168k를 쓰고 종료했다(telemetry 실측) — 그 계획이 사전에 REFUSE로 잡혀야 한다.
import assert from 'node:assert/strict'
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import test from 'node:test'
import {
  analyzePlan, checkPlanAgainstSpec, conflictingLockDigests, estimateTokens, expandReads,
  implementationOutputs, measureText, planDigest, withinScope,
} from './validate-spawn-plan.mjs'

// 예산 판정 픽스처에는 **모든 것을 소유하는 스팩**을 함께 놓는다. 스팩 결속 검사(2026-08-30)가
// 소스에 쓰는 계획에 스팩을 요구하므로, 그것을 안 놓으면 예산 테스트가 스팩 부재로 실패해
// 무엇을 재는 테스트인지 흐려진다. 스팩 결속 자체는 아래 전용 절이 따로 검증한다.
const PERMISSIVE_SPEC = {schemaVersion: 2, layerMap: {all: 'src'}, testLayers: {unit: 'src'}}

function fixture(files, {spec = PERMISSIVE_SPEC} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'wh-plan-'))
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel)
    mkdirSync(dirname(abs), {recursive: true})
    writeFileSync(abs, content)
  }
  if (spec) {
    mkdirSync(join(root, '_workspace/03_dev'), {recursive: true})
    writeFileSync(join(root, '_workspace/03_dev/spec.json'), JSON.stringify(spec))
  }
  return root
}

const withFixture = (files, fn, options) => {
  const root = fixture(files, options)
  try { return fn(root) } finally { rmSync(root, {recursive: true, force: true}) }
}

const ruleOf = report => report.violations.map(v => v.rule)

test('작은 계획(산출물 3 · 짧은 스펙) → FITS', () => {
  withFixture({'spec.md': '# 스펙\n짧다\n'}, root => {
    const report = analyzePlan(root, {task: 'small', outputs: ['src/a.ts', 'src/b.ts', 'src/c.ts'], reads: ['spec.md']})
    assert.equal(report.verdict, 'FITS')
    assert.deepEqual(report.violations, [])
  })
})

test('산출물이 임계 초과 → REFUSE(OUTPUT_FANOUT) + 분할 수 제안', () => {
  withFixture({'spec.md': '# 스펙\n'}, root => {
    const outputs = Array.from({length: 9}, (_, i) => `src/f${i}.ts`)
    const report = analyzePlan(root, {task: 'fanout', outputs, reads: ['spec.md']})
    assert.equal(report.verdict, 'REFUSE')
    assert.ok(ruleOf(report).includes('OUTPUT_FANOUT'))
    assert.match(report.violations.find(v => v.rule === 'OUTPUT_FANOUT').remedy, /2개 이상/)
  })
})

test('read 추정 토큰이 임계 초과 → REFUSE(READ_BUDGET)', () => {
  withFixture({'big.md': 'x'.repeat(4000)}, root => {
    const report = analyzePlan(root, {task: 'heavy', outputs: ['src/a.ts'], reads: ['big.md']}, {maxReadTokens: 100})
    assert.equal(report.verdict, 'REFUSE')
    assert.ok(ruleOf(report).includes('READ_BUDGET'))
    assert.ok(report.readTokens > 100)
  })
})

test('reads에 디렉터리를 적으면 하위 전체가 전개된다(과소 신고 방지)', () => {
  withFixture({
    'design/a.md': 'a'.repeat(400),
    'design/b.md': 'b'.repeat(400),
    'design/nested/c.md': 'c'.repeat(400),
  }, root => {
    const {files, missing} = expandReads(root, ['design'])
    assert.equal(files.length, 3)
    assert.deepEqual(missing, [])
    // 디렉터리 1개만 선언해도 3개 파일 전부가 예산에 계산된다.
    const report = analyzePlan(root, {outputs: ['src/a.ts'], reads: ['design']})
    assert.equal(report.readFileCount, 3)
  })
})

test('node_modules 등은 read 전개에서 제외된다', () => {
  withFixture({
    'design/a.md': 'a'.repeat(100),
    'design/node_modules/huge.js': 'x'.repeat(100000),
  }, root => {
    const {files} = expandReads(root, ['design'])
    assert.equal(files.length, 1)
    assert.match(files[0], /a\.md$/)
  })
})

test('존재하지 않는 read 경로 → REFUSE(READ_MISSING)', () => {
  withFixture({'spec.md': '# 스펙\n'}, root => {
    const report = analyzePlan(root, {outputs: ['src/a.ts'], reads: ['spec.md', 'nope/missing.md']})
    assert.equal(report.verdict, 'REFUSE')
    assert.ok(ruleOf(report).includes('READ_MISSING'))
  })
})

test('한글(비-ASCII)은 같은 문자 수라도 토큰 추정이 더 크다', () => {
  const ascii = measureText('abcdefghij')
  const hangul = measureText('가나다라마바사아자차')
  assert.equal(ascii.wideBytes, 0)
  assert.equal(hangul.asciiBytes, 0)
  assert.ok(estimateTokens(hangul) > estimateTokens(ascii))
})

test('임계는 조정 가능하다 — 완화하면 같은 계획이 FITS', () => {
  withFixture({'spec.md': '# 스펙\n'}, root => {
    const outputs = Array.from({length: 9}, (_, i) => `src/f${i}.ts`)
    const strict = analyzePlan(root, {outputs, reads: ['spec.md']}, {maxOutputs: 8})
    const loose = analyzePlan(root, {outputs, reads: ['spec.md']}, {maxOutputs: 12})
    assert.equal(strict.verdict, 'REFUSE')
    assert.equal(loose.verdict, 'FITS')
  })
})

test('reads 미선언(빈 배열)이어도 산출물 임계는 그대로 적용된다', () => {
  withFixture({}, root => {
    const outputs = Array.from({length: 20}, (_, i) => `src/f${i}.ts`)
    const report = analyzePlan(root, {outputs})
    assert.equal(report.verdict, 'REFUSE')
    assert.deepEqual(ruleOf(report), ['OUTPUT_FANOUT'])
    assert.equal(report.readTokens, 0)
  })
})

test('readMode=browse(기본): 파일 단위 선언이 상위 디렉터리로 전개된다', () => {
  withFixture({
    'design/a.md': 'a'.repeat(400),
    'design/b.md': 'b'.repeat(400),
    'design/c.md': 'c'.repeat(400),
  }, root => {
    // a.md 하나만 선언해도 형제까지 계산된다(빌더가 트리를 훑는 실측 행동 모델).
    const browse = analyzePlan(root, {outputs: ['src/x.ts'], reads: ['design/a.md']})
    assert.equal(browse.readMode, 'browse')
    assert.equal(browse.readFileCount, 3)
  })
})

test('readMode=injected: 발췌 주입을 선언하면 reads를 문자 그대로 잰다', () => {
  withFixture({
    'design/a.md': 'a'.repeat(400),
    'design/b.md': 'b'.repeat(400),
  }, root => {
    const injected = analyzePlan(root, {outputs: ['src/x.ts'], reads: ['design/a.md'], readMode: 'injected'})
    assert.equal(injected.readMode, 'injected')
    assert.equal(injected.readFileCount, 1)
  })
})

test('readMode 미지정/오타는 browse로 fail-safe (느슨한 쪽으로 기울지 않는다)', () => {
  withFixture({'design/a.md': 'a'.repeat(400), 'design/b.md': 'b'.repeat(400)}, root => {
    for (const mode of [undefined, 'INJECTED', 'inject', '', 'browse']) {
      const report = analyzePlan(root, {outputs: ['src/x.ts'], reads: ['design/a.md'], readMode: mode})
      assert.equal(report.readMode, 'browse', `readMode=${String(mode)}는 browse여야 한다`)
      assert.equal(report.readFileCount, 2)
    }
  })
})

test('browse 전개는 프로젝트 루트까지 넓히지 않는다', () => {
  withFixture({'spec.md': 's'.repeat(100), 'other.md': 'o'.repeat(100)}, root => {
    // 루트 직속 파일 선언 — 루트 전체로 전개하면 판정이 무의미해지므로 그 파일만 잰다.
    const report = analyzePlan(root, {outputs: ['src/x.ts'], reads: ['spec.md']})
    assert.equal(report.readFileCount, 1)
  })
})

test('회귀(실측 민감도): 같은 계획도 readMode에 따라 판정이 뒤집힌다', () => {
  // 2026-08-11 재구성 실험의 핵심 발견 — 좁은 선언은 REFUSE를 놓친다.
  // browse면 형제까지 계산돼 REFUSE, injected면 선언분만 계산돼 FITS.
  const big = {}
  for (let i = 0; i < 12; i++) big[`design/shard-${i}.md`] = '가'.repeat(9000)
  withFixture(big, root => {
    const browse = analyzePlan(root, {outputs: ['src/a.ts'], reads: ['design/shard-0.md']})
    const injected = analyzePlan(root, {outputs: ['src/a.ts'], reads: ['design/shard-0.md'], readMode: 'injected'})
    assert.equal(browse.verdict, 'REFUSE')
    assert.equal(injected.verdict, 'FITS')
    assert.ok(browse.readTokens > injected.readTokens * 5)
  })
})

test('오탐 0 회귀: 단일 샤드만 필요한 정당하게 좁은 스폰은 browse에서도 FITS', () => {
  // 실측(seminar-booking, 5개 산출물 디렉터리) 오탐 0을 합성으로 고정한다 —
  // browse 전개가 같은 산출물의 형제 샤드까지 합산해도 임계를 넘지 않아야 한다.
  const shards = {}
  for (let i = 0; i < 6; i++) shards[`design/state-contract/agg-${i}.md`] = '가'.repeat(3500)
  withFixture(shards, root => {
    const report = analyzePlan(root, {
      task: 'single-aggregate-builder',
      outputs: ['src/a.ts', 'src/b.ts'],
      reads: ['design/state-contract/agg-0.md'],
    })
    assert.equal(report.readFileCount, 6, '형제 샤드까지 전개된다')
    assert.equal(report.verdict, 'FITS', '정당하게 좁은 스폰을 오탐 REFUSE하면 안 된다')
  })
})

test('회귀(seminar-booking): "도메인 계층 전체" 스폰은 사전에 REFUSE된다', () => {
  // 실측 실패 형태 — command 10개 + 스토어/셀렉터/마이그레이션까지 한 스폰에 요구하고,
  // 분할 설계 산출물 전체를 read로 지정했다.
  withFixture({
    '_workspace/02_design/state-contract.md': '가'.repeat(30000),
    '_workspace/02_design/component-spec.md': '나'.repeat(30000),
    '_workspace/01_plan/feature-plan.md': '다'.repeat(30000),
  }, root => {
    const outputs = [
      ...Array.from({length: 10}, (_, i) => `src/entities/booking/model/command-${i}.ts`),
      'src/entities/booking/model/store.ts',
      'src/entities/booking/model/selectors.ts',
      'src/entities/booking/model/migrations.ts',
    ]
    const report = analyzePlan(root, {task: 'client-domain-state-builder', outputs, reads: ['_workspace']})
    assert.equal(report.verdict, 'REFUSE')
    assert.ok(ruleOf(report).includes('OUTPUT_FANOUT'), '계층 단위 산출물 팬아웃이 잡혀야 한다')
    assert.ok(ruleOf(report).includes('READ_BUDGET'), '스펙 전체 재독 예산이 잡혀야 한다')
    // 가장 큰 read를 보고해 어디를 발췌/분할할지 알려준다.
    assert.ok(report.largestReads.length > 0)
  })
})

// --- 재확정 사전 거부 (2026-08-12, 리뷰 지적: 사후 탐지보다 사전 차단이 근본) ---

test('conflictingLockDigests: 같은 계획 재확정은 충돌 아님(멱등)', () => {
  const plan = {task: 'x', outputs: ['a.ts'], reads: ['s']}
  const ledger = [{task: 'x', digest: planDigest(plan), at: 'T0'}]
  assert.deepEqual(conflictingLockDigests(plan, ledger), [])
})

test('conflictingLockDigests: 축소된 계획은 원장 최초 digest와 충돌 → 재확정 거부', () => {
  const original = {task: 'x', outputs: ['a.ts', 'b.ts', 'c.ts'], reads: ['s']}
  const shrunk = {task: 'x', outputs: ['a.ts'], reads: ['s']}
  const ledger = [{task: 'x', digest: planDigest(original), at: 'T0'}]
  const conflicts = conflictingLockDigests(shrunk, ledger)
  assert.equal(conflicts.length, 1)
  assert.equal(conflicts[0], planDigest(original))
})

test('conflictingLockDigests: 매니페스트 내장 planLock만 있어도 충돌을 잡는다', () => {
  const original = {task: 'x', outputs: ['a.ts', 'b.ts'], reads: ['s']}
  const shrunk = {task: 'x', outputs: ['a.ts'], reads: ['s'], planLock: {digest: planDigest(original), at: 'T0'}}
  assert.deepEqual(conflictingLockDigests(shrunk, null), [planDigest(original)])
})

test('conflictingLockDigests: 다른 task의 스팩은 간섭하지 않는다', () => {
  const plan = {task: 'mine', outputs: ['a.ts'], reads: ['s']}
  const ledger = [{task: 'other', digest: 'deadbeefdeadbeef', at: 'T0'}]
  assert.deepEqual(conflictingLockDigests(plan, ledger), [])
})

test('한계 고지(회귀): 원장·planLock을 모두 지우면 충돌이 사라진다 — 위조 성립', () => {
  // 로컬 증거를 전부 파기하면 최초 스팩과 구분할 수 없다(tamper-evident의 구조적 한계).
  // 이 테스트는 "막았다"가 아니라 "여기까지가 한계"임을 코드로 고정한다(§4 등록).
  const shrunk = {task: 'x', outputs: ['a.ts'], reads: ['s']}
  assert.deepEqual(conflictingLockDigests(shrunk, null), [], '증거 전부 파기 시 기계는 막지 못한다')
})

// ── 확정 스팩과의 결속 (2026-08-30) ─────────────────────────────────────────
// 배경: 매니페스트가 스팩보다 76분 앞서 잠겼고 아무것도 그 순서를 보지 않았다. 두 아티팩트가
// 어긋난 채 구현에 도달해, 개발 세션이 "어느 쪽이 정본이냐"를 **사용자에게 물었다** —
// 사용자가 잠금 시각을 알 도리가 없으니 답할 근거가 없는 질문이다. 기계가 판정해야 한다.

test('범위 판정은 세그먼트 단위다 — 문자열 접두로 새지 않는다', () => {
  assert.equal(withinScope('src/entities/track/lib/parse/p.ts', 'src/entities/track/lib/parse'), true)
  assert.equal(withinScope('src/entities/track/lib/parse-track-string.ts', 'src/entities/track/lib/parse'), false,
    '문자열 접두로 보면 이것이 통과한다 — 실측 결함이 정확히 이 형태였다')
  assert.equal(withinScope('src/main.tsx', 'src/main.tsx'), true, '파일 항목은 완전 일치')
  assert.equal(withinScope('src/mainX.tsx', 'src/main.tsx'), false)
  assert.equal(withinScope('e2e/a.spec.ts', 'e2e/**'), true, '글롭 꼬리는 디렉터리 접두와 같게 읽는다')
})

test('구현 스폰 여부는 outputs에서 도출한다 — 자기선언이 아니다', () => {
  assert.deepEqual(implementationOutputs(['_workspace/02_design/a.md', 'src/x.ts']), ['src/x.ts'])
  assert.deepEqual(implementationOutputs(['_workspace/01_plan/a.md']), [])
})

test('설계 스폰(산출물이 전부 _workspace)은 스팩을 요구하지 않는다', () => {
  withFixture({'spec.md': '# 짧다\n'}, root => {
    const report = analyzePlan(root, {task: 'design', outputs: ['_workspace/02_design/layout-spec.md'], reads: ['spec.md']})
    assert.equal(report.specCheck.state, 'NOT_IMPLEMENTATION')
    assert.ok(!ruleOf(report).includes('SPEC_REQUIRED'))
  }, {spec: null})
})

test('소스에 쓰는 계획인데 스팩이 없으면 거부한다 — 순서가 강제된다', () => {
  withFixture({'spec.md': '# 짧다\n'}, root => {
    const report = analyzePlan(root, {task: 'impl', outputs: ['src/a.ts'], reads: ['spec.md']})
    assert.equal(report.verdict, 'REFUSE')
    assert.ok(ruleOf(report).includes('SPEC_REQUIRED'))
  }, {spec: null})
})

test('아무도 소유하지 않는 경로에 쓰려 하면 거부한다', () => {
  const spec = {schemaVersion: 2, layerMap: {domain: 'src/entities'}, testLayers: {unit: 'src'}}
  withFixture({'spec.md': '# 짧다\n'}, root => {
    const report = analyzePlan(root, {task: 'impl', outputs: ['random/nowhere.ts'], reads: ['spec.md']})
    assert.ok(ruleOf(report).includes('PLAN_OUTSIDE_SPEC_OWNERSHIP'))
  }, {spec})
})

// 오탐 0 회귀: 스캐폴더가 쓰는 루트 설정·docs는 layerMap에 있을 수 없다(루트를 레이어로
// 만들 수 없다). 등록부가 소유하고 훅이 허용하는데 게이트가 막으면, 오케스트레이터는
// "이 스폰엔 게이트를 건너뛴다"를 학습한다 — 게이트가 그렇게 침식된다(적대 리뷰 2026-08-30).
test('등록부가 소유하는 스캐폴더 경로는 오탐하지 않는다', () => {
  const spec = {schemaVersion: 2, layerMap: {domain: 'src/entities'}, testLayers: {unit: 'src'}}
  withFixture({'spec.md': '# 짧다\n'}, root => {
    const report = analyzePlan(root, {
      task: 'scaffold',
      outputs: ['package.json', 'vite.config.ts', 'docs/notes.md'],
      reads: ['spec.md'],
    })
    assert.deepEqual(report.specCheck.outsideOwnership, [])
    assert.equal(report.verdict, 'FITS')
  }, {spec})
})

// 모듈 경계는 **스팩 소유 영역 안**에서만 잰다 — 스캐폴더의 루트 설정에 경계를 요구하면
// 같은 오탐이 경계 검사로 자리만 옮긴다.
test('모듈 경계 검사는 스팩 소유 경로에만 적용된다', () => {
  const spec = {
    schemaVersion: 2,
    layerMap: {domain: 'src/entities'},
    testLayers: {unit: 'src'},
    moduleBoundaries: [{scope: 'src/entities/track/lib/parse', rationale: 'FEAT-002'}],
  }
  withFixture({'spec.md': '# 짧다\n'}, root => {
    const report = analyzePlan(root, {task: 'mixed', outputs: ['package.json'], reads: ['spec.md']})
    assert.deepEqual(report.specCheck.outsideBoundary, [], '스팩이 소유하지 않는 경로는 경계 대상이 아니다')
    assert.equal(report.verdict, 'FITS')
  }, {spec})
})

// 모노레포 선행 세그먼트는 훅이 덮는다(appPrefix). 게이트가 자체 구현이던 초안은 이것을
// 밖으로 판정해 정당한 모노레포 계획을 전면 REFUSE했다 — 판정을 등록부로 통일해 해소.
test('모노레포 선행 세그먼트에서 훅과 같은 판정을 낸다', () => {
  assert.equal(withinScope('apps/web/src/entities/a.ts', 'src/entities'), true)
})

// `_workspace/../src/x.ts`로 적으면 구현 분류가 꺼져 검사가 통째로 우회됐다.
test('경로를 정규화한 뒤 구현 여부를 가른다 — `..`로 검사를 끄지 못한다', () => {
  assert.deepEqual(implementationOutputs(['_workspace/../src/x.ts']), ['src/x.ts'])
})

test('선언된 모듈 경계 밖이면 거부한다 — 실측 결함의 재현', () => {
  const spec = {
    schemaVersion: 2,
    layerMap: {domain: 'src/entities'},
    testLayers: {unit: 'src'},
    moduleBoundaries: [{scope: 'src/entities/track/lib/parse', rationale: 'FEAT-002'}],
  }
  withFixture({'spec.md': '# 짧다\n'}, root => {
    const inside = analyzePlan(root, {task: 'impl', outputs: ['src/entities/track/lib/parse/p.ts'], reads: ['spec.md']})
    assert.equal(inside.verdict, 'FITS')
    const outside = analyzePlan(root, {task: 'impl', outputs: ['src/entities/track/lib/parse-track-string.ts'], reads: ['spec.md']})
    assert.ok(ruleOf(outside).includes('PLAN_OUTSIDE_MODULE_BOUNDARY'),
      '경계 안에 있는 것처럼 보이지만 세그먼트가 다르다 — 이것이 사용자에게 질문으로 새어나갔던 그 경로다')
  }, {spec})
})

test('모듈 경계를 선언하지 않은 프로젝트는 그 검사로 실패하지 않는다', () => {
  const spec = {schemaVersion: 2, layerMap: {all: 'src'}, testLayers: {unit: 'src'}}
  withFixture({'spec.md': '# 짧다\n'}, root => {
    const report = analyzePlan(root, {task: 'impl', outputs: ['src/a.ts'], reads: ['spec.md']})
    assert.equal(report.specCheck.outsideBoundary, null, '미선언은 검사 미수행이지 실패가 아니다')
    assert.equal(report.verdict, 'FITS')
  }, {spec})
})

test('checkPlanAgainstSpec은 순수다 — spec을 넘기면 파일을 읽지 않는다', () => {
  const result = checkPlanAgainstSpec(
    {outputs: ['src/a.ts']},
    {layerMap: {all: 'src'}, testLayers: {unit: 'src'}, moduleBoundaries: []},
  )
  assert.equal(result.state, 'CHECKED')
  assert.deepEqual(result.outsideOwnership, [])
})
