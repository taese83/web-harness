# `.claude` Web Engineering Audit & Remediation Report

- 감사일: 2026-07-13 (Asia/Seoul)
- 수정일: 2026-07-13 (Asia/Seoul)
- 범위: `.claude/agents`, `.claude/skills`, skill reference, `.claude/settings.json`
- 최초 규모: agent 46개, skill 13개, reference 17개, 총 7,495줄(settings 포함)
- 수정 후 규모: active agent 46개, skill 14개, reference 22개, harness 전체 9,590줄
- 관점: 시니어 웹 엔지니어링, 프로덕션 안전성, Claude Code 운영성

## 0. 수정 결과

최초 감사에서 확인한 P0/P1 결함은 harness 범위에서 조치했다. 아래 1절 이후는 **수정 전 baseline의 근거와 판단**을 보존한 기록이므로, 현재 상태 판정은 이 절을 우선한다.

| 영역 | 조치 결과 |
|---|---|
| 패키징/호출 | `/skill-name`으로 통일하고 skills·agents·scripts·evals·settings 전체 dependency closure를 복사하도록 수정 |
| 권한 | 46개 active agent에 `tools`, `model`, `maxTurns`를 명시하고, 9개 verifier의 Write/Edit 금지·Bash 검증 allowlist와 37개 writable agent의 경로 ownership hook 적용 |
| 역할 구조 | 중복 coordinator 5개 제거, QA agent 3개와 `timeseries-architect`, `realtime-data-builder` 추가 |
| 웹 스택 | React 19.2, Router 8의 `react-router`/`react-router/dom`, Node 22.22+, Vite 8, MUI 7, ESLint 10 Flat Config, Vitest 4, Playwright 기준선으로 갱신 |
| API/오류 | envelope unwrap, runtime Zod validation, typed `AppError`, 취소 가능한 bounded 429 retry, QueryErrorResetBoundary 계약으로 통일 |
| 인증/인가 | Web Storage credential 패턴 제거, BFF cookie/OIDC PKCE, CSRF/CORS, single-flight, 서버 인가 계약 적용 |
| QA | unit 외 Playwright·axe·keyboard·viewport·console/network·API contract·security gate 추가 |
| 성능 | FID를 INP로 교체하고 blanket lazy/manualChunks를 측정 기반 결정으로 변경, RUM 계약 추가 |
| 시계열 | 한·영 의미 기반 mode 판별, 공통 Unix ms schema, snapshot+stream, bounded buffer, Worker transferable, reconnect/resume, Mock→real 전환, 장시간 성능 계약 추가 |
| 공급망 | mutable action tag와 장기 AWS key 제거, full SHA 검증·OIDC·environment approval·cross-run artifact 검증·Renovate/Dependabot 적용 |
| 거버넌스 | 무의존 validator와 14개 회귀 eval scenario(한국어 historical 양성·realtime chat 음성 포함) 추가 |

검증 명령 `node .claude/scripts/validate-harness.mjs`는 22개 구조·의미 계약 검사를 모두 통과했다. ownership hook은 허용 경로 PASS, 타 agent 경로와 project 외부 경로 exit 2 차단을 확인했고 verifier Bash hook은 검증 명령 허용, snapshot update와 mutation 명령 exit 2 차단을 확인했다. Router v8 package/import/Node baseline, MSW worker, 429 retry, bilingual timeseries detection, timestamp/Worker, realtime Mock 순서, deploy updater ownership, action full-SHA classifier를 회귀 검사한다. 이 repository는 생성 대상 애플리케이션 자체가 아니므로 실제 dependency install/build/browser smoke는 수행 대상이 아니다. GitHub Action full SHA와 선택 라이브러리 최신 버전은 생성 시점에 공식 release/engine/peer 문서로 해석해 치환하도록 계약화했다.

## 1. 최초 감사 결론 (수정 전)

현재 구성은 **기획 → 설계 → 구현 → QA → 릴리스 산출물**의 흐름과 파일 소유권을 정교하게 나눈 “프로토타입 생성 가속기”로서는 강하다. 그러나 그대로는 **프로덕션 웹 애플리케이션 생성 표준**으로 보기 어렵다.

가장 큰 이유는 다음과 같다.

1. 새 프로젝트로 복사한 뒤 orchestrator가 의존하는 agent가 없어 실행 체인이 끊긴다.
2. QA agent의 read-only 제약이 프롬프트에만 있고 도구 권한으로 강제되지 않는다.
3. 고정된 2024년형 스택과 2026년 API가 혼재해 생성 코드가 빌드되지 않을 수 있다.
4. API envelope, 에러 타입, React Query 정책이 서로 모순된다.
5. 보안·접근성·E2E·성능·공급망 검증이 실제 품질 게이트가 아니라 grep과 문서 체크에 머문다.
6. skill/agent 자체의 회귀를 막는 자동 lint, smoke generation, eval 시나리오가 전혀 없다.

