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

const showFile = (root, branch, path) => runGit(root, ['show', `origin/${branch}:${path}`])

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
 * 순수: 한 브랜치의 계획 units + 원장 항목 → 티켓 행. 로컬 증명 가능 상태만:
 *  unclaimed(원장 기록 없음) / claimed(청구됨 — 배정 미상) / pr-linked(prUrl) / closed /
 *  plan-removed(원장엔 있는데 계획에서 사라짐 — 침묵 실종 대신 노출). stale = 청구 시점
 *  contentHash ≠ 현재 단위 해시(상류 계획 변경).
 */
export const foldBranchTickets = (units, entries) => {
  const state = ledgerState(entries)
  const rows = units.map(unit => {
    const record = state.get(unit.featureId) ?? null
    const status = !record ? 'unclaimed' : record.closed ? 'closed' : record.prUrl ? 'pr-linked' : 'claimed'
    return {
      featureId: unit.featureId,
      title: unit.title,
      status,
      ticketKey: record?.ticketKey ?? null,
      prUrl: record?.prUrl ?? null,
      stale: record ? record.contentHash !== unitContentHash(unit) : false,
    }
  })
  const known = new Set(units.map(unit => unit.featureId))
  for (const [featureId, record] of state) {
    if (known.has(featureId) || record.closed) continue
    rows.push({featureId, title: null, status: 'plan-removed', ticketKey: record.ticketKey, prUrl: record.prUrl ?? null, stale: true})
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

const branchCard = (branch, planText, ledgerText, {current, basis}) => {
  const units = planText ? parseFeaturePlanUnits(planText) : []
  const tickets = foldBranchTickets(units, ledgerText ? parseLedger(ledgerText) : [])
  const counts = {}
  for (const row of tickets) counts[row.status] = (counts[row.status] ?? 0) + 1
  return {
    branch,
    current,
    basis, // 'local'(현재 브랜치 작업트리) | 'origin-snapshot'(마지막 fetch 기준)
    planTitle: planTitleOf(planText ?? ''),
    planMissing: planText === null,
    tickets,
    counts,
    staleCount: tickets.filter(ticket => ticket.stale).length,
  }
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
    .filter(branch => branch !== current) // 현재 브랜치는 로컬 기준으로 아래에서 선두 추가
    .map(branch => branchCard(branch, readPlanText(root, branch), ledgerTexts.get(branch) ?? null, {current: false, basis: 'origin-snapshot'}))
  if (current) {
    // 현재 브랜치는 개발자 자신의 컨텍스트 — §4-1 등록 규칙(청구=공표)은 *타* 브랜치 발견에
    // 적용되고, 자기 브랜치는 미청구여도 로컬 상태를 보여준다(청구 전이라는 사실 자체가 정보).
    const localLedgerPath = join(root, LEDGER_PATH)
    const localLedger = existsSync(localLedgerPath) ? readFileSync(localLedgerPath, 'utf8') : null
    branches.unshift(branchCard(current, readLocalPlanText(root), localLedger, {current: true, basis: 'local'}))
  }
  return {
    currentBranch: current,
    branches,
    notes: [
      '타 브랜치는 마지막 fetch 시점의 origin 스냅샷 기준(자동 fetch 안 함) — 최신화: git fetch --prune',
      '배정(누가 진행 중)은 트래커 미연동으로 미상 — claimed는 "청구됨"만 뜻합니다',
      '브랜치 발견은 원장 자기-일치(청구=등록) — 브랜치 스탬프 도입 전 구세대 원장의 브랜치는 나타나지 않습니다',
    ],
  }
}
