# Solution Design — golden/vite-serverless-hybrid

STAGE: 0 (observational — not a gate)

프로필: `vite-serverless-hybrid` (adapter 1.1.0, supportLevel `certified`, trustTier `builtin`)

## 0. 이 문서의 지위

이 산출물은 게이트가 아니다. 목적은 **이미 존재하고 릴리스 receipt까지 나온 산출물의 구현 설계
결정을 사후에 정확히 기록**하는 것이며, 그 기록이 Stage 1(잠금) → Stage 2a(정합 검사)의 입력이 된다.

그린필드가 아니므로 **실측이 제안을 이긴다**(계약 §3). 아래 결정 중 `proposed`는 하나도 없다 —
전부 실측이거나 확인된 부재다.

## 1. 측정 기반

`source: measured`의 근거가 되는 파일이 다음이 전부다. 여기 없는 것은 measured로 적지 않았다.

| 읽은 파일 | 무엇을 확정했나 |
|---|---|
| `package.json` | `private: true`, `exports`·`main`·`bin` 전부 부재. deps 2 / devDeps 16. `packageManager: pnpm@11.18.0` |
| `vite.config.ts` | 번들러 vite. 개발 전용 `golden-api-middleware`가 `/api/*`를 `api/{route}.ts`의 `default.fetch`로 라우팅 |
| `tsconfig.json` | `strict: true`, `include: ["src","api","dev","tests","e2e","*.ts"]` — **다섯 소스 표면이 여기서 확정된다** |
| `eslint.config.js` | flat config + tseslint + react-hooks |
| `playwright.config.ts` | `testDir: ./e2e`, baseURL `127.0.0.1:4173` |
| `vitest.production.config.ts` | `tests/production-boundary.ts` 전용 별도 러너 |
| `vercel.json` | framework vite, output `dist`, SPA rewrite, 보안 헤더 4종 |
| `src/main.tsx`·`App.tsx` | React 19 `createRoot`. 라우팅은 `useSyncExternalStore` + `history.pushState` 수기 구현 |
| `api/*.ts`·`api/_lib/guard.ts` | Web `Request`/`Response` 표준. `withGuards`가 method·auth·bodySize·schema·rateLimit 5차원 강제 |
| `dev/node-adapter.ts` | Node HTTP ↔ Web 표준 변환. vite 플러그인과 loopback 테스트 **양쪽**이 소비 |
| `_workspace/04_qa/evidence/*.json` | receipt 10종 전부 `status: PASS` |

`src/` 아래에 **하위 디렉토리가 하나도 없다**(`main.tsx`, `App.tsx` 두 파일뿐). 관례의 부재가
아니라 확인된 사실이며, 레이어 맵이 하네스 기본 어휘를 쓰지 않는 이유다.

## 2. Phase 1·2 산출물 실사 — 부재

`_workspace/02_design/` 디렉토리 자체가 없었다. `feature-plan.md`·`tech-stack.md`·`api-schema.md`·
`component-spec.md`·`state-contract.md`·`integration-overlay.json` 전부 부재.

따라서 **`acceptanceSource: "absent"`, `acceptanceRefs: []`**이며 `specTier: "unverifiable"`로 잠긴다.

정확히 적는다:

- 이 설계 결정들은 **검증 대상이 없는 채로 확정된다.** 설계는 기록할 수 있지만 그것이
  *요구사항에 맞는지* 판정할 기준이 이 저장소에 없다.
- **릴리스 receipt가 있는 것과 수용 기준이 있는 것은 다르다.** PASS 10건은 lint·typecheck·unit·
  build·browser·api.guards·api.unit·coverage·audit·production-boundary가 통과했다는 증거이지
  FEAT/TC가 충족됐다는 증거가 아니다. 골든에는 충족될 FEAT/TC가 애초에 없다.
- `e2e/app.spec.ts`의 두 케이스는 사실상 행위 명세지만 `feature-plan`의 수용 기준이 아니다.
  여기서 FEAT/TC로 승격해 적지 않는다 — 수용 기준을 이 문서에서 만드는 것은 계약 §2가 금지한다.
- 골든의 목적이 "어댑터·게이트의 참조 구현"이므로 이 tier는 결함이 아니라 **정확한 상태 기술**이다.

## 3. 산출물 형태

`["web-app", "serverless-functions"]`

