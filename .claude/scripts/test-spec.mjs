#!/usr/bin/env node
// test-spec.mjs — 스팩 스팩 확정 회귀 (Stage 1의 안전망).
//
// 여기서 고정하는 사실:
//   (1) 미결정이 하나라도 open이면 잠글 수 없다 — "착수 전 스팩 확정"의 기계 표현
//   (2) 결정 블록은 정확히 1개여야 한다 (0개·2개 이상 거부)
//   (3) acceptanceSource와 acceptanceRefs의 자기 모순을 거부한다
//   (4) 수용 기준 부재는 거부가 아니라 specTier: unverifiable 라벨이다
//   (5) 입력이 바뀌면 스팩은 stale이다 (부재 → 존재도 변경이다)
//   (6) 확정 입력은 프로젝트 루트를 벗어날 수 없다
import assert from 'node:assert/strict'
import test from 'node:test'
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {
  buildSpec, digestInputs, extractDecisionBlock, hasUserInterface, isSpecStale,
  lockSpec, LockError, mergeSubstrate, readSubstrateDefaults, settleDecisions, validateTestLayers,
} from './spec.mjs'

const decisionBlock = decision => [
  '# Solution Design', '', '```json web-harness:solution-design',
  JSON.stringify(decision, null, 2), '```', '',
].join('\n')

const baseDecision = (overrides = {}) => ({
  stage: 0,
  targetShapes: ['web-app'],
  architecture: {pattern: 'existing', rationale: '기존 lint 설정이 레이어 어휘를 강제한다'},
  layerMap: {routes: 'src/pages/', 'pure-logic': 'src/utils/'},
  testLayers: {unit: 'src/', e2e: 'e2e/'},
  libraries: {'client-state': {choice: 'zustand', alternatives: [], source: 'measured'}},
  moduleBoundaries: [{scope: 'src/utils/**', rationale: 'React 의존 0'}],
  acceptanceSource: 'absent',
  acceptanceRefs: [],
  nonGoals: ['서버 도입'],
  openDecisions: [],
  ...overrides,
})

