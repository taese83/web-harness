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
// ── 변형은 폐기 가능한 사본에서만 한다 (2026-09-11) ──────────────────────────────
// 종전에는 **정본 파일을 제자리에서** 변형하고 `finally`로 되썼다. 그 구조는 세 번 물렸다:
//   ① 러너 둘이 겹쳐 앞 러너의 변이본이 뒤 러너의 「원본」이 됐고, 복원이 그것을 정본으로
//      굳혔다 — `ticket/cli.mjs`에 `if (false && …)`가 남았고 감사가 CI를 red로 오판정했다
//   ② `finally`는 예외를 덮지만 SIGKILL·앱 종료는 덮지 못한다 — 실제로 앱이 CI 도중 종료됐다
//   ③ 락을 붙였지만 락 파일을 못 만드는 환경(read-only `.git`)에서 없는 락을 `pid NaN`으로 읽었다
// 셋 다 「정본에 쓴다」에서 나온다. 그래서 **정본에 쓰지 않는다** — 작업 트리를 임시 디렉터리로
// 복사하고 거기서 변형·테스트한다. 정본은 읽기만 하며, 실행 전후 트리 digest로 그것을 증명한다.
// 사본 안에서 짝 테스트 606건이 원형 그대로 통과하는 것을 먼저 확인했다(node_modules·.git 불요).
import {execFileSync} from 'node:child_process'
import {copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {createHash} from 'node:crypto'
import {dirname, join, relative, resolve, sep} from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'

// ── 중첩 깊이 ─────────────────────────────────────────────────────────────────
// 러너가 짝 테스트를 돌리고, 락 회귀는 **러너를 스폰한다**. 락 seed(`wx` 제거)가 사본의 러너를
// 변형하면 그 러너는 거부하지 않고 전량을 돌며 **자기 사본(변형 포함)을 다시 복사한다** — 모든
// 층이 변형을 싣고 가므로 끝나지 않는다. 실측(2026-09-11): 53분 동안 약 130층까지 내려갔다.
// 러너가 자식에게 깊이를 물려주고, 깊이 2 이상에서는 **아무것도 하지 않고 거부한다.**
// 깊이 1(락 회귀가 부른 러너)은 평소처럼 락으로 거부해야 하므로 막지 않는다 — 막으면 락 회귀가
// 락이 아니라 깊이 때문에 통과해 seed가 공허해진다.
const DEPTH_VARIABLE = 'WEB_HARNESS_FALSIFICATION_DEPTH'
export const MAX_NESTED_DEPTH = 2
/** 이 깊이의 러너는 아무것도 하지 않고 거부하는가(순수). seed가 이 줄을 겨눈다 — 러너를 스폰하는
 * 테스트로 결박하면 그 seed 자체가 재귀를 일으킬 수 있어서, 스폰 없는 순수 회귀로 잰다. */
export const refusesNestedRun = depth => depth >= MAX_NESTED_DEPTH
const currentDepth = () => {
  const value = Number.parseInt(process.env[DEPTH_VARIABLE] ?? '0', 10)
  return Number.isFinite(value) && value > 0 ? value : 0
}

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(scriptDir, '..', '..')
const REGISTRY = join(scriptDir, 'validators/falsification-registry.json')

// ── 락 ──────────────────────────────────────────────────────────────────────────
// 사본 격리 뒤로 락은 **안전 장치가 아니다** — 겹쳐 돌아도 각자 자기 사본만 쓴다. 남은 역할은
// 같은 일을 두 번 하지 않는 것과, 겹친 출력으로 사람이 헷갈리지 않게 하는 것이다. 그래서 락을
// **만들 수 없는** 환경에서는 막지 않고 진행한다(막으면 read-only 체크아웃에서 CI가 선다).
//
// 후보는 둘이다: `.git/`(디렉터리일 때) → OS 임시 디렉터리. worktree에서는 `.git`이 파일이고,
// read-only 체크아웃에서는 `.git/`에 쓸 수 없다 — 둘 다 임시 디렉터리로 떨어진다.
export const lockPathsFor = root => {
  const fallback = join(tmpdir(), `web-harness-falsification-${createHash('sha256').update(root).digest('hex').slice(0, 16)}.lock`)
  const gitPath = join(root, '.git')
  return existsSync(gitPath) && statSync(gitPath).isDirectory()
    ? [join(gitPath, 'web-harness-falsification.lock'), fallback]
    : [fallback]
}
export const LOCK_PATH = lockPathsFor(repositoryRoot)[0]

/** 살아 있는 프로세스인가. 죽은 홀더는 사람에게 알리기 위해서만 쓴다. */
const processAlive = pid => {
  try { process.kill(pid, 0); return true } catch (error) { return error.code === 'EPERM' }
}

/**
 * 락을 잡는다. 이미 있으면 **거부한다** — 기다리지도, 회수하지도 않는다(회수는 원자로 만들 수
 * 없다: 「죽었는지 본다 → 치운다 → 만든다」 사이에 관찰한 락과 치우는 락이 같다는 보장이 없다).
 *
 * **오류를 가른다(2026-09-11).** 종전에는 `wx` 실패를 전부 「이미 있다」로 읽었고, 권한 오류로
 * 파일을 못 만든 환경에서 **존재하지 않는 락을 `pid NaN`으로 보고해 exit 2**를 냈다. `EEXIST`만
 * 보유 중이고, 그 밖의 오류는 다음 후보로 넘어간다. 후보가 모두 막히면 `{unavailable}`이다.
 * @returns {{release: () => void, lockPath: string}|{holder: number, alive: boolean, lockPath: string}|{unavailable: string[]}}
 */
export function acquireLock({lockPath = null, lockPaths = null} = {}) {
  const candidates = lockPaths ?? (lockPath ? [lockPath] : lockPathsFor(repositoryRoot))
  const reasons = []
  for (const path of candidates) {
    try {
      mkdirSync(dirname(path), {recursive: true})
      // `wx`는 **원자적**이다 — check-then-write로 하면 동시에 시작한 둘이 모두 통과한다.
      writeFileSync(path, String(process.pid), {flag: 'wx'})
      return {lockPath: path, release: () => { try { rmSync(path, {force: true}) } catch { /* 최선 노력 */ } }}
    } catch (error) {
      if (error?.code === 'EEXIST') {
        let holder = Number.NaN
        try { holder = Number.parseInt(readFileSync(path, 'utf8').trim(), 10) } catch { /* 방금 사라졌다 */ }
        return {lockPath: path, holder, alive: Number.isFinite(holder) ? processAlive(holder) : false}
      }
      reasons.push(`${path}: ${error?.code ?? error?.message}`)
    }
  }
  return {unavailable: reasons}
}

export const readRegistry = () => JSON.parse(readFileSync(REGISTRY, 'utf8'))

// ── 사본 ────────────────────────────────────────────────────────────────────────
// `.git`은 **파일이어도** 뺀다 — worktree 체크아웃의 `.git`은 gitdir 포인터이고, 사본에 들어가면
// 사본 안 `git -C`가 정본의 메타데이터를 가리킨다(적대 리뷰 2026-09-11).
const SKIP_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'eval-runs', 'workspace', '.pnpm-store'])