따라서 현재 상태의 권장 판정은 다음과 같다.

| 영역 | 판정 | 요약 |
|---|---|---|
| 단계 오케스트레이션 | 양호 | phase, wave, 산출물, retry 경계가 명확함 |
| 코드 소유권 | 양호 | agent별 수정 범위와 QA 불변 계약이 잘 문서화됨 |
| 기술 선택 적응성 | 위험 | “advisor”가 실제로는 React/MUI/Vite/FSD 고정 스택 강제 |
| 생성 코드 정합성 | 위험 | 템플릿·agent·reference 간 충돌과 누락 dependency 존재 |
| 보안 | 위험 | 인증 저장소, RBAC, CSP, CI credential 정책이 불충분 |
| 테스트/접근성 | 미흡 | unit 중심, 실브라우저 E2E/a11y/visual regression 부재 |
| 성능/운영 | 미흡 | 폐기된 FID, 개발 콘솔 측정, RUM·budget·rollback 부재 |
| agent 운영 거버넌스 | 위험 | 46개 모두 tool restriction·eval·maxTurns 없음 |

## 2. 잘된 점

### 2.1 단계와 산출물 계약

- `web-orchestrator`는 Source/Plan/Design/Develop/QA 단계와 선후행 파일을 분명히 정의한다 (`.claude/skills/web-orchestrator/SKILL.md:25`).
- 기존 PRD·디자인·OpenAPI를 원본 불변으로 취급하고 정규화 산출물에 source trace를 남기는 방식은 감사 가능성이 높다 (`.claude/agents/source-artifact-ingestor.md:24`).
- QA agent가 직접 production source를 고치지 않고 owner agent로 되돌리는 구조는 역할 혼선을 줄인다 (`.claude/skills/web-orchestrator/references/execution-contract.md:77`).
- retry 횟수와 hard stop을 명시해 무한 수정 루프를 방지한다 (`.claude/skills/web-orchestrator/references/retry-policy.md:14`).

### 2.2 프런트엔드 상태 경계

- server state를 Zustand/useState로 복제하지 않는 원칙은 적절하다 (`.claude/agents/form-state-builder.md:19`).
- query cancellation을 위한 `AbortSignal`, URL 기반 필터 상태, mutation invalidation을 명시한 점은 좋다 (`.claude/agents/entity-query-builder.md:22`, `.claude/agents/form-state-builder.md:22`).
- MSW browser/server handler를 공유하는 방식은 개발과 테스트의 계약을 맞추는 데 유용하다 (`.claude/agents/mock-api-builder.md:24`).

### 2.3 기본적인 안전 의식

- `VITE_*`가 브라우저에 노출된다는 점과 local override를 gitignore하는 규칙은 올바르다 (`.claude/skills/web-orchestrator/references/env-management.md:5`).
- source artifact, 배포, push, 외부 mutation, 비어 있지 않은 디렉터리 등에 안전 게이트가 있다 (`.claude/skills/web-orchestrator/references/execution-contract.md:22`).
- npm library에 API-first 설계, explicit exports, pack dry-run, Changesets를 넣은 것은 좋은 출발점이다.

## 3. 즉시 수정할 P0 결함

### P0-1. 복사된 orchestrator가 실행 불가능함

**증거**

