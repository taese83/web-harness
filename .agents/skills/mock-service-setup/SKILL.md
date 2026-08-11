---
name: mock-service-setup
description: Introduces MSW (Mock Service Worker) into a web-harness project so frontend can develop and test against a shared contract without a running backend. Sets up handlers, fixtures, browser + node integration, contract-aligned response schemas, and enable/disable switches. Use when API and frontend are being developed separately, or when offline/CI reproducibility is required.
argument-hint: "[endpoint list or api-schema path]"
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Write, Edit, Bash, Agent, AskUserQuestion
metadata:
  version: 1.0.0
  maturity: contract-only
  updated: 2026-07-27
  changelog: 최초 버저닝 — adapter 재생성·검증 체계 도입과 함께 일괄 부여.
---

# Mock Service Setup

MSW를 도입해 프론트가 실제 API 없이도 개발/테스트할 수 있는 계약 기반 mock layer를 만든다. Handler는 **schema-first**로 작성되어 실제 서버 계약과 drift가 나지 않도록 한다.

Read `references/msw-contract.md` and `references/fixture-strategy.md` before writing any handler. 이미 API가 있는 프로젝트라면 `references/handler-from-existing.md`도 읽는다.

`api-contract-typegen`이 함께 있으면 handler response 타입을 typegen 결과에서 import한다. `api-connect`로 real API 전환 시 handler는 삭제하지 않고 `bypass`로 두어 dev·CI에서 계속 재사용 가능하게 유지한다.

## 언제 사용

- 백엔드가 아직 완성되지 않았고 프론트가 먼저 개발할 때
- API-프론트 팀이 분리되어 계약(schema)만 있고 서버가 없을 때
- 오프라인/CI 재현 가능한 통합 테스트가 필요할 때
- Storybook에서 데이터 있는 컴포넌트를 렌더할 때

**사용하지 않아도 되는 경우**: 로컬에서 이미 실제 API/DB에 붙어서 개발 중이고 offline·CI reproducibility가 요구되지 않는 프로젝트. `mock-api-builder` agent를 통해 orchestrator가 이미 기본 MSW를 깔았다면 이 skill은 handler 확장·재조직에만 사용한다.

## Start

`/mock-service-setup`을 호출하면:

> 어떤 API를 mock으로 만들까요? `_workspace/02_design/api-schema.md`, OpenAPI 파일, endpoint 목록 중 하나를 알려주세요.

intake:
1. **입력 소스** — `api-schema.md` / OpenAPI / Zod schema / endpoint 목록
2. **범위** — 전체 vs 특정 feature vs 특정 endpoint 몇 개
3. **실행 대상** — browser (dev/preview), node (vitest), 둘 다
4. **활성화 스위치** — `VITE_MSW=1` env / `?mock=1` query / 항상 활성 / dev only
5. **fixture 소스** — inline / json 파일 / factory 함수

## Workflow

### 1. 의존성 확인·설치 제안

`client/package.json`에 `msw`가 없으면 사용자에게 install 안내:

```
pnpm add -D msw@^2
```

`msw@2`이 기본. 프로젝트가 이미 `msw@1`이면 절대 자동 upgrade하지 않고 그대로 유지한다.

### 2. 디렉토리 구조 생성

```
src/mocks/
  browser.ts        # setupWorker (browser)
  server.ts         # setupServer (node/vitest)
  handlers/
    index.ts        # 전체 handler export
    <feature>.ts    # feature별 handler (auth, participation, scores, ...)
  fixtures/
    <feature>.ts    # feature별 sample data
```

브라우저 실행에는 `public/mockServiceWorker.js`가 필요하다. install 후:
```
pnpm exec msw init public/ --save
```
사용자 확인 후 실행. 없으면 browser는 handler를 인식하지 못한다.

### 3. Handler는 schema에서 파생

**금지**: handler 안에서 `res(ctx.json({...}))`의 인라인 타입을 즉흥으로 만든다.

**요구**: 반드시 계약된 response 타입을 import해서 사용한다.

- `api-contract-typegen`이 있으면 typegen 결과에서 import
- Zod schema만 있으면 `z.infer<typeof Schema>` 사용
- 아무 계약도 없으면 handler와 함께 Zod schema를 `src/entities/<name>/model/schema.ts`에 정의하고 그것을 handler와 client 양쪽에서 참조하도록 만든다

이 규칙이 없으면 mock↔real drift가 재발한다.

### 4. 활성화 스위치

`src/main.tsx`에서 조건부 시동:
```ts
if (import.meta.env.DEV && import.meta.env.VITE_MSW === '1') {
  const {worker} = await import('./mocks/browser')
  await worker.start({onUnhandledRequest: 'bypass'})
}
```
- `onUnhandledRequest: 'bypass'`가 필수. `'warn'`은 실제 asset 요청도 warn을 뿌린다
- production build에서 절대 활성화되지 않도록 `import.meta.env.DEV` 게이팅

### 5. Node/vitest 통합

`vitest.setup.ts`:
```ts
import {beforeAll, afterAll, afterEach} from 'vitest'
import {server} from './src/mocks/server'
beforeAll(() => server.listen({onUnhandledRequest: 'error'}))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
```
- Node에서는 `'error'` — 테스트에서 unhandled 요청은 반드시 실패해야 한다

### 6. Fixture 전략

`references/fixture-strategy.md`에 따라 factory 함수 우선. Snapshot JSON은 대량/변화 없는 데이터에만.

### 7. Bypass mode (실제 API 전환 시)

`api-connect`로 real API에 붙일 때 handler를 삭제하지 말고:
- `VITE_MSW=0`이면 worker.start()를 호출하지 않는다
- handler 파일은 계약 문서 역할로 유지
- Vitest는 계속 mock 사용 (테스트 격리)

## 완료 조건

- `pnpm dev`에서 `VITE_MSW=1`이면 network 요청이 handler로 인터셉트된다
- production build에서 `mockServiceWorker.js`가 등록되지 않는다
- vitest에서 unhandled 요청이 fail한다
- 모든 handler response가 `api-schema` 또는 Zod schema 파생 타입을 사용한다
- `pnpm build`가 오류 없이 완료된다
- `public/mockServiceWorker.js`가 존재한다
