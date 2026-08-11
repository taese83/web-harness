# Realtime Provider Contract

stateful WebSocket 서버 구축은 built-in profile 범위 밖이다. 그 중간 지대 — 알림·presence·라이브 업데이트·경량 협업 — 는 **managed realtime provider**(Supabase Realtime, Ably, Pusher 계열) 소비로 커버한다. 이 계약은 그 소비 방식의 규칙이다. 시간축 차트 스트림은 이 계약이 아니라 `timeseries-dashboard`의 streaming-contract가 담당한다.

## 적용 판별

- **적용**: 다른 사용자의 변경이 내 화면에 실시간 반영, 알림 푸시, presence(접속 표시), 진행 상태 브로드캐스트.
- **제외**: 시간축 시계열 차트(`TIMESERIES_MODE`), 커서 단위 동시 편집·CRDT(전용 backend 영역 — 이 profile로 수용하지 않음), 폴링으로 충분한 낮은 빈도(30초+ 주기면 폴링을 먼저 검토).

## 구조 규칙

1. **서버가 발행, 클라이언트는 구독만.** 발행 권한을 브라우저에 주지 않는다 — mutation은 항상 API(Route Handler/serverless function)를 거쳐 서버가 검증 후 발행한다. 클라이언트→클라이언트 직접 브로드캐스트 금지.
2. **채널 = 권한 경계.** 채널 이름에 tenant/리소스 스코프를 넣고(`org:{id}:orders`), 구독 인가는 서버 발급 토큰(짧은 TTL)으로 한다. provider의 공개 채널에 비공개 데이터를 흘리지 않는다.
3. **이벤트는 알림, 정본은 API.** 이벤트 payload는 "무엇이 바뀌었다"(id·종류·버전)만 담고, 클라이언트는 수신 후 query invalidation으로 정본을 다시 가져온다 (TanStack Query invalidate 패턴). payload를 정본으로 쓰면 권한·정합 문제가 생긴다. 예외는 휘발성 데이터(presence·타이핑 표시)뿐.
4. **연결 상태는 UI 상태다.** connected/reconnecting/offline을 표시하고, 재연결 시 구독 채널의 정본을 refetch해 놓친 이벤트를 복구한다 (이벤트 재전송에 의존하지 않는다). 이 상태 표기는 timeseries의 live/stale/reconnecting UX 관례와 정렬.
5. **성능 하한**: 이벤트 수신마다 전체 리렌더 금지 — 영향 범위의 query key만 invalidate. 수신 빈도가 높으면(초당 수 회+) 배치 처리(수백 ms 병합) 후 한 번 invalidate.

## Mock·QA 경계

- provider SDK는 transport adapter 인터페이스 뒤에 둔다 — Mock 단계에서는 fake transport(수동 emit)로 UI·invalidation 흐름을 검증하고, 실제 provider 연결은 API 통합 단계의 몫이다 (MSW가 WebSocket을 대체하지 않으므로 adapter 경계가 Mock 지점이다).
- browser QA 시나리오에 최소 3종을 포함한다: 이벤트 수신 → 목록 갱신 / 재연결 → 정본 복구 / 권한 밖 채널 구독 거부.
- provider API key는 서버 전용이다 — 클라이언트에는 서버가 발급한 구독 토큰만 전달한다 (`env-management.md`의 public env 규칙 준수).

## 결정 기록

provider 선택(또는 폴링 채택)·채널 설계·인가 토큰 방식은 `tech-stack.md`와 `api-schema.md`에 기록한다 — 이 계약은 방식을 강제하지 않고 경계만 강제한다.
