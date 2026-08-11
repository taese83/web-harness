# Semantic Query Contract

## Catalog

```ts
type MetricDefinition = {
  id: string
  label: string
  valueType: 'number' | 'duration' | 'currency' | 'percent'
  unit?: string
  defaultAggregation: 'sum' | 'avg' | 'min' | 'max' | 'count' | 'distinct-count'
  allowedDimensions: string[]
  allowedTimeGrains?: string[]
  allowsRowFilter?: boolean // per-metric where(필터드 measure) 허용 여부
}

type DimensionDefinition = {
  id: string
  label: string
  valueType: 'string' | 'number' | 'boolean' | 'date' | 'datetime'
  cardinality: 'low' | 'medium' | 'high'
  filterOperators: string[]
  allowedTransforms?: ('bucket' | 'lookup' | 'topN')[] // 아래 Transforms
}
```

catalog은 backend 또는 versioned schema가 authoritative하다. label이나 화면 순서를 계산 의미로 사용하지 않는다.

## Query AST

metric, dimensions, groupBy, filters, timeRange, timeGrain, order, limit을 serializable discriminated schema로 정의한다. UI local state와 API request를 별도 hand-written type으로 중복하지 않는다.

## Validation

- metric과 dimension allowlist
- aggregation과 value type 호환
- time grain과 range 호환
- high-cardinality limit
- filter operator와 dimension type 호환
- tenant/service scope
- query cost estimate와 cancellation

client는 presentation validation을 제공하지만 권한·cost·semantic correctness는 server도 검증해야 한다.

## Transforms (선택)

catalog가 허용한 경우에만 AST에 실린다. renderer 옵션이 아니라 **query 의미**의 일부다.

- **bucket** — 수치 dimension을 구간으로. `{ kind:'bucket', width | bounds }`. bounds/width가 유효하고 valueType이 number일 때만.
- **lookup** — 값→라벨/코드 매핑(표시용). **계산 의미로 쓰지 않는다** — 정렬·집계는 원값 기준. lookup source(맵/조인 키)를 명시.
- **topN(dimension-level)** — 특정 metric 기준 상위 N + 나머지 집계("기타"). order metric·N·나머지 병합 정책 필수. AST 전역 `order`+`limit`과 구분(그건 결과 정렬).
- **per-metric filter** — `allowsRowFilter`인 metric에 한해 measure별 where. operator↔dimension type 호환 검증. 전역 filters와 별개로 그 metric에만 적용.

## 재사용 필터 · metric set

- 재사용 가능한 **subquery/segment 필터**(set-membership 조인)는 `segment-filter-contract.md`가 소유한다.
- 런타임 **measure 스왑 세트**는 `metric-set-contract.md`가 소유한다.
두 계약 모두 위 AST/catalog를 재사용하고 별도 hand-written type을 만들지 않는다.
