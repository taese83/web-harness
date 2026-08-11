# Dashboard Editor Contract

```ts
type DashboardConfig = {
  schemaVersion: number
  id: string
  title: string
  revision: string
  panels: PanelConfig[]
}

type PanelConfig = {
  id: string
  title: string
  layout: {x: number; y: number; w: number; h: number}
  query: AnalyticsQuery
  visualization: VisualizationConfig
}
```

## 상태

`viewing → editing-clean → editing-dirty → saving → saved | conflict | failed`

- edit/view mode를 분리한다.
- stable panel ID를 사용하고 array index를 identity로 쓰지 않는다.
- drag/resize는 grid bounds와 최소 크기를 검증한다.
- 저장 실패 시 draft를 유지한다.
- revision/ETag 충돌 시 overwrite하지 않고 reload/duplicate/merge 선택을 제공한다.
- schemaVersion migration과 invalid config recovery를 정의한다.
- unsaved navigation, undo/redo 범위, responsive layout source를 명시한다.

