// validate-agent-runtime-settings.mjs — 에이전트·스킬 프런트매터의 model·effort 값을 기계로 검사한다(순수).
// Claude Code는 모르는 model·effort 값을 오류 없이 무시한다. 에이전트에 effort가 없으면 세션의 노력 수준을
// 물려받는다 — max 세션이면 모든 에이전트가 max로 돈다. 그래서 에이전트는 effort를 반드시 적는다.
export const AGENT_MODEL_ALIASES = new Set(['opus', 'sonnet', 'haiku', 'fable', 'inherit'])
export const EFFORT_LEVELS = new Set(['low', 'medium', 'high', 'xhigh', 'max'])
const MODEL_ID = /^claude-[a-z0-9]+(?:-[a-z0-9]+)*(?:\[1m\])?$/

const modelFailure = (relativePath, model) =>
  model && !AGENT_MODEL_ALIASES.has(model) && !MODEL_ID.test(model)
    ? [`${relativePath}: model "${model}" is neither an alias (${[...AGENT_MODEL_ALIASES].join('|')}) nor a model id — unknown values are ignored silently`]
    : []
const effortFailure = (relativePath, effort) =>
  effort && !EFFORT_LEVELS.has(effort)
    ? [`${relativePath}: effort "${effort}" is not one of ${[...EFFORT_LEVELS].join('|')}`]
    : []

/** 에이전트: model 값이 알려진 것이고 effort가 있으며 허용 값이다. */
export const agentRuntimeSettingFailures = (relativePath, frontmatter) => [
  ...modelFailure(relativePath, frontmatter.model),
  ...(frontmatter.effort ? effortFailure(relativePath, frontmatter.effort)
    : [`${relativePath}: effort must be explicit — an omitted effort inherits the session's level`]),
]

/** 스킬: model·effort는 선택이지만 적었다면 허용 값이어야 한다. */
export const skillRuntimeSettingFailures = (relativePath, frontmatter) => [
  ...modelFailure(relativePath, frontmatter.model),
  ...effortFailure(relativePath, frontmatter.effort),
]
