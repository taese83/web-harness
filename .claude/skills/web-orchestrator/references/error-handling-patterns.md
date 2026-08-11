# Error Handling Patterns

`shared-foundation-builder`가 API 오류 계약을 만들고 `entity-query-builder`, `feature-mutation-builder`, `data-ui-binder`가 같은 typed error를 사용한다.

## Typed Error 계약

HTTP status를 메시지 문자열에서 다시 파싱하지 않는다. 원인, status, 안정적인 server code, field details, request ID를 보존한다.

```ts
export type AppErrorOptions = {
  cause?: unknown
  code?: string | undefined
  details?: unknown
  requestId?: string | undefined
  retryAfterMs?: number | undefined
  status?: number | undefined
}

export class AppError extends Error {
  readonly code: string | undefined
  readonly details: unknown
  readonly requestId: string | undefined
  readonly retryAfterMs: number | undefined
  readonly status: number | undefined

  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, {cause: options.cause})
    this.name = 'AppError'
    this.code = options.code
    this.details = options.details
    this.requestId = options.requestId
    this.retryAfterMs = options.retryAfterMs
    this.status = options.status
  }
}
```

## Axios 정규화

```ts
import axios from 'axios'
import type {AxiosError} from 'axios'

type ErrorEnvelope = {
  code?: string
  details?: unknown
  message?: string
}

const readHeader = (headers: unknown, name: string): string | undefined => {
  if (!headers || typeof headers !== 'object') return undefined
  const source = headers as {get?: (headerName: string) => unknown; [key: string]: unknown}
  const value = typeof source.get === 'function' ? source.get(name) : source[name] ?? source[name.toLowerCase()]
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined
}

export const parseRetryAfterMs = (headers: unknown, now = Date.now()): number | undefined => {
  const raw = readHeader(headers, 'retry-after')
  if (!raw) return undefined
  const seconds = Number(raw)
  const secondsDelayMs = seconds * 1000
  if (Number.isFinite(seconds) && seconds >= 0 && Number.isSafeInteger(secondsDelayMs)) return secondsDelayMs
  const timestamp = Date.parse(raw)
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - now) : undefined
}

export const normalizeApiError = (cause: unknown) => {
  if (!axios.isAxiosError<ErrorEnvelope>(cause)) {
    return new AppError('알 수 없는 오류가 발생했습니다.', {cause})
  }

  const error = cause as AxiosError<ErrorEnvelope>
  const status = error.response?.status
  const networkFailure = !error.response
  const payload = error.response?.data
  const requestIdHeader = error.response?.headers.get?.('x-request-id')

  return new AppError(
    networkFailure ? '네트워크 연결을 확인해주세요.' : payload?.message ?? '요청을 처리하지 못했습니다.',
    {
      cause,
      code: payload?.code,
      details: payload?.details,
      requestId: typeof requestIdHeader === 'string' ? requestIdHeader : undefined,
      retryAfterMs: parseRetryAfterMs(error.response?.headers),
      status,
    },
  )
}
```

- 401 refresh는 auth adapter만 담당한다. 공용 normalizer가 redirect하거나 credential을 다루지 않는다.
- Axios cancellation 또는 전달한 AbortSignal의 abort는 `AppError`로 바꾸지 않고 그대로 전파해 TanStack Query cancellation 의미를 보존한다.
- 403/404/422의 status와 server code를 유지해 UI가 안정적으로 분기한다.
- `navigator.onLine`은 보조 신호일 뿐 네트워크 오류 판정의 단일 기준으로 사용하지 않는다.
- raw response, authorization header, token, password를 console 또는 사용자 메시지에 출력하지 않는다.

## Query 정책

```ts
import {QueryClient} from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        if (error instanceof AppError && error.status && error.status < 500) return false
        return failureCount < 2
      },
      staleTime: 5 * 60 * 1000,
      throwOnError: error => error instanceof AppError && (error.status ?? 500) >= 500,
    },
    mutations: {retry: false},
  },
})
```

- 예상 가능한 4xx와 validation 오류는 `isError`/field error로 인라인 처리한다.
- 초기 렌더를 복구할 수 없는 5xx 또는 runtime error만 ErrorBoundary로 보낸다.
- mutation은 멱등성 보장이 없으면 자동 재시도하지 않는다.
- retry 횟수는 status뿐 아니라 idempotency, offline 상태, `Retry-After` 계약을 고려한다.

## Rate Limit (429) — Retry-After 처리

