// 티켓 provider 인터페이스 — **트래커 무관**(I3).
//
// `docs/team-workflow-integration-design.md`의 공유 척추에서 트래커에 닿는 부분만 모은 계약이다.
// 지금까지는 `runner.mjs`가 `provider-github.mjs`를 정적 import해 필드 빌드와 조회 키(라벨)를
// 직접 알고 있었다 — provider를 주입해도 **GitHub 어휘가 오케스트레이션에 남아 있었다.**
// 이 파일이 그 이음매를 이름으로 고정한다.
//
// **VCS와 티켓은 다른 축이다.** 티켓이 Jira여도 코드는 GHE일 수 있으므로(교차 형태),
// PR 생성·merged 판정·브랜치 게이트는 이 인터페이스에 **넣지 않는다** — 그것은 VCS 쪽이고
// `git-origin.mjs`·`claim-guard.mjs`·`sync-guard.mjs`가 이미 트래커를 모른 채 담당한다.
//
// **선택 메서드의 부재는 결함이 아니라 능력의 차이다.** `runner.mjs`가 `reopenIssue`에 쓴
// 규율("되살리기를 제공하지 않는 provider면 정직하게 막는다")을 인터페이스 전체로 넓힌다 —
// 없는 능력을 흉내 내지 않고, 못 한 일을 한 것처럼 보고하지 않는다.

/**
 * @typedef {Object} TicketProvider
 *
 * 필수 — 이것이 없으면 청구 자체가 성립하지 않는다.
 * @property {string} name                                    원장에 기록할 provider 식별자
 * @property {(draft: any, options?: any) => any} buildFields  TicketDraft → 트래커 발행 필드
 * @property {(featureId: string) => Promise<any|null>} findByFeature
 *   FEAT로 기존 티켓을 찾는다. **조회 키는 provider가 정한다** — GitHub은 `feat:FEAT-001`
 *   라벨, Jira는 JQL(라벨 또는 커스텀 필드). 호출자는 키의 형태를 알지 못한다.
 * @property {(fields: any) => Promise<any>} createIssue       발행. 반환에 키가 있어야 한다
 *
 * 선택 — 없으면 그 능력이 없는 것이고, 호출자는 그 사실을 표시한다.
 * @property {(issue: any) => boolean} [isClosed]              기본 판정은 `defaultIsClosed`
 * @property {(key: string, comment?: string) => Promise<any>} [reopenIssue]
 * @property {(key: string, phase: 'in-progress'|'done') => Promise<any>} [transition]
 *   상태 전이. GitHub Issues는 open/closed뿐이라 **제공하지 않는다**. Jira는 제공한다.
 *   전이할 상태 이름·id는 팀마다 다르므로 provider 설정이 들고 있고 이 인터페이스는
 *   **의도(phase)만** 넘긴다. `'In Progress'`를 여기서 말하지 않는다.
 *   `runPickup`이 배정 뒤 `in-progress`로 호출하고, 결과를 `transition: {supported, done}`으로
 *   **항상 표시한다** — 안 한 것과 못 한 것을 구분하지 않으면 사용자는 전이된 줄 안다.
 * @property {(key: string) => string|null} [closeReference]
 *   PR 본문에 넣을 자동 닫기 참조. GitHub은 `Closes #N`, **Jira는 자동 닫기가 없어 null**이다
 *   — null이면 머지 후 `transition`으로 능동 전이해야 한다. **소비자는 아직 간접이다**:
 *   `cli.mjs`의 `renderCloseLineFor`가 provider **이름**으로 갈라 서식을 고른다(서식 정본은
 *   `renderCloseReference`). 이 메서드를 직접 부르도록 잇는 것은 남은 정리다.
 * @property {(message: string) => {kind: string, hint: string}} [classifyError]
 */

/** 필수 메서드. 하나라도 없으면 loud하게 거부한다 — 반쯤 구현된 provider가 조용히 도는 것보다 낫다. */
const REQUIRED = ['name', 'buildFields', 'findByFeature', 'createIssue']

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
 * 기본 닫힘 판정. provider가 `isClosed`를 주면 그것이 이긴다.
 * 트래커마다 어휘가 다르다 — GitHub은 state=CLOSED, Jira는 status category가 done이다.
 * 그래서 **여기서는 가장 보수적으로만** 판정하고, 정확한 판정은 provider가 소유한다.
 */
export function defaultIsClosed(issue) {
  return String(issue?.state ?? '').toUpperCase() === 'CLOSED'
}

/** provider의 판정을 쓰되 없으면 기본값. */
export function isClosedIssue(provider, issue) {
  return typeof provider?.isClosed === 'function' ? Boolean(provider.isClosed(issue)) : defaultIsClosed(issue)
}

/**
 * provider가 가진 선택 능력을 이름으로 돌려준다 — 호출자가 "없어서 안 한 것"을 표시할 수 있게.
 * @returns {{reopen: boolean, transition: boolean, autoClose: boolean}}
 */
export function providerCapabilities(provider) {
  return {
    reopen: typeof provider?.reopenIssue === 'function',
    transition: typeof provider?.transition === 'function',
    autoClose: typeof provider?.closeReference === 'function',
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
