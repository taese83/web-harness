# Companion Skill Detection

`web-orchestrator`가 감지해 Phase 3에 조합하는 보조 skill의 단일 판별 기준.

각 flag는 감지 결과이며 skill 실행을 강제한다. flag가 잘못 감지되면 실행 전 사용자 확인 단계에서 재판별.

## 감지 대상

### HYBRID_SERVERLESS_MODE — built-in profile `vite-serverless-hybrid`로 라우팅

**신호 (기존 프로젝트)**:
- 루트 `api/` 폴더에 `*.ts` handler default export (built-in adapter의 감지 마커)
- `package.json`에 `@vercel/node`, `@neondatabase/serverless` 등 serverless dependency
- `vite.config.ts`에 `configureServer` API 미들웨어
- `vercel.json`이 존재하지만 Next.js가 아님 (React/Vite)

**신호 (신규 프로젝트)**:
- intake에서 "SPA + 인증/DB/서버 로직" + "Next.js는 오버킬" 응답
- `AUTH_MODE`나 `SERVER_DB_MODE`가 활성이지만 서버 로직이 endpoint 5~30개의 얇은 규모

**제외**:
- 순수 SPA (모든 데이터가 외부 API에서 옴) → `react-vite-spa`
- `next-app-fullstack` (Next가 이미 서버 커버), SSR/SEO 핵심 요구
- 실시간·장기 실행 job — 전용 backend 영역으로 안내하고 이 profile로 수용하지 않는다

**처리 (감지 시)**:
- profile resolver를 `--requested vite-serverless-hybrid`로 실행해 built-in profile을 잠근다. 루트 `api/`가 이미 있으면 auto 감지로도 잠긴다 (`react-vite-spa`는 루트 `api/`를 forbidden marker로 배제).
- 구현 계약은 `/vite-serverless-hybrid` skill을 따른다 — **§7 엔드포인트 공통 가드 5종**(method allowlist·인증·body 캡·스키마 검증·rate limit)이 handler 구현보다 앞선다. release 시 profile DAG의 `api.guards`(security)·`api.unit` machine receipt가 이를 강제한다.
- `SERVER_DB_MODE`·`OAUTH_SERVER_MODE`·`API_CONTRACT_MODE`가 이 profile 위에서 자연스럽게 조합된다.
- supportLevel은 `compatible`이다 — 체크인된 golden/host diagnostics가 있어도 실제 provider 배포·격리 CI·외부 attestation 전에는 certified evidence가 아니다. workspace/monorepo의 `client/api/`, `apps/*/api/` 배치는 아직 adapter 감지 밖이므로 app root 단일 배치로 정규화하거나 `NEEDS_DECISION`으로 확인한다.

### SERVER_DB_MODE — `server-db-migration`

**신호**:
- `package.json`에 `pg`, `@neondatabase/serverless`, `mysql2`, `better-sqlite3`, `postgres`, `drizzle-orm`, `prisma` 중 하나
- `migrations/` 또는 `*/migrations/` 폴더에 `.sql` 파일
- `DATABASE_URL`, `POSTGRES_URL`, `DIRECT_URL` 등 env 이름이 `.env.example`에 존재

**신호 (신규 프로젝트)**:
- intake에서 "사용자 데이터·기록 저장 필요" + provider 힌트

**제외**:
- Prisma/Drizzle의 자체 migration tool을 이미 사용 중 (그 도구의 흐름 유지, 이 skill의 idempotency/DSN 분리 원칙만 참고)
- 순수 read-only 프로젝트 (DB 없음)

**Phase 3 삽입 지점**:
- 1단계 이후, 서버 handler 구현 전
- Migration 파일 세트와 러너 script 준비
- 실제 SQL 실행은 사용자 승인 후

### API_CONTRACT_MODE — `api-contract-typegen`

**신호**:
- `openapi.yaml`, `openapi.json`, `swagger.json`, `api-spec.yaml`이 프로젝트 어디든 존재
- `src/shared/schemas/`에 Zod schema 파일이 3개 이상
- client fetch call site에 `as Type` 캐스팅이 만연 (grep으로 5회 이상)
- server handler와 client가 서로 다른 type 파일 참조

**신호 (신규 프로젝트)**:
- intake에서 "API와 프론트가 분리 개발" 또는 "여러 클라이언트 지원"
- OpenAPI 문서 제공됨

**제외**:
- endpoint 5개 이하의 작은 프로젝트에서 굳이 도입할 이유 없음 (over-engineering 방지)
- 이미 tRPC 등 end-to-end typed 솔루션 사용 중

**Phase 3 삽입 지점**:
- shared-foundation-builder 이후, entity-query-builder 이전
- Schema 정의가 있어야 entity/feature builder가 참조 가능

### MOCK_SERVICE_MODE — `mock-service-setup`

**신호**:
- `msw` package.json에 이미 존재하지만 handler가 확장 필요
- Storybook 사용 중 + 데이터 있는 컴포넌트
- 프론트가 백엔드 완성 전에 개발 중

**신호 (신규 프로젝트)**:
- intake에서 "API 개발과 프론트 개발 분리" 또는 "offline/CI 재현성" 요구

