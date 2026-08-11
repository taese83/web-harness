# Analytics Test Matrix

## Semantic fixtures

- valid/invalid metric-dimension 조합
- aggregation/value type 불일치
- empty, null, NaN/Infinity, long label
- low/max/high cardinality와 limit
- timezone/DST/time grain 경계
- stale catalog와 schema evolution

## Chart fixtures

- chart type별 최소 정상 데이터
- incompatible 전환과 설명 가능한 disabled reason
- Funnel denominator/ordered step
- Retention cohort/window/censoring
- Flow missing node/cycle/duplicate edge
- Table max rows와 keyboard navigation

## Dashboard fixtures

- add/remove/duplicate/reorder/resize
- dirty navigation과 저장 실패
- concurrent revision conflict
- config migration/recovery
- mobile/zoom 200%/keyboard/focus

각 Must requirement를 unit contract, API fixture, browser scenario 중 하나 이상에 연결한다. semantic fixture나 max-cardinality 기준이 없으면 PASS가 아니라 `BLOCKED`다.

