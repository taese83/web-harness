import {existsSync} from 'node:fs'
import {basename, join} from 'node:path'

const lineCount = source => source.split(/\r?\n/).length

export const validateModularity = ({repositoryRoot, agentFiles, skillFiles, activeMarkdown, read, pass, fail}) => {
  for (const relativePath of skillFiles) {
    if (lineCount(read(relativePath)) > 300) fail(`${relativePath}: SKILL.md exceeds the 300-line core workflow limit`)
  }
  for (const relativePath of agentFiles) {
    if (lineCount(read(relativePath)) > 300) fail(`${relativePath}: agent exceeds the 300-line single-role limit`)
  }
  for (const relativePath of activeMarkdown.filter(path => path.includes('/references/'))) {
    if (lineCount(read(relativePath)) > 300) fail(`${relativePath}: active reference exceeds 300 lines; split it or make it an asset`)
  }

  const movedCatalogs = [
    ['.claude/skills/project-init/references/templates.md', '.claude/skills/project-init/assets/templates.md'],
    ['.claude/skills/lib-advisor/references/setup-snippets.md', '.claude/skills/lib-advisor/assets/setup-snippets.md'],
    ['.claude/skills/lib-advisor/references/lib-catalog.md', '.claude/skills/lib-advisor/assets/lib-catalog.md'],
  ]
  for (const [stalePath, assetPath] of movedCatalogs) {
    if (existsSync(join(repositoryRoot, stalePath))) fail(`${stalePath}: large catalog must not remain an active reference`)
    if (!existsSync(join(repositoryRoot, assetPath))) fail(`${assetPath}: section-loaded asset catalog is missing`)
  }
  if (!existsSync(join(repositoryRoot, '.claude/scripts/read-skill-section.mjs'))) {
    fail('.claude/scripts/read-skill-section.mjs: deterministic section reader is missing')
  }

  const muiIndexPath = '.claude/skills/component-gen/references/mui-patterns.md'
  const muiIndex = read(muiIndexPath)
  const focusedMuiReferences = [
    '.claude/skills/component-gen/references/mui-styling.md',
    '.claude/skills/component-gen/references/input-focus-ime.md',
    '.claude/skills/component-gen/references/responsive-layout.md',
    '.claude/skills/component-gen/references/accessibility.md',
    '.claude/skills/component-gen/references/ts-conventions.md',
  ]
  for (const relativePath of focusedMuiReferences) {
    if (!existsSync(join(repositoryRoot, relativePath))) {
      fail(`${relativePath}: focused MUI reference is missing`)
      continue
    }
    if (!muiIndex.includes(basename(relativePath))) fail(`${muiIndexPath}: ${basename(relativePath)} is not indexed`)
    if (lineCount(read(relativePath)) > 100) fail(`${relativePath}: focused MUI reference exceeds 100 lines`)
  }

  const webSkill = read('.claude/skills/web-orchestrator/SKILL.md')
  const executionContract = read('.claude/skills/web-orchestrator/references/execution-contract.md')
  for (const referenceName of ['buildable-app-contract.md', 'qa-evidence-contract.md']) {
    if (!webSkill.includes(referenceName)) fail(`web-orchestrator does not progressively load ${referenceName}`)
  }
  if (lineCount(executionContract) > 100) fail('web-orchestrator execution core exceeds 100 lines')

  const aiEvalSkill = read('.claude/skills/ai-eval/SKILL.md')
  if (!/catalog 자체를 편집할 때만|only when editing the catalog itself/i.test(aiEvalSkill)) fail('ai-eval does not guard full scenario catalog loading')

  const qualityRunner = read('.claude/scripts/run-quality-gates.mjs')
  if (!qualityRunner.includes("from './evidence-lib.mjs'")) fail('quality runner bypasses the shared evidence module')
  for (const [relativePath, maximumLines] of [
    ['.claude/scripts/validate-harness.mjs', 400],
    ['.claude/scripts/release-gate-lib.mjs', 400],
  ]) {
    if (lineCount(read(relativePath)) > maximumLines) fail(`${relativePath}: script exceeds ${maximumLines} lines`)
  }

  pass('agent, skill, reference, asset, and script modularity boundaries checked')
}
