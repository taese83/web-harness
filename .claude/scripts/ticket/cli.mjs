#!/usr/bin/env node
// 팀 워크플로우 통합 — executor CLI (증분 5). team-flow 스킬이 호출하는 실행부 글루.
// 순수 코어(emit/claim-scope/assign/pickup/pr/route)와 gh/git 실행부·원장 writer를 엮는다.
//
// 실행 환경(정직 경계): **플러그인 배포판 전용**이다 — 하네스 저장소 자체 세션은 global bash
// policy가 gh/git·미등재 스크립트를 차단하며, **등재하지 않기로 결정**했다(repo 안전 정책
// 비약화 — 2026-08-24, da6e375 공시의 재검토 결론). repo-내에서는 순수 미리보기까지만.
//
// side-effect 규율: `claim`(이슈 무더기 발행)·`configure`만 `--confirm` 없이 미리보기다. `pickup`·`link`·
// `adopt`·`bind`·`intake`는 **사용자의 요청이 곧 승인**이며 `--dry-run`으로 미리본다(2026-09-11 정정 —
// 종전 헤더는 「쓰기 전부 --confirm」이라 적었으나 코드가 --confirm을 보는 곳은 claim·configure뿐이다).
import {DEV_TICKET, adoptLedgerRecord, appendInventory, buildSourceMarker, checkAdopt, checkBind, classifyByComponent, planIntake, recordConsumption, stampSourceInto} from './intake.mjs'
import {scanUntrustedBody, scanUntrustedIssue, ticketContextLines} from './pickup.mjs'
import {bounceComment} from './readiness.mjs'
import {buildRefsMarker, stampRefsInto} from './refs.mjs'
import {hasUserInterface} from '../spec.mjs'
import {existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync} from 'node:fs'
import {basename, dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {computeBatchClaimPlan, formatBatchClaimPreview} from './batch-claim.mjs'
import {computeClaimEligibility, claimEligibilityGuidance, checkClaimBranch} from './claim-guard.mjs'
import {resolveOriginPlanSync, resolveCurrentBranch, resolveWorktreeStatus, refreshRemoteRefs} from './git-origin.mjs'
import {evaluatePickupReadiness} from './sync-guard.mjs'
import {claimFeature} from './runner.mjs'
import {pickupWithOwnership} from './assign.mjs'
import {isChangeScopeStale} from './pickup.mjs'
import {evaluateTicketCompletion} from './completion.mjs'
import {computeCloseLink, computePrLinkPlan} from './pr.mjs'
import {renderCloseReference, parseBranchFromLabels, buildIssueFields} from './provider-github.mjs'
import {createGithubProvider, resolveIssue, resolveViewerPermission, resolveMergedFeatures, runGh, assignArgs, issueSupersedeCloseArgs} from './provider-github-exec.mjs'
import {createJiraProvider} from './provider-jira-exec.mjs'
import {assertAllowedKeys, buildTicketConfig, evaluateConfigWrite, JIRA_AUTH_ENV, JIRA_QUESTIONS, PROVIDER_QUESTIONS, readTicketConfig, recordProvider, resolveProviderChoice, TICKET_CONFIG_RELATIVE, writeTicketConfig} from './ticket-config.mjs'
import {providerCapabilities} from './ticket-provider.mjs'
import {readLedger, readLedgerState, appendLedgerRecord, appendClaimRecord, appendSupersedeRecord} from './ledger-writer.mjs'
import {findFeatureForTicket, nextFeatureId, parseFeaturePlanUnits, renderTicketUnit} from './plan-units.mjs'

export const LEDGER_RELATIVE = '_workspace/03_dev/identity-ledger.jsonl'
export const CHANGE_SCOPE_RELATIVE = '_workspace/03_dev/change-scope.md'
export const PLAN_RELATIVE = '_workspace/01_plan/feature-plan.md'
export const PLAN_DIR_RELATIVE = '_workspace/01_plan/feature-plan'

/** argv → {command, positional, flags} (--k v | --k=v | --flag). */
const SINGLE_VALUE_FLAGS = ['repo', 'root', 'units', 'developer', 'branch', 'provider']

export function parseArgs(argv) {
  const [command, ...rest] = argv
  const positional = []
  const flags = {}
  // **같은 플래그를 반복하면 배열로 모은다.** 종전에는 덮어써서 `--set a=1 --set b=2`가
  // 조용히 `b=2` 하나만 남았다 — 설정을 여러 항목 주는 것이 configure의 기본 사용법이라
  // 침묵 손실이 그대로 잘못된 설정 파일이 된다. 한 번만 준 플래그는 예전처럼 스칼라다.
  const assign = (key, value) => {
    if (!(key in flags)) { flags[key] = value; return }
    flags[key] = [].concat(flags[key], value)
  }
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]
    if (!arg.startsWith('--')) { positional.push(arg); continue }
    const eq = arg.indexOf('=')
    if (eq >= 0) { assign(arg.slice(2, eq), arg.slice(eq + 1)); continue }
    const next = rest[i + 1]
    if (next != null && !next.startsWith('--')) { assign(arg.slice(2), next); i++ }
    else assign(arg.slice(2), true)
  }
  // 배열을 받으면 안 되는 플래그는 여기서 막는다 — 반복하면 문자열로 강제돼 원인을 가리지 않는
  // 오류(`MISSING_REPO`)나 TypeError로 나타난다.
  for (const key of SINGLE_VALUE_FLAGS) {
    if (Array.isArray(flags[key])) throw new Error(`REPEATED_FLAG: --${key}는 한 번만 지정한다(받은 값 ${flags[key].length}개)`)
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
    '필드 뜻: minimal-change-contract.md · 키 집합: team-flow/references/ticket-kinds.md · 아래 JSON이 기계 정본(STALE 대조 입력).',
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

// 프로젝트에 실제로 존재하는 디자인 정본만 티켓에 적는다 — 없는 경로를 적으면 거짓 안내다.
const DESIGN_REF_CANDIDATES = [
  '_workspace/02_design/design-system',
  '_workspace/02_design/design-system.md',
  '_workspace/02_design/component-spec',
  '_workspace/02_design/component-spec.md',
  '_workspace/02_design/layout-spec.md',
  '_workspace/02_design/piece-geometry.md',
]
export function resolveDesignRefs(root) {
  return DESIGN_REF_CANDIDATES.filter(rel => existsSync(join(root, rel)))
}

/**
 * 발행 본문의 「채워 주실 것」에 필요한 **선언**을 프로필에서 읽는다. 조건의 참·거짓을 여기서
 * 만들고 `readiness.mjs`는 이름만 안다 — 서비스 지식이 순수 코어에 들어가지 않게(I3).
 * 프로필이 없으면 조건은 전부 거짓이고 언어는 미선언이다 — **추측하지 않는다.**
 */
export function resolveReadinessContext(root) {
  let profile = {}
  try { profile = JSON.parse(readFileSync(join(root, '_workspace/01_plan/project-profile.json'), 'utf8')) } catch { profile = {} }
  // **시안은 `supplied`일 때만 묻는다.** 종전 초안은 `02_design/*` 파일 존재로 추론했는데,
  // 그 파일들은 **하네스가 생성한 것**이라 Phase 2를 돈 모든 프로젝트가 존재하지 않는 Figma
  // 링크를 요구받았다 — 채울 수 없는 요구는 아무 문자나 적게 만든다(적대 리뷰 2026-09-09).
  // 정본은 `_workspace/web-harness.md`의 `DESIGN_SOURCE` 마커다.
  const marker = join(root, '_workspace/web-harness.md')
  let designSource = null
  try {
    designSource = (readFileSync(marker, 'utf8').match(/DESIGN_SOURCE\s*:\s*(generated|supplied|absent)/i) ?? [])[1]?.toLowerCase() ?? null
  } catch { designSource = null }
  return {
    outputLanguage: profile.outputLanguage ?? null,
    conditions: {
      designDeclared: designSource === 'supplied',
      // 화면이 있는 형태에서만 화면을 묻는다. 선언이 없으면 **묻지 않는다** — 추측해서
      // 막는 것보다 안 묻고 넘기는 쪽이 이 저장소 규율에 맞다.
      hasUserInterface: hasUserInterface(profile.targetShapes) === true,
    },
  }
}

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

/**
 * 이번 실행의 티켓 provider를 정한다.
 *
 * **하위호환이 먼저다.** 설정 파일이 없어도 원장에 기록이 있으면 그 프로젝트는 이미 GitHub으로
 * 돌고 있는 것이다 — 거기에 "어느 트래커를 쓰겠냐"고 물으면 돌던 흐름이 멈춘다. 설정도 없고
 * 기록도 없을 때만 묻는다(최초 청구).
 *
 * @returns {{provider?: Object, choice: Object, questions?: Array}}
 */
export function resolveTicketProvider({root, repo, flags = {}, io = {}, hasLedgerRecords = false}) {
  // 주입 경로도 **설정을 함께 돌려준다** — 실제 경로와 다르면 회귀가 실물을 시험하지 못한다.
  if (io.provider) return {provider: io.provider, choice: {provider: io.provider.name ?? 'test', needsChoice: false},
    config: io.ticketConfig ?? null}
  const stored = io.ticketConfig ?? readTicketConfig(root)
  // 설정은 없는데 원장이 있다 = 이 프로젝트는 GitHub으로 이미 돈다(추론이 아니라 실측이다).
  const effective = stored ?? (hasLedgerRecords ? {provider: 'github'} : null)
  const choice = resolveProviderChoice({stored: effective, requested: flags['ticket-provider'] ?? null})
  if (choice.needsChoice) return {choice, questions: PROVIDER_QUESTIONS[choice.provider] ?? JIRA_QUESTIONS}
  if (choice.provider === 'jira') {
    if (!effective?.jira) {
      return {choice: {...choice, needsChoice: true}, questions: JIRA_QUESTIONS}
    }
    // 설정을 함께 돌려준다 — 인테이크가 `componentAxis` 선언을 읽는다(팀 어휘는 설정이 든다).
    return {provider: createJiraProvider({config: effective.jira, env: io.env ?? process.env}), choice, config: effective}
  }
  // host를 넘기지 않으면 createGithubProvider의 기본값(github.com)이 늘 이긴다 — GitHub
  // Enterprise 저장소에서 owner/name은 맞게 뽑히고 host만 유실돼 gh가 없는 저장소를 찾았다
  // (2026-09-02 실측). 실행부는 이미 host를 GH_HOST로 넘기게 돼 있었고 배선만 없었다.
  return {provider: createGithubProvider({repo, host: effective?.github?.host}), choice}
}

/**
 * configure: 사용자에게 받은 트래커 설정을 `_workspace/03_dev/ticket-provider.json`에 기록한다.
 *
 * 종전에는 claim이 질문만 돌려주고 **답을 적을 곳이 없었다** — 사람이 JSON을 손으로 만들어야
 * 했고, 그래서 "설정은 공유된다"는 설계가 실제로는 성립하지 않았다.
 *
 * 이 파일은 원장 옆에 있고 **팀에 공유된다**(청구는 origin에 푸시된 형상에만 — `claim` 점 1).
 * 그래서 두 가지를 지킨다: 비밀은 쓰지 않고, 공유되지 않는 자리(gitignore)면 그 사실을 알린다.
 *
 * side-effect이므로 `--confirm` 없이는 쓰지 않는다(이 CLI의 공통 규율).
 */
export async function runConfigure({root, flags, io = {}}) {
  const provider = flags.provider ?? null
  if (!provider) {
    return {ok: false, blocked: 'provider-required', questions: PROVIDER_QUESTIONS,
      guidance: '--provider github|jira 를 지정하세요. github는 사내 GitHub Enterprise면 --set host=<주소>, jira면 --set key=value 로 항목을 채웁니다.'}
  }
  // `--set k=v` 반복 → 답 객체. 점 표기(`transitions.done`)와 목록(`components`)은 buildTicketConfig가 편다.
  const answers = {}
  for (const entry of [].concat(flags.set ?? [])) {
    const index = String(entry).indexOf('=')
    if (index < 0) return {ok: false, blocked: 'bad-set', guidance: `--set 은 key=value 형식이어야 합니다: ${entry}`}
    answers[String(entry).slice(0, index).trim()] = String(entry).slice(index + 1).trim()
  }
  try {
    assertAllowedKeys(answers, provider)
  } catch (error) {
    return {ok: false, blocked: 'key-refused', guidance: error.message}
  }
  const next = buildTicketConfig(provider, answers)
  const existing = io.ticketConfig ?? (() => { try { return readTicketConfig(root) } catch { return null } })()
  const writeCheck = evaluateConfigWrite({existing, next, replace: Boolean(flags.replace)})
  if (!writeCheck.ok) {
    return {ok: false, blocked: 'provider-switch', from: writeCheck.from, to: writeCheck.to,
      guidance: `이미 ${writeCheck.from}으로 설정돼 있습니다 — 바꾸면 기존 티켓이 그쪽에 남습니다. `
        + '기존 티켓 처리를 정한 뒤 --replace 로 명시하세요.'}
  }
  // **공유되지 않는 자리면 그 사실을 알린다.** 이 설정이 팀에 닿지 않으면 팀원마다 다른
  // 트래커로 발행하는 사고가 난다 — 원장도 같은 디렉터리라 같이 새 나간다.
  const shared = await (io.checkShared ?? checkConfigShared)({root})
  const result = {ok: true, provider, config: next, path: TICKET_CONFIG_RELATIVE, shared,
    ...(writeCheck.switching ? {switching: writeCheck.switching} : {}),
    ...(writeCheck.updating ? {updating: true} : {}),
    note: `인증은 이 파일이 아니라 환경변수입니다: ${JIRA_AUTH_ENV.join(' · ')}`}
  const toWrite = writeCheck.merged ?? next
  if (!flags.confirm) return {...result, config: toWrite, dryRun: true}
  return {...result, config: toWrite, dryRun: false, written: writeTicketConfig(root, toWrite)}
}

/** 설정 경로가 git에 공유되는 자리인가(무시되면 팀에 닿지 않는다). 판정 불가면 unknown. */
async function checkConfigShared({root}) {
  try {
    const {execFileSync} = await import('node:child_process')
    execFileSync('git', ['check-ignore', '-q', TICKET_CONFIG_RELATIVE], {cwd: root, stdio: 'ignore'})
    return {ignored: true, shared: false, reason: 'gitignored',
      warning: `${TICKET_CONFIG_RELATIVE}가 gitignore에 걸려 있습니다 — 설정도 원장도 팀에 공유되지 않습니다(팀 흐름이 로컬 전용이 됩니다).`}
  } catch (error) {
    // exit 1 = 무시되지 않음(정상). 그 밖(git 없음·repo 아님)은 판정 불가.
    if (error?.status === 1) return {ignored: false, shared: true, reason: 'not-ignored'}
    return {ignored: null, shared: null, reason: 'undetermined'}
  }
}

/**
 * PR 본문의 close 참조를 트래커에 맞춰 렌더한다.
 *
 * GitHub은 `Closes #N`이 네이티브로 닫는다. **Jira는 닫지 않는다** — 키를 적어도 아무 일도
 * 일어나지 않으므로 `Closes`라고 쓰면 그것은 닫는 시늉이다. 대신 관계만 적고 머지 후 전이가
 * 필요하다는 사실을 그 자리에 남긴다(그 전이는 close 워크플로우 또는 사람이 한다).
 */
export function renderCloseLineFor(providerName, closeLink) {
  if (providerName === 'github') return renderCloseReference(closeLink)
  if (!closeLink?.ok || !closeLink.verified) return renderCloseReference(closeLink)
  return `Relates to ${closeLink.closes}\n\n> ⚠️ ${providerName}은 PR 머지로 자동 닫히지 않습니다 — 머지 후 상태 전이가 필요합니다`
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
  // 이미 나간 FEAT의 **미충족 수용 기준**을 잰다 — 구현이 안 됐거나 이슈가 있으면 fix
  // 티켓이 있어야 한다. 원 티켓을 고치지 않고 별도 티켓으로 낸다.
  const citedIds = collectCitedTestCaseIds(root)
  const unmetByFeature = new Map()
  for (const unit of units) {
    if (!state.get(unit.featureId)?.prUrl) continue
    const verdict = evaluateTicketCompletion({
      featureId: unit.featureId, planText: '', testCaseIds: unit.testCaseIds, citedIds,
    })
    if (verdict.missing.length > 0) unmetByFeature.set(unit.featureId, verdict.missing)
  }
  const plan = computeBatchClaimPlan({units, ledgerState: state, opts: {foundationRoots: splitList(flags['foundation-roots'])}, branch, unmetByFeature})
  const preview = formatBatchClaimPreview(plan)
  if (plan.collisions.length > 0 || plan.cycles.length > 0) {
    return {ok: false, blocked: 'plan-defects', preview, guidance: '경로 충돌/순환 의존을 feature-planner에서 해소한 뒤 청구하세요'}
  }
  const closeAssets = planTicketCloseInstall(root)
  // **트래커 판정은 확인(confirm) 앞이다.** 종전에는 `--confirm` 뒤에 있어서, 사용자가
  // 미리보기를 보고 "발행해"라고 한 **다음에야** "어느 트래커?"를 물었다 — 확인의 대상이
  // 확정되지 않은 채 확인을 받은 셈이다. 판정을 앞으로 올리고, 물어야 하면 **미리보기와 함께**
  // 돌려준다(무엇을 청구할지 보면서 트래커를 고를 수 있어야 한다).
  const ledgerHasRecords = (io.readState ?? readLedgerState)(ledgerFile).size > 0
  const resolved = resolveTicketProvider({root, repo, flags, io, hasLedgerRecords: ledgerHasRecords})
  const providerGuidance = '어느 트래커에 청구할지 정하세요 — GitHub Issues 또는 Jira. '
    + 'Jira면 프로젝트 정보가 필요합니다(설정은 _workspace/03_dev/ticket-provider.json).'
  if (resolved.choice.needsChoice) {
    // **미리보기는 막지 않는다.** 무엇을 청구할지 보는 것은 트래커를 고르기 전에도 유용하고,
    // 오히려 그것을 보면서 고르는 게 자연스럽다. 질문은 여기서 **함께** 띄우고, 실제 발행
    // (`--confirm`)만 차단한다 — 확인의 대상이 확정되지 않은 채 확인을 받지 않기 위해서다.
    if (!flags.confirm) {
      return {ok: true, dryRun: true, preview, freshness, closeAssets,
        ticketProvider: null, needsChoice: true, questions: resolved.questions, guidance: providerGuidance}
    }
    return {ok: false, blocked: 'ticket-provider-unset', questions: resolved.questions, preview, freshness, closeAssets,
      guidance: providerGuidance}
  }
  if (resolved.choice.switching) {
    // 조용히 바꾸면 기존 티켓이 다른 트래커에 남고 board가 두 소스를 읽어야 한다.
    return {ok: false, blocked: 'ticket-provider-switch', switching: resolved.choice.switching, preview, freshness,
      guidance: `이 프로젝트는 ${resolved.choice.switching.from}으로 청구돼 있습니다 — ${resolved.choice.switching.to}로 바꾸려면 기존 티켓 처리를 먼저 정하세요(그대로 두기 / 마이그레이션 / 전환 취소).`}
  }
  const provider = resolved.provider
  // 미리보기에 **어디로 나가는지**를 함께 싣는다 — 확인은 "무엇을"과 "어디에"가 다 보여야 한다.
  if (!flags.confirm) return {ok: true, dryRun: true, preview, freshness, closeAssets, ticketProvider: provider.name}
  // 발행(순서대로) — provider + 원장(청구는 rebind 가드 append)
  const designRefs = resolveDesignRefs(root) // 티켓에 실을 참고 정본(게이트 아님 — 포인터다)
  const readiness = resolveReadinessContext(root) // 기획자에게 물을 것(선언에서 온다)
  // 권한 pre-check는 **GHE repo 권한**을 본다. 교차 형태(티켓 Jira · 코드 GHE)에서는 그것이
  // 티켓 생성 권한과 무관하다 — GHE read인 사람이 Jira 생성 권한을 가질 수 있다. GitHub일
  // 때만 걸고, 아니면 reactive 분류(`provider.classifyError`)에 맡긴다.
  // 주입된 권한 조회기가 있으면 그것이 이긴다(호출자가 축을 안다). 없을 때만 트래커로 가른다.
  const permission = io.permission
    ? await io.permission({repo})
    : (provider.name === 'github' ? await resolveViewerPermission({repo}) : null)
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
      designRefs,
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
    const fields = provider.buildFields(item.payload, {branch, assignee: flags.assignee ?? null, designRefs, readiness})
    const issue = await provider.createIssue(fields)
    // `createIssue`는 `{number, url}`을 돌려준다 — `ticketKey`는 없고, 원장은 **문자열**을
    // 요구한다. 이 두 줄이 틀린 채 남아 있었다는 것은 대체 발행 경로가 한 번도 실행된 적이
    // 없다는 뜻이다(2026-08-30, 첫 실행에서 LEDGER_INVALID_RECORD로 드러났다).
    const ticketKey = String(issue.ticketKey ?? issue.number)
    ;(io.appendSupersede ?? appendSupersedeRecord)(ledgerFile, {
      featureId: item.featureId,
      ticketKey,
      contentHash: item.contentHash,
      createdAt: new Date().toISOString(),
      branch,
      supersedes: item.priorTicketKey,
    })
    // 옛 티켓은 **완료가 아니라 superseded**로 닫는다 — 닫힘을 완료로 오독하면 보드가 거짓이 된다.
    // 닫기는 GitHub 전용 경로다. 다른 트래커에서 `gh issue close PROJ-7`을 부르면 실패하고,
    // 그 시점엔 이미 새 티켓과 원장 기록이 남아 **부분 side-effect**가 된다. 능력이 없으면
    // 닫지 않고 `priorTicketPending`으로 남긴다 — 못 한 것을 한 것처럼 적지 않는다.
    let priorTicketPending = null
    if (provider.name === 'github') {
      await (io.gh ?? runGh)(issueSupersedeCloseArgs(repo, item.priorTicketKey, ticketKey))
    } else {
      priorTicketPending = `${item.priorTicketKey}: ${provider.name}에는 superseded 닫기 경로가 없습니다 — 수동으로 닫으세요`
    }
    superseded.push({featureId: item.featureId, priorTicketKey: item.priorTicketKey, ticketKey, ...(priorTicketPending ? {priorTicketPending} : {})})
  }
  // **fix 티켓** — 이미 나갔는데 수용 기준이 미충족인 FEAT. 원 티켓을 고치거나 대체하지
  // 않고 별도 티켓으로 낸다: 원 티켓은 그 시점의 계약이고, 미충족분은 새로 할 일이다.
  // 원장에는 쓰지 않는다 — 원장은 FEAT당 하나의 정체성이고 fix는 그 FEAT의 후속 작업이지
  // 새 정체성이 아니다(rebind 가드를 건드리면 안 된다).
  const fixes = []
  for (const item of plan.fix ?? []) {
    const unit = unitById.get(item.featureId)
    const body = [
      `원 티켓 #${item.priorTicketKey}이 이미 PR로 나갔으나 아래 수용 기준이 검증되지 않았다.`,
      '',
      '## 미충족 수용 기준',
      ...item.unmet.map(id => `- ${id}`),
      '',
      '판정 근거: 소스·테스트 어디에서도 위 TC ID가 인용되지 않는다(프록시 — 인용은 검증의',
      '필요조건이지 충분조건이 아니다. 실제로 그 기준을 재는지는 리뷰가 본다).',
      '',
      `계약 본문은 원 티켓 #${item.priorTicketKey}과 \`${unit?.featureId}\` 명세를 따른다.`,
    ].join('\n')
    // **buildFields를 우회하지 않는다.** 종전에는 GitHub 필드 형태를 직접 넘겼는데, Jira는
    // `{fields:…}`를 요구하므로 그대로 POST되면 HTTP 400이다.
    const fixFields = provider.buildFields(
      {sourceKey: item.featureId, title: item.title, body, acceptanceCriteria: [], harnessRefs: {featureIds: [item.featureId], testCaseIds: item.unmet ?? []}},
      {assignee: flags.assignee ?? null, branch, designRefs: []},
    )
    const issue = await provider.createIssue(fixFields)
    fixes.push({featureId: item.featureId, ticketKey: String(issue.ticketKey ?? issue.number), unmet: item.unmet, priorTicketKey: item.priorTicketKey})
  }
  // 이슈 자동 닫기 자산을 청구 브랜치에 설치한다(멱등, 덮어쓰지 않음). 커밋·push는
  // 브랜치를 만든 사람 몫이다 — CLI는 파일만 놓고 경로를 알린다.
  const installedCloseAssets = installTicketCloseAssets(root, closeAssets)
  return {ok: true, dryRun: false, preview, results, superseded, fixes, freshness, closeAssets, installedCloseAssets}
}

