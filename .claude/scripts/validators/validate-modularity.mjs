import {existsSync, readFileSync} from 'node:fs'
import {basename, join} from 'node:path'

const lineCount = source => source.split(/\r?\n/).length

// 에이전트·SKILL.md·참조 문서의 크기는 줄이 아니라 바이트로 잰다 — 줄 상한은 같은 내용을 긴 줄로 밀어넣거나
// 문장을 깎게 만들 뿐 읽기 비용을 줄이지 않는다. 예산(20KB)을 넘는 파일은 baseline `promptBytes`의 크기가 상한이고,
// 더 키우려면 baseline을 의식적으로 갱신한다(JUDGMENT, I4). 참조 문서는 contract-hygiene `referenceBytes`가 같은 규칙으로 잰다.
export const PROMPT_BYTE_BUDGET = 20 * 1024
export const promptSizeFailures = (files, read, ceilings = {}) => files.flatMap(relativePath => {
  const bytes = Buffer.byteLength(read(relativePath).replace(/\r\n/g, '\n'), 'utf8')
  const ceiling = ceilings[relativePath]
  if (bytes <= PROMPT_BYTE_BUDGET || (ceiling !== undefined && bytes <= ceiling)) return []
  return [`${relativePath}: ${bytes.toLocaleString()}B > ${(ceiling ?? PROMPT_BYTE_BUDGET).toLocaleString()}B — 에이전트·스킬 본문이 예산을 넘었다. 덜어내거나 참조로 옮기고, 불가피하면 contract-hygiene-baseline promptBytes를 의식적으로 갱신하라(JUDGMENT, I4)`]
})

export const validateModularity = ({repositoryRoot, agentFiles, skillFiles, activeMarkdown, read, pass, fail}) => {
  const baseline = JSON.parse(readFileSync(join(repositoryRoot, '.claude/scripts/validators/contract-hygiene-baseline.json'), 'utf8'))
  for (const message of promptSizeFailures([...skillFiles, ...agentFiles], read, baseline.promptBytes)) fail(message)

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
    '.claude/skills/component-gen/references/tailwind-shadcn-styling.md',
    '.claude/skills/component-gen/references/input-focus-ime.md',
    '.claude/skills/component-gen/references/responsive-layout.md',
    '.claude/skills/component-gen/references/accessibility.md',
    '.claude/skills/component-gen/references/ts-conventions.md',
    '.claude/skills/component-gen/references/testing.md',
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


  const qualityRunner = read('.claude/scripts/run-quality-gates.mjs')
  if (!qualityRunner.includes("from './evidence-lib.mjs'")) fail('quality runner bypasses the shared evidence module')
  for (const [relativePath, maximumLines] of [
    ['.claude/scripts/validate-harness.mjs', 400],
    ['.claude/scripts/release-gate-lib.mjs', 400],
    // 추출로 상한을 지킨 모듈은 **추출 시점에 등록한다** — 안 하면 다음 추가에서 조용히 넘는다.
    ['.claude/scripts/design-evidence-lib.mjs', 400],
  ]) {
    if (lineCount(read(relativePath)) > maximumLines) fail(`${relativePath}: script exceeds ${maximumLines} lines`)
  }

  pass('agent, skill, reference, asset, and script modularity boundaries checked')
}
