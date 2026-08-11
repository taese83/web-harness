# Mock and Migration Contract

## Adapter 경계

UI와 buffer는 transport 구현을 직접 알지 않는다.

```ts
type StreamSubscription = {
  close: () => void
}

interface TimeseriesTransport {
  connect: (input: {
    cursor?: string
    onMessage: (message: unknown) => void
    onStateChange: (state: StreamState) => void
    seriesIds: string[]
  }) => StreamSubscription
}
```

Mock과 real transport가 같은 interface를 구현하고 message는 공통 Zod schema를 통과한다.

## Mock 시나리오

- deterministic seed와 fake clock
- 정상 rate와 burst
- latency와 jitter
- duplicate sequence
- bounded out-of-order event
- sequence gap
- disconnect/reconnect
- heartbeat timeout
- malformed payload
- permission/auth expiration

Mock은 기본적으로 브라우저 내부 fake transport를 사용한다. 실제 protocol mock 기능을 사용할 때는 설치된 도구 버전의 공식 지원을 확인한다. 테스트 전용 구현이 production bundle에 포함되지 않도록 dev/test entry에서만 로드한다.

## Historical Mock

- `from`, `to`, `resolution`, `seriesIds`를 처리한다.
- response에 `nextCursor` 또는 `resumeCursor`를 포함한다.
- resolution별 point 수가 visible budget을 넘지 않게 한다.
- empty range, partial gap, server error, abort를 제공한다.

## 실제 연결 전환

1. snapshot endpoint의 query, timezone, resolution, cursor 계약 비교
2. stream URL/protocol/subprotocol과 인증 방식 확인
3. message schema와 sequence/cursor 의미 비교
4. heartbeat/proxy idle timeout 확인
5. reconnect rate limit과 server resume retention 확인
6. Mock-only assumption을 gap report로 출력
7. staging에서 normal/max/burst fixture 검증
8. Mock transport는 dev/test에만 유지하고 production config에서 real adapter 선택

## HANDOFF 항목

- REST snapshot endpoint와 예제
- realtime endpoint와 인증
- message schema와 versioning
- cursor/resume 보존 시간
- heartbeat와 timeout
- server aggregation resolution
- client buffer와 visible budget
- reconnect/gap recovery 운영 지표
- staging 검증 명령과 rollback 방법