/**
 * pickup: 착수. 게이트 순서 — 준비(브랜치·컨플릭·형상, 점 2·3·4) → 소유권+비신뢰(코어) →
 * self-assign(TOCTOU 완화: **assign 직전 재조회·재판정 + 사후 다중배정 감지**, §4 조건 이행) →
 * change-scope.md 발급. **`--confirm`을 보지 않는다** — 픽업 요청 자체가 승인이다(`team-flow`
 * 「묻지 않고 실행한다」, 2026-09-11 사용자 결정). 미리보기는 `--dry-run`. 종전 주석은
 * 「--confirm일 때만 self-assign」이라 적었으나 코드는 그런 적이 없었다.
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
  // 소유권+비신뢰+버전 대조(순수 코어) — 이슈는 최신 조회.
  // 조회·배정·전이는 **provider 경유**다. 원장이 어느 트래커인지 알고 있다(record.provider).
  const resolved = resolveTicketProvider({root, repo, flags, io, hasLedgerRecords: true})
  if (resolved.choice.needsChoice) {
    return {ok: false, bounce: {reason: 'ticket-provider-unset'}, guidance: '티켓 provider 설정이 없습니다 — claim에서 먼저 정하세요'}
  }
  const provider = resolved.provider
  // **원장이 1차 근거다.** `resolveTicketProvider`는 설정이 없으면 "기록이 있으니 github"으로
  // 추론하는데, Jira로 청구된 원장에 설정 파일이 없는 클론이면 그 추론이 틀린다 — 그러면
  // `gh issue view PROJ-7`이 gh 오류로 죽고 원인은 "설정 없음"이 아니라 gh 문제로 보인다.
  const claimedWith = recordProvider(record)
  if (claimedWith !== provider.name) {
    return {ok: false, bounce: {reason: 'ticket-provider-mismatch', claimedWith, resolved: provider.name},
      guidance: `이 티켓은 ${claimedWith}에 청구됐는데 이 환경은 ${provider.name}으로 해석됩니다 — `
        + '`_workspace/03_dev/ticket-provider.json`이 있는지 확인하세요(없으면 원장이 있어도 github으로 추론됩니다).'}
  }
  const fetchIssue = key => (io.resolveIssue ? io.resolveIssue({repo, number: key}) : provider.resolveIssue(key))
  const issue = await fetchIssue(record.ticketKey)
    // 계획이 선언한 paths를 범위 seed로 흘린다 — 충돌 판정과 쓰기 허용이 서로 다른 세계를
  // 보면 충돌 게이트가 픽션 위에서 판정한다(적대 리뷰 2026-08-30). 플래그가 있으면 플래그가
  // 이긴다(운영자 명시 > 계획 선언). 단방향 정합이며 실제 쓰기와의 대조는 여전히 없다(§4).
  const declaredScope = splitList(flags['allowed-paths'])
  const pick = pickupWithOwnership({issue, developer, planUnits: units, ledgerRecord: record,
    allowedPathsSeed: declaredScope.length > 0 ? declaredScope : (unit?.paths ?? [])})
  if (!pick.ok) return {...await notifyPlanner({provider, ticketKey: record.ticketKey, featureId, bounce: pick.bounce, io, dryRun: flags['dry-run'], readinessLanguage: readiness.outputLanguage}),
    ok: false, bounce: pick.bounce, injection: pick.injection}
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
    // **범위 되돌림도 기획자에게 간다.** guidance가 "계획에 의존을 선언하세요"·"계획에서
    // 경계를 나누세요"라고 말하는데 그 말이 개발자 터미널에서만 끝나면 고칠 사람이 못 본다.
    const scopeBounce = {reason: scope.blockedReason, unmetDeps: scope.unmetDeps ?? null}
    return {...await notifyPlanner({provider, ticketKey: record.ticketKey, featureId, bounce: scopeBounce, io, dryRun: flags['dry-run'], readinessLanguage: readiness.outputLanguage}),
      ok: false, bounce: scopeBounce, guidance}
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
    const fresh = await fetchIssue(record.ticketKey)
    const recheck = pickupWithOwnership({issue: fresh, developer, planUnits: units, ledgerRecord: record, allowedPathsSeed: splitList(flags['allowed-paths'])})
    if (!recheck.ok) return {ok: false, bounce: recheck.bounce, guidance: '판정 이후 다른 개발자가 먼저 배정했습니다 — 다른 티켓을 선택하세요'}
    if (io.gh) await io.gh(assignArgs(repo, record.ticketKey, developer))
    else await provider.assign(record.ticketKey, developer)
    // 사후 다중배정 감지 — 동시 self-assign이 겹쳤으면 정직 경고(선착 양보 규약은 사람 조율)
    // **사후 검사는 "최종 배정자가 나인가"다.** 종전에는 `assignees.length > 1`만 봤는데,
    // 그것은 GitHub의 add-assignee가 additive라서 성립하던 조건이다. Jira의
    // `PUT /assignee`는 **교체**라 A→B 순서로 겹치면 A의 사후 조회가 `[B]`(길이 1)를 보고
    // 통과한다 — lost-update가 침묵으로 지나간다. 조건을 소유 기준으로 바꾸면 두 트래커에서
    // 같은 뜻이 된다.
    const after = await fetchIssue(record.ticketKey)
    const finalAssignees = after.assignees ?? []
    if (!finalAssignees.includes(developer)) {
      return {ok: false, bounce: {reason: 'assign-lost', assignees: finalAssignees},
        guidance: '배정 직후 다른 개발자가 배정을 가져갔습니다 — 다른 티켓을 선택하거나 팀과 조율하세요(자동 판정하지 않음)'}
    }
    if (finalAssignees.length > 1) {
      return {ok: false, bounce: {reason: 'multi-assign-detected', assignees: finalAssignees}, guidance: '동시 배정이 감지됐습니다 — 팀과 조율해 한 명이 양보하세요(자동 판정하지 않음)'}
    }
  }
  // **상태 전이 — 능력이 있을 때만.** GitHub Issues는 open/closed뿐이라 전이가 없다.
  // 없으면 조용히 넘기지 않고 `transition: {supported: false}`로 **표시한다** — 안 한 것과
  // 못 한 것을 구분하지 않으면 사용자는 티켓이 진행중으로 바뀐 줄 안다.
  const caps = providerCapabilities(provider)
  let transition = {supported: caps.transition, done: false}
  if (caps.transition) {
    try {
      const result = await provider.transition(record.ticketKey, 'in-progress')
      transition = {supported: true, done: Boolean(result?.transitioned), ...(result?.reason ? {reason: result.reason} : {})}
    } catch (error) {
      // 배정은 이미 됐다. 전이 실패로 픽업을 되돌리지 않되 **실패를 감추지도 않는다.**
      transition = {supported: true, done: false, error: String(error?.message ?? error).slice(0, 200)}
    }
  }
  // **개정은 픽업 끝에 다시 잰다**(배정·전이가 있었다면 그 뒤) — 그 전 값을 적으면 우리가 한 배정이
  // 나중에 「픽업 뒤 티켓이 바뀌었다」로 읽힌다. 재조회가 실패하거나 **빈 값을 주면** 픽업 전 값을 두고
  // 단계도 그대로 두며 이유를 적는다 — 아무것도 못 가져온 것을 「정착했다」로 적지 않는다.
  try {
    const settled = await fetchIssue(record.ticketKey)
    if (!settled?.revision) throw new Error('settle-fetch-empty')
    pick.changeScope.ticket = {...pick.changeScope.ticket, revision: settled.revision, revisionStage: 'settled-at-pickup'}
  } catch (error) {
    pick.changeScope.ticket = {...pick.changeScope.ticket, revisionError: String(error?.message ?? error).slice(0, 200)}
  }
  const written = writeChangeScopeFile(root, pick.changeScope)
  return {ok: true, dryRun: false, assignment: pick.assignment, changeScope: pick.changeScope, changeScopePath: written, freshness, transition}
}

/**
 * 되돌림을 **기획자에게** 알린다 — 개발자 터미널에서 끝나면 기획자는 막힌 사실을 모른다
 * (`readiness.mjs` 머리말). 기획자가 할 일이 없는 되돌림(배정 경합·인젝션 의심)은
 * `bounceComment`가 `null`을 내므로 티켓이 소음으로 차지 않는다.
 *
 * **안 한 것과 못 한 것을 구분해 표시한다** — `transition`에 쓴 규율 그대로다. 실패해도
 * 되돌림 자체를 뒤집지 않는다: 알림이 안 갔다고 픽업이 통과하면 게이트가 알림에 종속된다.
 */