```ts
// src/shared/api/api.ts — AppApi.request 내부 loop에서 사용
const SAFE_RETRY_METHODS = new Set([Method.get, Method.head, Method.options])
const EXPLICIT_IDEMPOTENT_METHODS = new Set([Method.put, Method.delete])

const canRetryRateLimit = (config: RequestConfig) => {
  const method = String(config.method ?? '').toUpperCase() as Method
  if (SAFE_RETRY_METHODS.has(method)) return config.rateLimitRetry?.enabled !== false
  return EXPLICIT_IDEMPOTENT_METHODS.has(method) && config.rateLimitRetry?.enabled === true
}
```

**적용 규칙:**
- GET, HEAD, OPTIONS만 기본 자동 재시도한다. PUT/DELETE는 endpoint 멱등성 계약이 있고 `rateLimitRetry.enabled: true`일 때만 허용한다. POST/PATCH는 자동 재시도하지 않는다
- 기본 최대 재시도 3회. 초과 시 `retryAfterMs`를 포함한 `AppError(status: 429)`를 반환한다
- `Retry-After` 없을 때 retry index 0부터 `1s → 2s → 4s`의 capped exponential backoff를 사용한다
- `Retry-After` 날짜 형식: 검증된 `Date.parse(raw) - Date.now()`로 남은 시간 계산
- server가 보낸 대기 시간이 `maxDelayMs`를 넘으면 request를 장시간 붙잡지 않고 즉시 UI에 반환한다
- 대기 timer는 요청의 AbortSignal을 수신해 route 전환·query cancellation 때 즉시 정리한다
- Axios interceptor와 TanStack Query가 같은 429를 중복 재시도하지 않는다. request layer가 최종 `AppError`를 반환하면 Query retry는 4xx를 재시도하지 않는다

## ErrorBoundary와 재설정

```tsx
import {QueryClientProvider, QueryErrorResetBoundary} from '@tanstack/react-query'
import {ErrorBoundary} from 'react-error-boundary'

<QueryClientProvider client={queryClient}>
  <QueryErrorResetBoundary>
    {({reset}) => (
      <ErrorBoundary FallbackComponent={ErrorFallback} onReset={reset}>
        <RouterProvider />
      </ErrorBoundary>
    )}
  </QueryErrorResetBoundary>
</QueryClientProvider>
```

`ErrorFallback`은 `src/shared/ui/ErrorFallback/`에 한 번만 구현한다. production UI에 raw `error.message`, stack, API body를 노출하지 않는다. "다시 시도"는 QueryErrorResetBoundary를 재설정해야 한다.

## Observability Adapter

제품 코드가 특정 vendor SDK를 직접 호출하지 않도록 `src/shared/observability/` adapter를 둔다.

- environment, release, route, request ID, stable error code를 포함한다.
- password, token, cookie, authorization header, full request body, 불필요한 PII를 제거한다.
- source map은 공개 asset과 분리하고 업로드 권한을 CI에 최소 범위로 제공한다.
- sampling, consent, retention 요구사항을 `tech-stack.md`에 기록한다.

## 상태별 UX

| 오류 유형 | UX | Retry | 보고 |
|---|---|---|---|
| 입력/422 | field 인라인 메시지 | 사용자 수정 후 | 기본 제외 |
| 인증 401 | single-flight 갱신 또는 로그인 유도 | 원 요청 1회 | 반복/실패만 |
| 인가 403 | 권한 안내 | 없음 | server code 집계 |
| 리소스 404 | 명시적 empty/not-found | 조건부 | 계약 위반이면 보고 |
| rate limit 429 | `Retry-After` 기반 안내 | 멱등 요청만 | 집계 |
| 서버 5xx | 복구 UI + retry | 제한적 | capture |
| 네트워크/offline | 연결 안내 + retry | online 복귀 후 | 기본 제외 |
| runtime | ErrorBoundary | reset 가능 시 | capture |

## 완료 기준

1. API wrapper가 성공 envelope를 `T`로 unwrap한다.
2. 모든 실패가 typed `AppError`로 정규화되고 status/code/cause가 보존된다.
3. 4xx 인라인 처리와 5xx boundary 처리가 동시에 테스트된다.
4. QueryErrorResetBoundary가 retry/reset을 실제로 복구한다.
5. log/telemetry와 사용자 UI에 credential 또는 raw 민감 데이터가 없다.
6. 429 seconds/date/invalid header, safe method, opt-in PUT/DELETE, POST/PATCH 금지, retry 상한, AbortSignal timer cleanup이 테스트된다.
