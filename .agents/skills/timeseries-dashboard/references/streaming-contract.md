# Streaming Contract

## Snapshot + Stream 원칙

1. historical REST snapshot으로 초기 범위를 가져온다.
2. snapshot 응답에 resume cursor 또는 마지막 sequence를 포함한다.
3. stream을 연결해 cursor 이후 event만 수신한다.
4. 중복 sequence는 제거하고 gap은 historical recovery endpoint로 보충한다.
5. buffer와 query cache의 책임을 분리한다. 고빈도 tick마다 전체 Query cache를 복사하지 않는다.

## Timestamp 통일 계약

모든 시계열 데이터는 버퍼·chart에 전달되기 전 **Unix milliseconds (`number`)** 로 정규화한다.

| 단계 | 형식 | 책임 |
|---|---|---|
| API/stream 수신 | ISO 8601 문자열 또는 Unix ms | `entity-query-builder`, `realtime-data-builder` |
| Zod parse 직후 | `number` (Unix ms) 로 변환 | schema transform |
| ring buffer 내부 | `number` (Unix ms) | `realtime-data-builder` |
| chart wrapper 입력 | `number` (Unix ms) | `component-builder` |
| UI 표시 | 사용자 timezone 적용 | 표시 레이어 전용 |

```ts
// src/shared/lib/timeseries/timestamp.ts
import {z} from 'zod'

export const unixMsSchema = z.int().nonnegative()

const isoTimestampSchema = z.iso.datetime({offset: true})

export const timestampInputSchema = z
  .union([unixMsSchema, isoTimestampSchema.transform(raw => Date.parse(raw))])
  .pipe(unixMsSchema)
```

- **DST/timezone**: 모든 내부 처리는 UTC Unix ms. 표시 시에만 사용자 timezone 적용
- **숫자 단위**: wire 숫자를 허용하려면 API schema가 milliseconds임을 명시해야 한다. seconds 계약이면 별도 schema에서 `* 1000` 변환하며 크기로 단위를 추측하지 않는다
- **유효 범위**: 제품 도메인의 최소/최대 timestamp를 architecture에 정의하고 `unixMsSchema.refine`으로 적용한다
- **clock skew 허용 window**: architecture 문서에서 ms 단위로 명시 (기본 baseline: 5,000ms)
- **`emittedAt`**: ISO 8601 유지 (디버깅/로그용). 내부 처리에 사용하지 않는다

## 필수 Message Envelope

```ts
type TimeseriesMessage = {
  protocolVersion: 1
  type: 'point' | 'heartbeat' | 'reset' | 'error'
  streamId: string
  sequence: number
  emittedAt: string   // ISO 8601 — 로그/디버그 전용
  cursor?: string
  payload?: unknown
}

type TimeseriesPoint = {
  seriesId: string
  timestamp: number   // Unix ms — 수신 즉시 정규화된 값
  value: number | null
  quality?: 'good' | 'missing' | 'estimated'
}
```

Zod discriminated union으로 envelope와 payload를 runtime 검증한다. wire `timestamp` 필드는 `timestampInputSchema`로 parse해 항상 Unix ms `number`로 정규화한다. nullable value, enum evolution을 API schema에 명시한다.

## Transport 선택

| 조건 | 기본 선택 |
|---|---|
| 서버→브라우저 단방향, HTTP 인프라 활용 | SSE |
| 양방향 subscription 변경, binary, multiplex 필요 | WebSocket |
| 낮은 갱신 빈도, stream backend 없음 | bounded polling |

transport 종류보다 reconnect, heartbeat, auth, proxy timeout, resume 가능 여부를 우선한다. Socket.IO는 backend가 같은 protocol을 지원할 때만 선택한다.

## 상태 모델

`idle → connecting → live → reconnecting → stale → closed`

- `connecting`: 최초 snapshot과 stream cursor 정렬 중
- `live`: heartbeat가 정상이고 point를 수신함
- `reconnecting`: backoff 중이며 마지막 정상 시각을 표시함
- `stale`: heartbeat timeout 또는 gap recovery 실패
- `closed`: 사용자가 live mode를 종료했거나 복구 불가

UI는 연결 상태, 마지막 수신 시각, live pause 여부를 표시한다.

## Bounded Buffer

- series별 ring buffer 또는 deque를 사용한다.
- count와 time-window 두 상한을 모두 적용한다.
- duplicate sequence와 동일 `(seriesId, timestamp)` 정책을 정의한다.
- out-of-order 허용 window 밖의 point는 버리거나 recovery 대상으로 기록한다.
- unmount, route change, filter change 시 subscription과 timer를 정리한다.