- `project-init`은 새 프로젝트에 skill 8개만 복사한다 (`.claude/skills/project-init/references/checklist.md:119`).
- 그러나 `web-orchestrator`는 `.claude/agents/{agent-name}.md`가 존재한다고 전제한다 (`.claude/skills/web-orchestrator/SKILL.md:34`).
- 복사 목록에는 `.claude/agents/**`가 전혀 없다.
- 완료 안내에는 복사하지 않은 `$pr-drafter`를 사용 가능하다고 표시한다 (`.claude/skills/project-init/references/checklist.md:158`).
- 현재 Claude Code의 사용자 호출 문법은 `/skill-name`인데 대부분 문서가 `$skill-name`을 사용한다. 공식 문서도 skill을 `/name`으로 호출하도록 설명한다. [Claude Code Skills](https://code.claude.com/docs/en/slash-commands)

**영향**

- 새 프로젝트에서 `/web-orchestrator`, `/web-plan`, `/web-verify`가 agent를 찾지 못한다.
- 사용자에게 존재하지 않거나 잘못된 명령을 안내한다.

**권장 수정**

1. 이 구성을 standalone 복사본이 아니라 **Claude Code plugin**으로 패키징한다.
2. plugin root에 `skills/`, `agents/`, `hooks/`, `.claude-plugin/plugin.json`을 함께 둔다. 공식 plugin은 이 구성 요소를 하나의 버전 단위로 배포한다. [Claude Code Plugins](https://code.claude.com/docs/en/plugins)
3. standalone 방식을 유지한다면 `project-init`이 agents, references, hooks, validator scripts까지 dependency closure 전체를 복사하도록 한다.
4. 모든 `$skill-name`을 `/skill-name`으로 바꾸고, 문서 예시를 자동 lint한다.

### P0-2. 46개 agent 모두 권한이 과도함

**증거**

- 모든 agent frontmatter가 사실상 `name`, `description`만 사용한다.
- Claude Code는 `tools`를 생략하면 parent의 모든 도구를 상속한다. `tools`, `disallowedTools`, `model`, `maxTurns`, `skills`, `isolation`을 frontmatter에서 제어할 수 있다. [Claude Code Subagents](https://code.claude.com/docs/en/sub-agents)
- `code-reviewer`, `ux-validator`, `integration-verifier`, `test-executor`는 본문상 read-only지만 실제로 Write/Edit/Bash 권한을 제한하지 않는다 (`.claude/agents/code-reviewer.md:19`).

**영향**

- QA 불변 계약이 모델 준수에만 의존한다.
- agent 오작동 시 source/config/lockfile을 수정할 수 있다.
- agent마다 비용·turn 수·context가 통제되지 않는다.

**권장 수정**

- read-only reviewer: `tools: Read, Glob, Grep, Bash`, `disallowedTools: Write, Edit`, `maxTurns` 설정.
- QA report 작성은 main orchestrator가 agent 반환값을 받아 기록하거나, agent-scoped `PreToolUse` hook으로 `_workspace/04_qa/**`만 허용한다.
- builder는 담당 경로 외 Write/Edit를 막는 deterministic hook을 둔다. 프롬프트 규칙은 보안 경계가 아니며 Claude 공식 문서도 강제 규칙은 hook으로 구현할 것을 권한다. [Claude Code Hooks](https://code.claude.com/docs/en/hooks-guide)
- 장기 작업에는 `maxTurns`; 독립 구현에는 `isolation: worktree`; 공통 규칙에는 `skills:` preload를 사용한다.
- `project-init`, `web-orchestrator`, `dev-orchestrator`, `version-bump`, `api-connect`, `auth-setup`처럼 파일·dependency·버전을 바꾸는 action skill에는 `disable-model-invocation: true`를 기본 적용한다. [Skill Invocation Controls](https://code.claude.com/docs/en/slash-commands#control-who-invokes-a-skill)

### P0-3. 템플릿과 agent 계약이 서로 모순됨

**확정 결함**

1. `app-shell-builder`는 inline `ErrorFallback`을 금지하지만 (`.claude/agents/app-shell-builder.md:26`), project template은 `App.tsx`와 `Routes.tsx`에 각각 inline fallback을 만든다 (`.claude/skills/project-init/references/templates.md:469`, `.claude/skills/project-init/references/templates.md:586`).
2. checklist에는 `src/shared/error/ErrorFallback.tsx` 생성 항목 자체가 없다 (`.claude/skills/project-init/references/checklist.md:73`).
3. `AppApi.request<T>`는 `ResponseSuccessType<T>` envelope 전체를 반환한다 (`.claude/skills/project-init/references/templates.md:717`). 반면 query template은 `api.get<EntityType[]>()`가 바로 `EntityType[]`를 반환하는 것처럼 사용한다 (`.claude/skills/fsd-scaffold/references/slice-template.md:102`).
4. Base Stack은 Zod를 필수로 선언하지만 project `package.json` template에는 `zod`, `@hookform/resolvers`가 없다 (`.claude/agents/tech-advisor.md:33`, `.claude/skills/project-init/references/templates.md:191`).
5. app shell은 `web-vitals` import 파일 생성을 강제하지만 package template에 `web-vitals`가 없다 (`.claude/agents/app-shell-builder.md:27`, `.claude/skills/project-init/references/templates.md:191`).
6. `project-scaffolder`는 `package-scaffolder`가 `index.html`을 소유한다고 쓰지만 (`.claude/agents/project-scaffolder.md:12`), 실제 package agent는 package/workspace metadata만 소유한다 (`.claude/agents/package-scaffolder.md:10`).
7. tooling agent는 Flat Config/manual chunks/CSP를 강제하지만 project template은 `.eslintrc.json`과 다른 Vite config를 직접 생성한다 (`.claude/agents/tooling-scaffolder.md:17`, `.claude/skills/project-init/references/templates.md:144`).

**권장 수정**

- package/config/source template의 source of truth를 하나로 통합한다.
- 권장 구조는 `stack-manifest.json` + template generator + schema validator다. agent 문서는 generator를 호출하고 결과를 임의 재작성하지 않는다.
- 생성 전 `dependency closure`를 계산해 import된 모든 package가 dependency에 선언됐는지 검사한다.
- 최소 fixture 3개(CSR app, SSR/public app, React library)를 실제 생성하여 `install → typecheck → lint → test → build` smoke test를 수행한다.

### P0-4. 구버전 고정과 신구 API 혼용

**증거**

- `tech-advisor`는 React 18, Vite 5, Router 6, MUI 5를 항상 강제한다 (`.claude/agents/tech-advisor.md:20`).
- project template도 React 18.3, Vite 5.4, Router 6.27, MUI 5.16, Vitest 2, ESLint 8에 고정돼 있다 (`.claude/skills/project-init/references/templates.md:173`).
- 2026-07 기준 공식 세대는 React 19.2, Vite 8, MUI 7, React Router 8이며 ESLint Flat Config는 v9부터 기본이다. [React 19.2](https://react.dev/blog/2025/10/01/react-19-2), [Vite 8](https://vite.dev/blog/announcing-vite8), [MUI v7](https://mui.com/material-ui/migration/upgrade-to-v7/), [React Router](https://reactrouter.com/), [ESLint Flat Config](https://eslint.org/docs/latest/use/configure/migration-guide)
- `performance-patterns`는 Router 6.4에서 `<Link prefetch="intent">`가 가능하다고 쓰지만 (`.claude/skills/web-orchestrator/references/performance-patterns.md:180`), 이 prop은 현재 React Router Framework 모드 문서에 속한다. 구버전 declarative Router template에 그대로 넣으면 타입/API 불일치 가능성이 높다. [React Router Link](https://reactrouter.com/api/components/Link)
- Node engine은 `>=22.10.0`인데 Vite 8은 Node 22 계열에서 22.12+를 요구한다 (`.claude/skills/project-init/references/templates.md:15`). [Vite 8 Node Support](https://vite.dev/blog/announcing-vite8#node-js-support)

**권장 수정**

- `tech-advisor`를 고정 스택 출력기가 아니라 **capability/constraint decision agent**로 바꾼다.
- stack profile을 최소 `spa-internal`, `public-ssr`, `static-content`, `component-library`, `ts-library`로 분리한다.
- 버전은 문서에 장기 고정하지 말고, 검증된 compatibility manifest를 주기적으로 갱신한다.
- 정확한 버전은 lockfile로 재현하고 Renovate/Dependabot으로 업데이트 PR을 생성한다.
- major upgrade는 fixture CI를 통과한 profile만 승격한다.

### P0-5. 인증·인가 보안 모델이 불완전함

**증거**

- reference가 localStorage에 access/refresh token을 저장하는 구현을 제공한다 (`.claude/skills/auth-setup/references/auth-patterns.md:24`, `.claude/skills/auth-setup/references/auth-patterns.md:83`).
- OWASP는 인증 토큰, session ID, JWT, refresh token을 localStorage와 sessionStorage에 저장하지 말고 HttpOnly cookie 또는 BFF를 우선하라고 권고한다. [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- 문서는 401 refresh를 “single-flight”라고 요구하지만 예시에는 공유 promise/queue가 없어 동시 refresh를 직렬화하지 못한다 (`.claude/skills/auth-setup/references/auth-patterns.md:61`).
- route agent의 `RoleGuard`는 client-side role만 검사한다 (`.claude/agents/route-builder.md:47`). OWASP는 client-side access control을 권한 부여의 결정적 통제로 사용하지 말라고 명시한다. [OWASP Authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)
- cookie 인증에서 SameSite 설명은 있으나 server-side CSRF token issuance/rotation/validation 계약과 origin 검증이 없다. SameSite는 일반적으로 defense-in-depth다. [OWASP CSRF](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)

**권장 수정**

- 기본 profile을 `BFF + HttpOnly Secure SameSite cookie`로 둔다.
- bearer SPA가 반드시 필요하면 OAuth/OIDC Authorization Code + PKCE, in-memory token, refresh 정책, XSS threat model을 별도 profile로 둔다.
- client guard는 UX 제어일 뿐이며 모든 API가 server-side authorization을 수행해야 한다는 계약을 명시한다.
- auth 생성 전에 threat model, trust boundary, credential storage, CSRF/CORS, logout/revocation, session expiry, audit event를 산출물로 만든다.
- auth E2E에 unauthenticated redirect, expired session, concurrent 401, refresh failure, CSRF rejection, horizontal/vertical authorization case를 넣는다.

### P0-6. CI/CD와 package publish 공급망 보안 부족

**증거**

- actions가 major tag로만 고정돼 있고 third-party deploy action도 tag로 사용한다 (`.claude/agents/deploy-ci-writer.md:49`). GitHub는 full-length commit SHA pin 정책을 제공한다. [GitHub Actions Pinning](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository)
- workflow에 top-level/job-level 최소 `permissions`가 없다. GitHub는 `GITHUB_TOKEN`에 최소 권한만 부여할 것을 권고한다. [GitHub Token Permissions](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token)
- AWS 예시는 장기 access key secret을 사용한다 (`.claude/agents/deploy-ci-writer.md:90`). GitHub 공식 문서는 OIDC로 장기 AWS secret 없이 인증하는 방식을 제공한다. [GitHub OIDC for AWS](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws)
- production environment approval, branch protection, concurrency, rollback, artifact retention, smoke/health verification이 없다.
- npm publish agent는 `NPM_TOKEN` 중심이며 trusted publishing/OIDC/provenance가 없다. npm은 short-lived OIDC trusted publishing을 우선 권고한다. [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)

**권장 수정**

- CI와 deploy를 분리한다: PR quality workflow, preview deploy, protected production deploy.
- `permissions: contents: read`를 기본으로 하고 job별 최소 권한만 올린다.
- action SHA pin + Dependabot action updates를 사용한다.
- AWS/Vercel/npm은 가능한 경우 OIDC 또는 vendor 공식 integration을 사용한다.
- production은 GitHub Environment approval, concurrency lock, immutable artifact promote, post-deploy smoke, rollback 절차를 포함한다.
- package publish는 trusted publishing, provenance, `npm audit signatures`, consumer install test를 포함한다.

## 4. P1 품질 결함

### 4.1 QA가 grep 중심이라 신뢰할 수 없음

- `dangerouslySetInnerHTML`을 무조건 FAIL로 처리해 sanitizer를 쓴 정상 코드도 오탐한다 (`.claude/agents/code-reviewer.md:36`). 동시에 DOM sink, URL injection, unsafe markdown, prototype pollution 등은 놓친다.
- storage grep은 `auth|token`을 제외한다 (`.claude/agents/code-reviewer.md:37`). 가장 민감한 저장소 사용을 오히려 검사에서 빼는 역전된 규칙이다.
- a11y grep은 accessible name, focus order, dialog focus trap, contrast, keyboard flow, live region을 검증할 수 없다 (`.claude/agents/code-reviewer.md:40`).
- WCAG 기준이 2.1 AA로 고정돼 있지만 W3C는 최신 정책에 WCAG 2.2 사용을 권한다. [WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- `ux-validator`는 브라우저 없이 파일만 검사한다 (`.claude/agents/ux-validator.md:33`).
- E2E, cross-browser, visual regression, axe, ARIA snapshot, API contract test가 없다. Playwright 공식 문서는 axe 기반 자동 검사가 일부 문제만 찾으므로 수동 접근성 평가와 함께 사용할 것을 권한다. [Playwright Accessibility Testing](https://playwright.dev/docs/accessibility-testing)

**개선안**

1. 정적: TypeScript, ESLint Flat Config, `eslint-plugin-jsx-a11y`, FSD boundary lint, secret scan, dependency scan.
2. unit/component: Vitest + Testing Library + MSW.
3. browser integration/E2E: Playwright Chromium/Firefox/WebKit, 핵심 사용자 여정.
4. a11y: axe + ARIA snapshot + keyboard/focus manual checklist.
5. visual: 핵심 viewport의 screenshot regression.
6. contract: OpenAPI schema validation + generated client/type drift check. OpenAPI는 HTTP API를 사람과 도구가 함께 이해하기 위한 표준 interface description이다. [OpenAPI Specification](https://spec.openapis.org/oas/)
7. quality gate는 “테스트 1개 이상”이나 고정 70%가 아니라 risk-based critical path와 changed-code coverage를 사용한다.

### 4.2 성능 규칙이 측정 없이 최적화를 강제함

- 모든 route를 lazy로 만들고 (`.claude/skills/web-orchestrator/references/performance-patterns.md:18`) 모든 앱에 고정 vendor manual chunks를 강제한다 (`.claude/skills/web-orchestrator/references/performance-patterns.md:45`). 작은 앱에서는 네트워크 waterfall과 관리 비용이 오히려 늘 수 있다.
- Web Vitals가 FID를 사용한다 (`.claude/skills/web-orchestrator/references/performance-patterns.md:191`). INP가 2024년에 FID를 대체했다. [INP Replaced FID](https://web.dev/blog/inp-cwv-launch)
- 측정값을 개발 console에만 출력한다 (`.claude/skills/web-orchestrator/references/performance-patterns.md:203`). 실제 사용자 데이터, release/version, route, device/network dimension, alert가 없다.
- 단일 500KB threshold만 있고 initial JS/CSS/image/font/request count/LCP asset budget이 없다.

**개선안**

- 요구사항 단계에서 route별 performance budget을 정의한다.
- route/component split과 manual chunk는 bundle report와 waterfall을 보고 결정한다.
- CI에 Lighthouse CI 또는 동등한 lab budget을 넣고, production에는 sampled RUM을 넣는다. Web Vitals는 field와 lab을 함께 사용해야 한다. [Web Vitals Measurement](https://web.dev/articles/vitals-measurement-getting-started), [Core Web Vitals Workflow](https://web.dev/articles/vitals-tools)
- 현재 CWV는 LCP, INP, CLS를 기본으로 하고 TTFB/FCP는 진단 지표로 분리한다.
- browser support는 “최신 Chrome/Safari/Edge” 문구 대신 Baseline/Browserslist query로 기계 검증한다. [Web Platform Baseline](https://web.dev/baseline)

### 4.3 API·에러 계약이 손실적이고 모순됨

- Axios interceptor가 403/404/5xx를 plain `Error`로 바꾸면서 status, code, details, request ID, cause를 잃는다 (`.claude/skills/web-orchestrator/references/error-handling-patterns.md:34`).
- network error도 AxiosError이므로 `isAxiosError` 분기 뒤의 `navigator.onLine` 검사가 의도대로 실행되지 않을 수 있다 (`.claude/skills/web-orchestrator/references/error-handling-patterns.md:24`, `.claude/skills/web-orchestrator/references/error-handling-patterns.md:57`).
- retry가 error message에서 HTTP code나 한국어 문자열을 추측한다 (`.claude/skills/project-init/references/templates.md:756`, `.claude/skills/web-orchestrator/references/error-handling-patterns.md:82`).
- 전역 `throwOnError: true`는 loading/error/empty를 컴포넌트에서 모두 구현하라는 계약과 충돌한다 (`.claude/skills/project-init/references/templates.md:761`). TanStack Query에서 `throwOnError`는 render phase에서 nearest boundary로 에러를 보낸다. [TanStack Query useQuery](https://tanstack.com/query/latest/docs/framework/react/reference/useQuery)
- ErrorBoundary reset 버튼은 `QueryErrorResetBoundary`와 연결되지 않아 query error retry가 정상 복원되지 않을 수 있다. [QueryErrorResetBoundary](https://tanstack.com/query/v5/docs/framework/react/reference/QueryErrorResetBoundary)
- 429/Retry-After, idempotency, request timeout, cancellation classification, offline/pause state, trace ID가 없다.

**개선안**

- `AppError` discriminated union에 `kind`, `status`, `code`, `details`, `retryable`, `requestId`, `cause`를 보존한다.
- transport envelope unwrap 여부를 한 곳에서 결정하고 query는 항상 domain data 타입을 받게 한다.
- retry는 typed status와 method/idempotency를 기준으로 결정한다.
- 4xx inline, initial 5xx boundary, background refetch error non-destructive처럼 상황별 정책을 둔다.
- OpenAPI/client generation 또는 schema-driven type generation과 runtime response validation을 선택적으로 지원한다.

### 4.4 설계가 서비스 요구보다 특정 라이브러리를 우선함

- `tech-advisor`가 framework/UI/router/state를 선택하지 않고 고정한다 (`.claude/agents/tech-advisor.md:20`).
- 공개 사이트의 SEO 경고는 “JS를 실행하지 않으면 빈 HTML”이라는 단순 모델과 Next.js 단일 해법에 치우친다 (`.claude/agents/requirements-analyst.md:20`). Googlebot은 JavaScript를 렌더링하지만 rendering queue와 non-JS bot 한계가 있어 SSR/SSG가 여전히 유리하다. [Google JavaScript SEO](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics)
- React Router도 CSR, pre-render, SSR 전략을 제공하므로 framework 선택은 SEO, personalization, hosting, cache, team skill을 함께 봐야 한다. [React Router Rendering Strategies](https://reactrouter.com/start/framework/rendering)
- Atomic Design과 FSD를 동시에 절대 규칙처럼 사용해 taxonomy가 중복된다.
- i18n 폴더를 빈 상태로 생성하지만 실제 `/i18n-setup` skill이 없다 (`.claude/agents/shared-foundation-builder.md:19`).

**개선안**

- `architecture-decider`가 ADR을 생성하도록 한다: rendering, routing, data fetching, auth boundary, deployment/runtime, browser support, observability, testing strategy.
- 내부 SPA에는 CSR, 공개 콘텐츠에는 SSG/SSR, 사용자별 동적 페이지에는 SSR/edge 여부를 비교한다.
- FSD는 선택 가능한 profile로 두고 규모가 작은 앱에는 단순 feature folders를 허용한다.
- UI library도 MUI 고정이 아니라 design constraint, accessibility, density, theming, license로 결정한다.

### 4.5 릴리스와 SemVer 의미가 섞임

- 모든 QA PASS 뒤 웹 앱의 local version까지 자동 변경한다 (`.claude/agents/release-manager.md:14`). 새로 생성된 앱에 매 실행마다 SemVer를 적용할 이유가 불분명하다.
- 내부 구현의 axios→fetch 교체나 인증 기능 추가를 무조건 major로 판단한다 (`.claude/skills/version-bump/references/semver-rules.md:12`). SemVer major는 소비자에게 약속한 public contract의 비호환 변경을 기준으로 해야 한다.
- library는 ESM+CJS dual build를 무조건 생성한다 (`.claude/agents/lib-scaffolder.md:24`). Node는 양쪽 entry가 동시에 로드될 때 dual package hazard가 생길 수 있음을 설명한다. [Node Dual Package Hazard](https://nodejs.org/download/release/v17.4.0/docs/api/packages.html#dual-package-hazard)
- Storybook 설치가 `@latest`, README license가 MIT로 고정, consumer matrix/type export 검증이 없다.

**개선안**

- deploy version, app release version, npm public API SemVer를 별도 정책으로 분리한다.
- application은 immutable build ID/git SHA 중심, package만 public contract 중심 SemVer를 사용한다.
- library output은 ESM-only/dual을 target consumer matrix로 결정한다.
- `npm pack --dry-run` 외에 packed tarball consumer test, ESM/CJS import test, declaration resolution, subpath exports, tree-shaking/sideEffects, minimum peer version을 검증한다.

## 5. agent/skill 구조 개선

### 5.1 46개 active agent는 과도함

현재 5개는 명시적으로 legacy compatibility coordinator다.

- `project-scaffolder`
- `state-integrator`
- `test-runner`
- `version-analyst`
- `lib-publish-setup`

이들은 새 workflow에서 사용하지 말라고 쓰여 있으므로 discovery 대상에 남겨둘 이유가 작다. 또한 `dev-orchestrator`와 `web-orchestrator`가 web-app 경로를 크게 중복한다.

**권장 목표**: active agent 약 18~24개, action skill 6~9개, 나머지는 reference·script·profile로 이동.

| 현재 묶음 | 권장 구조 |
|---|---|
| requirements + UX + feature + tech + synthesizer | `product-planner`, `architecture-decider`, `plan-synthesizer` |
| package + tooling + shared + app-shell | 순차 handoff 4개 대신 `app-foundation-builder` 1~2개 |
| entity + mutation + form + binder | `data-contract-builder`, `feature-integrator` |
| test scaffolder + writer + executor + legacy runner | `test-author`, `test-verifier` + deterministic scripts |
| code + UX + integration grep QA | `static-reviewer`, `browser-verifier`, `security-reviewer`, `performance-verifier` |
| version analyzer + writer + updater + release | `release-planner` + deterministic version/changelog script |
| changeset + metadata + publish CI + pack | `package-release-engineer` |

agent를 합칠 때는 파일 소유권을 없애는 것이 아니라 **같은 순차 transaction과 같은 context를 공유하는 역할**을 합친다. Claude 공식 문서도 phase 간 context 공유가 큰 작업은 main context 또는 과도하게 잘게 나누지 않은 흐름이 적합하다고 설명한다. [Claude Code Extension Choices](https://code.claude.com/docs/en/features-overview)

### 5.2 반드시 추가할 역할

#### P0

1. `architecture-decider`: CSR/SSR/SSG, runtime/hosting, browser, data/auth, ADR.
2. `security-threat-modeler`: trust boundary, data classification, abuse case, mitigation, residual risk. Threat modeling은 설계 초기에 수행해야 한다. [OWASP Threat Modeling](https://cheatsheetseries.owasp.org/cheatsheets/Threat_Modeling_Cheat_Sheet.html)
3. `security-reviewer`: auth/storage/CSP/CORS/CSRF/dependency/secret/CI 검증.
4. `browser-e2e-verifier`: Playwright 핵심 여정, cross-browser, console/network failure.
5. `accessibility-verifier`: WCAG 2.2 AA, axe, keyboard/focus, screen-reader checklist.
6. `api-contract-verifier`: OpenAPI/schema drift, runtime validation, MSW parity.
7. `harness-eval-runner`: skill trigger와 output assertion, template smoke generation.

#### P1

1. `performance-observability`: budget, Lighthouse CI, RUM, error telemetry, release tag.
2. `supply-chain-reviewer`: action SHA, OIDC, provenance, SBOM, dependency policy.
3. `rendering-seo`: metadata, canonical, sitemap, structured data, status code, rendering strategy.
4. `i18n-setup`: locale routing, message loading, date/number/time zone, RTL, pseudo-localization.
5. `visual-regression-verifier`: viewport/theme/state screenshot.

PWA, payment, map, realtime, editor 등은 모든 앱에 필요한 agent가 아니라 **조건부 skill/profile**로 둔다.

### 5.3 skill frontmatter를 실제로 활용

현재 13개 skill은 `name`, `description` 외의 제어를 거의 쓰지 않는다. 다음을 표준화해야 한다.

- side-effect workflow: `disable-model-invocation: true`
- 입력 안내: `argument-hint`
- context 격리가 유리한 research/review: `context: fork`, `agent`
- 최소 도구: `allowed-tools`, `disallowed-tools`
- 파일 범위: `paths`
- 공통 reference를 agent에 preload: agent frontmatter `skills:`
- 비용·무한 루프 제어: agent `model`, `effort`, `maxTurns`

## 6. skill/agent 자체 테스트 체계

현재 저장소에는 application test뿐 아니라 **harness 자체 test가 없다**. Claude 공식 문서는 skill trigger와 output 품질을 분리해서 baseline 비교하고, fresh session eval을 수행하라고 권장한다. [Claude Skill Evaluation](https://code.claude.com/docs/en/slash-commands#evaluate-and-iterate-on-a-skill)

### 6.1 정적 validator

`scripts/validate-harness.mjs`를 추가해 다음을 CI에서 검사한다.

- YAML frontmatter parse, unique agent/skill name.
- 참조한 agent/skill/reference 파일 존재 여부.
- `/skill-name` 문법 검사와 `$skill-name` 금지.
- output file owner 중복 검사.
- legacy agent가 active orchestrator에서 참조되지 않는지 검사.
- action skill의 `disable-model-invocation` 여부.
- reviewer의 Write/Edit restriction 여부.
- template import와 package dependency closure.
- stack profile별 version compatibility.
- 금지 패턴: `@latest`, 장기 cloud key 예시, unpinned third-party action, localStorage token.

### 6.2 golden scenario

최소 다음 8개를 fresh session에서 평가한다.

1. 작은 사내 CRUD SPA: SSR·전역 store·과도한 lazy loading을 선택하지 않는가.
2. 공개 이커머스: rendering/SEO/payment/security 요구를 먼저 결정하는가.
3. 기존 OpenAPI + 화면 명세: 원본을 수정하지 않고 trace 가능한가.
4. 비어 있지 않은 target: 덮어쓰기 전에 중단하는가.
5. cookie auth: token을 Web Storage에 쓰지 않고 CSRF/refresh failure를 처리하는가.
6. dependency install 거부: 파일만 생성하고 정확한 후속 명령을 남기는가.
7. QA failure: 가장 작은 owner만 retry하고 3회째 hard stop하는가.
8. React library: packed tarball을 ESM consumer와 타입 소비자가 실제 import할 수 있는가.

각 scenario는 파일 존재만 보지 말고 build/test/E2E/security assertion을 가진다.

### 6.3 template smoke CI

PR마다 temporary directory에 대표 profile을 생성하고 다음을 수행한다.

```text
validate config
→ generate fixture
→ install with frozen lockfile
→ typecheck
→ lint
→ unit/component test
→ production build
→ Playwright smoke + axe
→ dependency/action/package security checks
```

## 7. 권장 실행 순서

### 0~2일: 생성 중단 위험 제거

1. project-init의 agent 누락 복사 문제 수정 또는 plugin 전환.
2. `$skill` 표기를 `/skill`로 일괄 변경.
3. API envelope 반환 타입 정리.
4. `zod`, `@hookform/resolvers`, `web-vitals` dependency 누락 해결.
5. ErrorFallback source of truth 통합.
6. QA agent에 도구 제한 적용.

### 1주: 현재 세대와 보안 기준 반영

1. React 19/Vite 8/MUI 7/Router 8/ESLint Flat Config compatibility profile 작성.
2. auth를 BFF/cookie 기본으로 재작성하고 client RBAC 한계 명시.
3. CI에 최소 permissions, SHA pin, OIDC, environment approval 추가.
4. FID를 INP로 교체하고 RUM 계약 작성.
5. WCAG 2.2와 Playwright/axe 품질 게이트 추가.

### 2~4주: 구조 단순화

1. legacy coordinator 5개 archive/remove.
2. 중복 orchestrator 정리.
3. 순차 context handoff가 많은 scaffold/data/release agent 통합.
4. architecture/security/browser/API contract agent 추가.
5. CSR/SSR/library stack profile 분리.

### 1~2개월: harness를 제품처럼 운영

1. plugin으로 버전 배포.
2. static validator와 golden eval 도입.
3. fixture smoke CI 도입.
4. release note와 migration guide 관리.
5. token/time/pass-rate benchmark를 기록하고 agent 수·prompt 길이를 지속 최적화.

## 8. 최종 권고

가장 중요한 개선 방향은 “agent를 더 많이 추가”하는 것이 아니다.

1. **기술 선택을 고정값에서 capability decision으로 전환한다.**
2. **중복 문서 대신 실행 가능한 generator/schema를 source of truth로 둔다.**
3. **프롬프트 제약을 tool restriction과 hook으로 강제한다.**
4. **grep QA를 실브라우저·접근성·보안·계약·성능 gate로 교체한다.**
5. **skills와 agents를 plugin으로 함께 배포하고 eval로 회귀를 막는다.**

이 다섯 가지를 완료하면 현재 구조의 장점인 단계 분리, 산출물 추적, owner retry 정책을 유지하면서도 시니어 웹 엔지니어가 팀 표준으로 사용할 수 있는 수준에 가까워진다.

## 9. 감사 한계

- 현재 저장소에는 `.claude` 구성 외 실제 생성 앱, package manager lockfile, CI, README가 없다.
- `.claude` 파일은 현재 git에서 모두 untracked이며 이 checkout에는 비교할 git history가 없다.
- 따라서 이번 평가는 모든 46개 agent, 13개 skill, 17개 reference의 정적 계약 분석과 공식 1차 자료 대조에 기반한다.
- 실제 end-to-end 생성 성공률은 위의 fixture smoke/eval 체계를 추가한 뒤 별도로 측정해야 한다.
