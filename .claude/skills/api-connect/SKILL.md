---
name: api-connect
description: [내부] Phase 3 스팩이 고른다. 사용자 진입점은 /wh 하나다. Connects a completed web-harness project to real REST and, when present, WebSocket/SSE endpoints. Replaces Mock adapters, updates environment variables, verifies snapshot/stream contracts, and writes migration guidance. Use after /web-orchestrator completes.
argument-hint: "[API specification or endpoint]"
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Write, Edit, Bash, AskUserQuestion
metadata:
  version: 1.0.0
  maturity: eval-covered
  updated: 2026-07-27
  changelog: 최초 버저닝 — adapter 재생성·검증 체계 도입과 함께 일괄 부여.
---

# API Connect

Mock API를 실제 API 엔드포인트로 교체한다. `/web-orchestrator`로 완성된 프로젝트에서 사용한다.

Read `.claude/skills/web-orchestrator/references/minimal-change-contract.md` before the first source edit. 연동 대상 adapter와 integration path만 `ALLOWED_PATHS`로 두고 unrelated API client rewrite를 하지 않는다.

OpenAPI가 입력되거나 발견되면 `references/openapi-adoption-contract.md`를 읽는다. 현재 기능 endpoint만 선택하고 전체 spec 생성·기존 client 일괄 교체를 금지한다.

## Start

`/api-connect`를 호출하면:

> 어떤 API를 연동할까요? 엔드포인트 URL과 연동할 기능을 알려주세요.

## Workflow

먼저 Mock/real adapter의 현재 contract와 실제 diff를 확인하고 `_workspace/03_dev/change-scope.md`에 보존할 schema, cancellation, auth, fallback, `NON_GOALS`, 예상 변경 파일을 기록한다.

1. `_workspace/02_design/api-schema.md`를 읽어 현재 Mock 스키마를 파악한다
2. 사용자가 제공한 실제 API 스펙과 비교한다
   - OpenAPI면 operation 후보를 추출해 필요한 endpoint만 선택한다
   - 선택 결과는 `_workspace/02_design/openapi-selection.md`에 기록한다
3. 다음 중 선택:
   - **전체 연동**: 모든 Mock을 실제 API로 교체
   - **부분 연동**: 특정 엔드포인트만 교체
4. `.env.dev`의 `VITE_API_URL` 업데이트
5. 해당 entity의 `api/queries.ts`와 `api/mutations.ts`에서 URL 확인
6. real mode에서는 MSW 핸들러를 `bypass`한다. Mock mode 유지가 요구되면 삭제하지 않고 선택 endpoint의 동일 request/response/error contract로 갱신한다
7. 실제 API 호출 테스트
8. `_workspace/02_design/timeseries-architecture.md`가 있으면 `.claude/skills/timeseries-dashboard/references/mock-and-migration.md`를 읽고 snapshot과 realtime transport를 함께 전환한다
9. `runtime-data-contract.json`이 있거나 static snapshot에서 live API로 전환하면 `external-data-ingestion.md`를 읽는다. `ingestion-contract-designer`가 current mode, authoritative source, source precedence, freshness/fallback, build/deployment 계약을 먼저 갱신한다
10. 응답은 `unknown`에서 runtime schema로 parse하고 query cancellation `AbortSignal`을 실제 client까지 전달한다
11. 변경 후 `developer`가 success/empty/malformed/timeout/auth/schema drift fixture를 보강하고 사용자 승인 후 `node .claude/scripts/run-quality-gates.mjs --all --allow-host-execution`을 실행한다
12. `api-contract-verifier`와 조건부 `data-quality-verifier`는 read-only로 판정한다. source 변경 뒤 기존 receipt/manifest를 재사용하지 않고 release 전 `/web-verify`를 실행한다
13. 기존 generator가 없을 때만 orval/openapi-typescript/manual-types 중 하나를 제안한다. generator 도입과 dependency 변경은 사용자 확인 후 진행한다.

실제 API 인증 정보, prod API, 데이터 변경이 필요한 요청은 실행 전에 확인한다. 읽기 전용 dev API 확인은 사용자가 제공한 엔드포인트와 인증 방식이 명확할 때만 진행한다.

## 인증 처리

실제 API에 인증이 필요하면 `/auth-setup`의 저장 전략을 먼저 확정한다. 프로덕션 서비스는 `HttpOnly cookie + CSRF` 또는 OIDC Authorization Code + PKCE를 기본으로 한다. 브라우저 저장소에는 access token과 refresh token을 저장하지 않는다.

OIDC PKCE Bearer 방식을 선택한 경우 access token은 검증된 OIDC SDK의 메모리 저장소에서만 읽는다:
```ts
// src/shared/api/api.ts에 interceptor 추가
axiosInstance.interceptors.request.use(config => {
  const token = authClient.getAccessToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})
```

cookie 방식을 선택한 경우:
- Axios 인스턴스에 `withCredentials: true`를 설정한다
- 상태 변경 요청에 CSRF 헤더를 붙인다
- access/refresh token은 브라우저 JavaScript 저장소에 저장하지 않는다

## Timeseries 연결

시계열 architecture가 있으면 다음을 추가로 확인한다.

1. historical endpoint의 `from`, `to`, `resolution`, `seriesIds`, cursor
2. WebSocket/SSE URL, protocol/subprotocol, cookie 또는 in-memory credential
3. message version, sequence, resume cursor, heartbeat, proxy timeout
4. server aggregation과 resume retention
5. staging normal/max/burst fixture
6. production config에서 Mock adapter가 선택되지 않는지 확인

실제 backend가 resume/gap recovery를 제공하지 않으면 무손실 실시간으로 표시하지 않고 제한사항을 HANDOFF에 기록한다.

## 완료 조건

- 실제 API에서 데이터가 정상 반환된다
- 브라우저 Network 탭에서 실제 요청이 확인된다
- 오류 케이스 (401, 404, 500)가 올바르게 처리된다
- timeseries가 있으면 reconnect/resume/gap/duplicate와 Mock→real adapter 전환이 검증된다
- static/live/hybrid current mode와 README·runtime consumer·deployment가 일치한다
- machine receipt가 현재 source fingerprint와 일치하고 API/data quality verifier가 PASS다
