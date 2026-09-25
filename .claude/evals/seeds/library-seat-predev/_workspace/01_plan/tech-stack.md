# Tech Stack — 도서관 열람실 좌석 예약 웹앱

비대화 세션(Phase 1, plan 레인). 미결 항목은 발명하지 않고 ASSUMPTION/NEEDS_DECISION/BLOCKER로 표기한다.
`lib-catalog`는 이 작업 환경에서 발견되지 않아(하네스 경로 접근 시도 결과 `DENY_PATH_OUTSIDE`), skill 내장
"검증된 SPA 호환 프로필"과 일반 공식 문서 지식을 근거로 사용했다. 이 세션에는 WebSearch 도구가 실제로
제공되지 않아 버전을 실시간 재검증하지 못했다 — Package Changes의 exact version은 environment-scaffolder의
lockfile source/integrity 검토 단계에서 최종 확인이 필요하다(원칙 4, 15 근거).

## Modes (requirements.md와 일치 확인)
- LOCAL_DOMAIN_STATE_MODE: false — 일치. 좌석·예약 authoritative store는 도서관 REST API.
- TIMESERIES_MODE: false — 일치. 실시간 시계열/모니터링 요구 없음.
- ANALYTICS_BUILDER_MODE: false — 일치. metric/dimension 분석 빌더 요구 없음.
- EXTERNAL_DATA_INGESTION_MODE: false — 일치. 브라우저가 도서관 API를 요청 시점마다 직접 조회·호출할 뿐 별도
  수집·정규화·승격 파이프라인이 없다.

## Architecture Profile
**`internal-spa`** — 회원번호+비밀번호 인증이 필요하고(Primary users: 도서관 정회원), 검색 노출·공유 URL·SEO
요구가 없으며(관리자·비회원 접근 자체가 범위 밖), 좌석 데이터는 "현재 스냅샷 조회 + 즉시 반영" 성격의 CSR에
적합하다. `static-content`/`static-crawl`은 EXTERNAL_DATA_INGESTION_MODE=false와 모순되어 배제하고,
`public-ssr`은 PUBLIC_EXPOSURE=no와 모순되어 배제한다.

## Harness Profile
- WEB_PROFILE: **`react-vite-spa`** — 근거: (1) PUBLIC_EXPOSURE=no로 SSR/SSG의 검색·공유 URL 이점이 불필요,
  (2) 앱은 좌석·예약·로그인 데이터를 소유하지 않고 도서관 REST API를 호출만 하므로 자체 서버 렌더링/BFF가
  구조적으로 필수는 아니다, (3) Phase 1~2는 Data Review Strategy상 mock(MSW)만 사용하므로 실 네트워크·CORS
  이슈 자체가 발생하지 않아 지금 시점에 이 선택을 막는 증거가 없다.
  **단, 이 선택은 아래 AD-02(인증 토큰·CORS 분기)의 Branch A를 전제로 한 Phase 1~2용 결정이다.** 실 API 연동
  단계(production 연결)에서 Branch B로 판정되면 `next-app-fullstack`(Route Handler를 BFF로 사용)으로 마이그레이션이
  필요하다 — 지금 임의로 그 결론을 내리지 않는다(BLOCKER, requirements.md 참고).
- UI_LANE: **`tailwind-shadcn`** — 판단 축("디자인이 차별점인가?")에서 이 서비스는 브랜드 차별화가 아니라
  기능(고밀도 좌석 그리드, 색+아이콘 이중 신호, 44px 터치 타깃, 모바일 LTE 번들 예산)이 우선이라 커스텀
  프리미티브를 직접 제어할 수 있고 가벼운 tailwind-shadcn을 선택했다.
