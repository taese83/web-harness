#!/usr/bin/env node
// 팀 워크플로우 — executor CLI. team-flow 스킬이 호출하는 실행부 글루.
//
// 모델은 **WORK 하나**다(FEAT 개발 티켓의 claim·pickup·board·link·bind·adopt는 2026-09-14 제거 —
// 게이트는 WORK 경로로 이관됐고 대응표는 `references/work-plan-contract.md`에 있다).
//   claim [--publish [--confirm]] · pickup <키> · link <키> <PR> · board · intake <키> · configure
//
// 실행 환경(정직 경계): **플러그인 배포판 전용**이다 — 하네스 저장소 자체 세션은 global bash
// policy가 gh/git·미등재 스크립트를 차단하며, 등재하지 않기로 결정했다(repo 안전 정책 비약화).
//
// side-effect 규율: `claim --publish`·`configure`는 `--confirm` 없이 미리보기다. `pickup`·`link`·`intake`는
// **사용자의 요청이 곧 승인**이며 `--dry-run`으로 미리본다.
import {flowEntry, flowRecordNote, recordFlow} from './flow-log.mjs'
import {DEV_TICKET, appendInventory, classifyByComponent, planIntake} from './intake.mjs'
import {scanUntrustedIssue, ticketContextLines} from './pickup.mjs'
import {bounceComment} from './readiness.mjs'
import {existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync} from 'node:fs'
import {basename, dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {refreshRemoteRefs} from './git-origin.mjs'
import {createGithubProvider} from './provider-github-exec.mjs'
import {createJiraProvider} from './provider-jira-exec.mjs'
import {requireTicketProvider} from './ticket-provider.mjs'
import {assertAllowedKeys, buildTicketConfig, evaluateConfigWrite, JIRA_AUTH_ENV, JIRA_QUESTIONS, PROVIDER_QUESTIONS, readTicketConfig, resolveProviderChoice, TICKET_CONFIG_RELATIVE, writeTicketConfig} from './ticket-config.mjs'
import {parseFeaturePlanUnits} from './plan-units.mjs'

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

// 티켓 이슈 자동 닫기 자산 — WORK 원장 기반(v2). 개발 준비 검사(`validate-development-readiness`)가 설치한다.
// 설치본에는 판본 표지가 있다 — 옛 청구 원장을 읽는 v1 사본이 남아 있으면 **덮지 않고 알린다**(손본 사본일 수 있다).
export const TICKET_CLOSE_VERSION_MARKER = 'web-harness:ticket-close v5'
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
  const outdated = []
  const missingAssets = []
  for (const entry of TICKET_CLOSE_ASSETS) {
    const source = join(assetsRoot, entry.asset)
    if (!existsSync(source)) { missingAssets.push(entry.asset); continue }
    const target = join(root, entry.target)
    if (!existsSync(target)) { install.push({...entry, source}); continue }
    // 판본 표지가 없는 사본은 옛 원장을 읽는다 — WORK 티켓을 닫지 않으면서 설치됨으로 보인다.
    if (readFileSync(target, 'utf8').includes(TICKET_CLOSE_VERSION_MARKER)) present.push(entry.target)
    else outdated.push(entry.target)
  }
  return {install, present, outdated, missingAssets}
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
  if (!location) throw new Error(`MISSING_PLAN: ${PLAN_RELATIVE} 또는 ${PLAN_DIR_RELATIVE}/ 없음(--units로 지정 가능) — 기획 없이 기능만 구현하려면 개발 티켓을 만들어(create 또는 트래커에서 직접) pickup한다`)
  return location.shards.flatMap(relative => parseFeaturePlanUnits(readFileSync(join(root, relative), 'utf8')))
}

