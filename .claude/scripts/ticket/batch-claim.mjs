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
 *  - alreadyClaimed: 원장에 있고 **형상도 같은** 것(재발행 안 함 — 멱등)
 *  - supersede: 원장에 있으나 형상이 바뀐 것 — 새 티켓으로 **대체 발행**하고 옛 것은 닫는다
 *  - collisions: 경로 충돌(병합 or foundation 승격 필요 — 발행 전 경고)
 *  - cycles: 순환 의존(순서 판정 불가 구간 — 상류 수정 필요)
 * @param {{units: Array, ledgerState?: Map, opts?: {foundationRoots?: string[]}, branch?: string|null}} args
 * @returns {{branch: string|null, claim: Array, alreadyClaimed: Array, collisions: Array, cycles: string[], order: string[]}}
 */
export function computeBatchClaimPlan({units, ledgerState = new Map(), opts = {}, branch = null, unmetByFeature = new Map()}) {
  const emit = computeEmitPlan(units, ledgerState)
  const order = computeClaimOrder(units, opts)
  const collisions = findPathCollisions(units, opts)
  const unitById = new Map(units.map(u => [u.featureId, u]))
  const orderIndex = new Map(order.order.map((id, i) => [id, i]))

  // PR 링크 여부로 대체 대상을 가른다 — 링크된 것은 재발행하지 않는다.
  const linked = new Set([...(ledgerState?.entries?.() ?? [])]
    .filter(([, record]) => record?.prUrl)
    .map(([featureId]) => featureId))
  const supersede = emit.supersede.filter(item => !linked.has(item.featureId))
  const changedAfterLink = emit.supersede
    .filter(item => linked.has(item.featureId))
    .map(item => ({featureId: item.featureId, ticketKey: item.priorTicketKey}))

  // 이미 나간 FEAT 중 **수용 기준이 미충족**인 것 → fix 티켓. 판정 입력은 caller가 넘긴다
  // (소스 인용 수집은 I/O라 순수 함수 밖이다).
  const fix = [...linked]
    .filter(featureId => (unmetByFeature.get(featureId)?.length ?? 0) > 0)
    .filter(featureId => unitById.has(featureId))
    .map(featureId => {
      const unit = unitById.get(featureId)
      const unmet = unmetByFeature.get(featureId)
      return {
        featureId,
        title: `fix(${featureId}): ${unit.title ?? featureId} — 미충족 수용 기준 ${unmet.length}건`,
        unmet,
        priorTicketKey: ledgerState.get(featureId)?.ticketKey ?? null,
      }
    })
    .sort((a, b) => a.featureId.localeCompare(b.featureId))

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
    // 대체 대상을 alreadyClaimed로 접으면 계획이 바뀌어도 티켓이 영원히 낡은 채 남는다 —
    // 재바인딩 경로가 없던 원인이 바로 이 한 줄이었다(2026-08-30 실측).
    alreadyClaimed: emit.unchanged.map(i => ({featureId: i.featureId, ticketKey: i.ticketKey})),
    supersede: supersede.map(i => ({featureId: i.featureId, priorTicketKey: i.priorTicketKey, payload: i.payload, contentHash: i.contentHash})),
    // **PR이 연결된 뒤 계획이 바뀐 것은 대체 발행 대상이 아니다.** 일이 이미 나갔는데 같은
    // 티켓을 새로 내면 끝난 작업의 중복이 생긴다(2026-08-30 실측: 머지된 FEAT-003·005·006의
    // 명세를 사후 보강했더니 셋 다 대체 대상으로 잡혔다).
    changedAfterLink,
    // 그렇다고 없던 일이 되지는 않는다 — **구현이 안 됐거나 이슈가 있으면 fix 티켓이 있어야
    // 한다.** 이미 나간 FEAT 중 수용 기준이 미충족인 것(caller가 `unmetByFeature`로 넘긴다)에
    // 대해 별도의 fix 티켓을 낸다. 원 티켓은 건드리지 않는다.
    fix,
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
  const lines = [`브랜치 ${plan.branch ?? '(미지정)'} · 발행 ${plan.claim.length} · 대체 ${plan.supersede.length} · 이미청구 ${plan.alreadyClaimed.length}`]
  if ((plan.fix ?? []).length > 0) {
    lines.push(`  🔧 fix 티켓 ${plan.fix.length}건 — 이미 나갔으나 수용 기준이 미충족이다:`)
    for (const item of plan.fix) lines.push(`     ${item.title} (${item.unmet.join(', ')})`)
  }
  if ((plan.changedAfterLink ?? []).length > 0) {
    lines.push(`  ℹ PR 연결 뒤 계획이 바뀐 ${plan.changedAfterLink.length}건(재발행하지 않는다): `
      + plan.changedAfterLink.map(i => `${i.featureId}#${i.ticketKey}`).join(', '))
  }
  if (plan.cycles.length > 0) lines.push(`  ⚠ 순환 의존: ${plan.cycles.join(', ')} — 순서 판정 불가, 상류 수정 필요`)
  for (const c of plan.collisions) lines.push(`  ⚠ 경로 충돌: ${c.a} ↔ ${c.b} — 병합 또는 foundation 승격`)
  for (const item of plan.claim) {
    const warn = item.specReady ? '' : ' ⚠ 스펙 미완'
    lines.push(`  ${item.layer === 'foundation' ? '▪' : '·'} ${item.featureId} [${item.layer}]${item.reopen ? ' (재개)' : ''}: ${item.title}${warn}`)
  }
  return lines.join('\n')
}