- REACT_COMPILER: **off** — 기본값 유지. 지금 식별된 핵심 화면에 RHF `watch` 등 non-compiler-safe 패턴이
  있고, max fixture(300석) 성능 이슈가 실측되지 않은 상태에서 빌드 시간 증가를 감수할 근거가 없다. 300석
  fixture에서 100ms 반응 목표(REQ-NFR-001)가 실패하면 재평가 대상(NEEDS_DECISION 아님, 구현 단계 perf 검증
  항목).
- PUBLIC_EXPOSURE: **no** — 로그인 필요, 검색 노출·공유 URL 요구 없음(Primary users가 회원으로 한정). 따라서
  `seo-spec.md`/`qa-seo.md`는 이 서비스에 적용되지 않는다.
- deployment provider: **generic** — requirements.md에 Vercel/Netlify/S3/Railway 등 provider 명시 없음.
- deployment target: **미정** — 작업 지시에 따라 임의 확정하지 않는다. ASSUMPTION: AD-02 Branch A가 확정되면
  `react-vite-spa` 기본값인 `static-cdn`이 유력하고, Branch B가 확정되면 서버 프록시가 필요해
  `node-server` 또는 `container-static`으로 바뀐다. provider 선정도 target 확정과 함께 재검토해야 한다.
- selected capabilities: 클라이언트 라우트 가드(REQ-F-005, FEAT-007), MSW 요청 가로채기(Data Review
  Strategy §mock, Phase 1~2 한정), TanStack Query query/mutation 캐시(REQ-F-002~004). BFF/Route
  Handler/server-side cookie 계열 capability는 **선택하지 않음** — AD-02 Branch B가 확정되기 전에는
  요구사항 ID가 없다(원칙 14).
- exact Node / pnpm / framework versions: Node 22 LTS, pnpm 11, React 19.2, TypeScript 6, Vite 8 (하단
  Compatibility Matrix 참고)
- support level: **compatible** — skill 내장 검증 프로필 기반, 이 세션에서 공식 릴리스 노트 재조회는
  수행하지 못함(네트워크 도구 미제공). environment-scaffolder 단계에서 lockfile 근거로 재확인 필요.
- excluded scope / blocker:
  - BLOCKER(requirements.md 인용): 도서관 API OpenAPI 계약 미확보 — 실 엔드포인트 연동 설계 불가.
  - BLOCKER(requirements.md 인용): 인증 토큰 전달 방식(세션 쿠키 vs Bearer)·CORS 허용 origin 미확정 — AD-02
    분기의 근본 원인이며 harness profile의 Branch A/B 전환을 막는다.
  - BLOCKER(requirements.md 인용): 409 동시성 충돌 응답의 정확한 payload/status 미확정 — mock 가정 기반으로만
    구현 가능.
  - BLOCKER(requirements.md 인용): 노쇼 자동 처리 정책 소유 주체 불명 — "지난 시간" 판정 로직에 영향.

