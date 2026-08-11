# Timeseries Mode Detection Contract

## 판별 원칙

`TIMESERIES_MODE`는 단순 문자열 검색이 아니라 사용자 의도와 기존 source artifact를 함께 보고 판별한다. 다음 두 핵심 조건과 확장 조건 중 하나를 만족하면 활성화한다.

1. **시간축 series**: 시간에 따라 변하는 metric, telemetry, sensor, event count, 가격, 로그 집계 등 연속 또는 구간 데이터가 핵심이다.
2. **시각적 탐색**: chart, graph, plot, dashboard에서 기간·resolution·series를 탐색하거나 비교한다.
3. **확장 조건 중 하나**:
   - historical range 조회, 날짜별 조회, aggregation, downsampling이 필요하다.
   - realtime/live/streaming 갱신, WebSocket, SSE, polling이 필요하다.
   - high-volume/high-cardinality 데이터의 표시량·성능 budget이 필요하다.

historical 전용 대시보드도 1·2·3을 만족하면 활성화한다. realtime은 필수 조건이 아니다.

## 동의어

- 한국어: `시계열`, `메트릭`, `지표`, `센서`, `텔레메트리`, `그라파나`, `그래프`, `차트`, `대시보드`, `날짜별`, `기간 조회`, `실시간`, `라이브`, `스트리밍`, `대용량`, `빅데이터`
- English: `timeseries`, `time series`, `metric`, `telemetry`, `sensor`, `Grafana`, `chart`, `graph`, `dashboard`, `date range`, `historical`, `realtime`, `live`, `streaming`, `WebSocket`, `SSE`, `high-volume`, `big data`

동의어 목록은 힌트이며 literal match allowlist가 아니다. 문서의 schema, endpoint, wire protocol, 화면 요구가 위 의미를 나타내면 같은 모드로 판별한다.

## 제외 사례

- WebSocket 채팅, 알림, presence, 공동 편집처럼 시간축 chart가 핵심이 아닌 기능
- 정적인 막대/파이 chart 한 개만 표시하고 기간·series·실시간·대용량 요구가 없는 화면
- 단순 CRUD 목록에 `createdAt`만 존재하는 경우

## 판별 예시

| 입력 | 결과 | 이유 |
|---|---|---|
| 그라파나 같은 빅데이터 그래프, 날짜별 조회와 실시간 시계열 | true | 시간축+시각화+historical/realtime/high-volume |
| 7일·30일 매출 추이와 일/시간 resolution dashboard | true | historical 전용 시계열 탐색 |
| 센서 100개의 SSE live chart | true | 시간축+시각화+realtime |
| WebSocket 채팅과 읽음 상태 | false | 시간축 chart가 핵심이 아님 |
| 카테고리별 정적 파이 chart | false | 시계열·기간 탐색이 없음 |

## 판별 순서

1. prompt뿐 아니라 `_workspace`, PRD, API/OpenAPI, 디자인 산출물에서 의미 조건을 확인한다.
2. 명확하면 질문 없이 `TIMESERIES_MODE`를 기록한다.
3. 시간축 chart가 핵심인지 불명확할 때만 한 번 질문한다.
4. Resume/Source Artifact Mode에서도 기존 문서가 조건을 만족하면 활성화한다.
