#!/usr/bin/env node
// test-falsification-lock.mjs — 반증 러너를 겹쳐 돌릴 수 없다.
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
//   (5) 실제 러너가 겹친 실행을 exit 2로 거부한다
import assert from 'node:assert/strict'
import test from 'node:test'
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawn, spawnSync} from 'node:child_process'
import {LOCK_PATH, acquireLock} from './validate-falsification.mjs'

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
test('실제 러너가 겹친 실행을 거부한다 — exit 2', t => {
  const repositoryRoot = new URL('../..', import.meta.url).pathname
  // production이 계산한 경로를 쓴다 — 하드코딩한 `.git/…`는 worktree에서 ENOTDIR로 죽는다.
  const lockPath = LOCK_PATH
  // **원자적으로 잡는다.** 확인 후 쓰기로 하면 그 사이에 다른 러너가 취득한 락을 덮고,
  // `finally`가 그 새 락까지 지운다 — 이 테스트가 지키려는 배타성을 테스트가 깬다
  // (교차 모델 커밋 리뷰 2026-09-10). 못 잡으면 잴 수 없으므로 건너뛴다.
  let held
  try { writeFileSync(lockPath, String(process.pid), {flag: 'wx'}); held = true }
  catch { t.skip('다른 러너가 락을 쥐고 있다 — 배타성을 깨지 않는다'); return }
  try {
    const run = spawnSync(process.execPath, ['.claude/scripts/validate-falsification.mjs'],
      {cwd: repositoryRoot, encoding: 'utf8'})
    assert.equal(run.status, 2, `겹친 실행이 거부되지 않았다\n${run.stdout}${run.stderr}`)
    assert.match(run.stderr, /이미 실행 중이다/, '거부했는데 사유를 말하지 않는다')
  } finally { if (held) rmSync(lockPath, {force: true}) }
})