## Compatibility Matrix
| Component | Version | Engine/Peer Constraints | Primary Source | Decision |
|---|---|---|---|---|
| Node.js | 22 LTS | Vite 8 요구 baseline runtime | skill 내장 검증 프로필 | 채택 |
| pnpm | 11 | workspace/lockfile 관리 | skill 내장 검증 프로필 | 채택 |
| React | 19.2.x | react-dom 동일 버전 peer | skill 내장 검증 프로필 | 채택 |
| TypeScript | 6.x | Vite 8 / ESLint 9.39 flat config와 호환 | skill 내장 검증 프로필 | 채택 (TS7 major는 미채택 — CI fixture 통과 전 보류) |
| Vite | 8.x | Node 22+ | skill 내장 검증 프로필 | 채택 |
| React Router | 8.x | React 19 peer | skill 내장 검증 프로필 | 채택 (data router 방식으로 `/login`,`/seats` 라우트 가드 구현) |
| @tanstack/react-query | v5 | React 18+/19 peer | skill 내장 검증 프로필 | 채택 — 좌석 조회/예약/취소 서버 상태 캐시, honest loading 지원(낙관적 갱신 미사용) |
| zustand | v5 | — | skill 내장 검증 프로필 | **제외** — AD-03 근거(공유 상태 복잡도 낮음) |
| axios | 최신 안정 1.x | — | skill 내장 검증 프로필 | 채택 — 인증 헤더 attach·401 인터셉터(FEAT-001)에 필요 |
| react-hook-form | v7 계열 | React 19 peer | skill 내장 검증 프로필 | 채택 — 로그인 폼(REQ-F-001) |
| zod | v4 | — | skill 내장 검증 프로필 | 채택 — 로그인 폼 스키마 검증 |
| @hookform/resolvers | 최신 | react-hook-form+zod 연결 | 공식 문서(로컬 지식) | 채택 |
| tailwindcss | v4 | Vite 8 플러그인 방식 | skill 내장 검증 프로필 | 채택(UI_LANE) |
| @radix-ui/react-dialog | 최신 안정 | React 19 peer | 공식 문서(로컬 지식) | 채택 — 취소 확인 다이얼로그(FEAT-006, focus trap/Esc/포커스 복귀 요구 충족) |
| lucide-react | 최신 안정 | React 19 peer | 공식 문서(로컬 지식) | 채택 — 색+아이콘 이중 신호(REQ-NFR-003) |
| date-fns | v4 | — | skill 내장 검증 프로필 | 채택 — 30분 슬롯/"지난 시간" 계산 |
| Vitest | v4 | Vite 8 통합 | skill 내장 검증 프로필 | 채택 |
| @testing-library/react | 최신 안정 | React 19 peer | skill 내장 검증 프로필 | 채택 |
| msw | v2 | Service Worker 기반 브라우저 모킹 | skill 내장 검증 프로필 | 채택 — Data Review Strategy §mock 전량 구현 |
| Playwright | 1.61 | — | skill 내장 검증 프로필 | 채택 — 키보드 전용 E2E, 모바일 뷰포트 회귀 |
| @axe-core/playwright | 최신 안정 | Playwright peer | skill 내장 검증 프로필("axe") | 채택 — WCAG 2.2 AA 자동 검사 |
| ESLint | 9.39 (Flat Config) | jsx-a11y 등 plugin의 ESLint10 peer 미지원 구간 | skill 내장 검증 프로필 | 채택 |

