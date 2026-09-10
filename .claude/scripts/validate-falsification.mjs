#!/usr/bin/env node
// validate-falsification.mjs — 게이트가 실제로 발화하는지 기계로 확인한다.
//
// 실측(2026-08-26, 2회): 검증 호출을 지워도 CI가 exit 0이었다. 테스트가 lib을 직접 부르고
// **배선 지점을 지나가지 않아서**다. 게이트를 만들어도 호출부가 끊기면 아무도 모른다 —
// 이 repo가 하루 종일 남의 코드에서 잡아낸 실패 클래스를 자기 테스트가 앓고 있었다.
//
// 방식: 등록부의 각 항목마다 게이트를 무력화하는 **최소 변형**을 적용하고 짝지어진 테스트를
// 돌린다. 실패해야 정상이다. 통과하면 그 게이트는 **반증되지 않는 게이트**이며 언제든 조용히
// 끊길 수 있다.
//
// 이것은 오늘까지 손으로 하던 반증을 기계화한 것이다. 손으로 하면 잊는다.
// ── 동시 실행 금지 ───────────────────────────────────────────────────────────
// 실측(2026-09-10): 이 러너를 **두 개 겹쳐 돌려 소스를 영구 오염시켰다.** `falsifyOne`은
// 진입 시 `original`을 읽고 `finally`에 되쓰는데, 앞 러너가 변이를 쓴 상태에서 뒤 러너가
// `original`을 읽으면 그 변이본이 뒤 러너의 "원본"이 되고, 뒤 러너의 복원이 그것을 **정본으로
// 굳힌다**. 그렇게 `ticket/cli.mjs`에 `if (false && …)`가 남았고, 그 트리를 본 감사가
// 「전체 CI가 green이 아니다」로 판정했다 — 오염이 오판정을 낳았다.
//
// `finally`는 예외를 덮지만 **다른 프로세스는 덮지 못한다.** 락으로 막는다.
import {execFileSync} from 'node:child_process'
import {existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {createHash} from 'node:crypto'
import {dirname, join} from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = join(scriptDir, '..', '..')
const REGISTRY = join(scriptDir, 'validators/falsification-registry.json')
// 락은 **저장소 소스 밖**에 둔다 — 락 파일 자체가 반증 대상 트리에 들어가면 그것이 변경으로
// 잡힌다. 기본은 `.git/` 안이고, **worktree 체크아웃에서는 `.git`이 파일이라** 거기에 디렉터리를
// 만들 수 없다(그리고 git이 아닌 사본에 빈 `.git/`을 만들면 `.git` 존재 판정을 오도한다).
// 그 경우 OS 임시 디렉터리로 떨어뜨린다 — 저장소 경로 해시로 이름을 지어 저장소별로 가른다.
const lockPathFor = root => {
  const gitPath = join(root, '.git')
  if (existsSync(gitPath) && statSync(gitPath).isDirectory()) {
    return join(gitPath, 'web-harness-falsification.lock')
  }
  return join(tmpdir(), `web-harness-falsification-${createHash('sha256').update(root).digest('hex').slice(0, 16)}.lock`)
}
export const LOCK_PATH = lockPathFor(repositoryRoot)

/** 살아 있는 프로세스인가. 죽은 홀더는 사람에게 알리기 위해서만 쓴다. */
const processAlive = pid => {
  try { process.kill(pid, 0); return true } catch (error) { return error.code === 'EPERM' }
}

/**
 * 락을 잡는다. 이미 락이 있으면 **거부한다** — 기다리지도, 회수하지도 않는다.
 *
 * **stale 락을 자동 회수하지 않는 이유(2026-09-10, 교차 모델 리뷰가 두 번 잡은 뒤 결정)**:
 * 회수는 「죽었는지 본다 → 치운다 → 새로 만든다」 세 단계인데 그 사이는 원자가 아니다. 어떻게
 * 짜도 **관찰한 락과 치우는 락이 같은 것이라는 보장**이 없다 — `rm` → `create`는 A가 취득한 뒤
 * B가 A의 살아 있는 락을 지우고, `rename`으로 바꿔도 A가 관찰한 뒤 B가 갈아끼운 **B의 살아 있는
 * 락을** A가 옮겨버린다. 회귀로 그 창을 재현하려 했으나 타이밍 의존이라 반증 등록부가
 * 「결박되지 않은 게이트」로 잡았다.
 *
 * 그래서 자동 회수를 **버린다.** 이 도구의 일은 소스 오염을 막는 것이고, 편의를 위해 그
 * 보장을 흐리지 않는다. 강제 종료로 락이 남으면 사람이 지운다 — 메시지가 pid와 경로를 댄다.
 * @returns {{release: () => void}|{holder: number, alive: boolean}}
 */
export function acquireLock({lockPath = LOCK_PATH} = {}) {
  mkdirSync(dirname(lockPath), {recursive: true})
  try {
    // `wx`는 **원자적**이다 — check-then-write로 하면 동시에 시작한 둘이 모두 통과한다.
    writeFileSync(lockPath, String(process.pid), {flag: 'wx'})
    return {release: () => { try { rmSync(lockPath, {force: true}) } catch { /* 최선 노력 */ } }}
  } catch { /* 이미 있다 — 홀더를 보고 거부한다 */ }
  let holder
  try { holder = Number.parseInt(readFileSync(lockPath, 'utf8').trim(), 10) } catch { holder = Number.NaN }
  return {holder, alive: Number.isFinite(holder) ? processAlive(holder) : false}
}

export const readRegistry = () => JSON.parse(readFileSync(REGISTRY, 'utf8'))

const runTest = testPath => {
  // **`NODE_TEST_CONTEXT`를 물려주지 않는다.** 부모가 `node --test`면 그 변수가 상속되고,
  // 자식 러너는 자기가 테스트 자식인 줄 알고 **실패해도 exit 0**을 낸다(실측 2026-09-10:
  // 같은 실패 테스트가 상속 시 0, 제거 시 1). 그러면 모든 반증이 「게이트가 결박되지 않았다」로
  // 뒤집히거나, 더 나쁘게는 통과로 세어진다 — 반증기 자신이 vacuous가 되는 경로다.
  const env = {...process.env, CI: 'true'}
  delete env.NODE_TEST_CONTEXT
  try {
    execFileSync('node', ['--test', testPath], {cwd: repositoryRoot, stdio: 'pipe', env})
    return 0
  } catch (error) {
    return error.status ?? 1
  }
}

// 한 항목을 반증한다. 원본은 반드시 복원한다 — 실패 경로에서도.
export const falsifyOne = entry => {
  const absolute = join(repositoryRoot, entry.file)
  const original = readFileSync(absolute, 'utf8')
  if (!original.includes(entry.find)) {
    return {id: entry.id, status: 'STALE', reason: `변형 지점을 찾지 못했다: ${entry.find.trim().slice(0, 60)}`}
  }
  if (original.split(entry.find).length - 1 !== 1) {
    return {id: entry.id, status: 'STALE', reason: '변형 지점이 유일하지 않다 — 어느 것을 끄는지 모호하다'}
  }
  try {
    writeFileSync(absolute, original.replace(entry.find, entry.replace))
    const exitCode = runTest(entry.test)
    return exitCode === 0
      ? {id: entry.id, status: 'NOT_FALSIFIED', reason: `게이트를 껐는데 ${entry.test}가 통과했다 — 이 게이트는 회귀에 결박되지 않았다`}
      : {id: entry.id, status: 'OK', reason: ''}
  } finally {
    writeFileSync(absolute, original)
  }
}

export const validateFalsification = ({pass, fail}) => {
  const registry = readRegistry()
  if (!Array.isArray(registry.entries) || registry.entries.length === 0) {
    fail('falsification: 등록부가 비어 있다 — 반증 0건을 통과로 만들지 않는다')
    return
  }
  let ok = 0
  for (const entry of registry.entries) {
    const result = falsifyOne(entry)
    if (result.status === 'OK') { ok++; continue }
    fail(`falsification [${result.id}]: ${result.reason}`)
  }
  if (ok === registry.entries.length) pass(`falsification: ${ok}건 전부 반증됨 — 게이트가 실제로 발화한다`)
}

// main guard: `file://${argv[1]}` 문자열 결합은 POSIX에서만 맞는다 — Windows 경로(D:\…)에서는
// 절대 일치하지 않아 **CLI가 통째로 no-op하고 exit 0**이 된다(조용한 통과). pathToFileURL은
// 두 플랫폼에서 같은 형식을 만든다.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const lock = acquireLock()
  if (lock.holder !== undefined) {
    // **거부한다 — 기다리지 않는다.** 겹치면 소스가 오염되고, 오염된 트리는 다음 판정을
    // 통째로 거짓으로 만든다(2026-09-10 실측).
    process.stderr.write(lock.alive
      ? `반증 러너가 이미 실행 중이다(pid ${lock.holder}) — 겹쳐 돌리면 소스가 오염된다. 끝나기를 기다려라\n`
      : `남은 락이 있다(pid ${lock.holder}는 살아 있지 않다). 자동 회수는 안전하게 만들 수 없어 하지 않는다 — `
        + `다른 러너가 도는지 확인한 뒤 ${LOCK_PATH}를 지워라\n`)
    process.exit(2)
  }
  // 신호를 받으면 락을 놓는다. **다만 동기 `execFileSync` 루프가 스택에 있는 동안에는 이
  // 핸들러가 돌지 못한다** — 정상 종료(`finally`)가 유일하게 믿을 수 있는 해제 경로이고,
  // 강제 종료로 남은 락은 사람이 지운다(자동 회수는 원자로 만들 수 없어 버렸다).
  const release = () => lock.release()
  process.once('SIGINT', () => { release(); process.exit(2) })
  process.once('SIGTERM', () => { release(); process.exit(2) })
  let failed = 0
  try {
    validateFalsification({
      pass: message => process.stdout.write(`✅ ${message}\n`),
      fail: message => { failed++; process.stdout.write(`❌ ${message}\n`) },
    })
  } finally { release() }
  process.exit(failed === 0 ? 0 : 1)
}
