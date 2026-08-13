#!/usr/bin/env node
// validate-plan-delta.mjs — 기획 변경을 선언과 대조한다 (OpenSpec delta 착안).
//
// 왜: `plan-history-contract.md`는 write-back을 "기존 owner agent의 **경량 재호출** — 전체
// 재작성이 아니라 대상 절/행만 수정"으로 규정한다. 그러나 **그것이 실제로 경량이었는지
// 검증하는 장치가 없었다.** 실측 실패(§4 등록): "apply가 기존 plan 재작성으로 승인 TC 파괴 —
// 존재 검사로는 미탐". 승인된 TC가 조용히 사라져도 사후 존재 검사만으로는 드러나지 않는다.
//
// OpenSpec은 변경을 정본과 **별개 아티팩트**(ADDED/MODIFIED/REMOVED)로 표현해 적용 전에
// 검토하게 한다. 여기서는 그 발상을 이 하네스의 안정 ID 규율에 맞춰 기계화한다:
//
//   1. `--snapshot` — 적용 **전에** 계획 산출물의 안정 ID 인벤토리를 **기계가** 뜬다.
//      사람은 그 위에 `declared: {added, modified, removed}`만 적는다(= delta spec).
//   2. `--verify`  — 적용 **후에** 다시 스캔해 실제 변화와 선언을 대조한다.
//      선언되지 않은 소멸(UNDECLARED_REMOVAL)이 곧 위 실패 클래스다.
//
// before 인벤토리는 자기선언이 아니라 스캔 결과다(design-preview source-snapshot과 같은
// 관용구). 선언 자체는 사람 몫이므로, 이 게이트가 잡는 것은 **선언과 실제의 불일치**이지
// "선언이 옳은가"가 아니다(§4 등록).
//
// 사용법:
//   node .claude/scripts/validate-plan-delta.mjs --project <root> --change <PC-014> --snapshot
//   node .claude/scripts/validate-plan-delta.mjs --project <root> --change <PC-014> --verify [--json]
//   옵션: --allow-no-ids (안정 ID 규율을 쓰지 않는 형태임을 명시 — 자기진술, §4 등록)
// 종료 코드: 0 = 일치, 1 = 불일치, 2 = 사용법/입력 오류.

