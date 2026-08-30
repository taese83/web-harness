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
// GIGO 대응 2종(2026-08-12 — §4의 "owned 전체 스캔 교차검증" TODO 해소분):
//   1. **계획 스팩 확정 검증** — validate-spawn-plan --lock이 스폰 **전에** 찍은 planLock.digest를
//      대조한다. 빌더가 죽은 뒤 매니페스트를 실제 쓰인 파일에 맞춰 줄이는 사후 축소가
//      TAMPERED로 드러난다. 스팩이 없으면 그 사실을 정직하게 보고한다(자기선언 상태).
//   2. **owned 교차검증** — `--owned <prefix...>`를 주면 그 범위의 실제 파일과 선언 목록을
//      대조해 **선언되지 않은 산출물**을 보고한다. 매니페스트가 현실과 어긋났다는 신호다.
//
// 남는 한계(§4): 처음부터 적게 선언한 경우(계획 자체가 과소)는 위 둘 다 잡지 못한다 —
// "무엇이 필요했는가"의 진실은 스펙에 있고 파일시스템에도 digest에도 없다. 계약 몫이다.
//
// 사용법:
//   node .claude/scripts/resume-manifest.mjs --project <root> --manifest <manifest.json> [--json]
//                                            [--owned <prefix> ...]
//   manifest.json 형식: {"task": "<name>", "outputs": ["rel/path/a.ts", ...],
//                        "planLock": {"digest": "...", "at": "..."}}   // --lock이 찍음
// 종료 코드: 0 = remaining 없음(전부 done), 1 = remaining 있음 또는 TAMPERED, 2 = 사용법 오류.

import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs'
import {extname, join, relative, resolve} from 'node:path'
import {specLedgerPath, planDigest, readSpecAt, specDigestOf} from './validate-spawn-plan.mjs'
import {readEvidenceLog} from './evidence-log-lib.mjs'
import {SCANNABLE, scanSource} from './verify-spawn-completion.mjs'
import {pathToFileURL} from 'node:url'

const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'dist', 'coverage', '__tests__'])

// owned prefix에 실재하는 파일 목록(프로젝트 상대경로). 순수.
export function scanOwned(root, prefixes, {stat = statSync, readdir = readdirSync, exists = existsSync} = {}) {
  const files = new Set()
  const walk = (abs) => {
    let st
    try { st = stat(abs) } catch { return }
    if (st.isDirectory()) {
      for (const name of readdir(abs)) {
        if (SKIP_DIRS.has(name)) continue
        walk(join(abs, name))
      }
      return
    }
    if (st.isFile()) files.add(relative(root, abs))
  }
  for (const p of prefixes) { const abs = resolve(root, p); if (exists(abs)) walk(abs) }
  return [...files].sort()
}

// 선언 목록과 owned 실측의 차집합 — 선언되지 않은 산출물. 순수.
export function crossCheckOwned(root, outputs, prefixes, deps) {
  if (!prefixes || prefixes.length === 0) return null
  const declared = new Set(outputs)
  const present = scanOwned(root, prefixes, deps)
  return {present: present.length, undeclared: present.filter(f => !declared.has(f))}
}

// 계획 스팩 확정 검증 — locked | TAMPERED | unlocked. 순수.
//
// 증거 우선순위: **원장(.plan-locks.jsonl) > 매니페스트 내 planLock**. 실측(2026-08-12)에서
// 매니페스트 안에만 두면 두 경로로 뚫렸다 — planLock 삭제(→unlocked, exit 0), 축소 후
// 재확정(→새 digest, exit 0). 원장은 위조 대상 파일 **바깥**에 있어 최초 스팩이 남고,
// 재확정은 두 번째 항목으로 드러난다(relocked 보고). 원장 자체를 지우는 것까지는 막지
// 못한다 — 로컬 증거는 tamper-**evident**이지 tamper-proof가 아니다(§4).
export function verifyPlanLock(manifest, ledgerEntries = null) {
  const actual = planDigest(manifest)
  const entries = Array.isArray(ledgerEntries) ? ledgerEntries.filter(e => e && typeof e.digest === 'string') : []
  const forTask = entries.filter(e => (e.task ?? null) === (manifest.task ?? null))
  const relevant = forTask.length > 0 ? forTask : entries

  if (relevant.length > 0) {
    const first = relevant[0]
    const relocked = relevant.some(e => e.digest !== first.digest)
    if (actual !== first.digest) {
      return {status: 'TAMPERED', source: 'ledger', expected: first.digest, actual, at: first.at ?? null, relocked}
    }
    return {status: 'locked', source: 'ledger', digest: actual, at: first.at ?? null, relocked}
  }

  const lock = manifest.planLock
  if (!lock || typeof lock.digest !== 'string') return {status: 'unlocked'}
  return actual === lock.digest
    ? {status: 'locked', source: 'manifest', digest: actual, at: lock.at ?? null, relocked: false}
    : {status: 'TAMPERED', source: 'manifest', expected: lock.digest, actual, at: lock.at ?? null, relocked: false}
}

