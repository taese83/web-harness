// 팀 워크플로우 통합 — 크로스-브랜치 오버뷰 조립 (순수, 증분 2 / 설계 §4-2 Level 1).
// 콘솔 Development 오버뷰와 프롬프트 "뭐 개발할 수 있어"의 공용 데이터 모델. gh/git 조회는
// 실행부(caller)가 하고, 여기는 값만 받아 조립한다.
//
// 브랜치 발견은 §4-1 리뷰 조건 이행: **라벨-마커 union**. 마커(branch= 필드)가 정본이고 라벨은
// 근사 인덱스(50자 생략·구세대 무라벨·라벨 가변)라, 어느 한쪽에만 있어도 등록하되 출처를 소스
// 태그로 정직 표기하고, 마커↔라벨 불일치는 mismatch로 노출한다(침묵 누락·침묵 신뢰 금지).
import {parseIssueRefs} from './refs.mjs'
import {buildAvailabilityBoard} from './assign.mjs'
import {annotateBoardScope, findPathCollisions} from './claim-scope.mjs'

/**
 * 이슈 목록에서 작업 브랜치 레지스트리를 만든다(순수). labelBranchOf는 provider가 주입하는
 * 라벨 추출기(예: GitHub parseBranchFromLabels) — 미주입 시 마커-only(트래커 무관 기본).
 * @param {Array<{number: number, body?: string, labels?: string[]}>} issues
 * @param {{labelBranchOf?: (issue: any) => string|null}} [options]
 * @returns {{branches: Array<{branch: string, sources: string[], issueNumbers: number[]}>, mismatches: Array<{issueNumber: number, markerBranch: string, labelBranch: string}>}}
 */
export function discoverBranchRegistry(issues, {labelBranchOf = () => null} = {}) {
  const registry = new Map()
  const mismatches = []
  const register = (branch, source, issueNumber) => {
    if (!branch) return
    const entry = registry.get(branch) ?? {branch, sources: new Set(), issueNumbers: []}
    entry.sources.add(source)
    if (!entry.issueNumbers.includes(issueNumber)) entry.issueNumbers.push(issueNumber)
    registry.set(branch, entry)
  }
  for (const issue of issues ?? []) {
    const markerBranch = parseIssueRefs(issue?.body ?? '').branch
    const labelBranch = labelBranchOf(issue)
    register(markerBranch, 'marker', issue.number)
    register(labelBranch, 'label', issue.number)
    if (markerBranch && labelBranch && markerBranch !== labelBranch) {
      // 라벨은 탈부착 가능해 정본(마커)과 어긋날 수 있다 — 조용히 한쪽을 고르지 않고 노출.
      mismatches.push({issueNumber: issue.number, markerBranch, labelBranch})
    }
  }
  return {
    branches: [...registry.values()].map(e => ({branch: e.branch, sources: [...e.sources].sort(), issueNumbers: e.issueNumbers})),
    mismatches,
  }
}

/**
 * 한 브랜치의 오버뷰 카드를 만든다(순수, 설계 §4-2 Level 1 한 행). 보드(가용성+범위 강등)를
 * 상태 분포로 접고, 병목(blocked 의존 체인의 머리)을 역집계한다.
 * @param {Object} args {branch, units, ledgerState, issuesByFeature, developer, foundationRoots?, foundationComplete?, mergedFeatureIds?, exists?}
 * @returns {{branch: string, exists: boolean, title: string|null, counts: Object, bottlenecks: Array<{featureId: string, blocking: number}>, board: Array}}
 */
export function buildBranchCard({branch, units = [], ledgerState = new Map(), issuesByFeature = new Map(), developer = null, foundationRoots = [], foundationComplete = true, mergedFeatureIds = [], exists = true}) {
  const opts = {foundationRoots}
  const board = annotateBoardScope(
    buildAvailabilityBoard({units, ledgerState, issuesByFeature, developer}),
    units,
    {foundationComplete, mergedFeatureIds, collisions: findPathCollisions(units, opts), opts},
  )
  const counts = {}
  for (const row of board) counts[row.status] = (counts[row.status] ?? 0) + 1
  // 병목 역집계: blocked(deps-incomplete) 행들의 미충족 의존을 세어 "누가 몇 개를 막나".
  const merged = new Set(mergedFeatureIds)
  const blocking = new Map()
  const unitById = new Map(units.map(u => [u.featureId, u]))
  for (const row of board) {
    if (row.status !== 'blocked' || row.blockedReason !== 'deps-incomplete') continue
    for (const dep of unitById.get(row.featureId)?.dependsOn ?? []) {
      if (!merged.has(dep)) blocking.set(dep, (blocking.get(dep) ?? 0) + 1)
    }
  }
  const bottlenecks = [...blocking.entries()]
    .map(([featureId, count]) => ({featureId, blocking: count}))
    .sort((a, b) => b.blocking - a.blocking)
  return {
    branch,
    exists, // false = 청구는 있는데 origin에 브랜치 없음 → "브랜치 소실" 경고(§4-1)
    title: units[0]?.title ?? null,
    counts,
    bottlenecks,
    board,
  }
}
