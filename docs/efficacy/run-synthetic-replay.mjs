#!/usr/bin/env node
// run-synthetic-replay.mjs — 게이트 pure core 탐지 효능의 결정론 측정 (M2 §4-1c).
//
// 무엇을 측정하나: runaway 방어 게이트의 **탐지 절반**(docs/efficacy/README.md §2) 중
// 단위 테스트(존재하는 실패 형상을 잡는가)가 답하지 못하는 질문 — "얼마나 넓은 변형
// 공간에서, 어떤 비율로 잡는가"를 코퍼스 × 체계적 변형으로 잰다. 라이브 실행 0 토큰.
//
// 정직 한계(I1·I5 — receipt에도 동일 기재):
//   - 합성 recall은 *모델링된* 실패 형상에 대한 것 — 실세계 발생률·결과 효능(ON/OFF)이 아니다.
//   - 코퍼스는 repo 내 .mjs(하니스 자기 코드) — 생성물(TS/TSX 앱 코드)과 스타일이 다르다.
//     생성물 코퍼스(workspace/)는 gitignored라 재현성 있는 receipt에 쓰지 않는다.
//   - analyzePlan 스윕은 임계의 **경계 정밀성** 검증이지 실형상 recall이 아니다 — 실형상
//     증거는 protected-core §4의 재구성 실측(베이스라인 6건 중 OUTPUT_FANOUT 2건, 4건 미탐)
//     이 정본이며 이 측정은 그것을 대체하지 않는다.
//
// 사용: node docs/efficacy/run-synthetic-replay.mjs [--json]
// 결정론: 난수·시각 없음 — 같은 커밋에서 항상 같은 출력.

