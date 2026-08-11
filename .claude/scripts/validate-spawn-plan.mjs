#!/usr/bin/env node
// validate-spawn-plan.mjs — 스폰 **사전** 적합성 게이트 (GSD plan-time context-fit 착안).
//
// 왜: execution-budget-contract.md의 runaway 예방 규칙 1·2("출력 단위를 계층이 아니라
// 파일/작은 묶음으로 분해한다", "스펙 재독 세금을 오케스트레이터가 흡수한다")는 지금까지
// **오케스트레이터에게 주는 산문**이었다. 산문 규칙은 이 하네스 자신의 분류법으로 자기진술
// 프록시다 — 지키면 지킨 것이고 안 지켜도 아무도 모른다. 그래서 seminar-booking 실증에서
// 빌더 6+회 중 5회가 스펙 재독에 150~190k를 쓰고 산출물 0~부분으로 종료했다.
//
// 이 스크립트는 그 판단을 스폰 **전에** 기계화한다. verify-spawn-completion(사후 완결성)의
// 쌍둥이이며, 입력은 resume-manifest와 **같은 매니페스트 파일**이다 — 하나의 아티팩트가
// 사전(fit) · 사후(remaining) 두 게이트를 먹인다.
//
// 사용법:
//   node .claude/scripts/validate-spawn-plan.mjs --project <root> --plan <manifest.json> [--json]
//   옵션: --max-outputs <n> (기본 8), --max-read-tokens <n> (기본 60000)
//   manifest.json: {"task": "<name>", "outputs": ["rel/a.ts", ...], "reads": ["rel/spec.md", "rel/dir/"],
//                   "readMode": "browse" | "injected"}   // 생략 시 browse(fail-safe)
// 종료 코드: 0 = FITS(스폰 가능), 1 = REFUSE(분할 필요), 2 = 사용법/입력 오류.
//
// reads 항목이 디렉터리면 **파일시스템에서 실제 바이트를 전개**한다 — 목록을 짧게 적어
// 읽기량을 과소 신고하는 우회를 줄인다(디렉터리를 적으면 그 안 전체가 계산된다).
//
// 한계(§4 등록): reads는 여전히 오케스트레이터의 **선언 범위**다. 선언에서 아예 빠뜨린
// 스펙은 계산되지 않고, 빌더가 선언 밖을 읽으면 게이트를 통과하고도 runaway가 난다.
// 토큰 수는 바이트 기반 **추정**이지 토크나이저 실측이 아니다. 그래도 산문 대비
// (a) 선언이 아티팩트로 남고 (b) 디렉터리 전개로 과소 신고가 어려워지고 (c) 사후
// resume-manifest와 같은 파일을 공유해 교차 확인이 가능하다는 점에서 강하다.

import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs'
import {dirname, join, relative, resolve} from 'node:path'

export const DEFAULT_MAX_OUTPUTS = 8
export const DEFAULT_MAX_READ_TOKENS = 60_000

const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'dist', 'coverage'])

// 바이트 → 토큰 추정. ASCII는 ~4 bytes/token, 비-ASCII(한글 UTF-8 3 bytes/char)는 ~3
// bytes/token으로 잡는다. 정확한 토크나이저가 아니다.
//
// 오차 방향은 **미검증 가정**이다(단정 금지). 유일한 교정 데이터에서 이 추정은 162k인데
// 실측 소비는 150~190k였다 — 실측 하단보다는 크고 상단보다는 작다. 게다가 추정은 선언
// 스펙을 **1회 읽은** 바이트인 반면 실측은 40~60회 tool call의 **재독 누적**이라 배수를
// 반영하지 않는다. 즉 "항상 과대추정이라 안전하다"고 말할 근거가 없다 — 재독이 심한
// 스폰에서는 과소추정일 수 있다. 코드/JSON 비중이 높은 스펙의 밀도도 미검증이다.
export function estimateTokens({asciiBytes, wideBytes}) {
  return Math.ceil(asciiBytes / 4 + wideBytes / 3)
}

// 파일 하나의 바이트를 ASCII/비-ASCII로 나눠 센다. 순수(주입된 reader 사용 가능).
export function measureText(text) {
  let asciiBytes = 0
  let wideBytes = 0
  for (const ch of text) {
    const size = Buffer.byteLength(ch, 'utf8')
    if (size === 1) asciiBytes += size
    else wideBytes += size
  }
  return {asciiBytes, wideBytes}
}

