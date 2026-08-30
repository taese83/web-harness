#!/usr/bin/env node
// 팀 워크플로우 통합 — executor CLI (증분 5). team-flow 스킬이 호출하는 실행부 글루.
// 순수 코어(emit/claim-scope/assign/pickup/pr/route)와 gh/git 실행부·원장 writer를 엮는다.
//
// 실행 환경(정직 경계): **플러그인 배포판 전용**이다 — 하네스 저장소 자체 세션은 global bash
// policy가 gh/git·미등재 스크립트를 차단하며, **등재하지 않기로 결정**했다(repo 안전 정책
// 비약화 — 2026-08-24, da6e375 공시의 재검토 결론). repo-내에서는 순수 미리보기까지만.
//
// side-effect 규율: 쓰기(이슈 생성·self-assign·원장 append·change-scope 작성)는 전부
// `--confirm` 없이는 실행하지 않는다(미리보기만) — 스킬의 사람 확인 게이트가 --confirm을 단다.
import {existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync} from 'node:fs'
import {basename, dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {computeBatchClaimPlan, formatBatchClaimPreview} from './batch-claim.mjs'
import {computeClaimEligibility, claimEligibilityGuidance} from './claim-guard.mjs'
import {resolveOriginPlanSync, resolveCurrentBranch, resolveWorktreeStatus, refreshRemoteRefs} from './git-origin.mjs'
import {evaluatePickupReadiness} from './sync-guard.mjs'
import {claimFeature} from './runner.mjs'
import {pickupWithOwnership} from './assign.mjs'
import {isChangeScopeStale} from './pickup.mjs'
import {evaluateTicketCompletion} from './completion.mjs'
import {computeCloseLink, computePrLinkPlan} from './pr.mjs'
import {renderCloseReference, parseBranchFromLabels} from './provider-github.mjs'
import {createGithubProvider, resolveIssue, resolveViewerPermission, resolveMergedFeatures, runGh, assignArgs, issueSupersedeCloseArgs} from './provider-github-exec.mjs'
import {readLedger, readLedgerState, appendLedgerRecord, appendClaimRecord, appendSupersedeRecord} from './ledger-writer.mjs'
import {parseFeaturePlanUnits} from './plan-units.mjs'

export const LEDGER_RELATIVE = '_workspace/03_dev/identity-ledger.jsonl'
export const CHANGE_SCOPE_RELATIVE = '_workspace/03_dev/change-scope.md'
export const PLAN_RELATIVE = '_workspace/01_plan/feature-plan.md'
export const PLAN_DIR_RELATIVE = '_workspace/01_plan/feature-plan'

/** argv → {command, positional, flags} (--k v | --k=v | --flag). */
export function parseArgs(argv) {
  const [command, ...rest] = argv
  const positional = []
  const flags = {}
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]
    if (!arg.startsWith('--')) { positional.push(arg); continue }
    const eq = arg.indexOf('=')
    if (eq >= 0) { flags[arg.slice(2, eq)] = arg.slice(eq + 1); continue }
    const next = rest[i + 1]
    if (next != null && !next.startsWith('--')) { flags[arg.slice(2)] = next; i++ }
    else flags[arg.slice(2)] = true
  }
  return {command: command ?? null, positional, flags}
}

// 티켓 이슈 자동 닫기 자산 — 청구 브랜치에 설치한다.
//
// GitHub의 `Closes #N`은 **기본 브랜치 머지에서만** 발동한다. 팀 흐름은 청구 브랜치에 모아
// 통합하므로 그 머지에서는 안 닫힌다. 그런데 하네스의 완료 판정(claim-scope 의존 해제·board
// merged)은 이미 "청구 브랜치 머지 = 완료"다 — 보드는 완료라는데 이슈는 열린 채 남는다.
// 이 워크플로우가 그 간극을 메운다.
const ASSETS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'skills', 'team-flow', 'assets')
export const TICKET_CLOSE_ASSETS = [
  {asset: 'ticket-close.yml', target: '.github/workflows/ticket-close.yml'},
  {asset: 'close-merged-tickets.mjs', target: '.github/scripts/close-merged-tickets.mjs'},
]

/** 설치 계획(순수 판정 + 파일 존재 조회). **덮어쓰지 않는다** — 프로젝트가 손본 사본을
 * 조용히 되돌리면 안 된다. 자산 자체가 없으면(배포 형태 차이) 그 사실을 그대로 알린다. */
export function planTicketCloseInstall(root, {assetsRoot = ASSETS_ROOT} = {}) {
  const install = []
  const present = []
  const missingAssets = []
  for (const entry of TICKET_CLOSE_ASSETS) {
    const source = join(assetsRoot, entry.asset)
    if (!existsSync(source)) { missingAssets.push(entry.asset); continue }
    if (existsSync(join(root, entry.target))) present.push(entry.target)
    else install.push({...entry, source})
  }
  return {install, present, missingAssets}
}

