// 티켓 provider 선택과 설정(순수 + 파일 읽기).
//
// **선택은 한 번 하고 고정한다.** "claim할 때 고른다"를 매 라운드 묻게 두면 원장에 `#42`와
// `PROJ-123`이 섞이고, board가 두 소스를 합쳐 읽어야 한다. `provenance-contract.md` §5
// (선택의 영속)와 같은 형태다 — 최초 청구에서 묻고, 이후에는 **표시만** 한다.
//
// 설정은 `_workspace/03_dev/ticket-provider.json`에 둔다(원장 옆). **토큰은 넣지 않는다** —
// 인증은 환경변수이고, 이 파일은 repo에 커밋될 수 있다.

import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {dirname, join} from 'node:path'

export const TICKET_CONFIG_RELATIVE = '_workspace/03_dev/ticket-provider.json'
export const SUPPORTED_PROVIDERS = ['github', 'jira']

/**
 * 사용자에게 받아야 하는 Jira 항목. **여기 있는 것을 하네스가 지어내지 않는다** —
 * 전부 팀마다 다르고, 틀리면 "전이했다"는 거짓 보고로 이어진다.
 */
export const JIRA_QUESTIONS = [
  {key: 'baseUrl', required: true, ask: 'Jira 주소 (예: https://jira.example.com 또는 https://your.atlassian.net)'},
  // **호스트가 배포 형태를 거의 결정한다.** `*.atlassian.net`이면 Cloud(3·accountId·ADF),
  // 자체 호스팅이면 Data Center(2·name·평문)다. 2026-09-02 실측: 사내 Jira에 Cloud 기본값을
  // 넣으면 description이 ADF 객체로 나가 발행이 깨진다 — 기본값을 그냥 두면 걸리는 자리다.
  {key: 'apiVersion', required: false, ask: 'REST 버전 — Cloud(*.atlassian.net)는 3, 자체 호스팅(Data Center)은 2', default: '3'},
  {key: 'projectKey', required: true, ask: '프로젝트 키 (예: PROJ)'},
  {key: 'issueType', required: true, ask: '이슈 타입 (예: Task · Story) — 프로젝트마다 다릅니다'},
  {key: 'transitions.in-progress', required: false, ask: 'pickup 시 부를 **전이(transition)** id 또는 이름 — 도착 상태 이름과 다를 수 있습니다(실측: 전이 "Resolved" → 상태 "Done"). 헷갈리면 id. 없으면 전이하지 않습니다'},
  {key: 'transitions.done', required: false, ask: 'PR 머지 시 부를 **전이(transition)** id 또는 이름 (없으면 전이하지 않습니다)'},
  {key: 'featureField', required: false, ask: 'FEAT를 담을 커스텀 필드 (비우면 라벨로 찾습니다)'},
  {key: 'assigneeField', required: false, ask: 'assignee 표기 — Cloud는 accountId, 자체 호스팅은 name', default: 'accountId'},
  {key: 'components', required: false, ask: '이슈에 붙일 컴포넌트 (쉼표 구분, 그 프로젝트에 실재하는 이름). 비우면 안 붙입니다'},
  {key: 'labels', required: false, ask: '모든 티켓에 공통으로 붙일 라벨 (쉼표 구분). 하네스 라벨(feat-·branch-)에 더해집니다'},
]

/** 인증은 파일이 아니라 환경변수다. 어떤 변수를 보는지 한 곳에서 말한다. */
export const JIRA_AUTH_ENV = ['JIRA_TOKEN', 'JIRA_EMAIL']

/** 쉼표 구분 답을 배열로 받는 필드 — 값이 여럿인 것은 사용자가 한 줄로 적는다. */
const LIST_FIELDS = new Set(['components', 'labels'])

/**
 * 설정 파일을 읽는다. 없으면 null(=아직 고르지 않았다).
 * @returns {{provider: string, jira?: Object}|null}
 */
export function readTicketConfig(root, {relative = TICKET_CONFIG_RELATIVE} = {}) {
  const path = join(root, relative)
  if (!existsSync(path)) return null
  const parsed = JSON.parse(readFileSync(path, 'utf8'))
  return validateTicketConfig(parsed)
}