export async function notifyPlanner({provider, ticketKey, featureId, bounce, io = {}, dryRun = false, readinessLanguage = null}) {
  // 상세는 **ID 목록**이라 언어 중립이다 — 문장으로 감싸면 그 문장이 하드코딩된 언어가 된다.
  const detail = bounce?.unmatchedTcs?.length ? `TC: ${bounce.unmatchedTcs.join(', ')}`
    : bounce?.unmetDeps?.length ? `FEAT: ${bounce.unmetDeps.join(', ')}` : null
  const text = bounceComment({featureId, reason: bounce?.reason, missing: bounce?.missing ?? [], detail,
    outputLanguage: bounce?.outputLanguage ?? readinessLanguage})
  if (!text) return {}
  // **미리보기는 트래커에 쓰지 않는다.** 코멘트는 지울 수 없는 부작용이고, 이 파일 머리말이
  // 이미 그 규율을 선언한다 — 알림을 dry-run 검사보다 앞에 두면서 그것을 어겼다(적대 리뷰).
  if (dryRun) return {notified: {supported: null, done: false, reason: 'dry-run'}}
  const post = io.comment ?? (typeof provider?.comment === 'function' ? provider.comment.bind(provider) : null)
  if (!post) return {notified: {supported: false, done: false}}
  try {
    await post(ticketKey, text)
    return {notified: {supported: true, done: true}}
  } catch (error) {
    return {notified: {supported: true, done: false, error: String(error?.message ?? error).slice(0, 200)}}
  }
}