const withProject = (decision, run) => {
  const root = mkdtempSync(join(tmpdir(), 'web-harness-spec-lock-'))
  try {
    mkdirSync(join(root, '_workspace/02_design'), {recursive: true})
    writeFileSync(join(root, '_workspace/02_design/solution-design.md'), decisionBlock(decision))
    return run(root)
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
}

const expectLockError = (fn, code) => {
  try {
    fn()
  } catch (error) {
    assert.ok(error instanceof LockError, `LockError가 아니다: ${error}`)
    assert.equal(error.code, code)
    return
  }
  assert.fail(`${code}로 거부해야 하는데 통과했다`)
}

// ── (1) 스팩 확정이 착수 전제다 ───────────────────────────────────────────────
test('회귀 반증: open 미결정이 남아 있으면 잠글 수 없다', () => {
  expectLockError(
    () => settleDecisions([{id: 'OD-1', question: '?', status: 'open'}]),
    'SPEC_NOT_SETTLED',
  )
})

test('status 생략은 open으로 본다(fail-closed)', () => {
  expectLockError(() => settleDecisions([{id: 'OD-1', question: '?'}]), 'SPEC_NOT_SETTLED')
})

test('assumed·confirmed는 잠글 수 있고 필드가 보존된다', () => {
  const settled = settleDecisions([
    {id: 'OD-1', question: 'a?', status: 'assumed', recommended: '(a)', options: ['(a)', '(b)']},
    {id: 'OD-2', question: 'b?', status: 'confirmed'},
  ])
  assert.equal(settled.length, 2)
  assert.equal(settled[0].recommended, '(a)')
  assert.deepEqual(settled[0].options, ['(a)', '(b)'])
  assert.equal(settled[1].status, 'confirmed')
})

// ── (2) 결정 블록 정본은 하나다 ──────────────────────────────────────────────
test('결정 블록이 없으면 거부한다', () => {
  expectLockError(() => extractDecisionBlock('# 설계\n본문뿐이다\n'), 'DECISION_BLOCK_MISSING')
})

test('결정 블록이 2개면 거부한다 — 정본이 모호해선 안 된다', () => {
  const twice = decisionBlock(baseDecision()) + decisionBlock(baseDecision())
  expectLockError(() => extractDecisionBlock(twice), 'DECISION_BLOCK_AMBIGUOUS')
})

test('블록이 유효한 JSON이 아니면 거부한다', () => {
  const broken = '```json web-harness:solution-design\n{not json}\n```\n'
  expectLockError(() => extractDecisionBlock(broken), 'DECISION_BLOCK_INVALID_JSON')
})

// ── (3) 자기 모순 차단 ───────────────────────────────────────────────────────
test('feature-plan이라 주장하면서 참조가 비면 거부한다', () => {
  expectLockError(
    () => buildSpec({
      decision: baseDecision({acceptanceSource: 'feature-plan', acceptanceRefs: []}),
      digest: {inputs: [], combined: 'x'.repeat(64)},
    }),
    'ACCEPTANCE_SOURCE_CONTRADICTS_REFS',
  )
})

test('absent라 주장하면서 참조가 있으면 거부한다', () => {
  expectLockError(
    () => buildSpec({
      decision: baseDecision({acceptanceSource: 'absent', acceptanceRefs: ['FEAT-001']}),
      digest: {inputs: [], combined: 'x'.repeat(64)},
    }),
    'ACCEPTANCE_SOURCE_CONTRADICTS_REFS',
  )
})

test('architecture.rationale이 없으면 거부한다 — 무엇을 골랐는지만으로는 못 확정한다', () => {
  expectLockError(
    () => buildSpec({
      decision: baseDecision({architecture: {pattern: 'fsd'}}),
      digest: {inputs: [], combined: 'x'.repeat(64)},
    }),
    'ARCHITECTURE_RATIONALE_MISSING',
  )
})

test('libraries.source 어휘 밖 값을 거부한다', () => {
  expectLockError(
    () => buildSpec({
      decision: baseDecision({libraries: {state: {choice: 'zustand', source: 'guessed'}}}),
      digest: {inputs: [], combined: 'x'.repeat(64)},
    }),
    'LIBRARY_SOURCE_INVALID',
  )
})

// ── (4) 수용 기준 부재는 거부가 아니라 tier다 ────────────────────────────────
test('수용 기준이 없어도 잠기되 unverifiable로 표기된다', () => {
  withProject(baseDecision(), root => {
    const lock = lockSpec(root)
    assert.equal(lock.specTier, 'unverifiable')
    assert.equal(lock.acceptanceSource, 'absent')
    assert.deepEqual(lock.acceptanceRefs, [])
  })
})

test('수용 기준이 있고 feature-plan이 실존하면 verifiable이다', () => {
  withProject(baseDecision({acceptanceSource: 'feature-plan', acceptanceRefs: ['FEAT-001', 'TC-001-1']}), root => {
    mkdirSync(join(root, '_workspace/01_plan'), {recursive: true})
    writeFileSync(join(root, '_workspace/01_plan/feature-plan.md'), '# FEAT-001\n')
    const lock = lockSpec(root)
    assert.equal(lock.specTier, 'verifiable')
    assert.deepEqual(lock.acceptanceRefs, ['FEAT-001', 'TC-001-1'])
  })
})

test('회귀 반증: feature-plan이 없는데 verifiable을 주장하면 거부한다', () => {
  // 라벨-증거 언바인딩 차단. 이전 구현은 acceptanceRefs가 비어 있지만 않으면 통과시켰다.
  withProject(baseDecision({acceptanceSource: 'feature-plan', acceptanceRefs: ['FEAT-999']}), root => {
    expectLockError(() => lockSpec(root), 'ACCEPTANCE_SOURCE_WITHOUT_PLAN')
  })
})

test('회귀 반증: 결정에 id·question이 없으면 거부한다(스키마 required 결속)', () => {
  expectLockError(() => settleDecisions([{status: 'assumed'}]), 'DECISION_ID_MISSING')
  expectLockError(() => settleDecisions([{id: 'OD-1', status: 'assumed'}]), 'DECISION_QUESTION_MISSING')
})

test('스키마 required와 스팩 확정 출력 키가 일치한다', () => {
  const schema = JSON.parse(readFileSync('.claude/schemas/spec.schema.json', 'utf8'))
  withProject(baseDecision(), root => {
    const lock = lockSpec(root)
    for (const key of schema.required) {
      assert.ok(key in lock, `스키마 required '${key}'가 출력에 없다`)
    }
    for (const key of Object.keys(lock)) {
      assert.ok(key in schema.properties, `출력 키 '${key}'가 스키마에 없다`)
    }
  })
})

test('measured-absent를 유효한 source로 받는다', () => {
  withProject(baseDecision({libraries: {mock: {choice: 'none', alternatives: [], source: 'measured-absent'}}}), root => {
    assert.equal(lockSpec(root).libraries.mock.source, 'measured-absent')
  })
})

// ── (5) staleness ────────────────────────────────────────────────────────────
test('입력이 바뀌면 스팩은 stale이다', () => {
  withProject(baseDecision(), root => {
    const lock = lockSpec(root)
    assert.equal(isSpecStale(lock, root), false)
    mkdirSync(join(root, '_workspace/01_plan'), {recursive: true})
    writeFileSync(join(root, '_workspace/01_plan/feature-plan.md'), '# FEAT-001\n')
    assert.equal(isSpecStale(lock, root), true, '부재였던 입력이 생긴 것도 변경이다')
  })
})

test('digest는 부재를 present:false로 기록한다', () => {
  withProject(baseDecision(), root => {
    const digest = digestInputs(root)
    const featurePlan = digest.inputs.find(item => item.path.endsWith('feature-plan.md'))
    assert.equal(featurePlan.present, false)
    assert.equal(featurePlan.sha256, undefined)
    const design = digest.inputs.find(item => item.path.endsWith('solution-design.md'))
    assert.equal(design.present, true)
    assert.match(design.sha256, /^[0-9a-f]{64}$/)
  })
})

// ── (6) 경로 탈출 ────────────────────────────────────────────────────────────
test('확정 입력이 프로젝트 루트를 벗어나면 거부한다', () => {
  withProject(baseDecision(), root => {
    expectLockError(() => digestInputs(root, ['../escape.md']), 'LOCK_INPUT_ESCAPES_ROOT')
  })
})

test('solution-design.md가 없으면 잠글 수 없다', () => {
  const root = mkdtempSync(join(tmpdir(), 'web-harness-spec-lock-empty-'))
  try {
    expectLockError(() => lockSpec(root), 'SOLUTION_DESIGN_MISSING')
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})

// ── (7) 고정 기반: 기본 제공 + 브라운필드 실측 우선 ──────────────────────────
test('미지정 substrate는 하네스 기본값으로 채워지고 source가 default다', () => {
  const merged = mergeSubstrate(undefined, {packageManager: 'pnpm', bundler: 'vite'})
  assert.deepEqual(merged.packageManager, {value: 'pnpm', source: 'default'})
  assert.deepEqual(merged.bundler, {value: 'vite', source: 'default'})
})

test('회귀 반증: 실측값이 기본값을 이긴다', () => {
  const merged = mergeSubstrate(
    {packageManager: {value: 'npm', source: 'measured'}},
    {packageManager: 'pnpm', bundler: 'vite'},
  )
  assert.equal(merged.packageManager.value, 'npm', '기본값이 실측을 덮으면 브라운필드가 깨진다')
  assert.equal(merged.packageManager.source, 'measured')
  assert.equal(merged.bundler.source, 'default', '미지정 키는 여전히 기본값')
})

test('declared는 rationale을 요구한다 — 기본값 이탈은 판단이다', () => {
  expectLockError(
    () => mergeSubstrate({bundler: {value: 'rspack', source: 'declared'}}, {bundler: 'vite'}),
    'SUBSTRATE_DECLARED_WITHOUT_RATIONALE',
  )
  const ok = mergeSubstrate(
    {bundler: {value: 'rspack', source: 'declared', rationale: '기존 모노레포가 rspack이다'}},
    {bundler: 'vite'},
  )
  assert.equal(ok.bundler.rationale, '기존 모노레포가 rspack이다')
})

test('회귀 반증: default라 주장하면서 값이 기본값과 다르면 거부한다', () => {
  expectLockError(
    () => mergeSubstrate({bundler: {value: 'webpack', source: 'default'}}, {bundler: 'vite'}),
    'SUBSTRATE_DEFAULT_MISMATCH',
  )
})

test('회귀 반증: 기본값에 없는 키를 default라 주장하면 거부한다', () => {
  // 이 구멍이 열리면 새 키 이름 하나로 declared의 rationale 의무를 우회할 수 있다.
  expectLockError(
    () => mergeSubstrate({styling: {value: 'tailwind', source: 'default'}}, {bundler: 'vite'}),
    'SUBSTRATE_DEFAULT_UNKNOWN_KEY',
  )
})

test('기본값에 없는 키도 measured·declared로는 적을 수 있다', () => {
  const merged = mergeSubstrate(
    {styling: {value: 'tailwind', source: 'measured'}},
    {bundler: 'vite'},
  )
  assert.equal(merged.styling.source, 'measured')
})

test('substrate.source 어휘 밖 값을 거부한다', () => {
  expectLockError(
    () => mergeSubstrate({bundler: {value: 'vite', source: 'guessed'}}, {bundler: 'vite'}),
    'SUBSTRATE_SOURCE_INVALID',
  )
})

test('하네스 기본값 파일을 읽을 수 있고 핵심 키를 갖는다', () => {
  const defaults = readSubstrateDefaults()
  for (const key of ['packageManager', 'language', 'bundler', 'testRunner', 'lint']) {
    assert.ok(typeof defaults[key] === 'string' && defaults[key].length > 0, `기본값에 ${key}가 없다`)
  }
})

// ── (8) targetShape ──────────────────────────────────────────────────────────
test('targetShapes가 없거나 비면 잠글 수 없다 — 형태가 검증 방식을 정한다', () => {
  const {targetShapes, ...without} = baseDecision()
  expectLockError(
    () => buildSpec({decision: without, digest: {inputs: [], combined: 'x'.repeat(64)}}),
    'TARGET_SHAPES_MISSING',
  )
  expectLockError(
    () => buildSpec({decision: {...baseDecision(), targetShapes: []}, digest: {inputs: [], combined: 'x'.repeat(64)}}),
    'TARGET_SHAPES_MISSING',
  )
})

test('회귀 반증: 구 단수 필드는 조용히 받지 않고 거부한다', () => {
  const {targetShapes, ...rest} = baseDecision()
  expectLockError(
    () => buildSpec({decision: {...rest, targetShape: 'library'}, digest: {inputs: [], combined: 'x'.repeat(64)}}),
    'TARGET_SHAPE_SINGULAR',
  )
})

test('형태는 조합 가능하다 — 라이브러리이면서 CLI인 것이 정상이다', () => {
  withProject(baseDecision({targetShapes: ['library', 'cli']}), root => {
    assert.deepEqual(lockSpec(root).targetShapes, ['library', 'cli'])
  })
})

test('형태는 열린 문자열이다', () => {
  for (const shapes of [['web-app'], ['library'], ['cli'], ['browser-extension', 'library']]) {
    withProject(baseDecision({targetShapes: shapes}), root => {
      assert.deepEqual(lockSpec(root).targetShapes, shapes)
    })
  }
})

test('communication·concurrency는 없으면 빈 배열로 확정된다', () => {
  withProject(baseDecision(), root => {
    const lock = lockSpec(root)
    assert.deepEqual(lock.communication, [])
    assert.deepEqual(lock.concurrency, [])
  })
})

test('communication·concurrency가 보존된다', () => {
  withProject(baseDecision({communication: ['rest', 'websocket'], concurrency: ['web-worker']}), root => {
    const lock = lockSpec(root)
    assert.deepEqual(lock.communication, ['rest', 'websocket'])
    assert.deepEqual(lock.concurrency, ['web-worker'])
  })
})

// ── 테스트 레이어 (2026-08-28, 사용자 결정) ─────────────────────────────────
// 유닛은 항상, e2e는 UI가 있으면. 실측 배경: 통합으로 test-writer·visual-test-writer가
// 사라지면서 `e2e/**`를 아무도 소유하지 않게 됐고, 실제 훅으로 재현하니 쓰기가 차단됐다.

test('유닛 테스트 레이어가 없으면 스팩을 확정할 수 없다 — 형태와 무관하게 항상 요구한다', () => {
  for (const shapes of [['web-app'], ['library'], ['cli'], ['serverless-functions']]) {
    const {testLayers, ...without} = baseDecision({targetShapes: shapes})
    assert.throws(
      () => buildSpec({decision: without, digest: {inputs: [], combined: 'x'.repeat(64)}}),
      error => error instanceof LockError && error.code === 'UNIT_TEST_LAYER_MISSING',
      `${shapes.join(',')}에서 유닛 레이어 누락이 통과했다`,
    )
  }
})

test('UI를 가진 형태면 e2e 레이어가 필요하다', () => {
  assert.throws(
    () => buildSpec({decision: baseDecision({targetShapes: ['web-app'], testLayers: {unit: 'src/'}}), digest: {inputs: [], combined: 'x'.repeat(64)}}),
    error => error instanceof LockError && error.code === 'E2E_TEST_LAYER_MISSING',
  )
})

test('UI가 없는 형태면 e2e 레이어 없이도 확정된다 — 화면이 없으면 화면 검증을 강요하지 않는다', () => {
  const spec = buildSpec({decision: baseDecision({targetShapes: ['library', 'cli'], testLayers: {unit: 'src/'}}), digest: {inputs: [], combined: 'x'.repeat(64)}})
  assert.deepEqual(spec.testLayers, {unit: 'src/'})
})

test('형태가 여럿이면 하나라도 UI가 있으면 e2e를 요구한다 — 합집합이다', () => {
  assert.throws(
    () => buildSpec({decision: baseDecision({targetShapes: ['library', 'web-app'], testLayers: {unit: 'src/'}}), digest: {inputs: [], combined: 'x'.repeat(64)}}),
    error => error instanceof LockError && error.code === 'E2E_TEST_LAYER_MISSING',
  )
})

test('UI 판정은 형태 카탈로그의 userInterface에서 도출된다 — 이름 하드코딩이 아니다', () => {
  const catalog = {shapes: {'made-up-shape': {userInterface: true}, 'web-app': {userInterface: false}}}
  assert.equal(hasUserInterface(['made-up-shape'], catalog), true)
  assert.equal(hasUserInterface(['web-app'], catalog), false)   // 카탈로그가 정본이다
  // 미등록 형태는 false(UI 없음)가 아니라 'unknown'이다 — false로 퇴화하면 카탈로그 밖
  // 이름을 적는 것만으로 e2e 요구가 사라진다(적대 리뷰 2026-08-28이 잡은 fail-open).
  assert.equal(hasUserInterface(['not-in-catalog'], catalog), 'unknown')
})

test('실제 카탈로그에서 web-app은 UI, library·cli는 비UI다', () => {
  assert.equal(hasUserInterface(['web-app']), true)
  assert.equal(hasUserInterface(['ssr-web-app']), true)
  assert.equal(hasUserInterface(['library', 'cli', 'serverless-functions']), false)
})

test('빈 e2e 문자열은 선언으로 쳐주지 않는다', () => {
  assert.throws(
    () => validateTestLayers({targetShapes: ['library'], testLayers: {unit: 'src/', e2e: '   '}}),
    error => error.code === 'E2E_TEST_LAYER_EMPTY',
  )
})

test('확정된 스팩은 schemaVersion 2와 testLayers를 담는다', () => {
  const spec = buildSpec({decision: baseDecision(), digest: {inputs: [], combined: 'x'.repeat(64)}})
  assert.equal(spec.schemaVersion, 2)
  assert.deepEqual(spec.testLayers, {unit: 'src/', e2e: 'e2e/'})
})

test('카탈로그가 모르는 형태면 e2e를 스팩이 정해야 한다 — 조용히 비UI로 퇴화하지 않는다', () => {
  assert.throws(
    () => buildSpec({decision: baseDecision({targetShapes: ['dashboard-app'], testLayers: {unit: 'src/'}}), digest: {inputs: [], combined: 'x'.repeat(64)}}),
    error => error instanceof LockError && error.code === 'E2E_TEST_LAYER_UNDECIDED',
  )
})

test('미등록 형태라도 e2e를 명시적으로 없다고 적으면 확정된다 — 모르는 형태를 실패로 만들지 않는다', () => {
  const spec = buildSpec({decision: baseDecision({targetShapes: ['dashboard-app'], testLayers: {unit: 'src/', e2e: '(absent — 화면 없는 배치 작업)'}}), digest: {inputs: [], combined: 'x'.repeat(64)}})
  assert.equal(spec.testLayers.e2e, '(absent — 화면 없는 배치 작업)')
})

test('등록된 비UI 형태에 미등록 형태가 섞이면 여전히 결정을 요구한다 — 합집합이 아니라 미지가 이긴다', () => {
  assert.throws(
    () => buildSpec({decision: baseDecision({targetShapes: ['library', 'dashboard-app'], testLayers: {unit: 'src/'}}), digest: {inputs: [], combined: 'x'.repeat(64)}}),
    error => error.code === 'E2E_TEST_LAYER_UNDECIDED',
  )
})

test('UI 형태가 하나라도 있으면 미등록 형태가 섞여도 e2e 경로를 요구한다', () => {
  assert.throws(
    () => buildSpec({decision: baseDecision({targetShapes: ['web-app', 'dashboard-app'], testLayers: {unit: 'src/'}}), digest: {inputs: [], combined: 'x'.repeat(64)}}),
    error => error.code === 'E2E_TEST_LAYER_MISSING',
  )
})

test('testLayers의 미지 키는 조용히 버려지지 않고 거부된다', () => {
  assert.throws(
    () => buildSpec({decision: baseDecision({testLayers: {unit: 'src/', e2e: 'e2e/', integration: 'tests/int/'}}), digest: {inputs: [], combined: 'x'.repeat(64)}}),
    error => error instanceof LockError && error.code === 'TEST_LAYER_UNKNOWN_KEY',
  )
})
