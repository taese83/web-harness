# Project Init Checklist

`/project-init`의 5개 Phase 실행 순서와 각 Phase에서 생성할 파일 목록.

모노레포 경로 표기: `{root}` = 프로젝트 루트, `{app}` = `apps/{appName}` (단일 앱이면 `{root}`)

---

## Phase 1 — 뼈대 (Root 구조)

### 모노레포인 경우
- `{root}/package.json` — 모노레포 루트 (template section: ROOT_PACKAGE_JSON)
- `{root}/pnpm-workspace.yaml` — 워크스페이스 설정 (template section: PNPM_WORKSPACE)
- `{root}/turbo.json` — Turborepo 태스크 설정 (template section: TURBO_JSON)
- `{root}/.gitignore` (template section: GITIGNORE)
- `{root}/.prettierrc` (template section: PRETTIERRC)
- `{root}/eslint.config.js` — 루트 ESLint Flat Config (template section: ESLINT_CONFIG)
- `$ node {currentProject}/.claude/scripts/run-package-operation.mjs --project {root} --operation git-init` — 사용자 확인 후 Git 초기화

### 단일 앱인 경우
- `{root}/package.json` — 앱 직접 (template section: APP_PACKAGE_JSON 변형)
- `{root}/.gitignore`
- `{root}/.prettierrc`
- `{root}/eslint.config.js` — ESLint Flat Config (template section: ESLINT_CONFIG)
- `$ node {currentProject}/.claude/scripts/run-package-operation.mjs --project {root} --operation git-init`

---

## Phase 2 — 앱 구조 (TypeScript + Vite + FSD)

- `{app}/package.json` (template section: APP_PACKAGE_JSON)
- `{app}/tsconfig.json` (template section: TSCONFIG)
- `{app}/tsconfig.web.json` (template section: TSCONFIG_WEB)
- `{app}/vite.config.ts` (template section: VITE_CONFIG)
- `{app}/index.html` (template section: INDEX_HTML)
- `{app}/vitest.config.ts` (template section: VITEST_CONFIG)
- `{app}/playwright.config.ts` (template section: PLAYWRIGHT_CONFIG)
- `{app}/src/test/setup.ts` (template section: TEST_SETUP)
- `{app}/src/test/utils.tsx` (template section: TEST_UTILS)
- `{app}/e2e/smoke.spec.ts` (template section: E2E_SMOKE)

### FSD 디렉토리 생성 (빈 디렉토리는 .gitkeep)
- `{app}/src/app/providers/`
- `{app}/src/app/routes/`
- `{app}/src/app/ui/`
- `{app}/src/pages/`
- `{app}/src/widgets/`
- `{app}/src/features/`
- `{app}/src/entities/`
- `{app}/src/shared/api/`
- `{app}/src/shared/ui/`
- `{app}/src/shared/hooks/`
- `{app}/src/shared/utils/`
- `{app}/src/shared/constants/`
- `{app}/src/shared/config/`
- `{app}/src/shared/store/`
- `{app}/src/shared/assets/`
- `{app}/src/mocks/handlers/`
- `{app}/src/test/`
- `{app}/public/`

### 앱 진입점

**UI_LANE 분기**: 아래 목록은 `mui` 레인 기준이다. `tailwind-shadcn` 레인이면 표기된 섹션 대신
`*_TAILWIND` 대응 섹션을 쓴다 — `APP_PACKAGE_JSON_TAILWIND`(의존성 교체분), `VITE_CONFIG_TAILWIND`,
`APP_TSX_TAILWIND`, `APP_STYLE_CSS_TAILWIND`, `ERROR_FALLBACK_TAILWIND`, `HOME_PAGE_TAILWIND`,
`NOT_FOUND_PAGE_TAILWIND`. 이 레인은 `theme.ts`를 만들지 않고(토큰=style.css `@theme`),
`src/shared/lib/utils.ts`(`UTILS_CN_TAILWIND`)를 추가한다. 한 앱에 두 레인을 섞지 않는다.

