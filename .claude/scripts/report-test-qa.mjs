#!/usr/bin/env node
// report-test-qa.mjs — 품질 실행기 영수증(test·coverage)에서 테스트 QA 판정을 계산해 `_workspace/04_qa/qa-test.md`를 쓰고
// 판정을 기록한다. 영수증을 표로 옮기고 기준을 적용하는 일이라 검증 에이전트가 아니라 스크립트가 한다. 영수증 검증은 릴리스
// 게이트와 같은 함수(receipt-validation-lib)를 써서 게이트와 판정이 갈리지 않는다.
//
// 판정(심한 쪽이 이긴다 — BLOCKED > FAIL > WARN > PASS):
//   - 영수증이 없거나 낡았거나(소스 지문), 소스를 바꿨거나, 테스트 파일·실행 테스트가 0개면 BLOCKED
//   - 명령이 실패했거나 실패한 테스트가 있으면 FAIL
//   - cut되지 않은 Must 기능을 어떤 테스트도 FEAT·TC ID로 인용하지 않으면 BLOCKED(스팩 등급과 무관)
//   - 커버리지(lines)가 70% 미만이거나 수를 읽지 못하면 WARN
//   - 변이 표본은 보고만 한다(막지 않는다). 복원에 실패하면 BLOCKED — 커버리지는 실행만 측정한다. 무엇을 검증하는지는 변이 표본이 잰다
// 브라우저 E2E·상태 시나리오·수집 픽스처는 각자의 보고서(qa-browser·qa-state·qa-data-quality)가 판정한다.
//
// 사용법: node .claude/scripts/report-test-qa.mjs --project <root> [--skip-mutation-sample] [--json]
// 종료 코드: 0 = 보고서 작성(판정과 무관), 2 = 사용법 오류.
import {existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync} from 'node:fs'
import {spawnSync} from 'node:child_process'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {computeSourceFingerprint} from './evidence-lib.mjs'
import {resolveReleaseProfile} from './release-profile-lib.mjs'
import {createReceiptValidationContext, readReceipt} from './receipt-validation-lib.mjs'
import {VERDICT_REPORT_BY_SCRIPT, recordScriptVerdict} from './verdict-record-lib.mjs'

export const REPORT_RELATIVE = '_workspace/04_qa/qa-test.md'
export const COVERAGE_WARN_BELOW = 70
const SEVERITY = ['PASS', 'WARN', 'FAIL', 'BLOCKED']
const worst = statuses => statuses.reduce((a, b) => (SEVERITY.indexOf(b) > SEVERITY.indexOf(a) ? b : a), 'PASS')
const SCRIPTS = dirname(fileURLToPath(import.meta.url))

const readJson = path => { try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return null } }

/** 영수증 하나를 판정한다(순수) — 무결성·최신성 오류는 BLOCKED, 명령 실패는 FAIL. `errors`는 게이트와 같은 readReceipt 결과다. */
export const classifyReceipt = (checkId, raw, errors) => {
  if (!raw) return {checkId, status: 'BLOCKED', raw: null, findings: [`BLOCKED — ${errors[0] ?? `${checkId} 영수증을 읽지 못했다`} (사용자 승인 뒤 품질 실행기 --all로 다시 만든다)`]}
  const findings = []
  const commandFailed = raw.status === 'FAIL' || (raw.status !== 'BLOCKED' && raw.exitCode !== 0)
  if (raw.status === 'BLOCKED') findings.push(`BLOCKED — ${checkId}: 실행기가 막았다: ${raw.blockedReason ?? '사유 없음'} (owner: environment-scaffolder)`)
  if (commandFailed) findings.push(`FAIL — ${checkId}: 명령이 실패했다(exit ${raw.exitCode ?? '없음'}) (owner: developer — 실패 테스트를 읽고 구현·테스트 중 어느 쪽인지 가린다)`)
  for (const error of errors.filter(error => !/: status is |: exit code must be 0$/.test(error))) findings.push(`BLOCKED — ${error}`)
  return {checkId, raw, findings, status: worst(findings.map(finding => finding.split(' ')[0]))}
}

const readReceipts = (projectRoot, fingerprint, lockedProfile) => {
  const context = createReceiptValidationContext(projectRoot)
  return Object.fromEntries(['test', 'coverage'].map(checkId => {
    const errors = []
    const record = readReceipt(projectRoot, checkId, fingerprint, errors, lockedProfile, context)
    return [checkId, {raw: record ? readJson(join(projectRoot, `_workspace/04_qa/evidence/${checkId}.json`)) : null, errors}]
  }))
}

const featurePlanSources = projectRoot => {
  const single = join(projectRoot, '_workspace/01_plan/feature-plan.md')
  const sharded = join(projectRoot, '_workspace/01_plan/feature-plan')
  if (existsSync(sharded) && statSync(sharded).isDirectory()) {
    return readdirSync(sharded).filter(name => name.endsWith('.md')).map(name => readFileSync(join(sharded, name), 'utf8'))
  }
  return existsSync(single) ? [readFileSync(single, 'utf8')] : []
}

