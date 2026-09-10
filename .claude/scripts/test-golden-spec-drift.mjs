#!/usr/bin/env node
// test-golden-spec-drift.mjs — 커밋된 골든 스팩이 자기 입력과 어긋나는지 재는 검사의 회귀.
//
// 여기서 고정하는 사실:
//   (1) 분모는 스팩이 **기록한** 입력이다 — 현재 LOCK_INPUTS가 넓어져도 드리프트로 세지 않는다
//   (2) 내용 변경·삭제·신규 출현을 전부 드리프트로 센다 — 침묵이 통과가 되지 않는다
//   (3) 판정 불가는 FRESH로 강등하지 않는다
//   (4) 실제 저장소의 골든이 FRESH다 — 픽스처만으로는 배선을 증명하지 못한다
//   (5) 게이트가 실제로 막는다 — 골든 입력을 흔들면 validate-harness가 비0으로 끝난다
import assert from 'node:assert/strict'
import test from 'node:test'
import {createHash} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {inspectGoldenSpec, inspectGoldenSpecs, renderGoldenSpecDrift,
  validateGoldenSpecDrift} from './golden-spec-drift-lib.mjs'
import {digestInputs, stripHarnessMarkers} from './spec.mjs'

const sha256 = text => createHash('sha256').update(text).digest('hex')
const SPEC = 'golden/demo/_workspace/03_dev/spec.json'