- `{app}/src/main.tsx` (template section: MAIN_TSX)
- `{app}/src/vite-env.d.ts` (template section: VITE_ENV_D_TS)
- `{app}/src/app/App.tsx` (template section: APP_TSX)
- `{app}/src/app/style.css` (template section: APP_STYLE_CSS)
- `{app}/src/app/theme.ts` (template section: APP_THEME — mui 레인 전용)
- `{app}/src/app/providers/RouterProvider.tsx` (template section: ROUTER_PROVIDER)
- `{app}/src/app/routes/index.ts` (template section: ROUTES_INDEX)
- `{app}/src/app/routes/Routes.tsx` (template section: ROUTES_TSX)
- `{app}/src/shared/ui/ErrorFallback/ErrorFallback.tsx`와 `index.ts` (template section: ERROR_FALLBACK)
- `{app}/src/pages/home/index.ts` (template section: HOME_INDEX)
- `{app}/src/pages/not-found/ui/NotFoundPage.tsx`와 `index.ts` (template section: NOT_FOUND_PAGE)
- `{app}/src/pages/home/ui/HomePage.tsx` (template section: HOME_PAGE)

### Shared 레이어 기본 파일
- `{app}/src/shared/api/api.ts` (template section: SHARED_API)
- `{app}/src/shared/api/queryClient.ts` (template section: QUERY_CLIENT)
- `{app}/src/shared/api/types.ts` (template section: API_TYPES)
- `{app}/src/shared/api/constants.ts` (template section: API_CONSTANTS)
- `{app}/src/shared/api/index.ts`
- `{app}/src/shared/config/index.ts` (template section: SHARED_CONFIG)
- `{app}/src/shared/store/createStore.ts` (template section: CREATE_STORE)
- `{app}/src/shared/store/index.ts`
- `{app}/src/mocks/handlers/index.ts` (template section: MOCK_HANDLERS_INDEX)
- `{app}/src/mocks/browser.ts` (template section: MOCK_BROWSER)
- `{app}/src/mocks/server.ts` (template section: MOCK_SERVER)
- `{app}/public/mockServiceWorker.js` — `run-package-operation.mjs --operation msw-init`으로 생성하며 직접 작성하지 않는다

---

## Phase 3 — 환경 파일 + 코드 품질 도구

### 환경 파일 (intake의 env 이름 기준으로 생성)
- `{app}/.env.{env1}` — 예: `.env.dev`
- `{app}/.env.{env2}` — 예: `.env.staging`
- `{app}/.env.{env3}` — 예: `.env.production`
- (추가 환경이 있으면 동일하게)

각 env 파일 내용 (template section: ENV_FILE):
```
VITE_PHASE={envName}
VITE_API_URL=https://api.{envName}.example.com
VITE_APP_TITLE={appTitle}
```

### Husky + lint-staged
- `$ node {currentProject}/.claude/scripts/run-package-operation.mjs --project {root} --operation lockfile` — 사용자 확인 후 public registry exact dependency의 lockfile만 생성
- 생성된 lockfile source/integrity diff를 검토한 뒤 `$ node {currentProject}/.claude/scripts/run-package-operation.mjs --project {root} --operation install` — frozen lockfile과 lifecycle script 비활성화로 설치
- `$ WEB_HARNESS_ISOLATED_EXECUTION=1 node {currentProject}/.claude/scripts/run-package-operation.mjs --project {app} --operation msw-init` — 실제 외부 격리 setup job에서 MSW install 직후 worker 생성·동기화
- `$ WEB_HARNESS_ISOLATED_EXECUTION=1 node {currentProject}/.claude/scripts/run-package-operation.mjs --project {root} --operation husky-init` — 실제 외부 격리 setup job에서만 실행; host 사용자 확인만으로는 실행하지 않음
- `{root}/.husky/pre-commit` 파일에 내용 추가 (template section: HUSKY_PRE_COMMIT)

---

## Phase 4 — GitHub / PR 설정

- `{root}/.github/PULL_REQUEST_TEMPLATE.md` (template section: PR_TEMPLATE)
- `{root}/.github/CODEOWNERS` (template section: CODEOWNERS) — 팀 GitHub 계정 입력 필요 표시
- `{root}/.github/workflows/preview.yml` — GitHub Actions (intake에서 CI 필요 여부 확인 후 생성, template section: GITHUB_ACTIONS)
- `{root}/.github/renovate.json` — SHA-pinned action 자동 갱신 (template section: RENOVATE_CONFIG, Renovate 미사용 시 DEPENDABOT_CONFIG 대체)

