#!/usr/bin/env node
// run-plugin-evals.mjs — 빌드된 플러그인(dist)을 `claude plugin eval`로 격리 실행하고 receipt를 남긴다.
//
// 저장소 모드 평가(run-eval-executor)는 배포본에서만 생기는 결함(이름공간·경로 치환·플러그인 훅)을 보지 못한다.
// 공식 러너는 실행마다 빈 작업 공간·새 설정에 이 플러그인만 올려 돌리고, 사례별 k회 결과와 비용을 JSON으로 낸다.
// 평가 사례(.claude/evals/plugin/)와 시드(.claude/evals/seeds/)는 배포본 **사본**에 붙여 돌린다 — 사용자에게 가는
// 배포본에는 평가 파일을 싣지 않는다.
//
// 러너 채점기가 보지 못하는 것은 사례의 checks.json이 실행 뒤 작업 공간에서 결정적으로 본다 — source 변경(시드와의
// 해시 대조, 쓴 에이전트와 무관), 티켓 초안 형식(배포본의 초안 검사기 그대로). 실행 중 하네스 스크립트가 돌지 못했으면
// (디스패처 실패) 그 실행은 판정이 아니라 환경 오류다.
//
// 사용법: node .claude/scripts/run-plugin-evals.mjs [--runs <n>] [--case <glob>] [--tag <tag>] [--concurrency <n>] [--max-cost-usd <n>] [--deep <사례,…>] [--keep]
// 평가 직전에 작업 트리로 dist를 다시 빌드한다 — 옛 빌드를 평가하고 새 커밋의 증거로 쓰지 않는다.
// 종료 코드: 0 모든 사례의 모든 실행이 통과(pass^k) · 1 실패한 실행이 있다 · 2 실행이 성립하지 않았다(빌드 실패·사례 없음·
// 실행 수 부족·환경 오류·비용 상한)
import {chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs'
import {spawnSync} from 'node:child_process'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath, pathToFileURL} from 'node:url'
import {traceMetrics} from './eval-trace-metrics.mjs'
import {dispatcherNotOnPath, dispatchMisses, evalSessionPath, plannedRuns, runChecks, runFailureEnvironmentErrors, runRootOf, SMOKE_RUNS, treeDigest, withRuns} from './plugin-eval-checks-lib.mjs'

const REPOSITORY_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const DIST = join(REPOSITORY_ROOT, 'dist/web-harness-plugin')
const CASES = join(REPOSITORY_ROOT, '.claude/evals/plugin')
const SEEDS = join(REPOSITORY_ROOT, '.claude/evals/seeds')
const RECEIPTS = join(REPOSITORY_ROOT, '.claude/evals/receipts/plugin')
const TRACE_ARCHIVE = join(REPOSITORY_ROOT, 'eval-runs/plugin')

const usage = message => {
  process.stderr.write(`${message}\n사용법: run-plugin-evals.mjs [--runs <n>] [--case <glob>] [--tag <tag>] [--concurrency <n>] [--max-cost-usd <n>] [--deep <사례,…>] [--keep]\n`)
  process.exit(2)
}

const options = {concurrency: '3', maxCost: '40', keep: false}
const argv = process.argv.slice(2)
for (let index = 0; index < argv.length; index += 1) {
  const flag = argv[index]
  const value = argv[index + 1]
  if (flag === '--keep') { options.keep = true; continue }
  if (!['--runs', '--case', '--tag', '--concurrency', '--max-cost-usd', '--deep'].includes(flag) || value === undefined) usage(`알 수 없는 인자: ${flag}`)
  options[{'--runs': 'runs', '--case': 'case', '--tag': 'tag', '--concurrency': 'concurrency', '--max-cost-usd': 'maxCost', '--deep': 'deep'}[flag]] = value
  index += 1
}

// 릴리스 실행 계획 — 전체 실행에서만 쓴다(선택 실행은 이미 부분 측정이다). 3회로 돌 사례와 그 사유는 릴리스 커밋에 적는다.
const deep = options.deep ? options.deep.split(',').map(name => name.trim()).filter(Boolean) : null
if (deep) {
  if (options.case || options.tag || options.runs) usage('--deep은 --case·--tag·--runs 없이 전체 실행에서만 쓴다')
  const known = new Set(readdirSync(CASES, {withFileTypes: true}).filter(entry => entry.isDirectory()).map(entry => entry.name))
  const unknown = deep.filter(name => !known.has(name))
  if (unknown.length) usage(`--deep에 없는 사례: ${unknown.join(', ')}`)
}

