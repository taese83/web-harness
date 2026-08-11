# MSW 계약

## 계약의 원칙

MSW handler는 **문서화된 API 계약의 실행 가능한 표현**이다. mock이 "가짜 데이터를 만드는 곳"이면 real API로 전환할 때 drift가 생긴다. 반드시 다음 순서를 지킨다:

1. `_workspace/02_design/api-schema.md` 또는 OpenAPI/Zod schema가 먼저 존재
2. Handler는 그 schema에서 파생된 타입만 반환
3. Fixture는 schema를 통과하는 값만

## Handler 작성 규칙

### DO
- 하나의 handler는 하나의 endpoint. 대소문자·trailing slash 통일
- response는 반드시 schema를 통과: `Schema.parse(fixture)` 후 반환
- status 파라미터로 실패 케이스 분기 (`?scenario=empty|500|slow`)
- error response도 계약 (`ErrorEnvelope` 등 공통 shape 준수)

### DON'T
- 인라인 `{ok: true, ...}` 즉흥 shape — client와 drift의 원인
- handler에서 도메인 로직 흉내 — factory나 별도 module로 분리
- 실제 데이터 복사 붙여넣기 (개인정보 유출 위험)
- `msw/rest`, `msw/node`, `msw/browser` 혼용 — v2는 `msw`에서 `http`, `HttpResponse` import

## v2 기본 패턴

```ts
import {http, HttpResponse} from 'msw'
import {ProfileSchema, type Profile} from '@/entities/profile/model/schema'

export const profileHandlers = [
  http.get('/api/profiles', () => {
    const profiles: Profile[] = fixtures.profiles.map(f => ProfileSchema.parse(f))
    return HttpResponse.json(profiles)
  }),
  http.post('/api/profiles', async ({request}) => {
    const body = await request.json()
    // 서버가 실제로 던지는 validation과 같은 shape의 에러 반환
    const parsed = CreateProfileBodySchema.safeParse(body)
    if (!parsed.success) {
      return HttpResponse.json({error: parsed.error.message}, {status: 400})
    }
    return HttpResponse.json(ProfileSchema.parse({id: 1, ...parsed.data}))
  }),
]
```

## Runtime override

Test/story별로 handler를 override:
```ts
import {server} from '@/mocks/server'
server.use(
  http.get('/api/profiles', () => HttpResponse.json([], {status: 200}))
)
```
- afterEach의 `resetHandlers()`가 반드시 있어야 격리된다
- browser에서도 `worker.use(...)`로 동일 API

## 실행 대상별 파일 분리

- `src/mocks/browser.ts` — `setupWorker(...handlers)` — `import.meta.env.DEV`
- `src/mocks/server.ts` — `setupServer(...handlers)` — Node/vitest
- `src/mocks/handlers/index.ts` — `[...profileHandlers, ...raceHandlers, ...]`

두 setup 파일은 같은 handler를 import — 절대 handler를 각각 정의하지 않는다.

## 시나리오 스위치 표준

query string 또는 header로 시나리오를 선택 가능하게:
```ts
http.get('/api/scores', ({request}) => {
  const scenario = new URL(request.url).searchParams.get('scenario')
  if (scenario === 'empty') return HttpResponse.json({profiles: [], grandTotal: 0})
  if (scenario === 'slow') return delay(2000).then(() => HttpResponse.json(...))
  if (scenario === '500') return HttpResponse.json({error: 'internal'}, {status: 500})
  return HttpResponse.json(fixtures.scoresFull)
})
```
Storybook decorator/e2e에서 재사용된다.

## Real API 전환 원칙

`api-connect`가 real API로 붙일 때:
- handler 파일 **삭제 금지**. 계약 회귀 방지용으로 유지
- `VITE_MSW=0`에서는 worker start 호출을 스킵
- Vitest는 여전히 mock 사용 → 테스트가 network에 의존하지 않음
- 실제 서버의 response shape이 handler와 어긋나면 그것이 곧 계약 위반 시그널