## Architecture Decisions
| Decision | Requirement | Choice | Rejected Alternative | Trade-off |
|---|---|---|---|---|
| AD-01 렌더링 전략 | Product Frame(인증 필요, SEO 불요) | CSR(`react-vite-spa`) | `next-app-fullstack` SSR | 초기 인증 확인 전 빈 화면 가능성 → FEAT-007 라우트 가드로 완화 |
| AD-02 인증 호출 경로 분기 (결정 미발명, 조건만 기록) | REQ-F-001, REQ-F-005, requirements.md BLOCKER(토큰방식·CORS) | **분기형**: <br>**Branch A** — 도서관 API가 (1)Bearer 토큰 발급 AND (2) 앱 배포 origin을 `Access-Control-Allow-Origin`에 명시 허용 AND (3) `Authorization` 헤더를 `Access-Control-Allow-Headers`에 포함 → 브라우저 직접 호출 유지, `react-vite-spa` + `static-cdn` 그대로. <br>**Branch B** — 세션 쿠키 기반 인증이거나, API가 이 앱 origin에 대한 CORS(특히 credentials 포함 cross-origin cookie: `SameSite=None; Secure` + `Access-Control-Allow-Credentials`)를 허용하지 않거나 허용 자체가 불가 → 브라우저 직접 호출 불가/불안정, 동일 출처 BFF/프록시 필수. `next-app-fullstack`(Route Handler를 서버측 프록시로 사용)으로 harness profile 마이그레이션, 배포 target도 `static-cdn`에서 `node-server`/`container-static`으로 변경. | 지금 Branch A 또는 B를 임의로 확정하는 것 | 계약(OpenAPI, 토큰 방식, CORS 정책)이 BLOCKER로 미확보라 어느 branch인지 지금 알 수 없다. Phase 1~2(mock)와 잠정 계약 개발은 두 branch 모두에서 동일하게 진행 가능하므로 지금은 지연 비용이 없다. production 연결 전 반드시 재방문해야 한다. |
| AD-03 상태 관리 | REQ-F-002~004, FEAT-004(IoC 조합) | TanStack Query(서버 상태) + React Context/useReducer(좌석·슬롯 선택 UI 상태, `/seats` 라우트 내부로 상태 범위 한정) | zustand 전역 스토어 | 상태 트리가 단일 페이지·소수 컴포넌트로 국한되어 전역 스토어의 이점이 적다. FEAT-008/009(defer)가 활성화되며 공유 상태가 커지면 재평가. |
| AD-04 honest loading (낙관적 갱신 금지) | REQ-F-003, REQ-F-004 (ux-brief interaction-controls 원칙 인용) | TanStack Query `mutate` + 성공/실패 후 `invalidateQueries`로 재조회, optimistic update 미사용 | optimistic UI로 즉시 "내 예약" 표시 | 체감 속도는 약간 느리지만 409 동시성 충돌·취소 실패 시 롤백 로직 자체가 필요 없어져 요구사항(TC-005-2, TC-006-3)을 정확히 만족 |
| AD-05 UI 레인 | REQ-NFR-002, REQ-NFR-003, 모바일 LTE 번들 예산(REQ-NFR-001) | `tailwind-shadcn` (Radix 헤드리스 프리미티브 vendored) | `mui`(@mui/material + Emotion) | MUI는 즉시 사용 가능한 컴포넌트가 많지만 커스텀 좌석 그리드 스타일링에 오버헤드가 있고 런타임 CSS-in-JS 비용이 모바일 LTE 목표(NFR-001)에 불리 |
| AD-06 다이얼로그 프리미티브 | REQ-F-004(취소 confirm), REQ-NFR-003(포커스 트랩/복귀) | `@radix-ui/react-dialog` | 직접 구현한 커스텀 모달 | 의존성 1개 추가하지만 focus trap·Esc·바깥클릭 제어(파괴적 확인이라 바깥클릭 비활성)·복귀 포커스를 검증된 구현으로 확보 |
| AD-07 세션 토큰 저장 | requirements.md ASSUMPTION(토큰 저장), 보안 권고 요청 | 메모리(모듈 스코프 상태) 우선 + `sessionStorage` 폴백(새로고침 생존용). **`localStorage` 배제.** AD-02 Branch B가 채택되고 API가 httpOnly 쿠키를 지원하면 그쪽이 더 안전하므로 우선 재검토 대상 | `localStorage`에 토큰 보관 | `localStorage`는 XSS 시 탈취된 토큰이 만료 전까지 탭·세션 경계 없이 재사용 가능해 위험이 크다. `sessionStorage`+메모리는 탭 종료 시 소멸하고, httpOnly 쿠키(Branch B 확정 시)는 JS 접근 자체를 차단해 더 안전 |
| AD-08 max fixture(300석) 렌더링 | REQ-NFR-001(100ms 반응) | 순수 React 렌더(CSS Grid/Flex), 리스트 가상화 라이브러리 선제 도입하지 않음 | `@tanstack/react-virtual` 또는 `react-window` 선제 도입 | 300 DOM 노드는 일반적으로 가상화 임계치보다 작음. perf fixture(300석)에서 100ms 목표 실패가 실측되면 그때 가상화를 추가한다(마케팅 최대치가 아니라 fixture 실측 근거 원칙 준용) |
| AD-09 자동 갱신/폴링 | FEAT-008(Should, defer), NEEDS_DECISION(폴링 부하 허용치 불명) | 지금 `refetchInterval` 등 폴링 설정 미도입 | 즉시 폴링 활성화 | NEEDS_DECISION 해소(도서관 API 부하 허용치 확인) 전까지 Should 범위로 유지, Must 대체 수단은 수동 새로고침 버튼 |
| AD-10 이벤트 전달(session-expired) | FEAT-001→FEAT-007 (401 발생 시 이벤트 발행/구독) | 네이티브 `EventTarget`/`CustomEvent` (추가 라이브러리 없음) | `mitt` 등 이벤트 이미터 라이브러리 | 이벤트 1종·구독자 1곳뿐이라 라이브러리 도입 비용이 이점보다 큼 |
| AD-11 토스트/배너 | ux-brief(인라인 메시지·배너, 토스트 아님) | 커스텀 인라인 배너 컴포넌트(라이브러리 없음) | `sonner`/`react-hot-toast` | 요구사항이 지속형 인라인 안내(예: "좌석 정보를 불러오지 못했습니다")이지 일시적 토스트가 아니어서 전용 라이브러리 불필요 |