// `digestInputs`도 주입한다 — **산식은 lockSpec의 것**이므로 여기서 흉내내지 않고 같은 함수를
// 메모리 파일 위에서 돌린다. 손으로 해시하면 두 판정이 갈라진다(적대 리뷰 2026-09-10이 잡은 것).
const withFiles = files => ({
  readFile: path => {
    if (!(path in files)) throw new Error(`ENOENT ${path}`)
    return files[path]
  },
  digestInputs: (projectRoot, paths) => ({
    inputs: paths.map(path => {
      const key = `${String(projectRoot).replace(/^\/repo\//, '')}/${path}`.replace(/^\/+/, '')
      return key in files
        ? {path, present: true, sha256: sha256(stripHarnessMarkers(files[key]))}
        : {path, present: false}
    }),
  }),
  // 탐색도 주입한다 — 없으면 `goldenSpecPaths`가 디스크를 보고 픽스처 스팩을 0개로 세며,
  // 그러면 「막는가」 테스트가 **빈 목록을 통과로 읽어** 공허하게 green이 된다(실제로 그랬다).
  listDir: () => ['demo'],
  exists: path => String(path).replace(/^\/repo\//, '') in files,
})
const specFile = inputs => JSON.stringify({schemaVersion: 1, sourceDigest: {inputs}})

test('기록한 입력이 그대로면 FRESH다', () => {
  const io = withFiles({
    [SPEC]: specFile([{path: '_workspace/01_plan/tech-stack.md', present: true, sha256: sha256('a')}]),
    'golden/demo/_workspace/01_plan/tech-stack.md': 'a',
  })
  assert.equal(inspectGoldenSpec('/repo', SPEC, {io}).state, 'FRESH')
})

test('분모는 스팩이 기록한 목록이다 — LOCK_INPUTS가 넓어져도 드리프트가 아니다', () => {
  // 하네스가 잠금 목록에 경로를 더해도 골든의 결함이 아니다. 스팩이 기록하지 않은 경로는
  // 대조 대상이 아니며, 그 파일이 디스크에 있든 없든 판정에 들어가지 않는다.
  const io = withFiles({
    [SPEC]: specFile([{path: '_workspace/01_plan/tech-stack.md', present: true, sha256: sha256('a')}]),
    'golden/demo/_workspace/01_plan/tech-stack.md': 'a',
    'golden/demo/_workspace/02_design/design-system.md': '나중에 잠금에 든 파일',
  })
  const result = inspectGoldenSpec('/repo', SPEC, {io})
  assert.equal(result.state, 'FRESH', '목록 확장을 골든의 드리프트로 세면 확장할 때마다 전건이 뜬다')
  assert.deepEqual(result.drifted, [])
})

test('내용 변경·삭제·신규 출현을 전부 센다', () => {
  const io = withFiles({
    [SPEC]: specFile([
      {path: 'a.md', present: true, sha256: sha256('원본')},
      {path: 'b.md', present: true, sha256: sha256('그대로')},
      {path: 'gone.md', present: true, sha256: sha256('있었다')},
      {path: 'later.md', present: false},
    ]),
    'golden/demo/a.md': '바뀐 내용',
    'golden/demo/b.md': '그대로',
    'golden/demo/later.md': '없다가 생겼다',
  })
  const result = inspectGoldenSpec('/repo', SPEC, {io})
  assert.equal(result.state, 'DRIFTED')
  assert.deepEqual(result.drifted.sort(),
    ['a.md(내용 바뀜)', 'gone.md(사라짐)', 'later.md(새로 생김)'].sort(),
    '사라진 입력을 침묵으로 두면 삭제가 통과한다')
})

test('판정 불가를 FRESH로 강등하지 않는다', () => {
  assert.equal(inspectGoldenSpec('/repo', SPEC, {io: withFiles({[SPEC]: '{깨진 json'})}).state, 'UNREADABLE')
  assert.equal(inspectGoldenSpec('/repo', SPEC, {io: withFiles({[SPEC]: specFile([])})}).state, 'UNREADABLE')
})

test('보고 문구는 드리프트가 있으면 경로와 처방을 함께 낸다', () => {
  const text = renderGoldenSpecDrift([{path: SPEC, state: 'DRIFTED', drifted: ['x(내용 바뀜)'], note: 'n'}])
  assert.match(text, /1 drifted/)
  assert.match(text, /golden\/demo/)
  assert.match(text, /재-잠금까지 같은 커밋에서 한다/,
    '무엇을 하라는지 말하지 않으면 다음 사람도 그냥 지나친다 — ddc3314가 정확히 그랬다')
})

// **실제 저장소에 건다.** 픽스처만으로는 이 검사가 진짜 골든을 읽는지 증명하지 못한다 —
// 이 저장소가 "순수 함수엔 회귀가 촘촘한데 그것을 먹이는 자리엔 0건"으로 세 번 물린 클래스다.
test('실제 골든이 자기 스팩과 맞는다 — v2 이관으로 드리프트를 닫았다', () => {
  const repositoryRoot = new URL('../..', import.meta.url).pathname
  const results = inspectGoldenSpecs(repositoryRoot)
  assert.ok(results.length > 0, '커밋된 골든 스팩을 하나도 찾지 못했다 — 경로 규칙이 깨졌다')
  const target = results.find(item => item.path.includes('vite-serverless-hybrid'))
  assert.ok(target, 'vite-serverless-hybrid 골든을 찾지 못했다')
  assert.equal(target.state, 'FRESH',
    `골든이 자기 스팩과 어긋난다: ${target.note} — 입력을 고쳤으면 같은 커밋에서 재-잠금하라`)
})

test('골든 스팩은 v2다 — v1은 재-잠금이 기계적으로 불가해 게이트를 세울 수 없었다', () => {
  const repositoryRoot = new URL('../..', import.meta.url).pathname
  const spec = JSON.parse(readFileSync(
    join(repositoryRoot, 'golden/vite-serverless-hybrid/_workspace/03_dev/spec.json'), 'utf8'))
  assert.equal(spec.schemaVersion, 2, 'v1로 되돌아가면 lockSpec이 재-잠금을 거부해 처방이 사라진다')
  // testLayers가 v2의 요구이자 이관의 실체다 — layerMap이 이미 선언한 경로와 같아야 한다.
  assert.deepEqual(spec.testLayers, {unit: 'tests', e2e: 'e2e'})
  // 이관은 **세대 이동일 뿐** 의미 변경이 아니었다 — 이 둘이 바뀌면 골든의 성격이 바뀐 것이다.
  assert.equal(spec.specTier, 'unverifiable')
  assert.equal(spec.acceptanceSource, 'absent')
})

// **hermetic이다 — 커밋된 골든을 건드리지 않는다.** 첫 판은 실제 `project-profile.json`에
// 개행을 붙였다가 복원했는데, 그 사이 복원이 어긋나 개행 두 개가 트리에 남았고 **저자가
// 드리프트 결과를 잘못 읽었다**(2026-09-10, 적대 리뷰가 위험을 지적한 직후 실제로 물렸다).
// 게이트를 시험하려고 게이트의 대상을 망가뜨리면 실패 한 번이 트리를 오염시킨다.
test('게이트가 막는다 — 드리프트가 있으면 fail을 부른다', () => {
  const io = withFiles({
    [SPEC]: specFile([{path: 'a.md', present: true, sha256: sha256('원본')}]),
    'golden/demo/a.md': '바뀐 내용',
  })
  const calls = {pass: [], fail: []}
  validateGoldenSpecDrift({repositoryRoot: '/repo', io,
    pass: message => calls.pass.push(message), fail: message => calls.fail.push(message)})
  assert.equal(calls.fail.length, 1, '드리프트가 있는데 막지 않았다 — 게이트가 아니라 보고다')
  assert.equal(calls.pass.length, 0)
  assert.match(calls.fail[0], /a\.md\(내용 바뀜\)/)
})

test('게이트가 미판정도 막는다 — 읽지 못한 것을 FRESH로 강등하지 않는다', () => {
  const calls = {pass: [], fail: []}
  validateGoldenSpecDrift({repositoryRoot: '/repo', io: withFiles({[SPEC]: '{깨진 json'}),
    pass: message => calls.pass.push(message), fail: message => calls.fail.push(message)})
  assert.equal(calls.fail.length, 1, '미판정을 통과시키면 침묵이 곧 통과다')
})

test('게이트가 통과시킨다 — 기록과 같으면 pass다', () => {
  const io = withFiles({
    [SPEC]: specFile([{path: 'a.md', present: true, sha256: sha256('원본')}]),
    'golden/demo/a.md': '원본',
  })
  const calls = {pass: [], fail: []}
  validateGoldenSpecDrift({repositoryRoot: '/repo', io,
    pass: message => calls.pass.push(message), fail: message => calls.fail.push(message)})
  assert.equal(calls.fail.length, 0, `정당한 골든을 막았다: ${calls.fail[0]}`)
  assert.equal(calls.pass.length, 1)
})

// 아래 둘은 **실제 디스크에서** 돈다 — 주입한 digestInputs로는 산식이 lockSpec과 같은지
// 증명할 수 없기 때문이다. 리뷰(2026-09-10)가 잡은 두 갈래를 각각 못박는다.
test('샤드 입력을 오탐으로 막지 않는다 — 기록도 최상위 sha256을 갖는다', () => {
  const root = mkdtempSync(join(tmpdir(), 'wh-shard-'));
  try {
    // 샤드 계획: `feature-plan/`이 디렉터리다. 원문을 직접 읽으려 하면 ENOENT가 나
    // `(사라짐)`으로 잡히는데, 그것이 첫 판의 결함이었다 — 재-잠금해도 안 풀리는 차단.
    mkdirSync(join(root, 'golden/demo/_workspace/01_plan/feature-plan'), {recursive: true})
    mkdirSync(join(root, 'golden/demo/_workspace/03_dev'), {recursive: true})
    writeFileSync(join(root, 'golden/demo/_workspace/01_plan/feature-plan/a.md'), '## FEAT-001 x\n')
    // 기록되는 경로는 **`.md`가 붙은 쪽**이다 — `resolveInputFiles`가 `.md`를 떼어 같은 이름의
    // 디렉터리를 찾는다. 그래서 그 경로를 원문으로 읽으려 하면 파일이 없어 ENOENT가 난다.
    const digest = digestInputs(join(root, 'golden/demo'), ['_workspace/01_plan/feature-plan.md'])
    assert.equal(digest.inputs[0].kind, 'sharded', '샤드로 해소되지 않으면 이 회귀가 무의미하다')
    assert.equal(typeof digest.inputs[0].sha256, 'string', '샤드 기록에 최상위 해시가 없다')
    writeFileSync(join(root, 'golden/demo/_workspace/03_dev/spec.json'),
      JSON.stringify({schemaVersion: 2, sourceDigest: digest}))
    assert.equal(inspectGoldenSpec(root, SPEC).state, 'FRESH',
      '샤드 골든을 오탐으로 막으면 재-잠금해도 안 풀린다 — 처방 없는 차단이다')
    // 샤드 하나를 고치면 여전히 잡는다 — 오탐을 없앤 대가로 탐지를 잃지 않았다.
    writeFileSync(join(root, 'golden/demo/_workspace/01_plan/feature-plan/a.md'), '## FEAT-001 y\n')
    assert.equal(inspectGoldenSpec(root, SPEC).state, 'DRIFTED')
  } finally { rmSync(root, {recursive: true, force: true}) }
})

test('하네스 마커가 든 입력을 잠근 직후 막지 않는다 — 요구를 따르는 행위가 자기 무효화가 되면 안 된다', () => {
  const root = mkdtempSync(join(tmpdir(), 'wh-marker-'));
  try {
    mkdirSync(join(root, 'golden/demo/_workspace/01_plan'), {recursive: true})
    mkdirSync(join(root, 'golden/demo/_workspace/03_dev'), {recursive: true})
    const input = join(root, 'golden/demo/_workspace/01_plan/feature-plan.md')
    writeFileSync(input, '## FEAT-001 x\n<!-- web-harness:unit feat=FEAT-001 dependsOn=none -->\n')
    const digest = digestInputs(join(root, 'golden/demo'), ['_workspace/01_plan/feature-plan.md'])
    writeFileSync(join(root, 'golden/demo/_workspace/03_dev/spec.json'),
      JSON.stringify({schemaVersion: 2, sourceDigest: digest}))
    assert.equal(inspectGoldenSpec(root, SPEC).state, 'FRESH',
      '마커를 원문으로 해시하면 잠근 직후 막힌다 — lockSpec은 마커를 걷어내고 해시한다')
    // 마커만 바꾸는 것은 내용 변경이 아니다 — lockSpec의 판단과 같아야 한다.
    writeFileSync(input, '## FEAT-001 x\n<!-- web-harness:unit feat=FEAT-001 dependsOn=FEAT-002 -->\n')
    assert.equal(inspectGoldenSpec(root, SPEC).state, 'FRESH',
      '마커 편집이 드리프트로 잡히면 isSpecStale과 판정이 갈린다')
    // 내용이 바뀌면 여전히 잡는다.
    writeFileSync(input, '## FEAT-001 y\n')
    assert.equal(inspectGoldenSpec(root, SPEC).state, 'DRIFTED')
  } finally { rmSync(root, {recursive: true, force: true}) }
})

// **배선 회귀 — 프로세스로 돌린다.** 순수 함수 회귀만 있으면 호출부가 조용히 끊긴다.
// 이 저장소가 §4에 세 번 등록한 클래스이고, 이 검사가 존재하는 이유 자체가 그것이다.
test('validate-harness가 실제로 이 검사를 부른다 — 보고에 경로가 실린다', () => {
  const repositoryRoot = new URL('../..', import.meta.url).pathname
  const run = spawnSync(process.execPath, ['.claude/scripts/validate-harness.mjs'],
    {cwd: repositoryRoot, encoding: 'utf8'})
  assert.equal(run.status, 0, `validate-harness가 실패했다: ${run.stderr}`)
  // **측정 결과 자체를 대조한다.** 처음에는 `/vite-serverless-hybrid/`만 봤는데, 그 문자열은
  // 골든 프로필 검사 줄에도 있어서 **검사를 통째로 지워도 통과했다**(반증 등록부가 잡았다).
  // 고정 문구 매칭은 배선의 증거가 아니다 — 지금 잰 값이 그대로 실렸는지 본다.
  const expected = renderGoldenSpecDrift(inspectGoldenSpecs(repositoryRoot)).split('\n')[0]
  assert.ok(run.stdout.includes(expected),
    `보고에 측정 결과가 실리지 않았다 — 호출부가 끊겼거나 고정 문구로 바뀌었다.\n기대: ${expected}`)
})
