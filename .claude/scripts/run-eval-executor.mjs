#!/usr/bin/env node
// Runtime eval executor — eval 계약(scenarios/ai-scenarios)을 실제 실행으로 바꾼다.
//
// 3단 파이프라인 (역할 분리는 harness의 builder/verifier 원칙을 그대로 따른다):
//   1) run    — 격리 fixture에 control plane을 배포(deploy-harness)하고 headless Claude로
//               entrySkill+prompt를 실행한다. transcript는 executor.log로 남는다. (쓰기 가능)
//   2) grade  — 별도 headless Claude가 read-only 도구만으로 fixture를 검사해 result JSON을
//               "본문으로 반환"한다. 저장은 이 스크립트가 한다 (verifier는 Write 없음).
//               grader는 각 assertion의 반증을 먼저 시도하고, 증거 없는 PASS를 금지한다.
//   3) verify — 기계 검증 2중: PASS evidence의 실존 파일 참조 확인(fail-closed) 후
//               기존 run-ai-evals.mjs --verify-result 스키마 검증을 재사용한다.
//
// 사용법:
//   node .claude/scripts/run-eval-executor.mjs --scenario <id> --dry-run   # 실행 명령만 출력 (비용 가드)
//   node .claude/scripts/run-eval-executor.mjs --scenario <id> --run
//   node .claude/scripts/run-eval-executor.mjs --scenario <id> --grade    # 최신 run 채점+검증
//   node .claude/scripts/run-eval-executor.mjs --scenario <id> --full     # run → grade → verify
//   node .claude/scripts/run-eval-executor.mjs --list-runs
// 옵션: --model <model>, --permission-mode <mode>, --timeout-minutes <n>, --claude-bin <path>
//
// run 산출물: eval-runs/<scenario-id>/<run-id>/{fixture/, run.json, executor.log, grader.log, result.json}
// eval-runs/는 VCS 제외 대상이다 (.gitignore).

