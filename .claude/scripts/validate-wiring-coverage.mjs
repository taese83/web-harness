#!/usr/bin/env node
// validate-wiring-coverage.mjs — **배선에 회귀가 있는가.**
//
// 이 저장소가 §4에 세 번 등록한 클래스가 있다: *배선을 시험하는 회귀가 없으면 배선은 조용히
// 끊긴다.* 2026-08-30 하루에만 세 번 물렸다 —
//
//   소유권 훅        중첩 프로젝트의 스팩을 엉뚱한 root에서 읽음(라이브러리 회귀 24건, 훅 0건)
//   claim-scope     판정 함수 셋이 파서가 만든 적 없는 필드를 읽음(순수 함수 회귀 다수, 배선 0건)
//   계획↔스팩 결속   원장에 쓰기만 하고 읽지 않음(순수 회귀 있음, main() 경로 0건)
//
// 공통점은 하나다. **순수 함수에는 회귀가 촘촘한데 그것을 먹이는 자리에는 0건이다.** 순수
// 함수는 테스트가 직접 부르니 살아 있고, `main()`은 아무도 안 부르니 조용히 죽는다.
//
// 그래서 이 검사가 묻는 것은 "테스트가 있는가"가 아니라 **"프로세스로 실행해보는 테스트가
// 있는가"**다. 세 결함 모두 그 테스트 하나면 첫날 잡혔다.
//
// 함께 보는 것: 문서가 실행을 지시하는데 **bash 정책에 등록되지 않은** 명령. 등록이 없으면
// 에이전트 경로에서 `DENY_VALIDATION_COMMAND`로 막히고, 저자는 메인 스레드라 안 보인다
// (같은 날 두 번 실측 — 신설 validator를 등록 없이 문서화했다).
//
// 사용법:
//   node .claude/scripts/validate-wiring-coverage.mjs [--json]
// 종료 코드: 0 = baseline 이내, 1 = 신규 미배선, 2 = 사용법 오류.
import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs'
import {join, relative, resolve} from 'node:path'
import {pathToFileURL} from 'node:url'

const ROOT = resolve(new URL('../..', import.meta.url).pathname)
const SCRIPTS = join(ROOT, '.claude/scripts')
const BASELINE = join(SCRIPTS, 'validators/wiring-coverage-baseline.json')

// `main()` 가드의 세 관용구. 셋 다 "직접 실행될 때만 도는 코드"를 표시한다.
const MAIN_GUARD = /import\.meta\.url === pathToFileURL|invokedDirectly|require\.main === module/

const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'worktrees') continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path, out)
    else if (name.endsWith('.mjs')) out.push(path)
  }
  return out
}

export const isTestFile = path => /(^|\/)test-[\w.-]*\.mjs$/.test(path)

/** `main()` 가드를 가진 스크립트 — 즉 CLI 표면이 있는 것들. */
export function scriptsWithMain(files, read = readFileSync) {
  return files.filter(path => !isTestFile(path) && MAIN_GUARD.test(String(read(path, 'utf8'))))
}

/**
 * 테스트가 **프로세스로 실행하는** 스크립트 집합(순수 함수 import는 세지 않는다).
 * 판정 근거: 테스트 본문에 그 스크립트의 basename이 나오면서 프로세스 실행 호출
 * (`execFileSync`·`spawnSync`·`spawn`·`execFile`)이 같은 파일에 있는가.
 *
 * **프록시(정직)**: 파일 단위 근접성이다 — 한 테스트가 A를 spawn하고 B를 import만 해도
 * 둘 다 배선됨으로 센다. 반대 방향(과소)이 아니라 과대 방향이라, 이 검사가 통과시킨 것이
 * 반드시 안전하지는 않다. 그럼에도 "spawn이 아예 없다"는 신호는 정확하다.
 */