import {createHash} from 'node:crypto'
import {appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs'
import {join, resolve} from 'node:path'

// before 인벤토리의 digest. 원장과 delta 파일의 대조에 쓴다.
export const inventoryDigest = ids =>
  createHash('sha256').update(JSON.stringify([...ids].sort())).digest('hex').slice(0, 16)

// 안정 ID 규율(plan-history-contract §3)에 정의된 형태만 센다.
export const ID_PATTERN = /\b(?:REQ-[A-Z]+-\d+|FEAT-\d+(?:-\d+)?|TC-\d+-\d+|PAGE-\d+)\b/g

// 계획 산출물에서 안정 ID 집합을 뽑는다. 순수.
export function extractIds(text) {
  return new Set(text.match(ID_PATTERN) ?? [])
}

// 파일 목록 → ID 집합(합집합). files는 [{file, text}]. 순수.
export function inventory(files) {
  const ids = new Set()
  for (const {text} of files) for (const id of extractIds(text)) ids.add(id)
  return [...ids].sort()
}

// before/after와 선언을 대조한다. 순수.
//
// - UNDECLARED_REMOVAL — 사라졌는데 removed에 없다. **등록된 실패 클래스**(승인 TC 파괴).
// - UNDECLARED_ADDITION — 생겼는데 added에 없다. 범위 밖 확장 신호.
// - DECLARED_BUT_PRESENT — removed로 선언했는데 아직 있다.
// - DECLARED_BUT_ABSENT — added/modified로 선언했는데 없다.
export function classifyDelta(before, after, declared = {}) {
  const b = new Set(before)
  const a = new Set(after)
  const dAdd = new Set(declared.added ?? [])
  const dMod = new Set(declared.modified ?? [])
  const dRem = new Set(declared.removed ?? [])

  const disappeared = [...b].filter(id => !a.has(id))
  const appeared = [...a].filter(id => !b.has(id))

  const violations = []
  for (const id of disappeared) {
    if (!dRem.has(id)) violations.push({code: 'UNDECLARED_REMOVAL', id})
  }
  for (const id of appeared) {
    if (!dAdd.has(id)) violations.push({code: 'UNDECLARED_ADDITION', id})
  }
  for (const id of dRem) {
    if (a.has(id)) violations.push({code: 'DECLARED_BUT_PRESENT', id})
  }
  for (const id of [...dAdd, ...dMod]) {
    if (!a.has(id)) violations.push({code: 'DECLARED_BUT_ABSENT', id})
  }
  return {disappeared, appeared, violations}
}

const PLAN_DIR = ['_workspace', '01_plan']
const DELTA_DIR = ['_workspace', '01_plan', 'plan-delta']
const APPROVAL_DIR = ['_workspace', '03_dev', 'change-request-decisions']

// 승인 레코드에 기록된 TC ID — **다른 메커니즘이 다른 시점에** 남긴 독립 기록이다.
// 이것을 before의 바닥값으로 쓰면 "사고 이후에 스냅샷을 떠서 before를 오염시키는" 순서
// 우회가 드러난다(승인된 TC가 before에 없다는 것은 스냅샷이 늦었다는 뜻이다).
export function approvedTestCaseIds(root, {exists = existsSync, readdir = readdirSync, read = readFileSync} = {}) {
  const dir = join(root, ...APPROVAL_DIR)
  if (!exists(dir)) return []
  const ids = new Set()
  for (const name of readdir(dir)) {
    if (!name.endsWith('.json')) continue
    let record
    try { record = JSON.parse(read(join(dir, name), 'utf8')) } catch { continue }
    for (const id of record?.featureLinks?.affectedTestCaseIds ?? []) {
      if (typeof id === 'string') ids.add(id)
    }
  }
  return [...ids].sort()
}

// 무-ID 가드 — I3 실증에서 드러난 vacuous PASS 차단.
// 왜: 이 게이트는 안정 ID의 **소멸**을 본다. ID 규율을 쓰지 않는 서비스 형태(예: 라이브러리
// 프로젝트의 api-design.md)에서는 ID가 0개라 잃을 것이 없고, **계획 문서를 통째로 비워도
// PASS가 난다**(실측). 예약형 SPA 하나만 보고 만들어서 보이지 않던 구멍이다 — I3(형태 2개+)가
// 요구하는 것이 정확히 이런 발견이다.
// 대응은 `verify-spawn-completion`의 무산출 가드와 같은 관용구다: 기본 fail-closed,
// 정당한 형태는 `--allow-no-ids`로 명시 opt-in(자기진술이므로 §4 등록).
export function detectNoStableIds(fileCount, idCount, allowNoIds = false) {
  if (allowNoIds || idCount > 0) return []
  return [{code: 'NO_STABLE_IDS', id: `계획 산출물 ${fileCount}개에서 안정 ID 0개`}]
}

// 스냅샷 원장 — delta 파일 **바깥**의 append-only 기록.
// 왜: delta 파일 하나에만 증거를 두면 **삭제 후 재스냅샷**으로 기준선이 초기화된다. 이 저장소는
// 같은 실패를 resume-manifest의 planLock에서 이미 겪고 원장으로 고쳤다(§4). 같은 해법을 쓴다 —
// 원장이 있으면 최초 스냅샷의 digest가 남아, 지우고 다시 떠도 RESNAPSHOT으로 드러난다.
export const snapshotLedgerPath = deltaDir => join(deltaDir, '.plan-snapshots.jsonl')

export function readSnapshotLedger(deltaDir, {exists = existsSync, read = readFileSync} = {}) {
  const path = snapshotLedgerPath(deltaDir)
  if (!exists(path)) return null
  const out = []
  for (const line of read(path, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try { out.push(JSON.parse(line)) } catch { /* 손상 줄 무시 */ }
  }
  return out
}

// 원장의 **최초** 기록과 현재 before가 다르면 기준선이 갈아치워진 것이다. 순수.
export function detectResnapshot(changeId, beforeDigest, ledgerEntries) {
  const rows = (ledgerEntries ?? []).filter(e => e && e.changeId === changeId && typeof e.beforeDigest === 'string')
  if (rows.length === 0) return []
  if (rows[0].beforeDigest === beforeDigest) return []
  return [{code: 'RESNAPSHOT', id: `${rows[0].beforeDigest}≠${beforeDigest}`}]
}

// 승인된 TC가 before 인벤토리에 없으면 스냅샷이 이미 오염된 상태에서 떠진 것이다. 순수.
export function detectLateSnapshot(before, approvedIds) {
  const b = new Set(before)
  return approvedIds.filter(id => !b.has(id)).map(id => ({code: 'LATE_SNAPSHOT', id}))
}

function readPlanFiles(root) {
  const dir = join(root, ...PLAN_DIR)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(name => name.endsWith('.md'))
    .sort()
    .map(name => ({file: name, text: readFileSync(join(dir, name), 'utf8')}))
}

function parseArgs(argv) {
  const out = {root: null, change: null, mode: null, json: false, allowNoIds: false}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--project') { out.root = argv[++i]; continue }
    if (argv[i] === '--change') { out.change = argv[++i]; continue }
    if (argv[i] === '--snapshot') { out.mode = 'snapshot'; continue }
    if (argv[i] === '--verify') { out.mode = 'verify'; continue }
    if (argv[i] === '--json') { out.json = true; continue }
    if (argv[i] === '--allow-no-ids') { out.allowNoIds = true; continue }
  }
  return out
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (!opts.root || !opts.change || !opts.mode) {
    console.error('사용법: --project <root> --change <PC-NNN> (--snapshot | --verify) [--json]')
    process.exit(2)
  }
  if (!/^PC-\d+$/.test(opts.change)) { console.error('--change는 PC-NNN 형식'); process.exit(2) }
  const root = resolve(opts.root)
  if (!existsSync(root)) { console.error(`root 없음: ${root}`); process.exit(2) }

  const deltaDir = join(root, ...DELTA_DIR)
  const deltaPath = join(deltaDir, `${opts.change}.json`)
  const files = readPlanFiles(root)

  if (opts.mode === 'snapshot') {
    if (existsSync(deltaPath)) { console.error(`이미 존재: ${deltaPath} — 같은 변경 ID로 재스냅샷하지 않는다`); process.exit(2) }
    mkdirSync(deltaDir, {recursive: true})
    const before = inventory(files)
    const digest = inventoryDigest(before)
    // 원장이 이미 이 changeId를 다른 digest로 기록했다면 삭제 후 재스냅샷이다 — 거부한다.
    const priorResnapshot = detectResnapshot(opts.change, digest, readSnapshotLedger(deltaDir))
    if (priorResnapshot.length > 0) {
      console.error(`재스냅샷 거부: ${opts.change}는 원장에 다른 기준선으로 기록돼 있다(${priorResnapshot[0].id}).`)
      console.error('delta 파일을 지워도 원장은 남는다. 범위를 바꾸려면 새 변경 ID로 시작하라.')
      process.exit(2)
    }
    writeFileSync(deltaPath, `${JSON.stringify({
      schemaVersion: 1,
      changeId: opts.change,
      at: new Date().toISOString(),
      before,
      declared: {added: [], modified: [], removed: []},
    }, null, 2)}\n`)
    appendFileSync(snapshotLedgerPath(deltaDir), `${JSON.stringify({changeId: opts.change, at: new Date().toISOString(), beforeDigest: digest, beforeCount: before.length})}\n`)
    const noIds = detectNoStableIds(files.length, before.length, opts.allowNoIds)
    const late = detectLateSnapshot(before, approvedTestCaseIds(root))
    console.log(`스냅샷 기록: ${opts.change} — 계획 산출물 ${files.length}개, 안정 ID ${before.length}개`)
    if (noIds.length > 0) {
      console.log(`  ⚠️  NO_STABLE_IDS — ${noIds[0].id}. 이 프로젝트 형태에는 delta 대조가 적용되지 않는다.`)
      console.log('      --verify는 실패한다. ID 규율을 쓰지 않는 형태가 맞다면 --allow-no-ids로 명시하라.')
    }
    if (late.length > 0) {
      console.log(`  ⚠️  LATE_SNAPSHOT ${late.length}건 — 승인된 TC가 이미 없다: ${late.slice(0, 5).map(v => v.id).join(', ')}`)
      console.log('      변경 전에 스냅샷을 떴어야 한다. 이 상태의 before는 이미 오염됐다.')
    }
    console.log(`  다음: ${deltaPath}의 declared에 added/modified/removed를 적고 변경을 적용한 뒤 --verify`)
    process.exit(0)
  }

  if (!existsSync(deltaPath)) { console.error(`delta 없음: ${deltaPath} — 변경 전에 --snapshot을 먼저 실행한다`); process.exit(2) }
  let delta
  try { delta = JSON.parse(readFileSync(deltaPath, 'utf8')) } catch (error) { console.error(`delta 파싱 실패: ${error.message}`); process.exit(2) }

  const after = inventory(files)
  const {disappeared, appeared, violations} = classifyDelta(delta.before ?? [], after, delta.declared ?? {})
  // 순서 우회 검출 — 승인 레코드(독립 기록)를 before의 바닥값으로 쓴다.
  violations.push(...detectLateSnapshot(delta.before ?? [], approvedTestCaseIds(root)))
  violations.push(...detectResnapshot(opts.change, inventoryDigest(delta.before ?? []), readSnapshotLedger(deltaDir)))
  violations.push(...detectNoStableIds(files.length, Math.max((delta.before ?? []).length, after.length), opts.allowNoIds))

  if (opts.json) {
    console.log(JSON.stringify({schemaVersion: 1, changeId: opts.change, disappeared, appeared, violations}, null, 2))
  } else {
    console.log(`plan delta [${opts.change}]: before ${(delta.before ?? []).length} → after ${after.length} · 소멸 ${disappeared.length} · 신규 ${appeared.length}`)
    for (const v of violations.slice(0, 30)) console.log(`  ❌ ${v.code} ${v.id}`)
    if (violations.length > 30) console.log(`  … 외 ${violations.length - 30}건`)
    if (violations.length === 0) console.log('PASS ✅ — 실제 변화가 선언과 일치한다')
    else {
      console.log(`\nFAIL ❌ — 위반 ${violations.length}건. UNDECLARED_REMOVAL은 승인 산출물이 조용히 사라진 것이고,`)
      console.log('  LATE_SNAPSHOT은 변경 후에 스냅샷을 떠 before를 오염시킨 것이다.')
      console.log('  NO_STABLE_IDS는 이 게이트가 볼 수 있는 것이 없다는 뜻이다 — 통과가 아니라 미적용이다.')
    }
  }
  process.exit(violations.length === 0 ? 0 : 1)
}

if (import.meta.url === `file://${process.argv[1]}`) main()
