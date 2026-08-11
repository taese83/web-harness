import {existsSync} from 'node:fs'
import {join} from 'node:path'

export const validatePlanningFacilitation = ({repositoryRoot, read, pass, fail}) => {
  const requiredFiles = [
    '.claude/skills/web-plan/references/planning-facilitation-contract.md',
    '.claude/skills/web-plan/references/planning-readiness-contract.md',
    '.claude/agents/planning-facilitator.md',
  ]
  for (const relativePath of requiredFiles) {
    if (!existsSync(join(repositoryRoot, relativePath))) fail(`${relativePath}: planning facilitation contract is missing`)
  }

  const orchestration = `${read('.claude/skills/web-plan/SKILL.md')}\n${read('.claude/skills/web-orchestrator/SKILL.md')}`
  for (const marker of [
    'planning-facilitator',
    'planning-context.md',
    'planning-facilitation-contract.md',
    'planning-readiness-contract.md',
    'plan-reviewer',
  ]) {
    if (!orchestration.includes(marker)) fail(`planning orchestration is missing ${marker}`)
  }
  for (const relativePath of [
    '.claude/skills/web-plan/SKILL.md',
    '.claude/skills/web-orchestrator/SKILL.md',
  ]) {
    const fullSource = read(relativePath)
    const source = fullSource.slice(fullSource.indexOf(relativePath.includes('web-plan') ? '## 실행' : '### Phase 1'))
    const order = [
      'planning-facilitator',
      'requirements-analyst',
      'ux-researcher',
      'feature-planner',
      'tech-advisor',
      'planning-synthesizer',
      'plan-reviewer',
    ].map(marker => source.indexOf(marker))
    if (order.some(index => index < 0) || order.some((index, position) => position > 0 && index <= order[position - 1])) {
      fail(`${relativePath}: planning agents are not ordered product context → requirements → UX → feature → tech → synthesis → review`)
    }
  }
  const sourceIngestion = `${read('.claude/skills/web-orchestrator/references/source-artifacts.md')}\n${read('.claude/agents/source-artifact-ingestor.md')}`
  for (const marker of ['planning-context.md', 'planning-facilitation-contract.md', 'planning-readiness-contract.md']) {
    if (!sourceIngestion.includes(marker)) fail(`source artifact planning normalization is missing ${marker}`)
  }

  const facilitation = read('.claude/skills/web-plan/references/planning-facilitation-contract.md')
  for (const marker of ['대상 화면/기능', '자동 UX Check', 'Annotation Review', 'Current Planning Memo']) {
    if (!facilitation.includes(marker)) fail(`planning facilitation contract is missing ${marker}`)
  }

  const readiness = read('.claude/skills/web-plan/references/planning-readiness-contract.md')
  for (const marker of [
    'production-integration-later',
    'S | M | L | XL',
    'invest | reduce | split',
    'production mutation',
    'PASS',
    'NEEDS_DECISION',
    'BLOCKED',
  ]) {
    if (!readiness.includes(marker)) fail(`planning readiness contract is missing ${marker}`)
  }

  const agents = [
    '.claude/agents/requirements-analyst.md',
    '.claude/agents/ux-researcher.md',
    '.claude/agents/feature-planner.md',
    '.claude/agents/tech-advisor.md',
    '.claude/agents/planning-synthesizer.md',
    '.claude/agents/plan-reviewer.md',
  ].map(read).join('\n')
  for (const marker of ['planning-context.md', 'UX Check', 'Mock→real', 'NEEDS_DECISION']) {
    if (!agents.includes(marker)) fail(`planning agent chain is missing ${marker}`)
  }

  const scenarios = JSON.parse(read('.claude/evals/scenarios.json'))
  for (const id of [
    'product-first-planning-intake',
    'annotated-dashboard-ux-planning',
    'planning-data-effort-readiness',
  ]) {
    if (!scenarios.some(scenario => scenario.id === id)) fail(`required planning eval is missing: ${id}`)
  }
  pass('product-first intake, UX checkpoint, data strategy, effort, and readiness contracts checked')
}
