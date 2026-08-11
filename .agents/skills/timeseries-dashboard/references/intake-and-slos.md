# Timeseries Intake and SLOs

## 필수 입력

| 영역 | 확인 값 |
|---|---|
| 유입량 | 전체/series별 points per second, burst |
| cardinality | 최대 series, chart당 series, dashboard chart 수 |
| historical | 최대 조회 기간, 원본 보존 기간, 집계 resolution |
| live | transport, 허용 latency, 화면 갱신 주기 |
| 표시량 | chart당 visible point 상한, zoom 최소/최대 범위 |
| 정확성 | duplicate, out-of-order, gap, clock skew 정책 |
| 시간 | event time/ingest time, timezone, DST 처리 |
| 환경 | browser/device, tab 장시간 실행 시간, memory/CPU budget |
| 상호작용 | zoom, brush, crosshair, legend, pause, export, alert |

## 정보가 없을 때 제안할 Baseline

아래 값은 확정값이 아니라 초기 검증용 `ASSUMPTION`이다.

- dashboard: chart 6개, chart당 series 8개
- live ingest: series당 1 point/second, 10초 burst 허용
- render cadence: 최대 4회/second로 batch
- visible data: series당 2,000 points, chart당 16,000 points 상한
- historical: 24시간 기본, 7일 최대
- tab longevity: 8시간
- reconnect: jitter를 포함한 bounded exponential backoff
- memory: baseline 대비 지속 증가가 없는 bounded buffer

실제 목표가 baseline을 크게 초과하면 chart engine, aggregation, worker, backend query 계약을 다시 결정한다.

## Requirements에 추가할 SLO

```markdown
## Timeseries SLO
- TS-SLO-01 Live display latency:
- TS-SLO-02 Maximum dashboard series:
- TS-SLO-03 Maximum visible points:
- TS-SLO-04 Historical query p95:
- TS-SLO-05 Interaction latency while streaming:
- TS-SLO-06 Reconnect and resume recovery:
- TS-SLO-07 Eight-hour memory stability:
- TS-SLO-08 Gap/duplicate/out-of-order correctness:
```

SLO는 측정 환경, 데이터 fixture, PASS 임계값을 함께 정의해야 한다. "빠르게", "대용량" 같은 표현만 있으면 완료로 보지 않는다.

## 구현 전 BLOCKER

- 브라우저에 표시해야 할 point 수가 무제한
- event timestamp 단위와 timezone이 없음
- stream이 끊겼을 때 데이터 손실 허용 여부가 없음
- backend aggregation 가능 여부가 없음
- latency 목표와 render cadence를 구분하지 않음

