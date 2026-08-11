# Chart Performance Contract

## Engine 선택

- SVG 중심 chart는 series와 visible point가 작고 DOM/접근성 이점이 필요할 때 사용한다.
- Canvas 기반 engine은 다수 series와 고빈도 update에 우선 검토한다.
- WebGL은 측정상 Canvas가 SLO를 만족하지 못하고 target browser가 지원할 때만 도입한다.
- library 이름이나 마케팅 수치만으로 대용량 가능 여부를 단정하지 않는다. 실제 fixture로 측정한다.

## Data Pipeline

`raw event → validate → deduplicate/order → aggregate/downsample → bounded buffer → batched chart update`

- backend aggregation을 우선한다.
- client downsampling은 현재 viewport를 위한 보조 수단으로 사용한다.
- min/max bucket은 spike 보존이 중요할 때, LTTB는 전체 형태 축약이 필요할 때 검토한다.
- zoom 범위가 바뀌면 적절한 resolution을 다시 조회한다.
- 원본 전체를 chart option이나 React props에 반복 복사하지 않는다.

## React 통합

- chart instance lifecycle을 wrapper 한 곳에서 관리한다.
- event tick마다 JSX tree를 다시 만들지 않는다.
- option object 전체 교체 대신 library의 incremental update를 사용한다.
- ResizeObserver callback을 debounce하고 zero-size container를 처리한다.
- unmount 시 observer, timer, stream listener, chart instance를 해제한다.
- chart와 filter state를 분리해 filter 변경이 모든 panel을 불필요하게 재생성하지 않게 한다.

## Interaction 계약

- zoom/brush 중 live auto-scroll을 일시 정지한다.
- "Live로 돌아가기" 동작을 제공한다.
- crosshair와 tooltip update가 stream render를 막지 않게 한다.
- legend에서 series를 숨겨도 subscription 유지/해제 정책을 명시한다.
- export는 현재 viewport인지 원본 데이터인지 구분한다.

## 접근성

- chart title, 단위, 시간 범위, 최신 값 summary를 텍스트로 제공한다.
- 색상 외 line style/marker/label로 series를 구분할 수 있게 한다.
- keyboard로 기간·series·pause를 조작할 수 있게 한다.
- 데이터 표 또는 요약 다운로드 대안을 제공한다.
- live update announcement는 과도한 `aria-live` 알림을 피하고 상태 변화만 전달한다.

## Performance 검증

최소 세 fixture를 사용한다.

1. 정상: 요구사항의 일반 series/point/update-rate
2. 최대: 명세된 production 상한
3. burst/recovery: 일시적 burst, disconnect, gap recovery

각 fixture에서 다음을 기록한다.

- initial chart render
- update/render cadence와 dropped frame
- filter/zoom interaction latency
- main-thread long task
- heap baseline과 장시간 증가 추세
- reconnect 후 중복·gap
- visible point와 buffer 상한 준수

