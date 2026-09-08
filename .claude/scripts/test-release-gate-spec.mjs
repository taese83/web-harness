#!/usr/bin/env node
// test-release-gate-spec.mjs — 스팩 정합의 릴리스 게이트 배선 회귀.
//
// 여기서 고정하는 사실:
//   (1) **스팩이 없으면 발화하지 않는다** — 스팩은 opt-in이다. 발화하면 기존 프로젝트가 전부 막힌다
//   (2) 스팩이 있고 정합이 깨지면 릴리스가 막힌다 — 한 번 확정하면 구속력을 갖는다
//   (3) 미판정(unverifiable)은 errors로 올리지 않는다 — 실패로도 통과로도 바꾸지 않는다
//   (4) 검사가 던져도 게이트가 통째로 죽지 않고 그 사실이 error로 남는다
import assert from 'node:assert/strict'
import test from 'node:test'
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {designRoundSummary, routeBindingSummary, validateReleaseGate} from './release-gate-lib.mjs'
import {lockSpec} from './spec.mjs'

const specErrors = errors => errors.filter(message => message.startsWith('Spec conformance'))

const withProject = ({locked = false, layerMap = {}} = {}, run) => {
  const root = mkdtempSync(join(tmpdir(), 'web-harness-release-spec-'))
  try {
    mkdirSync(join(root, '_workspace/02_design'), {recursive: true})
    mkdirSync(join(root, '_workspace/03_dev'), {recursive: true})
    writeFileSync(join(root, 'package.json'), `${JSON.stringify({name: 'fixture'})}\n`)
    if (locked) {
      const decision = {
        targetShapes: ['web-app'],
        architecture: {pattern: 'existing', rationale: '기존 관례'},
        layerMap,
        testLayers: {unit: 'src/', e2e: 'e2e/'},
        libraries: {},
        moduleBoundaries: [],
        acceptanceSource: 'absent',
        acceptanceRefs: [],
        nonGoals: [],
        openDecisions: [],
      }
      writeFileSync(join(root, '_workspace/02_design/solution-design.md'),
        ['```json web-harness:solution-design', JSON.stringify(decision, null, 2), '```', ''].join('\n'))
      writeFileSync(join(root, '_workspace/03_dev/spec.json'),
        `${JSON.stringify(lockSpec(root), null, 2)}\n`)
    }
    return run(root)
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
}

// ── (1) opt-in — 이것이 깨지면 기존 프로젝트가 전부 막힌다 ───────────────────
test('회귀 반증: 스팩이 없으면 스팩 정합이 릴리스를 막지 않는다', () => {
  withProject({locked: false}, root => {
    const {errors} = validateReleaseGate(root)
    assert.deepEqual(specErrors(errors), [],
      '스팩 확정 없는 프로젝트에 스팩 오류가 붙으면 기존 흐름이 전부 막힌다')
  })
})

// ── (2) 확정하면 구속력 ────────────────────────────────────────────────────────
test('회귀 반증: 스팩이 있고 layerMap이 없는 경로를 가리키면 릴리스가 막힌다', () => {
  withProject({locked: true, layerMap: {routes: 'src/definitely-absent/'}}, root => {
    const {errors} = validateReleaseGate(root)
    const spec = specErrors(errors)
    assert.ok(spec.length > 0, '스팩이 구속력을 갖지 않으면 잠글 이유가 없다')
    assert.ok(spec.some(message => message.includes('layerMap')))
  })
})

test('스팩이 있고 정합이 맞으면 스팩 오류가 붙지 않는다', () => {
  withProject({locked: true, layerMap: {}}, root => {
    assert.deepEqual(specErrors(validateReleaseGate(root).errors), [])
  })
})

// ── (3) 미판정은 실패가 아니다 ──────────────────────────────────────────────
test('unverifiable은 릴리스 오류로 올라오지 않는다', () => {
  // targetShapes에 규칙 없는 형태를 넣으면 unverifiable이 생기지만 FAIL은 아니다.
  const root = mkdtempSync(join(tmpdir(), 'web-harness-release-unver-'))
  try {
    mkdirSync(join(root, '_workspace/02_design'), {recursive: true})
    mkdirSync(join(root, '_workspace/03_dev'), {recursive: true})
    writeFileSync(join(root, 'package.json'), `${JSON.stringify({name: 'fixture'})}\n`)
    const decision = {
      targetShapes: ['browser-extension'],
      architecture: {pattern: 'existing', rationale: 'r'},
      layerMap: {}, libraries: {}, moduleBoundaries: [],
      testLayers: {unit: 'src/', e2e: 'e2e/'},   // 미등록 형태라 스팩이 e2e를 명시해야 한다
      acceptanceSource: 'absent', acceptanceRefs: [], nonGoals: [], openDecisions: [],
    }
    writeFileSync(join(root, '_workspace/02_design/solution-design.md'),
      ['```json web-harness:solution-design', JSON.stringify(decision, null, 2), '```', ''].join('\n'))
    writeFileSync(join(root, '_workspace/03_dev/spec.json'),
      `${JSON.stringify(lockSpec(root), null, 2)}\n`)
    assert.deepEqual(specErrors(validateReleaseGate(root).errors), [],
      '미판정을 실패로 바꾸면 모르는 형태가 릴리스를 막는다')
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
})

// ── (4) 손상된 스팩은 스팩 확정 없음이 아니다 ───────────────────────────────────
// 이전 테스트는 assert.ok(Array.isArray(errors))였다 — throw만 없으면 항상 참인 vacuous
// assertion이고, 그 뒤에 "파일 한 바이트를 깨뜨리면 결박이 꺼진다"는 fail-open이 숨어 있었다.
test('회귀 반증: 깨진 spec-lock은 NO_SPEC로 강등되지 않고 릴리스를 막는다', () => {
  withProject({locked: false}, root => {
    writeFileSync(join(root, '_workspace/03_dev/spec.json'), '{not json')
    const spec = specErrors(validateReleaseGate(root).errors)
    assert.ok(spec.length > 0, '깨진 스팩이 통과하면 파일 하나 깨뜨려 결박을 끌 수 있다')
    assert.ok(spec.some(message => message.includes('INVALID_SPEC')))
  })
})

test('스팩이 배열·null이어도 손상으로 본다', () => {
  for (const bad of ['[]', 'null', '"x"']) {
    withProject({locked: false}, root => {
      writeFileSync(join(root, '_workspace/03_dev/spec.json'), bad)
      assert.ok(specErrors(validateReleaseGate(root).errors).length > 0, `${bad}가 통과했다`)
    })
  }
})

// ── (5) RUN 상태 — 실제 receipt 이름으로 ────────────────────────────────────
// 이 게이트가 유일하게 발화하는 상태다. 이전에는 확정된 fixture에 evidence가 없어 NOT_RUN만
// 확인했고, 그 사이 요구 id와 실제 receipt 파일명이 어긋난 채로 남아 있었다.
test('회귀 반증: 실제 receipt 이름(lint.json 등)으로 요구가 충족된다', () => {
  withProject({locked: true, layerMap: {}}, root => {
    const dir = join(root, '_workspace/04_qa/evidence')
    mkdirSync(dir, {recursive: true})
    // 러너가 실제로 쓰는 이름 — quality.lint가 아니라 lint
    // 2026-08-26: web-app 형태에 vite.production-mock-boundary가 추가됐다(어댑터 profile-specific
    // 이던 것을 형태로 이관). 요구가 늘면 fixture도 그 receipt를 가져야 한다 — 게이트가 옳게 발화했다.
    for (const [name, id] of [['lint', 'lint'], ['typecheck', 'typecheck'], ['test', 'test'],
                              ['build', 'build'], ['browser', 'browser'],
                              ['vite.production-mock-boundary', 'vite.production-mock-boundary']]) {
      writeFileSync(join(dir, `${name}.json`), JSON.stringify({id, status: 'PASS'}))
    }
    const spec = specErrors(validateReleaseGate(root).errors)
    assert.deepEqual(spec, [],
      '요구 id를 receipt 파일명으로 옮기지 않으면 확정한 프로젝트 전원이 오탐 블록된다')
  })
})

test('RUN 상태에서 실제로 빠진 요구는 잡는다', () => {
  withProject({locked: true, layerMap: {}}, root => {
    const dir = join(root, '_workspace/04_qa/evidence')
    mkdirSync(dir, {recursive: true})
    writeFileSync(join(dir, 'lint.json'), JSON.stringify({id: 'lint', status: 'PASS'}))
    const spec = specErrors(validateReleaseGate(root).errors)
    assert.ok(spec.some(m => m.includes('quality.typecheck')), '빠진 요구는 여전히 잡아야 한다')
  })
})

// ── 시안 구현 축별 대조표 ─────────────────────────────────────────────────────
// 계기: motor-lab v4에서 **색상만 적용된 리컬러**가 시안 구현으로 완료 선언되고 릴리스까지
// 통과했다(사용자 발견). 그 뒤 계약이 대조표를 요구했으나 **존재를 검사하는 기계가 없었다.**
// 여기서 고정하는 것: 선정된 시안이 없으면 발화하지 않고, 있는데 표가 없으면 막고,
// 표가 얇으면 신호로만 남긴다.

const withRound = ({render = null, verdict = null, round = '2026-09-08-probe'} = {}, run) => {
  const root = mkdtempSync(join(tmpdir(), 'web-harness-design-round-'))
  try {
    const dir = join(root, '_workspace/02_design/design-system/style-tiles', round)
    mkdirSync(dir, {recursive: true})
    if (render !== null) writeFileSync(join(dir, 'RENDER-VERDICT.md'), render)
    if (verdict !== null) writeFileSync(join(dir, 'IMPLEMENTATION-VERDICT.md'), verdict)
    return run(root)
  } finally { rmSync(root, {recursive: true, force: true}) }
}

const AXES = header => [
  header,
  '| 축 | 시안 기준 | 실측 | 판정 |',
  '|---|---|---|---|',
  '| 색 | 카퍼 #B85C1E | palette-primary-main 실측 | PASS |',
  '| 타이포 | 모노 디스플레이 | h1 computed 모노 28px | PASS |',
  '| 밀도 | cardPad 16 | 블록에 16 반영 | PASS |',
  '| 형태 | radius 12 | borderRadius 12px 실측 | PASS |',
  '| 위계 | 크기·웨이트 대비 | h1 28/800 vs body | PASS |',
].join('\n')

test('시안 라운드가 없으면 대조표를 요구하지 않는다 — 발화하면 기존 프로젝트가 전부 막힌다', () => {
  const root = mkdtempSync(join(tmpdir(), 'web-harness-design-round-'))
  try { assert.equal(designRoundSummary(root).state, 'NO_ROUND') }
  finally { rmSync(root, {recursive: true, force: true}) }
})

test('선정된 시안이 없으면 요구하지 않는다 — 라운드만 돌고 고르지 않은 상태는 정상이다', () => {
  withRound({render: '# Render Verdict\n\n후보 셋 렌더만 했다.\n'}, root => {
    assert.equal(designRoundSummary(root).state, 'NO_SELECTION')
  })
})

test('선정됐는데 대조표가 없으면 릴리스를 막는다 — motor-lab 사고 당시의 상태다', () => {
  withRound({render: '# Render Verdict\n\nSELECTED_CANDIDATE: candidate-a\n'}, root => {
    const summary = designRoundSummary(root)
    assert.equal(summary.state, 'MISSING')
    assert.deepEqual(summary.missing, ['2026-09-08-probe'])
    const {errors} = validateReleaseGate(root)
    assert.ok(errors.some(message => /Design round implementation verdict is missing/.test(message)),
      '릴리스 게이트가 대조표 부재를 막지 않는다')
  })
})

test('대조표가 있으면 통과한다 — 축 이름은 검사하지 않는다', () => {
  // 실측(tamiya v4.1)에서 정당한 표가 색·타이포·밀도·형태·위계로 적었다. 계약이 나열한
  // 이름(폰트·radius·spacing·그림자·액센트)으로 재면 그 표가 오탐으로 걸린다.
  withRound({
    render: '# Render Verdict\n\nSELECTED_CANDIDATE: candidate-a\n',
    verdict: AXES('# 구현 축별 대조표'),
  }, root => {
    assert.equal(designRoundSummary(root).state, 'PASS')
  })
})

test('행이 최소 축수에 못 미치면 신호로 남긴다 — 막지는 않는다', () => {
  // 「색만 확인하고 5축 통과로 기재」가 등록 계기다. 행 수는 **신호**이지 판정이 아니다 —
  // 5행을 그럴듯한 문장으로 채우면 통과한다(§4 등록).
  withRound({
    render: '# Render Verdict\n\nSELECTED_CANDIDATE: candidate-a\n',
    verdict: ['# 구현 축별 대조표', '| 축 | 기준 | 실측 | 판정 |', '|---|---|---|---|',
      '| 색 | 카퍼 | 실측함 | PASS |'].join('\n'),
  }, root => {
    const summary = designRoundSummary(root)
    assert.equal(summary.state, 'THIN')
    assert.match(summary.note, /대조 행 1건/)
    const {errors} = validateReleaseGate(root)
    assert.ok(!errors.some(message => /implementation verdict/i.test(message)), '신호가 릴리스를 막았다')
  })
})

test('실측 칸이 비면 그 축은 대조된 것이 아니다 — 신호로 남긴다', () => {
  withRound({
    render: '# Render Verdict\n\nSELECTED_CANDIDATE: candidate-a\n',
    verdict: AXES('# 구현 축별 대조표').replace('| 위계 | 크기·웨이트 대비 | h1 28/800 vs body | PASS |',
      '| 위계 |  |  | PASS |'),
  }, root => {
    const summary = designRoundSummary(root)
    assert.equal(summary.state, 'THIN')
    assert.match(summary.note, /빈 대조 칸/)
  })
})

// ── 설계 → 코드 결속 ──────────────────────────────────────────────────────────
// 이 저장소의 가장 큰 공백이었다 — Gate B가 「route ↔ component public export」를 요구하는데
// 그것을 보는 기계 소비자가 0건이었다. 여기서 고정하는 것:
//   (1) 표 행의 경로만 본다 — 산문의 경로는 반례·설명일 수 있다
//   (2) 레이어가 없으면 미구현(차단), 레이어가 있으면 개명(기록만) — 강도가 다르다
//   (3) 선언이 없는 형태(library·서피스 맵)는 요구하지 않는다

const withLayout = ({spec = null, files = [], sharded = false} = {}, run) => {
  const root = mkdtempSync(join(tmpdir(), 'web-harness-route-'))
  try {
    if (spec !== null) {
      if (sharded) {
        mkdirSync(join(root, '_workspace/02_design/layout-spec'), {recursive: true})
        writeFileSync(join(root, '_workspace/02_design/layout-spec/global.md'), spec)
      } else {
        mkdirSync(join(root, '_workspace/02_design'), {recursive: true})
        writeFileSync(join(root, '_workspace/02_design/layout-spec.md'), spec)
      }
    }
    for (const file of files) {
      mkdirSync(join(root, file.split('/').slice(0, -1).join('/')), {recursive: true})
      writeFileSync(join(root, file), '// generated\n')
    }
    return run(root)
  } finally { rmSync(root, {recursive: true, force: true}) }
}

const ROUTES = [
  '## Routing map', '',
  '| Path | Component | Description |',
  '|---|---|---|',
  '| `/` | `src/pages/home/ui/HomePage.tsx` | 홈 |',
  '| `/detail` | `src/pages/detail/ui/DetailPage.tsx` | 상세 |',
].join('\n')

test('layout-spec이 없으면 화면 결속을 요구하지 않는다', () => {
  withLayout({}, root => { assert.equal(routeBindingSummary(root).state, 'NO_LAYOUT') })
})

test('표에 소스 경로 선언이 없으면 요구하지 않는다 — library·서피스 맵이 정상 경로다', () => {
  withLayout({spec: '# Layout\n\n| Path | Component |\n|---|---|\n| `/` | 홈 화면 |\n'}, root => {
    assert.equal(routeBindingSummary(root).state, 'NO_DECLARED_PATHS')
  })
})

test('선언한 경로가 전부 실재하면 통과한다', () => {
  withLayout({
    spec: ROUTES,
    files: ['src/pages/home/ui/HomePage.tsx', 'src/pages/detail/ui/DetailPage.tsx'],
  }, root => {
    const summary = routeBindingSummary(root)
    assert.equal(summary.state, 'BOUND', summary.note)
    assert.equal(summary.declared, 2)
  })
})

test('선언한 경로가 없으면 보고한다 — 그리고 막지 않는다', () => {
  // 실측(2026-09-08): 완주한 프로젝트 두 곳이 개명 형태였다 — tamiya는 `router.tsx` →
  // 실제 `Routes.tsx`, search-portal은 `ui/HomePage.tsx` → 실제 `index.tsx`.
  // 차단하면 정직하게 완주한 프로젝트가 막힌다.
  withLayout({
    spec: ROUTES,
    files: ['src/pages/home/index.tsx', 'src/pages/detail/index.tsx'],
  }, root => {
    const summary = routeBindingSummary(root)
    assert.equal(summary.state, 'UNBOUND')
    assert.equal(summary.unbound.length, 2)
    assert.equal(summary.bound, 0)
    const {errors} = validateReleaseGate(root)
    assert.ok(!errors.some(message => /layout spec/i.test(message)), '보고가 릴리스를 막았다')
  })
})

test('미구현과 개명을 구별한다고 주장하지 않는다 — 경로만으로는 같아 보인다', () => {
  // 초안은 「레이어 부재 = 미구현(차단) / 파일 부재 = 개명(기록)」으로 나눴다가 되돌렸다.
  // `api/handlers/x.ts` 선언에 실제 파일이 `api/x.ts`인 **개명**이 「레이어 없음」으로 읽혀
  // 차단됐다(자체 실측). 어느 조상까지 보는지를 바꿔도 얕은 경로와 깊은 경로 중 한쪽이
  // 항상 틀렸다 — 이 회귀가 그 판정을 되살리지 못하게 막는다.
  withLayout({
    spec: ['| Path | Component |', '|---|---|', '| `/api/x` | `api/handlers/x.ts` |'].join('\n'),
    files: ['api/x.ts'],
  }, root => {
    const summary = routeBindingSummary(root)
    assert.equal(summary.state, 'UNBOUND', '개명이 별도 상태로 갈렸다')
    assert.match(summary.note, /판정하지 못한다/, '구별하지 못한다는 사실이 보고에 없다')
    const {errors} = validateReleaseGate(root)
    assert.equal(errors.filter(m => /layout spec/i.test(m)).length, 0, '개명이 릴리스를 막았다')
  })
})

test('코드펜스 안의 표는 예시다 — 선언으로 읽지 않는다', () => {
  // 자체 실측: 계약 문서의 예시 표가 선언으로 읽혀 차단됐다.
  const spec = ['```markdown', ...ROUTES.split('\n'), '```'].join('\n')
  withLayout({spec, files: ['src/app/App.tsx']}, root => {
    assert.equal(routeBindingSummary(root).state, 'NO_DECLARED_PATHS')
  })
})

test('산문의 경로는 세지 않는다 — 표 행만 본다', () => {
  // 계약 문서는 "이렇게 하지 마라"로 경로를 인용한다. 그것을 선언으로 읽으면 오탐이 난다.
  const spec = [
    '# Layout', '',
    '`src/pages/legacy/OldPage.tsx`는 더 이상 만들지 않는다.', '',
    ROUTES,
  ].join('\n')
  withLayout({spec, files: ['src/pages/home/ui/HomePage.tsx', 'src/pages/detail/ui/DetailPage.tsx']}, root => {
    const summary = routeBindingSummary(root)
    assert.equal(summary.state, 'BOUND', summary.note)
    assert.equal(summary.declared, 2, '산문의 경로가 선언으로 세어졌다')
  })
})

test('분할된 layout-spec 디렉터리도 읽는다', () => {
  withLayout({spec: ROUTES, sharded: true, files: ['src/pages/home/ui/HomePage.tsx', 'src/pages/detail/ui/DetailPage.tsx']}, root => {
    assert.equal(routeBindingSummary(root).state, 'BOUND')
  })
})
