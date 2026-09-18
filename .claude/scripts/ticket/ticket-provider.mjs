// 티켓 provider 인터페이스 — **트래커 무관**(I3).
//
// `docs/team-workflow-integration-design.md`의 공유 척추에서 트래커에 닿는 부분만 모은 계약이다.
// 오케스트레이션(발행·픽업·완료)이 트래커 어휘를 직접 알지 않게 이음매를 이름으로 고정한다.
//
// **VCS와 티켓은 다른 축이다.** 티켓이 Jira여도 코드는 GHE일 수 있으므로(교차 형태),
// PR 생성·merged 판정·브랜치 게이트는 이 인터페이스에 **넣지 않는다** — 그것은 VCS 쪽이고
// `git-origin.mjs`·`sync-guard.mjs`·`work-link-run.mjs`가 트래커를 모른 채 담당한다.
//
// **선택 메서드의 부재는 결함이 아니라 능력의 차이다** — 없는 능력을 흉내 내지 않고,
// 못 한 일을 한 것처럼 보고하지 않는다.

/**
 * @typedef {Object} TicketProvider
 *
 * 필수 — 이것이 없으면 WORK를 발행하고 집을 수 없다.
 * @property {string} name                                    원장에 기록할 provider 식별자
 * @property {(draft: {title: string, body: string, labels?: string[], components?: string[]}) => any} buildWorkFields
 *   WORK 초안 → 트래커 발행 필드. **호출자 라벨을 보존하고 본문을 덧쓰지 않는다**(두 트래커 conformance 회귀).
 * @property {(fields: any) => Promise<any>} createIssue       발행. 반환에 키가 있어야 한다
 * @property {(key: string) => Promise<any>} resolveIssue      조회 — 픽업의 소유·종류·STALE 판정 입력
 *
 * 선택 — 없으면 그 능력이 없는 것이고, 호출자는 그 사실을 표시한다.
 * @property {(issue: any) => boolean} [isClosed]              기본 판정은 `defaultIsClosed`
 * @property {(key: string, phase: 'in-progress'|'done') => Promise<any>} [transition]
 *   상태 전이. GitHub Issues는 open/closed뿐이라 **제공하지 않는다**. Jira는 제공한다.
 *   전이할 상태 이름·id는 팀마다 다르므로 provider 설정이 들고 있고 이 인터페이스는
 *   **의도(phase)만** 넘긴다. `'In Progress'`를 여기서 말하지 않는다.
 *   픽업이 배정 뒤 `in-progress`로 호출하고, 결과를 `transition: {supported, done}`으로
 *   **항상 표시한다** — 안 한 것과 못 한 것을 구분하지 않으면 사용자는 전이된 줄 안다.
 * @property {(key: string) => string|null} [closeReference]
 *   PR 본문에 넣을 자동 닫기 참조. GitHub은 `Closes #N`, **Jira는 자동 닫기가 없어 null**이다
 *   — null이면 머지 후 `transition`으로 능동 전이해야 한다. **소비자는 아직 간접이다**:
 *   `work-link-run.mjs`의 `workCloseLine`이 provider **이름**으로 갈라 서식을 고른다.
 * @property {(key: string, text: string) => Promise<any>} [comment]
 *   티켓에 코멘트를 남긴다. **되돌림을 기획자에게 알리는 유일한 경로**다 — 없으면 개발자
 *   터미널에서 끝나고 기획자는 막힌 사실을 모른다. 없는 provider도 있을 수 있으므로 선택이며,
 *   호출자는 `notified: {supported, done}`으로 **안 한 것과 못 한 것을 구분해** 표시한다.
 * @property {(key: string, body: string) => Promise<any>} [updateBody]
 *   이슈 본문을 **교체**한다. 원시 교체이므로 호출자가 완성한 본문을 넘긴다 — 이 메서드가
 *   본문을 지어내면 사람이 쓴 내용이 사라진다. 선택이며, 호출자는 능력 부재를 표시한다.
 * @property {(key: string, login: string) => Promise<any>} [unassign]
 *   자기 배정을 거둔다. 배정이 덧붙이기인 트래커(GitHub)에서 동시 픽업을 한 사람으로 정리하는 데 쓴다.
 * @property {(message: string) => {kind: string, hint: string}} [classifyError]
 */

/** 필수 메서드. 하나라도 없으면 loud하게 거부한다 — 반쯤 구현된 provider가 조용히 도는 것보다 낫다. */
const REQUIRED = ['name', 'buildWorkFields', 'createIssue', 'resolveIssue']

/**
 * provider가 인터페이스를 만족하는지 확인한다(순수). 만족하면 그대로 반환한다.
 * @param {TicketProvider} provider
 * @returns {TicketProvider}
 */
export function requireTicketProvider(provider) {
  if (!provider || typeof provider !== 'object') {
    throw new Error('TICKET_PROVIDER_MISSING: provider가 주어지지 않았다')
  }
  const missing = REQUIRED.filter(key => {
    const value = provider[key]
    return key === 'name' ? typeof value !== 'string' || !value : typeof value !== 'function'
  })
  if (missing.length > 0) {
    throw new Error(`TICKET_PROVIDER_INCOMPLETE: ${provider.name ?? '(이름 없음)'} — 없는 필수 항목: ${missing.join(', ')}`)
  }
  return provider
}


/**
 * provider가 가진 선택 능력을 이름으로 돌려준다 — 호출자가 "없어서 안 한 것"을 표시할 수 있게.
 * @returns {{transition: boolean, autoClose: boolean, comment: boolean, updateBody: boolean}}
 */
export function providerCapabilities(provider) {
  return {
    transition: typeof provider?.transition === 'function',
    autoClose: typeof provider?.closeReference === 'function',
    comment: typeof provider?.comment === 'function',
    updateBody: typeof provider?.updateBody === 'function',
  }
}

/** 티켓 키 추출 — 트래커마다 필드가 다르다(GitHub `number`, Jira `key`). */
export function ticketKeyOf(issue) {
  const key = issue?.ticketKey ?? issue?.key ?? issue?.number ?? null
  if (key === null || key === undefined || key === '') return null
  // 객체를 그대로 받으면 `String(issue)`가 '[object Object]'를 돌려주고, 그것이 원장 스키마
  // (비어 있지 않은 문자열)를 **통과한다** — 키 없는 발행이 조용히 기록되는 경로였다.
  if (typeof key === 'object') return null
  return String(key)
}
