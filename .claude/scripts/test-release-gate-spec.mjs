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
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {buildReleaseManifest, designRoundSummary, exportedNames, resolveSymbols, routeBindingSummary, validateReleaseGate} from './release-gate-lib.mjs'
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
//   (2) 부재는 한 상태(`UNBOUND`)로만 보고한다 — 경로만으로는 미구현과 개명을 못 가른다
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

// ── 심볼 수준 대조 ────────────────────────────────────────────────────────────
// 경로만 보면 미구현과 개명이 똑같이 보인다(위 회귀가 그 사실을 고정한다). 심볼을 보면 갈린다.
//
// **분류 로직을 저장소 밖 파서에 결박하지 않는다.** 픽스처를 `workspace/track`의 TypeScript에
// 걸었더니, gitignore된 그 디렉터리가 없는 CI 조건에서 회귀 6건이 조용히 skip돼 **반증 seed를
// 껐는데도 exit 0**이었다(2026-09-08 실측: 같은 변형이 로컬 exit 1, CI 조건 exit 0).
// 그래서 export 추출기를 주입한다 — 아래 픽스처 소스에 대해 명백히 옳고, CI에서 실제로 돈다.
// 파서 자체(`exportedNames`)의 정확성은 맨 아래 실파서 테스트와 4개 프로젝트 실측이 맡는다.
const readExports = source =>
  [...source.matchAll(/export (?:const|function|class) (\w+)/g)].map(match => match[1])

const withSpec = ({spec, files = {}}, run) => {
  const root = mkdtempSync(join(tmpdir(), 'web-harness-binding-'))
  try {
    mkdirSync(join(root, '_workspace/02_design'), {recursive: true})
    writeFileSync(join(root, '_workspace/02_design/layout-spec.md'), spec)
    for (const [rel, body] of Object.entries(files)) {
      mkdirSync(join(root, rel.split('/').slice(0, -1).join('/')), {recursive: true})
      writeFileSync(join(root, rel), body)
    }
    return run(root)
  } finally { rmSync(root, {recursive: true, force: true}) }
}

const ROUTE_ROW = path => ['| Path | Component |', '|---|---|', `| \`/\` | \`${path}\` |`].join('\n')
const summaryFor = (root, options) => resolveSymbols(root, routeBindingSummary(root), options)

test('추출기를 얻지 못하면 NOT_MEASURED다 — 통과가 아니다', () => {
  // 주입도 없고 프로젝트 TypeScript도 없는 조건 — 기본 경로(`projectExportReader`)를 탄다.
  withSpec({spec: ROUTE_ROW('src/pages/home/ui/HomePage.tsx')}, root => {
    const summary = summaryFor(root)
    assert.equal(summary.state, 'NOT_MEASURED')
    assert.match(summary.note, /통과가 아니다/)
  })
})

test('선언된 심볼이 다른 파일에 있으면 개명이다 — 경로만으로는 못 가르던 것', () => {
  // 실측(search-portal): 스펙 `ui/HomePage.tsx`, 실제 `index.tsx`가 `HomePage`를 export한다.
  withSpec({
    spec: ROUTE_ROW('src/pages/home/ui/HomePage.tsx'),
    files: {'src/pages/home/index.tsx': 'export const HomePage = () => null\n'},
  }, root => {
    const summary = summaryFor(root, {readExports})
    assert.equal(summary.state, 'DIVERGED', summary.note)
    assert.equal(summary.renamed.length, 1)
    assert.equal(summary.renamed[0].actual, 'src/pages/home/index.tsx')
    assert.equal(summary.unbuilt.length, 0, '개명이 미구현으로 세어졌다')
  })
})

test('그 심볼 이름이 어디에도 없으면 UNBUILT다 — 미구현과 같지 않다', () => {
  withSpec({
    spec: ROUTE_ROW('src/pages/home/ui/HomePage.tsx'),
    files: {'src/app/App.tsx': 'export const App = () => null\n'},
  }, root => {
    const summary = summaryFor(root, {readExports})
    assert.equal(summary.state, 'UNBUILT', summary.note)
    assert.deepEqual(summary.unbuilt, ['src/pages/home/ui/HomePage.tsx'])
    assert.equal(summary.renamed.length, 0)
  })
})

test('파일명이 식별자가 아니어도 개명을 찾는다 — kebab-case 관용구', () => {
  withSpec({
    spec: ROUTE_ROW('src/pages/home/ui/home-page.tsx'),
    files: {'src/pages/home/index.tsx': 'export const HomePage = () => null\n'},
  }, root => {
    const summary = summaryFor(root, {readExports})
    assert.equal(summary.unbuilt.length, 0, 'kebab 파일명이 미구현으로 접혔다')
    assert.equal(summary.renamed.length, 1)
  })
})

