# Chart Render Lifecycle Contract

렌더러 인스턴스의 수명주기·성능·안정성 규칙. 엔진 무관이며 모든 `ChartEngineAdapter`가 지킨다.
BI 렌더링에서 값비싸게 얻는 실패 패턴을 계약으로 선반영해 각 프로젝트가 재발명하지 않게 한다.

## 대용량 시리즈

- series/카테고리 수에 **상한 + "기타" 병합**을 전 chart type에 적용한다(특정 type만이 아니라).
  상한 초과 시 top-N + 나머지 집계로 축약하고, **축약 사실을 사용자에게 고지**한다(무음 절단 금지).
- 상한값은 config(엔진·chart type별)로 두고 코드에 박지 않는다.

## 인스턴스 재생성

- 부분 업데이트(`update`류)로 안전하게 반영되지 않는 변경군(chart type 전환, 특정 시각화 계열)은
  adapter가 **destroy+recreate 대상으로 선언**한다 — 임의 hack이 아니라 adapter 메타데이터로.
- 마운트 해제·리렌더에서 엔진 인스턴스를 **명시적으로 정리**한다(leak 금지).

## 데이터 정직성

데이터 표현 규칙(null≠0, percent·raw count / event·ingest time 혼합 금지)은 `chart-compatibility.md`가
소유한다 — 여기서 중복 정의하지 않는다. 렌더러는 그 규칙을 지키되, **렌더 상태**로서
empty/loading/error를 chart-shaped placeholder로 구분 표시한다("데이터 없음" ≠ 0).

## 모션·재렌더

- `prefers-reduced-motion: reduce`면 애니메이션을 끈다.
- 데이터 변경과 무관한 UI 토글이 차트 데이터 렌더를 재유발하지 않도록 상태를 분리한다
  (UI 상태와 데이터 상태 분리 — 광범위 리렌더 방지).

## 검증

- browser QA: 상한 초과 시 축약+고지, reduced-motion 무애니메이션, empty/error placeholder,
  type 전환 후 인스턴스 정리(누수 없음).

## 일반화 근거

서로 다른 서비스 형태에 같은 계약이 성립함 — **명명 수준**(fixture 검증 전):

- 다인원 시리즈를 그리는 BI/모니터링 대시보드 — 대용량 축약+고지·인스턴스 재생성 규칙이 주 대상.
- 문서/블로그에 삽입되는 임베드 차트 위젯 — empty/error placeholder·reduced-motion·정리(leak) 규칙이 주 대상.

두 형태 모두 lifecycle 규칙 전체를 소비하며, 상한값만 config로 달라진다.
