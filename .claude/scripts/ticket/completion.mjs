// completion.mjs — 티켓 완료 조건 판정(순수 코어).
//
// PR을 티켓에 연결하는 순간이 **완료를 주장하는 순간**이다. 그런데 그 자리에 "이 FEAT의
// 수용 기준이 실제로 검증됐는가"를 묻는 것이 없었다 — 지켜진 것은 개발자가 잘한 것이지
// 게이트가 지킨 것이 아니었다(2026-08-30 실측: track의 머지된 6개 FEAT는 TC 100% 인용으로
// 상태가 좋았으나, 그것을 확인한 기계는 하나도 없었다).
//
// **판정**: 이 FEAT의 TC가 전부 소스·테스트에서 인용되는가. 인용되지 않은 것은 계획이
// **명시적으로 유예**했는가.
//
// 프록시 한계(§4에 기등록된 클래스와 같다): 텍스트에 ID가 있는지만 본다 — 주석만 달아도
// 통과하고, 그 테스트가 그 기준을 **실제로** 검증하는지는 못 본다. 그 판정은 code-reviewer의
// 몫이다. 여기서 잡는 것은 **아예 없는 것**이며, 그것만으로도 "완료 주장"의 하한이 생긴다.

// 계획이 TC를 유예했다는 **명시 마커**. 처음에는 산문 표현(`검증 불가`·`실행 불가` 등)을
// 정규식으로 잡았는데, 리뷰가 반례를 냈다 — `TC-002-3: 손상 문자열이면 실행 불가 안내를
// 띄운다`는 **정상 TC**인데 유예로 분류돼 미인용인 채 통과한다(fail-open). 내용어와 메타
// 표현을 산문으로 가를 수 없으므로 마커를 계약한다. **사유는 필수**다 — 사유 없는 토큰은
// 그냥 무료 통과권이 된다.
//
// 유예는 **계획 문서에 적혀 있어야** 한다 — 개발자가 PR에서 선언하는 것이 아니다(그러면
// 완료 조건을 스스로 낮추는 경로가 된다).
const DEFERRED = /\[유예:\s*[^\]\s][^\]]*\]/

/** 계획 본문에서 이 FEAT의 TC ID를 모은다(자기 번호만 — 남의 TC를 끌어오지 않는다). */
export function testCaseIdsOf(featureId, planText) {
  const own = String(featureId).slice('FEAT-'.length)
  return [...new Set(String(planText ?? '').match(new RegExp(`\\bTC-${own}-\\d+\\b`, 'g')) ?? [])].sort()
}

/**
 * 계획이 유예한 TC. 그 TC ID가 나오는 **줄**에 유예 표현이 함께 있어야 한다 —
 * 문서 어딘가에 그 낱말이 있다는 것만으로는 유예가 아니다.
 */
export function deferredTestCases(planText) {
  const deferred = new Set()
  for (const line of String(planText ?? '').split(/\r?\n/)) {
    if (!DEFERRED.test(line)) continue
    for (const id of line.match(/\bTC-\d+-\d+\b/g) ?? []) deferred.add(id)
  }
  return deferred
}

/**
 * 완료 조건 판정(순수). `citedIds`는 caller가 소스·테스트에서 긁어 넘긴다.
 * @returns {{ok: boolean, total: number, cited: string[], deferred: string[], missing: string[], reason?: string}}
 */
export function evaluateTicketCompletion({featureId, planText, testCaseIds, citedIds = []}) {
  // 단위(units.json)는 `testCaseIds`를 **구조 필드**로 갖는다 — 있으면 산문 파싱보다 그것이
  // 정확하다(다른 FEAT의 TC를 끌어올 여지도 없다). 없으면 계획 산문에서 자기 번호만 모은다.
  const all = Array.isArray(testCaseIds) && testCaseIds.length > 0
    ? [...new Set(testCaseIds)].sort()
    : testCaseIdsOf(featureId, planText)
  if (all.length === 0) {
    // TC가 하나도 없는 FEAT는 **통과가 아니라 판정 불가**다. 검증 기준이 없으면 완료를
    // 주장할 근거도 없다(축이 없으면 통과가 아니다).
    return {ok: false, total: 0, cited: [], deferred: [], missing: [], reason: 'no-test-cases'}
  }
  const cited = new Set(citedIds)
  const deferred = deferredTestCases(planText)
  const missing = all.filter(id => !cited.has(id) && !deferred.has(id))
  return {
    ok: missing.length === 0,
    total: all.length,
    cited: all.filter(id => cited.has(id)),
    deferred: all.filter(id => deferred.has(id) && !cited.has(id)),
    missing,
    ...(missing.length > 0 ? {reason: 'uncited-test-cases'} : {}),
  }
}

/** 사람이 읽을 한 줄. 유예는 숨기지 않고 함께 센다 — "통과"와 "유예"는 다르다. */
export function formatCompletion(result) {
  if (result.reason === 'no-test-cases') return '수용 기준(TC)이 하나도 없다 — 완료를 주장할 근거가 없다'
  const parts = [`TC ${result.cited.length}/${result.total} 인용`]
  if (result.deferred.length > 0) parts.push(`계획이 유예 ${result.deferred.length}건(${result.deferred.join(', ')})`)
  if (result.missing.length > 0) parts.push(`미인용 ${result.missing.length}건(${result.missing.join(', ')})`)
  return parts.join(' · ')
}