**web-app 근거(기계 대조 통과)**: `bin` 없음 → `cli` 주장 불가. `private: true`이고 `exports`·`main`
없음 → `library` 주장 불가(둘 중 어느 쪽이든 정합 검사 FAIL). 소비 방식은 `index.html` →
`src/main.tsx` → `createRoot`이고 `vercel.json`이 `dist`를 정적 배포한다.

요구 검증은 `vite.build`·`vite.browser` + 공통 `quality.lint`·`quality.typecheck`·`quality.unit`.
receipt 별칭을 거치면 5개 모두 존재하고 PASS다.

**serverless-functions와 그 한계(정직 표기)**: 산출물의 절반이 `api/` 표면이다. `project-profile.json`의
`backend.shape`가 `serverless-functions`이고 실행 계획은 `api.guards`·`api.unit`을 `release.assemble`의
필수 선행으로 둔다. 형태 목록에서 빼면 산출물의 절반이 형태 층에서 보이지 않는다.

다만 **`shape-checks.json`에 `serverless-functions` 항목이 없다.** 이 형태는 요구 검증을 하나도
고르지 않고 `unknownShapes`로 보고된다. targetShapes는 합집합이므로 형태를 더하는 것이 검증을
약화시키는 경로는 없다. 적는 이유는 **그 공백을 보이게 만들기 위해서다.** `api/` 표면의 실제 검증은
형태가 아니라 프로필·실행 계획에 결박돼 있으며 Stage 2b가 해소해야 할 미해결 항목이다.

## 4. 고정 기반

| 키 | 값 | source | 근거 |
|---|---|---|---|
| `packageManager` | `pnpm` | measured | `packageManager: "pnpm@11.18.0"` + `pnpm-lock.yaml` |
| `language` | `typescript` | measured | `typescript@6.0.2` + `tsconfig.json` |
| `bundler` | `vite` | measured | `vite@8.1.4` + `vite.config.ts` |
| `testRunner` | `vitest` | measured | `vitest@4.1.0` + 별도 production config |
| `lint` | `eslint` | measured | `eslint@9.39.5` + `eslint.config.js` |
| `e2e` | `playwright` | measured | `@playwright/test@1.62.1` + `playwright.config.ts` |

`formatter`는 **의도적으로 지정하지 않는다.** prettier·biome 어떤 formatter 선언도 설정 파일도
없다(확인함). substrate `source`에는 `measured-absent`가 없어 "확인된 부재"를 표현할 방법이 없고,
없는 것을 `measured`로 적으면 정합 검사가 정당하게 FAIL시킨다. 미지정으로 두면 기본값 `prettier`가
`source: "default"`로 채워진다 — 그 값이 실제로 쓰이지 않는다는 사실이 잠금에 드러나지 않는다는
점을 여기 명시한다. SD-001로 올린다.

Node 버전은 substrate 키가 아니라 프로필 `toolchain.nodeEngine`이 소유하므로 재선언하지 않는다.

## 5. 아키텍처와 레이어 맵

**패턴: `existing`** — 이미 존재하고 인증된 코드의 관례를 그대로 기록한다.

실측된 관례는 **런타임 표면별 분할**이며 표면 안쪽은 평면이다. `src/`는 브라우저에서만, `api/`는
Web 표준 위에서 serverless 런타임으로, `dev/`는 Node HTTP와 Web 표준 사이 어댑터로 동작한다.
이 경계는 관습이 아니라 **기계로 판정된다** — `tests/production-boundary.ts`가 `dist/`를 걸어
다니며 서버 측 마커가 섞였으면 실패시키고, 그 판정이 `vite.production-mock-boundary` receipt다.

FSD·레이어드·도메인 모듈 중 어느 것도 적용돼 있지 **않다**. `src/`에 하위 디렉토리가 없으므로
도메인 레이어링이라 부를 구조가 존재하지 않는다. 없는 관례를 지어내 적지 않는다(계약 §3).

| 논리 레이어 | 경로 | 내용 |
|---|---|---|
| `spa-ui` | `src` | 부트스트랩 + 라우팅 셸. 브라우저 전용 |
| `api-routes` | `api` | `health.ts`(GET/public), `notes.ts`(POST/bearer), `_lib/guard.ts` |
| `runtime-adapter` | `dev` | Node HTTP ↔ Web 표준 변환 |
| `unit-tests` | `tests` | 단위 4종 + production boundary |
| `e2e-tests` | `e2e` | 라이브 SPA+API 통합, axe 접근성 |