import {spawnSync} from 'node:child_process'
import {existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(scriptDirectory, '..', '..')
const runsRoot = join(repositoryRoot, 'eval-runs')
const args = process.argv.slice(2)
const valueAfter = option => {
  const index = args.indexOf(option)
  return index === -1 ? undefined : args[index + 1]
}

const claudeBin = valueAfter('--claude-bin') ?? process.env.EVAL_CLAUDE_BIN ?? 'claude'
const model = valueAfter('--model')
const arm = valueAfter('--arm') ?? 'on' // 결과 효능 A/B 암(on|off) — 기본은 평소 동작
if (!['on', 'off'].includes(arm)) {
  console.error(`--arm 은 on|off 만 허용한다(받은 값: ${arm}) — 오타가 조용히 ON으로 떨어지면 암이 오염된다`)
  process.exit(2)
}
const permissionMode = valueAfter('--permission-mode') ?? 'bypassPermissions' // fixture는 격리 디렉터리이며 hook 정책은 permission mode와 무관하게 동작한다
const timeoutMs = Number(valueAfter('--timeout-minutes') ?? 30) * 60_000

// ---------------------------------------------------------------- 시나리오 로드

const loadScenario = id => {
  for (const [catalog, file] of [['ai', 'ai-scenarios.json'], ['web', 'scenarios.json']]) {
    const document = JSON.parse(readFileSync(join(repositoryRoot, '.claude/evals', file), 'utf8'))
    // ai-scenarios.json은 {version, scenarios: []}, scenarios.json은 flat 배열이다 —
    // 객체 형태만 읽으면 web catalog 전체가 조용히 보이지 않는다 (2026-08-03 실제 발생).
    const catalogScenarios = Array.isArray(document) ? document : document.scenarios ?? []
    const scenario = catalogScenarios.find(candidate => candidate.id === id)
    if (scenario) {
      const assertions = scenario.assertions.map((assertion, index) =>
        typeof assertion === 'string'
          ? {id: `a${index + 1}`, type: 'artifact', expected: assertion, evidenceRequired: true}
          : assertion,
      )
      return {catalog, documentVersion: document.version ?? 1, scenario: {...scenario, assertions}}
    }
  }
  console.error(`Unknown scenario: ${id}`)
  process.exit(2)
}

const latestRunDirectory = scenarioId => {
  const base = join(runsRoot, scenarioId)
  if (!existsSync(base)) return undefined
  const runs = readdirSync(base).sort()
  return runs.length ? join(base, runs[runs.length - 1]) : undefined
}

// ---------------------------------------------------------------- 1) run

const runScenario = ({scenario}) => {
  const runId = new Date().toISOString().replace(/[:.]/g, '-')
  const runDirectory = join(runsRoot, scenario.id, runId)
  const fixture = join(runDirectory, 'fixture')
  mkdirSync(fixture, {recursive: true})

  // deploy-harness의 target 재검증은 toolchain preflight(package.json)와 Bash 정책 fixture(README.md 읽기)가
  // 통과하는 실제 프로젝트 형태를 요구한다 — 최소 스캐폴드를 harness pin 그대로 생성
  const harnessPackage = JSON.parse(readFileSync(join(repositoryRoot, 'package.json'), 'utf8'))
  writeFileSync(join(fixture, 'package.json'), JSON.stringify({
    name: `eval-fixture-${scenario.id}`, private: true,
    packageManager: harnessPackage.packageManager, engines: harnessPackage.engines,
  }, null, 2) + '\n')
  writeFileSync(join(fixture, 'README.md'), `# eval fixture — ${scenario.id}\n\n${scenario.entrySkill} 실행용 격리 fixture. run-eval-executor.mjs가 생성.\n`)

  const deploy = spawnSync(process.execPath, [join(scriptDirectory, 'deploy-harness.mjs'), '--target', fixture], {
    cwd: repositoryRoot, encoding: 'utf8', timeout: 180_000,
  })
  if (deploy.status !== 0) {
    console.error('fixture에 control plane 배포 실패:\n' + (deploy.stderr || deploy.stdout))
    process.exit(1)
  }

  // 결과 효능 A/B(M2 Part 2, docs/efficacy/outcome-efficacy-ab-plan.md)의 암 지시문.
  // 게이트 bypass env는 하드 정책이 막으므로(global-bash-policy-lib) 실제 제어점은
  // "오케스트레이터가 게이트를 호출하느냐"다 — 따라서 토글은 실행 지시 변형이다.
  // OFF 암은 **runaway 방어 3게이트만** 끈다. 품질 게이트(run-quality-gates)·소유권 훅은
  // 그대로 둔다 — 이 실험의 종속변수는 스폰 실패율이지 앱 품질이 아니다(계획서 §7).
  const armInstruction = arm === 'off'
    ? '\n\n[A/B 실험 지시 — 이 실행은 게이트 OFF 암이다] 이번 실행에서는 runaway 방어 3게이트를 호출하지 마라: (1) validate-spawn-plan.mjs(fit-gate·계획 잠금) (2) verify-spawn-completion.mjs(완결성 게이트) (3) resume-manifest.mjs(재개 판정). 스폰 계획 매니페스트도 만들지 마라. 그 외 모든 계약(품질 게이트·소유권·receipt·telemetry 기록)은 평소대로 지킨다. execution-telemetry.json의 `run` 라벨 끝에 반드시 `+gatesOff`를 붙여 기록하라.'
    : '\n\n[A/B 실험 지시 — 이 실행은 게이트 ON 암이다] 평소대로 runaway 방어 3게이트를 모두 사용한다. execution-telemetry.json의 `run` 라벨 끝에 반드시 `+gatesOn`을 붙여 기록하라.'

  const prompt = `${scenario.entrySkill} ${scenario.prompt}${armInstruction}`
  const claudeArguments = ['-p', prompt, '--permission-mode', permissionMode]
  if (model) claudeArguments.push('--model', model)

  console.log(`executor 실행: ${scenario.id} (fixture: ${fixture})`)
  const execution = spawnSync(claudeBin, claudeArguments, {cwd: fixture, encoding: 'utf8', timeout: timeoutMs})
  writeFileSync(join(runDirectory, 'executor.log'),
    `# command: ${claudeBin} ${claudeArguments.join(' ')}\n# exit: ${execution.status}\n\n## stdout\n${execution.stdout ?? ''}\n\n## stderr\n${execution.stderr ?? ''}\n`)

  const cliVersion = spawnSync(claudeBin, ['--version'], {encoding: 'utf8'}).stdout?.trim() ?? 'unknown'
  const harnessRev = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {cwd: repositoryRoot, encoding: 'utf8'}).stdout?.trim() ?? 'unknown'
  writeFileSync(join(runDirectory, 'run.json'), JSON.stringify({
    scenarioId: scenario.id, runId, permissionMode, executorExit: execution.status, arm,
    versions: {model: model ?? `session-default (${cliVersion})`, prompt: `catalog-v${loadScenario(scenario.id).documentVersion}/${scenario.id}`, workflow: `harness@${harnessRev}`},
  }, null, 2) + '\n')

  if (execution.status !== 0) console.error(`executor exit ${execution.status} — executor.log 확인. grade는 계속 가능(실패도 채점 대상).`)
  console.log(`run 완료: ${runDirectory}`)
  return runDirectory
}

