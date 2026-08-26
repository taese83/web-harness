#!/usr/bin/env node
// test-spec-conformance.mjs — 스팩 정합 검사 회귀 (Stage 2a의 안전망).
//
// 여기서 고정하는 사실:
//   (1) measured 주장이 실측과 어긋나면 FAIL — 잠금이 자기보고 봉인이 되지 않게 하는 핵심
//   (2) layerMap이 없는 경로를 가리키면 FAIL
//   (3) 잠금 이후 입력이 바뀌면 FAIL (staleness 소비)
//   (4) substrate가 하네스 toolchain pin과 어긋나면 FAIL
//   (5) 검증할 수 없었던 것은 침묵하지 않고 unverifiable로 보고한다
//   (6) spec-lock이 없으면 실패가 아니라 NOT_LOCKED
import assert from 'node:assert/strict'
import test from 'node:test'
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {
  checkLayerMap, checkLayerMapCoverage, checkLibraries, checkShapeEvidence, checkSubstrate, checkTargetShapes, checkToolchainAlignment,
  readShapeChecks, resolveRequiredChecks,
  collectDeclaredPackages, inspectSpecConformance,
} from './validate-spec-conformance.mjs'
import {lockSpec, readSubstrateDefaults} from './lock-spec.mjs'
import {readFileSync} from 'node:fs'

const decisionBlock = decision => [
  '```json web-harness:solution-design', JSON.stringify(decision, null, 2), '```', '',
].join('\n')

const baseDecision = (overrides = {}) => ({
  targetShapes: ['web-app'],
  architecture: {pattern: 'existing', rationale: '기존 관례'},
  layerMap: {},
  libraries: {},
  moduleBoundaries: [],
  acceptanceSource: 'absent',
  acceptanceRefs: [],
  nonGoals: [],
  openDecisions: [],
  ...overrides,
})

