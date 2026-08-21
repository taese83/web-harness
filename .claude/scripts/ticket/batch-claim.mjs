// 팀 워크플로우 통합 — 일괄 청구 planner (기획자 진입점, 순수).
// docs/team-workflow-integration-design.md: 기획자는 개별이 아니라 **한 요청으로 일괄 청구**한다.
// 브랜치 생성·push 후, feature-plan 전체를 순서대로(foundation 먼저) 한 번에 발행한다.
// 이 모듈은 순수 — 미리보기(dry-run)를 만든다. 실제 gh 발행·원장 기록은 confirm 게이트 뒤
// 실행부가 create 목록을 순서대로 돌며 claimFeature로 처리한다.
import {computeEmitPlan} from './emit.mjs'
import {computeClaimOrder, findPathCollisions, classifyLayer} from './claim-scope.mjs'

/**
 * 일괄 청구 미리보기를 만든다(순수). emit(무엇을 발행) + claim-scope(순서·계층·충돌)를 합친다.
 *  - claim: 이번에 발행할 티켓(청구 순서대로 — foundation 먼저, 의존 위상)
 *  - alreadyClaimed: 원장에 이미 있는 것(재발행 안 함 — 멱등)
 *  - collisions: 경로 충돌(병합 or foundation 승격 필요 — 발행 전 경고)
 *  - cycles: 순환 의존(순서 판정 불가 구간 — 상류 수정 필요)
 * @param {{units: Array, ledgerState?: Map, opts?: {foundationRoots?: string[]}, branch?: string|null}} args
 * @returns {{branch: string|null, claim: Array, alreadyClaimed: Array, collisions: Array, cycles: string[], order: string[]}}
 */
export function computeBatchClaimPlan({units, ledgerState = new Map(), opts = {}, branch = null}) {
  const emit = computeEmitPlan(units, ledgerState)
  const order = computeClaimOrder(units, opts)
  const collisions = findPathCollisions(units, opts)
  const unitById = new Map(units.map(u => [u.featureId, u]))
  const orderIndex = new Map(order.order.map((id, i) => [id, i]))

  const claim = emit.create
    .map(item => ({
      featureId: item.featureId,
      title: item.payload.title,
      layer: classifyLayer(unitById.get(item.featureId) ?? {}, opts),
      reopen: item.reopen,
      specReady: item.payload.specCompleteness.ready,
      orderIndex: orderIndex.get(item.featureId) ?? Number.MAX_SAFE_INTEGER,
    }))
    .sort((a, b) => a.orderIndex - b.orderIndex)

  return {
    branch,
    claim,
    alreadyClaimed: [...emit.update, ...emit.unchanged].map(i => ({featureId: i.featureId, ticketKey: i.ticketKey})),
    collisions,
    cycles: order.cycles,
    order: order.order,
  }
}

/**
 * 일괄 청구 미리보기를 사람이 볼 문자열로(순수). 발행 전 확인 게이트에 쓴다.
 * @param {ReturnType<typeof computeBatchClaimPlan>} plan
 */
export function formatBatchClaimPreview(plan) {
  const lines = [`브랜치 ${plan.branch ?? '(미지정)'} · 발행 ${plan.claim.length} · 이미청구 ${plan.alreadyClaimed.length}`]
  if (plan.cycles.length > 0) lines.push(`  ⚠ 순환 의존: ${plan.cycles.join(', ')} — 순서 판정 불가, 상류 수정 필요`)
  for (const c of plan.collisions) lines.push(`  ⚠ 경로 충돌: ${c.a} ↔ ${c.b} — 병합 또는 foundation 승격`)
  for (const item of plan.claim) {
    const warn = item.specReady ? '' : ' ⚠ 스펙 미완'
    lines.push(`  ${item.layer === 'foundation' ? '▪' : '·'} ${item.featureId} [${item.layer}]${item.reopen ? ' (재개)' : ''}: ${item.title}${warn}`)
  }
  return lines.join('\n')
}
