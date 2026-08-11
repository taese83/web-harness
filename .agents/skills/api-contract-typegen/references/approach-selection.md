# Approach 선택 가이드

## 결정 트리

```
서버가 다른 언어인가?
├── YES (Python/Go/Kotlin/...) → OpenAPI-first
│   서버가 OpenAPI를 authoritative로 생성/유지 →
│   client는 openapi-typescript로 타입만 파생
│
└── NO (TypeScript monorepo) →
    OpenAPI가 이미 존재하는가?
    ├── YES → OpenAPI-first (기존 자산 존중)
    └── NO → Zod-first (권장)
        Zod schema를 client/server가 직접 import
        필요할 때 zod-to-openapi로 문서 파생
```

## OpenAPI-first — 언제

- 서버가 Python/Go 등 non-TS 언어
- 이미 팀이 OpenAPI 스펙을 유지 중이며 governance 도구 (Swagger UI, Redoc)를 사용
- 외부 파트너에게 공개해야 하는 API
- 여러 client (web + mobile)가 같은 스펙을 참조

**툴**:
- `openapi-typescript` — 타입만 생성 (경량, 유연)
- `orval` — 타입 + React Query hook 자동 생성 (편의성)
- `openapi-fetch` — typed fetch wrapper

**단점**:
- runtime 검증이 별도 (Zod/Yup을 추가로 사용해야 함)
- codegen이 CI 파이프라인에 필수
- 스펙 파일이 커지면 diff 리뷰가 어려움

## Zod-first — 언제

- TypeScript monorepo에서 서버·클라이언트가 같은 코드를 import 가능
- 서버 handler가 이미 body/query validation을 Zod로 하고 있음
- 런타임 검증이 필수 (외부 데이터 소스, 크롤링 결과 등)
- 처음부터 스펙 문서화보다 코드 우선

**툴**:
- Zod만
- 필요시 `@asteasolutions/zod-to-openapi` — Zod → OpenAPI 파생
- `orval`도 Zod input에서 hook 생성 지원

**장점**:
- 단일 소스 (Zod schema 파일 하나)
- runtime + compile-time 검증 동시
- OpenAPI 문서는 필요할 때만 파생

**단점**:
- non-TS 서버와 공유 어려움
- 외부 파트너 공개용 문서는 별도 관리

## Hybrid — 언제

- 대부분의 endpoint는 Zod-first, 소수의 외부 파트너 API만 OpenAPI-first
- 이 경우 두 approach를 병행. 파일 위치를 명확히 분리:
  - `src/shared/schemas/` — Zod (내부)
  - `src/shared/api-external/` — OpenAPI codegen (외부)

## 프로젝트 크기 가이드

| 규모 | 권장 |
|---|---|
| Solo dev, TS 서버 | Zod-first |
| 2-4명 team, TS 서버 | Zod-first |
| Multi-team, TS 서버 | Zod-first + zod-to-openapi 문서 파생 |
| Multi-language 서버 | OpenAPI-first |
| Public API | OpenAPI-first + Zod parse in client |