// reads 항목(파일 또는 디렉터리)을 실제 파일 목록으로 전개한다.
//
// readMode(2026-08-11 실측 반영): 재구성 실험에서 **같은 계획이 reads 선언 폭에 따라
// 판정이 완전히 뒤집혔다**(좁게 선언 4건 중 1건만 REFUSE / 실제 재독 행동대로 넓게 선언
// 4건 전부 REFUSE). 즉 선언 방식이 게이트 효능을 지배한다. 그래서 "어떻게 읽을 것인가"를
// 명시하게 한다:
//   - 'browse'(기본) — 빌더가 스펙을 직접 읽는다. 실측상 빌더는 한 파일만 읽지 않고 분할
//     설계 트리를 훑으므로, 파일 단위 선언은 **그 파일이 든 디렉터리로 전개**한다.
//   - 'injected' — 오케스트레이터가 발췌를 프롬프트에 주입하고 재독을 금지한다(규칙 2).
//     이때만 좁은 선언이 정직하므로 reads를 문자 그대로 잰다. 이 값은 자기진술이다(§4 등록).
export function expandReads(root, reads, {exists = existsSync, stat = statSync, readdir = readdirSync, readMode = 'browse'} = {}) {
  const files = new Set()
  const missing = []
  const rootResolved = resolve(root)
  const walk = (abs) => {
    let st
    try { st = stat(abs) } catch { return false }
    if (st.isDirectory()) {
      for (const name of readdir(abs)) {
        if (SKIP_DIRS.has(name)) continue
        walk(join(abs, name))
      }
      return true
    }
    if (st.isFile()) { files.add(abs); return true }
    return false
  }
  for (const rel of reads) {
    const abs = resolve(root, rel)
    if (!exists(abs)) { missing.push(rel); continue }
    // browse 모드에서 파일 단위 선언은 담긴 디렉터리로 넓힌다 — 빌더는 형제 파일도 훑는다.
    // 단 프로젝트 루트로는 넓히지 않는다(루트 전체 스캔은 판정을 무의미하게 만든다).
    let target = abs
    if (readMode !== 'injected') {
      let st
      try { st = stat(abs) } catch { st = null }
      if (st && st.isFile()) {
        const parent = dirname(abs)
        if (parent !== rootResolved) target = parent
      }
    }
    walk(target)
  }
  return {files: [...files].sort(), missing}
}

// 계획 적합성 판정 — 순수 코어. verdict: FITS | REFUSE.
export function analyzePlan(root, plan, opts = {}) {
  const maxOutputs = opts.maxOutputs ?? DEFAULT_MAX_OUTPUTS
  const maxReadTokens = opts.maxReadTokens ?? DEFAULT_MAX_READ_TOKENS
  const readFile = opts.readFile ?? (p => readFileSync(p, 'utf8'))

  const outputs = Array.isArray(plan.outputs) ? plan.outputs.filter(o => typeof o === 'string') : []
  const reads = Array.isArray(plan.reads) ? plan.reads.filter(r => typeof r === 'string') : []
  // 미지정/오타는 'browse'로 fail-safe — 느슨한 쪽(injected)으로 기울지 않는다.
  const readMode = plan.readMode === 'injected' ? 'injected' : 'browse'

  const violations = []
  if (outputs.length > maxOutputs) {
    violations.push({
      rule: 'OUTPUT_FANOUT',
      detail: `선언 산출물 ${outputs.length}개 > 임계 ${maxOutputs}개 — 계층 단위 스폰으로 의심된다`,
      remedy: `스폰을 ${Math.ceil(outputs.length / maxOutputs)}개 이상으로 분할하고 각각 --expect로 산출물을 선언한다`,
    })
  }

  const {files, missing} = expandReads(root, reads, {...opts, readMode})
  if (missing.length > 0) {
    violations.push({
      rule: 'READ_MISSING',
      detail: `선언 read 경로가 존재하지 않음: ${missing.join(', ')}`,
      remedy: '계획이 잘못된 경로를 가리킨다 — 경로를 고치거나 선행 스폰을 먼저 완료한다',
    })
  }

  let asciiBytes = 0
  let wideBytes = 0
  const perFile = []
  for (const abs of files) {
    let measured
    try { measured = measureText(readFile(abs)) } catch { continue }
    asciiBytes += measured.asciiBytes
    wideBytes += measured.wideBytes
    perFile.push({file: relative(root, abs), tokens: estimateTokens(measured)})
  }
  const readTokens = estimateTokens({asciiBytes, wideBytes})
  perFile.sort((a, b) => b.tokens - a.tokens)

  if (readTokens > maxReadTokens) {
    violations.push({
      rule: 'READ_BUDGET',
      detail: `선언 read 추정 ${readTokens.toLocaleString()} tokens > 임계 ${maxReadTokens.toLocaleString()} — 빌더가 재독에 예산을 소진할 규모다`,
      remedy: '오케스트레이터가 관련 절만 발췌해 프롬프트에 주입하거나(재독 금지 지시), read 범위를 좁혀 스폰을 분할한다',
    })
  }

  return {
    task: plan.task ?? null,
    readMode,
    outputCount: outputs.length,
    readFileCount: files.length,
    readTokens,
    maxOutputs,
    maxReadTokens,
    largestReads: perFile.slice(0, 5),
    violations,
    verdict: violations.length === 0 ? 'FITS' : 'REFUSE',
  }
}