// 원장 로드 — 없으면 null(=원장 미사용, "빈 원장"과 구분). 판독은 공유 evidence-log
// (validate-spawn-plan의 writer가 append하는 바로 그 .plan-locks.jsonl — 쓰기/읽기 단일 관용구).
export function readLockLedger(manifestPath, {exists = existsSync} = {}) {
  const path = specLedgerPath(manifestPath)
  if (!exists(path)) return null
  return readEvidenceLog(path)
}

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

// 계획이 세워진 스팩과 **지금** 스팩이 같은가. 증거는 **원장 우선**이다.
//
// 실측(2026-08-30): 매니페스트가 스팩보다 76분 앞서 잠겼고, 나중에 확정된 스팩의 결정
// (OD-001 — 파서를 `lib/parse/` 하위에 둔다)과 계획 경로(`lib/parse-track-string.ts`)가
// 어긋났다. **아무것도 그 어긋남을 보지 않아서** 개발 세션이 사용자에게 "어느 쪽이
// 정본이냐"고 물었다 — 사용자가 답할 근거가 없는 질문이다. 정본은 스팩이고, 여기서 말한다.
//
// **원장을 먼저 읽는 이유**(적대 리뷰 2026-08-30이 잡음): `planDigest`는 `planLock`을 digest
// 대상에서 제외하므로 매니페스트에서 `specDigest` 키 한 줄만 지우면 계획 digest는 그대로고
// 판정만 STALE→UNBOUND(경고)로 강등됐다. planLock을 매니페스트 안에만 두었다가 두 우회로
// 뚫렸던 판례(§4)의 재발이다 — 증거는 위조 대상 바깥에 둔다.
//
// 상태: NO_SPEC(결속도 스팩도 없음) · SPEC_GONE(결속은 있는데 스팩이 없거나 깨졌다 —
//       **fail-closed**) · UNBOUND(결속 자체가 없다, 결속 도입 이전 잠금) · STALE · OK
export function inspectPlanSpecBinding(root, lock, manifestPath = null, spec = undefined) {
  const fromLedger = manifestPath
    ? readEvidenceLog(specLedgerPath(manifestPath))
      .filter(row => typeof row?.specDigest === 'string')
      .at(-1)?.specDigest ?? null
    : null
  const bound = fromLedger ?? (typeof lock?.specDigest === 'string' ? lock.specDigest : null)
  const source = fromLedger ? 'ledger' : (bound ? 'manifest' : null)
  const resolved = spec === undefined ? readSpecAt(root) : spec
  if (!resolved) {
    // 결속 증거가 있는데 스팩이 없다 = 잠금 시점엔 있었다는 뜻이다. 부재로 강등하면
    // STALE에 몰린 세션이 spec.json을 지우거나 한 바이트 깨뜨려 결박을 끌 수 있다
    // (§4 spec-lock 행의 INVALID_SPEC 판례와 같은 클래스).
    return bound ? {state: 'SPEC_GONE', bound, source} : {state: 'NO_SPEC', bound: null, source}
  }
  const current = specDigestOf(resolved)
  if (!bound) return {state: 'UNBOUND', bound, current, source}
  return bound === current ? {state: 'OK', bound, current, source} : {state: 'STALE', bound, current, source}
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
  const out = {root: null, manifest: null, json: false, owned: []}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--project') { out.root = argv[++i]; continue }
    if (argv[i] === '--manifest') { out.manifest = argv[++i]; continue }
    if (argv[i] === '--json') { out.json = true; continue }
    if (argv[i] === '--owned') {
      while (argv[i + 1] && !argv[i + 1].startsWith('--')) out.owned.push(argv[++i])
      continue
    }
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
  const lock = verifyPlanLock(manifest, readLockLedger(manifestPath))
  const cross = crossCheckOwned(root, outputs, opts.owned)
  const specBinding = inspectPlanSpecBinding(root, manifest.planLock, manifestPath)

  if (opts.json) {
    console.log(JSON.stringify({schemaVersion: 1, task: manifest.task ?? null, total: outputs.length, done, truncated: truncated.map(r => ({file: r.file, reasons: r.reasons})), missing, remaining, planLock: lock, specBinding, ownedCrossCheck: cross}, null, 2))
  } else {
    for (const r of truncated) { console.log(`  ⚠️  TRUNCATED ${r.file}`); for (const reason of r.reasons) console.log(`      - ${reason}`) }
    for (const f of missing) console.log(`  ❌ MISSING ${f}`)
    console.log(`\n재개 매니페스트${manifest.task ? ` [${manifest.task}]` : ''}: 전체 ${outputs.length} · done ${done.length} · truncated ${truncated.length} · missing ${missing.length}`)
    if (lock.status === 'TAMPERED') {
      console.log(`  ⛔ TAMPERED — 계획 스팩 확정 불일치(기록 ${lock.expected} ≠ 현재 ${lock.actual})`)
      console.log(`      스폰 전 고정된 계획이 사후에 바뀌었다[${lock.source}]. 축소된 범위로 COMPLETE를 주장하지 말 것.`)
    } else if (lock.status === 'locked') {
      console.log(`  🔒 계획 스팩 확정 확인 ${lock.digest} [${lock.source}]${lock.at ? ` (${lock.at})` : ''}`)
    } else {
      console.log('  ⚠️  계획 스팩 확정 없음 — outputs는 검증되지 않은 자기선언이다(validate-spawn-plan --lock 권장).')
    }
    if (specBinding.state === 'SPEC_GONE') {
      console.log('  ⛔ SPEC_GONE — 이 계획은 스팩 위에서 잠겼는데 지금 그 스팩이 없거나 깨졌다')
      console.log(`      결속 기록 ${specBinding.bound.slice(0, 16)} [${specBinding.source}] · 현재 spec.json 판독 불가`)
      console.log('      스팩 부재로 강등해 통과시키지 않는다 — 스팩을 복구하거나 재확정하라.')
    } else if (specBinding.state === 'STALE') {
      console.log('  ⛔ PLAN_LOCK_SPEC_STALE — 이 계획은 **다른 스팩** 위에서 세워졌다')
      console.log(`      계획이 본 스팩 ${specBinding.bound.slice(0, 16)} [${specBinding.source}] ≠ 현재 스팩 ${specBinding.current.slice(0, 16)}`)
      console.log('      정본은 스팩이다. 계획 경로가 스팩의 layerMap·moduleBoundaries와 어긋나면')
      console.log('      **스팩에 맞춰 새 task 이름으로 재계획**한다 — 어느 쪽이 맞는지 사람에게 묻지 않는다.')
    } else if (specBinding.state === 'UNBOUND' && lock.status === 'locked') {
      console.log('  ⚠️  이 계획에는 스팩 결속이 없다(결속 도입 이전 잠금) — 스팩과 어긋나도 기계가 잡지 못한다.')
      console.log('      스팩을 정본으로 대조하고, 다시 잠글 때 새 task 이름으로 재계획한다.')
    }
    if (cross && cross.undeclared.length > 0) {
      console.log(`  ⚠️  owned 범위에 선언되지 않은 산출물 ${cross.undeclared.length}개 — 매니페스트가 현실과 어긋난다:`)
      for (const f of cross.undeclared.slice(0, 10)) console.log(`      ${f}`)
      if (cross.undeclared.length > 10) console.log(`      … 외 ${cross.undeclared.length - 10}개`)
    }
    if (remaining.length === 0 && lock.status !== 'TAMPERED' && !['STALE', 'SPEC_GONE'].includes(specBinding.state)) console.log('COMPLETE ✅ — 모든 선언 산출물 완결')
    else if (remaining.length === 0 && lock.status === 'TAMPERED') console.log('INVALID ⛔ — 선언분은 완결이나 계획이 변조됐다.')
    else if (remaining.length === 0) console.log('INVALID ⛔ — 선언분은 완결이나 계획의 스팩 결속이 깨졌다.')
    else {
      console.log(`RESUME ⟳ — 남은 ${remaining.length}개만 재스폰(완성분 재작성 금지):`)
      for (const f of remaining) console.log(`    ${f}`)
    }
  }
  // STALE도 fail-closed다 — 낡은 전제 위의 계획을 COMPLETE로 인정하면 스팩이 정본이라는
  // 규율이 이 경로에서만 무너진다.
  // TAMPERED는 remaining이 비어도 실패다(fail-closed) — 축소된 계획의 COMPLETE를 인정하지 않는다.
  process.exit(remaining.length === 0 && lock.status !== 'TAMPERED' && !['STALE', 'SPEC_GONE'].includes(specBinding.state) ? 0 : 1)
}

// main guard: `file://${argv[1]}` 문자열 결합은 POSIX에서만 맞는다 — Windows 경로(D:\…)에서는
// 절대 일치하지 않아 CLI가 통째로 no-op하고 exit 0이 된다(조용한 통과).
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main()