/**
 * intake: **사람이 쓴 티켓을 공급 원문으로 받는다.** 새 파이프라인이 아니라 입구 하나를 더 여는 것이다 —
 * 티켓 본문은 PRD·슬라이드와 같은 공급 원문이고, `00_source/` 인벤토리에 들어가면 그다음은
 * 이미 있는 경로(`source-artifact-ingestor` → `feature-planner`)가 처리한다.
 *
 * **요구사항을 뽑지 않는다.** 산문에서 FEAT·TC를 만드는 것은 LLM의 일이고, 스크립트가 흉내
 * 내면 그것이 곧 지어내기다. 여기서는 스냅샷과 인벤토리 한 행까지만 한다.
 *
 * **본문은 비신뢰 데이터다** — 격리 펜스로 감싸고 인젝션 의심을 인벤토리에 표시한다.
 */
export async function runIntake({root, repo, ticketKey, flags, io = {}}) {
  if (!ticketKey) return {ok: false, bounce: {reason: 'no-ticket'}, guidance: 'intake <티켓키> 형태로 부르세요'}
  const resolved = resolveTicketProvider({root, repo, flags, io})
  if (resolved.choice.needsChoice) {
    return {ok: false, bounce: {reason: 'ticket-provider-unset'},
      guidance: '티켓 provider 설정이 없습니다 — `configure`로 먼저 정하세요'}
  }
  const provider = resolved.provider
  const fetchIssue = key => (io.resolveIssue ? io.resolveIssue({repo, number: key}) : provider.resolveIssue(key))
  const issue = await fetchIssue(ticketKey)
  if (!issue) return {ok: false, bounce: {reason: 'ticket-not-found'}, guidance: `${ticketKey}를 트래커에서 찾지 못했습니다`}
  const injection = scanUntrustedIssue(issue) // 코멘트도 스냅샷에 실리므로 같이 스캔한다
  // **분류는 명시할 때만 받는다.** 없으면 `미분류`이고 ingestor가 정한다 — 스크립트가
  // 추측하면 버그 티켓이 기획 입력으로 세어져 요구사항이 지어내진다.
  // 분류의 우선순위: **운영자 명시 > 팀이 선언한 컴포넌트 매핑 > 미분류.**
  // 셋 다 없으면 추측하지 않고 ingestor가 본문을 읽어 정한다.
  const axis = resolved.config?.jira?.componentAxis ?? null
  const byComponent = classifyByComponent(issue.components ?? [], axis)
  // **개발 티켓은 공급 원문이 아니다.** 파이프라인의 출력을 다시 입력으로 들이면 자기가 만든
  // 요구사항을 기획으로 재수집하는 순환이 된다.
  if (byComponent?.role === DEV_TICKET) {
    return {ok: false, bounce: {reason: 'dev-ticket-not-source', by: byComponent.by},
      guidance: `${ticketKey}는 개발 티켓입니다(${byComponent.by}) — 공급 원문이 아닙니다. `
        + '기획 티켓을 인테이크하거나, 이 티켓을 착수하려면 `pickup`을 쓰세요.'}
  }
  const plan = planIntake({
    ticketKey, title: issue.title, body: issue.body, url: issue.url ?? null,
    provider: provider.name, fetchedAt: new Date().toISOString(), injection,
    declaredType: issue.declaredType ?? null, labels: issue.labels ?? [],
    components: issue.components ?? [], contextLines: ticketContextLines(issue),
    ...(flags?.as ? {classification: flags.as, classifiedBy: 'operator'}
      : byComponent ? {classification: byComponent.classification, classifiedBy: byComponent.by} : {}),
  })
  const indexPath = join(root, '_workspace/00_source/source-index.md')
  const existing = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : ''
  const merged = appendInventory(existing, plan.row, plan.digest)
  if (flags?.['dry-run']) {
    return {ok: true, dryRun: true, snapshotPath: plan.snapshotPath, digest: plan.digest,
      wouldAppend: merged.added, injection, nextStep: plan.nextStep}
  }
  // 인벤토리 표기는 **`_workspace` 기준 상대 경로**다(`source-artifacts.md` 예시 그대로) —
  // 실제 쓰기는 그 접두를 붙인다. 둘을 섞으면 표에 적힌 경로에 파일이 없다.
  mkdirSync(join(root, '_workspace/00_source/fetched'), {recursive: true})
  writeFileSync(join(root, '_workspace', plan.snapshotPath), plan.snapshot)
  if (merged.added) writeFileSync(indexPath, merged.text)
  return {
    ok: true, snapshotPath: plan.snapshotPath, digest: plan.digest,
    classification: plan.classification, classifiedBy: plan.classifiedBy,
    inventory: merged.added ? 'appended' : merged.reason, injection, nextStep: plan.nextStep,
  }
}

