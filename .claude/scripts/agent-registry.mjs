const appPrefix = '(?:(?:[^/]+/)+)?'
const appPath = source => new RegExp(`^${appPrefix}${source}`)
const exactAppFile = source => appPath(`${source}$`)

export const VERIFIER_AGENTS = new Set([
  'agent-trace-verifier',
  'analytics-verifier',
  'ai-eval-runner',
  'ai-security-reviewer',
  'api-contract-verifier',
  'browser-verifier',
  'code-reviewer',
  'cost-latency-verifier',
  'data-access-verifier',
  'data-quality-verifier',
  'design-reviewer',
  'integration-verifier',
  'next-contract-verifier',
  'pack-verifier',
  'performance-verifier',
  'plan-reviewer',
  'security-reviewer',
  'seo-verifier',
  'state-invariant-verifier',
  'test-executor',
  'timeseries-verifier',
  'ux-validator',
  'version-analyzer',
  'visual-regression-verifier',
])

// 오케스트레이터 메인 스레드가 직접 작성하는 소수의 조율 산출물 선언.
// 메인 스레드는 ownership hook 대상이 아니므로 이 목록은 강제가 아니라 감사 가능한
// 명세다 — 여기 나열되지 않은 `_workspace` 설계 산출물은 소유 agent가 있어야 하며,
// 새 무소유 산출물을 늘리기 전에 owner agent 신설을 먼저 검토한다.
// (next-contract-matrices.md와 build-environment.json은 next-contract-designer /
//  ingestion-contract-designer 소유로 이관됐다.)
export const ORCHESTRATOR_AUTHORED_ARTIFACTS = [
  '_workspace/01_plan/project-profile.json', // resolve-profile.mjs stdout을 그대로 저장
  '_workspace/03_dev/web-execution-plan.json', // compile-execution-plan.mjs stdout을 그대로 저장
  '_workspace/02_design/integration-overlay.json', // 기존 프로젝트 통합 지점 스캔 결과
  '_workspace/03_dev/change-scope.md', // minimal-change-contract의 변경 범위 brief
  '_workspace/03_dev/spec-lock.json', // lock-spec.mjs stdout — 어떤 에이전트도 소유하지 않는다(구현 에이전트의 스팩 자기수정 차단)
  '_workspace/03_dev/build-manifest/', // 스폰 계획(fit 게이트 입력 = 재개 매니페스트)
  '_workspace/03_dev/build-manifest/.plan-locks.jsonl', // 계획 잠금 원장(append-only)
]

