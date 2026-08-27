import {existsSync} from 'node:fs'
import {join} from 'node:path'

const contractPath = '.claude/skills/web-orchestrator/references/minimal-change-contract.md'

export const validateMinimalChange = ({repositoryRoot, read, pass, fail}) => {
  if (!existsSync(join(repositoryRoot, contractPath))) {
    fail(`${contractPath}: canonical minimal change contract is missing`)
    return
  }

  const contract = read(contractPath)
  for (const marker of [
    'smallest coherent change',
    'root cause',
    'CHANGE_MODE',
    'ALLOWED_PATHS',
    'PUBLIC_CONTRACTS_TO_PRESERVE',
    'NON_GOALS',
    'CHANGE_BUDGET',
    'unrelated changes',
    'Scope Expansion',
    'BLOCKED',
  ]) {
    if (!contract.includes(marker)) fail(`${contractPath}: required marker is missing: ${marker}`)
  }
  if (contract.split(/\r?\n/).length > 120) fail(`${contractPath}: contract exceeds 120 lines`)

  const requiredConsumers = [
    '.claude/skills/web-orchestrator/SKILL.md',
    '.claude/skills/dev-orchestrator/SKILL.md',
    '.claude/skills/feature-add/SKILL.md',
    '.claude/skills/component-gen/SKILL.md',
    '.claude/skills/api-connect/SKILL.md',
    '.claude/skills/auth-setup/SKILL.md',
    '.claude/skills/fsd-scaffold/SKILL.md',
    '.claude/skills/timeseries-dashboard/SKILL.md',
    '.claude/skills/version-bump/SKILL.md',
    '.claude/skills/lib-advisor/SKILL.md',
    '.claude/skills/project-init/SKILL.md',
    '.claude/skills/web-verify/SKILL.md',
    '.claude/agents/code-reviewer.md',
  ]
  for (const relativePath of requiredConsumers) {
    if (!read(relativePath).includes('minimal-change-contract.md')) {
      fail(`${relativePath}: canonical minimal change contract is not referenced`)
    }
  }

  const webOrchestrator = read('.claude/skills/web-orchestrator/SKILL.md')
  for (const marker of ['change-scope.md', 'TARGET_BEHAVIOR', 'PUBLIC_CONTRACTS_TO_PRESERVE', 'TEST_EVIDENCE']) {
    if (!webOrchestrator.includes(marker)) fail(`web-orchestrator does not pass minimal change field ${marker}`)
  }

  const retryPolicy = read('.claude/skills/web-orchestrator/references/retry-policy.md')
  for (const marker of ['minimal-change-contract.md', 'change-scope.md', 'scope expansion']) {
    if (!retryPolicy.includes(marker)) fail(`retry policy does not preserve minimal change marker ${marker}`)
  }

  const reviewer = read('.claude/agents/code-reviewer.md')
  for (const marker of ['run-git-inspection.mjs', '--operation diff-stat', '--operation diff-names', 'Change Scope Review', 'format-only noise', 'scope expansion']) {
    if (!reviewer.includes(marker)) fail(`code-reviewer does not enforce minimal change marker ${marker}`)
  }
  if (!reviewer.includes('disallowedTools: Write, Edit')) fail('code-reviewer minimal change review is not read-only')

  const scenarios = read('.claude/evals/scenarios.json')
  if (!scenarios.includes('"id": "minimal-existing-feature-change"')) {
    fail('minimal existing-code change eval scenario is missing')
  }

  pass('minimal coherent change contract, propagation, retry, and review gates checked')
}
