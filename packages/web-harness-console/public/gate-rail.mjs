// 게이트 레일 · '지금 존' 파생 (순수) — 콘솔 디자인 개편 2단계.
//
// 승인 렌더(Gate Rail)의 두 주장을 **실제 증거에서만** 만든다:
//  ① 정체성 — 증거-게이트 파이프라인을 화면 척추로 상시 노출
//  ② 위계 — '지금 필요한 행동'이 주인공
//
// 규율(I1): 표시하는 모든 상태는 detail payload의 사실에서 파생한다. 근거가 없으면
// 'unknown'(판정 불가)이며, 이를 pass로 격상하지 않는다. 후보 렌더의 목업 수치(18/21 등)는
// 이식 대상이 아니다 — 형식만 이식하고 값은 실측에서 온다.

/** 실행 기록 1건의 성공 여부 — QA 탭과 같은 판정(exit code 그대로). */
const runOk = record => record?.exitCode === 0 && !record?.timedOut && !record?.spawnError

/**
 * 파이프라인 6게이트 상태(순수).
 * status: 'pass'(증거 있음) | 'attention'(행동 필요) | 'none'(해당 없음/미시작) | 'unknown'(판정 불가)
 */
export function deriveGates(detail) {
  const counts = detail?.phaseCounts ?? {}
  const preview = detail?.preview ?? null
  const qa = detail?.qa ?? {}
  const stage = detail?.stage ?? {}
  const tcRuns = qa.tcRuns ?? {}
  const runIds = Object.keys(tcRuns)

  // Source — 외부 원본 문서. 0건은 결함이 아니라 "외부 원본 없음"이라는 정상 상태다.
  const source = counts.source > 0
    ? {status: 'pass', detail: `${counts.source}건`}
    : {status: 'none', detail: '외부 원본 없음'}

  // Plan — 기획 산출물 존재. 체크포인트 승인의 기계 증거는 콘솔에 없으므로 "승인됨"이라
  // 말하지 않는다(존재만 사실).
  const plan = counts.plan > 0
    ? {status: 'pass', detail: `${counts.plan}건 · FEAT ${detail?.featureCount ?? 0} / TC ${detail?.testCaseCount ?? 0}`}
    : {status: 'none', detail: '기획 문서 없음'}

  // Design — 프리뷰 승인 상태가 유일한 기계 증거(validate-design-preview 산출).
  // 필드는 payload 실측 이름 `status`다(`state` 아님 — 실측: 오타로 APPROVED가 '프리뷰 없음'으로
  // 표시되는 사고, 라이브 검증에서 발견. 픽스처가 같은 오해를 담으면 테스트도 함께 틀린다).
  const previewState = preview?.status ?? 'ABSENT'
  const designByState = {
    APPROVED: {status: 'pass', detail: '프리뷰 승인됨'},
    STALE: {status: 'attention', detail: '프리뷰 STALE — 재생성·재승인 필요'},
    UNAPPROVED: {status: 'attention', detail: '프리뷰 승인 대기'},
    MISSING: {status: 'attention', detail: '프리뷰 산출물 누락'},
    INVALID: {status: 'attention', detail: '프리뷰 구성 오류'},
  }
  const design = designByState[previewState] ?? (counts.design > 0
    ? {status: 'none', detail: `${counts.design}건 · 프리뷰 없음`}
    : {status: 'none', detail: '설계 문서 없음'})

  // Dev — 구현 진척률의 기계 증거는 없다. 있는 사실만: change-scope 발급, TC 실행 기록 존재.
  const dev = runIds.length > 0
    ? {status: 'pass', detail: `실행 기록 ${runIds.length}개 TC`}
    : stage.changeScope
      ? {status: 'attention', detail: 'change-scope 발급됨 · 실행 기록 없음'}
      : {status: 'unknown', detail: '판정 불가 — 콘솔은 구현 진척을 읽지 않음'}

  // QA — receipt 상태 집계가 1차, 없으면 TC 실행 결과가 2차(둘 다 없으면 none).
  const receipts = qa.receipts ?? []
  const failing = receipts.filter(receipt => receipt.status && receipt.status !== 'PASS')
  const failedRuns = runIds.filter(id => tcRuns[id]?.latest && !runOk(tcRuns[id].latest))
  let qaGate
  if (receipts.length > 0) {
    qaGate = failing.length > 0
      ? {status: 'attention', detail: `receipt ${failing.length}/${receipts.length} 비통과`}
      : {status: 'pass', detail: `receipt ${receipts.length}건 통과`}
  } else if (runIds.length > 0) {
    qaGate = failedRuns.length > 0
      ? {status: 'attention', detail: `TC 실행 실패 ${failedRuns.length}건`}
      : {status: 'pass', detail: `TC 실행 ${runIds.length}건 통과 · receipt 없음`}
  } else {
    qaGate = {status: 'none', detail: 'QA 증거 없음'}
  }

  // Release — HANDOFF 존재가 유일한 사실. release-readiness만 있으면 tier 보고 상태.
  const release = stage.handoff
    ? {status: 'pass', detail: 'HANDOFF 발행됨'}
    : stage.releaseReadiness
      ? {status: 'attention', detail: 'release-readiness — tier 미달'}
      : {status: 'none', detail: '릴리스 산출 없음'}

  return [
    {id: 'source', label: 'Source', ...source},
    {id: 'plan', label: 'Plan', ...plan},
    {id: 'design', label: 'Design', ...design},
    {id: 'dev', label: 'Dev', ...dev},
    {id: 'qa', label: 'QA', ...qaGate},
    {id: 'release', label: 'Release', ...release},
  ]
}