/** 계획대로 쓴다(멱등 — install 목록에만 쓴다). */
export function installTicketCloseAssets(root, plan) {
  const written = []
  for (const entry of plan.install) {
    const target = join(root, entry.target)
    mkdirSync(dirname(target), {recursive: true})
    writeFileSync(target, readFileSync(entry.source, 'utf8'))
    written.push(entry.target)
  }
  return written
}

/** feature-plan의 위치를 해석한다 — sharding 계약상 **flat(.md) 또는 디렉터리** 두 형태다.
 *
 * 종전에는 flat만 찾아 sharded 프로젝트에서 두 곳이 함께 무너졌다: loadUnits가
 * MISSING_PLAN을 던지고, origin 동기 게이트는 같은 경로를 못 찾아 "푸시하세요"라는
 * **오탐 안내**를 냈다(실제로는 푸시돼 있고 origin과 동일했다 — 사용자 실측 보고).
 * 콘솔 인덱서는 이미 두 형태를 다루므로 채널 간 답이 갈리고 있었다.
 *
 * 반환 relative는 git 인자로 그대로 쓴다 — `cat-file -e <base>:<dir>`는 tree 객체로,
 * `diff --quiet <base> -- <dir>`는 경로 필터로 동작한다(디렉터리 실측 확인).
 * @returns {{kind: 'flat'|'sharded', relative: string, shards: string[]}|null}
 */
export function resolvePlanLocation(root) {
  const flat = join(root, PLAN_RELATIVE)
  if (existsSync(flat)) return {kind: 'flat', relative: PLAN_RELATIVE, shards: [PLAN_RELATIVE]}
  const dir = join(root, PLAN_DIR_RELATIVE)
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return null
  // 파일명 정렬로 결정적 순서를 준다. 순서는 unit 배열 순서에만 영향하고 unit 내용에는
  // 영향하지 않는다(contentHash는 섹션 원문에서 나온다).
  const shards = readdirSync(dir).filter(name => name.endsWith('.md')).sort()
    .map(name => `${PLAN_DIR_RELATIVE}/${name}`)
  return shards.length > 0 ? {kind: 'sharded', relative: PLAN_DIR_RELATIVE, shards} : null
}

/** units 로드 — --units <json파일> 우선, 없으면 로컬 feature-plan 파싱(flat·sharded 모두).
 * 샤드는 파서 계약대로 **각각 파싱해 이어붙인다**(plan-units 문서: "분할 계획이면 caller가
 * 샤드들을 이 함수에 각각 돌리고 이어붙인다"). 같은 FEAT가 두 샤드에 있으면 병합하지 않고
 * 두 unit으로 남겨 하류 DUPLICATE_FEATURE_ID loud 가드가 상류 결함을 드러내게 한다.
 *
 * 표 형식 계획은 0 unit이 나온다 — **기존 청구가 있으면** EMPTY_UNITS_CLOSE_ALL 가드가
 * 잡지만, 신규(빈 원장) 첫 claim은 "발행 0" 미리보기가 유일한 방어다(정직 — 미리보기
 * 확인이 그래서 게이트다). */
export function loadUnits(root, flags) {
  if (flags.units) {
    const parsed = JSON.parse(readFileSync(flags.units, 'utf8'))
    if (!Array.isArray(parsed)) throw new Error('INVALID_UNITS: units는 배열이어야 합니다')
    return parsed
  }
  const location = resolvePlanLocation(root)
  if (!location) throw new Error(`MISSING_PLAN: ${PLAN_RELATIVE} 또는 ${PLAN_DIR_RELATIVE}/ 없음(--units로 지정 가능)`)
  return location.shards.flatMap(relative => parseFeaturePlanUnits(readFileSync(join(root, relative), 'utf8')))
}

// 계획 본문(flat·sharded)과 소스에서 인용된 TC ID — 완료 조건 판정의 입력.
function loadPlanText(root, flags) {
  // `--units`는 기계 입력이지만 **본문(body)을 담고 있다** — 유예 마커는 거기서 읽는다.
  // 이전 판은 여기서 `''`를 반환해 units 경로가 **구조적으로 항상 차단**됐고, 그러자 회귀
  // 테스트마다 `--accept-incomplete`가 뿌려졌다(2026-08-30 리뷰 HIGH). 게이트가 골든 경로를
  // 막으면 고칠 것은 게이트가 아니라 모델링이다.
  if (flags?.units) {
    try {
      const parsed = JSON.parse(readFileSync(flags.units, 'utf8'))
      return Array.isArray(parsed) ? parsed.map(unit => String(unit?.body ?? '')).join('\n') : ''
    } catch { return '' }
  }
  const flat = join(root, PLAN_RELATIVE)
  if (existsSync(flat)) return readFileSync(flat, 'utf8')
  const dir = join(root, PLAN_DIR_RELATIVE)
  if (!existsSync(dir)) return ''
  return readdirSync(dir).filter(name => name.endsWith('.md')).sort()
    .map(name => readFileSync(join(dir, name), 'utf8')).join('\n')
}