/** 목록 필드는 배열이어야 한다. 손편집으로 문자열이 들어오면 글자 단위로 흩어져 조용히 나간다. */
function assertListShape(jira) {
  for (const key of LIST_FIELDS) {
    const value = jira?.[key]
    if (value === undefined || Array.isArray(value)) continue
    throw new Error(`TICKET_CONFIG_INVALID_SHAPE: jira.${key}는 배열이어야 한다(받은 값: ${typeof value}) — `
      + '문자열이면 글자 단위로 흩어져 발행 payload에 조용히 실린다')
  }
}

/** 설정 형태 검증(순수). 모르는 provider를 조용히 통과시키지 않는다. */
export function validateTicketConfig(config) {
  const provider = config?.provider
  if (!SUPPORTED_PROVIDERS.includes(provider)) {
    throw new Error(`TICKET_PROVIDER_UNKNOWN: "${provider}" — 지원: ${SUPPORTED_PROVIDERS.join(', ')}`)
  }
  if (provider === 'jira' && !config.jira) {
    throw new Error('TICKET_CONFIG_INCOMPLETE: provider=jira인데 jira 설정이 없다')
  }
  assertListShape(config.jira)
  return config
}

/**
 * 이번 실행에서 어느 provider를 쓸지 판정한다(순수) — **선택의 영속**.
 *
 *  - 저장된 것이 없다: 요청값을 쓰되, 없으면 `needsChoice`(스킬이 묻는다)
 *  - 저장된 것이 있고 요청이 없거나 같다: 저장된 것 — **다시 묻지 않는다**
 *  - 저장된 것과 다른 것을 요청: **조용히 바꾸지 않는다.** 기존 티켓이 다른 트래커에 남아 있고
 *    board가 두 소스를 읽어야 하므로 명시적 전환 확인이 필요하다
 *
 * @returns {{provider: string|null, needsChoice: boolean, switching?: {from: string, to: string}}}
 */
export function resolveProviderChoice({stored = null, requested = null} = {}) {
  const storedProvider = stored?.provider ?? null
  if (requested && !SUPPORTED_PROVIDERS.includes(requested)) {
    throw new Error(`TICKET_PROVIDER_UNKNOWN: "${requested}" — 지원: ${SUPPORTED_PROVIDERS.join(', ')}`)
  }
  if (!storedProvider) {
    return requested
      ? {provider: requested, needsChoice: false, first: true}
      : {provider: null, needsChoice: true}
  }
  if (!requested || requested === storedProvider) return {provider: storedProvider, needsChoice: false}
  return {provider: storedProvider, needsChoice: false, switching: {from: storedProvider, to: requested}}
}

/**
 * 원장 레코드의 provider를 읽는다 — **없으면 'github'**.
 * 이 필드는 2026-09-02에 생겼고 그 전 레코드는 전부 GitHub이다. 기본값을 문서에만 적으면
 * 읽는 쪽마다 다르게 가정한다.
 */
export function recordProvider(record) {
  return record?.provider ?? 'github'
}

/**
 * 사용자 답을 설정 객체로 만든다(순수). 점 표기(`transitions.done`)를 중첩으로 펴고,
 * 목록 필드는 쉼표로 나눈다. 빈 답은 넣지 않는다 — 빈 배열이 설정에 들어가면 "지정했는데
 * 비었다"와 "지정 안 했다"가 구분되지 않는다.
 */
export function buildTicketConfig(provider, answers = {}) {
  if (!SUPPORTED_PROVIDERS.includes(provider)) {
    throw new Error(`TICKET_PROVIDER_UNKNOWN: "${provider}"`)
  }
  if (provider === 'github') return {provider}
  const jira = {}
  for (const [key, value] of Object.entries(answers)) {
    if (value === undefined || value === null || value === '') continue
    if (LIST_FIELDS.has(key)) {
      const items = String(value).split(',').map(item => item.trim()).filter(Boolean)
      if (items.length > 0) jira[key] = items
      continue
    }
    const path = key.split('.')
    let target = jira
    while (path.length > 1) {
      const segment = path.shift()
      target[segment] = target[segment] ?? {}
      target = target[segment]
    }
    target[path[0]] = value
  }
  return {provider, jira}
}

/**
 * **비밀로 보이는 키는 설정 파일에 쓰지 않는다.** 이 파일은 repo에 커밋되고 팀에 공유된다 —
 * 토큰이 한 번 들어가면 히스토리에서 지우기 어렵다. 인증은 환경변수다(`JIRA_AUTH_ENV`).
 */