레이어 이름은 하네스 기본 어휘가 아니라 이 프로젝트의 실제 구조에서 나왔다. 경로 어휘도 그대로
쓴다 — `tsconfig.json`의 `include`가 정확히 이 다섯을 열거하므로 소스 표면의 정본은 이미
저장소 안에 있다.

**표현할 수 없는 것(정직 표기)**: `api/_lib/`는 `api/`의 하위이므로 별도 레이어로 올리면 두
레이어가 겹친다. 계약 §7은 겹치는 레이어 맵을 신뢰하지 않는다. 그래서 carve-out은 레이어 맵이
아니라 모듈 경계에만 기록된다 — **평면 layerMap이 carve-out을 표현할 수 없다는 §7 등록 항목의
실사용 재현이다.** SD-003으로 올린다.

## 6. 라이브러리 결정

`measured`는 의존성 선언에 실제로 있는 것, `measured-absent`는 **찾아보고 없음을 확인한 것**이다.
`proposed`는 하나도 없다.

| 역할 | 선택 | source | 근거 |
|---|---|---|---|
| UI 런타임 | `react` 19.2.7 | measured | dependencies |
| DOM 렌더러 | `react-dom` 19.2.7 | measured | dependencies |
| 빌드 통합 | `@vitejs/plugin-react` | measured | devDependencies |
| 라우팅 | none | measured-absent | react-router·wouter·tanstack 부재. `useSyncExternalStore` + `history.pushState` 직접 구현 |
| 상태 관리 | none | measured-absent | zustand·redux·jotai 부재. React 내장만 |
| 데이터 계층 | none | measured-absent | tanstack-query·swr·axios 부재. 네이티브 `fetch` |
| 폼 | none | measured-absent | 폼 자체가 없다 |
| 스키마 검증 | none | measured-absent | zod·valibot 부재. `noteSchema`가 수기 판별 유니온 |
| 요청 가드 | none | measured-absent | express·hono 부재. `withGuards`가 in-repo, 외부 의존성 0 |
| mock | none | measured-absent | msw 부재이며 **부재가 강제된다** — production-boundary의 금지 마커에 msw 계열이 포함돼 있다. 테스트는 mock 대신 실제 핸들러를 loopback HTTP로 통과시킨다 |
| 스타일링 | none | measured-absent | `.css`·`.scss` 파일이 하나도 없다. 시맨틱 HTML만으로 axe 통과 |
| 커버리지 | `@vitest/coverage-v8` | measured | devDependencies |
| 접근성 스캔 | `@axe-core/playwright` | measured | devDependencies. violation 0 단언 — I6의 실행 경로 |

부재 12건 중 9건이 `none`이라는 사실 자체가 이 골든의 설계다: **외부 의존성을 최소화해 어댑터·
게이트가 프레임워크 특이성 없이 검증되게 한다.**

## 7. 통신과 동시성

**communication: `["rest"]`** — JSON over HTTP. 오류는 `{error:{code, fields?}}`로 405/401/413/
400/429/503를 상황별로 낸다. graphql·websocket·sse·streaming 부재를 확인함.

**concurrency: `[]`** — `new Worker` 호출이 없고 service worker 등록이 없다. production-boundary가
`mockServiceWorker` 마커를 금지해 SW 계열의 우발적 유입까지 막는다.

## 8. 모듈 경계

| 범위 | 근거 |
|---|---|
| `src/**` | 브라우저 번들 전용. `api/**`·`dev/**` import는 `dist/`에 서버 마커로 나타나 게이트가 잡는다 |
| `api/*.ts` | 라우트 하나당 파일 하나. 라우트끼리 import 하지 않는다 |
| `api/_lib/**` | 공유 가드. 변경이 전 라우트에 파급되므로 라우트 작업과 **반드시 분리**한다 |
| `dev/**` | 소비자가 둘(vite 미들웨어·loopback 테스트). 시그니처 변경이 양쪽에 동시 파급 |
| `tests/**` | production-boundary는 별도 러너로 돌고 기본 러너에서 제외된다 |
| `e2e/**` | Playwright가 라이브 서버를 띄우므로 자원 모델이 다르다 |

**경계 불변식**(검증 가능한 명제):

1. `dist/`의 어떤 산출 파일도 서버 측 마커를 포함하지 않는다 — production-boundary 판정
2. `api/` 아래 모든 `.ts`가 가드 매트릭스에 등록돼 있다 — `api.guards.test.ts`가 `readdirSync`와
   등록 목록의 일치를 단언하므로 미등록 엔드포인트 추가는 실패한다