/**
 * '지금' 게이트 — 파이프라인에서 현재 주의가 필요한 첫 지점(순수).
 * attention이 있으면 그 첫 게이트, 없으면 pass 뒤의 첫 미시작(none) 게이트, 그것도 없으면 null.
 */
export function currentGateId(gates) {
  const attention = gates.find(gate => gate.status === 'attention')
  if (attention) return attention.id
  const lastPass = gates.map(gate => gate.status).lastIndexOf('pass')
  const next = gates.slice(lastPass + 1).find(gate => gate.status === 'none' || gate.status === 'unknown')
  return next?.id ?? null
}

/**
 * 다음 행동 목록(순수) — 화면의 주인공. 사실 신호에서만 파생하고 지어내지 않는다.
 * 각 항목: {id, title, why, tab} — tab은 그 행동을 수행하는 콘솔 탭.
 */
export function deriveNextActions(detail) {
  const actions = []
  const qa = detail?.qa ?? {}
  const preview = detail?.preview ?? null
  const tcRuns = qa.tcRuns ?? {}

  // ① 열린 변경 요청 — 승인/반려 결정 대기
  const openRequests = (detail?.changeRequests ?? []).filter(request => {
    const status = (request.status ?? '').toLowerCase()
    return status === 'open' || status === 'pending' || status === 'proposed' || status === ''
  })
  if (openRequests.length > 0) {
    actions.push({
      id: 'review-change-requests',
      title: `변경 요청 ${openRequests.length}건 검토`,
      why: openRequests.slice(0, 3).map(request => request.id ?? request.changeRequestId).filter(Boolean).join(', ') || '승인/반려 결정 대기',
      tab: 'features',
    })
  }

  // ② 프리뷰 상태가 승인 아님 — 기획 확인 표면이 열려 있음
  if (preview && preview.status !== 'APPROVED' && preview.status !== 'ABSENT') {
    const label = {STALE: '프리뷰 재생성·재승인', UNAPPROVED: '프리뷰 검토·승인', MISSING: '프리뷰 산출물 복구', INVALID: '프리뷰 구성 오류 수정'}[preview.status]
    if (label) actions.push({id: 'preview', title: label, why: `현재 상태 ${preview.status}`, tab: 'design'})
  }

  // ③ 실패한 TC 실행 — exit code 사실
  const failed = Object.entries(tcRuns).filter(([, bucket]) => bucket.latest && !runOk(bucket.latest)).map(([id]) => id)
  if (failed.length > 0) {
    actions.push({
      id: 'failing-tc',
      title: `실패 TC ${failed.length}건 수정`,
      why: failed.slice(0, 4).join(' · '),
      tab: 'qa',
    })
  }

  // ④ 미실행 TC — 인벤토리에 있으나 실행 기록 없음(실행 채널이 선언된 프로젝트만)
  if (qa.tcRunCommandDeclared) {
    const inventory = new Set((detail?.features ?? []).flatMap(feature => feature.testCaseIds ?? []))
    const never = [...inventory].filter(id => !tcRuns[id])
    if (never.length > 0) {
      actions.push({id: 'unrun-tc', title: `미실행 TC ${never.length}건 실행`, why: never.slice(0, 4).join(' · '), tab: 'qa'})
    }
  }

  // ⑤ 세션 변경 감지 — 서버 시작 이후 변경된 문서
  const changed = detail?.changeSummary?.total ?? 0
  if (changed > 0) {
    actions.push({id: 'session-changes', title: `세션 변경 ${changed}건 확인`, why: '서버 시작 이후 감지된 Source/Plan/Design 변경', tab: 'documents'})
  }

  return actions
}