// ---------------------------------------------------------------- 2) grade

const gradeRun = ({scenario, catalog}, runDirectory) => {
  if (!runDirectory || !existsSync(runDirectory)) {
    console.error(`채점할 run이 없다. 먼저 --run을 실행할 것. (${runDirectory ?? '없음'})`)
    process.exit(2)
  }
  const runMeta = JSON.parse(readFileSync(join(runDirectory, 'run.json'), 'utf8'))
  const graderPrompt = [
    '너는 독립 read-only eval grader다. 아래 scenario의 결과물을 채점하라.',
    '규칙 (fail-closed):',
    '- 각 assertion에 대해 먼저 반증을 시도한다. 반증 근거가 있으면 FAIL.',
    '- PASS는 실존하는 파일 경로 또는 executor.log의 구체 내용을 evidence로 제시할 수 있을 때만.',
    '- 확인할 수단이 없으면 PASS가 아니라 BLOCKED.',
    '- 파일 수정 금지. 검사만 한다.',
    `- 검사 대상: fixture/ (생성된 프로젝트), executor.log (실행 transcript). 현재 디렉터리는 run 디렉터리다.`,
    '',
    `scenario: ${JSON.stringify({id: scenario.id, entrySkill: scenario.entrySkill, prompt: scenario.prompt, assertions: scenario.assertions}, null, 2)}`,
    '',
    '응답은 오직 아래 형태의 JSON 하나만 출력하라 (다른 텍스트 금지):',
    JSON.stringify({scenarioId: scenario.id, status: 'PASS|FAIL|BLOCKED', versions: runMeta.versions,
      assertions: scenario.assertions.map(a => ({id: a.id, status: 'PASS|FAIL|BLOCKED', evidence: ['<실존 경로 또는 executor.log 인용>']}))}, null, 2),
  ].join('\n')

  console.log(`grader 실행: ${scenario.id} (read-only)`)
  const grading = spawnSync(claudeBin, ['-p', graderPrompt, '--allowedTools', 'Read,Glob,Grep'], {cwd: runDirectory, encoding: 'utf8', timeout: timeoutMs})
  writeFileSync(join(runDirectory, 'grader.log'), `# exit: ${grading.status}\n\n## stdout\n${grading.stdout ?? ''}\n\n## stderr\n${grading.stderr ?? ''}\n`)
  if (grading.status !== 0) {
    console.error(`grader exit ${grading.status} — grader.log 확인`)
    process.exit(1)
  }

  const output = grading.stdout ?? ''
  const jsonStart = output.indexOf('{')
  const jsonEnd = output.lastIndexOf('}')
  if (jsonStart === -1 || jsonEnd <= jsonStart) {
    console.error('grader 출력에서 JSON을 찾지 못했다 — grader.log 확인')
    process.exit(1)
  }
  let result
  try {
    result = JSON.parse(output.slice(jsonStart, jsonEnd + 1))
  } catch (error) {
    console.error(`grader JSON 파싱 실패 (${error.message}) — grader.log 확인`)
    process.exit(1)
  }
  result.versions = runMeta.versions // 버전 기록은 run 시점 기계 기록이 정본 — grader가 지어내지 않게 덮어쓴다
  const resultPath = join(runDirectory, 'result.json')
  writeFileSync(resultPath, JSON.stringify(result, null, 2) + '\n')
  console.log(`result 저장: ${resultPath}`)
  return {result, resultPath}
}

// ---------------------------------------------------------------- 3) verify (기계 검증)

