import {isSecretPath} from './sensitive-access-policy-lib.mjs'
const appPrefix = '(?:(?:[^/]+/)+)?'
const appPath = source => new RegExp(`^${appPrefix}${source}`)
const exactAppFile = source => appPath(`${source}$`)

export const VERIFIER_AGENTS = new Set([
  'api-contract-verifier',
  'browser-verifier',
  'code-reviewer',
  'data-access-verifier',
  'design-reviewer',
  'integration-verifier',
  'next-contract-verifier',
  'pack-verifier',
  'performance-verifier',
  'plan-reviewer',
  'security-reviewer',
  'seo-verifier',
  'ux-validator',
  'version-analyzer',
  'visual-regression-verifier',
])

// 쓰는 에이전트 중 셸을 받는 쪽 — Bash는 verifier와 같은 훅(enforce-verifier-bash)이 파일을 바꾸지 않는 typed 명령으로만 좁힌다
// (읽기·품질 실행기 --check·읽기 전용 검사 스크립트·패키지 브로커 install·lockfile·`pnpm install --ignore-scripts`). 검사·설치를 스스로 못 돌리면
// 메인 왕복과 의존성 추론으로 턴을 다 쓴다.
export const RESTRICTED_BASH_WRITERS = new Set(['developer'])
export const PACKAGE_OPERATIONS_FOR_WRITERS = new Set(['install', 'lockfile'])

// 오케스트레이터 메인 스레드가 직접 작성하는 소수의 조율 산출물 선언.
// 메인 스레드는 ownership hook 대상이 아니므로 이 목록은 강제가 아니라 감사 가능한
// 명세다 — 여기 나열되지 않은 `_workspace` 설계 산출물은 소유 agent가 있어야 하며,
// 새 무소유 산출물을 늘리기 전에 owner agent 신설을 먼저 검토한다.
// (next-contract-matrices.md와 build-environment.json은 next-contract-designer 소유다.)
export const ORCHESTRATOR_AUTHORED_ARTIFACTS = [
  '_workspace/01_plan/project-profile.json', // resolve-profile.mjs stdout을 그대로 저장
  '_workspace/03_dev/web-execution-plan.json', // compile-execution-plan.mjs stdout을 그대로 저장
  '_workspace/02_design/integration-overlay.json', // 기존 프로젝트 통합 지점 스캔 결과
  '_workspace/03_dev/change-scope.md', // minimal-change-contract의 변경 범위 brief
  '_workspace/03_dev/spec.json', // spec.mjs stdout — 어떤 에이전트도 소유하지 않는다(구현 에이전트의 스팩 자기수정 차단)
  '_workspace/03_dev/build-manifest/', // 스폰 계획(fit 게이트 입력 = 재개 매니페스트)
  '_workspace/03_dev/build-manifest/.plan-locks.jsonl', // 계획 잠금 원장(append-only)
  '_workspace/03_dev/work-analysis-revisions/', // `claim`가 검토한 분석 판본(내용 digest 이름)
  '_workspace/03_dev/work-plan-revisions/', // `claim`가 검토한 계획 판본(내용 digest 이름)
  '_workspace/03_dev/work-plan-review.md', // 검토표(생성물 — 되읽지 않는다)
  '_workspace/03_dev/work-plan-reviewed.json', // 직전 검토 판본 포인터(작업 삭제 대조의 기준)
  '_workspace/03_dev/change-journal/', // 실패·미완 스폰의 복구 기록 — 오케스트레이터만 쓴다(죽은 스폰은 쓸 수 없다)
  '_workspace/03_dev/notes/', // 예전 개발 노트(더 쓰지 않는다) — 남은 파일을 스폰이 고치지 못하게 둔다
]

// 합치거나 없앤 에이전트 → 그 일을 이어받은 에이전트. 퇴역 이름이 계약·평가에 남으면 validate-harness가 막는다 —
// 역방향 도달성은 살아 있는 이름의 접미사로 추론하므로, 같은 접미사의 마지막 에이전트가 사라지면 그 이름을 놓친다.
export const RETIRED_AGENTS = {
  'planning-facilitator': 'product-planner',
  'requirements-analyst': 'product-planner',
  'ux-researcher': 'product-planner',
  'planning-synthesizer': 'plan-reviewer',
  // 테스트 판정은 스크립트(report-test-qa)가 한다. 계약의 시나리오를 테스트로 옮기는 소비자는 developer다.
  'test-executor': 'developer',
}