## Additional Service-Specific Libraries
| Role | Library | Version | Rationale | Alternative |
|---|---|---|---|---|
| 다이얼로그 프리미티브 | @radix-ui/react-dialog | 최신 안정 | 취소 confirm dialog의 focus trap/Esc/포커스 복귀(FEAT-006, REQ-NFR-003) | Base UI Dialog |
| 아이콘 | lucide-react | 최신 안정 | 색+아이콘 이중 신호(REQ-NFR-003), tree-shakable | @radix-ui/react-icons |
| 날짜/시간 | date-fns | v4 | 30분 슬롯 경계·"지난 시간" 판정 계산 | dayjs |
| Mock 서버 | msw | v2 | Data Review Strategy §mock — normal/empty/loading/error/partial/conflict/세션만료 fixture를 네트워크 계층에서 가로채 구현 | 없음(MSW가 이 팀 표준) |

### Libraries to Avoid
| Library | Reason |
|---|---|
| localStorage 기반 토큰 저장 유틸(예: 직접 `localStorage.setItem(token)`) | AD-07 — XSS 탈취 시 장기 재사용 위험, 탭 간 무기한 공유 |
| optimistic-update 헬퍼(예: 수동 캐시 patch 후 rollback 유틸) | AD-04 — honest loading 요구사항과 상충, 동시성 충돌(409) 처리 로직을 이중화시킴 |
| react-window / @tanstack/react-virtual (지금 시점) | AD-08 — 300석 규모에서 선제 도입 근거 부족, perf fixture 실측 후 조건부 도입 |
| toast 라이브러리(sonner, react-hot-toast 등) | AD-11 — 요구사항은 지속형 인라인 배너이지 토스트가 아님 |
| mitt 등 범용 이벤트 라이브러리 | AD-10 — 단일 이벤트/단일 구독자 구조에 과함 |
| Express 등 커스텀 Node 서버(harness profile 밖) | 원칙 3 — Pages-only/mixed Router, custom server는 현재 Next compatible 범위 밖. AD-02 Branch B가 필요하면 `next-app-fullstack` Route Handler로 흡수하고 별도 커스텀 서버를 만들지 않는다 |