/**
 * bind: **기획 티켓과 그 티켓에서 나온 FEAT를 출처로 잇는다.**
 *
 * **청구가 아니다.** 개발자가 픽업하는 것은 `claim`이 발행한 개발 티켓이고(팀의 `DEVELOP`
 * 컴포넌트), 기획 티켓은 출처로 남는다. 원장을 쓰지 않는 이유가 그것이다 — 원장에 기획
 * 티켓을 청구로 적으면 픽업이 기획 티켓을 개발 티켓으로 착각한다.
 *
 * 남기는 것 둘: 기획 티켓 본문의 **출처 마커**(왕복 마커와 다른 이름이다)와, 인벤토리
 * 「소비 지점」 열의 FEAT — 「받은 것과 쓴 것을 맞춘다」는 그 계약의 존재 이유 그대로다.
 */
export async function runBind({root, repo, featureId, ticketKey, flags, io = {}}) {
  if (!featureId || !ticketKey) {
    return {ok: false, bounce: {reason: 'missing-args'}, guidance: 'bind <FEAT-NNN> <기획 티켓키> 형태로 부르세요'}
  }
  const resolved = resolveTicketProvider({root, repo, flags, io})
  if (resolved.choice.needsChoice) {
    return {ok: false, bounce: {reason: 'ticket-provider-unset'}, guidance: '티켓 provider 설정이 없습니다 — `configure`로 먼저 정하세요'}
  }
  const provider = resolved.provider
  // **계획 부재를 예외로 흘리지 않는다.** `bind`는 기획 티켓을 **출처**로 잇는 문이므로
  // 정규화 경로가 없다 — 계획이 없으면 `intake`로 기획을 받는 것이 유일한 길이고, 그 말을
  // 한다. 종전에는 `MISSING_PLAN`이 그대로 stderr로 나가 「파일 없음 + 기계용 우회 플래그」가
  // 개발자가 받는 전부였다(실측 2026-09-09).
  let units
  try { units = loadUnits(root, flags ?? {}) }
  catch (error) {
    if (!String(error?.message ?? '').startsWith('MISSING_PLAN')) throw error
    return {ok: false, bounce: {reason: 'missing-plan'},
      guidance: `${PLAN_RELATIVE}가 없어 ${featureId}를 걸 단위가 없습니다 — `
        + '기획 티켓을 `intake`로 받아 계획을 먼저 세우세요'}
  }
  const unit = units.find(item => item.featureId === featureId) ?? null
  const indexPath = join(root, '_workspace/00_source/source-index.md')
  const sourceIndex = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : ''
  const issue = await (io.resolveIssue ? io.resolveIssue({repo, number: ticketKey}) : provider.resolveIssue(ticketKey))
  if (!issue) return {ok: false, bounce: {reason: 'ticket-not-found'}, guidance: `${ticketKey}를 찾지 못했습니다`}

  const verdict = checkBind({ticketKey, featureId, unit, sourceIndex, body: issue.body})
  if (!verdict.ok) return {ok: false, bounce: {reason: verdict.reason}, guidance: verdict.guidance}

  const marker = buildSourceMarker([featureId])
  const stamped = stampSourceInto(issue.body ?? '', marker)
  const consumption = recordConsumption(sourceIndex, ticketKey, featureId)
  if (flags?.['dry-run']) {
    return {ok: true, dryRun: true, featureId, ticketKey,
      stamp: stamped === null ? 'already-stamped' : 'would-append',
      inventory: consumption.updated ? 'would-record' : consumption.reason,
      capabilities: {updateBody: typeof provider.updateBody === 'function'}}
  }
  let stamp = 'already-stamped'
  if (stamped !== null) {
    if (typeof provider.updateBody !== 'function') {
      return {ok: false, bounce: {reason: 'update-body-unsupported'},
        guidance: `${provider.name} provider가 본문 쓰기를 제공하지 않습니다 — 출처 마커를 손으로 붙이거나 provider를 확장하세요`}
    }
    await (io.updateBody ?? provider.updateBody.bind(provider))(ticketKey, stamped)
    stamp = 'appended'
  }
  if (consumption.updated) writeFileSync(indexPath, consumption.text)
  return {
    ok: true, featureId, ticketKey, stamp,
    inventory: consumption.updated ? 'recorded' : consumption.reason,
    nextStep: `claim으로 ${featureId}의 개발 티켓을 발행한 뒤 pickup ${featureId} 합니다`
      + ' — 기획 티켓은 출처로 남고 개발자가 픽업하는 것은 개발 티켓입니다',
  }
}