**제외**:
- 이미 real API에 붙어서 개발 중이고 오프라인/CI 재현 요구 없음
- `mock-api-builder` agent가 이미 기본 MSW 셋업을 완료했으면 이 skill은 handler 확장 전용

**Phase 3 삽입 지점**:
- `mock-api-builder` agent와 겹치지 않게: agent가 초기 셋업, skill이 확장·organize
- API contract가 있으면 그 뒤에 실행 (schema 참조)

### OAUTH_SERVER_MODE — `auth-setup` (references/oauth-server-flow)

**신호**:
- intake에서 "Google/GitHub/Kakao로 로그인" + 서버가 code exchange 수행
- `AUTH_MODE`가 활성이고 BFF cookie session 선택
- `_lib/oauth.ts` 또는 `api/auth/*/{start,callback}.ts` 파일 존재

**제외**:
- OIDC PKCE (client-only) 선택
- 이미 auth0/Clerk/Supabase Auth 등 SaaS 사용

**Phase 3 삽입 지점**:
- SERVER_DB_MODE 이후 (user upsert 필요)
- feature-mutation-builder 이전 (protected endpoint가 auth를 요구)

### I18N_MODE — `i18n-setup`

**신호**:
- intake에서 다국어·2개 이상 표시 언어·글로벌 사용자 요구
- 기존 `src/shared/lang/`에 실제 locale catalog(JSON)가 있거나 `i18next`/`react-i18next`/`next-intl`/`react-intl` dependency
- locale URL prefix(`/ko/…`, `/en/…`) 라우팅 흔적 또는 hreflang 요구

**제외**:
- 단일 언어 고정 서비스 (하드코딩 문자열이 정당)
- 안내문 한두 개만 바꾸는 단순 언어 토글

**Phase 3 삽입 지점**: `shared-foundation-builder` 이후(빈 `src/shared/lang/` 생성 뒤), `component-builder` 이전(UI가 catalog key를 사용해야 함). `/i18n-setup`을 실행하고 파일 작성은 `i18n-builder`가 담당한다.

### OBSERVABILITY_MODE — `web-observability-builder`

**신호**:
- intake에서 에러 추적·모니터링·RUM·알림 요구
- production 운영 대상 서비스 + release/버전 태깅 요구
- 기존 `@sentry/*` 계열 dependency 또는 `src/shared/observability/`

**제외**:
- AI runtime trace만 필요한 경우 (`ai-observability-builder` 소유)
- 학습용·일회성 데모

**Phase 3 삽입 지점**: 데이터 계층 완료 후, `deploy-ci-writer` 이전 (source map 업로드 계약을 workflow 작성 전에 전달해야 함). skill이 아니라 `web-observability-builder` agent를 직접 실행한다.

## 감지 결과 표시

기존 mode block 뒤에 이어서 표시:

```
🔧 감지된 companion skill:
  HYBRID_SERVERLESS_MODE: true/false  (근거)
  SERVER_DB_MODE:         true/false  (근거)
  API_CONTRACT_MODE:      true/false  (근거)
  MOCK_SERVICE_MODE:      true/false  (근거)
  OAUTH_SERVER_MODE:      true/false  (근거)
  I18N_MODE:              true/false  (근거)
  OBSERVABILITY_MODE:     true/false  (근거)

→ 잘못 감지된 항목이 있으면 알려주세요.
```

사용자 확인 후 Phase 3에 각 skill을 삽입.

## Skill 간 순서

지원되는 Phase 3 companion 실행 순서:

1. `HYBRID_SERVERLESS_MODE`이면 profile을 `vite-serverless-hybrid`로 잠그고 `/vite-serverless-hybrid`의 §7 가드 계약을 로드
2. `SERVER_DB_MODE` — DB migration 파일 세트
3. `API_CONTRACT_MODE` — shared request/response schema
4. `OAUTH_SERVER_MODE` — auth 흐름과 보호 handler
5. `MOCK_SERVICE_MODE` — 확정된 schema 기반 mock 확장
6. `I18N_MODE` — i18n spec·catalog·lang 모듈 (UI 구현 전)
7. Client route/entity/feature 구현
8. `OBSERVABILITY_MODE` — 에러 추적·RUM 초기화와 source map 계약 (deploy CI 작성 전)

## 감지 실패 시 fallback

감지가 애매하거나 상충하면 flag를 `false`로 두고 intake에서 사용자에게 확인. companion skill을 잘못 활성화하는 것보다 사용자에게 물어보는 편이 안전.

## 감지 기록

각 flag의 감지 근거를 `_workspace/01_plan/companion-skills.md`에 한 줄씩:
```
HYBRID_SERVERLESS_MODE: true — client/api/*.ts handler 12개 발견, @vercel/node dep 존재
SERVER_DB_MODE: true — @neondatabase/serverless dep + migrations/*.sql 4개
API_CONTRACT_MODE: false — endpoint 8개, schema 파일 없음, drift 신호 부재
MOCK_SERVICE_MODE: false — msw dep 없음, real API로 개발 중
OAUTH_SERVER_MODE: true — api/auth/google/{start,callback}.ts 감지
I18N_MODE: true — ko/en 표시 언어 요구, src/shared/lang/ko/common.json 존재
OBSERVABILITY_MODE: false — 사내 데모, 에러 추적 요구 없음
```

이 파일이 Phase 3 실행 순서 결정에 참조됨.