export const AGENT_OWNERSHIP = {
  'agent-runtime-scaffolder': [
    /^apps\/agent-api\//,
    /^workers\/agent-jobs\//,
    /^packages\/agent-runtime\//,
  ],
  'ai-eval-designer': [/^_workspace\/02_design\/eval-plan\.md$/],
  'ai-observability-builder': [/^packages\/observability\//],
  'ai-requirements-analyst': [
    // ai-requirements는 search-portal 파일럿 실측(24KB>20KB)으로 sharded 형태 허용 —
    // autonomy-risk-matrix는 실측 없어 flat 유지 (근거 없는 선제 확장 금지)
    /^_workspace\/01_plan\/ai-requirements(?:\.md|\/.+)$/,
    /^_workspace\/01_plan\/autonomy-risk-matrix\.md$/,
  ],
  'ai-solution-architect': [
    /^_workspace\/02_design\/ai-architecture\.md$/,
    /^_workspace\/02_design\/cost-latency-budget\.md$/,
  ],
  // ai-threat-model은 search-portal 파일럿 실측(22.5KB>20KB)으로 sharded 허용 — 결함 4·5호와 동일 클래스 3번째 재현
  'ai-threat-modeler': [/^_workspace\/02_design\/ai-threat-model(?:\.md|\/.+)$/],
  'analytics-agent-builder': [
    /^packages\/semantic-model\//,
    /^packages\/analytics-agent\//,
  ],
  'analytics-domain-architect': [/^_workspace\/02_design\/analytics-architecture\.md$/],
  'analytics-implementation-builder': [
    appPath('src/entities/analytics/'),
    appPath('src/features/(?:chart-builder|dashboard-editor)/'),
    appPath('src/widgets/(?:chart-panel|dashboard-grid)/'),
  ],
  'api-schema-designer': [/^_workspace\/02_design\/api-schema(?:\.md|\/.+)$/],
  'app-shell-builder': [
    exactAppFile('index\\.html'),
    exactAppFile('src/main\\.tsx'),
    appPath('src/app/(?:App\\.tsx|theme\\.ts|style\\.css|providers/RouterProvider\\.tsx|routes/(?:Routes\\.tsx|index\\.ts))$'),
    appPath('src/pages/home/'),
    exactAppFile('src/shared/utils/webVitals\\.ts'),
  ],
  'changelog-writer': [/^_workspace\/RELEASE\/changelog-draft\.md$/, /^CHANGELOG\.md$/, /^\.changeset\/[^/]+\.md$/],
  'changeset-setup': [/^\.changeset\/config\.json$/],
  'component-builder': [appPath('src/shared/ui/'), appPath('src/features/[^/]+/ui/'), appPath('src/widgets/')],
  'component-designer': [/^_workspace\/02_design\/component-spec(?:\.md|\/.+)$/],
  'client-domain-state-builder': [
    appPath('src/entities/[^/]+/model/(?:store|schema|selectors|invariants)\\.ts$'),
    appPath('src/entities/[^/]+/index\\.ts$'),
  ],
  'code-review-agent-builder': [
    /^packages\/code-review\//,
    /^workers\/code-review\//,
  ],
  'customer-support-agent-builder': [
    /^packages\/customer-support\//,
    appPath('src/features/ai-support/'),
  ],
  'data-ui-binder': [appPath('src/pages/'), appPath('src/widgets/'), appPath('src/features/[^/]+/ui/')],
  'data-governance-architect': [/^_workspace\/02_design\/data-governance\.md$/],
  'db-migration-writer': [
    appPath('migrations/'),
    appPath('scripts/migrate\\.(?:ts|mjs)$'),
    exactAppFile('docs/DB\\.md'),
    /^_workspace\/03_dev\/db-changelog\.md$/,
  ],
  'external-data-pipeline-builder': [
    /^packages\/ingestion\//,
    /^scripts\/ingestion\//,
    /^workers\/ingestion\//,
    appPath('src/shared/ingestion/'),
  ],
  'deploy-ci-writer': [
    /^\.github\/workflows\/deploy[^/]*\.ya?ml$/,
    /^\.github\/(?:renovate\.json|dependabot\.yml)$/,
    exactAppFile('Dockerfile'),
    exactAppFile('nginx\\.conf'),
    appPath('deploy/'),
  ],
  'design-preview-builder': [/^_workspace\/02_design\/preview\//],
  'design-system-architect': [/^_workspace\/02_design\/design-system(?:\.md|\/.+)$/],
  'entity-query-builder': [appPath('src/entities/')],
  'enterprise-search-builder': [
    /^workers\/ingestion\//,
    /^packages\/enterprise-search\//,
  ],
  'feature-mutation-builder': [appPath('src/features/(?!live-mode/)[^/]+/api/')],
  'feature-planner': [/^_workspace\/01_plan\/feature-plan(?:\.md|\/.+)$/],
  'form-state-builder': [appPath('src/features/(?!live-mode/)[^/]+/model/'), appPath('src/shared/modal/')],
  'human-approval-builder': [
    /^packages\/approval-policy\//,
    appPath('src/features/ai-approval/'),
  ],
  'i18n-builder': [
    /^_workspace\/02_design\/i18n-spec(?:\.md|\/.+)$/,
    appPath('src/shared/lang/'),
  ],
  'ingestion-ci-writer': [
    /^\.github\/workflows\/(?:crawl|refresh)(?:-[a-z0-9]+)*\.ya?ml$/,
  ],
  'ingestion-contract-designer': [
    /^_workspace\/02_design\/ingestion-contract\.md$/,
    /^_workspace\/02_design\/runtime-data-contract\.json$/,
    /^_workspace\/02_design\/build-environment\.json$/,
  ],
  'layout-designer': [/^_workspace\/02_design\/layout-spec(?:\.md|\/.+)$/],
  'lib-api-designer': [/^_workspace\/02_design\/api-design\.md$/],
  'lib-core-builder': [/^src\/(?:core|utils|types|__tests__)\//, /^src\/index\.ts$/],
  'lib-docs-generator': [/^(?:README|CHANGELOG|CONTRIBUTING)\.md$/, /^docs\//],
  'lib-scaffolder': [/^package\.json$/, /^(?:tsup|vitest)\.config\.ts$/, /^tsconfig(?:\.build)?\.json$/, /^src\/index\.ts$/],
  'lib-story-builder': [/^package\.json$/, /^\.storybook\//, /^src\/.+\.stories\.[jt]sx?$/],
  'mock-api-builder': [appPath('src/mocks/'), exactAppFile('src/main\\.tsx'), exactAppFile('public/mockServiceWorker\\.js')],
  'model-gateway-builder': [/^packages\/model-gateway\//],
  'next-app-scaffolder': [
    appPath('next\\.config\\.(?:js|mjs|ts)$'),
    exactAppFile('next-env\\.d\\.ts'),
    appPath('tsconfig(?:\\.[^.]+)?\\.json$'),
    appPath('eslint\\.config\\.(?:js|mjs|ts)$'),
    appPath('postcss\\.config\\.(?:js|mjs|cjs|ts)$'),
  ],
  'next-contract-designer': [
    /^_workspace\/02_design\/next-contract-matrices\.md$/,
    /^_workspace\/02_design\/build-environment\.json$/,
  ],
  'next-runtime-builder': [
    appPath('(?:src/)?app/'),
    appPath('(?:src/)?components/'),
    appPath('(?:src/)?lib/'),
  ],
  'package-publish-metadata': [/^package\.json$/, /^\.npmignore$/],
  'performance-budget-designer': [/^_workspace\/02_design\/performance-budget(?:\.md|\/.+)$/],
  'package-scaffolder': [/^(?:package\.json|pnpm-workspace\.yaml|turbo\.json|pnpm-lock\.yaml|\.nvmrc|CLAUDE\.md)$/, /^apps\/[^/]+\/(?:package\.json|\.nvmrc)$/],
  'planning-facilitator': [
    /^_workspace\/01_plan\/planning-context(?:\.md|\/.+)$/,
    /^_workspace\/01_plan\/decision-log(?:\.md|\/.+)$/,
  ],
  'planning-synthesizer': [/^_workspace\/01_plan\/project-brief\.md$/],
  'publish-ci-writer': [/^\.github\/workflows\/publish\.ya?ml$/],
  'release-manager': [/^_workspace\/RELEASE\//],
  'requirements-analyst': [/^_workspace\/01_plan\/requirements(?:\.md|\/.+)$/],
  'route-builder': [appPath('src/app/routes/'), appPath('src/pages/'), appPath('src/widgets/layout/')],
  'shared-foundation-builder': [
    appPath('src/shared/(?!realtime/)'),
    appPath('src/mocks/(?:handlers/index\\.ts|browser\\.ts|server\\.ts)$'),
    appPath('\\.env(?:\\.[^.]+)?$'),
    exactAppFile('\\.gitignore'),
    // vite-serverless-hybrid의 루트 api/(핸들러+_lib 가드)는 서버측 shared 런타임 기반이다 —
    // search-portal 파일럿 실측: hybrid greenfield에서 api/ 소유자가 레지스트리에 없었음(결함 13호).
    // appPath('api/')는 미앵커라 src/features/*/api/(feature-mutation-builder)·(?:src/)?app/api/
    // (next-runtime-builder)·src/features/live-mode/api/(realtime-data-builder)와 겹친다(적대 검토
    // HIGH) — 프리픽스 세그먼트에 src/·app/을 배제해 프로젝트 루트 api/만 매칭한다.
    /^(?:(?!(?:src|app)\/)[^/]+\/)*api\//,
  ],
  'seo-meta-builder': [
    /^_workspace\/02_design\/seo-spec(?:\.md|\/.+)$/,
    appPath('public/robots\\.txt$'),
    appPath('public/sitemap[^/]*\\.xml$'),
    appPath('src/shared/seo/'),
  ],
  'state-contract-designer': [/^_workspace\/02_design\/state-contract(?:\.md|\/.+)$/],
  'system-architect': [/^_workspace\/02_design\/solution-design(?:\.md|\/.+)$/],
  'source-artifact-ingestor': [/^_workspace\/(?:00_source|01_plan|02_design)\//],
  'tech-advisor': [/^_workspace\/01_plan\/tech-stack(?:\.md|\/.+)$/],
  'timeseries-architect': [/^_workspace\/02_design\/timeseries-architecture\.md$/],
  'tool-adapter-builder': [
    /^packages\/ai-contracts\//,
    /^packages\/tool-adapters\//,
  ],
  'tool-contract-designer': [/^_workspace\/02_design\/tool-contracts\.md$/],
  'test-scaffolder': [
    appPath('(?:vitest|playwright)\\.config\\.ts$'),
    appPath('\\.storybook/'),
    appPath('src/test/'),
    appPath('e2e/(?:fixtures|helpers)(?:/|\\.)'),
  ],
  'test-writer': [
    appPath('src/.+\\.(?:test|spec)\\.[jt]sx?$'),
    appPath('src/.+/__tests__/'),
    appPath('e2e/.+\\.spec\\.ts$'),
    // 프로젝트 루트 tests/(서버 핸들러 unit·가드·production-boundary 스위트)는 test-writer
    // 소유다 — search-portal 파일럿 실측: package 스크립트(test:api 등)와
    // vitest.production.config.ts include가 tests/를 참조하는데 소유자가 없었음(결함 15호).
    // 13호 fix와 동일하게 프리픽스 src/·app/ 배제로 루트 tests/만 매칭(중간 tests/ 세그먼트 배제).
    /^(?:(?!(?:src|app)\/)[^/]+\/)*tests\//,
  ],
  'tooling-scaffolder': [
    // vitest 변형 config(vitest.production.config.ts 등)는 tsconfig와 동일한 가변 그룹 관용구 —
    // search-portal 파일럿 실측(결함 12호: production-boundary config 소유 공백으로 Write 차단)
    appPath('(?:tsconfig(?:\\.[^.]+)?\\.json|vite\\.config\\.ts|vitest(?:\\.[^.]+)?\\.config\\.ts|playwright\\.config\\.ts)$'),
    exactAppFile('src/vite-env\\.d\\.ts'),
    /^(?:eslint\.config\.js|\.prettierrc)$/,
    appPath('eslint\\.config\\.js$'),
    /^\.husky\//,
    appPath('src/test/'),
  ],
  'ux-researcher': [/^_workspace\/01_plan\/ux-brief(?:\.md|\/.+)$/],
  'browser-agent-builder': [
    /^apps\/browser-runner\//,
    /^packages\/browser-agent\//,
  ],
  'realtime-data-builder': [
    appPath('src/shared/realtime/'),
    appPath('src/features/live-mode/(?:api|model)/'),
    exactAppFile('src/features/live-mode/index\\.ts'),
  ],
  'vercel-config-writer': [
    /^vercel\.json$/,
    /^apps\/[a-z0-9][a-z0-9_-]*\/vercel\.json$/,
  ],
  'version-file-updater': [/^(?:package\.json|CHANGELOG\.md)$/, /^\.changeset\/[^/]+\.md$/],
  'web-observability-builder': [
    /^_workspace\/02_design\/observability-spec(?:\.md|\/.+)$/,
    appPath('src/shared/observability/'),
  ],
  'visual-baseline-manager': [/^_workspace\/02_design\/visual-baseline-manifest\.json$/],
  'visual-contract-designer': [
    /^_workspace\/02_design\/visual-qa-contract\.md$/,
    /^_workspace\/02_design\/visual-qa-contract\.json$/,
  ],
  'visual-test-writer': [
    appPath('e2e/.+\\.visual\\.spec\\.ts$'),
    appPath('src/.+\\.visual\\.stories\\.tsx$'),
  ],
}

// ── 스팩 유래 소유권 (Stage 3b) ───────────────────────────────────────────────
// 배경: 위 AGENT_OWNERSHIP은 경계를 **FSD 경로 리터럴**로 표현한다. 소유권 경계 자체는
// 필요하지만(병렬 에이전트가 서로 덮어쓰지 않게) 그것이 왜 `src/entities/`여야 하는지는
// 근거가 없다. 기존 저장소가 `src/domain/`이나 `src/stores/`를 쓰면 훅이 전부 차단한다 —
// 실측(2026-08-26): 한 브라운필드 패키지의 레이어 10개 중 5개가 소유자 없음으로 막혔다.
// 그런데 브라운필드 계약(integration-overlay)은 "app root·alias·router를 기존 설정에서
// 감지하고 임의 기본값으로 덮어쓰지 않는다"고 요구한다 — 계약과 훅이 모순이었다.
//
// 해소: 경계는 **역할**로 표현하고 경로는 스팩(spec-lock의 layerMap)이 공급한다.
// 소유권 강도는 그대로다 — 이름만 프로젝트가 정한다.

// FSD 레이어 어휘의 참조 표현 (Stage 3d).
//
// **이것을 no-spec 폴백으로 쓰지 않는다.** 시도했다가 게이트가 회귀를 잡았다(실측 2026-08-26):
// `AGENT_OWNERSHIP`은 레이어 이름보다 많은 것을 인코딩한다 — `feature-mutation-builder`는
// `src/features/(?!live-mode/)[^/]+/api/`로 **live-mode를 제외**한다(그 영역은
// `realtime-data-builder` 소유). 평면 layerMap은 이런 carve-out을 표현할 수 없어서, 기본값으로
// 쓰는 순간 두 에이전트의 경계가 무너진다.
//
// 그래서 폴백은 여전히 `AGENT_OWNERSHIP`이다 — 그쪽이 **엄밀히 더 정밀하다**. layerMap은
// 그 정밀도가 의미 없는 곳(기존 저장소가 FSD를 안 쓰는 경우)에서만 이긴다.
// **한계**: "FSD 기본값 제거"는 layerMap이 carve-out을 표현할 수 있게 된 뒤에야 가능하다.
export const DEFAULT_LAYER_MAP = {
  domainModel: 'src/entities',
  featureLogic: 'src/features',
  composedUI: 'src/widgets',
  sharedKernel: 'src/shared',
  routes: 'src/pages',
}
const UNUSED_DEFAULT_LAYER_MAP_NOTE = DEFAULT_LAYER_MAP

// 역할 → 논리 레이어. 레이어 이름은 layerMap의 키와 맞춘다.
export const AGENT_LAYER_ROLES = {
  'entity-query-builder': ['domainModel'],
  'client-domain-state-builder': ['domainModel', 'clientState'],
  'feature-mutation-builder': ['featureLogic'],
  'form-state-builder': ['featureLogic'],
  'component-builder': ['sharedKernel', 'featureUI', 'composedUI'],
  'route-builder': ['routes'],
  'data-ui-binder': ['routes', 'composedUI', 'featureUI'],
  'app-shell-builder': ['entry', 'appShell'],
  'test-writer': ['unitTests'],
  'i18n-builder': ['i18n'],
  'seo-meta-builder': ['seo'],
}

// 경로를 정규화한다 — 선행 ./ 제거, 후행 / 보장(디렉토리 접두 매칭용).
const normalizeLayerPath = value => {
  const trimmed = String(value).trim().replace(/^\.\//, '')
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`
}

// 부재 표기(괄호 주석)와 빈 값은 경로가 아니다.
export const isLayerPathDeclared = value =>
  typeof value === 'string' && value.trim() !== '' && !/^\(.*\)$/.test(value.trim())

// 레이어는 서로 겹치면 안 된다. 소유권의 목적이 병렬 안전인데 겹치면 그 목적이 무너지고,
// 넓은 레이어 하나로 다른 에이전트의 영역을 삼키는 권한 확대가 가능해진다.
export const findLayerOverlaps = layerMap => {
  const entries = Object.entries(layerMap ?? {})
    .filter(([, value]) => isLayerPathDeclared(value))
    .map(([layer, value]) => [layer, normalizeLayerPath(value)])
  const overlaps = []
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const [aLayer, aPath] = entries[i]
      const [bLayer, bPath] = entries[j]
      if (aPath === bPath || aPath.startsWith(bPath) || bPath.startsWith(aPath)) {
        overlaps.push({layers: [aLayer, bLayer].sort(), paths: [aPath, bPath]})
      }
    }
  }
  return overlaps
}

// 스팩에서 이 에이전트의 쓰기 패턴을 만든다.
// fail-closed: 역할 매핑이 없거나, 매핑된 레이어가 layerMap에 선언되지 않았으면 **null**을
// 돌려 호출자가 기본 등록부로 돌아가게 한다. 절대 "선언 없음 → 전체 허용"이 되지 않는다.
export const resolveSpecOwnership = (specLock, agentType) => {
  const roles = AGENT_LAYER_ROLES[agentType]
  if (!roles) return null
  // 스팩이 layerMap을 주면 그것이 이긴다. 없으면 null → 호출자가 AGENT_OWNERSHIP으로 돌아간다.
  const layerMap = specLock?.layerMap
  if (!layerMap || typeof layerMap !== 'object' || Object.keys(layerMap).length === 0) return null
  if (findLayerOverlaps(layerMap).length > 0) return null   // 겹치면 신뢰하지 않는다
  const patterns = roles
    .filter(role => isLayerPathDeclared(layerMap[role]))
    .map(role => new RegExp(`^${appPrefix}${normalizeLayerPath(layerMap[role]).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
  return patterns.length > 0 ? patterns : null
}