// 평가할 배포본을 지금 트리로 빌드한다(stale dist 차단). 판본 문자열만 대조하면 같은 판본의 옛 빌드를 평가할 수 있다.
const build = spawnSync(process.execPath, [join(REPOSITORY_ROOT, '.claude/scripts/build-plugin.mjs')], {cwd: REPOSITORY_ROOT, encoding: 'utf8'})
if (build.status !== 0) usage(`플러그인 빌드 실패 — ${String(build.stderr || build.stdout).trim().split('\n').slice(-3).join(' | ')}`)
const builtVersion = JSON.parse(readFileSync(join(DIST, '.claude-plugin/plugin.json'), 'utf8')).version

const git = args => String(spawnSync('git', args, {cwd: REPOSITORY_ROOT, encoding: 'utf8'}).stdout ?? '').trim()

// 사례별 기대 실행 수 — 러너가 이보다 적게 돌렸으면 pass^k가 아니다.
const declaredRuns = name => Number(readFileSync(join(CASES, name, 'prompt.md'), 'utf8').match(/^runs:\s*(\d+)\s*$/m)?.[1] ?? 3)
const expectedRuns = name => (options.runs ? Number(options.runs) : plannedRuns(declaredRuns(name), deep, name))
const caseChecks = name => {
  const path = join(CASES, name, 'checks.json')
  const declared = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {}
  return {seed: declared.seed ?? null, checks: declared.checks ?? []}
}

const work = mkdtempSync(join(tmpdir(), 'wh-plugin-eval-'))
const plugin = join(work, 'web-harness')
cpSync(DIST, plugin, {recursive: true})
cpSync(CASES, join(plugin, 'evals'), {recursive: true})
cpSync(SEEDS, join(plugin, 'evals', 'seeds'), {recursive: true})
if (deep) {
  for (const name of readdirSync(CASES, {withFileTypes: true}).filter(entry => entry.isDirectory()).map(entry => entry.name)) {
    if (deep.includes(name)) continue
    const promptPath = join(plugin, 'evals', name, 'prompt.md')
    writeFileSync(promptPath, withRuns(readFileSync(promptPath, 'utf8'), SMOKE_RUNS))
  }
}
const resultPath = join(work, 'result.json')

const PATH = evalSessionPath(plugin, process.env.PATH)
const args = ['plugin', 'eval', plugin, '--ablation', 'none', '--trust-plugin', '--scaffold', '--keep-temp',
  '--allow-tools', 'Bash', 'Write', 'Edit', '--json', resultPath, '--concurrency', options.concurrency, '--max-cost-usd', options.maxCost]
if (options.runs) args.push('--runs', options.runs)
if (options.case) args.push('--case', options.case)
if (options.tag) args.push('--tag', options.tag)
process.stdout.write(`claude ${args.join(' ')}\n`)
const run = spawnSync('claude', args, {stdio: 'inherit', env: {...process.env, PATH}})
if (!existsSync(resultPath)) {
  process.stderr.write(`결과 JSON이 없다(claude 종료 ${run.status}) — 사본: ${work}\n`)
  process.exit(2)
}

const result = JSON.parse(readFileSync(resultPath, 'utf8'))
if (!Array.isArray(result.cases) || result.cases.length === 0) {
  rmSync(work, {recursive: true, force: true})
  usage('선택된 사례가 없다 — --case/--tag가 아무것도 고르지 않았다')
}

// 러너가 남긴 실행 디렉터리(`<tmp>/e-*`)만 연다·지운다(plugin-eval-checks-lib runRootOf).
const tmpRoots = [realpathSync(tmpdir()), '/private/tmp', '/tmp'].filter(existsSync).map(path => realpathSync(path))
const openRunRoot = root => {
  try { chmodSync(root, 0o700); if (existsSync(join(root, 'sealed'))) chmodSync(join(root, 'sealed'), 0o700) } catch { /* 열지 못하면 사후 검사가 실패로 드러난다 */ }
}
// 초안 검사는 배포본의 검사기 그대로 한다 — 평가하는 판본과 같은 규칙이다.
const draftValidator = await import(pathToFileURL(join(plugin, '.claude/scripts/ticket/ticket-create.mjs')).href)

