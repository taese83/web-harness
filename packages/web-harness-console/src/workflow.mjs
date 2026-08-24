// 팀 워크플로우 — Development › Work flow 표면의 데이터 조립 (증분 3, 설계 §4-2 Level 1/2).
//
// 정직 경계(v1, 로컬-only): 트래커(gh) 미연동 — 배정(assignee)·이슈 오픈 상태는 모른다. 상태는
// 로컬 git + 원장 + 계획에서 **증명 가능한 것만** 말한다: claimed는 "청구됨"이지 "누가 진행
// 중"이 아니다(배정 표시는 트래커 연동 증분의 몫). merged도 주장하지 않는다(§4-2 — 출처 미명세).
//
// 브랜치 발견은 §4-1 선언 기반: origin 후보를 열거하되 **원장 자기-일치**(record.branch ===
// 브랜치 자신)만 등록한다 — 임시 브랜치는 부모 원장을 상속해도 branch 필드가 부모를 가리켜
// 자기-일치에 실패하므로 자연 배제된다. 스탬프 도입 전 구세대 원장(branch 미기록)은 발견되지
// 않는다(§4 등록 갭과 동일 클래스 — notes로 정직 표기). 타 브랜치 데이터는 `git show
// origin/<br>:<path>`(체크아웃 없이)이며 **마지막 fetch 스냅샷**이다 — 자동 fetch는 하지
// 않는다(네트워크 side-effect 금지, §4-1 리뷰 조건의 "스냅샷 기준 표기" 쪽 결정).
import {execFileSync} from 'node:child_process'
import {existsSync, readFileSync, readdirSync} from 'node:fs'
import {join} from 'node:path'
import {parseLedger, ledgerState} from '../../../.claude/scripts/ticket/ledger.mjs'
import {parseFeaturePlanUnits} from '../../../.claude/scripts/ticket/plan-units.mjs'
import {unitContentHash} from '../../../.claude/scripts/ticket/emit.mjs'
import {parseWorktreeStatus} from '../../../.claude/scripts/ticket/git-origin.mjs'
import {describeRoute} from '../../../.claude/scripts/ticket/route.mjs'

const LEDGER_PATH = '_workspace/03_dev/identity-ledger.jsonl'
const PLAN_FILE = '_workspace/01_plan/feature-plan.md'
const PLAN_DIR = '_workspace/01_plan/feature-plan'

