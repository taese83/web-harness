import {spawnSync} from 'node:child_process'
import {existsSync} from 'node:fs'
import {join, resolve} from 'node:path'
import {AGENT_OWNERSHIP, VERIFIER_AGENTS} from '../agent-registry.mjs'
import {evaluateGlobalBashPolicy} from '../global-bash-policy-lib.mjs'

export const validateAgentBoundaries = ({
  claudeDirectory,
  repositoryRoot,
  read,
  parseFrontmatter,
  writableAgents,
  pass,
  fail,
}) => {
  const readOnlyAgents = [...VERIFIER_AGENTS].sort()

  for (const agentName of readOnlyAgents) {
    const relativePath = `.claude/agents/${agentName}.md`
    if (!existsSync(join(repositoryRoot, relativePath))) {
      fail(`${relativePath}: required read-only verifier is missing`)
      continue
    }
    const frontmatter = parseFrontmatter(relativePath, read(relativePath))
    if (/\b(?:Write|Edit)\b/.test(frontmatter.tools ?? '')) fail(`${relativePath}: verifier tools include Write/Edit`)
    if (frontmatter.disallowedTools !== 'Write, Edit') fail(`${relativePath}: verifier must disallow Write, Edit`)
  }
  pass('read-only verifier tool boundaries checked')

  // verifier 문서가 자체 Bash 정책이 차단하는 명령을 지시하면 안 된다.
  // 실사례: ux-validator가 `grep -rn`을, code-reviewer가 디렉토리 재귀 rg를 문서화해
  // 해당 검사 항목이 조용히 실행 불가였다.
  //
  // 이 검사는 **정책 엔진을 직접 호출한다.** 이전 구현은 차단 명령 목록을 하드코딩했는데,
  // 정책이 완화·강화될 때마다 검증기가 드리프트해 정당한 문서를 FAIL시키거나 그 반대가 됐다
  // (실제로 grep 허용 라운드에서 이 검증기가 정당한 grep 문서를 차단했다).
  // 정책이 단일 정본이고 검증기는 그것을 평가만 한다.
  // 검사 대상은 **콘텐츠 검색 명령**으로 한정한다. 문서에 등장하는 다른 명령
  // (`pnpm audit --prod`, `pnpm test:e2e`)은 control plane이 실행하는 명령의 *서술*이거나
  // 금지 예시(`pnpm audit --fix`를 실행하지 않는다)이지 이 에이전트의 실행 지시가 아니다.
  // 조용히 죽어 사고가 났던 클래스가 검색 명령이므로 거기에 집중한다.
  const SEARCH_COMMAND_HEAD = /^(?:grep|rg|find|sed|awk|xargs)\s+\S/
  // 문서 예시의 경로는 **대상 프로젝트 기준**이라 control plane에 실존하지 않는다.
  // 경로 존재가 아니라 플래그·보호 가드가 검사 대상이므로, 패턴 뒤 positional을 실존
  // 디렉터리로 정규화한 뒤 평가한다. placeholder도 같은 이유로 치환한다.
  const normalizeForPolicy = command => {
    const withoutPlaceholders = command.replace(/\{[^}]+\}/g, 'TODO')
    let positionalIndex = 0
    return withoutPlaceholders
      .split(' ')
      .map(token => {
        if (token.startsWith('-') || token === '') return token
        if (/^['"]/.test(token)) return token // 인용된 검색 패턴
        positionalIndex += 1
        return positionalIndex === 1 ? token : '.claude'
      })
      .join(' ')
  }
  for (const agentName of readOnlyAgents) {
    const relativePath = `.claude/agents/${agentName}.md`
    if (!existsSync(join(repositoryRoot, relativePath))) continue
    const source = read(relativePath)
    const commandSpans = [
      ...[...source.matchAll(/`([^`\n]+)`/g)].map(match => match[1]),
      ...[...source.matchAll(/^```(?:bash|sh)\r?\n([\s\S]*?)^```/gm)].flatMap(match => match[1].split(/\r?\n/)),
    ]
    for (const span of commandSpans) {
      const command = span.trim()
      if (!SEARCH_COMMAND_HEAD.test(command)) continue
      const decision = evaluateGlobalBashPolicy({
        tool_name: 'Bash',
        agent_type: agentName,
        cwd: repositoryRoot,
        tool_input: {command: normalizeForPolicy(command)},
      }, {environment: {CLAUDE_PROJECT_DIR: repositoryRoot}, processCwd: repositoryRoot})
      if (!decision.allowed) {
        fail(`${relativePath}: documents a command the global Bash policy blocks [${decision.code}]: ${command}`)
      }
    }
  }
  pass('verifier-documented commands evaluated against the live Bash policy')

  const verifierBashHookPath = join(claudeDirectory, 'scripts', 'enforce-verifier-bash.mjs')
  const verifierBashHook = read('.claude/scripts/enforce-verifier-bash.mjs')
  if (!verifierBashHook.includes("from './agent-registry.mjs'")) fail('verifier Bash hook must use the shared agent registry')
  const runVerifierBashHook = (agentType, command) =>
    spawnSync(process.execPath, [verifierBashHookPath], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      input: JSON.stringify({agent_type: agentType, tool_input: {command}, tool_name: 'Bash'}),
    })
  if (runVerifierBashHook('test-executor', 'pnpm test').status !== 2) {
    fail('verifier Bash hook allowed a direct package-manager command')
  }
  if (
    runVerifierBashHook(
      'test-executor',
      'node .claude/scripts/run-quality-gates.mjs --all --allow-host-execution',
    ).status !== 0
  ) fail('verifier Bash hook blocked the typed quality runner')
  if (
    runVerifierBashHook('code-reviewer', 'node .claude/scripts/run-git-inspection.mjs --project . --operation status').status !== 0
  ) fail('verifier Bash hook blocked the typed Git inspection runner')
  if (runVerifierBashHook('code-reviewer', "node -e 'process.exit(0)'").status !== 2) {
    fail('verifier Bash hook allowed arbitrary Node execution')
  }
  if (runVerifierBashHook('test-executor', 'pnpm test --update').status !== 2) fail('verifier Bash hook allowed snapshot update')
  if (
    runVerifierBashHook('test-executor', 'node .claude/scripts/run-package-operation.mjs --project . --operation install').status !== 2
  ) fail('verifier Bash hook allowed a mutating package operation')
  if (runVerifierBashHook('security-reviewer', 'rm -rf src').status !== 2) fail('verifier Bash hook allowed a mutating command')
  pass('verifier Bash allow/deny behavior checked')

  const ownershipHook = read('.claude/scripts/enforce-agent-ownership.mjs')
  if (!ownershipHook.includes("from './agent-registry.mjs'")) fail('ownership hook must use the shared agent registry')
  for (const agentName of writableAgents) {
    if (!AGENT_OWNERSHIP[agentName]) fail(`${agentName}: write ownership rule is missing`)
  }
  for (const agentName of Object.keys(AGENT_OWNERSHIP)) {
    if (!writableAgents.includes(agentName)) fail(`${agentName}: stale ownership rule has no writable agent`)
  }
  pass('writable agent ownership rules checked')

  const ownershipHookPath = join(claudeDirectory, 'scripts', 'enforce-agent-ownership.mjs')
  const runOwnershipHook = (agentType, filePath) =>
    spawnSync(process.execPath, [ownershipHookPath], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: {...process.env, CLAUDE_PROJECT_DIR: repositoryRoot},
      input: JSON.stringify({
        agent_type: agentType,
        cwd: repositoryRoot,
        tool_input: {file_path: filePath},
        tool_name: 'Write',
      }),
    })

  const cases = [
    ['environment scaffolder root nvmrc', 'environment-scaffolder', join(repositoryRoot, '.nvmrc'), 0],
    ['environment scaffolder app nvmrc', 'environment-scaffolder', join(repositoryRoot, 'apps/web/.nvmrc'), 0],
    ['environment scaffolder root claude-md marker', 'environment-scaffolder', join(repositoryRoot, 'CLAUDE.md'), 0],
    ['environment scaffolder vite-env stub', 'environment-scaffolder', join(repositoryRoot, 'src/vite-env.d.ts'), 0],
    ['environment scaffolder app eslint config', 'environment-scaffolder', join(repositoryRoot, 'apps/web/eslint.config.js'), 0],
    ['timeseries architecture output', 'timeseries-architect', join(repositoryRoot, '_workspace/02_design/timeseries-architecture.md'), 0],
    // 결함 13호 fix의 부정 회귀(적대 검토 HIGH) — 루트 api/만 소유하고 타 agent 소유 api/ 경로는 배제
    // 결함 15호 — 루트 tests/(서버 unit·가드·production-boundary)는 test-writer 소유, src 내부 tests/ 세그먼트는 배제
    ['environment vitest variant config owned', 'environment-scaffolder', join(repositoryRoot, 'vitest.production.config.ts'), 0],
    ['tooling arbitrary ts file not owned', 'environment-scaffolder', join(repositoryRoot, 'src/app/App.tsx'), 2],
    // Phase 1 sharded ownership — sharding 계약의 분할 축 대상 5 owner (search-portal 파일럿 실측 결함 4호 회귀 케이스)
    ['planning context flat output', 'planning-facilitator', join(repositoryRoot, '_workspace/01_plan/planning-context.md'), 0],
    ['planning context sharded index', 'planning-facilitator', join(repositoryRoot, '_workspace/01_plan/planning-context/INDEX.md'), 0],
    ['planning context sharded section', 'planning-facilitator', join(repositoryRoot, '_workspace/01_plan/planning-context/product-frame.md'), 0],
    ['decision log sharded range section', 'planning-facilitator', join(repositoryRoot, '_workspace/01_plan/decision-log/PC-001~050.md'), 0],
    ['planning context adjacent name not owned', 'planning-facilitator', join(repositoryRoot, '_workspace/01_plan/planning-context-v2.md'), 2],
    ['requirements sharded section', 'requirements-analyst', join(repositoryRoot, '_workspace/01_plan/requirements/unified-results.md'), 0],
    ['requirements adjacent name not owned', 'requirements-analyst', join(repositoryRoot, '_workspace/01_plan/requirements-legacy.md'), 2],
    ['ux brief sharded section', 'ux-researcher', join(repositoryRoot, '_workspace/01_plan/ux-brief/flows.md'), 0],
    ['ux brief adjacent name not owned', 'ux-researcher', join(repositoryRoot, '_workspace/01_plan/ux-brief-notes.md'), 2],
    ['feature plan sharded section', 'feature-planner', join(repositoryRoot, '_workspace/01_plan/feature-plan/feature-table.md'), 0],
    ['feature plan adjacent name not owned', 'feature-planner', join(repositoryRoot, '_workspace/01_plan/feature-plan-draft.md'), 2],
    ['tech stack sharded section', 'tech-advisor', join(repositoryRoot, '_workspace/01_plan/tech-stack/versions.md'), 0],
    ['tech stack adjacent name not owned', 'tech-advisor', join(repositoryRoot, '_workspace/01_plan/tech-stack-legacy.md'), 2],
    ['project brief stays flat-only by contract', 'planning-synthesizer', join(repositoryRoot, '_workspace/01_plan/project-brief/INDEX.md'), 2],
    ['state contract output', 'state-contract-designer', join(repositoryRoot, '_workspace/02_design/state-contract.md'), 0],
    ['api schema single-file output', 'api-schema-designer', join(repositoryRoot, '_workspace/02_design/api-schema.md'), 0],
    ['api schema sharded index', 'api-schema-designer', join(repositoryRoot, '_workspace/02_design/api-schema/INDEX.md'), 0],
    ['api schema sharded section', 'api-schema-designer', join(repositoryRoot, '_workspace/02_design/api-schema/orders.md'), 0],
    ['api schema sharded code file', 'api-schema-designer', join(repositoryRoot, '_workspace/02_design/api-schema/orders.code.ts'), 0],
    ['api schema adjacent name not owned', 'api-schema-designer', join(repositoryRoot, '_workspace/02_design/api-schema-v2.md'), 2],
    ['api schema cannot write peer artifact', 'api-schema-designer', join(repositoryRoot, '_workspace/02_design/component-spec.md'), 2],
    ['design system sharded section', 'design-system-architect', join(repositoryRoot, '_workspace/02_design/design-system/tokens.md'), 0],
    ['component spec sharded section', 'component-designer', join(repositoryRoot, '_workspace/02_design/component-spec/features.md'), 0],
    ['layout spec sharded section', 'layout-designer', join(repositoryRoot, '_workspace/02_design/layout-spec/dashboard.md'), 0],
    ['state contract sharded section', 'state-contract-designer', join(repositoryRoot, '_workspace/02_design/state-contract/motor.md'), 0],
    ['runtime data contract output', 'ingestion-contract-designer', join(repositoryRoot, '_workspace/02_design/runtime-data-contract.json'), 0],
    ['visual contract output', 'visual-contract-designer', join(repositoryRoot, '_workspace/02_design/visual-qa-contract.json'), 0],
    ['visual contract designer source', 'visual-contract-designer', join(repositoryRoot, 'src/app/App.tsx'), 2],
    ['visual baseline manifest', 'visual-baseline-manager', join(repositoryRoot, '_workspace/02_design/visual-baseline-manifest.json'), 0],
    ['visual baseline manager PNG', 'visual-baseline-manager', join(repositoryRoot, 'e2e/home.visual.spec.ts-snapshots/home.png'), 2],
    ['next contract matrices output', 'next-contract-designer', join(repositoryRoot, '_workspace/02_design/next-contract-matrices.md'), 0],
    ['next build environment manifest', 'next-contract-designer', join(repositoryRoot, '_workspace/02_design/build-environment.json'), 0],
    ['next contract designer runtime source', 'next-contract-designer', join(repositoryRoot, 'src/app/dashboard/page.tsx'), 2],
    ['ingestion build environment manifest', 'ingestion-contract-designer', join(repositoryRoot, '_workspace/02_design/build-environment.json'), 0],
    ['performance budget output', 'performance-budget-designer', join(repositoryRoot, '_workspace/02_design/performance-budget.md'), 0],
    ['performance budget designer vite config', 'performance-budget-designer', join(repositoryRoot, 'vite.config.ts'), 2],
    ['design preview page', 'design-preview-builder', join(repositoryRoot, '_workspace/02_design/preview/dashboard.html'), 0],
    ['design preview tokens', 'design-preview-builder', join(repositoryRoot, '_workspace/02_design/preview/tokens.css'), 0],
    ['design preview builder spec file', 'design-preview-builder', join(repositoryRoot, '_workspace/02_design/design-system.md'), 2],
    ['design preview builder app source', 'design-preview-builder', join(repositoryRoot, 'src/app/App.tsx'), 2],
  ]

  for (const [label, agentType, filePath, expectedStatus] of cases) {
    if (runOwnershipHook(agentType, filePath).status !== expectedStatus) {
      fail(`ownership hook ${expectedStatus === 0 ? 'blocked' : 'allowed'} ${label}`)
    }
  }
  pass('ownership hook allow/deny behavior checked')
}
