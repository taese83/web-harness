// 티켓 provider 선택과 설정(순수 + 파일 읽기).
//
// **선택은 한 번 하고 고정한다.** "claim할 때 고른다"를 매 라운드 묻게 두면 원장에 `#42`와
// `PROJ-123`이 섞이고, board가 두 소스를 합쳐 읽어야 한다. `provenance-contract.md` §5
// (선택의 영속)와 같은 형태다 — 최초 청구에서 묻고, 이후에는 **표시만** 한다.
//
// 설정은 `_workspace/03_dev/ticket-provider.json`에 둔다(원장 옆). **토큰은 넣지 않는다** —
// 인증은 환경변수이고, 이 파일은 repo에 커밋될 수 있다.

import {existsSync, readFileSync} from 'node:fs'
import {join} from 'node:path'

export const TICKET_CONFIG_RELATIVE = '_workspace/03_dev/ticket-provider.json'
export const SUPPORTED_PROVIDERS = ['github', 'jira']

/**
 * 사용자에게 받아야 하는 Jira 항목. **여기 있는 것을 하네스가 지어내지 않는다** —
 * 전부 팀마다 다르고, 틀리면 "전이했다"는 거짓 보고로 이어진다.
 */
export const JIRA_QUESTIONS = [
  {key: 'baseUrl', required: true, ask: 'Jira 주소 (예: https://jira.example.com 또는 https://your.atlassian.net)'},
  {key: 'apiVersion', required: false, ask: 'REST 버전 — Cloud는 3, Data Center는 2', default: '3'},
  {key: 'projectKey', required: true, ask: '프로젝트 키 (예: PROJ)'},
  {key: 'issueType', required: true, ask: '이슈 타입 (예: Task · Story) — 프로젝트마다 다릅니다'},
  {key: 'transitions.in-progress', required: false, ask: 'pickup 시 전이할 상태의 transition id 또는 이름 (없으면 전이하지 않습니다)'},
  {key: 'transitions.done', required: false, ask: 'PR 머지 시 전이할 상태의 transition id 또는 이름 (없으면 전이하지 않습니다)'},
  {key: 'featureField', required: false, ask: 'FEAT를 담을 커스텀 필드 (비우면 라벨로 찾습니다)'},
  {key: 'assigneeField', required: false, ask: 'assignee 표기 — Cloud는 accountId, Data Center는 name', default: 'accountId'},
]

/** 인증은 파일이 아니라 환경변수다. 어떤 변수를 보는지 한 곳에서 말한다. */
export const JIRA_AUTH_ENV = ['JIRA_TOKEN', 'JIRA_EMAIL']

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

/** 설정 형태 검증(순수). 모르는 provider를 조용히 통과시키지 않는다. */
export function validateTicketConfig(config) {
  const provider = config?.provider
  if (!SUPPORTED_PROVIDERS.includes(provider)) {
    throw new Error(`TICKET_PROVIDER_UNKNOWN: "${provider}" — 지원: ${SUPPORTED_PROVIDERS.join(', ')}`)
  }
  if (provider === 'jira' && !config.jira) {
    throw new Error('TICKET_CONFIG_INCOMPLETE: provider=jira인데 jira 설정이 없다')
  }
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

/** 사용자 답을 설정 객체로 만든다(순수). 점 표기(`transitions.done`)를 중첩으로 편다. */
export function buildTicketConfig(provider, answers = {}) {
  if (!SUPPORTED_PROVIDERS.includes(provider)) {
    throw new Error(`TICKET_PROVIDER_UNKNOWN: "${provider}"`)
  }
  if (provider === 'github') return {provider}
  const jira = {}
  for (const [key, value] of Object.entries(answers)) {
    if (value === undefined || value === null || value === '') continue
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