// 계획 본문(flat·sharded)과 소스에서 인용된 TC ID — 완료 조건 판정의 입력.
export function loadPlanText(root, flags) {
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

/** origin 판정 전 remote-tracking을 갱신한다. 실패해도 막지 않고 **스냅샷 기준임을 표기**한다
 * — git-origin의 "선행하거나 표기하거나" 경고 중 둘 다 하는 쪽이다. `--no-fetch`로 끌 수 있다
 * (네트워크 없는 환경·테스트). 결과는 각 모드 응답의 `freshness`로 나간다. */
export async function ensureRemoteFreshness({root, flags, io}) {
  if (flags?.['no-fetch']) return {fetched: false, basis: 'local-snapshot', reason: 'disabled by --no-fetch'}
  const result = await (io.refresh ?? refreshRemoteRefs)({repoRoot: root})
  return result.ok
    ? {fetched: true, basis: 'origin'}
    : {fetched: false, basis: 'local-snapshot', reason: result.reason}
}

/**
 * 이번 실행의 티켓 provider를 정한다. **설정이 정본이다** — 설정이 없으면 묻는다.
 * (FEAT 청구 원장의 기록으로 「이미 GitHub이다」를 추론하던 하위호환 규칙은 그 경로와 함께 제거됐다.)
 *
 * @returns {{provider?: Object, choice: Object, questions?: Array}}
 */
export function resolveTicketProvider({root, repo, flags = {}, io = {}}) {
  // 주입 경로도 **설정을 함께 돌려준다** — 실제 경로와 다르면 회귀가 실물을 시험하지 못한다.
  if (io.provider) return {provider: io.provider, choice: {provider: io.provider.name ?? 'test', needsChoice: false},
    config: io.ticketConfig ?? null}
  const effective = io.ticketConfig ?? readTicketConfig(root)
  const choice = resolveProviderChoice({stored: effective, requested: flags['ticket-provider'] ?? null})
  if (choice.needsChoice) return {choice, questions: PROVIDER_QUESTIONS[choice.provider] ?? JIRA_QUESTIONS}
  if (choice.provider === 'jira') {
    if (!effective?.jira) {
      return {choice: {...choice, needsChoice: true}, questions: JIRA_QUESTIONS}
    }
    // 설정을 함께 돌려준다 — 인테이크가 `componentAxis` 선언을 읽는다(팀 어휘는 설정이 든다).
    // 계약을 **해석하는 자리에서** 확인한다 — 반쯤 구현된 provider가 발행 중간에 드러나지 않게.
    return {provider: requireTicketProvider(createJiraProvider({config: effective.jira, env: io.env ?? process.env})), choice, config: effective}
  }
  // host를 넘기지 않으면 createGithubProvider의 기본값(github.com)이 늘 이긴다 — GitHub
  // Enterprise 저장소에서 owner/name은 맞게 뽑히고 host만 유실돼 gh가 없는 저장소를 찾았다
  // (2026-09-02 실측). 실행부는 이미 host를 GH_HOST로 넘기게 돼 있었고 배선만 없었다.
  // **설정을 함께 돌려준다** — 종전에는 GitHub 분기만 빠져 있어서, 발행이 `workLink` 선언을 읽지
  // 못하고 어느 저장소에서도 영구 `PROVIDER_NOT_READY`였다(설정으로 풀 길이 없었다).
  return {provider: requireTicketProvider(createGithubProvider({repo, host: effective?.github?.host})), choice, config: effective}
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
    // 인증 안내는 **그 트래커의 것**이어야 한다 — GitHub 설정에 Jira 환경변수를 안내하던 것을 고친다(실 왕복 2026-09-15).
    note: provider === 'jira' ? `인증은 이 파일이 아니라 환경변수입니다: ${JIRA_AUTH_ENV.join(' · ')}`
      : '인증은 이 파일이 아니라 gh 로그인입니다(`gh auth status`로 확인 — Enterprise면 host별로 로그인한다)'}
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
 * 되돌림을 **기획자에게** 알린다 — 개발자 터미널에서 끝나면 기획자는 막힌 사실을 모른다
 * (`readiness.mjs` 머리말). 기획자가 할 일이 없는 되돌림(배정 경합·인젝션 의심)은
 * `bounceComment`가 `null`을 내므로 티켓이 소음으로 차지 않는다.
 *
 * **안 한 것과 못 한 것을 구분해 표시한다** — `transition`에 쓴 규율 그대로다. 실패해도
 * 되돌림 자체를 뒤집지 않는다: 알림이 안 갔다고 픽업이 통과하면 게이트가 알림에 종속된다.
 */
export async function notifyPlanner({provider, ticketKey, featureId, bounce, io = {}, dryRun = false, readinessLanguage = null}) {
  // 상세는 **ID 목록**이라 언어 중립이다 — 문장으로 감싸면 그 문장이 하드코딩된 언어가 된다.
  // 되돌림의 대상 목록(선행 작업 ID 등)은 **상세**다 — 체크리스트로 그리면 「채울 칸」처럼 읽힌다.
  const detail = bounce?.missing?.length ? bounce.missing.join(', ') : bounce?.workId ?? null
  const text = bounceComment({featureId, reason: bounce?.reason, detail, items: bounce?.needs ?? null,
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
  // 종류 선판정 — 파이프라인이 만든 WORK·aggregate 티켓을 공급 원문으로 되들이지 않는다(순환).
  const {classifyTicketKind} = await import('./work-refs.mjs')
  const ticketKind = classifyTicketKind(issue.body ?? '')
  if (['work', 'aggregate', 'conflict'].includes(ticketKind.kind)) {
    return {ok: false, bounce: {reason: `${ticketKind.kind}-ticket-not-source`},
      guidance: ticketKind.error ?? `${ticketKey}는 WORK 분해 모델의 티켓입니다 — 공급 원문이 아닙니다`}
  }
  // 마커가 지워져도 **원장은 안다**(T11) — 하네스가 발행한 WORK·집계 티켓을 공급 원문으로 되들이지 않는다.
  const {foldWorkState, readWorkEvents, WORK_EVENTS_PATH} = await import('./work-events.mjs')
  const ledger = foldWorkState(readWorkEvents(join(root, WORK_EVENTS_PATH)))
  const published = [...ledger.works.values(), ...ledger.aggregates.values()].some(item => item.ticketKey && String(item.ticketKey) === String(ticketKey))
  if (published) {
    return {ok: false, bounce: {reason: 'published-ticket-not-source'},
      guidance: `${ticketKey}는 원장에 이 계획이 발행한 티켓으로 기록돼 있습니다(본문 마커가 지워졌어도) — 공급 원문이 아닙니다`}
  }
  // **분류는 명시할 때만 받는다.** 없으면 `미분류`이고 ingestor가 정한다 — 스크립트가
  // 추측하면 버그 티켓이 기획 입력으로 세어져 요구사항이 지어내진다.
  // 분류의 우선순위: **운영자 명시 > 팀이 선언한 컴포넌트 매핑 > 미분류.**
  // 셋 다 없으면 추측하지 않고 ingestor가 본문을 읽어 정한다.
  const axis = resolved.config?.jira?.componentAxis ?? null
  const byComponent = classifyByComponent(issue.components ?? [], axis)
    ?? classifyByComponent(issue.labels ?? [], resolved.config?.github?.labelAxis ?? null)
  // **개발 티켓은 공급 원문이 아니다.** 파이프라인의 출력을 다시 입력으로 들이면 자기가 만든
  // 요구사항을 기획으로 재수집하는 순환이 된다.
  if (byComponent?.role === DEV_TICKET) {
    return {ok: false, bounce: {reason: 'dev-ticket-not-source', by: byComponent.by},
      guidance: `${ticketKey}는 개발 티켓입니다(${byComponent.by}) — 공급 원문이 아닙니다. `
        + '기획 티켓을 인테이크하세요. 사람이 만든 개발 티켓은 `pickup <키>`가 기획·디자인이 필요한지 판정한 뒤 WORK로 완성해 착수합니다.'}
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








// ---- main dispatch (스킬이 호출; 결과는 JSON 한 덩어리로 stdout) ----
// basename 동등 비교 — endsWith('cli.mjs')는 test-ticket-cli.mjs에도 매치돼 테스트 import 시
// dispatch가 오발화한다(실측). path.basename은 win32 구분자도 처리(리뷰 LOW).
const invokedDirectly = basename(process.argv[1] ?? '') === 'cli.mjs'
if (invokedDirectly) {
  const {command, positional, flags} = parseArgs(process.argv.slice(2))
  const root = flags.root ?? process.cwd()
  const repo = flags.repo ?? null
  const requireRepo = () => { if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('MISSING_REPO: --repo <owner/name> 필요') }
  // 트래커 사전 판정 — 발행·픽업·보드가 **같은 판정**을 쓴다(한곳만 다르면 GitHub 팀이 원시 INVALID_REPO를 본다).
  // 설정이 없으면 묻고, GitHub인데 `--repo`가 없으면 여기서 멈춘다.
  const tracker = () => {
    const resolved = resolveTicketProvider({root, repo, flags, io: {}})
    if (resolved.choice?.needsChoice) return {resolved, missing: 'provider'}
    if (resolved.choice?.provider === 'github' && (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo))) return {resolved, missing: 'repo'}
    return {resolved, missing: null}
  }
  // 티켓 키는 `pickup PF-1`과 `pickup --work PF-1` 둘 다 받는다 — 후자는 키가 `--work`의 값으로 파싱된다.
  // `--work`는 이제 **기본 모델**이라 붙여도 안 붙여도 같다(FEAT 개발 티켓 경로는 제거됐다).
  const args = typeof flags.work === 'string' ? [flags.work, ...positional] : positional
  const run = async () => {
    switch (command) {
      // 준비(P0)·검토(P1)는 트래커를 부르지 않는다. `--publish`는 검토한 판본을 낸다 — 확인 없이는 미리보기다.
      case 'claim': {
        if (!flags.publish) return (await import('./work-claim.mjs')).runClaimWork({root, flags})
        const {resolved, missing} = tracker()
        if (missing) {
          return {ok: false, mode: 'work', phase: 'PROVIDER_NOT_READY', externalWrites: 0, questions: resolved.questions ?? null,
            guidance: missing === 'provider' ? '어느 트래커에 발행할지 정한다 — `configure`로 기록한다(설정은 팀에 공유된다)'
              : 'GitHub에 발행하려면 `--repo <owner/name>`가 필요하다'}
        }
        // `--resolve`: 결과를 모르는 발행을 사람이 찾은 티켓으로 확정한다(본문 마커를 조회로 확인한다).
        if (flags.resolve) return (await import('./work-resolve-run.mjs')).runPublishResolve({root, flags, io: {provider: resolved.provider}})
        // `--aggregate`: FEAT 단위 집계 티켓(개발 대상이 아니다). 발행 규율은 WORK와 같다.
        if (flags.aggregate) return (await import('./work-aggregate-run.mjs')).runAggregatePublish({root, flags, io: {provider: resolved.provider, ticketConfig: resolved.config}})
        return (await import('./work-publish-run.mjs')).runWorkPublish({root, flags,
          io: {provider: resolved.provider, ticketConfig: resolved.config}})
      }
      case 'pickup': {
        const {resolved, missing} = tracker()
        if (missing) {
          return {ok: false, mode: 'work', bounce: {reason: missing === 'provider' ? 'ticket-provider-unset' : 'repo-required'},
            questions: resolved.questions ?? null,
            guidance: missing === 'provider' ? '티켓 provider 설정이 없다 — `configure`로 먼저 정한다' : 'GitHub 티켓을 집으려면 `--repo <owner/name>`가 필요하다'}
        }
        const {pickupOutcome, runWorkPickup} = await import('./work-pickup-run.mjs')
        const picked = await runWorkPickup({root, ticketKey: args[0] ?? null,
          developer: flags.developer, flags, io: {provider: resolved.provider, ticketConfig: resolved.config}})
        const result = {outcome: pickupOutcome(picked), ...picked}
        // 실측 기록(로컬, 게이트 아님) — dry-run은 흐름이 아니다.
        if (flags['dry-run']) return result
        return {...result, ...flowRecordNote(recordFlow(root, flowEntry({command: 'pickup', ticketKey: args[0] ?? null, developer: flags.developer, result})))}
      }
      // 완료 주장(PR 연결) — 내 로컬에 기록하고 PR 본문 문단을 돌려준다. 머지는 기록하지 않는다(보드·픽업이 PR에서 읽는다).
      case 'link': {
        const linkRun = await import('./work-link-run.mjs')
        // 트래커는 끝남·다시 연 시각과 사람 티켓의 원문 대조에 쓴다 — 설정이 없으면 로컬 기록만으로 간다.
        const linked = (() => { try { return resolveTicketProvider({root, repo: flags.repo, flags}) } catch { return {} } })()
        const io = linked.provider ? {provider: linked.provider, ticketConfig: linked.config} : {}
        const linkedResult = await linkRun.runWorkLink({root, ticketKey: args[0], prUrl: args[1], flags, io})
        if (flags['dry-run']) return linkedResult
        return {...linkedResult, ...flowRecordNote(recordFlow(root, flowEntry({command: 'link', ticketKey: args[0], result: linkedResult})))}
      }
      // 트래커 조회는 선택이며, 못 하면 로컬 기준임을 **적는다**.
      case 'board': {
        const {resolved, missing} = tracker()
        // `--by-feature`: 부모 FEAT 집계 — 머지·끝남은 트래커에서 읽는다(원장에는 완료가 없다).
        if (flags['by-feature']) return (await import('./work-aggregate-run.mjs')).runFeatureBoard({root, flags,
          io: {provider: missing ? null : resolved.provider, ticketConfig: resolved.config}})
        return (await import('./work-board.mjs')).runWorkBoard({root, developer: flags.developer ?? null, flags,
          io: {provider: missing ? null : resolved.provider, ticketConfig: resolved.config}})
      }
      case 'intake': requireRepo(); return runIntake({root, repo, ticketKey: positional[0], flags})
      case 'configure': return runConfigure({root, flags})
      // 기획 없이 기능만 구현하는 개발 티켓을 초안에서 만든다 — 손 티켓과 같은 것이라 다음은 pickup의 판정이다.
      case 'create': {
        const {resolved, missing} = tracker()
        if (missing) {
          return {ok: false, mode: 'create', phase: 'PROVIDER_NOT_READY', externalWrites: 0, questions: resolved.questions ?? null,
            guidance: missing === 'provider' ? '어느 트래커에 만들지 정한다 — `configure`로 기록한다' : 'GitHub에 만들려면 `--repo <owner/name>`가 필요하다'}
        }
        const createdResult = await (await import('./ticket-create-run.mjs')).runTicketCreate({root, flags, io: {provider: resolved.provider, ticketConfig: resolved.config}})
        if (!flags.confirm) return createdResult
        return {...createdResult, ...flowRecordNote(recordFlow(root, flowEntry({command: 'create', result: createdResult})))}
      }
      // 실측 집계 — 흐름 로그·판정·등록·연결 기록과 트래커·PR을 티켓별 표로 잇는다(읽기만).
      case 'pilot-report': {
        const {resolved, missing} = tracker()
        return (await import('./pilot-report.mjs')).runPilotReport({root, flags,
          io: missing ? {} : {provider: resolved.provider, ticketConfig: resolved.config}})
      }
      default: throw new Error(`UNKNOWN_COMMAND: ${command ?? '(없음)'} — claim|pickup|link|board|intake|configure|create|pilot-report`)
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
