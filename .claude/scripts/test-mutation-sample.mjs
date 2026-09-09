// 변이 표본 회귀 — **실제 프로젝트 없이 CI에서 돈다.**
//
// 러너와 파일 IO를 주입한다. 이 저장소는 gitignore된 `workspace/`에 회귀를 결박했다가 CI에서
// vacuous green을 만든 적이 세 번 있다(§4 등록) — 같은 실수를 반복하지 않는다.
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MUTATION_OPERATORS, mutationCandidates, renderMutationSample, runMutationSample, spreadSample,
} from './mutation-sample-lib.mjs'

/**
 * 메모리 위의 프로젝트. **기준 실행(변이 없음)에서는 반드시 통과해야 한다** — 그렇지 않으면
 * `NOT_MEASURED`이고 그것이 옳다(빨간 스위트로는 잴 수 없다).
 * `strict` 프로젝트는 내용이 원본과 다르면 실패한다(= 변이를 잡는다).
 */
const memoryProject = (files, {strict = true} = {}) => {
  const state = new Map(Object.entries(files))
  const pristine = JSON.stringify([...state])
  return {
    state,
    io: {
      listSources: () => [...state.keys()],
      readFile: path => state.get(path),
      writeFile: (path, text) => state.set(path, text),
    },
    // 원본 그대로면 통과(0). 변이가 들어왔고 strict면 실패(1) = 잡은 것.
    runTests: () => (strict && JSON.stringify([...state]) !== pristine ? 1 : 0),
  }
}

test('변이 후보는 실제로 문자열이 바뀌는 것만 센다', () => {
  assert.deepEqual(mutationCandidates('const a = 1', 'x.ts'), [])
  const found = mutationCandidates('if (a >= b && c === d) return true', 'x.ts')
  assert.deepEqual(found.map(item => item.operator).sort(),
    ['and-to-or', 'eq-to-neq', 'gte-to-gt', 'true-to-false'])
})

test('표본은 파일을 고루 흩는다 — 한 파일에 몰리면 테스트 없는 층이 통째로 빠진다', () => {
  const candidates = [
    {file: 'a.ts', operator: 'gte-to-gt'}, {file: 'a.ts', operator: 'and-to-or'},
    {file: 'b.ts', operator: 'gte-to-gt'}, {file: 'c.ts', operator: 'gte-to-gt'},
  ]
  assert.deepEqual(spreadSample(candidates, 3).map(item => item.file), ['a.ts', 'b.ts', 'c.ts'])
})

test('테스트가 잡으면 killed, 못 잡으면 survived다 — 이 판정이 이 검사의 전부다', async () => {
  // 잡는 프로젝트: 변이가 들어오면 실패한다.
  const strict = memoryProject({'src/a.ts': 'export const f = (n) => n >= 3\n'})
  const good = await runMutationSample('/tmp/x', {runTests: strict.runTests, io: strict.io})
  assert.equal(good.state, 'MEASURED')
  assert.equal(good.killed, 1)
  assert.equal(good.survived, 0)
  assert.equal(good.score, 100)

  // 못 잡는 프로젝트: 무엇을 바꿔도 통과한다 — 실측 `minicar-laptime`이 이 형태였다(0/6).
  const loose = memoryProject({'src/a.ts': 'export const f = (n) => n >= 3\n'}, {strict: false})
  const bad = await runMutationSample('/tmp/x', {runTests: loose.runTests, io: loose.io})
  assert.equal(bad.killed, 0)
  assert.equal(bad.survived, 1)
  assert.equal(bad.score, 0)
  assert.deepEqual(bad.survivors.map(item => item.file), ['src/a.ts'])
})

test('원본은 반드시 복원된다 — 테스트 러너가 던져도', async () => {
  const project = memoryProject({'src/a.ts': 'export const f = (n) => n >= 3\n'})
  const original = project.state.get('src/a.ts')
  await assert.rejects(runMutationSample('/tmp/x', {
    runTests: () => { throw new Error('러너 폭발') }, io: project.io,
  }))
  assert.equal(project.state.get('src/a.ts'), original, '변이가 소스에 남았다')
})

test('러너가 없으면 NOT_MEASURED다 — 통과가 아니다', async () => {
  const result = await runMutationSample('/tmp/x', {io: {listSources: () => []}})
  assert.equal(result.state, 'NOT_MEASURED')
  assert.match(result.note, /통과가 아니다/)
})

