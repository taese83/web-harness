# Analytics-BI 빌더 역량 로드맵 (web-harness)

## 목적

harness가 **semantic 분석/대시보드 빌더 부류(analytics-BI)**의 웹 프런트엔드를 생성할 수 있도록
기존 역량(`analytics-chart-builder` 스킬, `ANALYTICS_BUILDER_MODE`, `react-vite-spa` 프로파일,
`auth-setup`, `web-observability-builder`)을 **계약·companion 플래그·capability·eval fixture**로 심화한다.

이 문서는 특정 서비스가 아니라 **부류 역량**을 대상으로 한다. 어떤 사내 BI 서비스(참조 사례)는
검증용 **eval fixture 하나**로만 등장하며, 계약 본문에는 그 서비스의 이름·백엔드·고유 수치가 들어가지 않는다.

## 일반화 원칙 (통과 기준)

모든 계약·스킬 변경은 아래를 만족해야 한다.

1. **특정 서비스 이름·백엔드 가정·고정 수치 금지.** 실행 엔진(Trino/Druid 등), 헤더 이름, 차트 개수,
   상태 라이브러리는 계약에 박지 않고 **config/adapter/플러그러블 제약**으로 표현한다.
2. **참조 서비스는 eval fixture로만.** `evals/web-core-fixtures/projects/*`의 fixture 1개로 회귀만 지킨다.
3. **2+ 서비스 테스트.** "이 부류의 서로 다른 서비스 최소 2개가 같은 계약으로 생성 가능한가"를
   설계 검토 기준으로 삼는다. 아니면 아직 과고정으로 본다.
4. **중립 명칭.** async query hash+poll / tenant-header 주입 / 재귀 중첩 레이아웃 /
   외부 게이트웨이 쿠키 SSO / analytics-event SDK / linked-filter 전파 — 서비스 고유어 대신 부류 용어.

## 범위 밖 (불변)

- 데이터 실행 백엔드(semantic 쿼리 엔진, 대규모 집계 서비스)는 harness가 생성하지 않는다.
  **HTTP 계약만 소비**하고, 개발·QA는 MSW mock + `api-contract-typegen` drift 검사로 대체한다.

## Baseline (현 커버리지)

형태(Vite SPA + 외부 API)·semantic 쿼리 골격·flat 대시보드·AI insight·QA 게이트는 이미 커버.
아래 트랙이 나머지 gap이며 전부 부류 역량으로 일반화한다.

## 트랙 (일반화)

| 트랙 | 우선 | 산출(공용 파일) | 계약 핵심(중립) |
|---|---|---|---|
| A. semantic 심화 | P0 | `analytics-chart-builder/references/semantic-query-contract.md` 확장 + 신설 `segment-filter-contract.md`·`metric-set-contract.md` | dimension 변환(bucket/lookup/dim-topN)·per-metric where·재사용 subquery/segment 필터(**플러그러블 실행-타깃 제약**)·런타임 measure 스왑 |
| B. 차트 엔진/레지스트리 | P0 | 신설 `chart-engine-adapter.md`·`chart-render-contract.md`, `chart-compatibility.md` 확장, `lib-advisor` 정책 | **엔진-무관 renderer 경계** + **개방형(N종) registry** + 엔진 선택 inform-and-choose |
| C. 대시보드 심화 | P1 | `dashboard-editor-contract.md` 확장 or `nested-layout-contract.md`, 신설 `filter-propagation-contract.md` | 재귀 중첩 레이아웃·linked-filter 전파(uuid 보존 불변식)·런타임 컨트롤·쿼리 동시성 제한 |
| D. async 쿼리 lifecycle | P1 | 신설 `async-query-contract.md` | build→hash→poll(status)→pre-shaped result·취소·부분결과·백오프 |
| E. 엔터프라이즈 SSO | P1 | `auth-setup/references/auth-patterns.md` 확장 + companion `EXTERNAL_COOKIE_SSO_MODE` | 외부 게이트웨이 세션 쿠키 + 401→IdP 전체페이지 리다이렉트(프로젝트 auth 서버 미소유) |
| F. 테넌시·임베드 | P1/P2 | 신설 `tenant-scoping-contract.md`·`embed-share-contract.md` + companion `MULTITENANT_SPA_MODE`·`EMBED_SHARE_MODE` | tenant-header 주입 + query-key 격리 + 크로스테넌트 음성 테스트 / 익명 토큰 스코프 읽기전용 공유 |
| G. 상태 유연성·브라운필드 | P2 | `tech-advisor.md`·`minimal-change-contract.md` 확장 | greenfield=Zustand 유지, **브라운필드는 감지된 상태 라이브러리 존중** + 대규모 코드베이스 채택 경로 |
| H. 벤더 SDK 계측 | P2/P3 | `web-observability-builder.md` 확장 | analytics-event 계측(트래킹 SDK) 일반 계약 (에러추적은 기존) |

## 로드맵

- **P0 — 차트 MVP**: A(dimension 변환) · B(엔진 어댑터+registry) · D(async lifecycle)
  → 외부 API+mock 위에서 metric/dimension 선택 → N종 차트 렌더 SPA.
- **P1 — 대시보드·엔터프라이즈**: C · A(segment/metric-set) · E · F1(tenant)
  → 다중 차트 대시보드 + 재사용 필터 + 멀티테넌트 + 엔터프라이즈 SSO.
- **P2 — 공유·유지보수**: F2(embed) · G · H.

각 트랙 acceptance: **신규 eval fixture + validator + verifier 게이트** 통과(문서만으로는 불인정).

## 의사결정 기록

- **차트 엔진** = **inform-and-choose**(결정 완료). 기본은 무료 어댑터(Recharts/ECharts);
  상용 엔진 어댑터(예: Highcharts)는 **라이선스 필요 고지 → 사용자 선택 → decision-log 기록** 후에만 방출.
  참조 서비스가 상용 엔진을 이미 쓰는 경우 자동 감지하되 "라이선스 확인됨"을 decision-log에 명시.
  (상세: `chart-engine-adapter.md`)
- **백엔드** = 범위 밖(계약+mock).
- **상태 라이브러리** = greenfield Zustand, 브라운필드 감지 존중(특정 라이브러리 재현 목표 아님).
- **프로파일** = 신규 프로파일 대신 `react-vite-spa` + capability 조합.

## 이번 증분에 포함

- `docs/analytics-bi-capability-roadmap.md` (본 문서)
- `.claude/skills/analytics-chart-builder/references/chart-engine-adapter.md` (신설)
- `.claude/skills/analytics-chart-builder/references/chart-render-contract.md` (신설)

다음: `chart-compatibility.md`(개방형 registry) 확장, `lib-advisor` 정책·`companion-skill-detection.md`
(엔진 inform-and-choose 플로우) 수정 — 기존 공용 파일 편집이라 별도 확인 후 진행.
