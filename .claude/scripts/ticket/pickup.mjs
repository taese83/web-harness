// 팀 워크플로우 통합 — 인바운드 pickup 코어 (통합 빌드 B단계, 순수).
// docs/team-workflow-integration-design.md 지점 B: 청구한 이슈 → change-scope 브리프.
//
// 이 모듈은 순수하다 — gh 조회(이슈 resolve)는 실행부가 주입한 값으로 받는다. 세 어려운
// 지점을 코드로 강제한다: (1) 이슈 본문은 비신뢰 외부 입력 → 지시 패턴 스캔(INJECTION_SUSPECT),
// (2) 식별자 왕복 vs 맨몸 티켓 → feature-plan 대조, TC를 지어내지 않음(불일치면 되돌림),
// (3) ALLOWED_PATHS는 이슈가 아니라 FEAT 소유에서 seed(+개발자 확인). change-scope는 소스
// 스펙 digest를 물어 상류 기획 변경 시 STALE로 감지한다(프리뷰 승인과 같은 관용구).
import {unitContentHash} from './emit.mjs'
import {parseIssueRefs} from './provider-github.mjs'

// 비신뢰 본문 스캔 — 하네스 제어 토큰·오버라이드·파괴/실행 지시를 고정밀로 잡는다.
// 정상 기능 스펙(given/when/then)은 이들을 언급하지 않으므로 오탐이 낮다.
const INJECTION_PATTERNS = [
  {name: 'control-token', re: /ALLOWED_PATHS|PUBLIC_CONTRACTS_TO_PRESERVE|CHANGE_BUDGET|change-scope\b|NON_GOALS/i},
  {name: 'harness-internal', re: /\.claude\/|CLAUDE\.md/i},
  {name: 'override-directive', re: /\b(ignore|무시|bypass|우회|override|disregard)\b[\s\S]{0,40}(gate|rule|scope|path|contract|계약|게이트|규칙|범위|경계)/i},
  {name: 'destructive-exec', re: /\brm\s+-rf\b|\bsudo\s|\bcurl\b[\s\S]*\|\s*(sh|bash)\b|\beval\s*\(|\bprocess\.env\b/i},
]

/**
 * 이슈 본문을 비신뢰 데이터로 스캔한다. 본문은 *스펙*이지 *지시*가 아니다 — 지시 패턴이
 * 있으면 INJECTION_SUSPECT로 플래그(릴리스-blocking, 사람 확인). 순수.
 * @param {string} body
 * @returns {{injectionSuspect: boolean, markers: string[]}}
 */
export function scanUntrustedBody(body) {
  const text = String(body ?? '')
  const markers = INJECTION_PATTERNS.filter(p => p.re.test(text)).map(p => p.name)
  return {injectionSuspect: markers.length > 0, markers}
}

/**
 * 이슈의 왕복 refs를 feature-plan 단위와 대조한다(순수). TC를 지어내지 않는다 —
 * 불일치는 스펙-불완전으로 되돌림 신호. planUnits = [{featureId, testCaseIds, ...}].
 * @param {{featureIds: string[], testCaseIds: string[]}} refs
 * @param {Array} planUnits
 * @returns {{status: 'clean'|'spec-incomplete'|'unknown-feature', unit: any, testCaseIds: string[], unmatchedTcs: string[]}}
 */
export function reconcileWithPlan(refs, planUnits) {
  const featureId = refs.featureIds?.[0] ?? null
  if (!featureId) return {status: 'spec-incomplete', unit: null, testCaseIds: [], unmatchedTcs: []}
  const unit = (planUnits ?? []).find(u => u.featureId === featureId) ?? null
  if (!unit) return {status: 'unknown-feature', unit: null, testCaseIds: [], unmatchedTcs: []}
  const planTcs = new Set(unit.testCaseIds ?? [])
  const requested = refs.testCaseIds ?? []
  const unmatchedTcs = requested.filter(tc => !planTcs.has(tc))
  if (requested.length === 0) return {status: 'spec-incomplete', unit, testCaseIds: [], unmatchedTcs: []}
  if (unmatchedTcs.length > 0) return {status: 'spec-incomplete', unit, testCaseIds: requested.filter(tc => planTcs.has(tc)), unmatchedTcs}
  return {status: 'clean', unit, testCaseIds: requested, unmatchedTcs: []}
}

/**
 * 대조된 단위 + 이슈로 change-scope 브리프를 만든다(순수). ALLOWED_PATHS는 이슈가 아니라
 * seed에서 오며 needsConfirmation=true(개발자 확인 필요). sourceDigest = 단위 콘텐츠 해시
 * (STALE 감지 앵커, emit.unitContentHash와 동일 기준).
 * @param {Object} args {issue, unit, testCaseIds, allowedPathsSeed?, preserve?, requestType?}
 */
export function buildChangeScope({issue, unit, testCaseIds, allowedPathsSeed = [], preserve = [], requestType = 'feature'}) {
  return {
    ticketKey: issue.ticketKey ?? issue.number ?? null,
    featureId: unit.featureId,
    TARGET_BEHAVIOR: [issue.title, issue.body].filter(Boolean).join('\n\n'),
    requestType,
    testCaseIds: [...testCaseIds],
    ALLOWED_PATHS: [...allowedPathsSeed],
    PUBLIC_CONTRACTS_TO_PRESERVE: [...preserve],
    NON_GOALS: [],
    CHANGE_BUDGET: null,
    sourceDigest: unitContentHash(unit), // STALE 앵커 — 상류 기획 변경 시 불일치
    needsConfirmation: true,             // ALLOWED_PATHS는 개발자 확인 후 확정
  }
}

/**
 * change-scope가 현재 feature-plan 단위 대비 STALE인지(픽업 후 기획이 바뀌었는지). 순수.
 * @param {{sourceDigest: string}} changeScope
 * @param {Object} currentUnit  현재 feature-plan의 같은 FEAT 단위
 * @returns {boolean}
 */
export function isChangeScopeStale(changeScope, currentUnit) {
  if (!currentUnit) return true // 단위가 사라짐(FEAT 삭제) → STALE
  return unitContentHash(currentUnit) !== changeScope.sourceDigest
}

/**
 * 픽업 오케스트레이션(순수): 이슈(resolve된 값) + feature-plan → change-scope 또는 되돌림.
 * @param {Object} args {issue: {title, body, number/ticketKey}, planUnits, allowedPathsSeed?, preserve?, requestType?}
 * @returns {{ok: boolean, changeScope?: Object, bounce?: {reason: string, unmatchedTcs?: string[]}, injection: {injectionSuspect: boolean, markers: string[]}}}
 */
export function pickupTicket({issue, planUnits, allowedPathsSeed = [], preserve = [], requestType = 'feature'}) {
  const injection = scanUntrustedBody(issue?.body)
  const refs = parseIssueRefs(issue?.body ?? '')
  const rec = reconcileWithPlan(refs, planUnits)
  if (rec.status !== 'clean') {
    // 스펙-불완전/미지 FEAT → feature-planner 되돌림. 개발 진입 차단(TC 발명 금지).
    return {ok: false, bounce: {reason: rec.status, unmatchedTcs: rec.unmatchedTcs}, injection}
  }
  const changeScope = buildChangeScope({issue, unit: rec.unit, testCaseIds: rec.testCaseIds, allowedPathsSeed, preserve, requestType})
  return {ok: true, changeScope, injection}
}
