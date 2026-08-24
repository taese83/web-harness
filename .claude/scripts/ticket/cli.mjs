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
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {basename, dirname, join} from 'node:path'
import {computeBatchClaimPlan, formatBatchClaimPreview} from './batch-claim.mjs'
import {computeClaimEligibility, claimEligibilityGuidance} from './claim-guard.mjs'
import {resolveOriginPlanSync, resolveCurrentBranch, resolveWorktreeStatus} from './git-origin.mjs'
import {evaluatePickupReadiness} from './sync-guard.mjs'
import {claimFeature} from './runner.mjs'
import {pickupWithOwnership} from './assign.mjs'
import {isChangeScopeStale} from './pickup.mjs'
import {computeCloseLink, computePrLinkPlan} from './pr.mjs'
import {renderCloseReference, parseBranchFromLabels} from './provider-github.mjs'
import {createGithubProvider, resolveIssue, resolveViewerPermission, resolveMergedFeatures, runGh, assignArgs} from './provider-github-exec.mjs'
import {readLedger, readLedgerState, appendLedgerRecord, appendClaimRecord} from './ledger-writer.mjs'
import {parseFeaturePlanUnits} from './plan-units.mjs'

export const LEDGER_RELATIVE = '_workspace/03_dev/identity-ledger.jsonl'
export const CHANGE_SCOPE_RELATIVE = '_workspace/03_dev/change-scope.md'
export const PLAN_RELATIVE = '_workspace/01_plan/feature-plan.md'

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

/** units 로드 — --units <json파일> 우선, 없으면 로컬 feature-plan.md 파싱. 표 형식 계획은
 * 0 unit이 나온다 — **기존 청구가 있으면** EMPTY_UNITS_CLOSE_ALL 가드가 잡지만, 신규(빈 원장)
 * 첫 claim은 "발행 0" 미리보기가 유일한 방어다(정직 — 미리보기 확인이 그래서 게이트다). */
export function loadUnits(root, flags) {
  if (flags.units) {
    const parsed = JSON.parse(readFileSync(flags.units, 'utf8'))
    if (!Array.isArray(parsed)) throw new Error('INVALID_UNITS: units는 배열이어야 합니다')
    return parsed
  }
  const planPath = join(root, PLAN_RELATIVE)
  if (!existsSync(planPath)) throw new Error(`MISSING_PLAN: ${PLAN_RELATIVE} 없음(--units로 지정 가능)`)
  return parseFeaturePlanUnits(readFileSync(planPath, 'utf8'))
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
export async function runClaim({root, repo, flags, io = {}}) {
  const units = loadUnits(root, flags)
  const branch = flags.branch ?? await (io.currentBranch ?? resolveCurrentBranch)({repoRoot: root})
  if (!branch) throw new Error('NO_BRANCH: 현재 브랜치를 알 수 없습니다(detached?) — --branch로 지정')
  // 점 1: 청구는 origin 푸시분에만(fail-closed)
  const sync = await (io.originSync ?? resolveOriginPlanSync)({repoRoot: root, planPath: PLAN_RELATIVE})
  const eligibility = computeClaimEligibility(sync)
  if (!eligibility.eligible) {
    return {ok: false, blocked: eligibility.reason, guidance: claimEligibilityGuidance(eligibility.reason)}
  }
  const ledgerFile = join(root, LEDGER_RELATIVE)
  const state = (io.readState ?? readLedgerState)(ledgerFile)
  const plan = computeBatchClaimPlan({units, ledgerState: state, opts: {foundationRoots: splitList(flags['foundation-roots'])}, branch})
  const preview = formatBatchClaimPreview(plan)
  if (plan.collisions.length > 0 || plan.cycles.length > 0) {
    return {ok: false, blocked: 'plan-defects', preview, guidance: '경로 충돌/순환 의존을 feature-planner에서 해소한 뒤 청구하세요'}
  }
  if (!flags.confirm) return {ok: true, dryRun: true, preview}
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
  return {ok: true, dryRun: false, preview, results}
}

/**
 * pickup: 착수. 게이트 순서 — 준비(브랜치·컨플릭·형상, 점 2·3·4) → 소유권+비신뢰(코어) →
 * --confirm일 때만 self-assign(TOCTOU 완화: **assign 직전 재조회·재판정 + 사후 다중배정 감지**,
 * §4 조건 이행) → change-scope.md 발급.
 */
export async function runPickup({root, repo, featureId, developer, flags, io = {}}) {
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
  const pick = pickupWithOwnership({issue, developer, planUnits: units, ledgerRecord: record, allowedPathsSeed: splitList(flags['allowed-paths'])})
  if (!pick.ok) return {ok: false, bounce: pick.bounce, injection: pick.injection}
  if (!flags.confirm) return {ok: true, dryRun: true, assignment: pick.assignment, changeScope: pick.changeScope}
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
  return {ok: true, dryRun: false, assignment: pick.assignment, changeScope: pick.changeScope, changeScopePath: written}
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
    if (flags.confirm && !flags['accept-unverified-scope']) {
      return {ok: false, blocked: 'stale-check-unavailable', staleCheck, guidance: 'change-scope가 없거나 다른 FEAT의 것이라 STALE 대조를 수행하지 못했습니다 — 픽업으로 발급하거나 --accept-unverified-scope로 명시 인수하세요'}
    }
  }
  const closeLink = computeCloseLink({featureId, ticketKey: record?.ticketKey ?? null, ledgerState: state})
  const closeLine = renderCloseReference(closeLink)
  const plan = computePrLinkPlan({featureId, ledgerState: state, prUrl, now: new Date().toISOString()})
  if (plan.status === 'already-linked') return {ok: true, idempotent: true, existing: plan.existing, closeLine, staleCheck}
  if (!flags.confirm) return {ok: true, dryRun: true, closeLine, record: plan.record, staleCheck}
  ;(io.append ?? appendLedgerRecord)(ledgerFile, plan.record)
  return {ok: true, dryRun: false, closeLine, record: plan.record, staleCheck}
}

/** board: 보드 강화(배정·merged — 트래커 실측). read-only. */
export async function runBoard({root, repo, developer, flags, io = {}}) {
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
  const {annotateBoardScope, findPathCollisions} = await import('./claim-scope.mjs')
  const foundationRoots = splitList(flags['foundation-roots'])
  const board = annotateBoardScope(
    buildAvailabilityBoard({units, ledgerState: state, issuesByFeature, developer}),
    units,
    {foundationComplete: flags['foundation-complete'] !== 'false', mergedFeatureIds: merged, collisions: findPathCollisions(units, {foundationRoots}), opts: {foundationRoots}},
  )
  return {board, merged, tracker: trackerOk ? 'live' : 'unavailable', trackerNotes}
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
