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
  ],
  'seo-meta-builder': [
    /^_workspace\/02_design\/seo-spec(?:\.md|\/.+)$/,
    appPath('public/robots\\.txt$'),
    appPath('public/sitemap[^/]*\\.xml$'),
    appPath('src/shared/seo/'),
  ],
  'state-contract-designer': [/^_workspace\/02_design\/state-contract(?:\.md|\/.+)$/],
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
  ],
  'tooling-scaffolder': [
    appPath('(?:tsconfig(?:\\.[^.]+)?\\.json|vite\\.config\\.ts|vitest\\.config\\.ts|playwright\\.config\\.ts)$'),
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