// 소스 트리에서 인용된 TC ID. `_workspace`는 계획 문서라 제외한다 — 계획이 자기를 인용하는
// 것을 "검증됐다"로 세면 판정이 공허해진다.
function collectCitedTestCaseIds(root, dir = root, found = new Set(), depth = 0) {
  if (depth > 8) return [...found]
  let entries
  try { entries = readdirSync(dir, {withFileTypes: true}) } catch { return [...found] }
  for (const entry of entries) {
    if (['node_modules', '.git', 'dist', '_workspace', 'coverage', 'playwright-report'].includes(entry.name)) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) collectCitedTestCaseIds(root, path, found, depth + 1)
    else if (/\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|svelte|vue|astro)$/.test(entry.name)) {
      try {
        for (const id of readFileSync(path, 'utf8').match(/\bTC-\d+-\d+\b/g) ?? []) found.add(id)
      } catch { /* 읽기 실패는 미인용으로 둔다 — 지어내지 않는다 */ }
    }
  }
  return [...found]
}

// change-scope.md — 사람용 헤더 + 기계용 fenced JSON(재읽기·STALE 대조의 정본).
export function writeChangeScopeFile(root, changeScope) {
  const path = join(root, CHANGE_SCOPE_RELATIVE)
  mkdirSync(dirname(path), {recursive: true})
  const body = [
    `# change-scope — ${changeScope.featureId}`,
    '',
    `티켓 ${changeScope.ticketKey ?? '(미상)'} 픽업으로 발급. ALLOWED_PATHS는 확인 후 확정(needsConfirmation).`,
    '스키마 정본: minimal-change-contract.md · 아래 JSON이 기계 정본(STALE 대조 입력).',
    '',
    '```json change-scope',
    JSON.stringify(changeScope, null, 2),
    '```',
    '',
  ].join('\n')
  writeFileSync(path, body)
  return path
}

export function readChangeScopeFile(root) {
  const path = join(root, CHANGE_SCOPE_RELATIVE)
  if (!existsSync(path)) return null
  const match = readFileSync(path, 'utf8').match(/```json change-scope\n([\s\S]*?)\n```/)
  if (!match) return null
  try { return JSON.parse(match[1]) } catch { return null }
}

/**
 * claim: 일괄 청구. 게이트 순서 — (1) origin 동기(점 1, fail-closed) → (2) batch 미리보기
 * (충돌·순환이면 발행 안 함) → (3) --confirm일 때만 순서대로 발행+원장(청구는 rebind 가드).
 * 주입(io)은 테스트용 — 기본 실 gh/git/원장.
 */
/** origin 판정 전 remote-tracking을 갱신한다. 실패해도 막지 않고 **스냅샷 기준임을 표기**한다
 * — git-origin의 "선행하거나 표기하거나" 경고 중 둘 다 하는 쪽이다. `--no-fetch`로 끌 수 있다
 * (네트워크 없는 환경·테스트). 결과는 각 모드 응답의 `freshness`로 나간다. */
async function ensureRemoteFreshness({root, flags, io}) {
  if (flags?.['no-fetch']) return {fetched: false, basis: 'local-snapshot', reason: 'disabled by --no-fetch'}
  const result = await (io.refresh ?? refreshRemoteRefs)({repoRoot: root})
  return result.ok
    ? {fetched: true, basis: 'origin'}
    : {fetched: false, basis: 'local-snapshot', reason: result.reason}
}