export function processTestedScripts(files, read = readFileSync) {
  const tested = new Set()
  for (const path of files.filter(isTestFile)) {
    const source = String(read(path, 'utf8'))
    if (!/execFileSync|spawnSync|execFile\(|spawn\(/.test(source)) continue
    for (const candidate of files) {
      if (isTestFile(candidate)) continue
      const base = candidate.split('/').pop()
      if (source.includes(base)) tested.add(candidate)
    }
  }
  return tested
}

/** 문서가 `node .claude/scripts/X.mjs`로 실행을 지시하는데 정책에 등록되지 않은 것. */
export function unregisteredCommands(root, {read = readFileSync} = {}) {
  const policyPath = join(root, '.claude/scripts/global-bash-policy-lib.mjs')
  if (!existsSync(policyPath)) return []
  const policy = String(read(policyPath, 'utf8'))
  const docs = []
  const collect = dir => {
    if (!existsSync(dir)) return
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) collect(path)
      else if (name.endsWith('.md')) docs.push(path)
    }
  }
  collect(join(root, '.claude/skills'))
  collect(join(root, 'docs'))
  const named = new Set()
  for (const doc of docs) {
    for (const [, path] of String(read(doc, 'utf8')).matchAll(/node\s+\.claude\/scripts\/([\w./-]+\.mjs)/g)) {
      named.add(path)
    }
  }
  return [...named]
    .filter(path => existsSync(join(root, '.claude/scripts', path)))
    .filter(path => !policy.includes(path.split('/').pop()))
    .sort()
}

export function analyzeWiringCoverage(root = ROOT, {read = readFileSync} = {}) {
  const files = walk(join(root, '.claude/scripts'))
  const mains = scriptsWithMain(files, read)
  const tested = processTestedScripts(files, read)
  const unwired = mains.filter(path => !tested.has(path)).map(path => relative(root, path)).sort()
  return {
    schemaVersion: 1,
    totalWithMain: mains.length,
    processTested: mains.length - unwired.length,
    unwired,
    unregistered: unregisteredCommands(root, {read}),
  }
}

const readBaseline = () => {
  if (!existsSync(BASELINE)) return {unwired: [], unregistered: []}
  try {
    return JSON.parse(readFileSync(BASELINE, 'utf8'))
  } catch {
    return {unwired: [], unregistered: []}
  }
}

/** baseline **밖의 신규**만 실패로 본다 — 기존 부채는 등록해 두고 늘어나는 것을 막는다. */
export function regressionsAgainst(report, baseline) {
  const knownUnwired = new Set(baseline.unwired ?? [])
  const knownUnregistered = new Set(baseline.unregistered ?? [])
  return {
    newUnwired: report.unwired.filter(path => !knownUnwired.has(path)),
    newUnregistered: report.unregistered.filter(path => !knownUnregistered.has(path)),
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = analyzeWiringCoverage()
  const baseline = readBaseline()
  const regressions = regressionsAgainst(report, baseline)
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify({...report, ...regressions}, null, 2)}\n`)
  } else {
    process.stdout.write(`배선 회귀 커버리지: main 가드 ${report.totalWithMain}개 중 프로세스 테스트 ${report.processTested}개\n`)
    if (report.unwired.length > 0) {
      process.stdout.write(`\n프로세스로 실행해보는 테스트가 없는 스크립트 ${report.unwired.length}개:\n`)
      for (const path of report.unwired) {
        process.stdout.write(`  ${baseline.unwired?.includes(path) ? '·' : '❗'} ${path}\n`)
      }
    }
    if (report.unregistered.length > 0) {
      process.stdout.write(`\n문서가 실행을 지시하는데 bash 정책 미등록 ${report.unregistered.length}개:\n`)
      for (const path of report.unregistered) {
        process.stdout.write(`  ${baseline.unregistered?.includes(path) ? '·' : '❗'} ${path}\n`)
      }
    }
    const total = regressions.newUnwired.length + regressions.newUnregistered.length
    process.stdout.write(total === 0
      ? '\nOK — baseline 대비 신규 미배선 없음.\n'
      : `\n신규 ${total}건 ⛔ — 배선 회귀를 붙이거나 정책에 등록하라. baseline 갱신은 의식적 행위다.\n`)
  }
  process.exit(regressions.newUnwired.length + regressions.newUnregistered.length === 0 ? 0 : 1)
}