/**
 * adopt: **개발자가 직접 쓴 개발 티켓을 하네스가 아는 것으로 만든다.**
 *
 * `bind`와 다르다 — `bind`는 기획 티켓을 **출처**로 잇고 원장을 쓰지 않는다. `adopt`는 개발
 * 티켓을 **청구**로 올리고 왕복 마커를 찍어 픽업 대상으로 만든다.
 *
 * 이 경로가 없으면 개발자가 직접 쓴 티켓은 어느 문으로도 못 들어온다(자체 실측으로 확인).
 */
export async function runAdopt({root, repo, featureId, ticketKey, flags, io = {}}) {
  if (!featureId || !ticketKey) {
    return {ok: false, bounce: {reason: 'missing-args'}, guidance: 'adopt <FEAT-NNN> <개발 티켓키> 형태로 부르세요'}
  }
  const resolved = resolveTicketProvider({root, repo, flags, io})
  if (resolved.choice.needsChoice) {
    return {ok: false, bounce: {reason: 'ticket-provider-unset'}, guidance: '티켓 provider 설정이 없습니다 — `configure`로 먼저 정하세요'}
  }
  const provider = resolved.provider
  // **계획 부재를 예외로 흘리지 않는다.** 처방 없는 멈춤은 개발자를 티켓 흐름 밖으로 보낸다.
  let units
  try { units = loadUnits(root, flags ?? {}) }
  catch (error) {
    if (!String(error?.message ?? '').startsWith('MISSING_PLAN')) throw error
    if (!flags?.normalize) {
      return {ok: false, bounce: {reason: 'missing-plan'},
        guidance: `${PLAN_RELATIVE}가 없어 이 티켓을 걸 단위가 없습니다 — 이 개발 티켓의 내용으로 `
          + `FEAT를 만들려면 \`adopt ${featureId} ${ticketKey} --normalize\`로 부르세요. `
          + '기획을 먼저 세우려면 기획 티켓을 `intake`로 받으세요'}
    }
    units = []
  }
  const unit = units.find(item => item.featureId === featureId) ?? null
  const ledgerFile = join(root, LEDGER_RELATIVE)
  const record = (io.readState ?? readLedgerState)(ledgerFile).get(featureId) ?? null
  const issue = await (io.resolveIssue ? io.resolveIssue({repo, number: ticketKey}) : provider.resolveIssue(ticketKey))
  if (!issue) return {ok: false, bounce: {reason: 'ticket-not-found'}, guidance: `${ticketKey}를 찾지 못했습니다`}

  // ── 정규화 ───────────────────────────────────────────────────────────────
  // 단위가 없고 `--normalize`면 **티켓 본문으로 FEAT 단위를 만든다.** 출처 판정은
  // `checkAdopt`가 그대로 하므로 기획 티켓은 여기까지 오지 못한다 — 정규화가 그 문을 열지
  // 않는다는 뜻이며, 순서를 바꾸면(정규화를 먼저 하면) 기획 티켓이 계획에 섞인다.
  let normalized = null
  if (!unit && flags?.normalize) {
    // **`--units`와 함께 쓰지 않는다.** 멱등 판정은 JSON을 보고 쓰기는 디스크 계획에 하므로,
    // JSON이 디스크보다 낡으면 같은 티켓이 두 번 정규화된다(적대 리뷰 2026-09-09).
    if (flags?.units) {
      return {ok: false, bounce: {reason: 'normalize-with-units-unsupported'},
        guidance: '`--units`와 `--normalize`는 함께 쓸 수 없습니다 — 멱등 판정과 쓰기 대상이 갈라집니다'}
    }
    const axis = resolved.config?.jira?.componentAxis ?? null
    const gate = checkAdopt({ticketKey, featureId, unit: {featureId}, ledgerRecord: record,
      body: issue.body, components: issue.components ?? [], axis})
    if (!gate.ok) return {ok: false, bounce: {reason: gate.reason}, guidance: gate.guidance}
    // **정규화는 「개발 티켓이 아닌 것」이 아니라 「개발 티켓인 것」을 요구한다.** 일반 `adopt`는
    // 미분류를 통과시키지만(축을 안 쓰는 팀도 인수는 해야 한다), 정규화는 **공유 계획 파일에
    // 쓴다** — 축이 없으면 기획 티켓과 구별할 수단이 없고, 실측에서 componentAxis 미설정 시
    // component:PLAN 티켓이 그대로 통과했다(적대 리뷰 2026-09-09).
    const role = classifyByComponent(issue.components ?? [], axis)
    if (role?.role !== DEV_TICKET) {
      return {ok: false, bounce: {reason: 'normalize-needs-dev-ticket'},
        guidance: `${ticketKey}가 개발 티켓이라는 근거가 없습니다(${role ? role.classification : '컴포넌트 축 미설정'}) — `
          + '`configure`로 `componentAxis`를 선언하세요. 정규화는 공유 계획에 쓰므로 추측하지 않습니다'}
    }
    // 이미 **출처로** 인테이크된 티켓은 개발 단위로 만들지 않는다 — 그러면 왕복 마커가 찍혀
    // `bind`에서 영구 거부되고, 기획 입력이 개발 단위로 둔갑한다.
    if (String(issue.body ?? '').includes('web-harness:source')) {
      return {ok: false, bounce: {reason: 'already-intaken-as-source'},
        guidance: `${ticketKey}는 이미 공급 원문으로 인테이크돼 있습니다 — 개발 단위로 만들지 않습니다`}
    }
    // **비신뢰 본문이다.** 트래커 본문은 외부 입력이고, 정규화는 그것을 `plan-reviewer`·
    // `system-architect`·`spec.mjs`가 신뢰 텍스트로 읽는 파일에 넣는다. `intake`는 같은 입력을
    // 격리 펜스로 감싸는데 이 입구만 맨몸이면 격리 하한이 입구마다 다른 것이다(I6).
    const suspect = scanUntrustedBody(`${issue.title ?? ''}\n${issue.body ?? ''}`)
    if (suspect.injectionSuspect) {
      return {ok: false, bounce: {reason: 'normalize-untrusted-body', markers: suspect.markers},
        guidance: `${ticketKey} 본문에 지시문으로 읽힐 수 있는 내용이 있습니다(${suspect.markers.join(' · ')}) — `
          + '계획에 그대로 넣지 않습니다. 본문을 다듬거나 `intake`로 격리 스냅샷을 만드세요'}
    }
    // **멱등성.** 같은 티켓을 두 번 정규화하면 FEAT가 갈라지고 원장은 하나만 안다.
    const already = findFeatureForTicket(units, ticketKey)
    if (already) {
      return {ok: false, bounce: {reason: 'ticket-already-normalized'},
        guidance: `${ticketKey}는 이미 ${already.featureId}로 정규화돼 있습니다 — `
          + `\`adopt ${already.featureId} ${ticketKey}\`로 부르세요(--normalize 없이)`}
    }
    const section = renderTicketUnit({featureId, title: issue.title ?? ticketKey, ticketKey,
      body: issue.body ?? '', dependsOn: flags['depends-on'] ?? null})
    // **한 단위인지 센다.** 본문에 `## FEAT-009 관련 작업` 같은 줄이 있으면(개발자가 다른
    // FEAT를 참조하는 흔한 서술) 파서가 섹션을 끊어 **유령 단위**가 계획에 생기고 이 FEAT의
    // 본문은 절단된다 — 실측에서 단위가 2개가 됐고 `claim`이 그 유령을 티켓으로 발행한다.
    // `find`로 이 FEAT만 확인하면 그 변형을 통과시킨다(적대 리뷰 2026-09-09).
    const parsed = parseFeaturePlanUnits(section)
    if (parsed.length !== 1 || parsed[0].featureId !== featureId) {
      return {ok: false, bounce: {reason: 'normalize-ambiguous'},
        guidance: `티켓 본문이 FEAT 섹션 ${parsed.length}개로 읽힙니다(${parsed.map(item => item.featureId).join(', ') || '없음'}) — `
          + '본문의 `## FEAT-NNN` 줄을 지우거나 목록으로 바꾼 뒤 다시 부르세요. '
          + '그대로 두면 계획에 없는 FEAT가 생기고 `claim`이 그것을 티켓으로 발행합니다'}
    }
    normalized = {section, unit: parsed[0], suggestedNext: nextFeatureId(units)}
  }
  if (!unit && normalized === null) {
    // 처방에 **계단을 붙인다.** 종전에는 "FEAT를 먼저 만든다"까지만 말하고 만드는 길이 없었다.
    const verdict = checkAdopt({ticketKey, featureId, unit, ledgerRecord: record, body: issue.body,
      components: issue.components ?? [], axis: resolved.config?.jira?.componentAxis ?? null})
    if (verdict.reason === 'unknown-feature') {
      return {ok: false, bounce: {reason: verdict.reason},
        guidance: `${verdict.guidance} — 티켓 본문으로 만들려면 `
          + `\`adopt ${nextFeatureId(units)} ${ticketKey} --normalize\``}
    }
    return {ok: false, bounce: {reason: verdict.reason}, guidance: verdict.guidance}
  }
  if (unit) {
    const verdict = checkAdopt({ticketKey, featureId, unit, ledgerRecord: record, body: issue.body,
      components: issue.components ?? [], axis: resolved.config?.jira?.componentAxis ?? null})
    if (!verdict.ok) return {ok: false, bounce: {reason: verdict.reason}, guidance: verdict.guidance}
  }

  // 정규화한 경우 이후 경로가 읽는 단위는 **방금 만든 섹션을 파싱한 것**이다 — 렌더한 것과
  // 파서가 읽는 것이 갈라지면 contentHash가 계획 파일과 어긋난다.
  const adopted = unit ?? parseFeaturePlanUnits(normalized.section).find(item => item.featureId === featureId) ?? null
  if (!adopted) {
    return {ok: false, bounce: {reason: 'normalize-unparsable'},
      guidance: `만든 FEAT 섹션을 파서가 되읽지 못했습니다(${featureId}) — 티켓 제목·본문에 FEAT 헤딩 형식을 깨는 것이 있는지 보세요`}
  }
  const marker = buildRefsMarker([featureId], adopted.testCaseIds ?? [], {branch: flags?.branch ?? null})
  const stamped = stampRefsInto(issue.body ?? '', marker)
  const ledgerRecord = adoptLedgerRecord({
    featureId, ticketKey, provider: provider.name,
    contentHash: (await import('./emit.mjs')).unitContentHash(adopted), now: new Date().toISOString(),
  })
  if (flags?.['dry-run']) {
    return {ok: true, dryRun: true, record: ledgerRecord,
      stamp: stamped === null ? 'already-stamped' : 'would-append',
      normalize: normalized === null ? null : {featureId, target: planAppendTarget(root), section: normalized.section},
      capabilities: {updateBody: typeof provider.updateBody === 'function'}}
  }
  // **계획 파일이 원장·스탬프보다 먼저다.** 정규화가 실패했는데 원장에 청구가 남으면
  // 「계획에 없는 FEAT가 청구된」 상태가 되고, 다음 `pickup`은 그 FEAT를 못 찾는다.
  // 능력 검사는 **첫 쓰기 앞이다** — 정보가 처음부터 있는데 계획을 쓴 뒤 반려하면 불필요한
  // 부분 쓰기가 남는다(적대 리뷰 2026-09-09).
  if (stamped !== null && typeof provider.updateBody !== 'function' && !io.updateBody) {
    return {ok: false, bounce: {reason: 'update-body-unsupported'},
      guidance: `${provider.name} provider가 본문 쓰기를 제공하지 않습니다 — 마커를 손으로 붙이거나 provider를 확장하세요`}
  }
  let planWrite = null
  if (normalized !== null) {
    planWrite = appendPlanSection(root, normalized.section)
  }
  // **스탬프가 원장보다 먼저다.** 원장을 먼저 쓰고 스탬프가 실패하면 「청구됐는데 티켓은
  // 모르는」 상태가 남고, 픽업이 그 티켓을 알아보지 못한 채 원장만 부풀어 있다.
  let stamp = 'already-stamped'
  if (stamped !== null) {
    if (typeof provider.updateBody !== 'function') {
      return {ok: false, bounce: {reason: 'update-body-unsupported'},
        guidance: `${provider.name} provider가 본문 쓰기를 제공하지 않습니다 — 마커를 손으로 붙이거나 provider를 확장하세요`}
    }
    await (io.updateBody ?? provider.updateBody.bind(provider))(ticketKey, stamped)
    stamp = 'appended'
  }
  ;(io.appendLedger ?? appendClaimRecord)(ledgerFile, ledgerRecord)
  // **착수 가능을 함부로 주장하지 않는다.** `claimScopeReadiness`는 `dependsOn` 미선언을
  // `deps-undeclared`로 막는다 — 운영자가 `--depends-on`을 주지 않았으면 픽업은 아직 막혀
  // 있고, 「착수할 수 있습니다」는 거짓이다(적대 리뷰 2026-09-09: 실측으로 미선언 확인).
  const declaredDeps = planWrite === null || Boolean(flags?.['depends-on'])
  return {ok: true, record: ledgerRecord, stamp, normalize: planWrite,
    nextStep: planWrite === null
      ? `pickup ${featureId} --developer <login> 으로 착수할 수 있습니다`
      : `${planWrite.target}에 ${featureId}를 만들었습니다 — 기획을 거치지 않은 단위입니다. `
        + (declaredDeps
          ? `pickup ${featureId} --developer <login> 으로 착수할 수 있습니다`
          : `착수하려면 **선행 의존을 선언해야 합니다** — 계획의 unit 마커에 \`dependsOn=none\`(또는 FEAT 목록)을 `
            + `적거나 \`--depends-on none\`으로 다시 부르세요. 미선언은 \`deps-undeclared\`로 픽업이 막힙니다`)}
}