---

## Phase 5 — Claude Harness 배포

<!-- repo-only:start -->
오케스트레이터의 의존성 closure가 깨지지 않도록 trusted deploy script로 harness를 원자적으로 복사한다. target은 현재 repository 안의 기존 project directory여야 하고 `.claude`가 이미 있으면 덮어쓰지 않고 중단한다.

- 배포 inventory: `.claude/README.md`, `.claude/skills`, `.claude/agents`, `.claude/scripts`, `.claude/evals`, `.claude/adapters`, `.claude/schemas`, generated-project용 `.claude/settings.json`과 validator reference `.claude/settings.project.json`, 배포 판별 마커 `deployment.json`(deploy-harness가 target `.claude` 루트에 생성 — source repo 전용 adapter drift/inventory 검사를 target에서 건너뛰는 근거)
- toolchain pin: `.node-version`, `.nvmrc`
- `$ node {currentProject}/.claude/scripts/deploy-harness.mjs --target {root}` — 사용자 확인 후 source/staged target validation과 symlink 검사를 포함해 실행; 실패 시 새 `.claude`와 새 pin을 rollback
- `$ node {root}/.claude/scripts/validate-toolchain.mjs`
- `$ node {root}/.claude/scripts/validate-harness.mjs`
<!-- repo-only:end -->
- 개발·테스트 파일 완료 후 로컬 진단은 사용자 승인과 함께 `$ node {root}/.claude/scripts/run-quality-gates.mjs --all --allow-host-execution`
- release 후보는 격리 CI에서 `$ WEB_HARNESS_ISOLATED_EXECUTION=1 node {root}/.claude/scripts/run-quality-gates.mjs --all`로 receipt를 다시 생성
- checkout 밖의 protected trust digest와 CI provenance를 주입하고, `$ node {root}/.claude/scripts/prepare-quality-attestation.mjs --project {root} --issuer-run-id <trusted-ci-run-id>`의 unsigned request를 외부 trusted attester가 CI/OIDC·격리·frozen install과 대조해 final subject를 구성·서명한 뒤, Next profile이면 최종 Next contract validator와 verifier를 실행
- 모든 QA 보고서 저장 후 `$ node {root}/.claude/scripts/validate-release-gate.mjs --write-manifest && node {root}/.claude/scripts/validate-release-gate.mjs`

개별 skill이나 agent를 선별 복사하지 않는다. 배포 대상별 커스터마이징이 필요하면 전체 복사와 검증을 먼저 완료한 뒤 manifest에 명시하고 제거한다.

---

## 완료 후 체크리스트

```markdown
## 🎉 프로젝트 세팅 완료

### 생성된 구조
{생성된 디렉토리 트리 출력}

### 다음 단계
- [ ] `cd {root} && pnpm dev` — 개발 서버 시작 (http://localhost:8080)
- [ ] `.env.{env}` 파일에서 `VITE_API_URL` 실제 값으로 수정
- [ ] `.github/CODEOWNERS`에 팀 GitHub 계정 추가
- [ ] `{app}/src/app/routes/Routes.tsx`에 첫 페이지 라우트 추가
- [ ] 내부(사설 레지스트리) 패키지가 필요하면 built-in public-registry broker 범위 밖으로 `BLOCKED` 처리하고 별도 private-registry adapter·credential policy를 승인받는다

### 사용 가능한 Commands
| 명령 | 설명 |
|---|---|
| `pnpm dev` | 개발 서버 시작 |
| `pnpm build` | 프로덕션 빌드 |
| `pnpm test` | Vitest 테스트 실행 |

### 사용 가능한 Skills
| Skill | 역할 |
|---|---|
| `/fsd-scaffold` | FSD 레이어 결정 + 슬라이스 보일러플레이트 |
| `/pr-drafter` | git diff → 한국어 PR 초안 자동 작성 |
| `/component-gen` | 선택된 UI 레인(UI_LANE) 컨벤션에 맞게 생성 |
| `/timeseries-dashboard` | 시계열·실시간 dashboard 설계/구현/검증 |
| `/next-app` | Next.js App Router compatible profile 구현·검증 |
```
