import {existsSync} from 'node:fs'
import {join} from 'node:path'

export const validateAnalyticsBuilder = ({repositoryRoot, read, pass, fail}) => {
  const required = [
    '.claude/skills/analytics-chart-builder/SKILL.md',
    '.claude/skills/analytics-chart-builder/references/semantic-query-contract.md',
    '.claude/skills/analytics-chart-builder/references/chart-compatibility.md',
    '.claude/skills/analytics-chart-builder/references/dashboard-editor-contract.md',
    '.claude/agents/analytics-domain-architect.md',
    '.claude/agents/analytics-verifier.md',
  ]
  for (const path of required) if (!existsSync(join(repositoryRoot, path))) fail(`${path}: analytics builder contract is missing`)

  const orchestration = read('.claude/skills/web-orchestrator/SKILL.md')
  for (const marker of [
    'ANALYTICS_BUILDER_MODE',
    'analytics-domain-architect',
    'developer',
    'analytics-verifier',
    'qa-analytics.md',
  ]) if (!orchestration.includes(marker)) fail(`web-orchestrator analytics flow is missing ${marker}`)

  const semantic = read('.claude/skills/analytics-chart-builder/references/semantic-query-contract.md')
  for (const marker of ['metric', 'dimension', 'aggregation', 'filter', 'group', 'order', 'cardinality']) {
    if (!semantic.toLowerCase().includes(marker)) fail(`semantic query contract is missing ${marker}`)
  }

  const compatibility = read('.claude/skills/analytics-chart-builder/references/chart-compatibility.md')
  for (const marker of ['line', 'bar', 'funnel', 'retention', 'flow', 'table']) {
    if (!compatibility.toLowerCase().includes(marker)) fail(`chart compatibility contract is missing ${marker}`)
  }

  const scenarios = JSON.parse(read('.claude/evals/scenarios.json'))
  for (const id of ['semantic-analytics-dashboard-builder', 'selective-openapi-existing-change']) {
    if (!scenarios.some(scenario => scenario.id === id)) fail(`analytics portability eval is missing ${id}`)
  }
  pass('semantic analytics, selective OpenAPI, and dashboard release contracts checked')
}