/** 기능 표에서 cut되지 않은 Must 기능과 그 TC ID(`features`), 읽은 FEAT 행 수(`rows`). 우선순위 열이 없으면 cut되지 않은 기능 전부다. */
export const mustFeatures = sources => {
  const text = sources.join('\n')
  const features = new Map()
  let header = null
  let rows = 0
  for (const line of text.split('\n')) {
    if (!line.trim().startsWith('|')) { header = null; continue }
    const cells = line.split('|').slice(1, -1).map(cell => cell.trim())
    if (cells[0] === 'ID' || /^feat(ure)? ?id$/i.test(cells[0])) { header = cells; continue }
    if (!/^FEAT-\d+$/.test(cells[0]) || !header) continue
    rows += 1
    const priority = cells[header.findIndex(cell => /^priority$|^우선순위$/i.test(cell))] ?? 'Must'
    const scope = cells[header.findIndex(cell => /^scope$|^범위$/i.test(cell))] ?? ''
    if (!/^must$/i.test(priority) || /^cut$/i.test(scope)) continue
    const number = cells[0].slice('FEAT-'.length)
    const tcIds = [...new Set(text.match(new RegExp(`\\bTC-${number}(?:-\\d+)+\\b`, 'g')) ?? [])]
    features.set(cells[0], tcIds)
  }
  return {features, rows}
}

/** Must 기능마다 그 FEAT·TC ID를 인용한 테스트 파일. */
export const citeMustFeatures = (features, testFiles, readText) => [...features].map(([feat, tcIds]) => {
  const pattern = new RegExp(`\\b(?:${[feat, ...tcIds].map(id => id.replace(/-/g, '\\-')).join('|')})\\b`)
  return {feat, files: testFiles.filter(file => pattern.test(readText(file) ?? ''))}
})

const runMutationSample = projectRoot => {
  const run = spawnSync(process.execPath, [join(SCRIPTS, 'validate-mutation-sample.mjs'), '--project', projectRoot, '--json'],
    {encoding: 'utf8', timeout: 30 * 60_000})
  if (run.status === 2) return {state: 'RESTORE_FAILED', note: String(run.stderr).trim()}
  // 시그널·타임아웃으로 죽으면 복원을 증명하지 못한 것이다 — 변이가 남았을 수 있다.
  if (run.signal || run.error) return {state: 'RESTORE_UNKNOWN', note: `변이 표본이 끝나지 못했다(${run.signal ?? run.error?.message})`}
  try { return JSON.parse(run.stdout) } catch { return {state: 'NOT_MEASURED', note: `변이 표본 출력을 읽지 못했다(exit ${run.status})`} }
}

/** `receipts`는 시험용 주입이다({test: {raw, errors}, coverage: {raw, errors}}) — 없으면 게이트와 같은 검증으로 읽는다. */
export function evaluateTestQa(projectRoot, {mutationSample = true, receipts = null} = {}) {
  const mutation = mutationSample ? runMutationSample(projectRoot) : {state: 'NOT_RUN', note: '--skip-mutation-sample'}
  const profileErrors = []
  let read = receipts
  if (!read) {
    const lockedProfile = resolveReleaseProfile(projectRoot, profileErrors)
    read = readReceipts(projectRoot, computeSourceFingerprint(projectRoot, {excludePaths: lockedProfile?.selection.artifacts.map(artifact => artifact.path) ?? []}), lockedProfile)
  }
  const test = classifyReceipt('test', read.test.raw, read.test.errors)
  const coverage = classifyReceipt('coverage', read.coverage.raw, read.coverage.errors)
  const findings = [...profileErrors.map(error => `BLOCKED — ${error}`), ...test.findings, ...coverage.findings]

  const counts = test.raw?.testSummary ?? null
  if (test.raw && !counts) findings.push('WARN — 통과·실패 수를 러너 출력에서 읽지 못했다(요약 형식을 모른다)')
  if (counts?.failed > 0) findings.push(`FAIL — 실패한 테스트 ${counts.failed}개 (owner: developer)`)
  if (counts && counts.total === 0) findings.push('BLOCKED — 실행된 테스트가 0개다 (owner: developer)')

  const percent = coverage.raw?.coverageSummary ?? null
  let coverageRow = coverage.status
  if (coverage.raw && coverage.status === 'PASS') {
    if (!percent) { coverageRow = 'WARN'; findings.push('WARN — 커버리지 수치를 읽지 못했다(텍스트 요약 표가 없다)') }
    else if (percent.lines < COVERAGE_WARN_BELOW) { coverageRow = 'WARN'; findings.push(`WARN — 커버리지 lines ${percent.lines}% < ${COVERAGE_WARN_BELOW}%`) }
  }

  const planSources = featurePlanSources(projectRoot)
  const {features, rows} = mustFeatures(planSources)
  if (planSources.length > 0 && rows === 0) findings.push('BLOCKED — 기획서(feature-plan)가 있는데 기능 표(ID·Priority·Scope 머리글과 FEAT-NNN 행)를 읽지 못했다 — Must 인용을 판정할 수 없다 (owner: feature-planner)')
  const testFiles = [...new Set([...(test.raw?.discoveredTestFiles ?? []), ...(readJson(join(projectRoot, '_workspace/04_qa/evidence/browser.json'))?.discoveredTestFiles ?? [])])]
  const citations = citeMustFeatures(features, testFiles, file => { try { return readFileSync(join(projectRoot, file), 'utf8') } catch { return null } })
  const uncited = citations.filter(citation => citation.files.length === 0).map(citation => citation.feat)
  if (uncited.length > 0) findings.push(`BLOCKED — Must 기능을 인용한 테스트가 없다: ${uncited.join(', ')} (FEAT·TC ID를 테스트 이름이나 주석에 남긴다 — owner: developer)`)
  if (['RESTORE_FAILED', 'RESTORE_UNKNOWN'].includes(mutation.state)) findings.push(`BLOCKED — 변이 표본이 소스 복원을 증명하지 못했다: ${mutation.note} (git status로 확인한 뒤 품질 실행기를 다시 돌린다)`)

  const status = worst(findings.map(finding => finding.split(' ')[0]))
  return {status, findings, test, coverage: {...coverage, row: coverageRow}, counts, percent, citations, featurePlanFound: features.size > 0, mutation}
}

