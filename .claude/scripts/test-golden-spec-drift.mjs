#!/usr/bin/env node
// test-golden-spec-drift.mjs — 커밋된 골든 스팩이 자기 입력과 어긋나는지 재는 검사의 회귀.
//
// 여기서 고정하는 사실:
//   (1) 분모는 스팩이 **기록한** 입력이다 — 현재 LOCK_INPUTS가 넓어져도 드리프트로 세지 않는다
//   (2) 내용 변경·삭제·신규 출현을 전부 드리프트로 센다 — 침묵이 통과가 되지 않는다
//   (3) 판정 불가는 FRESH로 강등하지 않는다
//   (4) 실제 저장소에서 알려진 드리프트 1건을 잡는다 — 픽스처만으로는 배선을 증명하지 못한다
import assert from 'node:assert/strict'
import test from 'node:test'
import {createHash} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import {inspectGoldenSpec, inspectGoldenSpecs, renderGoldenSpecDrift} from './golden-spec-drift-lib.mjs'

const sha256 = text => createHash('sha256').update(text).digest('hex')
const SPEC = 'golden/demo/_workspace/03_dev/spec.json'

const withFiles = files => ({
  readFile: path => {
    if (!(path in files)) throw new Error(`ENOENT ${path}`)
    return files[path]
  },
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
  assert.match(text, /v2 이관/, '무엇을 하라는지 말하지 않으면 다음 사람도 그냥 지나친다')
})

// **실제 저장소에 건다.** 픽스처만으로는 이 검사가 진짜 골든을 읽는지 증명하지 못한다 —
// 이 저장소가 "순수 함수엔 회귀가 촘촘한데 그것을 먹이는 자리엔 0건"으로 세 번 물린 클래스다.
test('실제 골든의 알려진 드리프트를 잡는다 — ddc3314의 재-잠금 주장이 트리에 없다', () => {
  const repositoryRoot = new URL('../..', import.meta.url).pathname
  const results = inspectGoldenSpecs(repositoryRoot)
  assert.ok(results.length > 0, '커밋된 골든 스팩을 하나도 찾지 못했다 — 경로 규칙이 깨졌다')
  const target = results.find(item => item.path.includes('vite-serverless-hybrid'))
  assert.ok(target, 'vite-serverless-hybrid 골든을 찾지 못했다')
  assert.equal(target.state, 'DRIFTED',
    '알려진 드리프트가 사라졌다 — 골든을 v2로 이관했다면 이 회귀를 갱신하고 검사를 게이트로 올려라')
  assert.ok(target.drifted.some(entry => entry.includes('project-profile.json')),
    'ddc3314가 바꾼 project-profile.json이 드리프트로 잡히지 않는다')
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