const verifyResult = ({scenario, catalog}, runDirectory, result, resultPath) => {
  const errors = []
  // 3-1. PASS evidence의 실존 파일 참조 (fail-closed) — 서술만으로는 PASS 불가
  for (const assertionResult of result.assertions ?? []) {
    if (assertionResult.status !== 'PASS') continue
    const evidences = Array.isArray(assertionResult.evidence) ? assertionResult.evidence : []
    const hasRealPath = evidences.some(item => {
      if (typeof item !== 'string') return false
      const candidates = item.match(/[\w.-]+(?:\/[\w.-]+)+|executor\.log|run\.json/g) ?? []
      return candidates.some(candidate => existsSync(join(runDirectory, candidate)) || existsSync(join(runDirectory, 'fixture', candidate)))
    })
    if (!hasRealPath) errors.push(`${assertionResult.id}: PASS evidence가 실존 파일을 참조하지 않는다 (fail-closed)`)
  }
  if (errors.length) {
    console.error('기계 evidence 검증 실패:')
    for (const error of errors) console.error('- ' + error)
    process.exit(1)
  }
  console.log('기계 evidence 검증 통과 (PASS assertion의 실존 경로 확인)')

  // 3-2. 스키마 검증 — AI catalog는 기존 verifier 재사용, web catalog는 동일 규칙 인라인
  if (catalog === 'ai') {
    const verification = spawnSync(process.execPath, [join(scriptDirectory, 'run-ai-evals.mjs'), '--verify-result', resultPath], {cwd: repositoryRoot, encoding: 'utf8'})
    process.stdout.write(verification.stdout ?? '')
    process.stderr.write(verification.stderr ?? '')
    process.exit(verification.status ?? 1)
  }
  const statuses = new Set(['PASS', 'FAIL', 'BLOCKED'])
  if (!statuses.has(result.status)) errors.push('status must be PASS, FAIL, or BLOCKED')
  for (const assertion of scenario.assertions) {
    const assertionResult = (result.assertions ?? []).find(candidate => candidate.id === assertion.id)
    if (!assertionResult) errors.push(`missing assertion result: ${assertion.id}`)
    else if (assertionResult.status === 'PASS' && !(assertionResult.evidence ?? []).length) errors.push(`${assertion.id}: PASS requires evidence`)
  }
  const allPass = scenario.assertions.every(assertion => (result.assertions ?? []).find(candidate => candidate.id === assertion.id)?.status === 'PASS')
  if (result.status === 'PASS' && !allPass) errors.push('overall PASS requires every assertion to PASS')
  if (errors.length) {
    console.error('web eval result 검증 실패:')
    for (const error of errors) console.error('- ' + error)
    process.exit(1)
  }
  if (result.status !== 'PASS') {
    console.error(`구조는 유효하나 결과가 PASS가 아니다: ${result.status}`)
    process.exit(1)
  }
  console.log(`web eval result 검증 통과: ${scenario.id}`)
}

// ---------------------------------------------------------------- CLI

if (args.includes('--list-runs')) {
  if (!existsSync(runsRoot)) { console.log('(run 없음)'); process.exit(0) }
  for (const scenarioId of readdirSync(runsRoot)) {
    for (const runId of readdirSync(join(runsRoot, scenarioId))) {
      const hasResult = existsSync(join(runsRoot, scenarioId, runId, 'result.json'))
      console.log([scenarioId, runId, hasResult ? 'graded' : 'run-only'].join('\t'))
    }
  }
  process.exit(0)
}

const scenarioId = valueAfter('--scenario')
if (!scenarioId) {
  console.log('Usage: node .claude/scripts/run-eval-executor.mjs --scenario <id> [--dry-run|--run|--grade|--full] [--arm on|off] [--model m] [--permission-mode p] [--timeout-minutes n] [--claude-bin path]')
  console.log('       node .claude/scripts/run-eval-executor.mjs --list-runs')
  process.exit(2)
}
const loaded = loadScenario(scenarioId)

if (args.includes('--dry-run')) {
  console.log(`scenario: ${scenarioId} (${loaded.catalog} catalog, risk: ${loaded.scenario.risk ?? 'n/a'}, assertions: ${loaded.scenario.assertions.length})`)
  console.log(`1) fixture 배포: deploy-harness.mjs --target eval-runs/${scenarioId}/<run-id>/fixture`)
  console.log(`2) executor:     ${claudeBin} -p "${loaded.scenario.entrySkill} ${loaded.scenario.prompt}" --permission-mode ${permissionMode}${model ? ` --model ${model}` : ''}`)
  console.log(`   A/B 암:       ${arm}${arm === 'off' ? ' — runaway 방어 3게이트 미호출 지시가 프롬프트에 추가된다(telemetry run 라벨 +gatesOff)' : ' (평소 동작, telemetry run 라벨 +gatesOn)'}`)
  console.log(`3) grader:       ${claudeBin} -p <grader-prompt> --allowedTools Read,Glob,Grep (read-only)`)
  console.log('주의: executor는 전체 앱 빌드를 수행할 수 있어 수십 분·상당한 토큰이 든다.')
} else if (args.includes('--full')) {
  const runDirectory = runScenario(loaded)
  const {result, resultPath} = gradeRun(loaded, runDirectory)
  verifyResult(loaded, runDirectory, result, resultPath)
} else if (args.includes('--run')) {
  runScenario(loaded)
} else if (args.includes('--grade')) {
  const runDirectory = latestRunDirectory(scenarioId)
  const {result, resultPath} = gradeRun(loaded, runDirectory)
  verifyResult(loaded, runDirectory, result, resultPath)
} else {
  console.error('동작을 지정할 것: --dry-run | --run | --grade | --full')
  process.exit(2)
}