export async function runClaim({root, repo, flags, io = {}}) {
  const units = loadUnits(root, flags)
  const branch = flags.branch ?? await (io.currentBranch ?? resolveCurrentBranch)({repoRoot: root})
  if (!branch) throw new Error('NO_BRANCH: 현재 브랜치를 알 수 없습니다(detached?) — --branch로 지정')
  // 점 1: 청구는 origin 푸시분에만(fail-closed)
  // 게이트가 보는 경로도 해석 결과를 따른다 — flat만 보면 sharded 계획에서 오탐이 난다.
  const planPath = resolvePlanLocation(root)?.relative ?? PLAN_RELATIVE
  // origin 판정 전 remote-tracking 갱신 — 안 하면 낡은 스냅샷 위에서 "origin과 같다"를 본다.
  const freshness = await ensureRemoteFreshness({root, flags, io})
  const sync = await (io.originSync ?? resolveOriginPlanSync)({repoRoot: root, planPath})
  const eligibility = computeClaimEligibility(sync)
  if (!eligibility.eligible) {
    return {ok: false, blocked: eligibility.reason, guidance: claimEligibilityGuidance(eligibility.reason), freshness}
  }
  const ledgerFile = join(root, LEDGER_RELATIVE)
  const state = (io.readState ?? readLedgerState)(ledgerFile)
  const plan = computeBatchClaimPlan({units, ledgerState: state, opts: {foundationRoots: splitList(flags['foundation-roots'])}, branch})
  const preview = formatBatchClaimPreview(plan)
  if (plan.collisions.length > 0 || plan.cycles.length > 0) {
    return {ok: false, blocked: 'plan-defects', preview, guidance: '경로 충돌/순환 의존을 feature-planner에서 해소한 뒤 청구하세요'}
  }
  const closeAssets = planTicketCloseInstall(root)
  if (!flags.confirm) return {ok: true, dryRun: true, preview, freshness, closeAssets}
  // 발행(순서대로) — provider(라벨 pre-create 포함) + 원장(청구는 rebind 가드 append)
  const provider = io.provider ?? createGithubProvider({repo})
  const permission = await (io.permission ?? resolveViewerPermission)({repo})
  const unitById = new Map(units.map(unit => [unit.featureId, unit]))
  const results = []
  for (const item of plan.claim) {
    const outcome = await claimFeature({
      unit: unitById.get(item.featureId),
      provider,
      ledger: {
        find: featureId => (io.readState ?? readLedgerState)(ledgerFile).get(featureId) ?? null,
        append: record => (io.appendClaim ?? appendClaimRecord)(ledgerFile, record),
      },
      assignee: flags.assignee ?? null,
      branch,
      permission,
      repo,
    })
    results.push({featureId: item.featureId, ...outcome})
    if (outcome.blocked) break // 권한 차단은 반복 시도 무의미 — 첫 차단에서 멈추고 안내
  }
  // 부분 차단은 성공이 아니다(리뷰: exit 2 기계 신호 정렬) — 발행/차단 내역은 results에 그대로.
  const blockedAt = results.find(result => result.blocked)
  if (blockedAt) return {ok: false, blocked: `claim-blocked:${blockedAt.reason}`, guidance: blockedAt.guidance, dryRun: false, preview, results}
  // 대체 발행: 계획이 바뀐 FEAT는 **옛 티켓을 고쳐 쓰지 않고** 새로 낸 뒤 옛 것을 닫는다.
  // 이미 발행된 티켓의 본문을 바꾸면 그것을 읽고 작업 중인 개발자 밑에서 계약이 조용히
  // 바뀐다. 원장은 `supersedes`로 무엇을 무엇이 대체했는지 남긴다(append-only).
  const superseded = []
  for (const item of plan.supersede ?? []) {
    const fields = buildIssueFields(item.payload, {branch, assignee: flags.assignee ?? null})
    const issue = await provider.createIssue(fields)
    ;(io.appendSupersede ?? appendSupersedeRecord)(ledgerFile, {
      featureId: item.featureId,
      ticketKey: issue.ticketKey,
      contentHash: item.contentHash,
      createdAt: new Date().toISOString(),
      branch,
      supersedes: item.priorTicketKey,
    })
    // 옛 티켓은 **완료가 아니라 superseded**로 닫는다 — 닫힘을 완료로 오독하면 보드가 거짓이 된다.
    await (io.gh ?? runGh)(issueSupersedeCloseArgs(repo, item.priorTicketKey, issue.ticketKey))
    superseded.push({featureId: item.featureId, priorTicketKey: item.priorTicketKey, ticketKey: issue.ticketKey})
  }
  // 이슈 자동 닫기 자산을 청구 브랜치에 설치한다(멱등, 덮어쓰지 않음). 커밋·push는
  // 브랜치를 만든 사람 몫이다 — CLI는 파일만 놓고 경로를 알린다.
  const installedCloseAssets = installTicketCloseAssets(root, closeAssets)
  return {ok: true, dryRun: false, preview, results, superseded, freshness, closeAssets, installedCloseAssets}
}

/**
 * pickup: 착수. 게이트 순서 — 준비(브랜치·컨플릭·형상, 점 2·3·4) → 소유권+비신뢰(코어) →
 * --confirm일 때만 self-assign(TOCTOU 완화: **assign 직전 재조회·재판정 + 사후 다중배정 감지**,
 * §4 조건 이행) → change-scope.md 발급.
 */