let model = null
const runRoots = new Set()
const archive = join(TRACE_ARCHIVE, String(result.startedAt).replace(/[:.]/g, '-'))
const cases = result.cases.map(testCase => {
  const checks = caseChecks(testCase.name)
  const runs = (testCase.arms?.with ?? []).map((armRun, index) => {
    const root = runRootOf(armRun.tracePath, tmpRoots)
    if (root) { runRoots.add(root); openRunRoot(root) }
    let trace = null
    try { trace = readFileSync(armRun.tracePath, 'utf8') } catch { /* 트레이스 없음 — 지표를 비운다 */ }
    if (trace) {
      mkdirSync(archive, {recursive: true})
      writeFileSync(join(archive, `${testCase.name}-${index + 1}.jsonl`), trace)
      const init = trace.split(/\r?\n/).find(line => line.includes('"subtype":"init"'))
      try { model ??= init ? JSON.parse(init).model ?? null : null } catch { /* 모델 미상 */ }
    }
    const missed = dispatchMisses(trace, join(DIST, '.claude/scripts'))
    const environmentErrors = [...missed.map(name => `배포본에 있는 스크립트 ${name}를 디스패처가 찾지 못했다 — 이 실행은 플러그인 판정이 아니다`),
      ...runFailureEnvironmentErrors(armRun.error), ...dispatcherNotOnPath(trace, join(DIST, 'bin'))]
    const checkProblems = runChecks(checks.checks, {workspace: root ? join(root, 'sealed', 'home', 'cwd') : null,
      seedSource: checks.seed ? join(SEEDS, checks.seed, 'src') : null, draftValidator})
    const gradersPassed = armRun.passed === true
    return {
      passed: gradersPassed && checkProblems.length === 0 && environmentErrors.length === 0,
      gradersPassed,
      score: armRun.score,
      error: armRun.error ?? null,
      failedGraders: (armRun.graders ?? []).filter(grader => grader.passed === false)
        .map(grader => ({name: grader.name, explanation: String(grader.explanation ?? '').slice(0, 600)})),
      checkProblems,
      environmentErrors,
      costUsd: armRun.costUsd,
      durationSeconds: armRun.durationSeconds,
      ...(trace ? traceMetrics(trace) : {turns: armRun.turns ?? null}),
    }
  })
  const expected = expectedRuns(testCase.name)
  return {
    name: testCase.name,
    // 사례를 고치면 옛 receipt의 수치가 새 사례의 결과로 읽히지 않게, 잰 판본을 묶는다.
    caseDigest: treeDigest(join(CASES, testCase.name)),
    seedDigest: checks.seed ? treeDigest(join(SEEDS, checks.seed)) : null,
    expectedRuns: expected,
    passAll: runs.length === expected && runs.every(entry => entry.passed),
    incomplete: runs.length !== expected,
    environmentInvalid: runs.some(entry => entry.environmentErrors.length > 0),
    runs,
  }
})

const receipt = {
  kind: 'plugin-eval-receipt',
  schemaVersion: 4,
  harnessCommit: git(['rev-parse', 'HEAD']),
  dirty: git(['status', '--porcelain', '--', '.claude']) !== '',
  pluginVersion: builtVersion,
  distDigest: treeDigest(DIST),
  claudeVersion: result.claudeVersion,
  model,
  startedAt: result.startedAt,
  durationSeconds: result.durationSeconds,
  costUsd: result.costUsd,
  partial: result.partial === true,
  selection: {case: options.case ?? null, tag: options.tag ?? null, runs: options.runs ?? null},
  runPlan: deep ? {deep, smokeRuns: SMOKE_RUNS} : null,
  cases,
}
mkdirSync(RECEIPTS, {recursive: true})
const receiptPath = join(RECEIPTS, `${String(result.startedAt).replace(/[:.]/g, '-')}.json`)
writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`)

for (const testCase of cases) {
  const label = testCase.environmentInvalid ? 'ENV!' : testCase.incomplete ? 'SHORT' : testCase.passAll ? 'PASS' : 'FAIL'
  process.stdout.write(`${label}  ${testCase.name}  (${testCase.runs.filter(entry => entry.passed).length}/${testCase.expectedRuns})\n`)
  for (const entry of testCase.runs) {
    const failed = [...entry.failedGraders.map(grader => grader.name), ...entry.checkProblems, ...entry.environmentErrors]
    process.stdout.write(`      turns ${entry.turns} · peak ${entry.peakContextTokens ?? '?'} tok · $${Number(entry.costUsd ?? 0).toFixed(2)} · Bash ${entry.toolUses?.Bash ?? 0}(오류 ${entry.bashErrors ?? 0}) · script-source reads ${entry.scriptSourceReads ?? '?'}${failed.length ? ` · failed: ${failed.join(' | ')}` : ''}\n`)
  }
}
process.stdout.write(`receipt: ${receiptPath}${receipt.dirty ? ' (작업 트리가 커밋과 다르다 — 릴리스 증거로 쓰지 않는다)' : ''}\n트레이스: ${archive}\n총 비용 $${Number(result.costUsd ?? 0).toFixed(2)}${receipt.partial ? ' (partial — 비용 상한 또는 중단)' : ''}\n`)

if (!options.keep) {
  for (const root of runRoots) rmSync(root, {recursive: true, force: true})
  rmSync(work, {recursive: true, force: true})
}
const unusable = receipt.partial || cases.some(testCase => testCase.incomplete || testCase.environmentInvalid)
process.exit(unusable ? 2 : cases.every(testCase => testCase.passAll) ? 0 : 1)
