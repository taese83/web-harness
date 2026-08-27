---
name: analytics-chart-builder
description: Designs, implements, and verifies semantic metric/dimension chart builders and editable dashboards. Use for BI-style query builders, chart-type switching, line/bar/table/funnel/retention/flow visualizations, panel configuration, dashboard layout editing, or analytics schema validation. Works with timeseries-dashboard when historical or realtime time-axis data is also required.
argument-hint: "[analytics builder requirements or existing project path]"
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Write, Edit, Bash, Agent, AskUserQuestion
metadata:
  version: 1.0.0
  maturity: eval-covered
  updated: 2026-07-27
  changelog: 최초 버저닝 — adapter 재생성·검증 체계 도입과 함께 일괄 부여.
---

# Analytics Chart Builder

메트릭·디멘션 기반 query와 차트 유형, panel 설정, dashboard 편집을 하나의 versioned 계약으로 설계한다. transport, reconnect, ring buffer는 `timeseries-dashboard`가 소유하며 중복 구현하지 않는다.

항상 `references/detection-contract.md`, `references/semantic-query-contract.md`, `references/chart-compatibility.md`, `references/dashboard-editor-contract.md`, `references/analytics-test-matrix.md`를 읽는다(코어). 아래는 **해당 기능이 요구될 때만** 읽어 고정 로드 비용을 늘리지 않는다:
- 차트 렌더 라이브러리 선정·구현: `references/chart-engine-adapter.md`, `references/chart-render-contract.md`
- 재사용/segment 필터: `references/segment-filter-contract.md`
- metric set 스왑: `references/metric-set-contract.md`
- 비동기 실행(제출→상태 폴링→결과) 쿼리: **새 계약을 만들지 않고** `../web-orchestrator/references/background-jobs-contract.md`와 timeseries `streaming-contract.md`의 bounded polling을 재사용한다(중복 구현 금지 — 위 §15).

기존 프로젝트면 `../web-orchestrator/references/minimal-change-contract.md`, `../web-orchestrator/references/integration-overlay.md`도 읽는다.

차트 렌더 라이브러리는 `chart-engine-adapter.md`의 **엔진-무관 경계**를 통과한다(도메인/AST에 엔진 import 금지). 상용 엔진(예: Highcharts)은 같은 문서의 **inform-and-choose**(라이선스 필요 고지 → 사용자 선택 → `decision-log` 기록)로만 채택하고, 기본은 무료 어댑터다.

## Start

다음 정보를 단계적으로 확인한다. 한 번에 최대 3개 질문만 한다.

1. 분석 사용자와 핵심 의사결정
2. metric/dimension catalog와 authoritative source
3. 필요한 aggregation/filter/group/order 기능
4. MVP chart type과 후속 chart type
5. dashboard 저장·공유·권한·version 요구
6. query budget, cardinality, 최대 panel 수

모르는 값은 검증 가능한 `ASSUMPTION`으로 기록한다. metric 의미, tenant scope, query execution 책임이 없으면 구현 전 `BLOCKER`다.

## Workflow

1. `requirements-analyst`가 `ANALYTICS_BUILDER_MODE`와 Must chart type을 기록한다.
2. `analytics-domain-architect`가 `_workspace/02_design/analytics-architecture.md`를 생성한다.
3. `api-schema-designer`가 catalog/query/preview/dashboard 계약을 runtime schema로 설계한다.
4. `component-designer`가 builder state machine과 chart별 configuration UI를 설계한다.
5. `developer` agent가 semantic query model, compatibility registry, builder/dashboard feature를 구현한다.
6. `developer`가 query result와 chart renderer를 연결한다.
7. `developer`가 semantic correctness와 chart compatibility fixture를 작성한다.
8. `analytics-verifier`, `api-contract-verifier`, `browser-verifier`가 독립 검증한다.

## Hard Stops

- metric 이름만 있고 계산식·단위·aggregation grain이 없음
- dimension의 타입·cardinality·허용 metric 관계가 없음
- Funnel step, Retention cohort/window, Flow node/link 의미가 없음
- client가 무제한 raw data를 받아 임의 집계하도록 요구함
- 저장 config version/migration 없이 persisted dashboard를 변경함

## 완료 조건

- query AST와 runtime schema가 하나의 source에서 파생된다.
- chart compatibility가 명시적 registry로 검증된다.
- invalid metric/dimension/chart 조합은 실행 전에 설명 가능한 오류로 거절된다.
- dashboard panel config에 version, stable ID, layout, query, visualization이 분리된다.
- normal/max-cardinality fixture와 empty/null/timezone/unit 시나리오가 테스트된다.
- timeseries가 함께 있으면 historical/stream point 계약을 재사용한다.
- dimension transform(bucket/lookup/topN)·per-metric filter는 catalog 허용 범위에서만 AST에 실린다.
- 재사용 subquery/segment 필터는 참조 id를 보존하고(무음 제거 금지) 같은 실행 타깃에서만 조인된다.
- metric set은 2-set 이상 뷰만 대상이며 충돌 시 first-wins가 결정적이다.
