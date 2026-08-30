#!/usr/bin/env node
// test-development-readiness.mjs — Phase 3 진입 관문(Gate 0)의 회귀.
//
// 이 관문의 존재 이유는 하나다: **개발 중에 막히지 않는 것.** 그래서 여기서 고정하는 것도
// 하나다 — 2026-08-30에 개발 중에 실제로 터졌던 것들이 **착수 전에** 잡히는가.
//
//   (1) 스팩 부재 — developer가 디스크 변경 0건으로 반려되던 원인
//   (2) 소유권 예행 — 스팩이 있어도 훅이 막으면 개발은 0줄이다(중첩 root 사고)
//   (3) 계획 ↔ 스팩 어긋남 — 사용자에게 "어느 쪽이 정본이냐"로 새어나갔던 것
//   (4) 확정 결정의 미반영 — cva·prettier를 확정하고 설치하지 않은 상태
//   (5) 스팩 stale의 **원인 표기** — "바뀌었다"가 아니라 무엇이 어떻게 바뀌었는가
//   (6) 검사 미수행을 통과로 세지 않는다
import assert from 'node:assert/strict'
import test from 'node:test'
import {mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {
  analyzeDevelopmentReadiness, checkDecisionsApplied, checkOwnership, checkSpec, diffSpecInputs,
  effectiveProbePaths, readAllowedPathsFromScope,
} from './validate-development-readiness.mjs'
import {digestInputs} from './spec.mjs'

const SPEC = {
  schemaVersion: 2,
  specTier: 'verifiable',
  targetShapes: ['web-app'],
  layerMap: {domain: 'src/entities'},
  testLayers: {unit: 'src', e2e: 'e2e'},
  libraries: {},
  constitution: {substrate: {}},
  moduleBoundaries: [],
}

const PACKAGE = {
  name: 'demo',
  scripts: {
    build: 'x', lint: 'x', typecheck: 'x', test: 'x', 'test:coverage': 'x', 'test:tc': 'x',
    dev: 'x', 'test:e2e': 'x',
  },
  devDependencies: {eslint: '10.0.0'},
}

const withProject = (fn, {spec = SPEC, packageJson = PACKAGE, files = {}} = {}) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wh-readiness-')))
  try {
    mkdirSync(join(root, '_workspace/03_dev'), {recursive: true})
    if (spec) writeFileSync(join(root, '_workspace/03_dev/spec.json'), JSON.stringify(spec))
    if (packageJson) writeFileSync(join(root, 'package.json'), JSON.stringify(packageJson))
    writeFileSync(join(root, 'eslint.config.js'), 'export default []\n')
    for (const [rel, content] of Object.entries(files)) {
      mkdirSync(join(root, rel, '..'), {recursive: true})
      writeFileSync(join(root, rel), content)
    }
    return fn(root)
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
}

// ── (1) 스팩 ─────────────────────────────────────────────────────────────────
test('스팩이 없으면 착수 전에 막는다 — 스폰해서 0건 반려되기 전에 안다', () => {
  withProject(root => {
    const report = analyzeDevelopmentReadiness(root)
    assert.equal(report.verdict, 'BLOCKED')
    assert.equal(report.results.find(r => r.id === 'spec').state, 'FAIL')
  }, {spec: null})
})

// ── (6) 검사 미수행을 통과로 세지 않는다 ────────────────────────────────────
test('스팩이 없으면 스팩에 의존하는 검사는 SKIPPED다 — PASS가 아니다', () => {
  withProject(root => {
    const report = analyzeDevelopmentReadiness(root)
    for (const id of ['ownership', 'plans', 'decisions']) {
      assert.equal(report.results.find(r => r.id === id).state, 'SKIPPED', `${id}가 통과로 셌다`)
    }
  }, {spec: null})
})

// ── (2) 소유권 예행 ─────────────────────────────────────────────────────────
// 스팩이 있어도 훅이 막으면 개발은 0줄이다. 실제 훅을 돌려 **착수 전에** 안다.
//
// 스텁은 실제 훅을 모사한다 — 오케스트레이터 산출물은 **반드시 차단**한다. 그렇게 하지
// 않는 스텁은 음성 컨트롤에 걸리는데, 그게 이 컨트롤의 존재 이유다.
const hookStub = (decide = () => true) => (agent, path) => {
  if (path.includes('_workspace/03_dev/spec.json')) return {allowed: false, message: 'Blocked: orchestrator-authored'}
  return decide(path) ? {allowed: true, message: ''} : {allowed: false, message: 'Blocked: 소유권 없음'}
}

test('스팩이 선언한 레이어에 쓸 수 없으면 막는다', () => {
  withProject(root => {
    const blocked = checkOwnership(root, SPEC, {run: hookStub(() => false)})
    assert.equal(blocked.state, 'FAIL')
    assert.match(blocked.detail, /경로에 쓰지 못한다/)
    assert.match(blocked.remedy, /소유권 없음/, '첫 차단 사유를 그대로 전달해야 원인을 찾는다')
  })
})

test('훅이 전부 허용하면 통과한다', () => {
  withProject(root => {
    assert.equal(checkOwnership(root, SPEC, {run: hookStub()}).state, 'PASS')
  })
})

// 음성 컨트롤: 훅은 tool_name·agent_type이 어긋나면 조용히 exit 0(허용)이다. 컨트롤이
// 없으면 "전부 허용"과 "배선 사망"을 구분할 수 없고, 그 침묵은 통과 방향이다(fail-open).
test('반드시 차단돼야 할 경로가 허용되면 배선 사망으로 막는다', () => {
  withProject(root => {
    const result = checkOwnership(root, SPEC, {run: () => ({allowed: true, message: ''})})
    assert.equal(result.state, 'FAIL')
    assert.match(result.detail, /예행 배선이 죽었다/)
  })
})

test('예행 경로는 레이어마다 하나씩이고 파일 항목은 그 파일 자신이다', () => {
  const probed = []
  withProject(root => {
    checkOwnership(root, {layerMap: {a: 'src/entities', b: 'src/main.tsx'}, testLayers: {}},
      {run: (agent, path) => { probed.push(path); return hookStub()(agent, path) }})
  })
  const layers = probed.filter(path => !path.includes('_workspace/03_dev/spec.json'))
  assert.equal(layers.length, 2)
  assert.match(layers[0], /src\/entities\/__readiness_probe__\.ts$/)
  assert.match(layers[1], /src\/main\.tsx$/)
})

// 훅은 developer 판정에서 layerMap을 change-scope의 ALLOWED_PATHS로 좁힌다. layerMap 전체를
// 찌르면 티켓 픽업 뒤에는 범위 밖 레이어가 전부 차단으로 나와 **정당한 티켓 개발이 진입
// 봉쇄된다**(적대 리뷰 2026-08-30). 예행은 실효 범위를 본다.
test('스폰 범위가 발급돼 있으면 그 범위만 예행한다 — 티켓 개발을 봉쇄하지 않는다', () => {
  const spec = {layerMap: {a: 'src/entities', b: 'src/widgets'}, testLayers: {unit: 'src'}}
  const {paths, narrowed} = effectiveProbePaths('/nowhere', spec, {allowedPaths: ['src/entities/track/']})
  assert.equal(narrowed, true)
  assert.deepEqual(paths, ['src/entities/track/'], 'layerMap 전체가 아니라 발급된 범위를 본다')
})

test('스폰 범위가 없으면 layerMap 전체를 예행한다', () => {
  const spec = {layerMap: {a: 'src/entities'}, testLayers: {unit: 'src'}}
  const {paths, narrowed} = effectiveProbePaths('/nowhere', spec, {allowedPaths: null})
  assert.equal(narrowed, false)
  assert.deepEqual(paths, ['src/entities', 'src'])
})

test('스폰 범위는 change-scope의 기계 정본(펜스)에서 읽는다 — 훅과 같은 자리다', () => {
  withProject(root => {
    writeFileSync(join(root, '_workspace/03_dev/change-scope.md'),
      ['# s', '', '```json change-scope', JSON.stringify({ALLOWED_PATHS: ['src/entities/track/']}), '```', ''].join('\n'))
    assert.deepEqual(readAllowedPathsFromScope(root), ['src/entities/track/'])
  })
})

// ── (4) 확정 결정의 실물 반영 ───────────────────────────────────────────────
// 확정과 설치 사이의 간극은 그것을 쓰는 첫 티켓에서 터진다. 착수 전에 닫는다.
test('확정한 라이브러리가 매니페스트에 없으면 막는다', () => {
  const spec = {
    ...SPEC,
    libraries: {'ui-variant': {choice: 'class-variance-authority + clsx', source: 'confirmed'}},
  }
  withProject(root => {
    const result = checkDecisionsApplied(root, spec)
    assert.equal(result.state, 'FAIL')
    assert.match(result.detail, /class-variance-authority/)
    assert.match(result.detail, /clsx/)
  }, {spec})
})

test('substrate가 선언한 lint·formatter 도구도 실물을 요구한다', () => {
  const spec = {...SPEC, constitution: {substrate: {lint: {value: 'eslint', source: 'default'}, formatter: {value: 'prettier', source: 'default'}}}}
  withProject(root => {
    const result = checkDecisionsApplied(root, spec)
    assert.equal(result.state, 'FAIL')
    assert.match(result.detail, /prettier/)
    assert.ok(!result.detail.includes('eslint'), 'eslint는 설치돼 있으므로 지적하면 안 된다')
  }, {spec})
})

test("substrate가 'none'이면 요구하지 않는다 — 의식적 부재는 결함이 아니다", () => {
  const spec = {...SPEC, constitution: {substrate: {formatter: {value: 'none', source: 'declared', rationale: '없이 간다'}}}}
  withProject(root => {
    assert.equal(checkDecisionsApplied(root, spec).state, 'PASS')
  }, {spec})
})

// 자체 실측(2026-08-30): `choice: "none"`이 `none`이라는 패키지를 요구했다 —
// "안 쓰기로 확정했다"가 곧바로 실패가 되는 오탐이다. 관문이 새 마찰이 되면 안 된다.
test('의식적 부재(none·미채택)는 패키지로 요구하지 않는다', () => {
  for (const choice of ['none', '미채택', 'N/A']) {
    const spec = {...SPEC, libraries: {x: {choice, source: 'confirmed'}}}
    withProject(root => {
      assert.equal(checkDecisionsApplied(root, spec).state, 'PASS', `choice=${choice}에서 오탐`)
    }, {spec})
  }
})

test('서술형 choice는 패키지명으로 오독하지 않는다', () => {
  const spec = {...SPEC, libraries: {ui: {choice: '순수 Tailwind + 수기 variant 함수', source: 'confirmed'}}}
  withProject(root => {
    assert.equal(checkDecisionsApplied(root, spec).state, 'PASS')
  }, {spec})
})

test('measured·inferred 라이브러리는 실물을 요구하지 않는다 — 실측은 이미 실물이다', () => {
  const spec = {...SPEC, libraries: {state: {choice: 'zustand', source: 'measured-absent'}}}
  withProject(root => {
    assert.equal(checkDecisionsApplied(root, spec).state, 'PASS')
  }, {spec})
})

// ── (5) stale의 원인 표기 ───────────────────────────────────────────────────
// "입력이 바뀌었다"만으로는 처방을 낼 수 없다. 없다가 생긴 것과 내용이 바뀐 것은 다르다.
test('stale 원인을 없다가 생김·사라짐·내용 바뀜으로 가른다', () => {
  withProject(root => {
    mkdirSync(join(root, '_workspace/01_plan'), {recursive: true})
    writeFileSync(join(root, '_workspace/01_plan/tech-stack.md'), '# v1\n')
    const before = digestInputs(root)
    const spec = {...SPEC, sourceDigest: before}
    // 하나는 새로 생기고 하나는 내용이 바뀐다.
    writeFileSync(join(root, '_workspace/01_plan/project-profile.json'), '{}')
    writeFileSync(join(root, '_workspace/01_plan/tech-stack.md'), '# v2\n')
    const delta = diffSpecInputs(spec, root)
    const byPath = new Map(delta.map(item => [item.path, item.kind]))
    assert.equal(byPath.get('_workspace/01_plan/project-profile.json'), 'appeared')
    assert.equal(byPath.get('_workspace/01_plan/tech-stack.md'), 'changed')
  })
})

test('stale 보고가 무엇이 바뀌었는지 이름을 댄다', () => {
  withProject(root => {
    mkdirSync(join(root, '_workspace/01_plan'), {recursive: true})
    const spec = {...SPEC, sourceDigest: digestInputs(root)}
    writeFileSync(join(root, '_workspace/03_dev/spec.json'), JSON.stringify(spec))
    writeFileSync(join(root, '_workspace/01_plan/project-profile.json'), '{}')
    const result = checkSpec(root)
    assert.equal(result.state, 'FAIL')
    assert.match(result.detail, /project-profile\.json\(새로 생김\)/)
    assert.match(result.remedy, /순서 문제/, '전부 새로 생긴 것이면 결정이 달라진 게 아니라고 말해야 한다')
  })
})

// ── greenfield 시퀀싱 ───────────────────────────────────────────────────────
// greenfield는 package.json을 Phase 3의 scaffolder가 만든다. 진입 시점에 없는 것이 정상이며
// 여기서 FAIL을 내면 "아직 돈 적 없는 단계로 되돌리라"는 처방이 된다(적대 리뷰 2026-08-30).
test('greenfield 진입에서 환경 축은 미수행이다 — 통과도 실패도 아니다', () => {
  withProject(root => {
    const spec = {...SPEC, sourceDigest: digestInputs(root)}
    writeFileSync(join(root, '_workspace/03_dev/spec.json'), JSON.stringify(spec))
    const report = analyzeDevelopmentReadiness(root, {hookRun: hookStub()})
    const env = report.results.find(r => r.id === 'environment')
    assert.equal(env.state, 'SKIPPED')
    assert.match(env.detail, /다시 밟는다/)
  }, {packageJson: null})
})

// ── 통과 경로 ───────────────────────────────────────────────────────────────
test('전부 갖춰지면 READY다 — 그 뒤로는 묻지 않는다', () => {
  withProject(root => {
    const spec = {...SPEC, sourceDigest: digestInputs(root)}
    writeFileSync(join(root, '_workspace/03_dev/spec.json'), JSON.stringify(spec))
    const report = analyzeDevelopmentReadiness(root, {hookRun: hookStub()})
    assert.equal(report.verdict, 'READY', JSON.stringify(report.failures, null, 2))
  })
})

// ── 배선: 실제 훅 왕복 ──────────────────────────────────────────────────────
// 위 테스트들은 전부 `run` 주입 스텁이다. 스텁만 있으면 페이로드 스키마가 드리프트해도
// 아무도 모르고, 훅은 어긋난 입력에 **조용히 exit 0(허용)** 하므로 그 침묵은 통과 방향이다.
// 여기서만 주입 없이 진짜 훅을 프로세스로 돌린다 — 허용 1·차단 1 양방향.
test('배선: 주입 없이 실제 훅을 돌려 허용과 차단이 모두 나온다', () => {
  withProject(root => {
    // layerMap이 소유하는 레이어는 허용, 소유하지 않는 레이어는 차단이어야 한다.
    const owned = checkOwnership(root, {layerMap: {domain: 'src/entities'}, testLayers: {}})
    assert.equal(owned.state, 'PASS', `실제 훅이 소유 경로를 막았다: ${owned.detail} / ${owned.remedy ?? ''}`)
    const unowned = checkOwnership(root, {layerMap: {nowhere: 'random/nowhere'}, testLayers: {}})
    assert.equal(unowned.state, 'FAIL', '실제 훅이 무소유 경로를 허용했다 — 예행이 무의미해진다')
    assert.ok(!unowned.detail.includes('배선이 죽었다'), '음성 컨트롤은 통과해야 한다(훅이 살아 있다)')
  })
})