const SECRET_LIKE = /(token|secret|password|passwd|apikey|api_key|credential|auth|pat|pw)/i

/** 설정에 들어갈 수 있는 키 — `JIRA_QUESTIONS`가 정본이다(그 목록이 곧 스키마다). */
export const ALLOWED_JIRA_KEYS = new Set(JIRA_QUESTIONS.map(q => q.key))

/**
 * **허용 목록 밖의 키는 받지 않는다.** 종전에는 "비밀로 보이는 이름"만 걸렀는데, 그것은
 * 프록시였다 — `jiraPat`·`pw`는 통과했고 `buildTicketConfig`가 모르는 키를 그대로 저장했다.
 * 유효 키가 `JIRA_QUESTIONS`로 **완전히 열거**돼 있으므로 allowlist가 더 강한 하한이다:
 * 어떤 이름의 비밀도 막고, `projectkey` 같은 오타를 발행 시점이 아니라 여기서 잡는다.
 *
 * SECRET_LIKE는 이제 **거부 사유를 더 정확히 말하기 위한 힌트**로만 쓴다.
 */
export function assertAllowedKeys(answers = {}) {
  const unknown = Object.keys(answers).filter(key => !ALLOWED_JIRA_KEYS.has(key))
  if (unknown.length === 0) return answers
  const secretish = unknown.filter(key => SECRET_LIKE.test(key))
  const hint = secretish.length > 0
    ? `\n  ${secretish.join(', ')}는 비밀로 보인다 — 이 파일은 repo에 커밋되고 팀에 공유된다. 인증은 환경변수다(${JIRA_AUTH_ENV.join(' · ')}).`
    : ''
  throw new Error(
    `TICKET_CONFIG_UNKNOWN_KEY: ${unknown.join(', ')} — 허용: ${[...ALLOWED_JIRA_KEYS].join(', ')}${hint}`,
  )
}

/** 하위호환 별칭. 이름이 하던 주장(비밀을 막는다)보다 실제가 넓어졌다. */
export const assertNoSecrets = assertAllowedKeys

/**
 * 설정을 기록한다(side-effect). 호출자가 `--confirm` 게이트를 통과시킨 뒤에만 부른다.
 * 디렉터리가 없으면 만든다 — 최초 설정이 워크스페이스 생성보다 먼저일 수 있다.
 */
export function writeTicketConfig(root, config, {relative = TICKET_CONFIG_RELATIVE} = {}) {
  validateTicketConfig(config)
  // 값 안에 숨은 자격증명 — 키 이름 검사로는 안 잡힌다.
  const baseUrl = String(config?.jira?.baseUrl ?? '')
  if (/:\/\/[^/@]+:[^/@]+@/.test(baseUrl)) {
    throw new Error('TICKET_CONFIG_SECRET_REFUSED: baseUrl에 자격증명이 들어 있다 — 인증은 환경변수로 준다')
  }
  const path = join(root, relative)
  mkdirSync(dirname(path), {recursive: true})
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`)
  return relative
}

/**
 * 기존 설정 위에 덮어쓰는가를 판정한다(순수). **provider가 바뀌는 덮어쓰기는 조용히 하지 않는다** —
 * 기존 티켓이 다른 트래커에 남아 있고 board가 두 소스를 읽어야 한다.
 * @returns {{ok: boolean, reason?: string, from?: string, to?: string}}
 */
export function evaluateConfigWrite({existing = null, next, replace = false}) {
  if (!existing) return {ok: true}
  // **덮어쓰지 않고 병합한다.** `--set labels=…` 하나 주려다 `transitions`가 통째로 사라지는 것은
  // 방금 고친 반복 플래그 침묵 손실과 같은 클래스다(한 단계 뒤에 남아 있었다).
  if (existing.provider === next.provider) {
    const merged = {...next, jira: {...(existing.jira ?? {}), ...(next.jira ?? {}),
      ...(existing.jira?.transitions || next.jira?.transitions
        ? {transitions: {...(existing.jira?.transitions ?? {}), ...(next.jira?.transitions ?? {})}}
        : {})}}
    if (next.provider === 'github') delete merged.jira
    return {ok: true, updating: true, merged}
  }
  if (replace) return {ok: true, switching: {from: existing.provider, to: next.provider}}
  return {ok: false, reason: 'provider-switch', from: existing.provider, to: next.provider}
}
