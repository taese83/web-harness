---
name: api-contract-typegen
description: [내부] Phase 3 스팩이 고른다. 사용자 진입점은 /wh 하나다. Establishes a single source of truth for API contracts (OpenAPI or Zod) and generates TypeScript types shared between server handlers, MSW handlers, and frontend clients. Prevents drift where client casts responses to a type the server never returns. Use when API and frontend are developed separately, or when the current project has grown its own untyped fetch layer.
argument-hint: "[openapi path | zod-first | auto-detect]"
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Write, Edit, Bash, Agent, AskUserQuestion
metadata:
  version: 1.0.0
  maturity: contract-only
  updated: 2026-07-27
  changelog: 최초 버저닝 — adapter 재생성·검증 체계 도입과 함께 일괄 부여.
---

# API Contract Typegen

프론트/서버가 분리되기 시작하는 순간, contract를 **단일 소스**로 만들어 둔다. 이 skill은 두 가지 approach 중 하나를 프로젝트에 맞게 선택해 typegen pipeline을 구축한다:

- **OpenAPI-first** — 스펙 문서가 authoritative. 서버·클라이언트가 codegen 결과를 참조
- **Zod-first** — Zod schema가 authoritative. `zod-to-openapi`로 문서를 파생 가능

Read `references/approach-selection.md` before choosing. Then read the matching guide: `references/openapi-first.md` or `references/zod-first.md`. Finally read `references/drift-detection.md` regardless of approach.

`mock-service-setup`이 함께 있으면 handler가 이 skill의 결과를 import한다. `api-connect`로 real API 전환 시 실서버 response가 schema를 통과하는지 검증한다.

## 언제 사용

- 서버와 프론트가 각기 다른 팀·저장소·언어에서 개발되어 계약 drift가 발생 중
- fetch/axios 응답에 `as Type` 캐스팅이 만연하고 runtime 검증이 없음
- 이미 OpenAPI 스펙이 있지만 client는 손으로 타입을 유지 중
- MSW handler와 real API response가 미묘하게 다름을 발견

## Start

`/api-contract-typegen`을 호출하면:

> 계약의 source of truth는 무엇인가요?

intake:
1. **Source of truth** — OpenAPI(YAML/JSON) / Zod schema (권장, 코드 통합에 유리) / 아직 없음
2. **Generator 선호도** — `openapi-typescript` (타입만, 가벼움) / `orval` (React Query hook까지) / `zod-to-openapi` (Zod→OpenAPI)
3. **범위** — 전체 API / 특정 feature / 새로 추가되는 endpoint만
4. **런타임 검증** — Zod 기반 parse (권장) / 타입만 (경량, 검증은 서버 신뢰)

## Workflow

### Approach A: OpenAPI-first

`references/openapi-first.md` 참고.
1. `openapi.yaml`/`openapi.json`을 `_workspace/02_design/`에 배치
2. `pnpm add -D openapi-typescript`
3. `pnpm openapi:gen` 스크립트로 `src/shared/api/schema.gen.ts` 생성
4. client fetch/axios는 이 타입만 사용
5. 서버 handler는 별도 생성기 (예: `openapi-typescript-codegen` 서버 사이드)로 request shape 참조

### Approach B: Zod-first (권장 for TypeScript monorepo)

`references/zod-first.md` 참고.
1. `src/shared/schemas/`에 endpoint별 Zod schema 정의 (body/query/response)
2. 서버 handler는 이 schema로 body parse
3. client fetch는 응답을 이 schema로 parse
4. OpenAPI가 필요하면 `zod-to-openapi`로 파생

### Drift 감지

`references/drift-detection.md`:
- CI에서 `pnpm typecheck`로 typegen 결과와 사용처 어긋남 감지
- runtime에서 Zod parse 실패는 상세 로그
- MSW handler는 real response와 동일 schema를 통과 (fixture 강제)

### `api-contract-verifier` 연동

이 skill이 완료되면 `api-contract-verifier` agent가 read-only로 client fetch/handler/schema 3자 일치를 검증한다. Verifier는 다음을 확인한다:
- fetch call site에 `.parse(...)` 또는 `as z.infer<...>`가 있는지
- server response와 client 기대치가 같은 schema를 참조하는지
- MSW handler가 있으면 handler response도 같은 schema를 통과하는지

## 완료 조건

- `src/shared/schemas/` (Zod-first) 또는 `src/shared/api/schema.gen.ts` (OpenAPI)가 존재
- 최소 하나 이상의 client fetch가 schema로 parse
- 최소 하나 이상의 서버 handler(있는 경우)가 같은 schema로 parse
- `pnpm typecheck`가 오류 없이 완료
- `pnpm build`가 오류 없이 완료
- MSW handler가 있으면 같은 schema로 fixture 검증
