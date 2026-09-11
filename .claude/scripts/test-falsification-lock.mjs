#!/usr/bin/env node
// test-falsification-lock.mjs — 반증 러너를 겹쳐 돌리지 않는다.
//
// **2026-09-11부터 락은 안전 장치가 아니다** — 반증이 사본에서만 변형하므로 겹쳐도 정본은 오염되지
// 않는다(`test-falsification-sandbox.mjs`). 락의 남은 역할은 같은 일을 두 번 하지 않는 것이다.
// 아래 계기는 사본 격리 **이전**의 사고 기록이다.
//
// 계기(2026-09-10 실측): 두 러너가 겹쳐 `ticket/cli.mjs`에 `if (false && …)`를 영구화했다.
// `falsifyOne`의 `finally`는 예외를 덮지만 **다른 프로세스는 덮지 못한다**. 오염된 트리를
// 본 감사가 「CI가 green이 아니다」로 오판정했다 — 오염 한 번이 판정 전체를 거짓으로 만든다.
//
// 여기서 고정하는 사실:
//   (1) 락이 있으면 **거부**한다 — 기다리지도, 회수하지도 않는다
//   (2) 죽은 홀더도 자동 회수하지 않는다 — 회수는 원자로 만들 수 없다(아래 주석)
//   (3) 죽은 홀더는 `alive: false`로 **구별해** 알린다 — 사람이 지울 수 있게
//   (4) 동시에 시작한 둘 중 정확히 하나만 취득한다
//   (5) 실제 러너가 겹친 실행을 exit 2로 거부한다 — 건너뛰지 않는다
//   (6) 권한 오류는 보유 중이 아니다 — 다음 후보로, 전부 막히면 unavailable
import assert from 'node:assert/strict'
import test from 'node:test'
import {chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawn, spawnSync} from 'node:child_process'
import {acquireLock} from './validate-falsification.mjs'

const lockIn = () => join(mkdtempSync(join(tmpdir(), 'wh-lock-')), 'f.lock')
const DEAD_PID = 2147483646 // 존재할 수 없는 pid

test('락이 있으면 거부한다 — 기다리지 않는다', () => {
  const lockPath = lockIn()
  const first = acquireLock({lockPath})
  assert.equal(typeof first.release, 'function', '첫 취득이 실패했다')
  const second = acquireLock({lockPath})
  assert.equal(second.holder, process.pid, '두 번째가 락을 가로챘다 — 겹치면 소스가 오염된다')
  assert.equal(second.release, undefined, '거부인데 release를 줬다')
  assert.equal(second.alive, true)
  first.release()
})

// **자동 회수를 하지 않는다.** 회수는 「죽었는지 본다 → 치운다 → 만든다」 세 단계이고 그 사이가
// 원자가 아니다 — `rm`→`create`는 A 취득 뒤 B가 A의 살아 있는 락을 지우고, `rename`으로 바꿔도
// A가 관찰한 뒤 B가 갈아끼운 **B의 살아 있는 락을** A가 옮긴다. 교차 모델 리뷰가 두 번 잡았고,
// 그 창을 재현하는 회귀는 타이밍 의존이라 반증 등록부가 「결박되지 않은 게이트」로 잡았다.
// 편의(자동 회수)를 위해 이 도구의 유일한 보장을 흐리지 않는다.
test('죽은 홀더도 자동 회수하지 않는다 — 사람이 지운다', () => {
  const lockPath = lockIn()
  writeFileSync(lockPath, String(DEAD_PID))
  const refused = acquireLock({lockPath})
  assert.equal(refused.release, undefined, '죽은 홀더의 락을 자동 회수했다 — 회수는 원자로 만들 수 없다')
  assert.equal(refused.holder, DEAD_PID)
  assert.equal(refused.alive, false, '죽었다는 사실을 알리지 않으면 사람이 지워도 되는지 모른다')
  assert.equal(readFileSync(lockPath, 'utf8').trim(), String(DEAD_PID), '남의 락을 건드렸다')
})

test('release가 락을 지운다', () => {
  const lockPath = lockIn()
  const held = acquireLock({lockPath})
  assert.ok(existsSync(lockPath))
  held.release()
  assert.equal(existsSync(lockPath), false, '락이 남으면 다음 실행이 막힌다')
})

test('깨진 락 파일도 회수하지 않는다 — 판정 불가는 통과가 아니다', () => {
  const lockPath = lockIn()
  writeFileSync(lockPath, '내용이 pid가 아니다')
  const refused = acquireLock({lockPath})
  assert.equal(refused.release, undefined)
  assert.equal(refused.alive, false)
})

// 동시 시작 경쟁 — `wx`가 원자가 아니면(check-then-write) 둘 다 통과한다.
test('동시에 시작한 둘 중 정확히 하나만 취득한다', async () => {
  const lockPath = lockIn()
  const barrier = `${lockPath}.go`
  const child = `
    import {existsSync} from 'node:fs'
    import {acquireLock} from ${JSON.stringify(new URL('./validate-falsification.mjs', import.meta.url).href)}
    while (!existsSync(${JSON.stringify(barrier)})) {}
    const held = acquireLock({lockPath: ${JSON.stringify(lockPath)}})
    process.stdout.write(held.release ? 'TAKEN' : 'REFUSED')
  `
  const run = () => new Promise(resolve => {
    const proc = spawn(process.execPath, ['--input-type=module', '-e', child], {encoding: 'utf8'})
    let out = ''
    proc.stdout.on('data', chunk => { out += chunk })
    proc.on('close', code => resolve({code, out: out.trim()}))
  })
  const both = Promise.all([run(), run()])
  await new Promise(resolve => setTimeout(resolve, 300))
  writeFileSync(barrier, 'go')
  const results = await both
  for (const result of results) assert.equal(result.code, 0)
  const taken = results.filter(result => result.out === 'TAKEN').length
  assert.equal(taken, 1, `${taken}개 프로세스가 동시에 취득했다 — 둘 다 소스를 변이하면 영구 오염이다`)
})