## Package Changes
| Package | Exact Version | Scope | Requirement | Source |
|---|---:|---|---|---|
| react | 19.2.0 | dependency | Product Frame(CSR SPA) | skill 내장 검증 프로필 |
| react-dom | 19.2.0 | dependency | 위와 동일 | skill 내장 검증 프로필 |
| typescript | 6.0.0 | devDependency | 빌드/타입 안전성 | skill 내장 검증 프로필 |
| vite | 8.0.0 | devDependency | 빌드 도구 | skill 내장 검증 프로필 |
| react-router | 8.0.0 | dependency | `/login`,`/seats` 라우팅·가드(REQ-F-005) | skill 내장 검증 프로필 |
| @tanstack/react-query | 5.90.2 | dependency | 서버 상태 캐시(REQ-F-002~004) | skill 내장 검증 프로필 |
| axios | 1.7.9 | dependency | API 클라이언트·401 인터셉터(FEAT-001) | skill 내장 검증 프로필 |
| react-hook-form | 7.63.0 | dependency | 로그인 폼(REQ-F-001) | skill 내장 검증 프로필 |
| zod | 4.0.0 | dependency | 로그인 폼 스키마 검증 | skill 내장 검증 프로필 |
| @hookform/resolvers | 3.10.0 | dependency | react-hook-form+zod 연결 | 공식 문서(로컬 지식) |
| tailwindcss | 4.0.0 | devDependency | UI_LANE(tailwind-shadcn) | skill 내장 검증 프로필 |
| @radix-ui/react-dialog | 1.1.4 | dependency | 취소 확인 다이얼로그(AD-06) | 공식 문서(로컬 지식) |
| lucide-react | 0.470.0 | dependency | 아이콘(REQ-NFR-003) | 공식 문서(로컬 지식) |
| date-fns | 4.1.0 | dependency | 슬롯/시간 계산 | skill 내장 검증 프로필 |
| vitest | 4.0.0 | devDependency | 단위/통합 테스트 | skill 내장 검증 프로필 |
| @testing-library/react | 16.1.0 | devDependency | 컴포넌트 테스트 | skill 내장 검증 프로필 |
| msw | 2.7.0 | devDependency | mock fixture(normal/empty/loading/error/partial/conflict/세션만료) | skill 내장 검증 프로필 |
| @playwright/test | 1.61.0 | devDependency | 키보드 전용 E2E, 모바일 뷰포트 | skill 내장 검증 프로필 |
| @axe-core/playwright | 4.10.1 | devDependency | WCAG 2.2 AA 자동 검사(REQ-NFR-003) | skill 내장 검증 프로필("axe") |
| eslint | 9.39.0 | devDependency | Flat Config lint | skill 내장 검증 프로필 |

이 exact version 목록은 tech-advisor의 목표 선언이며, 직접 `pnpm add/install`을 실행하지 않는다.

- 실행: environment-scaffolder 반영 → typed `lockfile` operation → lockfile source/integrity 검토(이 세션에서
  네트워크 재검증을 못 했으므로 registry 존재·정확한 published version을 이 단계에서 반드시 재확인) → typed
  frozen `install`

### Required Environment Configuration
- `.env.dev`
  - `VITE_ENABLE_MSW=true` — Phase 1~2는 MSW로 모든 API를 가로채므로 실 API base URL이 없어도 동작
  - `VITE_LIBRARY_API_BASE_URL=` (미정 — AD-02 BLOCKER 해소 후 채움)
  - `VITE_AUTH_TOKEN_MODE=` (미정 — `cookie` | `bearer`, AD-02 BLOCKER 해소 후 채움)
- `.env.staging`
  - `VITE_ENABLE_MSW=false`(계약 확보·AD-02 확정 후에만 전환) — 그 전까지는 staging도 `true` 유지
  - `VITE_LIBRARY_API_BASE_URL=` (미정)
  - `VITE_AUTH_TOKEN_MODE=` (미정)
- `.env.production`
  - `VITE_ENABLE_MSW=false`
  - `VITE_LIBRARY_API_BASE_URL=` (미정 — BLOCKER)
  - `VITE_AUTH_TOKEN_MODE=` (미정 — BLOCKER)
- 주의: Vite의 `VITE_*` 변수는 클라이언트 번들에 그대로 노출된다. 도서관 API의 secret(예: 서버 간 API key)이
  생긴다면 그것은 `VITE_*`로 두지 않고 AD-02 Branch B(BFF/프록시)의 서버측 전용 env로만 보관해야 한다 — 지금은
  해당 secret 존재 여부 자체가 불명(BLOCKER).
