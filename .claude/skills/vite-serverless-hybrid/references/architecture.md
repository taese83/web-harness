# Hybrid 아키텍처

Vite SPA와 serverless functions가 한 프로젝트에 공존.

## 계층

```
Browser (SPA)
  │
  │  fetch('/api/...', {credentials: 'include'})
  ▼
Serverless function handler (Vercel/Netlify)
  │
  ▼
External service (DB, OAuth provider, storage)
```

- 프론트는 별도 서버 없이 `fetch('/api/...')`로 서버 로직 호출
- 각 handler는 stateless: cold start마다 새 인스턴스
- 세션은 cookie로 유지 (서버 memory 사용 금지)

## 동일 프로젝트에 두는 이유

- **배포 단위**: SPA + API를 한 번에 배포. 계약 drift 방지
- **환경 변수**: 하나의 `.env.local`로 관리
- **타입 공유**: `src/shared/schemas/`를 SPA와 handler가 함께 import
- **경계 유연**: handler 코드 일부를 SPA로 옮기거나 그 반대로 이동 쉬움

## 한계

- **cold start**: 첫 요청 지연 (~수백 ms)
- **timeout**: Vercel free ~10s, pro ~60s. 오래 걸리는 작업은 별도 worker 필요
- **connection pool**: DB에 매번 새 연결 → HTTP-based DB(`@neondatabase/serverless`) 또는 connection pooler 필수
- **filesystem**: read-only (deploy artifact 외에는 tmp만 write). 파일 upload는 external storage로

## Vercel-specific

- app root의 `api/foo.ts` → `<domain>/api/foo`
- dynamic segment: `[id].ts` → `/api/foo/:id`
- catch-all: `[...slug].ts` → `/api/foo/:slug*`
- 신규 Node runtime은 Web Standard handler(`export default {fetch(request) { ... }}` 또는 method export)를 우선한다
- `edge` runtime vs `node` runtime — 이 skill은 `node` 기본 (jose, DB driver 지원)

## Netlify functions는

- 배치: `netlify/functions/foo.ts` → `/.netlify/functions/foo`
- 이 skill의 예제는 Vercel 관습(`api/...`) 기반. Netlify에서도 파일 위치와 이름만 다르고 나머지는 동일

## 왜 next-app-fullstack이 아닌가

- Next.js의 App Router는 SSR·streaming·middleware 등 무거운 features를 함께 가져옴
- Vite의 fast HMR, ESM-first bundling, 얇은 dev experience를 유지하고 싶을 때
- 서버 로직이 10-30 endpoint 규모면 Next 프레임워크 오버헤드가 과함

## 왜 pure SPA + separate backend가 아닌가

- separate backend는 배포·env·계약 관리가 배로 늘어남
- 프로젝트 초기~중기에는 hybrid로 시작 → 나중에 backend 분리 가능
- 분리 시점에 이 skill의 `api/` 폴더를 그대로 별도 Node service로 옮기면 됨

## 프로젝트 크기 임계

이 profile 유지가 편한 범위:
- endpoint: ~30
- server file: ~20 (handlers + `_lib/`)
- team: 1~5명

초과하면:
- backend 분리 (Nest/Express/Fastify)
- monorepo 도구 (Turborepo, Nx)
- API 계약을 OpenAPI/gRPC로 명시적 문서화