export const AGENT_OWNERSHIP = {
  // 요구사항·UX brief·결정 기록을 한 에이전트가 쓴다 — 제품 맥락(Product Frame)은 requirements.md의 절이다.
  'product-planner': [
    /^_workspace\/01_plan\/requirements(?:\.md|\/.+)$/,
    /^_workspace\/01_plan\/ux-brief(?:\.md|\/.+)$/,
    /^_workspace\/01_plan\/decision-log(?:\.md|\/.+)$/,
  ],

  // package-scaffolder·tooling-scaffolder·test-scaffolder를 합쳤다(2026-08-26). 셋이
  // vitest.config·playwright.config·src/test/를 겹쳐 소유해 경계가 성립하지 않았다.
  // developer와 분리해 남기는 이유: package.json의 scripts가 무엇이 검사로 도는지를 정한다 —
  // 검사를 정의하는 것과 검사를 통과해야 하는 것은 분리한다.
  'environment-scaffolder': [
    // 아래는 2026-08-26에 제거된 15종에서 흡수한 설정·배포·문서 경로다.
    // `packages/*`·`apps/*`·`workers/*` 같은 **패키지 이름 처방**은 흡수하지 않고 버렸다 —
    // 그것은 소스이며 developer가 layerMap으로 덮는다.
    /^(?:(?:[^/]+\/)+)?Dockerfile$/, /^(?:(?:[^/]+\/)+)?nginx\.conf$/, /^(?:(?:[^/]+\/)+)?deploy\//,
    /^(?:(?:[^/]+\/)+)?migrations\//, /^(?:(?:[^/]+\/)+)?scripts\/migrate\.(?:ts|mjs)$/,
    /^(?:(?:[^/]+\/)+)?next\.config\.(?:js|mjs|ts)$/, /^(?:(?:[^/]+\/)+)?next-env\.d\.ts$/,
    /^(?:(?:[^/]+\/)+)?postcss\.config\.(?:js|mjs|cjs|ts)$/,
    /^(?:(?:[^/]+\/)+)?eslint\.config\.(?:js|mjs|ts)$/,
    /^(?:README|CHANGELOG|CONTRIBUTING)\.md$/, /^\.npmignore$/, /^docs\//,
    /^\.changeset\//, /^\.github\/(?:renovate\.json|dependabot\.yml)$/,
    /^\.github\/workflows\/(?:deploy[^/]*|publish|crawl(?:-[a-z0-9]+)*|refresh(?:-[a-z0-9]+)*)\.ya?ml$/,
    /^vercel\.json$/, /^apps\/[a-z0-9][a-z0-9_-]*\/vercel\.json$/,
    /^_workspace\/03_dev\/db-changelog\.md$/,
    /^(?:package\.json|pnpm-workspace\.yaml|turbo\.json|pnpm-lock\.yaml|\.nvmrc)$/,
    /^apps\/[^/]+\/(?:package\.json|\.nvmrc)$/,
    /^(?:(?:[^/]+\/)+)?(?:tsconfig(?:\.[^.]+)?\.json|vite\.config\.ts|vitest(?:\.[^.]+)?\.config\.ts|playwright\.config\.ts)$/,
    /^(?:(?:[^/]+\/)+)?src\/vite-env\.d\.ts$/,
    /^(?:eslint\.config\.js|\.prettierrc)$/,
    // 소유 커버리지 게이트가 찾은 공백 3건(2026-09-08). 전부 **부트스트랩 표면**이며
    // 어떤 정규식도 매칭하지 않아 무소유였다 — `index.html`은 Vite 엔트리포인트라
    // 계약 표면인데도 아무도 소유하지 않았다(파일럿 결함 13·15호와 같은 클래스).
    // 겹침 증명: 세 경로 모두 추가 전 매칭 소유자 0이었고(전수 대조), layerMap이
    // 덮는 것은 디렉토리(src·api·dev·tests·e2e)라 루트 파일과 교차하지 않는다.
    /^(?:(?:[^/]+\/)+)?index\.html$/, /^\.gitignore$/, /^(?:(?:[^/]+\/)+)?\.env\.example$/,
    /^(?:(?:[^/]+\/)+)?eslint\.config\.js$/,
    /^\.husky\//,
    /^(?:(?:[^/]+\/)+)?src\/test\//,
    /^(?:(?:[^/]+\/)+)?\.storybook\//,
    /^(?:(?:[^/]+\/)+)?e2e\/(?:fixtures|helpers)(?:\/|\.)/,
  ],

  // developer는 **빈 소유권**이다. 스팩(layerMap)이 있으면 그것이 소유를 공급하고, 없으면
  // 아무것도 쓸 수 없다. FSD 기본 경로를 폴백으로 주면 그 순간 다시 경로 처방이 된다 —
  // 구조 지시 빌더 6종을 걷어낸 이유가 바로 그것이었다(2026-08-26).
  developer: [],

  'api-schema-designer': [/^_workspace\/02_design\/api-schema(?:\.md|\/.+)$/],
  'component-designer': [/^_workspace\/02_design\/component-spec(?:\.md|\/.+)$/],
  'design-preview-builder': [/^_workspace\/02_design\/preview\//],
  'design-system-architect': [/^_workspace\/02_design\/design-system(?:\.md|\/.+)$/],
  'feature-planner': [/^_workspace\/01_plan\/feature-plan(?:\.md|\/.+)$/],
  'layout-designer': [/^_workspace\/02_design\/layout-spec(?:\.md|\/.+)$/, /^_workspace\/02_design\/seo-spec\.md$/],
  'lib-api-designer': [/^_workspace\/02_design\/api-design\.md$/],
  'next-contract-designer': [
    /^_workspace\/02_design\/next-contract-matrices\.md$/,
    /^_workspace\/02_design\/build-environment\.json$/,
  ],
  'performance-budget-designer': [/^_workspace\/02_design\/performance-budget(?:\.md|\/.+)$/],
  'release-manager': [/^_workspace\/RELEASE\//],
  // WORK 분해의 선행 분석과 계획도 이 에이전트 **하나**가 쓴다(2026-09-11) — 구현 설계 결정·모듈 경계를
  // 이미 맡고 사용자 설계 원문을 우선 입력으로 읽는다. FEAT(feature-planner)와 WORK의 작성 책임을 가른다.
  'system-architect': [/^_workspace\/02_design\/solution-design(?:\.md|\/.+)$/,
    /^_workspace\/03_dev\/work-analysis\.json$/, /^_workspace\/03_dev\/work-plan\.json$/,
    /^_workspace\/03_dev\/ticket-assessments\/[A-Za-z0-9_-]+\.json$/,
    // 기획 없이 기능만 구현하는 개발 티켓 초안 — CLI(`create`)가 검사해 트래커에 만든다.
    /^_workspace\/03_dev\/ticket-drafts\/[A-Za-z0-9_-]+\.md$/,
    // 초안 판정 — `create`가 만든 티켓에 판정서로 미리 둔다(pickup이 만든 시점의 지문을 대조해 쓴다).
    /^_workspace\/03_dev\/ticket-drafts\/[A-Za-z0-9_-]+\.assessments\.json$/],
  // 외부 원문(웹·Figma)을 읽는 에이전트라 쓰기를 **정규화 산출물로만** 좁힌다 — 승인·리뷰 기록(plan-review·design-review·
  // 시각 기준선·preview)과 다른 설계자의 산출물은 원문 속 지시로 오염되면 안 된다. 목록은 에이전트 문서 「출력 파일」과 같다.
  'source-artifact-ingestor': [/^_workspace\/00_source\//,
    /^_workspace\/01_plan\/(?:decision-log|requirements|ux-brief|tech-stack|feature-plan)(?:\.md|\/.+)$/,
    /^_workspace\/02_design\/(?:design-system|layout-spec|component-spec|api-schema)(?:\.md|\/.+)$/],
  'tech-advisor': [/^_workspace\/01_plan\/tech-stack(?:\.md|\/.+)$/],
  'visual-baseline-manager': [/^_workspace\/02_design\/visual-baseline-manifest\.json$/],
  'visual-contract-designer': [
    /^_workspace\/02_design\/visual-qa-contract\.json$/,
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
// 2026-08-26: 역할→레이어 매핑이 비었다. 이 표는 빌더마다 layerMap의 한 조각을 떼어 주기
// 위해 있었는데, 구현 에이전트가 `developer` 하나로 합쳐지면서 조각낼 대상이 없어졌다 —
// `resolveDeveloperOwnership`이 layerMap 전체를 주고 스폰 범위가 그 위에서 좁힌다.
// 빈 표를 남기는 이유: `resolveSpecOwnership`은 역할 매핑이 없는 에이전트에 null을 돌려주고
// 호출자가 등록부로 폴백한다 — 그 경로(fail-closed)를 지우지 않는다.
export const AGENT_LAYER_ROLES = {}

// 경로를 정규화한다 — 선행 ./ 제거, 디렉토리면 후행 /(접두 매칭), 파일이면 그대로(완전 일치 — layerMap 항목은 파일일 수 있다).
// 파일은 점 앞에 이름이 있는 확장자뿐이다(`ChatKit.ts`·`.eslintrc.json`). 점으로 시작하는 이름(`.changeset`·`.github`)은 디렉토리 —
// 확장자로 읽으면 그 아래 쓰기가 전부 막힌다. 끝의 `/`는 디렉토리 명시다. 프록시이며 오판은 protected-core §4에 적는다.
export const normalizeLayerPath = value => {
  const raw = String(value).trim().replace(/^\.\//, '')
  const trimmed = raw.replace(/\/+$/, '')
  const last = trimmed.split('/').at(-1) ?? ''
  return !raw.endsWith('/') && /.\.[^.]+$/.test(last) ? trimmed : `${trimmed}/`
}

// 경로 → 정규식. 디렉토리는 **접두 일치**(하위 전부), 파일은 **완전 일치**다.
// 파일에 끝 앵커를 안 붙이면 `src/ChatKit.ts`가 `src/ChatKit.tsx`까지 잡는다(2026-08-26 실측).
// 스폰 계획 게이트가 **같은 판정**을 쓰도록 내보낸다. 두 곳이 각자 경로 판정을 구현하면
// "계획은 통과했는데 훅이 막는다"가 나고, 그것이 바로 이 결속이 고치려는 문제다
// (적대 리뷰 2026-08-30: appPrefix·파일/디렉터리 판별·`./` 접두 셋 다 어긋나 있었다).
export const layerPattern = (path, {anchored = false} = {}) => {
  // 글롭 꼬리(`/**`·`/*`)는 **디렉토리 접두**와 같은 뜻이다. normalize보다 **먼저** 걷어낸다 —
  // 뒤에 하면 `src/x/**`가 `src/x/**/`가 되어 잡히지 않는다. 이스케이프만 하면 정규식에
  // 이스케이프만 하면 정규식에 리터럴 `\*\*`가 박혀 아무것도 매칭하지 않는다 —
  // ALLOWED_PATHS를 `src/x/**`로 적은 스폰이 조용히 전부 거부됐다(2026-08-30 실측).
  const normalized = normalizeLayerPath(String(path).replace(/\/\*{1,2}$/, '/'))
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // 점으로 시작하고 확장자 없는 이름(`.changeset`)은 디렉터리로 읽되 같은 이름의 파일(`.nvmrc`)도 맞는다 — 끝의 `/`로 명시했으면 디렉터리만.
  const dotName = normalized.endsWith('/') && !/\/$/.test(String(path).trim().replace(/\/\*{1,2}$/, '/')) && /(?:^|\/)\.[^./]+\/$/.test(normalized)
  const prefix = anchored ? '' : appPrefix
  if (dotName) return new RegExp(`^${prefix}${escaped.slice(0, -1)}(?:/|$)`)
  return new RegExp(`^${prefix}${escaped}${normalized.endsWith('/') ? '' : '$'}`)
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
// 단일 개발 에이전트(2026-08-26). 종전에는 구조 지시 빌더 6종이 각자 FSD 경로를 소유했다.
// 실측으로 그 소유권이 이미 성립하지 않고 있었다 — `src/pages/**`를 셋이 겹쳐 갖고, 비-FSD
// 어휘(`src/stores`·`src/hooks`·`src/components`)는 소유자가 아예 없었다. 즉 그 6종이 공급한
// 것은 격리가 아니라 **FSD 경로 처방**이었다.
//
// 대신 개발 에이전트 하나가 **스팩이 선언한 레이어 전부**를 소유하고, 병렬 격리는 에이전트
// 정체성이 아니라 스폰별 범위(change-scope의 ALLOWED_PATHS = moduleBoundaries)가 공급한다.
// 그것이 스팩이 moduleBoundaries를 담는 이유다.
// 어떤 에이전트도 쓰지 않는 경로 — 소유권 패턴이 앞 세그먼트를 허용하므로(appPrefix) 레이어 `src/`가
// `node_modules/…/src/`에도 맞는다. 의존성 트리·VCS 내부·하네스 자신·에이전트/IDE/MCP 설정(스스로 권한을 바꾸는
// 채널)은 스팩·등록부보다 앞서 막는다.
// 대소문자를 무시한다 — macOS·Windows 기본 파일시스템에서 `Node_Modules/`·`.VSCode/`는 같은 디렉터리다.
// 깊이도 무시한다 — 패키지 하나가 프로젝트 루트일 수 있다(`apps/web/.claude/`).
const PROTECTED_SEGMENTS = new Set(['node_modules', '.git', '.claude', '.vscode', '.idea', '.cursor'])
export const isProtectedWritePath = path => {
  const segments = String(path).replace(/^\.\//, '').toLowerCase().split('/').filter(Boolean)
  return segments.some(segment => PROTECTED_SEGMENTS.has(segment)) || segments.at(-1) === '.mcp.json'
}

export const DEVELOPER_AGENT = 'developer'

// 승인된 범위가 상한이다 — 사용자가 ✋·픽업 미리보기에서 승인한 ALLOWED_PATHS에 든 경로는 layerMap 밖·다른 에이전트 소유여도 developer가
// 쓴다(진입 파일·README·.changeset 한 줄이 스팩 개정으로 번지지 않게). 검사를 정의하는 표면은 범위로도 열지 않는다 — 쓴 사람이 채점
// 기준(스크립트·도구 설정·CI·훅)을 바꾸지 못하게. 보호 경로·오케스트레이터 산출물은 그보다 앞서 막힌다.
const GATE_SURFACES = [
  /(?:^|\/)(?:package\.json|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|pnpm-workspace\.yaml|turbo\.json|nx\.json|lerna\.json|\.node-version|\.pnpmfile\.[cm]?js|dockerfile|docker-compose\.ya?ml|makefile|jenkinsfile|\.gitlab-ci\.yml|azure-pipelines\.yml|bitbucket-pipelines\.yml)$/,
  /(?:^|\/)[jt]sconfig(?:\.[^/]+)?\.json$/,
  /(?:^|\/)[^/]+\.(?:config|workspace)\.(?:[cm]?[jt]s|json)$/, // vite·vitest·playwright·jest·eslint·next 등 도구 설정 부류
  /(?:^|\/)(?:biome|knip|renovate)\.jsonc?$/,
  /(?:^|\/)\.[a-z0-9-]+rc(?:\.[^/]+)?$/, /(?:^|\/)\.(?:nvmrc|eslintignore|prettierignore|stylelintignore)$/,
  /(?:^|\/)\.(?:github|husky|circleci|gitlab|buildkite)(?:\/|$)/, /^_workspace(?:\/|$)/,
]
// 대소문자를 무시한다 — macOS·Windows 기본 파일시스템에서 `Package.json`은 `package.json`이다. 비밀 이름 파일(.env·키)도 범위로 만들지 않는다.
export const isScopeGrantable = path => {
  const clean = String(path).trim().replace(/^\.\//, '').toLowerCase()
  return !isProtectedWritePath(clean) && !isSecretPath(clean) && !GATE_SURFACES.some(pattern => pattern.test(clean))
}
// 범위 펜스(json change-scope)에 적힌 것만 — 산문 한 줄 표기는 범위를 좁히기만 하고 layerMap 밖을 열지 않는다. 경로는 프로젝트 루트 기준(앞 세그먼트 허용 없음).
export const scopeGrants = (scope, path) => scope?.fenced === true && Array.isArray(scope.paths) && scope.paths.length > 0 && isScopeGrantable(path) &&
  scope.paths.filter(isLayerPathDeclared).some(entry => layerPattern(entry, {anchored: true}).test(path))

// 개발 에이전트는 layerMap의 모든 선언 경로를 소유한다. 테스트·문서처럼 다른 에이전트가
// 소유하는 레이어도 포함되지만, 스폰 범위가 그 위에서 다시 좁힌다.
// 테스트 레이어(spec.testLayers)도 개발 에이전트가 소유한다 — 유닛은 항상, e2e는 UI가 있을 때.
// 실측(2026-08-27): 통합 전 test-writer가 `e2e/**.spec.ts`를, visual-test-writer가
// `e2e/**.visual.spec.ts`를 소유했는데 삭제 후 **아무도 소유하지 않았다**. 실제 훅으로 재현하니
// layerMap이 소스 레이어만 담은 스팩에서 `e2e/checkout.spec.ts` 쓰기가 차단됐다(유닛 테스트는
// 소스 레이어 안에 있어 통과했다). layerMap은 논리 **소스** 레이어라 e2e가 들어갈 자리가 없다 —
// 그래서 테스트 경로는 별도 필드로 선언되고 여기서 소유권으로 이어진다.
//
// 겹침 판정에 testLayers를 넣지 않는 이유: 유닛 테스트를 소스 옆에 두면 layerMap 값과 겹치는
// 것이 **정상**이다. 겹침 불신은 layerMap 안의 레이어끼리에만 적용한다.
export const testLayerPaths = spec => Object.values(spec?.testLayers ?? {}).filter(path => isLayerPathDeclared(path))

export const resolveDeveloperOwnership = spec => {
  const layerMap = spec?.layerMap
  if (!layerMap || typeof layerMap !== 'object' || Object.keys(layerMap).length === 0) return null
  if (findLayerOverlaps(layerMap).length > 0) return null   // 겹치면 신뢰하지 않는다
  const patterns = [...Object.values(layerMap), ...testLayerPaths(spec)]
    .filter(path => isLayerPathDeclared(path))
    .map(path => layerPattern(path))
  return patterns.length > 0 ? patterns : null
}

// 스폰별 범위 — change-scope의 ALLOWED_PATHS. 소유권과 **교집합**이다. 범위가 소유권을
// 넓히지 못하고, 소유권이 범위를 넓히지 못한다. 둘 다 통과해야 쓸 수 있다.
// light change 레인의 계획 패스(change-scope `PHASE: plan`)에서 developer는 **기획 문서를 쓰지 않는다** — 기준은 라운드의 완료 조건
// (`ACC-`)·테스트 항목(`TT-`)이고 메인이 change-scope에 싣는다(change-lane-checkpoint). 쓰는 것은 API 계약(웹 api-schema, 라이브러리·
// CLI api-design)뿐이다. 예외 하나: 잠긴 스팩이 feature-plan을 결박했고 펜스가 `PLAN_WRITEBACK: "tc-rows"`면 — 이미 승인된 TC의 동작을
// 바꾸는 라운드 — feature-plan의 그 TC 행과 plan-delta만 더 쓴다(안 고치면 승인된 TC가 코드와 어긋난다). 펜스는 좁히기만 하고 스팩이
// 천장이다. solution-design은 스팩의 layerMap(곧 소유권)을 낳으므로 쓰지 않는다 — 필요하면 full이다. source·테스트는 ✋ 뒤에 쓴다.
const DEVELOPER_PLAN_PHASE_API = /^_workspace\/02_design\/(?:api-schema|api-design)(?:\.md|\/.+)$/
export const DEVELOPER_PLAN_PHASE_TC_WRITEBACK = [
  /^_workspace\/01_plan\/feature-plan\.md$/,
  /^_workspace\/01_plan\/plan-delta\/PC-\d+\.json$/,
  DEVELOPER_PLAN_PHASE_API,
]
export const developerPlanPhaseOwnership = (spec, scope = null) => (spec?.acceptanceSource === 'feature-plan' && scope?.planWriteback === 'tc-rows'
  ? DEVELOPER_PLAN_PHASE_TC_WRITEBACK
  : [DEVELOPER_PLAN_PHASE_API])

export const intersectWithScope = (patterns, allowedPaths) => {
  if (!Array.isArray(allowedPaths) || allowedPaths.length === 0) return patterns
  const scoped = allowedPaths
    .filter(path => isLayerPathDeclared(path))
    .map(path => layerPattern(path))
  if (scoped.length === 0) return patterns
  return [{test: value => patterns.some(p => p.test(value)) && scoped.some(p => p.test(value)),
           source: `scope(${allowedPaths.join(', ')})`}]
}

export const resolveSpecOwnership = (spec, agentType) => {
  const roles = AGENT_LAYER_ROLES[agentType]
  if (!roles) return null
  // 스팩이 layerMap을 주면 그것이 이긴다. 없으면 null → 호출자가 AGENT_OWNERSHIP으로 돌아간다.
  const layerMap = spec?.layerMap
  if (!layerMap || typeof layerMap !== 'object' || Object.keys(layerMap).length === 0) return null
  if (findLayerOverlaps(layerMap).length > 0) return null   // 겹치면 신뢰하지 않는다
  const patterns = roles
    .filter(role => isLayerPathDeclared(layerMap[role]))
    .map(role => new RegExp(`^${appPrefix}${normalizeLayerPath(layerMap[role]).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
  return patterns.length > 0 ? patterns : null
}