3. 모든 엔드포인트가 `withGuards`를 통과한 `default {fetch}`를 export 한다
4. `bearer` 라우트는 `GOLDEN_API_TOKEN` 미설정 시 503을 낸다 — **설정 부재가 인증 우회로
   fail-open 되지 않는다**

## 9. 비목표

영속 저장소 · 사용자 인증/세션 · SSR/SSG · 디자인 시스템 · i18n · 다중 배포 provider ·
분산 rate limit. 근거는 아래 기계 판독 블록에 있다.

## 10. 미결정

전부 `assumed`로 확정한다. 셋 다 **하네스 스키마의 표현력 한계**에 관한 것이지 이 프로젝트의
코드 선택이 아니다.

**SD-001 — substrate `formatter`**: 없는 것을 measured로 적을 수 없고, `measured-absent`가
substrate에 없다. → 미지정(기본값이 `default`로 채워짐). **substrate에도 `measured-absent`가
필요하다는 것이 이 실사용의 발견이다.**

**SD-002 — `serverless-functions` 포함 여부**: 포함하면 `unknownShapes` 보고, 빼면 산출물 절반이
형태 층에서 사라진다. → 포함한다. 합집합이므로 게이트를 약화시키지 않고 공백을 보이게 만든다.

**SD-003 — `api/_lib/` carve-out**: layerMap에 넣으면 겹침으로 계약 §7 위반. → `moduleBoundaries`에만
기록한다. 결과적으로 이 경계가 **소유권 공급 경로에 반영되지 않는다** — §7 등록 한계의 재현이다.