// 잠금까지 만들어 둔 프로젝트를 세운다.
const withLockedProject = ({decision = baseDecision(), manifest = {}, files = []}, run) => {
  const root = mkdtempSync(join(tmpdir(), 'web-harness-spec-conf-'))
  try {
    mkdirSync(join(root, '_workspace/02_design'), {recursive: true})
    mkdirSync(join(root, '_workspace/03_dev'), {recursive: true})
    writeFileSync(join(root, 'package.json'), `${JSON.stringify({name: 'fixture', ...manifest})}\n`)
    for (const file of files) {
      const parent = file.includes('/') ? file.replace(/\/[^/]*$/, '') : ''
      if (parent) mkdirSync(join(root, parent), {recursive: true})
      writeFileSync(join(root, file), '')
    }
    writeFileSync(join(root, '_workspace/02_design/solution-design.md'), decisionBlock(decision))
    writeFileSync(join(root, '_workspace/03_dev/spec-lock.json'), `${JSON.stringify(lockSpec(root), null, 2)}\n`)
    return run(root)
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
}

// ── (6) 잠금 부재 ────────────────────────────────────────────────────────────
test('spec-lock이 없으면 NOT_LOCKED이지 실패가 아니다', () => {
  const root = mkdtempSync(join(tmpdir(), 'web-harness-spec-conf-empty-'))
  try {
    const result = inspectSpecConformance({projectRoot: root})
    assert.equal(result.status, 'NOT_LOCKED')
    assert.equal(result.failures.length, 0)
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})

// ── (1) measured 위조 차단 — 이 검사의 존재 이유 ─────────────────────────────
test('회귀 반증: libraries가 measured라 주장하나 의존성에 없으면 FAIL', () => {
  const declared = {names: new Set(['react']), packageManagerField: null}
  const {failures} = checkLibraries(
    {libraries: {state: {choice: 'zustand', source: 'measured'}}}, declared,
  )
  assert.equal(failures.length, 1, '위조가 통과하면 잠금이 자기보고 봉인이 된다')
  assert.match(failures[0].reason, /zustand가 없다/)
})

test('선언에 있으면 통과하고, 버전 접미가 붙어도 이름으로 대조한다', () => {
  const declared = {names: new Set(['zustand']), packageManagerField: null}
  assert.equal(checkLibraries({libraries: {state: {choice: 'zustand@^5.0.0', source: 'measured'}}}, declared).failures.length, 0)
})

test('proposed는 대조하지 않는다 — 아직 실측이 아니다', () => {
  const declared = {names: new Set(), packageManagerField: null}
  assert.equal(checkLibraries({libraries: {state: {choice: 'zustand', source: 'proposed'}}}, declared).failures.length, 0)
})

test('substrate가 measured라 주장하나 근거가 없으면 FAIL', () => {
  const declared = {names: new Set(['vite']), packageManagerField: null}
  const {failures} = checkSubstrate({constitution: {substrate: {testRunner: {value: 'vitest', source: 'measured'}}}}, declared, '/tmp')
  assert.equal(failures.length, 1)
  assert.match(failures[0].reason, /vitest 선언도 설정 파일도 없다/)
})

test('substrate measured가 설정 파일로도 충족된다', () => {
  withLockedProject({
    decision: baseDecision({constitution: {substrate: {bundler: {value: 'vite', source: 'measured'}}}}),
    files: ['vite.config.ts'],
  }, root => {
    const result = inspectSpecConformance({projectRoot: root})
    assert.equal(result.status, 'PASS', JSON.stringify(result.failures))
  })
})

// ── (2) layerMap 실존 ────────────────────────────────────────────────────────
test('회귀 반증: layerMap이 없는 경로를 가리키면 FAIL', () => {
  const failures = checkLayerMap({layerMap: {routes: 'src/pages/'}}, '/tmp/definitely-not-here-xyz')
  assert.equal(failures.length, 1)
  assert.match(failures[0].reason, /존재하지 않는다/)
})

test('괄호로 부재를 표기한 항목은 경로 주장이 아니다', () => {
  assert.equal(checkLayerMap({layerMap: {api: '(absent — 네트워크 계층 없음)'}}, '/tmp').length, 0)
})

test('루트를 벗어나는 경로를 거부한다', () => {
  const failures = checkLayerMap({layerMap: {escape: '../outside/'}}, '/tmp')
  assert.equal(failures.length, 1)
  assert.match(failures[0].reason, /루트를 벗어난다/)
})

// ── (3) staleness 소비 ───────────────────────────────────────────────────────
test('회귀 반증: 잠금 이후 입력이 바뀌면 FAIL', () => {
  withLockedProject({}, root => {
    assert.equal(inspectSpecConformance({projectRoot: root}).status, 'PASS')
    mkdirSync(join(root, '_workspace/01_plan'), {recursive: true})
    writeFileSync(join(root, '_workspace/01_plan/feature-plan.md'), '# FEAT-001\n')
    const after = inspectSpecConformance({projectRoot: root})
    assert.equal(after.status, 'FAIL')
    assert.ok(after.failures.some(f => f.kind === 'stale'), 'staleness가 소비되지 않으면 잠금이 무의미하다')
  })
})

// ── (4) toolchain pin 정합 ───────────────────────────────────────────────────
test('substrate가 하네스 toolchain pin과 어긋나면 FAIL', () => {
  const lock = {constitution: {substrate: {packageManager: {value: 'npm', source: 'declared'}}}}
  const failures = checkToolchainAlignment(lock, {packageManager: 'pnpm'})
  assert.equal(failures.length, 1)
  assert.match(failures[0].reason, /pnpm를 강제한다/)
})

test('일치하면 통과한다', () => {
  const lock = {constitution: {substrate: {packageManager: {value: 'pnpm', source: 'default'}}}}
  assert.equal(checkToolchainAlignment(lock, {packageManager: 'pnpm'}).length, 0)
})

// ── (5) 검증 불가를 침묵하지 않는다 ──────────────────────────────────────────
test('근거 규칙이 없는 substrate 키는 unverifiable로 보고한다', () => {
  const declared = {names: new Set(), packageManagerField: null}
  const {failures, unverifiable} = checkSubstrate(
    {constitution: {substrate: {styling: {value: 'tailwind', source: 'measured'}}}}, declared, '/tmp',
  )
  assert.equal(failures.length, 0, '모르는 것을 실패로 만들지 않는다')
  assert.equal(unverifiable.length, 1, '모르는 것을 침묵으로 통과시키지도 않는다')
})

test('unverifiable tier는 실패가 아니라 note로 보고된다', () => {
  withLockedProject({}, root => {
    const result = inspectSpecConformance({projectRoot: root})
    assert.equal(result.status, 'PASS')
    assert.ok(result.notes.some(n => n.includes('unverifiable')))
    assert.ok(result.notes.some(n => n.includes('targetShape')))
  })
})

// ── 워크스페이스 호이스팅 포섭 ───────────────────────────────────────────────
test('워크스페이스 루트 선언까지 합쳐서 대조한다', () => {
  const root = mkdtempSync(join(tmpdir(), 'web-harness-spec-conf-ws-'))
  try {
    writeFileSync(join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n")
    writeFileSync(join(root, 'package.json'), `${JSON.stringify({name: 'ws', dependencies: {vite: '^8'}})}\n`)
    const app = join(root, 'packages/app')
    mkdirSync(app, {recursive: true})
    writeFileSync(join(app, 'package.json'), `${JSON.stringify({name: 'app', dependencies: {react: '^19'}})}\n`)
    const declared = collectDeclaredPackages(app)
    assert.ok(declared.names.has('react'), '자기 선언')
    assert.ok(declared.names.has('vite'), '워크스페이스 루트 선언')
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})

// ── scoped 패키지 (적대 리뷰 2026-08-26) ─────────────────────────────────────
// 이전 구현은 선두 @에서 split해 candidate가 빈 문자열이 됐고, 결과적으로 scoped 패키지
// **전체가 검증을 건너뛰었다**(fail-open — 위조가 PASS로 통과). 사내 scoped 패키지를 쓰는
// 프로젝트에서는 이 검사의 존재 이유가 사라진다.
test('회귀 반증: scoped 패키지 위조를 잡는다', () => {
  const declared = {names: new Set(['react']), packageManagerField: null}
  const {failures, unverifiable} = checkLibraries(
    {libraries: {sdk: {choice: '@scope/pkg', source: 'measured'}}}, declared,
  )
  assert.equal(failures.length, 1, 'scoped가 unverifiable로 새면 위조가 통과한다')
  assert.equal(unverifiable.length, 0)
  assert.match(failures[0].reason, /@scope\/pkg가 없다/)
})

test('scoped 패키지의 버전 접미도 이름으로 대조한다', () => {
  const declared = {names: new Set(['@scope/pkg']), packageManagerField: null}
  assert.equal(
    checkLibraries({libraries: {sdk: {choice: '@scope/pkg@^1.2.0', source: 'measured'}}}, declared).failures.length,
    0,
  )
})

// ── 도구명 ≠ npm 패키지명 ────────────────────────────────────────────────────
test('aliases가 도구명과 패키지명 차이를 잇는다', () => {
  const declared = {names: new Set(['@rspack/core']), packageManagerField: null}
  const {failures} = checkSubstrate(
    {constitution: {substrate: {bundler: {value: 'rspack', source: 'measured'}}}}, declared, '/tmp',
  )
  assert.equal(failures.length, 0, 'aliases가 없으면 정당한 실측이 오탐 FAIL 난다')
})

// ── defaults ↔ validate-toolchain pin 정합 (§4 (b)항) ────────────────────────
// 두 파일이 각자 값을 갖고 있어 조용히 갈라질 수 있다. 값이 통합되기 전까지 이 텍스트
// 결속이 드리프트를 잡는다.
test('substrate-defaults의 packageManager가 validate-toolchain pin과 일치한다', () => {
  const defaults = readSubstrateDefaults()
  const toolchainSource = readFileSync('.claude/scripts/validate-toolchain.mjs', 'utf8')
  const pinned = toolchainSource.match(/EXPECTED_([A-Z]+)_VERSION\s*=/g) ?? []
  const managers = pinned.map(line => line.match(/EXPECTED_([A-Z]+)_VERSION/)[1].toLowerCase())
  assert.ok(
    managers.includes(defaults.packageManager),
    `substrate-defaults는 ${defaults.packageManager}인데 validate-toolchain이 pin하는 것은 ${managers.join(', ')}다`,
  )
})

// ── (7) layerMap 커버리지 (Stage 3c) ─────────────────────────────────────────
// 설계자가 레이어를 빠뜨리면 그 디렉토리는 아무 에이전트도 쓸 수 없게 되는데, 지금까지
// 아무도 알려주지 않았다. 실측: 브라운필드 패키지에서 5개 레이어가 조용히 막혀 있었다.
test('layerMap이 덮지 않는 소스 디렉토리를 이름을 들어 보고한다', () => {
  withLockedProject({
    decision: baseDecision({layerMap: {routes: 'src/pages'}}),
    files: ['src/pages/Home.tsx', 'src/stores/editor.ts', 'src/hooks/useTheme.ts'],
  }, root => {
    const uncovered = checkLayerMapCoverage({layerMap: {routes: 'src/pages'}}, root)
    assert.deepEqual(uncovered.sort(), ['src/hooks', 'src/stores'])
  })
})

test('덮인 디렉토리는 보고하지 않는다', () => {
  withLockedProject({
    decision: baseDecision({layerMap: {routes: 'src/pages', clientState: 'src/stores'}}),
    files: ['src/pages/Home.tsx', 'src/stores/editor.ts'],
  }, root => {
    assert.deepEqual(checkLayerMapCoverage({layerMap: {routes: 'src/pages', clientState: 'src/stores'}}, root), [])
  })
})

test('소스 파일이 없는 디렉토리는 보고 대상이 아니다', () => {
  withLockedProject({files: ['src/assets/logo.png']}, root => {
    assert.deepEqual(checkLayerMapCoverage({layerMap: {}}, root), [])
  })
})

test('커버리지 공백은 FAIL이 아니라 note다 — 소유자 없어도 되는 디렉토리가 있다', () => {
  withLockedProject({
    decision: baseDecision({layerMap: {routes: 'src/pages'}}),
    files: ['src/pages/Home.tsx', 'src/consts/docs.ts'],
  }, root => {
    const result = inspectSpecConformance({projectRoot: root})
    assert.equal(result.status, 'PASS')
    assert.deepEqual(result.uncoveredPaths, ['src/consts'])
    assert.ok(result.notes.some(n => n.includes('src/consts')))
  })
})

// ── (8) 형태 기계 대조 (조사 2026-08-26) ─────────────────────────────────────
// 형태가 게이트를 고르게 되면 형태 자기보고 하나로 검증 세트 전체를 회피할 수 있다.
// 그래서 형태가 게이트를 고르기 전에 대조가 먼저 서야 한다.
test('회귀 반증: bin 없이 cli를 주장하면 FAIL', () => {
  withLockedProject({decision: baseDecision({targetShapes: ['cli']})}, root => {
    const {failures} = checkTargetShapes({targetShapes: ['cli']}, root)
    assert.equal(failures.length, 1, '형태 자기보고가 대조 없이 통과하면 검증 회피가 된다')
    assert.match(failures[0].reason, /bin 필드가 없다/)
  })
})

test('bin이 있으면 cli 주장이 통과한다', () => {
  withLockedProject({decision: baseDecision({targetShapes: ['cli']}), manifest: {bin: {tool: './cli.js'}}}, root => {
    assert.equal(checkTargetShapes({targetShapes: ['cli']}, root).failures.length, 0)
  })
})

test('회귀 반증: private:true인데 library를 주장하면 FAIL', () => {
  withLockedProject({decision: baseDecision({targetShapes: ['library']}), manifest: {private: true, main: './index.js'}}, root => {
    const {failures} = checkTargetShapes({targetShapes: ['library']}, root)
    assert.equal(failures.length, 1)
    assert.match(failures[0].reason, /배포할 수 없는 패키지/)
  })
})

test('진입점 없이 library를 주장하면 FAIL', () => {
  withLockedProject({decision: baseDecision({targetShapes: ['library']})}, root => {
    const {failures} = checkTargetShapes({targetShapes: ['library']}, root)
    assert.equal(failures.length, 1)
    assert.match(failures[0].reason, /exports도 main도 없다/)
  })
})

test('조합 형태가 각각 대조된다', () => {
  withLockedProject({
    decision: baseDecision({targetShapes: ['library', 'cli']}),
    manifest: {exports: './index.js', bin: {tool: './cli.js'}},
  }, root => {
    assert.equal(checkTargetShapes({targetShapes: ['library', 'cli']}, root).failures.length, 0)
  })
})

test('신호가 있는데 선언하지 않으면 note로 알린다 — 그 검증이 선택되지 않는다', () => {
  withLockedProject({decision: baseDecision(), manifest: {bin: {tool: './cli.js'}}}, root => {
    const {notes} = checkTargetShapes({targetShapes: ['web-app']}, root)
    assert.ok(notes.some(n => n.includes('cli가 없다')))
  })
})

test('대조 규칙이 없는 형태는 unverifiable로 보고한다', () => {
  withLockedProject({decision: baseDecision()}, root => {
    const {failures, unverifiable} = checkTargetShapes({targetShapes: ['browser-extension']}, root)
    assert.equal(failures.length, 0, '모르는 것을 실패로 만들지 않는다')
    assert.equal(unverifiable.length, 1, '침묵으로 통과시키지도 않는다')
  })
})

// ── (9) 형태 → 요구 검증 (Stage 2b) ──────────────────────────────────────────
test('요구 검증은 형태의 합집합이다 — 라이브러리+CLI는 둘 다 요구받는다', () => {
  const {required} = resolveRequiredChecks(['library', 'cli'])
  assert.ok(required.includes('pack.contents'), 'library 요구')
  assert.ok(required.includes('cli.bin-entrypoint'), 'cli 요구')
  assert.ok(required.includes('quality.lint'), '공통 요구')
})

test('공통 검사는 형태와 무관하게 요구된다', () => {
  const catalog = readShapeChecks()
  for (const shape of Object.keys(catalog.shapes)) {
    const {required} = resolveRequiredChecks([shape])
    for (const common of catalog.common.checks) {
      assert.ok(required.includes(common), `${shape}에 공통 ${common}이 빠졌다`)
    }
  }
})

test('요구 목록이 없는 형태는 unknownShapes로 보고된다 — 조용히 0을 요구하지 않는다', () => {
  const {required, unknownShapes} = resolveRequiredChecks(['browser-extension'])
  assert.deepEqual(unknownShapes, ['browser-extension'])
  assert.deepEqual(required, readShapeChecks().common.checks.slice().sort())
})

test('evidence 디렉토리가 없으면 판정하지 않는다(NOT_RUN)', () => {
  withLockedProject({}, root => {
    const result = checkShapeEvidence({targetShapes: ['web-app']}, root)
    assert.equal(result.evidenceState, 'NOT_RUN')
    assert.deepEqual(result.missing, [])
  })
})

test('회귀 반증: 요구 검증의 receipt가 없으면 FAIL', () => {
  withLockedProject({
    decision: baseDecision({targetShapes: ['web-app']}),
    files: ['_workspace/04_qa/evidence/quality.lint.json'],
  }, root => {
    writeFileSync(join(root, '_workspace/04_qa/evidence/quality.lint.json'),
      JSON.stringify({id: 'quality.lint', status: 'PASS'}))
    const result = checkShapeEvidence({targetShapes: ['web-app']}, root)
    assert.equal(result.evidenceState, 'RUN')
    assert.ok(result.missing.includes('vite.build'), '요구되는데 없는 검증이 보고돼야 한다')
    assert.equal(result.missing.includes('quality.lint'), false, '수행된 것은 빠진다')
  })
})

test('회귀 반증: receipt가 있어도 PASS가 아니면 FAIL로 잡는다', () => {
  withLockedProject({decision: baseDecision(), files: ['_workspace/04_qa/evidence/quality.lint.json']}, root => {
    writeFileSync(join(root, '_workspace/04_qa/evidence/quality.lint.json'),
      JSON.stringify({id: 'quality.lint', status: 'FAIL'}))
    const result = checkShapeEvidence({targetShapes: []}, root)
    assert.ok(result.failing.includes('quality.lint'))
  })
})

test('evidence 커버리지 실패가 정합 검사 FAIL로 올라온다', () => {
  withLockedProject({
    decision: baseDecision({targetShapes: ['web-app']}),
    files: ['_workspace/04_qa/evidence/quality.lint.json'],
  }, root => {
    writeFileSync(join(root, '_workspace/04_qa/evidence/quality.lint.json'),
      JSON.stringify({id: 'quality.lint', status: 'PASS'}))
    const result = inspectSpecConformance({projectRoot: root})
    assert.equal(result.status, 'FAIL')
    assert.ok(result.failures.some(f => f.kind === 'shapeEvidence'))
    assert.equal(result.evidenceState, 'RUN')
  })
})