test('변이할 자리가 없으면 점수를 지어내지 않는다', async () => {
  const project = memoryProject({'src/a.ts': 'export const n = 1\n'})
  const result = await runMutationSample('/tmp/x', {runTests: project.runTests, io: project.io})
  assert.equal(result.state, 'NO_CANDIDATES')
  assert.equal(result.score, null, '잴 것이 없는데 점수가 나왔다')
})

test('보고는 「표본」을 떼지 않는다 — 전수 점수로 읽히면 그것이 과장이다', async () => {
  const project = memoryProject({
    'src/a.ts': 'export const f = (n) => n >= 3\n',
    'src/b.ts': 'export const g = (n) => n <= 3\n',
  }, {strict: false})
  const result = await runMutationSample('/tmp/x', {runTests: project.runTests, io: project.io, limit: 1})
  assert.match(renderMutationSample(result), /변이 표본/)
  assert.match(result.note, /전수 점수가 아니다/)
  assert.equal(result.truncated, true)
})

test('테스트 파일은 변이시키지 않는다 — 테스트를 바꾸면 테스트를 시험하는 게 아니다', () => {
  // `sourceFilesOf`의 제외 규약을 연산자 목록과 함께 고정한다.
  assert.ok(MUTATION_OPERATORS.every(operator => operator.id && operator.label && operator.find))
  assert.equal(new Set(MUTATION_OPERATORS.map(operator => operator.id)).size, MUTATION_OPERATORS.length)
})

// ── 배선 ─────────────────────────────────────────────────────────────────────
test('배선: test-executor가 변이 표본을 부르고, bash 정책이 그 명령을 허용한다', async () => {
  // 부르지 않는 검사는 없는 것과 같고, 정책에 없는 명령은 에이전트 경로에서 막힌다 —
  // 이 저장소가 네 번 물린 클래스다(`--to design`·`--design-debt`·`init-workspace`·여기).
  const {readFileSync} = await import('node:fs')
  const {fileURLToPath} = await import('node:url')
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const agent = readFileSync(`${root}.claude/agents/test-executor.md`, 'utf8')
  assert.match(agent, /validate-mutation-sample\.mjs/, 'test-executor가 부르지 않는다')
  assert.match(agent, /커버리지는 실행만 측정한다/, '왜 부르는지가 적혀 있지 않다')

  const {evaluateGlobalBashPolicy} = await import('./global-bash-policy-lib.mjs')
  const decide = command => evaluateGlobalBashPolicy({
    agent_type: 'test-executor', tool_name: 'Bash', tool_input: {command},
  })
  const base = 'node .claude/scripts/validate-mutation-sample.mjs --project .'
  assert.equal(decide(base).allowed, true, '계약이 부르는 명령이 정책에 막힌다')
  assert.equal(decide(`${base} --limit 8 --json`).allowed, true)
  // 인자 계약은 좁게 — 알 수 없는 값이 --limit에 오면 막는다.
  assert.equal(decide(`${base} --limit rm`).code, 'DENY_VALIDATION_COMMAND')
  assert.equal(decide('node .claude/scripts/validate-mutation-sample.mjs --project /etc').code, 'DENY_PATH_OUTSIDE')
})