const commandRow = (checkId, judged, rowStatus = judged.status) => judged.raw
  ? `| ${checkId} | \`${judged.raw.command}\` | ${judged.raw.exitCode ?? '-'} | ${rowStatus} |`
  : `| ${checkId} | (영수증 없음) | - | BLOCKED |`

export function renderTestQa(result) {
  const {counts, percent, mutation} = result
  const lines = ['# Test QA', '', '## Result', result.status, '', '## Commands',
    '| Check | Command | Exit Code | Status |', '|---|---|---:|---|',
    commandRow('test', result.test), commandRow('coverage', result.coverage, result.coverage.row), '',
    '## Summary',
    `- passed: ${counts?.passed ?? '확인 불가'}`, `- failed: ${counts?.failed ?? '확인 불가'}`, `- skipped: ${counts?.skipped ?? '확인 불가'}`,
    `- coverage: ${percent ? `lines ${percent.lines}% · statements ${percent.statements}% · branches ${percent.branches}% · functions ${percent.functions}%` : '확인 불가'}`,
    '', '## Findings', ...(result.findings.length ? result.findings.map(finding => `- ${finding}`) : ['- 없음']),
    '', '## Must 기능 ↔ 테스트']
  if (!result.featurePlanFound) lines.push('- 기획서(feature-plan)에 Must 기능이 없다 — 판정하지 않았다')
  else lines.push('| FEAT | 인용한 테스트 파일 |', '|---|---|', ...result.citations.map(({feat, files}) => `| ${feat} | ${files.join(', ') || '없음'} |`))
  lines.push('', '## 변이 표본',
    mutation.state === 'MEASURED' ? `변이 표본 ${mutation.killed}/${mutation.sampled} (${mutation.score}%) — ${mutation.note}` : `변이 표본: ${mutation.state} — ${mutation.note}`,
    ...(mutation.survivors ?? []).map(item => `- 살아남음 ${item.file} [${item.label}]`),
    '', '## 여기서 판정하지 않는 것',
    '- 브라우저 E2E: `qa-browser.md`(browser 영수증)', '- 상태 시나리오: `qa-state.md`', '- 수집 픽스처·승격: `qa-data-quality.md`',
    '', '_report-test-qa가 영수증에서 계산했다 — 손으로 고치면 판정 기록과 어긋나 릴리스 게이트가 막는다._', '')
  return lines.join('\n')
}

// 직접 실행 판정은 양쪽 실경로로 한다 — 링크가 낀 경로로 불려도 조용히 빠지지 않는다.
const invokedDirectly = () => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)) } catch { return false } }
if (process.argv[1] !== undefined && invokedDirectly()) {
  const argv = process.argv.slice(2).map(arg => (arg === '--project-root' ? '--project' : arg))
  const projectFlag = argv[argv.indexOf('--project') + 1]
  if (!argv.includes('--project') || !projectFlag || !existsSync(projectFlag)) {
    process.stderr.write('사용법: node .claude/scripts/report-test-qa.mjs --project <root> [--skip-mutation-sample] [--json]\n')
    process.exit(2)
  }
  const projectRoot = resolve(projectFlag)
  const result = evaluateTestQa(projectRoot, {mutationSample: !argv.includes('--skip-mutation-sample')})
  const report = renderTestQa(result)
  mkdirSync(join(projectRoot, '_workspace/04_qa'), {recursive: true})
  writeFileSync(join(projectRoot, REPORT_RELATIVE), report)
  recordScriptVerdict(projectRoot, {reportId: VERDICT_REPORT_BY_SCRIPT['report-test-qa'], script: 'report-test-qa', status: result.status, report})
  if (argv.includes('--json')) process.stdout.write(`${JSON.stringify({status: result.status, findings: result.findings, report: REPORT_RELATIVE}, null, 2)}\n`)
  else process.stdout.write(`qa-test: ${result.status} — ${result.findings.length} findings → ${REPORT_RELATIVE}\n`)
  process.exit(0)
}