/**
 * 반증이 볼 파일 목록(저장소 기준 상대 경로). git 작업 트리면 **추적 + 무시되지 않은 미추적**을
 * 쓴다 — 커밋 전 변경까지 시험해야 하므로 HEAD가 아니라 작업 트리다. git이 없으면 디렉터리를
 * 걷되 산출물·의존성·`.git`은 뺀다.
 */
export function listSourceFiles(root) {
  try {
    const out = execFileSync('git', ['-C', root, 'ls-files', '-co', '--exclude-standard', '-z'],
      {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024})
    const files = out.split('\0').filter(Boolean).filter(file => existsSync(join(root, file)))
    if (files.length > 0) return files.sort()
  } catch { /* git이 아니거나 없다 — 걷는다 */ }
  const found = []
  const walk = directory => {
    for (const entry of readdirSync(join(root, directory), {withFileTypes: true})) {
      if (entry.isDirectory()) { if (!SKIP_DIRECTORIES.has(entry.name)) walk(join(directory, entry.name)) }
      else if (entry.isFile() && entry.name !== '.git') found.push(join(directory, entry.name).split(sep).join('/'))
    }
  }
  walk('')
  return found.map(file => file.replace(/^\//, '')).sort()
}

/** 파일 목록의 내용 digest(경로 + 내용). 사라진 파일도 digest에 남는다 — 삭제도 변경이다. */
export function treeDigest(root, files) {
  const hash = createHash('sha256')
  for (const file of [...files].sort()) {
    hash.update(`${file}\0`)
    try { hash.update(readFileSync(join(root, file))) } catch { hash.update('<missing>') }
    hash.update('\0')
  }
  return hash.digest('hex')
}

/** 바뀐 파일 이름(보고용). digest가 다를 때만 부른다. */
const changedFiles = (root, files, snapshot) =>
  files.filter(file => {
    let now = null
    try { now = createHash('sha256').update(readFileSync(join(root, file))).digest('hex') } catch { /* 사라짐 */ }
    return now !== snapshot.get(file)
  })

const fileHashes = (root, files) => new Map(files.map(file => {
  try { return [file, createHash('sha256').update(readFileSync(join(root, file))).digest('hex')] } catch { return [file, null] }
}))

/** 작업 트리를 임시 디렉터리로 복사한다. 반환한 경로 **밖에는 아무것도 쓰지 않는다.** */
export function prepareSandbox(root, files) {
  // 이름에 **러너 pid**를 넣는다 — 강제 종료된 러너는 자기 사본을 못 치우는데, 죽인 쪽이 pid로
  // 정확히 그 사본만 지울 수 있게 한다(락 회귀가 거부하지 않는 러너를 SIGKILL할 때 7.6MB씩 남았다).
  const sandbox = mkdtempSync(join(tmpdir(), `web-harness-falsify-${process.pid}-`))
  for (const file of files) {
    const target = join(sandbox, file)
    mkdirSync(dirname(target), {recursive: true})
    copyFileSync(join(root, file), target)
  }
  return sandbox
}

const insideOf = (root, path) => {
  const offset = relative(resolve(root), resolve(path))
  return offset !== '' && !offset.startsWith('..') && !offset.startsWith(sep) && offset !== '..'
}

const runTest = (testPath, cwd) => {
  // **`NODE_TEST_CONTEXT`를 물려주지 않는다.** 부모가 `node --test`면 그 변수가 상속되고,
  // 자식 러너는 자기가 테스트 자식인 줄 알고 **실패해도 exit 0**을 낸다(실측 2026-09-10:
  // 같은 실패 테스트가 상속 시 0, 제거 시 1). 그러면 반증기 자신이 vacuous가 된다.
  const env = {...process.env, CI: 'true', [DEPTH_VARIABLE]: String(currentDepth() + 1)}
  delete env.NODE_TEST_CONTEXT
  // **`CLAUDE_PROJECT_DIR`도 물려주지 않는다.** 정책 lib(`enforce-agent-ownership`·`enforce-ai-safety`·
  // `global-bash-policy-lib` 등)이 이 값을 프로젝트 루트로 쓴다 — 상속하면 사본에서 도는 테스트가
  // **정본을** 루트로 잡는다(적대 리뷰 2026-09-11). CI에는 이 값이 없으므로 지우는 쪽이 CI와 같다.
  delete env.CLAUDE_PROJECT_DIR
  try {
    execFileSync('node', ['--test', testPath], {cwd, stdio: 'pipe', env})
    return 0
  } catch (error) {
    return error.status ?? 1
  }
}

/**
 * 한 항목을 반증한다 — **`root` 안에서만.** `root`는 사본이어야 하고, 기본값(저장소)은 단독
 * 함수 호출의 하위 호환일 뿐이다. 원본은 `finally`에서 되쓰고 **되쓴 것을 확인한다** — 사본이라도
 * 한 항목의 잔재가 다음 항목의 판정을 오염시키면 안 된다.
 */
export const falsifyOne = (entry, {root, run = testPath => runTest(testPath, root)} = {}) => {
  // **`root`는 필수다.** 기본값이 정본이면 「정본에 쓰지 않는다」가 API에서 강제되지 않는다 —
  // 호출자가 root를 빠뜨리는 순간 제자리 변형으로 되돌아간다(적대 리뷰 2026-09-11).
  if (typeof root !== 'string' || root === '') throw new Error('falsifyOne: root(사본 경로)가 필요하다 — 정본을 기본값으로 쓰지 않는다')
  const absolute = join(root, entry.file)
  if (!insideOf(root, absolute)) {
    return {id: entry.id, status: 'STALE', reason: `변형 대상이 작업 공간 밖이다: ${entry.file}`}
  }
  let original
  try { original = readFileSync(absolute, 'utf8') } catch {
    return {id: entry.id, status: 'STALE', reason: `변형 대상이 작업 공간에 없다: ${entry.file}`}
  }
  if (!original.includes(entry.find)) {
    return {id: entry.id, status: 'STALE', reason: `변형 지점을 찾지 못했다: ${entry.find.trim().slice(0, 60)}`}
  }
  if (original.split(entry.find).length - 1 !== 1) {
    return {id: entry.id, status: 'STALE', reason: '변형 지점이 유일하지 않다 — 어느 것을 끄는지 모호하다'}
  }
  let result
  try {
    writeFileSync(absolute, original.replace(entry.find, entry.replace))
    const exitCode = run(entry.test)
    result = exitCode === 0
      ? {id: entry.id, status: 'NOT_FALSIFIED', reason: `게이트를 껐는데 ${entry.test}가 통과했다 — 이 게이트는 회귀에 결박되지 않았다`}
      : {id: entry.id, status: 'OK', reason: ''}
  } finally {
    // 되쓰기 자체가 실패해도(권한·디스크) 여기서 던지지 않는다 — 아래에서 **판정한다**.
    try { writeFileSync(absolute, original) } catch { /* 아래 대조가 잡는다 */ }
  }
  let restored = false
  try { restored = readFileSync(absolute, 'utf8') === original } catch { /* 읽지도 못하면 복원 실패다 */ }
  if (!restored) {
    return {id: entry.id, status: 'RESTORE_FAILED', reason: `${entry.file}를 되쓰지 못했다 — 이후 판정을 믿을 수 없다`}
  }
  return result
}

/**
 * 등록부 전량을 **사본에서** 반증한다. 정본은 읽기만 하고, 실행 전후 digest가 다르면 **운영 오류**로
 * 막는다 — 테스트 실패보다 무거운 사고다(정본이 바뀌었다는 뜻이고, 그 트리의 다음 판정이 거짓이 된다).
 * @returns {{ok: number, total: number, treeChanged: string[]|null}}
 */
export const validateFalsification = ({pass, fail, sourceRoot = repositoryRoot, registry = null,
  run = runTest, onSandbox = null} = {}) => {
  const entries = (registry ?? readRegistry()).entries
  if (!Array.isArray(entries) || entries.length === 0) {
    fail('falsification: 등록부가 비어 있다 — 반증 0건을 통과로 만들지 않는다')
    return {ok: 0, total: 0, treeChanged: null}
  }
  const files = listSourceFiles(sourceRoot)
  const beforeDigest = treeDigest(sourceRoot, files)
  const beforeHashes = fileHashes(sourceRoot, files)
  const sandbox = prepareSandbox(sourceRoot, files)
  onSandbox?.(sandbox)
  let ok = 0
  try {
    // **기준 실행.** 변형 없이 짝 테스트를 먼저 돌린다. 사본은 정본과 환경이 다르다(`.git`·ignored
    // 파일 부재) — 어느 짝 테스트가 사본에서 **원래** 빨가면, 거기 결박된 항목은 변형과 무관하게
    // 「잡혔다」로 세어진다. mutation-sample이 「빨간 스위트 100%」로 물린 바로 그 클래스다(§4).
    // 빨간 파일의 항목은 OK로 세지 않고 NOT_MEASURED로 막는다.
    const red = new Set()
    for (const testPath of [...new Set(entries.map(entry => entry.test))]) {
      if (run(testPath, sandbox) !== 0) red.add(testPath)
    }
    for (const entry of entries) {
      if (red.has(entry.test)) {
        fail(`falsification [${entry.id}]: NOT_MEASURED — 짝 테스트 ${entry.test}가 **변형 없이도** 사본에서 실패한다. `
          + '기준이 빨간 테스트로는 게이트가 발화하는지 잴 수 없다(통과로 세지 않는다)')
        continue
      }
      const result = falsifyOne(entry, {root: sandbox, run: testPath => run(testPath, sandbox)})
      if (result.status === 'OK') { ok++; continue }
      fail(`falsification [${result.id}]: ${result.reason}`)
      // 사본의 한 파일이 되쓰이지 않았으면 정본에서 다시 가져온다 — 다음 항목을 오염시키지 않게.
      // 그것도 못 하면 **남은 항목을 돌리지 않는다** — 오염된 사본 위의 판정은 거짓이다.
      if (result.status === 'RESTORE_FAILED') {
        try { copyFileSync(join(sourceRoot, entry.file), join(sandbox, entry.file)) } catch (error) {
          fail(`falsification: 사본을 복구하지 못해 남은 항목을 중단한다 — ${error.message}`)
          break
        }
      }
    }
  } finally {
    rmSync(sandbox, {recursive: true, force: true})
  }
  const afterDigest = treeDigest(sourceRoot, files)
  // 미리 나열한 파일만 보면 **추가된 파일**을 못 잡는다 — 다시 나열해 집합 차이도 본다
  // (예전 복원 테스트가 정본 추적 디렉터리에 `tmp-falsify-*`를 만들던 것이 정확히 이 경로였다).
  const afterFiles = listSourceFiles(sourceRoot)
  const before = new Set(files)
  const added = afterFiles.filter(file => !before.has(file))
  if (afterDigest !== beforeDigest || added.length > 0) {
    const changed = [...changedFiles(sourceRoot, files, beforeHashes), ...added.map(file => `${file}(추가됨)`)]
    fail(`falsification: **정본 트리가 실행 중 바뀌었다** — ${changed.join(', ') || '(목록 산출 불가)'}. `
      + '반증은 사본에서만 변형하므로 이것은 다른 프로세스의 편집이거나 격리 결함이다. 결과를 믿지 말고 git status를 확인하라')
    return {ok, total: entries.length, treeChanged: changed}
  }
  if (ok === entries.length) pass(`falsification: ${ok}건 전부 반증됨 — 게이트가 실제로 발화한다 (사본 격리 · 정본 digest 불변)`)
  return {ok, total: entries.length, treeChanged: null}
}

// main guard: `file://${argv[1]}` 문자열 결합은 POSIX에서만 맞는다 — Windows 경로(D:\…)에서는
// 절대 일치하지 않아 **CLI가 통째로 no-op하고 exit 0**이 된다(조용한 통과). pathToFileURL은
// 두 플랫폼에서 같은 형식을 만든다.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (refusesNestedRun(currentDepth())) {
    process.stderr.write(`중첩 반증 실행을 거부한다(깊이 ${currentDepth()}) — 반증 안에서 반증을 도는 재귀를 막는다\n`)
    process.exit(2)
  }
  const lock = acquireLock()
  if (lock.holder !== undefined) {
    process.stderr.write(lock.alive
      ? `반증 러너가 이미 실행 중이다(pid ${lock.holder}) — 같은 일을 두 번 하지 않는다. 끝나기를 기다려라\n`
      : `남은 락이 있다(pid ${Number.isFinite(lock.holder) ? lock.holder : '읽을 수 없음'}는 살아 있지 않다). `
        + `자동 회수는 원자로 만들 수 없어 하지 않는다 — 다른 러너가 도는지 확인한 뒤 ${lock.lockPath}를 지워라\n`)
    process.exit(2)
  }
  if (lock.unavailable) {
    // **막지 않는다.** 사본 격리라 겹쳐도 정본은 안전하다 — 락을 못 만든다는 이유로 CI를 세우면
    // read-only 체크아웃에서 반증이 영영 돌지 않는다.
    process.stderr.write(`락을 만들 수 없어 락 없이 진행한다(${lock.unavailable.join(' · ')}) — 사본 격리라 정본은 안전하다\n`)
  }
  const release = () => lock.release?.()
  let sandboxPath = null
  // 강제 종료에도 사본을 치운다(최선 노력) — 정본은 애초에 쓰지 않으므로 여기서 지킬 것은 없다.
  const abort = () => { release(); if (sandboxPath) try { rmSync(sandboxPath, {recursive: true, force: true}) } catch { /* 최선 */ } process.exit(2) }
  process.once('SIGINT', abort)
  process.once('SIGTERM', abort)
  let failed = 0
  let treeChanged = null
  try {
    ({treeChanged} = validateFalsification({
      pass: message => process.stdout.write(`✅ ${message}\n`),
      fail: message => { failed++; process.stdout.write(`❌ ${message}\n`) },
      onSandbox: path => { sandboxPath = path },
    }))
  } finally { release() }
  // 정본이 바뀌었으면 테스트 실패(1)보다 무거운 운영 오류(2)다.
  process.exit(treeChanged ? 2 : failed === 0 ? 0 : 1)
}