/**
 * 정규화한 FEAT 섹션을 붙일 파일(순수 판정 + 디스크 조회). flat이면 그 파일, sharded면
 * **정렬 마지막 샤드**다(`decision-log`가 "최신 ID 구간 절에 append"라고 정한 것과 같은 관용구).
 * 계획이 아예 없으면 flat을 새로 만든다 — 이 경로는 `--normalize`에서만 온다.
 */
export function planAppendTarget(root) {
  const location = resolvePlanLocation(root)
  if (!location) return PLAN_RELATIVE
  return location.shards[location.shards.length - 1]
}

/** 섹션을 계획에 덧붙인다. 덧붙이기만 한다 — 기존 내용을 고쳐 쓰지 않는다. */
export function appendPlanSection(root, section) {
  const target = planAppendTarget(root)
  const absolute = join(root, target)
  mkdirSync(dirname(absolute), {recursive: true})
  const before = existsSync(absolute) ? readFileSync(absolute, 'utf8') : '# Feature Plan\n'
  writeFileSync(absolute, `${before.replace(/\s+$/, '')}\n${section}`)
  return {target, featureIdCreated: true}
}

/**
 * link: PR↔원장 연결. 게이트 — change-scope STALE이면 완료 차단(C 계약) → 원장 대조 close
 * 참조(verified만 Closes) → 멱등(computePrLinkPlan) → 원장 append(`--dry-run`이면 생략).
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
      closeLine: renderCloseLineFor(recordProvider(record), computeCloseLink({featureId, ticketKey: record?.ticketKey ?? null, ledgerState: state})),
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
  // **자동 닫기 서식은 트래커가 정한다.** 종전에는 무조건 GitHub 서식이라 Jira 키에도
  // `Closes #PROJ-7`이 실렸다 — GitHub도 Jira도 닫지 않는데 PR 본문이 닫힌다고 주장했다.
  // 그 트래커에 자동 닫기가 없으면 닫는다고 적지 않고, 머지 후 전이가 필요하다고 적는다.
  const closeLine = renderCloseLineFor(recordProvider(record), closeLink)
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
    // **이 PR이 어느 티켓 개정을 보고 개발됐는가** — 티켓 → change-scope → PR 사슬의 마지막 고리.
    // 대조한 change-scope일 때만 싣는다(다른 FEAT의 것이면 이 PR의 근거가 아니다).
    ...(staleCheck === 'verified' && changeScope?.ticket ? {ticket: changeScope.ticket} : {}),
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
      case 'intake': requireRepo(); return runIntake({root, repo, ticketKey: positional[0], flags})
      case 'bind': requireRepo(); return runBind({root, repo, featureId: positional[0], ticketKey: positional[1], flags})
      case 'adopt': requireRepo(); return runAdopt({root, repo, featureId: positional[0], ticketKey: positional[1], flags})
      case 'configure': return runConfigure({root, flags})
      default: throw new Error(`UNKNOWN_COMMAND: ${command ?? '(없음)'} — claim|pickup|link|board|intake|bind|adopt|configure`)
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