test('배선: CLI가 프로세스로 돌아 점수를 내고 소스를 원복한다', async () => {
  // 정책만 열고 실행을 시험하지 않으면 배선은 미증명이다(`wiring-coverage`의 `unwired` 부채).
  const {mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync} = await import('node:fs')
  const {tmpdir} = await import('node:os')
  const {join} = await import('node:path')
  const {spawnSync} = await import('node:child_process')
  const {fileURLToPath} = await import('node:url')
  const cli = fileURLToPath(new URL('./validate-mutation-sample.mjs', import.meta.url))
  const run = root => JSON.parse(spawnSync(process.execPath,
    [cli, '--project', root, '--limit', '1', '--json'], {encoding: 'utf8'}).stdout)

  // 픽스처는 **기준 실행에서 반드시 통과해야 한다** — 그것이 이 검사의 전제다.
  const build = check => {
    const root = mkdtempSync(join(tmpdir(), 'wh-mut-'))
    mkdirSync(join(root, 'src'), {recursive: true})
    writeFileSync(join(root, 'package.json'),
      JSON.stringify({name: 'fixture', private: true, scripts: {test: 'node check.mjs'}}))
    writeFileSync(join(root, 'check.mjs'), check)
    writeFileSync(join(root, 'src/a.ts'), 'export const f = (n) => n >= 3\n')
    return root
  }
  // 원본을 알아보는 테스트 → 변이를 잡는다.
  const strict = build("import {readFileSync} from 'node:fs'\n"
    + "process.exit(readFileSync('src/a.ts', 'utf8').includes('>= 3') ? 0 : 1)\n")
  try {
    const result = run(strict)
    assert.equal(result.state, 'MEASURED')
    assert.equal(result.score, 100)
    assert.equal(result.digestStable, true, '복원을 증명하지 못했다')
    assert.match(readFileSync(join(strict, 'src/a.ts'), 'utf8'), />= 3/, '변이가 소스에 남았다')
  } finally { rmSync(strict, {recursive: true, force: true}) }

  // 무엇을 바꿔도 통과 → 변이가 살아남는다(실측 `minicar-laptime`이 이 형태였다).
  const loose = build('process.exit(0)\n')
  try {
    const result = run(loose)
    assert.equal(result.score, 0, '못 잡는 테스트인데 점수가 나왔다')
  } finally { rmSync(loose, {recursive: true, force: true}) }

  // **원래 빨간 스위트는 잴 수 없다** — 종전에는 이것이 100%로 보고됐다(적대 리뷰가 재현).
  const red = build('process.exit(1)\n')
  try {
    const result = run(red)
    assert.equal(result.state, 'NOT_MEASURED')
    assert.equal(result.score, null, '빨간 스위트가 점수를 냈다')
  } finally { rmSync(red, {recursive: true, force: true}) }

  // 테스트 명령이 없으면 점수를 지어내지 않는다.
  const bare = mkdtempSync(join(tmpdir(), 'wh-mut-bare-'))
  try {
    mkdirSync(join(bare, 'src'), {recursive: true})
    writeFileSync(join(bare, 'package.json'), JSON.stringify({name: 'x', private: true}))
    writeFileSync(join(bare, 'src/a.ts'), 'export const f = (n) => n >= 3\n')
    assert.equal(run(bare).state, 'NOT_MEASURED')
  } finally { rmSync(bare, {recursive: true, force: true}) }
})

test('기준 실행이 실패하면 NOT_MEASURED다 — 빨간 스위트로는 잴 수 없다', async () => {
  // **적대 리뷰가 실행으로 재현한 BLOCK이다**: 기준 실행 없이 재면 원래 빨간 스위트도,
  // 러너가 아예 못 뜨는 경우도 모든 변이가 「잡혔다」로 세어져 **점수가 항상 100%**가 된다.
  // 반증 seed가 막으려던 결과가 다른 문으로 열려 있었다.
  const alwaysRed = memoryProject({'src/a.ts': 'export const f = (n) => n >= 3\n'})
  const result = await runMutationSample('/tmp/x', {runTests: () => 1, io: alwaysRed.io})
  assert.equal(result.state, 'NOT_MEASURED')
  assert.equal(result.score, null, '빨간 스위트인데 점수가 나왔다')
  assert.match(result.note, /기준 실행이 실패했다/)
  assert.match(result.note, /통과가 아니다/)
})

test('변이는 첫 출현 하나만 바꾼다 — 전부 뒤집으면 「1건」이 아니고 점수가 위로 기운다', async () => {
  const seen = []
  const project = memoryProject({'src/a.ts': 'const a = x >= 1\nconst b = y >= 2\n'}, {strict: false})
  const io = {...project.io, writeFile: (path, text) => { seen.push(text); project.io.writeFile(path, text) }}
  await runMutationSample('/tmp/x', {runTests: project.runTests, io, limit: 1})
  const mutated = seen.find(text => text.includes('x > 1'))
  assert.ok(mutated, '첫 출현이 변이되지 않았다')
  assert.ok(mutated.includes('y >= 2'), '두 번째 출현까지 함께 뒤집었다 — 변이 1건이 아니다')
})

test('진행 중 파일을 호출부에 알린다 — 강제 종료 시 복원 근거가 된다', async () => {
  const project = memoryProject({'src/a.ts': 'export const f = (n) => n >= 3\n'})
  const flight = []
  await runMutationSample('/tmp/x', {
    runTests: project.runTests, io: project.io,
    onInFlight: item => flight.push(item ? item.file : null),
  })
  assert.deepEqual(flight, ['src/a.ts', null], '변이 시작·복원 완료가 보고되지 않았다')
})
