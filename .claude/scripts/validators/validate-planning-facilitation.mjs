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
    // 언어 독립 앵커(영문화 선행) — 한국어 헤딩이 사라져도 indexOf가 -1이 되어 문서 전체를
    // 훑는 조용한 완화가 일어나지 않게 한다(앵커 없으면 FAIL).
    const anchors = relativePath.includes('web-plan') ? ['## 실행', '## Execution'] : ['### Phase 1']
    const anchorAt = anchors.map(a => fullSource.indexOf(a)).find(i => i >= 0)
    if (anchorAt === undefined) {
      fail(`${relativePath}: planning order anchor (${anchors.join(' | ')}) not found — 번역·리팩터로 앵커가 사라졌는지 확인하라`)
      continue
    }
    const source = fullSource.slice(anchorAt)
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
  // **파일별로 단언한다.** 종전에는 두 파일을 합쳐 `includes`했는데, ingestor 하나가 세 마커를
  // 모두 갖고 있어 계약 파일 쪽은 비어도 통과했다 — 합집합 검사는 소유자를 강제하지 못한다
  // (적대 리뷰 2026-09-04). 정규화 규칙의 집은 이제 source-normalization.md다.
  const normalization = read('.claude/skills/web-orchestrator/references/source-normalization.md')
  for (const marker of ['planning-context.md', 'planning-facilitation-contract.md', 'planning-readiness-contract.md']) {
    if (!normalization.includes(marker)) fail(`source-normalization.md is missing the planning normalization marker ${marker}`)
  }
  const ingestor = read('.claude/agents/source-artifact-ingestor.md')
  for (const pointer of ['source-artifacts.md', 'source-normalization.md']) {
    if (!ingestor.includes(pointer)) fail(`source-artifact-ingestor must read ${pointer}`)
  }

  const facilitation = read('.claude/skills/web-plan/references/planning-facilitation-contract.md')
  // 각 항목은 한국어·영어 대체 표기 중 **하나라도** 있으면 통과(영문화 이행 허용).
  for (const alternatives of [
    ['대상 화면/기능', 'Target screens/features'],
    ['자동 UX Check'],
    ['Annotation Review'],
    ['Current Planning Memo'],
  ]) {
    if (!alternatives.some(marker => facilitation.includes(marker))) {
      fail(`planning facilitation contract is missing ${alternatives.join(' | ')}`)
    }
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