// git 실패/부재는 null — "판정 불가"로 정직 처리(indexer의 computeTcSourceStamp와 같은 관용구).
const runGit = (root, args) => {
  try {
    return execFileSync('git', args, {cwd: root, timeout: 3000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']})
  } catch {
    return null
  }
}

// `ref:./path`의 './'가 핵심 — 없으면 경로가 **repo 루트 상대**라 workspace 하위 프로젝트
// (예: workspace/search-portal)에서 origin 조회가 항상 null이 된다(잠복 버그, 3분할 작업 중
// 발견). './'는 cwd(프로젝트 루트) 상대로 해석돼 단독 repo·하위 디렉토리 모두에서 옳다.
const showFile = (root, branch, path) => runGit(root, ['show', `origin/${branch}:./${path}`])

// 계획 텍스트 — flat(feature-plan.md)과 sharded(feature-plan/*.md) 모두 지원. sharded의
// `git show ref:dir`는 트리 목록을 내므로 .md 항목만 정렬해 이어붙인다(단위 해시는 섹션
// 단위라 결합 순서와 무관하지만, 결정성 위해 정렬).
const readPlanText = (root, branch) => {
  const flat = showFile(root, branch, PLAN_FILE)
  if (flat !== null) return flat
  const tree = showFile(root, branch, PLAN_DIR)
  if (tree === null) return null
  const names = tree.split(/\r?\n/).map(line => line.trim()).filter(line => line.endsWith('.md')).sort()
  if (names.length === 0) return null
  return names.map(name => showFile(root, branch, `${PLAN_DIR}/${name}`) ?? '').join('\n\n')
}

const readLocalPlanText = root => {
  const flat = join(root, PLAN_FILE)
  if (existsSync(flat)) return readFileSync(flat, 'utf8')
  const dir = join(root, PLAN_DIR)
  if (!existsSync(dir)) return null
  try {
    const names = readdirSync(dir).filter(name => name.endsWith('.md')).sort()
    if (names.length === 0) return null
    return names.map(name => readFileSync(join(dir, name), 'utf8')).join('\n\n')
  } catch {
    return null
  }
}

/**
 * 순수: 한 브랜치의 티켓 행 — **기준은 origin에 push된 형상**(2026-08-24 사용자 확정: 로컬에서
 * 바로 발행은 불가하므로 보드의 정본은 공유된 형상이고, 로컬은 그 위의 차이 표기다).
 *
 *  기준 행(originUnits — push된 계획 단위):
 *    unclaimed(발행 대기 — **청구 가능한 유일한 미발급 상태**) / claimed / pr-linked / closed.
 *    stale = 청구 시점 contentHash ≠ **origin** 단위 해시(push된 상류 변경만 STALE — 정확해짐).
 *    localDrift = 로컬이 origin과 다름(수정 'modified-locally'·삭제 'deleted-locally') — 표기용,
 *    unclaimed+drift는 청구 불가(push 먼저)라 상태를 local-modified로 강등.
 *  로컬 전용 행(localUnits에만 있음): local-new — "push 안 됨, 청구 불가" 안내 대상.
 *  plan-removed: 원장 청구가 origin 계획에서 사라짐(침묵 실종 대신 노출).
 *
 *  originUnits=null = origin에 브랜치/계획 없음(미푸시) → 기준 행 0, 로컬 전부 local-new.
 *  localUnits 미지정 = 로컬 오버레이 없음(타 브랜치 origin 스냅샷 카드) — drift 표기 생략.
 */
export const foldBranchTickets = (originUnits, entries, {localUnits} = {}) => {
  const state = ledgerState(entries)
  const base = Array.isArray(originUnits) ? originUnits : []
  const localById = Array.isArray(localUnits) ? new Map(localUnits.map(unit => [unit.featureId, unit])) : null
  const rows = base.map(unit => {
    const record = state.get(unit.featureId) ?? null
    let status = !record ? 'unclaimed' : record.closed ? 'closed' : record.prUrl ? 'pr-linked' : 'claimed'
    let localDrift = null
    if (localById !== null) {
      const localUnit = localById.get(unit.featureId) ?? null
      if (!localUnit) localDrift = 'deleted-locally'
      else if (unitContentHash(localUnit) !== unitContentHash(unit)) localDrift = 'modified-locally'
    }
    if (status === 'unclaimed' && localDrift === 'modified-locally') status = 'local-modified' // 청구 불가 — push 먼저
    return {
      featureId: unit.featureId,
      title: unit.title,
      status,
      ticketKey: record?.ticketKey ?? null,
      prUrl: record?.prUrl ?? null,
      stale: record ? record.contentHash !== unitContentHash(unit) : false,
      localDrift,
    }
  })
  const inBase = new Set(base.map(unit => unit.featureId))
  if (localById !== null) {
    for (const [featureId, unit] of localById) {
      if (inBase.has(featureId)) continue
      rows.push({featureId, title: unit.title, status: 'local-new', ticketKey: state.get(featureId)?.ticketKey ?? null, prUrl: null, stale: false, localDrift: null})
    }
  }
  for (const [featureId, record] of state) {
    if (inBase.has(featureId) || record.closed) continue
    if (localById?.has(featureId)) continue // local-new로 이미 표시됨
    rows.push({featureId, title: null, status: 'plan-removed', ticketKey: record.ticketKey, prUrl: record.prUrl ?? null, stale: true, localDrift: null})
  }
  return rows
}

/**
 * 순수: 후보 브랜치 → 원장 자기-일치(§4-1 청구=등록)만 통과. 임시 브랜치(상속 원장의 branch가
 * 부모를 가리킴)·구세대 원장(branch 미기록)·원장 없음은 등록되지 않는다.
 * @param {Map<string, string|null>} ledgerTextByBranch
 */
export const selfMatchedBranches = ledgerTextByBranch => {
  const matched = []
  for (const [branch, text] of ledgerTextByBranch) {
    if (typeof text !== 'string') continue
    if (parseLedger(text).some(record => record.branch === branch)) matched.push(branch)
  }
  return matched
}

export const currentBranchOf = root => {
  const name = runGit(root, ['rev-parse', '--abbrev-ref', 'HEAD'])?.trim()
  return name && name !== 'HEAD' ? name : null
}

const planTitleOf = text => text?.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? null

const branchCard = (branch, originPlanText, ledgerText, {current, basis, localPlanText}) => {
  // **기준은 push된 형상**(origin 계획) — 개발자는 push된 형상을 기반으로 확인한다(사용자 확정).
  // 현재 브랜치 카드만 로컬 계획을 오버레이로 넘겨 차이(local-new/modified/deleted)를 표기한다.
  const originUnits = originPlanText != null ? parseFeaturePlanUnits(originPlanText) : null
  const localUnits = current ? (localPlanText != null ? parseFeaturePlanUnits(localPlanText) : []) : undefined
  const tickets = foldBranchTickets(originUnits, ledgerText ? parseLedger(ledgerText) : [], {localUnits})
  const counts = {}
  for (const row of tickets) counts[row.status] = (counts[row.status] ?? 0) + 1
  return {
    branch,
    current,
    basis, // 'origin'(push된 형상 정본 — 현재 브랜치는 +로컬 차이 표기) | 'origin-snapshot'(타 브랜치)
    planTitle: planTitleOf(originPlanText ?? localPlanText ?? ''),
    planMissing: originPlanText === null, // 기준(push된 계획) 부재 — 로컬만 있으면 전부 local-new
    tickets,
    counts,
    staleCount: tickets.filter(ticket => ticket.stale).length,
  }
}

// 활성 픽업 감지(§4-3 "다른 티켓 개발 진행 중" 행의 산출자, 리뷰 조건): 로컬
// _workspace/03_dev/change-scope.md 존재 = 픽업이 발급된 개발 진행 상태. 그 안의 첫 FEAT ID가
// 진행 중 티켓이다. team-flow pickup 0단계도 **같은 소스**를 쓴다(두 채널 판정 일치의 근거).
const CHANGE_SCOPE_PATH = '_workspace/03_dev/change-scope.md'
export const detectActivePickup = root => {
  try {
    const text = readFileSync(join(root, CHANGE_SCOPE_PATH), 'utf8')
    const featureId = text.match(/\bFEAT-\d{3,}\b/)?.[0] ?? null
    return featureId ? {featureId} : null
  } catch {
    return null
  }
}

/**
 * 티켓 선택의 라우트 판정(§4-3, read-only) — 실 worktree 상태(porcelain)·활성 픽업으로
 * computeSwitchPlan/describeRoute를 돌려 단계·차단 사유를 돌려준다. **콘솔은 판정·안내까지만**
 * 이고 실행(전환·픽업 side-effect)은 team-flow/executor 몫이다(콘솔 read-only 유지 — v1 결정).
 * gitRun 주입은 테스트용(기본 실 git).
 */
export const buildRoutePayload = (root, {targetBranch, featureId}, {gitRun = runGit} = {}) => {
  const current = (gitRun(root, ['rev-parse', '--abbrev-ref', 'HEAD']) ?? '').trim() || null
  const porcelain = gitRun(root, ['status', '--porcelain'])
  // 조회 실패 = 상태 **미상**(statusUnknown) — dirty 단정 대신 미상 표기(라우팅이 보수 차단)
  const worktree = porcelain === null ? {dirty: true, conflicted: false, untrackedOnly: false, statusUnknown: true} : parseWorktreeStatus(porcelain)
  const active = detectActivePickup(root)
  const activePickup = active && active.featureId !== featureId ? active : null // 같은 티켓 재픽업은 "다른 티켓 진행"이 아님
  const route = describeRoute({targetBranch, currentBranch: current === 'HEAD' ? null : current, worktree, activePickup, featureId})
  return {currentBranch: current, targetBranch, featureId, worktree, activePickup, ...route,
    note: '콘솔은 판정·안내까지 — 전환·픽업 실행은 team-flow(프롬프트)에서 확인 후 진행합니다'}
}

/** Development › Work flow payload — 서버 라우트가 프로젝트 루트로 호출한다. */
export const buildWorkflowPayload = root => {
  const current = currentBranchOf(root)
  const refs = runGit(root, ['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin'])
  const candidates = (refs ?? '').split(/\r?\n/)
    .map(name => name.trim())
    .filter(name => name.startsWith('origin/') && name !== 'origin/HEAD')
    .map(name => name.slice('origin/'.length))
  const ledgerTexts = new Map(candidates.map(branch => [branch, showFile(root, branch, LEDGER_PATH)]))
  const branches = selfMatchedBranches(ledgerTexts)
    .filter(branch => branch !== current) // 현재 브랜치는 아래에서 선두 추가(로컬 차이 오버레이 포함)
    .map(branch => branchCard(branch, readPlanText(root, branch), ledgerTexts.get(branch) ?? null, {current: false, basis: 'origin-snapshot'}))
  if (current) {
    // 현재 브랜치도 **기준은 push된 형상**(origin) — §4-1 예외는 "미청구여도 카드가 보인다"이지
    // 기준 축이 로컬이라는 뜻이 아니다(사용자 확정: 개발자는 push된 형상을 기반으로 확인).
    // 로컬 계획은 오버레이로만(local-new/modified/deleted 차이 표기), 원장은 로컬이 최신
    // (청구·픽업 기록이 로컬에 먼저 쌓임).
    const localLedgerPath = join(root, LEDGER_PATH)
    const localLedger = existsSync(localLedgerPath) ? readFileSync(localLedgerPath, 'utf8') : null
    branches.unshift(branchCard(current, readPlanText(root, current), localLedger, {current: true, basis: 'origin', localPlanText: readLocalPlanText(root)}))
  }
  return {
    currentBranch: current,
    branches,
    notes: [
      '타 브랜치는 마지막 fetch 시점의 origin 스냅샷 기준(자동 fetch 안 함) — 최신화: git fetch --prune',
      '배정(누가 진행 중)은 트래커 미연동으로 미상 — claimed는 "청구됨"만 뜻합니다',
      '브랜치 발견은 원장 자기-일치(청구=등록) — 브랜치 스탬프 도입 전 구세대 원장의 브랜치는 나타나지 않습니다',
      'local-new/local-modified는 origin과의 FEAT 단위 대조(fetch 스냅샷 기준) — 커밋·푸시 후 청구 가능해집니다',
    ],
  }
}