test('index 배럴은 심볼을 유도하지 않는다 — 파일명이 심볼이 아니다', () => {
  // 실측(search-portal): `src/pages/home/index.ts`가 `index`라는 심볼이 없다는 이유로
  // 미구현으로 잘못 잡혔다. 배럴은 판정 보류로 센다.
  withSpec({
    spec: ROUTE_ROW('src/pages/home/index.ts'),
    files: {'src/app/App.tsx': 'export const App = () => null\n'},
  }, root => {
    const summary = summaryFor(root, {readExports})
    assert.deepEqual(summary.unbuilt, [], '배럴이 미구현으로 세어졌다')
    assert.deepEqual(summary.unresolved, ['src/pages/home/index.ts'])
    assert.equal(summary.state, 'PARTIAL', '보류를 RESOLVED로 접었다')
  })
})

test('export가 없는 껍데기 파일을 잡는다 — 경로 검사가 통과시키던 구멍', () => {
  withSpec({
    spec: ROUTE_ROW('src/pages/home/ui/HomePage.tsx'),
    files: {'src/pages/home/ui/HomePage.tsx': '// 아직 아무것도 없다\n'},
  }, root => {
    const binding = routeBindingSummary(root)
    assert.equal(binding.state, 'BOUND', '경로 검사는 껍데기를 통과시킨다')
    const summary = resolveSymbols(root, binding, {readExports})
    assert.equal(summary.state, 'DIVERGED')
    assert.deepEqual(summary.hollow, ['src/pages/home/ui/HomePage.tsx'])
  })
})

test('실재 파일은 export가 하나만 있으면 통과한다 — 강도를 과장하지 않는다', () => {
  // 실측 12건 중 2건(`Routes.tsx` → `AppRouter`)이 파일명≠심볼인 **정상**이라 일치를
  // 요구하면 오탐이 된다. 그래서 요구하지 않으며, note도 「전부 그 자리에 있다」고 말하지 않는다.
  withSpec({
    spec: ROUTE_ROW('src/pages/home/ui/HomePage.tsx'),
    files: {'src/pages/home/ui/HomePage.tsx': 'export const somethingElse = 1\n'},
  }, root => {
    const summary = resolveSymbols(root, routeBindingSummary(root), {readExports})
    assert.equal(summary.state, 'RESOLVED')
    assert.doesNotMatch(summary.note, /심볼이 전부/, 'note가 검사보다 강하게 주장한다')
  })
})

test('색인이 잘리면 「어디에도 없음」을 보류한다 — 부분 색인으로 없다고 말하지 않는다', () => {
  withSpec({
    spec: ROUTE_ROW('src/pages/home/ui/HomePage.tsx'),
    files: {'src/app/App.tsx': 'export const App = () => null\n'},
  }, root => {
    const summary = summaryFor(root, {readExports, maxScan: 1})
    assert.equal(summary.state, 'PARTIAL', summary.note)
    assert.deepEqual(summary.unbuilt, [], '절단된 색인으로 미구현을 단정했다')
    assert.deepEqual(summary.unresolved, ['src/pages/home/ui/HomePage.tsx'])
    assert.match(summary.note, /스캔 상한/)
  })
})