## Backpressure와 Batch

- event마다 React state를 갱신하지 않는다.
- queue에 적재하고 정해진 render cadence로 batch flush한다.
- queue high-water mark를 넘으면 coalesce/downsample/drop 정책을 계측한다.
- parsing/aggregation이 main thread budget을 넘으면 Worker로 이동한다.
- dropped/coalesced point 수를 observability metric으로 기록한다.

## Worker 데이터 전달 계약

### 도입 기준

메인 스레드 파싱/집계가 목표 refresh rate의 frame budget(`1000 / targetHz`) 중 50% 이상을 차지하는 것이 측정될 때만 도입한다. architecture 문서에 targetHz와 Worker 도입 기준을 ms 단위로 명시한다. 측정 없이 기계적으로 도입하지 않는다.

### 형식 선택 — Transferable 우선

```ts
// src/shared/realtime/worker/aggregator.worker.ts
type PackedPointMessage = {
  type: 'points'
  seriesId: string
  points: Float64Array // [timestampMs, value, timestampMs, value, ...]
  quality: Uint8Array // 0=good, 1=missing, 2=estimated
}

self.onmessage = (event: MessageEvent<PackedPointMessage>) => {
  const result = downsample(event.data.points, event.data.quality, VISIBLE_POINT_LIMIT)
  self.postMessage(
    {type: 'aggregated', seriesId: event.data.seriesId, ...result},
    [result.points.buffer, result.quality.buffer],
  )
}

// 호출 측 (realtime-data-builder)
const packedPoints = new Float64Array(points.length * 2)
const quality = new Uint8Array(points.length)

points.forEach((point, index) => {
  packedPoints[index * 2] = point.timestamp
  packedPoints[index * 2 + 1] = point.value ?? Number.NaN
  quality[index] = point.quality === 'estimated' ? 2 : point.value === null ? 1 : 0
})

worker.postMessage(
  {type: 'points', seriesId, points: packedPoints, quality},
  [packedPoints.buffer, quality.buffer],
)
// 두 buffer는 전달 후 detached — 원본 측에서 재사용 금지
```

timestamp/value 쌍과 missing/estimated 품질을 함께 전달한다. 값만 전달하거나 `null`을 `0`으로 치환하지 않는다. irregular interval과 gap을 보존할 수 없는 downsampling은 사용하지 않는다.

### SharedArrayBuffer 조건

SharedArrayBuffer는 `Cross-Origin-Opener-Policy: same-origin`과 `Cross-Origin-Embedder-Policy: require-corp` 또는 `credentialless`가 설정되고 runtime의 `globalThis.crossOriginIsolated === true`인 경우에만 사용한다. 포함된 third-party resource의 CORP/CORS 호환성도 검증한다. 기본 선택은 Transferable이다.

### 크래시 폴백

```ts
// src/shared/realtime/aggregator.ts
type AggregationResult = {points: Float64Array; quality: Uint8Array}
type Aggregate = (points: Float64Array, quality: Uint8Array, limit: number) => Promise<AggregationResult>

let aggregateImpl: Aggregate

try {
  const w = new Worker(new URL('./worker/aggregator.worker.ts', import.meta.url), {type: 'module'})
  aggregateImpl = createWorkerAggregator(w)
} catch {
  // Worker 생성 실패(CSP, 환경 제한 등) 시 메인 스레드 폴백
  aggregateImpl = inlineAggregator
}
```

`createWorkerAggregator`는 `error`/`messageerror`, request ID별 timeout, generation ID를 처리한다. Worker가 runtime에 crash하면 pending 요청을 정리하고 main-thread fallback으로 전환하되 같은 batch를 두 번 반영하지 않는다.

### cleanup

- Worker를 사용하는 컴포넌트 unmount 또는 filter 변경 시 `worker.terminate()`를 호출한다.
- 진행 중인 postMessage 응답은 request/generation ID와 AbortSignal을 함께 검사해 stale 응답을 무시한다.
- Worker 생성 시점에 타임아웃을 설정하고 응답이 없으면 terminate 후 폴백으로 전환한다.

## 인증과 오류

- browser storage에 credential을 저장하지 않는다.
- cookie SSE는 CSRF/CORS와 origin 정책을 따른다.
- WebSocket handshake와 subscription authorization을 서버에서 검증한다.
- auth 만료와 network reconnect를 구분한다.
- 무한 reconnect를 막고 최종 실패 상태와 수동 retry를 제공한다.
