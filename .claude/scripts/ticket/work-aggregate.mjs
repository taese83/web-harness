// work-aggregate.mjs — 부모 FEAT 집계(순수).
//
// 설계 §10.3: 부모 인수 준비 = 필수 작업이 모두 기술 완료 AND 누락·취소 없음 AND **부모 TC마다 최종 증거**가
// 같은 통합 revision에 결합됨 AND stale 아님. 이 모듈이 지금 **잴 수 있는 것**은 앞의 둘(작업 머지·책임
// 배정)까지다 — 통합 revision의 TC 증거는 아직 연결되지 않았다. 그래서 결과를 「인수 완료」라 부르지 않고
// `works-merged`라 부르며, **`closeEligible`은 늘 거짓**이고 무엇이 막는지 이유를 함께 낸다(부모 자동 닫기는
// 기본 비활성, 설계 §10.4).
//
// 유예는 두 종류를 **다르게** 센다(§4.5 · protected-core §4 ⑧):
//   product-deferral   제품 범위에서 뺐다 — 완료 분모에서 뺀다(뺐다고 적는다)
//   follow-up-detail   나중에 상세화한다 — **분모에 남고** 상세화·분해·완료 전에는 끝나지 않는다
// 계획 본문의 TC 유예(`[유예: 사유]`)는 FEAT를 끝낼 수는 있지만 `works-merged-with-deferrals`로 따로 표시한다.
import {deferredTestCases} from './completion.mjs'

const list = value => (Array.isArray(value) ? value : [])

export const CLOSE_BLOCKERS = Object.freeze({
  evidence: 'evidence-not-connected: 통합 revision의 TC 검증 증거가 아직 연결되지 않았다 — 머지만으로 부모 인수를 주장하지 않는다',
  disabled: 'parent-close-disabled: 부모 자동 닫기는 기본 비활성이다 — 사람이 판단해 전이한다',
})

/**
 * @param {{plan: object, analysis: object, state: object, planUnits?: Array<{featureId: string, testCaseIds?: string[]}>|null, planText?: string}} args
 *   planUnits `null` = feature-plan을 읽지 못했다 — TC 책임을 **대조하지 않은 것**이지 누락이 없는 것이 아니다
 * @returns {{features: object[], denominator: {counted: number, excluded: string[], worksMerged: number}}}
 */