export async function runPickup({root, repo, featureId, developer, flags, io = {}}) {
  // 브랜치·형상 대조도 origin 스냅샷을 본다 — 판정 전에 갱신한다.
  const freshness = await ensureRemoteFreshness({root, flags, io})
  if (!developer) throw new Error('NO_DEVELOPER: --developer <login> 필요(소유권 판정 주체)')
  const ledgerFile = join(root, LEDGER_RELATIVE)
  const record = (io.readState ?? readLedgerState)(ledgerFile).get(featureId) ?? null
  if (!record?.ticketKey) return {ok: false, bounce: {reason: 'not-claimed'}, guidance: '이 FEAT의 청구(이슈)가 원장에 없습니다 — claim 먼저'}
  const currentBranch = await (io.currentBranch ?? resolveCurrentBranch)({repoRoot: root})
  const worktree = await (io.worktree ?? resolveWorktreeStatus)({repoRoot: root})
  const units = loadUnits(root, flags)
  const unit = units.find(u => u.featureId === featureId) ?? null
  const readiness = evaluatePickupReadiness({
    claimBranch: record.branch ?? null,
    currentBranch,
    claimedHash: record.contentHash ?? null,
    localHash: unit ? (await import('./emit.mjs')).unitContentHash(unit) : null,
    working: worktree,
  })
  if (!readiness.ready) return {ok: false, bounce: {reason: readiness.status}, guidance: readiness.need}
  // 소유권+비신뢰+버전 대조(순수 코어) — 이슈는 최신 조회
  const issue = await (io.resolveIssue ?? resolveIssue)({repo, number: record.ticketKey})
    // 계획이 선언한 paths를 범위 seed로 흘린다 — 충돌 판정과 쓰기 허용이 서로 다른 세계를
  // 보면 충돌 게이트가 픽션 위에서 판정한다(적대 리뷰 2026-08-30). 플래그가 있으면 플래그가
  // 이긴다(운영자 명시 > 계획 선언). 단방향 정합이며 실제 쓰기와의 대조는 여전히 없다(§4).
  const declaredScope = splitList(flags['allowed-paths'])
  const pick = pickupWithOwnership({issue, developer, planUnits: units, ledgerRecord: record,
    allowedPathsSeed: declaredScope.length > 0 ? declaredScope : (unit?.paths ?? [])})
  if (!pick.ok) return {ok: false, bounce: pick.bounce, injection: pick.injection}
  // 청구 범위 판정(의존·충돌)을 **여기서도** 강제한다. 종전에는 board만 강등하고 pickup은
  // 그 판정을 보지 않아, 보드가 blocked라고 해도 그대로 집을 수 있었다 — 강등이 표시일 뿐
  // 게이트가 아니었다(2026-08-30). 선행 기능이 안 끝났는데 착수하면 그 위에서 개발한다.
  const {claimScopeReadiness, findPathCollisions} = await import('./claim-scope.mjs')
  const foundationRoots = splitList(flags['foundation-roots'])
  const scope = claimScopeReadiness({
    unit: unit ?? {featureId},
    foundationComplete: flags['foundation-complete'] !== 'false',
    mergedFeatureIds: await (io.merged ?? resolveMergedFeatures)({records: [...(io.readState ?? readLedgerState)(ledgerFile).values()]}),
    collisions: findPathCollisions(units, {foundationRoots}),
    opts: {foundationRoots},
  })
  if (!scope.pickupable) {
    const guidance = {
      'deps-undeclared': unit?.declarationError
        // 마커를 **썼는데** 못 읽은 경우다 — "선언하세요"라고 답하면 원인을 반대로 가리킨다.
        ? `계획의 unit 마커를 읽지 못했습니다(${unit.declarationError}) — 마커를 고치세요`
        : `계획에 이 FEAT의 의존 선언이 없습니다 — \`<!-- web-harness:unit feat=${featureId} dependsOn=… -->\`를 `
          + '추가하세요. 미선언은 "의존 없음"이 아니라 "선언 안 함"이라 착수 가능으로 세지 않습니다. 의존이 없으면 `dependsOn=none`.',
      'deps-incomplete': `선행 기능이 아직 머지되지 않았습니다: ${(scope.unmetDeps ?? []).join(', ')} — 그 위에서 개발하면 재작업이 됩니다`,
      'path-collision': '다른 FEAT와 쓰기 경로가 겹칩니다 — 순차화하거나 계획에서 경계를 나누세요',
      'foundation-incomplete': '기반(foundation) 단위가 아직 완료되지 않았습니다',
    }[scope.blockedReason] ?? '청구 범위 판정에서 막혔습니다'
    return {ok: false, bounce: {reason: scope.blockedReason, unmetDeps: scope.unmetDeps ?? null}, guidance}
  }
  const collisionNote = unit?.paths === undefined
    ? '충돌 검사 미수행(paths 미선언) — "충돌 없음"이 아니라 "검사 못 함"이다'
    : null
  // **개발 단계는 묻지 않는다.** 확인을 받는 지점은 PR 직전 하나뿐이다
  // (`phase-3-development.md` 형상 규율). pickup은 이미 확정된 것을 실행할 뿐이다 —
  // 게이트가 전부 통과했고, 배정 대상은 요청자 자신이며, 되돌릴 수 있다. 여기서 한 번 더
  // 묻는 것은 판단을 요구하는 게 아니라 의식이다(사용자 지적 2026-08-30).
  // 미리보기가 필요하면 `--dry-run`.
  if (flags['dry-run']) return {ok: true, dryRun: true, assignment: pick.assignment, changeScope: pick.changeScope, freshness, collisionNote}
  // 활성 change-scope 덮어쓰기 가드(리뷰): 다른 FEAT의 change-scope가 살아 있으면 침묵 덮어쓰기
  // 금지 — 진행 중 FEAT의 STALE 앵커가 소실된다. --replace-scope 명시 시에만 교체.
  const existingScope = readChangeScopeFile(root)
  if (existingScope && existingScope.featureId !== featureId && !flags['replace-scope']) {
    return {ok: false, bounce: {reason: 'active-change-scope', activeFeatureId: existingScope.featureId}, guidance: `${existingScope.featureId} 픽업이 진행 중입니다 — 완료(link)하거나 --replace-scope로 명시 교체하세요(그 FEAT의 STALE 앵커가 소실됨)`}
  }
  if (pick.assignment.action === 'self-assign') {
    // TOCTOU 완화(§4 self-assign 행 조건): assign **직전 재조회·재판정** — 판정 후 남이 먼저
    // 배정했으면 양보(진입 차단). gh add-assignee는 additive라 CAS가 없다.
    const fresh = await (io.resolveIssue ?? resolveIssue)({repo, number: record.ticketKey})
    const recheck = pickupWithOwnership({issue: fresh, developer, planUnits: units, ledgerRecord: record, allowedPathsSeed: splitList(flags['allowed-paths'])})
    if (!recheck.ok) return {ok: false, bounce: recheck.bounce, guidance: '판정 이후 다른 개발자가 먼저 배정했습니다 — 다른 티켓을 선택하세요'}
    await (io.gh ?? runGh)(assignArgs(repo, record.ticketKey, developer))
    // 사후 다중배정 감지 — 동시 self-assign이 겹쳤으면 정직 경고(선착 양보 규약은 사람 조율)
    const after = await (io.resolveIssue ?? resolveIssue)({repo, number: record.ticketKey})
    if ((after.assignees ?? []).length > 1) {
      return {ok: false, bounce: {reason: 'multi-assign-detected', assignees: after.assignees}, guidance: '동시 배정이 감지됐습니다 — 팀과 조율해 한 명이 양보하세요(자동 판정하지 않음)'}
    }
  }
  const written = writeChangeScopeFile(root, pick.changeScope)
  return {ok: true, dryRun: false, assignment: pick.assignment, changeScope: pick.changeScope, changeScopePath: written, freshness}
}