function parseArgs(argv) {
  const out = {root: null, plan: null, json: false, maxOutputs: DEFAULT_MAX_OUTPUTS, maxReadTokens: DEFAULT_MAX_READ_TOKENS}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--project') { out.root = argv[++i]; continue }
    if (argv[i] === '--plan') { out.plan = argv[++i]; continue }
    if (argv[i] === '--json') { out.json = true; continue }
    if (argv[i] === '--max-outputs') { out.maxOutputs = Number(argv[++i]); continue }
    if (argv[i] === '--max-read-tokens') { out.maxReadTokens = Number(argv[++i]); continue }
  }
  return out
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (!opts.root || !opts.plan) { console.error('사용법: --project <root> --plan <manifest.json> [--json] [--max-outputs n] [--max-read-tokens n]'); process.exit(2) }
  if (!Number.isFinite(opts.maxOutputs) || opts.maxOutputs < 1) { console.error('--max-outputs는 1 이상의 수'); process.exit(2) }
  if (!Number.isFinite(opts.maxReadTokens) || opts.maxReadTokens < 1) { console.error('--max-read-tokens는 1 이상의 수'); process.exit(2) }

  const root = resolve(opts.root)
  const planPath = resolve(root, opts.plan)
  if (!existsSync(root)) { console.error(`root 없음: ${root}`); process.exit(2) }
  if (!existsSync(planPath)) { console.error(`plan 없음: ${planPath}`); process.exit(2) }

  let plan
  try { plan = JSON.parse(readFileSync(planPath, 'utf8')) } catch (error) { console.error(`plan 파싱 실패: ${error.message}`); process.exit(2) }
  const outputs = Array.isArray(plan.outputs) ? plan.outputs.filter(o => typeof o === 'string') : []
  if (outputs.length === 0) { console.error('plan.outputs가 비었거나 문자열 배열이 아님 — 산출물을 선언하지 않은 스폰은 사전 판정할 수 없다'); process.exit(2) }

  const report = analyzePlan(root, plan, {maxOutputs: opts.maxOutputs, maxReadTokens: opts.maxReadTokens})

  if (opts.json) {
    console.log(JSON.stringify({schemaVersion: 1, ...report}, null, 2))
  } else {
    const modeNote = report.readMode === 'injected'
      ? 'injected(발췌 주입·재독 금지 — 자기진술)'
      : 'browse(빌더가 직접 읽음 — 파일 선언은 상위 디렉터리로 전개)'
    console.log(`스폰 계획${report.task ? ` [${report.task}]` : ''}: 산출물 ${report.outputCount}/${report.maxOutputs} · read ${report.readFileCount}개 파일 ≈ ${report.readTokens.toLocaleString()}/${report.maxReadTokens.toLocaleString()} tokens(추정) · readMode=${modeNote}`)
    if (report.largestReads.length > 0) {
      console.log('  가장 큰 read:')
      for (const r of report.largestReads) console.log(`    ${r.tokens.toLocaleString()} tok  ${r.file}`)
    }
    if (report.verdict === 'FITS') {
      console.log('FITS ✅ — 한 스폰에 들어가는 규모. 스폰 진행 가능.')
    } else {
      for (const v of report.violations) {
        console.log(`  ❌ ${v.rule}: ${v.detail}`)
        console.log(`      → ${v.remedy}`)
      }
      console.log('REFUSE ⛔ — 이대로 스폰하면 재독 runaway 위험. 분할·발췌 후 다시 판정할 것.')
    }
  }
  process.exit(report.verdict === 'FITS' ? 0 : 1)
}

if (import.meta.url === `file://${process.argv[1]}`) main()