import {mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, extname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const {analyzePlan, DEFAULT_MAX_OUTPUTS, DEFAULT_MAX_READ_TOKENS} = await import(
  join(repositoryRoot, '.claude/scripts/validate-spawn-plan.mjs')
)
const {scanSource} = await import(join(repositoryRoot, '.claude/scripts/verify-spawn-completion.mjs'))
const {computeRemaining} = await import(join(repositoryRoot, '.claude/scripts/resume-manifest.mjs'))

const jsonOutput = process.argv.includes('--json')

// ── 코퍼스: repo 내 .mjs 전체(재현 가능·결정론). node_modules 제외, 정렬로 순서 고정.
const collectCorpus = (root, out = []) => {
  for (const name of readdirSync(root).sort()) {
    if (name === 'node_modules' || name === '.git') continue
    const path = join(root, name)
    if (statSync(path).isDirectory()) collectCorpus(path, out)
    else if (extname(name) === '.mjs') out.push(path)
  }
  return out
}
const corpus = [
  ...collectCorpus(join(repositoryRoot, '.claude/scripts')),
  ...collectCorpus(join(repositoryRoot, 'packages')),
]

// ── 실험 1: scanSource — 절단 탐지 recall(변형 공간) + 완전 파일 오탐율
// 변형 2모드 × 5지점: byte-cut(문자 인덱스 절단 — 토큰 중간이 흔함)과 line-cut(마지막 개행
// 정렬 — 문장 경계 절단이라 더 어려운 클래스; LLM 절단의 흔한 형태). fraction은 고정 5지점.
const CUT_FRACTIONS = [0.25, 0.5, 0.75, 0.9, 0.99]
const MIN_CORPUS_BYTES = 1024 // 이보다 작은 파일의 절단은 무의미 잡음

const truncationExperiment = () => {
  const eligible = corpus.filter(path => statSync(path).size >= MIN_CORPUS_BYTES)
  const byMode = {
    byteCut: Object.fromEntries(CUT_FRACTIONS.map(f => [f, {caught: 0, total: 0}])),
    lineCut: Object.fromEntries(CUT_FRACTIONS.map(f => [f, {caught: 0, total: 0}])),
  }
  let falsePositives = 0
  const falsePositiveFiles = []
  for (const path of corpus) {
    const text = readFileSync(path, 'utf8')
    if (scanSource(text).length > 0) {
      falsePositives += 1
      falsePositiveFiles.push(path.slice(repositoryRoot.length + 1))
    }
  }
  for (const path of eligible) {
    const text = readFileSync(path, 'utf8')
    for (const fraction of CUT_FRACTIONS) {
      const at = Math.floor(text.length * fraction)
      // byte-cut: 문자 인덱스 그대로 절단
      const byteCut = text.slice(0, at)
      byMode.byteCut[fraction].total += 1
      if (scanSource(byteCut).length > 0) byMode.byteCut[fraction].caught += 1
      // line-cut: 절단점 이전의 마지막 개행까지 — 줄 경계 절단
      const lastNewline = byteCut.lastIndexOf('\n')
      const lineCut = lastNewline > 0 ? text.slice(0, lastNewline) : byteCut
      byMode.lineCut[fraction].total += 1
      if (scanSource(lineCut).length > 0) byMode.lineCut[fraction].caught += 1
    }
  }
  return {
    corpusFiles: corpus.length,
    eligibleFiles: eligible.length,
    falsePositives,
    falsePositiveFiles,
    byMode,
  }
}

// ── 실험 2: analyzePlan — 임계 경계 정밀성 (문서 임계에서 정확히 뒤집히는가)
const boundaryExperiment = () => {
  const root = mkdtempSync(join(tmpdir(), 'replay-plan-'))
  try {
    // 작은 read 파일 하나(토큰 영향 무시 수준)
    writeFileSync(join(root, 'small.md'), 'tiny read\n')
    const outputsSweep = []
    for (let n = 1; n <= DEFAULT_MAX_OUTPUTS * 2; n++) {
      const plan = {
        task: `sweep-${n}`,
        outputs: Array.from({length: n}, (_, i) => `src/out-${i}.ts`),
        reads: ['small.md'],
        readMode: 'injected',
      }
      const {verdict, violations} = analyzePlan(root, plan)
      outputsSweep.push({outputs: n, verdict, rules: violations.map(v => v.rule)})
    }
    // 토큰 경계: ASCII만 쓰면 추정 = bytes/4 (estimateTokens 문서 규칙) — 정확 경계를 겨눈다
    const tokenSweep = []
    for (const tokens of [DEFAULT_MAX_READ_TOKENS - 1, DEFAULT_MAX_READ_TOKENS, DEFAULT_MAX_READ_TOKENS + 1, DEFAULT_MAX_READ_TOKENS * 2]) {
      writeFileSync(join(root, 'big.md'), 'a'.repeat(tokens * 4))
      const plan = {task: `tok-${tokens}`, outputs: ['src/one.ts'], reads: ['big.md'], readMode: 'injected'}
      const {verdict, readTokens} = analyzePlan(root, plan)
      tokenSweep.push({declaredTokens: tokens, measuredTokens: readTokens, verdict})
    }
    // READ_MISSING
    const missingPlan = analyzePlan(root, {task: 'missing', outputs: ['src/one.ts'], reads: ['ghost.md'], readMode: 'injected'})
    return {
      outputsSweep,
      outputsBoundaryExact:
        outputsSweep.every(r => (r.outputs > DEFAULT_MAX_OUTPUTS) === (r.verdict === 'REFUSE')),
      tokenSweep,
      tokenBoundaryExact:
        tokenSweep.every(r => (r.declaredTokens > DEFAULT_MAX_READ_TOKENS) === (r.verdict === 'REFUSE')),
      readMissingRefused: missingPlan.verdict === 'REFUSE' && missingPlan.violations.some(v => v.rule === 'READ_MISSING'),
    }
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
}

// ── 실험 3: computeRemaining — 분류 정확성 배터리 (라벨 있는 결정론 grid)
const classificationExperiment = () => {
  const root = mkdtempSync(join(tmpdir(), 'replay-classify-'))
  try {
    // 라벨 grid: 코퍼스에서 뽑은 실제 완전 파일 + 그 60% 절단본 + 부재 + 빈 파일 + 비-code
    const donor = readFileSync(corpus.find(p => statSync(p).size >= 4096), 'utf8')
    mkdirSync(join(root, 'src'), {recursive: true})
    writeFileSync(join(root, 'src/done.mjs'), donor)
    writeFileSync(join(root, 'src/truncated.mjs'), donor.slice(0, Math.floor(donor.length * 0.6)))
    writeFileSync(join(root, 'src/empty.mjs'), '')
    writeFileSync(join(root, 'notes.md'), '# 비-code 산출물\n')
    const outputs = ['src/done.mjs', 'src/truncated.mjs', 'src/empty.mjs', 'src/missing.mjs', 'notes.md']
    const expected = {
      'src/done.mjs': 'done',
      'src/truncated.mjs': 'truncated',
      'src/empty.mjs': 'missing', // 빈 파일 = missing (스폰이 쓰다 죽음)
      'src/missing.mjs': 'missing',
      'notes.md': 'done', // 비-code는 존재+비어있지 않음이면 done
    }
    const {results, remaining} = computeRemaining(root, outputs)
    const mismatches = results.filter(r => expected[r.file] !== r.status)
    return {
      grid: results.map(r => ({file: r.file, status: r.status, expected: expected[r.file]})),
      allCorrect: mismatches.length === 0,
      remaining,
      remainingCorrect:
        remaining.length === 3 && ['src/truncated.mjs', 'src/empty.mjs', 'src/missing.mjs'].every(f => remaining.includes(f)),
    }
  } finally {
    rmSync(root, {recursive: true, force: true})
  }
}

// ── 실행 + 출력
const truncation = truncationExperiment()
const boundary = boundaryExperiment()
const classification = classificationExperiment()
const report = {truncation, boundary, classification}

if (jsonOutput) {
  console.log(JSON.stringify(report, null, 1))
} else {
  const pct = (caught, total) => (total === 0 ? 'n/a' : `${((caught / total) * 100).toFixed(1)}%`)
  console.log('=== 실험 1 · scanSource 절단 탐지 ===')
  console.log(`코퍼스: ${truncation.corpusFiles}개 .mjs (절단 대상 ${truncation.eligibleFiles}개 ≥${MIN_CORPUS_BYTES}B)`)
  console.log(`완전 파일 오탐: ${truncation.falsePositives}/${truncation.corpusFiles}${truncation.falsePositives > 0 ? ` — ${truncation.falsePositiveFiles.join(', ')}` : ''}`)
  for (const mode of ['byteCut', 'lineCut']) {
    const cells = CUT_FRACTIONS.map(f => {
      const {caught, total} = truncation.byMode[mode][f]
      return `${Math.round(f * 100)}%: ${pct(caught, total)} (${caught}/${total})`
    })
    console.log(`${mode === 'byteCut' ? 'byte-cut' : 'line-cut'} recall — ${cells.join(' · ')}`)
  }
  console.log('\n=== 실험 2 · analyzePlan 경계 정밀성 ===')
  console.log(`OUTPUT_FANOUT 경계(>${DEFAULT_MAX_OUTPUTS}) 정확: ${boundary.outputsBoundaryExact ? 'YES' : 'NO'}`)
  console.log(`READ_BUDGET 경계(>${DEFAULT_MAX_READ_TOKENS.toLocaleString()} tokens) 정확: ${boundary.tokenBoundaryExact ? 'YES' : 'NO'}`)
  for (const r of boundary.tokenSweep) console.log(`  ${r.declaredTokens.toLocaleString()} tokens → ${r.verdict} (측정 ${r.measuredTokens.toLocaleString()})`)
  console.log(`READ_MISSING REFUSE: ${boundary.readMissingRefused ? 'YES' : 'NO'}`)
  console.log('\n=== 실험 3 · computeRemaining 분류 배터리 ===')
  for (const g of classification.grid) console.log(`  ${g.file}: ${g.status}${g.status === g.expected ? ' ✓' : ` ✗ (기대 ${g.expected})`}`)
  console.log(`전체 정확: ${classification.allCorrect ? 'YES' : 'NO'} · remaining 정확: ${classification.remainingCorrect ? 'YES' : 'NO'}`)
}

// 경계·분류가 틀리면 exit 1 — 회귀 감시로도 쓸 수 있게.
const healthy =
  boundary.outputsBoundaryExact && boundary.tokenBoundaryExact && boundary.readMissingRefused &&
  classification.allCorrect && classification.remainingCorrect
process.exit(healthy ? 0 : 1)