```json web-harness:solution-design
{
  "stage": 0,
  "targetShapes": ["web-app", "serverless-functions"],
  "constitution": {
    "substrate": {
      "packageManager": {"value": "pnpm", "source": "measured"},
      "language": {"value": "typescript", "source": "measured"},
      "bundler": {"value": "vite", "source": "measured"},
      "testRunner": {"value": "vitest", "source": "measured"},
      "lint": {"value": "eslint", "source": "measured"},
      "e2e": {"value": "playwright", "source": "measured"}
    }
  },
  "communication": ["rest"],
  "concurrency": [],
  "architecture": {
    "pattern": "existing",
    "rationale": "이미 존재하고 certified된 코드의 관례를 실측해 기록한다. 관례는 런타임 표면별 분할(src=브라우저, api=Web 표준 핸들러, dev=Node↔Web 어댑터)이며 표면 안쪽은 평면이다. src/에 하위 디렉토리가 하나도 없어 FSD·레이어드로 부를 구조가 존재하지 않으므로 없는 관례를 지어내지 않는다. 표면 경계는 관습이 아니라 tests/production-boundary.ts가 dist/를 검사해 판정하며 그 receipt가 PASS다."
  },
  "layerMap": {
    "spa-ui": "src",
    "api-routes": "api",
    "runtime-adapter": "dev",
    "unit-tests": "tests",
    "e2e-tests": "e2e"
  },
  "libraries": {
    "ui-runtime": {"choice": "react", "alternatives": ["vue", "svelte", "solid"], "source": "measured"},
    "dom-renderer": {"choice": "react-dom", "alternatives": [], "source": "measured"},
    "build-integration": {"choice": "@vitejs/plugin-react", "alternatives": ["@vitejs/plugin-react-swc"], "source": "measured"},
    "routing": {"choice": "none", "alternatives": ["react-router", "wouter", "@tanstack/react-router"], "source": "measured-absent"},
    "state": {"choice": "none", "alternatives": ["zustand", "jotai", "redux-toolkit"], "source": "measured-absent"},
    "data-layer": {"choice": "none", "alternatives": ["@tanstack/react-query", "swr", "axios"], "source": "measured-absent"},
    "form": {"choice": "none", "alternatives": ["react-hook-form", "formik"], "source": "measured-absent"},
    "schema-validation": {"choice": "none", "alternatives": ["zod", "valibot", "yup"], "source": "measured-absent"},
    "request-guard": {"choice": "none", "alternatives": ["hono", "express"], "source": "measured-absent"},
    "mock": {"choice": "none", "alternatives": ["msw"], "source": "measured-absent"},
    "styling": {"choice": "none", "alternatives": ["tailwindcss", "styled-components", "@emotion/react"], "source": "measured-absent"},
    "coverage": {"choice": "@vitest/coverage-v8", "alternatives": ["@vitest/coverage-istanbul"], "source": "measured"},
    "accessibility-scan": {"choice": "@axe-core/playwright", "alternatives": ["axe-playwright"], "source": "measured"}
  },
  "moduleBoundaries": [
    {"scope": "src/**", "rationale": "브라우저 번들 전용. api/**·dev/**를 import 하면 dist/에 서버 마커가 남아 production-boundary가 실패한다"},
    {"scope": "api/*.ts", "rationale": "라우트 하나당 파일 하나. 라우트끼리 import 하지 않고 _lib/guard만 공유하므로 라우트 추가는 이 범위에서 닫힌다"},
    {"scope": "api/_lib/**", "rationale": "모든 라우트가 공유하는 가드. 변경이 전 라우트에 파급되므로 라우트 작업과 분리한다. layerMap이 이 carve-out을 표현하지 못한다(SD-003)"},
    {"scope": "dev/**", "rationale": "소비자가 vite.config.ts 미들웨어와 tests/api.loopback.test.ts 둘이라 시그니처 변경이 양쪽에 동시 파급된다"},
    {"scope": "tests/**", "rationale": "production-boundary.ts는 vitest.production.config.ts 전용 러너로 돌고 기본 러너에서 제외된다"},
    {"scope": "e2e/**", "rationale": "Playwright가 라이브 dev 서버를 띄우므로 단위 러너와 자원 모델이 다르다"}
  ],
  "acceptanceSource": "absent",
  "acceptanceRefs": [],
  "nonGoals": [
    "영속 저장소 — notes는 프로세스 메모리 배열이며 DB·KV·파일 저장은 범위 밖이다",
    "사용자 인증/세션 — bearer는 환경변수 단일 정적 토큰이고 계정·세션·RBAC은 없다",
    "SSR/SSG — 프로필 rendering은 csr 단일이며 vercel.json이 전 경로를 index.html로 rewrite 한다",
    "디자인 시스템·테마 — 스타일시트가 0개이고 시각 디자인은 이 골든의 목적이 아니다",
    "i18n — index.html의 lang이 ko로 고정이고 UI 문자열은 하드코딩이다",
    "다중 배포 provider — availableProviders가 vercel 단일이다",
    "분산 rate limit — guard.ts의 rateBuckets는 프로세스 로컬 Map이라 serverless 다중 인스턴스 간 공유되지 않는다"
  ],
  "openDecisions": [
    {
      "id": "SD-001",
      "question": "이 프로젝트에는 formatter 선언도 설정 파일도 없다. substrate의 formatter 키를 어떻게 적는가 — substrate source에는 measured-absent가 없다",
      "options": [
        "미지정으로 두어 하네스 기본값 prettier가 source:default로 채워지게 한다",
        "declared로 적고 rationale에 부재를 쓴다(값이 기본값과 같아 이탈이 아니므로 의미가 모호해진다)",
        "measured로 prettier를 적는다(선언에 없으므로 정합 검사가 FAIL시킨다 — 채택 불가)"
      ],
      "recommended": "미지정으로 두어 하네스 기본값 prettier가 source:default로 채워지게 한다",
      "status": "assumed"
    },
    {
      "id": "SD-002",
      "question": "targetShapes에 serverless-functions를 포함하는가 — shape-checks.json에 항목이 없어 요구 검증을 하나도 고르지 않고 unknownShapes로 보고된다",
      "options": [
        "web-app + serverless-functions 둘 다 선언해 api/ 표면을 형태 층에 드러내고 공백을 보고받는다",
        "web-app만 선언해 기계 대조를 깨끗하게 유지하고 api/ 표면은 프로필·실행 계획에만 남긴다"
      ],
      "recommended": "web-app + serverless-functions 둘 다 선언해 api/ 표면을 형태 층에 드러내고 공백을 보고받는다",
      "status": "assumed"
    },
    {
      "id": "SD-003",
      "question": "api/_lib/ carve-out을 layerMap에 넣으면 api 레이어와 겹쳐 계약 §7 위반이다. 어디에 기록하는가",
      "options": [
        "layerMap에는 api만 두고 carve-out은 moduleBoundaries에만 기록한다",
        "layerMap에 api-routes=api와 api-shared=api/_lib를 둘 다 넣는다(겹침으로 스팩 신뢰가 깨진다)"
      ],
      "recommended": "layerMap에는 api만 두고 carve-out은 moduleBoundaries에만 기록한다",
      "status": "assumed"
    }
  ]
}
```