/**
 * link: PR↔원장 연결. 게이트 — change-scope STALE이면 완료 차단(C 계약) → 원장 대조 close
 * 참조(verified만 Closes) → 멱등(computePrLinkPlan) → --confirm일 때만 원장 append.
 */
export async function runLink({root, featureId, prUrl, flags, io = {}}) {
  const ledgerFile = join(root, LEDGER_RELATIVE)
  const state = (io.readState ?? readLedgerState)(ledgerFile)
  const record = state.get(featureId) ?? null
  // STALE 대조 — **미수행은 침묵 스킵이 아니라 loud다**(리뷰 HIGH: fail-open 금지). change-scope
  // 부재/훼손/타 FEAT면 대조 불가를 staleCheck로 정직 표기하고, confirm은 명시 opt-in
  // (--accept-unverified-scope) 없이는 차단한다. 파일은 개발자가 편집 가능한 self-attestation
  // 프록시라 조작 우회는 남는다(§4 등록) — 이 게이트는 성실 경로의 방어지 위조 방어가 아니다.
  const changeScope = readChangeScopeFile(root)
  let staleCheck
  if (changeScope?.featureId === featureId) {
    const units = loadUnits(root, flags)
    const unit = units.find(u => u.featureId === featureId) ?? null
    if (isChangeScopeStale(changeScope, unit)) {
      return {ok: false, blocked: 'stale-change-scope', staleCheck: 'stale', guidance: '픽업 후 상류 계획이 바뀌었습니다 — 계획 동기화·재확인 후 PR을 완료하세요'}
    }
    staleCheck = 'verified'
  } else {
    staleCheck = changeScope === null ? 'not-performed:no-change-scope' : 'not-performed:different-feature'
    if (!flags['dry-run'] && !flags['accept-unverified-scope']) {
      return {ok: false, blocked: 'stale-check-unavailable', staleCheck, guidance: 'change-scope가 없거나 다른 FEAT의 것이라 STALE 대조를 수행하지 못했습니다 — 픽업으로 발급하거나 --accept-unverified-scope로 명시 인수하세요'}
    }
  }
  // 이미 링크된 티켓의 재실행은 **멱등**이 먼저다 — 지나간 완료 주장을 다시 심판하지
  // 않는다(그러면 재실행이 소스 상태에 따라 결과가 달라져 멱등 계약이 깨진다).
  if (state?.get?.(featureId)?.prUrl) {
    return {ok: true, idempotent: true, existing: state.get(featureId).prUrl,
      closeLine: renderCloseReference(computeCloseLink({featureId, ticketKey: record?.ticketKey ?? null, ledgerState: state})),
      staleCheck}
  }
  // **완료 조건 검토.** PR을 티켓에 연결하는 것은 완료를 주장하는 것이다 — 그 자리에서
  // 이 FEAT의 수용 기준이 실제로 검증됐는지 묻는다. 종전에는 아무것도 묻지 않았고,
  // 지켜진 것은 개발자가 잘한 것이지 게이트가 지킨 것이 아니었다(2026-08-30 실측).
  const unitForFeature = (() => {
    try { return loadUnits(root, flags).find(unit => unit?.featureId === featureId) ?? null } catch { return null }
  })()
  const completion = evaluateTicketCompletion({
    featureId,
    planText: loadPlanText(root, flags),
    testCaseIds: unitForFeature?.testCaseIds,
    citedIds: collectCitedTestCaseIds(root),
  })
  if (!completion.ok && !flags['accept-incomplete']) {
    return {
      ok: false,
      blocked: `completion:${completion.reason}`,
      completion,
      guidance: completion.reason === 'no-test-cases'
        ? `${featureId}에 수용 기준(TC)이 없습니다 — 완료를 주장할 근거가 없습니다. 계획에 TC를 적으세요`
        : `${featureId}의 수용 기준이 검증되지 않았습니다: ${completion.missing.join(', ')} — 테스트에 그 TC ID를 인용하거나, `
          + '계획이 유예한 것이면 계획 본문에 그 사유를 적으세요(개발자가 PR에서 유예를 선언하는 경로는 두지 않습니다). '
          + '의식적으로 넘기려면 --accept-incomplete로 명시 인수하세요',
    }
  }
  const closeLink = computeCloseLink({featureId, ticketKey: record?.ticketKey ?? null, ledgerState: state})
  const closeLine = renderCloseReference(closeLink)
  const plan = computePrLinkPlan({featureId, ledgerState: state, prUrl, now: new Date().toISOString()})
  if (plan.status === 'already-linked') return {ok: true, idempotent: true, existing: plan.existing, closeLine, staleCheck}
  // 완료 판정을 **원장에 남긴다** — 탈출구로 넘긴 링크와 전부 인용된 링크가 사후에 구별되지
  // 않으면 "의식적 인수"는 휘발성 주장이다(2026-08-30 리뷰 MEDIUM). baseline 갱신을 의식적
  // 행위로 기록하는 이 저장소의 규범과 같은 이유다.
  const linkRecord = {
    ...plan.record,
    completion: {
      total: completion.total,
      cited: completion.cited.length,
      deferred: completion.deferred,
      missing: completion.missing,
      ...(completion.reason ? {reason: completion.reason} : {}),
    },
    ...(completion.ok ? {} : {acceptedIncomplete: true}),
    // 같은 원칙을 STALE 대조 채널에도 적용한다 — 원장만 보고 verified 링크와 미대조 인수
    // 링크를 구별하지 못하면 "의식적 인수"는 여기서도 휘발성 주장이다(리뷰 MEDIUM).
    staleCheck,
    ...(flags['accept-unverified-scope'] ? {acceptedUnverifiedScope: true} : {}),
  }
  // link는 "이 PR이 이 티켓의 것"이라는 **사실 기록**이다 — 판단할 것이 없다. 기본 실행.
  if (flags['dry-run']) return {ok: true, dryRun: true, closeLine, record: linkRecord, staleCheck, completion}
  ;(io.append ?? appendLedgerRecord)(ledgerFile, linkRecord)
  // 성공 경로에서도 completion을 돌려준다 — 유예 N건이 사용자에게 보이지 않으면 침묵이다.
  return {ok: true, dryRun: false, closeLine, record: linkRecord, staleCheck, completion}
}

