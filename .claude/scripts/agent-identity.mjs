// agent-identity.mjs — 훅이 받은 `agent_type`이 **하네스의 에이전트인가**를 가른다(파일 조회만).
//
// 플러그인으로 설치된 하네스의 에이전트는 `web-harness:<이름>`이다. 접두를 떼고 이름만 대조하면 프로젝트·사용자가
// `.claude/agents/`에 둔 같은 이름의 에이전트가 하네스 소유권·검증 제한을 물려받는다. 그래서 플러그인 판본에서
// 접두 없는 이름은 **그 이름의 에이전트를 프로젝트·사용자가 실제로 정의했을 때만** 하네스 밖으로 본다 — 정의가
// 없으면 종전처럼 하네스 에이전트로 본다(런타임이 접두 없이 보고하더라도 제한이 풀리는 쪽으로 틀리지 않는다).
// 원본 저장소(개발 판본)에서는 접두 없는 이름이 곧 하네스 에이전트다.
// 판본은 빌드 산출물에만 있는 플러그인 매니페스트로 가른다 — 환경변수는 호출자가 바꿀 수 있다.
import {existsSync, readdirSync, readFileSync} from 'node:fs'
import {homedir} from 'node:os'
import {join} from 'node:path'

export const HARNESS_AGENT_PREFIX = 'web-harness:'
const PLUGIN_MANIFEST = new URL('../../.claude-plugin/plugin.json', import.meta.url)

export const isPluginBuild = () => existsSync(PLUGIN_MANIFEST)

/** `<base>/.claude/agents/*.md` 머리말의 `name:`들(읽지 못하면 빈 집합). */
const declaredAgentNames = base => {
  const directory = join(base, '.claude/agents')
  if (!existsSync(directory)) return new Set()
  const names = new Set()
  try {
    for (const file of readdirSync(directory).filter(name => name.endsWith('.md'))) {
      const head = readFileSync(join(directory, file), 'utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/)
      const name = head?.[1].match(/^name:\s*["']?([^"'\r\n]+?)["']?\s*$/m)?.[1]
      if (name) names.add(name.trim())
    }
  } catch { return new Set() }
  return names
}

/** 프로젝트나 사용자가 이 이름의 에이전트를 정의했는가. */
export const declaresOwnAgent = (name, {projectRoot = null, home = homedir()} = {}) =>
  [projectRoot, home].filter(Boolean).some(base => declaredAgentNames(base).has(name))

/**
 * 하네스 에이전트 이름(접두 제외) 또는 null(하네스 에이전트가 아니다 · 메인 스레드).
 * @param {unknown} agentType 훅 입력의 `agent_type`
 * @param {{pluginBuild?: boolean, projectRoot?: string|null, home?: string}} [options]
 */
export function harnessAgentName(agentType, {pluginBuild = isPluginBuild(), projectRoot = null, home = homedir()} = {}) {
  const raw = String(agentType ?? '')
  if (!raw) return null
  if (raw.startsWith(HARNESS_AGENT_PREFIX)) return raw.slice(HARNESS_AGENT_PREFIX.length) || null
  if (raw.includes(':')) return pluginBuild ? null : raw
  return pluginBuild && declaresOwnAgent(raw, {projectRoot, home}) ? null : raw
}
