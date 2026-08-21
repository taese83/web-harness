// 통합 빌드 4단계 — claim runner. confirm(=개발자의 티켓 선택 행위) 뒤 실제 발행을 수행한다.
// docs/team-workflow-integration-design.md 지점 A의 lazy-claim 실행부.
//
// side-effect(이슈 생성·원장 append)는 provider/ledger 인터페이스로 **주입**한다 — 테스트는
// mock, 실사용은 gh provider(별도 파일). 이 오케스트레이션 자체는 gh를 직접 spawn하지 않아
// 순수 로직으로 테스트 가능하다. claim 경쟁은 발행 전 트래커(권위)에서 FEAT 고유 라벨 조회로
// 검사한다 — findByLabel→createIssue 사이 잔여 race는 라벨로 사후 감지·dedup 가능(후속).
import {buildTicketDraft, unitContentHash} from './emit.mjs'
import {buildIssueFields, featLabel} from './provider-github.mjs'

/**
 * 개발자가 선택한 FEAT 단위를 청구한다: 기존 이슈 확인 → 없으면 발행(assignee=청구자) →
 * 원장 append. 이미 청구됐으면(트래커에 이슈 존재) 재발행하지 않고 그 이슈를 반환(멱등).
 *
 * @param {Object} args
 * @param {{featureId: string, title?: string, body?: string, testCaseIds?: string[], type?: string}} args.unit
 * @param {{findByLabel: (label: string) => Promise<any>, createIssue: (fields: any) => Promise<any>}} args.provider
 * @param {{append: (record: any) => Promise<void>|void, find?: (featureId: string) => any}} args.ledger
 *   ledger.find는 원장의 기존 기록(있으면)을 반환 — **1차 멱등 가드**(동기·일관).
 * @param {string|null} [args.assignee]   미지정 시 미배정(혼자 개발/나중 분배)
 * @param {() => string} [args.now]
 * @returns {Promise<{claimed: boolean, alreadyClaimed: boolean, issue: any, record?: any, specWarning: string[]|null}>}
 */
export async function claimFeature({unit, provider, ledger, assignee = null, now = () => new Date().toISOString()}) {
  const featureId = unit.featureId
  if (typeof featureId !== 'string' || !/^FEAT-\d{3,}$/.test(featureId)) {
    throw new Error(`INVALID_FEATURE_ID: ${featureId}`)
  }
  // 1. 청구 경쟁 — **로컬 원장이 1차 가드**다. 트래커(`findByLabel`)는 GitHub 색인 지연으로
  //    직전 생성 이슈를 못 보는 실측 갭이 있어(2026-08-21 라이브), 신뢰할 멱등 가드가 아니다.
  //    원장은 동기 기록·일관 조회라 같은 원장을 보는 흐름의 재청구를 확실히 잡는다.
  const recorded = ledger.find?.(featureId)
  if (recorded) return {claimed: false, alreadyClaimed: true, issue: {ticketKey: recorded.ticketKey}, specWarning: null}
  // 2. 트래커는 크로스-머신 2차 가드(다른 원장을 쓰는 개발자의 선행 청구). 지연은 잔여 race로
  //    남고, FEAT 고유 라벨이 사후 중복 감지·dedup의 기계 키가 된다.
  const existing = await provider.findByLabel(featLabel(featureId))
  if (existing) return {claimed: false, alreadyClaimed: true, issue: existing, specWarning: null}
  // 2. draft → 이슈 필드(assignee=청구자). 스펙 미완이면 경고만 — 파서/발행은 게이트하지
  //    않고 pickup(단계 5)이 되돌림을 결정한다(스펙 상류 규율).
  const draft = buildTicketDraft(unit)
  const fields = buildIssueFields(draft, {assignee})
  // 3. 발행(side-effect via provider)
  const issue = await provider.createIssue(fields)
  // 4. 원장 append(왕복 정본, side-effect via ledger). ticketKey = 이슈 번호/키.
  const record = {
    featureId,
    ticketKey: String(issue?.number ?? issue?.key ?? issue),
    contentHash: unitContentHash(unit),
    createdAt: now(),
    ...(assignee ? {assignee} : {}),
  }
  await ledger.append(record)
  return {
    claimed: true,
    alreadyClaimed: false,
    issue,
    record,
    specWarning: draft.specCompleteness.ready ? null : draft.specCompleteness.missing,
  }
}