/** board: 보드 강화(배정·merged — 트래커 실측). read-only. */
export async function runBoard({root, repo, developer, flags, io = {}}) {
  // merged·배정 판정 전 갱신 — 낡은 스냅샷이면 방금 머지된 티켓이 안 보인다.
  const freshness = await ensureRemoteFreshness({root, flags, io})
  const units = loadUnits(root, flags)
  const ledgerFile = join(root, LEDGER_RELATIVE)
  const state = (io.readState ?? readLedgerState)(ledgerFile)
  const gh = io.gh ?? runGh
  const {issueListAllArgs} = await import('./provider-github-exec.mjs')
  const {parseIssueRefs} = await import('./refs.mjs')
  const issuesByFeature = new Map()
  let trackerOk = false // 성공 여부는 플래그로(size>0 휴리스틱은 "정상 조회 0건"을 실패로 오표기 — 리뷰)
  const trackerNotes = []
  try {
    const listed = JSON.parse(await gh(issueListAllArgs(repo)))
    trackerOk = true
    if (listed.length >= 200) trackerNotes.push('truncated-200: 이슈 200건 초과분은 미반영(절단 침묵 금지 — 표기)')
    for (const issue of listed) {
      for (const feat of parseIssueRefs(issue.body ?? '').featureIds) {
        if (!issuesByFeature.has(feat)) issuesByFeature.set(feat, {number: issue.number, assignees: (issue.assignees ?? []).map(a => a.login ?? a), labels: (issue.labels ?? []).map(l => l.name ?? l), branch: parseBranchFromLabels((issue.labels ?? []).map(l => l.name ?? l))})
      }
    }
  } catch {
    trackerNotes.push('트래커 조회 실패 — 아래 보드는 로컬 원장 기준이며 배정·이슈 상태가 반영되지 않음(청구된 FEAT도 unclaimed로 보일 수 있음)')
  }
  const merged = await (io.merged ?? resolveMergedFeatures)({records: [...state.values()]})
  const {buildAvailabilityBoard} = await import('./assign.mjs')
  const {annotateBoardScope, findPathCollisions, uncheckedForCollision} = await import('./claim-scope.mjs')
  const foundationRoots = splitList(flags['foundation-roots'])
  const board = annotateBoardScope(
    buildAvailabilityBoard({units, ledgerState: state, issuesByFeature, developer}),
    units,
    {foundationComplete: flags['foundation-complete'] !== 'false', mergedFeatureIds: merged, collisions: findPathCollisions(units, {foundationRoots}), opts: {foundationRoots}},
  )
  // 검사가 **돌지 않은** 것을 보고한다. 종전에는 "충돌 0건"과 "검사 0건"이 같아 보였고,
  // 의존 미선언은 곧바로 pickupable로 나왔다 — 산문에만 있는 순서가 착수 가능으로 둔갑했다
  // (2026-08-30 실측: 11건 pickupable, 실제 4건). 보드가 그 사실을 말하게 한다.
  const undeclaredDeps = board.filter(row => row.blockedReason === 'deps-undeclared').map(row => row.featureId)
  const collisionUnchecked = uncheckedForCollision(units, {foundationRoots})
  if (undeclaredDeps.length > 0) {
    trackerNotes.push(`deps-undeclared ${undeclaredDeps.length}건 — 계획에 \`<!-- web-harness:unit feat=… dependsOn=… -->\`가 없다. `
      + '미선언은 "의존 없음"이 아니므로 착수 가능으로 세지 않는다. 의존이 없으면 `dependsOn=none`으로 명시하라')
  }
  if (collisionUnchecked.length > 0) {
    trackerNotes.push(`충돌 검사 미수행 ${collisionUnchecked.length}건(paths 미선언) — "충돌 없음"이 아니라 "검사 못 함"이다`)
  }
  return {board, merged, tracker: trackerOk ? 'live' : 'unavailable', trackerNotes, freshness, undeclaredDeps, collisionUnchecked}
}