test('심볼 대조는 릴리스를 막지 않는다 — 판정이 결정적이어도 강도는 그대로다', () => {
  // 주입을 `validateReleaseGate`까지 뚫었다. 뚫지 않으면 두 픽스처가 모두 파서 부재로
  // `NOT_MEASURED`가 돼 **UNBUILT가 게이트를 통과하는지 아무도 보지 않는다** — 직전 리뷰가
  // 잡은 vacuous green과 같은 클래스다.
  const errorsFor = files => withSpec({spec: ROUTE_ROW('src/pages/home/ui/HomePage.tsx'), files},
    root => {
      const {errors, manifest} = validateReleaseGate(root, {readExports})
      return {state: manifest?.symbolBinding?.state ?? buildStateOf(root),
        errors: errors.map(message => message.replace(/\/[^\s']*/g, '<path>'))}
    })
  const unbuilt = errorsFor({'src/app/App.tsx': 'export const App = () => null\n'})
  const resolved = errorsFor({'src/pages/home/ui/HomePage.tsx': 'export function HomePage() { return null }\n'})
  // 두 픽스처가 실제로 **다른 심볼 상태**여야 이 비교가 무언가를 말한다.
  assert.equal(unbuilt.state, 'UNBUILT', unbuilt.state)
  assert.equal(resolved.state, 'RESOLVED', resolved.state)
  assert.deepEqual(unbuilt.errors, resolved.errors, '심볼 상태가 릴리스 판정을 바꿨다')
})

// 매니페스트가 안 써지는 경로(QA 부재)에서도 상태를 확인할 수 있게 직접 계산한다.
function buildStateOf(root) {
  return resolveSymbols(root, routeBindingSummary(root), {readExports}).state
}

test('실파서로 export 이름을 읽는다 — CI에는 파서가 없어 로컬에서만 돈다', () => {
  // **CI에서는 vacuous하다**(§4 등록). 파서 정확성의 실제 근거는 4개 프로젝트 실측이고,
  // 이 테스트는 로컬에서 그 실측을 재현 가능하게 남겨둔 것이다.
  const entry = join(process.cwd(), 'workspace/track/node_modules/typescript/lib/typescript.js')
  if (!existsSync(entry)) return
  const ts = createRequire(import.meta.url)(entry)
  const source = [
    'const HomePage = () => null', 'export default HomePage',
    'export enum Mode { A }', 'export class Widget {}',
  ].join('\n')
  assert.deepEqual(exportedNames(ts, source, 'x.tsx').sort(), ['HomePage', 'Mode', 'Widget', 'default'])
  // `.ts`는 TSX로 파싱하면 `<T>expr` 단언이 JSX로 읽혀 복구 파싱에 들어간다.
  assert.deepEqual(exportedNames(ts, 'export const cast = <T,>(v: T) => <T>v', 'x.ts'), ['cast'])
})

// ── 릴리스 보고가 결속 상태를 싣는가 ──────────────────────────────────────────
// 매니페스트에만 남기면 아무도 읽지 않는다 — 이 저장소의 「소비자 0」 클래스다. 그래서
// `release-tier-contract`(readiness)와 `release-manager`(HANDOFF)가 **매니페스트의 그 필드를
// 옮기라**고 지시한다. 그런데 그 지시 자체가 조용히 죽는 실패를 이 저장소는 세 번 겪었다:
// **계약 문장이 실행 가능한지 검사하지 않았다.** 여기서 계약이 인용한 필드 경로를 뽑아
// 실제 매니페스트로 확인한다 — 산문 지시를 파일 대조로 끌어올리는 만큼이 이 회귀의 강도다.
// **문서가 실제로 쓰였는지는 여전히 검사하지 않는다**(생성 프로젝트 산출물이라 하네스가 못 본다).
const REPOSITORY_ROOT = fileURLToPath(new URL('../../', import.meta.url))
// **파일이 아니라 절 단위로 본다.** `release-manager.md`에는 인용이 두 곳(readiness·HANDOFF)이라
// 파일 전체를 훑으면 **한쪽이 사라져도 다른 쪽이 통과시킨다** — 적대 리뷰가 잡은 자리다.
const REPORT_SECTIONS = [
  ['.claude/skills/web-orchestrator/references/release-tier-contract.md', '## Readiness Report'],
  ['.claude/agents/release-manager.md', '## Readiness Mode'],
  ['.claude/agents/release-manager.md', '## Current status'],
]
const sectionOf = (text, heading) => {
  const start = text.indexOf(heading)
  if (start < 0) return null
  const next = text.indexOf('\n## ', start + heading.length)
  return text.slice(start, next < 0 ? undefined : next)
}

test('릴리스 보고 계약이 인용한 매니페스트 필드가 실재한다', () => {
  const cited = new Set()
  for (const [relative, heading] of REPORT_SECTIONS) {
    const section = sectionOf(readFileSync(join(REPOSITORY_ROOT, relative), 'utf8'), heading)
    assert.ok(section, `${relative}에 ${heading} 절이 없다`)
    const here = [...section.matchAll(/`((?:routeBinding|symbolBinding)\.\w+)`/g)].map(match => match[1])
    for (const path of here) cited.add(path)
    for (const required of ['routeBinding.state', 'symbolBinding.state']) {
      assert.ok(here.includes(required),
        `${relative} 「${heading}」가 ${required}를 인용하지 않는다 — 그 보고에 상태가 실리지 않는다`)
    }
  }
  withSpec({
    spec: ROUTE_ROW('src/pages/home/ui/HomePage.tsx'),
    files: {'src/app/App.tsx': 'export const App = () => null\n'},
  }, root => {
    const {manifest} = buildReleaseManifest(root, {readExports})
    for (const path of cited) {
      const value = path.split('.').reduce((node, key) => node?.[key], manifest)
      assert.notEqual(value, undefined, `계약이 인용한 ${path}가 매니페스트에 없다 — 지시가 조용히 죽는다`)
    }
    assert.equal(manifest.symbolBinding.state, 'UNBUILT', '보고할 상태가 실제로 계산되지 않았다')
  })
})
