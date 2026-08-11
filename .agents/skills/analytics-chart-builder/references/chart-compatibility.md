# Chart Compatibility Contract

chart type은 registry로 관리하고 `supports(query, resultSchema)`를 통해 선택 가능 여부와 이유를 반환한다.

| Chart | 최소 요구 | 핵심 제약 |
|---|---|---|
| line | ordered x + numeric metric | time/category order, null policy |
| bar | category/time + numeric metric | category/series 상한 |
| table | columns + rows | virtualization, sort source |
| funnel | ordered steps + population | step 정의, denominator, drop-off |
| retention | cohort + period offset + rate/count | cohort timezone, window, censoring |
| flow | node + source/target + weight | cycle, unknown node, edge aggregation |

## 확장 (개방형 registry)

위 표는 **seed set**이며 chart type 개수를 고정하지 않는다. adapter가 `supports(spec, resultSchema)`로
추가 type을 선언하고, 새 type 추가는 [adapter 항목 + 이 표 항목 + renderer] 3곳 동기화로 끝난다.
data-viz 선택 매트릭스의 관계(area·treemap·sankey·heatmap·boxplot·gauge 등)는 필요 시 이 registry로 승격한다.

렌더 엔진 결합은 `chart-engine-adapter.md`(엔진-무관 경계)가, 렌더러 수명주기·대용량·null 정책은
`chart-render-contract.md`가 소유한다.

## 원칙

- 지원하지 않는 전환은 disabled 이유를 제공한다.
- null을 0으로 임의 변환하지 않는다.
- percent와 raw count, event time과 ingest time을 혼합하지 않는다.
- renderer-specific option을 persisted semantic query에 넣지 않는다.
- Funnel/Retention/Flow는 일반 line/bar response를 억지로 재사용하지 않고 전용 result schema를 가진다.