const splitList = value => value ? String(value).split(',').map(s => s.trim()).filter(Boolean) : []

// ---- main dispatch (스킬이 호출; 결과는 JSON 한 덩어리로 stdout) ----
// basename 동등 비교 — endsWith('cli.mjs')는 test-ticket-cli.mjs에도 매치돼 테스트 import 시
// dispatch가 오발화한다(실측). path.basename은 win32 구분자도 처리(리뷰 LOW).
const invokedDirectly = basename(process.argv[1] ?? '') === 'cli.mjs'
if (invokedDirectly) {
  const {command, positional, flags} = parseArgs(process.argv.slice(2))
  const root = flags.root ?? process.cwd()
  const repo = flags.repo ?? null
  const requireRepo = () => { if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('MISSING_REPO: --repo <owner/name> 필요') }
  const run = async () => {
    switch (command) {
      case 'claim': requireRepo(); return runClaim({root, repo, flags})
      case 'pickup': requireRepo(); return runPickup({root, repo, featureId: positional[0], developer: flags.developer, flags})
      case 'link': return runLink({root, featureId: positional[0], prUrl: positional[1], flags})
      case 'board': requireRepo(); return runBoard({root, repo, developer: flags.developer ?? null, flags})
      default: throw new Error(`UNKNOWN_COMMAND: ${command ?? '(없음)'} — claim|pickup|link|board`)
    }
  }
  run().then(result => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    if (result && result.ok === false) process.exitCode = 2 // 게이트 차단 = 비0 exit(기계 강제)
  }).catch(error => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
}