export function aggregateFeatures({plan, analysis, state, planUnits = [], planText = ''}) {
  const tcChecked = Array.isArray(planUnits)
  const dispositions = new Map(list(analysis?.scope?.featureDisposition).map(entry => [entry.featureId, entry]))
  const bindings = new Map(list(plan?.featureBindings).map(binding => [binding.featureId, binding]))
  const works = new Map(list(plan?.workItems).map(work => [work.workId, work]))
  const units = new Map(list(planUnits).map(unit => [unit.featureId, unit]))
  const deferredTcs = deferredTestCases(planText)
  const featureIds = [...new Set([...list(analysis?.scope?.featureIds), ...bindings.keys()])].sort()
  const features = featureIds.map(featureId => {
    const disposition = dispositions.get(featureId) ?? {status: 'planned'}
    const binding = bindings.get(featureId) ?? null
    const aggregate = state?.aggregates?.get(featureId) ?? null
    const base = {featureId, disposition: disposition.status, deferral: disposition.deferral ?? null,
      aggregateTicket: aggregate?.ticketKey ?? null, aggregateStatus: aggregate?.status ?? 'unpublished', evidence: 'not-connected', closeEligible: false}
    if (disposition.status === 'deferred' && disposition.deferral === 'product-deferral') {
      return {...base, status: 'deferred-product', counted: false, closeBlockers: ['product-deferral: 제품 범위에서 유예됐다']}
    }
    if (disposition.status === 'deferred') {
      // 후속 상세화는 **끝나지 않은 일**이다 — 분모에 남기고 완료로 접지 않는다.
      return {...base, status: 'awaiting-follow-up', counted: true, closeBlockers: ['follow-up-detail: 상세화·분해되지 않았다 — 분모에 남는다']}
    }
    if (disposition.status === 'blocked') {
      return {...base, status: 'blocked', counted: true, closeBlockers: [`blocked: ${disposition.reasonRef ?? '미결'}`]}
    }
    if (!binding) {
      return {...base, status: 'unbound', counted: true, closeBlockers: ['unbound: 계획에 이 FEAT의 작업 바인딩이 없다']}
    }
    const required = list(binding.requiredWorkIds).map(workId => {
      const work = works.get(workId) ?? null
      const registered = state?.works?.get(workId) ?? null
      return {workId, title: work?.title ?? null, lifecycle: work?.lifecycle ?? (work ? 'active' : 'missing'),
        registration: registered?.status ?? 'unpublished', ticketKey: registered?.ticketKey ?? null,
        linked: registered?.link?.prUrl ?? null, completed: Boolean(registered?.completed),
        acceptedIncomplete: registered?.link?.acceptedIncomplete === true,
        acceptedUnverifiedScope: registered?.link?.acceptedUnverifiedScope === true}
    })
    const owners = list(binding.acceptanceOwners).map(owner => ({testCaseId: owner.testCaseId, workId: owner.workId,
      completed: required.find(item => item.workId === owner.workId)?.completed === true}))
    // 계획 문서를 못 읽었거나 이 FEAT의 unit이 없으면 **대조하지 않았다** — 빈 목록을 「누락 없음」으로 읽지 않는다.
    const tcCheck = tcChecked && units.has(featureId) ? 'checked' : 'not-checked'
    const unitTcs = list(units.get(featureId)?.testCaseIds)
    const deferredHere = unitTcs.filter(tc => deferredTcs.has(tc))
    // 책임이 없는 TC는 **분모에서 사라진 것이 아니다** — 계획 유예가 아니면 누락이다.
    const unowned = unitTcs.filter(tc => !owners.some(owner => owner.testCaseId === tc) && !deferredTcs.has(tc))
    const inactive = required.filter(item => item.lifecycle !== 'active')
    const allMerged = required.length > 0 && required.every(item => item.completed)
    const started = required.some(item => item.registration !== 'unpublished' || item.linked)
    const exceptions = required.filter(item => item.acceptedIncomplete || item.acceptedUnverifiedScope).map(item => item.workId)
    const status = inactive.length > 0 || unowned.length > 0 || required.length === 0 ? 'plan-inconsistent'
      : !started ? 'not-started'
        : !allMerged ? 'in-progress'
          : tcCheck !== 'checked' ? 'merged-tc-unchecked'
            : exceptions.length > 0 ? 'works-merged-with-exceptions'
              : deferredHere.length > 0 ? 'works-merged-with-deferrals'
                : 'works-merged'
    const closeBlockers = [
      ...(required.length === 0 ? ['no-required-work: 필수 작업이 하나도 없다'] : []),
      ...(tcCheck !== 'checked' ? ['tc-ownership-not-checked: feature-plan에서 이 FEAT의 TC를 읽지 못해 책임 대조를 하지 않았다'] : []),
      ...(inactive.length > 0 ? [`required-work-not-active: ${inactive.map(item => item.workId).join(', ')}`] : []),
      ...(unowned.length > 0 ? [`test-case-unowned: ${unowned.join(', ')}`] : []),
      ...(!allMerged ? [`works-not-merged: ${required.filter(item => !item.completed).map(item => item.workId).join(', ')}`] : []),
      ...(exceptions.length > 0 ? [`accepted-with-exceptions: ${exceptions.join(', ')} — 완료 조건·STALE 대조를 명시 인수로 넘겼다`] : []),
      ...(deferredHere.length > 0 ? [`test-cases-deferred: ${deferredHere.join(', ')}`] : []),
      CLOSE_BLOCKERS.evidence, CLOSE_BLOCKERS.disabled,
    ]
    return {...base, status, counted: true, works: required, testCases: {check: tcCheck, owners, deferred: deferredHere, unowned}, closeBlockers}
  })
  return {
    features,
    denominator: {
      counted: features.filter(feature => feature.counted).length,
      excluded: features.filter(feature => !feature.counted).map(feature => feature.featureId),
      // 상태를 **따로** 센다 — 요약 숫자 하나로 접으면 예외·유예가 「머지」에 섞여 먼저 읽힌다.
      worksMerged: features.filter(feature => feature.status === 'works-merged').length,
      worksMergedWithExceptions: features.filter(feature => feature.status === 'works-merged-with-exceptions').length,
      worksMergedWithDeferrals: features.filter(feature => feature.status === 'works-merged-with-deferrals').length,
    },
  }
}

/** 집계 티켓 본문(순수). 사람에게 보이는 표이고, 정본은 계획·원장이다 — 복제본이라 주장하지 않는다. */
export function renderAggregateBody({feature, plan, marker}) {
  const rows = list(feature.works).map(item =>
    `| ${item.title ?? item.workId} | ${item.ticketKey ?? '미발행'} | ${item.completed ? '머지됨' : item.linked ? 'PR 연결' : item.registration} |`)
  return [
    `${feature.featureId}의 작업 집계 — 이 티켓은 **개발 대상이 아니다**(WORK 티켓을 집는다).`,
    '',
    '| 작업 | 티켓 | 상태 |',
    '|---|---|---|',
    ...rows,
    '',
    `- 집계 상태: \`${feature.status}\``,
    `- 닫을 수 있는가: 아니다 — ${feature.closeBlockers.map(reason => reason.split(':')[0]).join(', ')}`,
    `- 계획 정본: \`_workspace/03_dev/work-plan.json\`(${plan.planId}) — 이 표는 요약이며 갱신 시점의 원장을 보여준다`,
    '',
    marker,
  ].join('\n')
}
