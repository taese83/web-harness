#!/usr/bin/env node
// resume-manifest.mjs — 빌더 스폰의 재개 가능성 (GSD planning-state persistence 착안).
//
// 왜: seminar-booking 전 과정 실증에서 복잡한 빌더가 반복 truncate했고, 그때마다 사람이
// 손으로 "이 파일들은 됐으니 나머지만" 재스폰했다. 이 스크립트는 그 판단을 기계화한다 —
// **매니페스트(기대 산출물 목록)를 영속 상태로 두고**, 실제 파일과 대조해 done / truncated
// / missing으로 분류하고 "남은 것(remaining = missing ∪ truncated)"만 돌려준다.
// 오케스트레이터는 remaining으로만 재스폰 프롬프트를 구성한다(전체 재작성 금지 — 완성분을
// 덮어써 오히려 truncate 위험을 키운다). 매니페스트 파일 자체가 GSD의 영속된 빌드 계획이다.
//
// truncation 검출은 verify-spawn-completion.mjs의 scanSource를 재사용한다(단일 출처).
//
// 한계(§4 등록): outputs는 오케스트레이터의 자기선언 목록이다 — 과소 선언(owned 파일을
// 다 안 담음)이면 remaining도 과소평가되어 COMPLETE 오판이 난다(GIGO). outputs는 owned
// prefix 기준으로 성실히 선언해야 하며, owned 전체 스캔과의 교차검증은 미해결 TODO다.
//
// 사용법:
//   node .claude/scripts/resume-manifest.mjs --project <root> --manifest <manifest.json> [--json]
//   manifest.json 형식: {"task": "<name>", "outputs": ["rel/path/a.ts", "rel/path/b.md", ...]}
// 종료 코드: 0 = remaining 없음(전부 done), 1 = remaining 있음(재스폰 필요), 2 = 사용법 오류.

import {existsSync, readFileSync, statSync} from 'node:fs'
import {extname, resolve} from 'node:path'
import {SCANNABLE, scanSource} from './verify-spawn-completion.mjs'

// 단일 산출물 분류 — done | truncated | missing. 순수(파일시스템 read만).
export function classifyOutput(root, rel, {readFile = p => readFileSync(p, 'utf8'), exists = existsSync, stat = statSync} = {}) {
  const abs = resolve(root, rel)
  if (!exists(abs)) return {file: rel, status: 'missing', reasons: ['존재하지 않음']}
  let size
  try { size = stat(abs).size } catch { return {file: rel, status: 'missing', reasons: ['stat 실패']} }
  if (size === 0) return {file: rel, status: 'missing', reasons: ['빈 파일']}
  // 비-code(.md/.json/.yml 등)는 존재+비어있지 않음이면 done(truncation 스캔 대상 아님).
  if (!SCANNABLE.has(extname(abs).toLowerCase())) return {file: rel, status: 'done', reasons: []}
  const reasons = scanSource(readFile(abs))
  return reasons.length > 0 ? {file: rel, status: 'truncated', reasons} : {file: rel, status: 'done', reasons: []}
}

// 매니페스트 outputs 목록을 분류해 done/truncated/missing/remaining으로 나눈다. 순수.
export function computeRemaining(root, outputs, deps) {
  const results = outputs.map(rel => classifyOutput(root, rel, deps))
  const done = results.filter(r => r.status === 'done').map(r => r.file)
  const truncated = results.filter(r => r.status === 'truncated')
  const missing = results.filter(r => r.status === 'missing').map(r => r.file)
  const remaining = [...missing, ...truncated.map(r => r.file)]
  return {results, done, truncated, missing, remaining}
}

function parseArgs(argv) {
  const out = {root: null, manifest: null, json: false}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--project') { out.root = argv[++i]; continue }
    if (argv[i] === '--manifest') { out.manifest = argv[++i]; continue }
    if (argv[i] === '--json') { out.json = true; continue }
  }
  return out
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (!opts.root || !opts.manifest) { console.error('사용법: --project <root> --manifest <manifest.json> [--json]'); process.exit(2) }
  const root = resolve(opts.root)
  const manifestPath = resolve(root, opts.manifest)
  if (!existsSync(root)) { console.error(`root 없음: ${root}`); process.exit(2) }
  if (!existsSync(manifestPath)) { console.error(`manifest 없음: ${manifestPath}`); process.exit(2) }

  let manifest
  try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) } catch (error) { console.error(`manifest 파싱 실패: ${error.message}`); process.exit(2) }
  const outputs = Array.isArray(manifest.outputs) ? manifest.outputs.filter(o => typeof o === 'string') : []
  if (outputs.length === 0) { console.error('manifest.outputs가 비었거나 문자열 배열이 아님'); process.exit(2) }

  const {results, done, truncated, missing, remaining} = computeRemaining(root, outputs)

  if (opts.json) {
    console.log(JSON.stringify({schemaVersion: 1, task: manifest.task ?? null, total: outputs.length, done, truncated: truncated.map(r => ({file: r.file, reasons: r.reasons})), missing, remaining}, null, 2))
  } else {
    for (const r of truncated) { console.log(`  ⚠️  TRUNCATED ${r.file}`); for (const reason of r.reasons) console.log(`      - ${reason}`) }
    for (const f of missing) console.log(`  ❌ MISSING ${f}`)
    console.log(`\n재개 매니페스트${manifest.task ? ` [${manifest.task}]` : ''}: 전체 ${outputs.length} · done ${done.length} · truncated ${truncated.length} · missing ${missing.length}`)
    if (remaining.length === 0) console.log('COMPLETE ✅ — 모든 선언 산출물 완결')
    else {
      console.log(`RESUME ⟳ — 남은 ${remaining.length}개만 재스폰(완성분 재작성 금지):`)
      for (const f of remaining) console.log(`    ${f}`)
    }
  }
  process.exit(remaining.length === 0 ? 0 : 1)
}

if (import.meta.url === `file://${process.argv[1]}`) main()