// **프로세스로 증명한다.** 순수 함수 회귀만으로는 main guard의 락 배선이 살아 있는지 모른다.
// **건너뛰지 않는다(2026-09-11).** 종전에는 락 파일을 못 만들면 전부 「다른 러너가 쥐고 있다」로
// 읽고 skip했다 — read-only `.git`에서는 이 배선 검사가 **한 번도 돌지 않았다**(감사 환경 실측:
// 33 pass · 1 skip). 이제 production과 **같은 후보 해석**으로 잡고, 이미 누가 쥐고 있어도 러너는
// 거부해야 하므로 그대로 잰다. 후보가 모두 막힌 환경만 잴 수 없고, 그때는 **실패로 알린다**.
test('실제 러너가 겹친 실행을 거부한다 — exit 2', () => {
  const repositoryRoot = new URL('../..', import.meta.url).pathname
  const held = acquireLock()
  assert.equal(held.unavailable, undefined,
    `락 후보가 모두 막혀 겹침 거부를 잴 수 없다: ${(held.unavailable ?? []).join(' · ')}`)
  try {
    // **타임아웃을 둔다.** 거부 경로는 1초 미만인데, 거부가 깨지면 러너가 사본의 사본에서 전량을 돈
    // 뒤에야 실패한다(적대 리뷰 2026-09-11). 시간 초과도 status≠2라 회귀는 그대로 발화한다.
    const run = spawnSync(process.execPath, ['.claude/scripts/validate-falsification.mjs'],
      // SIGKILL이어야 한다 — 러너는 SIGTERM 핸들러를 달고 동기 루프를 돌아서, SIGTERM을 루프가 끝날
      // 때까지 미룬다(실측 2026-09-11: 기본 SIGTERM 타임아웃이 아무것도 멈추지 못해 재귀가 53분 갔다).
      {cwd: repositoryRoot, encoding: 'utf8', timeout: 20000, killSignal: 'SIGKILL'})
    // 거부하지 않은 러너를 죽였다면 그 러너의 사본이 남는다 — pid로 정확히 그것만 치운다.
    for (const name of readdirSync(tmpdir())) {
      if (run.pid && name.startsWith(`web-harness-falsify-${run.pid}-`)) rmSync(join(tmpdir(), name), {recursive: true, force: true})
    }
    assert.equal(run.status, 2, `겹친 실행이 거부되지 않았다\n${run.stdout}${run.stderr}`)
    assert.match(run.stderr, /이미 실행 중이다|남은 락이 있다/, '거부했는데 사유를 말하지 않는다')
  } finally { held.release?.() }
})

test('권한 오류는 「보유 중」이 아니다 — 다음 후보로 넘어간다', () => {
  // read-only 디렉터리의 락 후보는 EACCES다. 종전에는 이것을 EEXIST처럼 읽어 없는 락을
  // `pid NaN`으로 보고하고 exit 2를 냈다(감사 환경 재현: {"holder":null,"alive":false}).
  const locked = mkdtempSync(join(tmpdir(), 'wh-lock-ro-'))
  chmodSync(locked, 0o555)
  const fallback = lockIn()
  try {
    const taken = acquireLock({lockPaths: [join(locked, 'f.lock'), fallback]})
    assert.equal(typeof taken.release, 'function', `권한 오류에서 다음 후보로 넘어가지 않았다: ${JSON.stringify(taken)}`)
    assert.equal(taken.lockPath, fallback)
    assert.equal(taken.holder, undefined, '없는 락을 보유자로 보고했다')
    taken.release()
  } finally { chmodSync(locked, 0o755); rmSync(locked, {recursive: true, force: true}) }
})

test('후보가 모두 막히면 unavailable이다 — 가짜 보유자를 지어내지 않는다', () => {
  const locked = mkdtempSync(join(tmpdir(), 'wh-lock-ro-'))
  chmodSync(locked, 0o555)
  try {
    const result = acquireLock({lockPaths: [join(locked, 'f.lock')]})
    assert.ok(Array.isArray(result.unavailable) && result.unavailable.length === 1,
      `막힌 후보를 unavailable로 보고하지 않았다: ${JSON.stringify(result)}`)
    assert.equal(result.holder, undefined, '`pid NaN` 오판정이 되살아났다')
  } finally { chmodSync(locked, 0o755); rmSync(locked, {recursive: true, force: true}) }
})

test('반증 안에서 반증을 도는 재귀를 막는다 — 깊이 2 이상은 아무것도 하지 않고 거부한다', () => {
  // 락 seed가 사본의 러너를 변형하면 그 러너는 거부하지 않고 자기 사본(변형 포함)을 다시 복사해
  // 돈다 — 모든 층이 변형을 싣고 가므로 끝나지 않는다(실측 53분 · 약 130층).
  const repositoryRoot = new URL('../..', import.meta.url).pathname
  const run = spawnSync(process.execPath, ['.claude/scripts/validate-falsification.mjs'],
    {cwd: repositoryRoot, encoding: 'utf8', timeout: 20000, killSignal: 'SIGKILL',
      env: {...process.env, WEB_HARNESS_FALSIFICATION_DEPTH: '2'}})
  assert.equal(run.status, 2, `깊이 2의 러너가 돌았다 — 재귀가 끝나지 않는다\n${run.stdout}${run.stderr}`)
  assert.match(run.stderr, /중첩 반증 실행을 거부한다/)
})