/** PULSE — 요약 사실 목록(순수). 값이 없으면 '—'로 표기하고 추정하지 않는다. */
export function derivePulse(detail) {
  const qa = detail?.qa ?? {}
  const tcRuns = qa.tcRuns ?? {}
  const ids = Object.keys(tcRuns)
  const passed = ids.filter(id => runOk(tcRuns[id].latest)).length
  const inventory = new Set((detail?.features ?? []).flatMap(feature => feature.testCaseIds ?? [])).size
  const previewState = detail?.preview?.status ?? 'ABSENT'
  const openRequests = (detail?.changeRequests ?? []).filter(request => {
    const status = (request.status ?? '').toLowerCase()
    return status === 'open' || status === 'pending' || status === 'proposed' || status === ''
  }).length
  return [
    {label: 'Design preview', value: previewState, tone: previewState === 'APPROVED' ? 'go' : previewState === 'ABSENT' ? 'muted' : 'warn'},
    {label: 'TC 실행', value: ids.length > 0 ? `${passed} pass / ${ids.length} run · 인벤토리 ${inventory}` : `기록 없음 · 인벤토리 ${inventory}`, tone: ids.length === 0 ? 'muted' : passed === ids.length ? 'go' : 'warn'},
    {label: 'Change requests', value: openRequests > 0 ? `${openRequests} open` : `${(detail?.changeRequests ?? []).length}건 · open 없음`, tone: openRequests > 0 ? 'warn' : 'muted'},
    {label: 'Session changes', value: String(detail?.changeSummary?.total ?? 0), tone: (detail?.changeSummary?.total ?? 0) > 0 ? 'warn' : 'muted'},
  ]
}

/**
 * 티켓 행의 파이프라인 단계(순수) — 워크플로우 보드의 게이트 레일 축소형.
 * 로컬-only v1에서 **증명 가능한 3단계**만 쓴다: 청구(원장 ticketKey) → PR(prUrl) → 완료(closed).
 * 배정(픽업)은 트래커 미연동이라 미상이므로 단계로 만들지 않는다(모르는 것을 그리지 않음).
 * push 이전 상태(local-new/local-modified)는 청구 자체가 불가하므로 전 단계 미도달이다.
 * @param {{status: string, ticketKey?: string|number|null, prUrl?: string|null}} row
 * @returns {Array<{id: string, label: string, done: boolean}>}
 */
export function deriveTicketStages(row) {
  const status = row?.status ?? 'unclaimed'
  const claimed = status === 'claimed' || status === 'pr-linked' || status === 'closed' || status === 'plan-removed'
  const linked = status === 'pr-linked' || status === 'closed'
  const done = status === 'closed'
  return [
    {id: 'claim', label: '청구', done: claimed},
    {id: 'pr', label: 'PR 연결', done: linked},
    {id: 'done', label: '완료', done},
  ]
}
