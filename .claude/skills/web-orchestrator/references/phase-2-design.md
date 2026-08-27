# Phase 2 — 디자인 (순서 있음)

`web-orchestrator`의 Phase 2 본문이다. **Phase 1 체크포인트를 통과한 시점에 읽는다**(선행 로드 금지).
SKILL.md 본문에서 시점 로드로 강등했다(2026-08-27) — 강등 근거와 한계는 `docs/protected-core.md` §4.

Phase 2를 시작하기 전에 `references/artifact-sharding-contract.md`를 읽는다. 이 Phase의 설계 산출물은 하류 5~18개 에이전트가 각자 다시 읽으므로 크기 예산과 분할 규칙을 지켜야 한다. designer 계열 agent prompt에 이 계약 경로를 함께 전달한다. **디자인 원칙 허브 `references/design-principles.md`의 경로도 designer 계열 agent prompt에 함께 전달한다** — 각 agent는 허브의 소비자 맵에서 자기 담당 절만 읽고 그 수치·규칙을 기본값으로 쓴다(사용자 브랜드 제약이 이기되 접근성 하한은 협상 불가). **Phase 1·2 각 Wave 완료 시 `node .claude/scripts/validate-artifact-sharding.mjs --project {project-root}`를 실행하고 exit 1이면 해당 designer를 다시 실행해 분할한 뒤 진행한다** — 산문 판단이 아니라 바이트 측정이 판정 근거다.

**Wave 0 — TIMESERIES_MODE 조건부 선행**:
- `timeseries-architect` → `_workspace/02_design/timeseries-architecture.md`

**Wave 0-B — ANALYTICS_BUILDER_MODE 조건부 선행**:
- `analytics-domain-architect` → `_workspace/02_design/analytics-architecture.md`
- TIMESERIES_MODE도 활성화되면 point/timestamp/budget은 timeseries architecture를 재사용한다.

**Wave 0-A — EXTERNAL_DATA_INGESTION_MODE 조건부 선행**:
- `ingestion-contract-designer` → `_workspace/02_design/ingestion-contract.md`, `_workspace/02_design/runtime-data-contract.json`
- profile capability에 `external-ingestion`을 추가한다. mode가 `static-snapshot`이고 scheduled refresh이면 `scheduled-static-ingestion`도 추가한다. 두 계약이 모두 생성되기 전에는 profile resolver와 구현을 실행하지 않는다

**Wave 1** — 병렬 실행 (활성화된 Wave 0/0-A 완료 후):
- `design-system-architect` → `_workspace/02_design/design-system.md`
- `layout-designer` → `_workspace/02_design/layout-spec.md`
- `api-schema-designer` → `_workspace/02_design/api-schema.md`
- `LOCAL_DOMAIN_STATE_MODE`이면 `state-contract-designer` → `_workspace/02_design/state-contract.md`. 성능 예산 요구·`TIMESERIES_MODE`·공개 서비스이면 `performance-budget-designer` → `_workspace/02_design/performance-budget.md`

**Wave 2** — 단독 실행 (design-system.md + layout-spec.md 존재 후). **프리뷰 전에 방향 승인이 선행한다** — `design-approval-contract.md` 0단계(**자유 렌더 후보 3종 → 사용자와 왕복 조정**, 2026-08-23 개정). 확정 후 시스템 추출 → 그다음 프리뷰. 방향 기각을 프리뷰에서 받으면 5배 비싸다(실측):
- `component-designer` → `_workspace/02_design/component-spec.md`. 완료 후 `design-approval-contract.md`의 **Design Preview Loop**를 기본 실행한다: `design-preview-builder` → `validate-design-preview.mjs --write-source-snapshot`으로 FEAT/TC/DOM trace와 입력 digest 고정 → `preview-server.mjs` 서빙 → 피드백은 스펙에 먼저 반영 후 재생성(≤3라운드) → 명시적 사용자 승인 뒤 `validate-design-preview.mjs --record-approval`로 승인 해시 기록
- `VISUAL_QA_MODE`이면 `visual-contract-designer` → `_workspace/02_design/visual-qa-contract.md`, `visual-qa-contract.json`

**Wave 3 — 조건부 디자인 검토**:
- `design-approval-contract.md`에 따라 기존 디자인 inventory와 `DESIGN_PROTOTYPE_MODE`를 판정한다.
- L/XL 또는 prototype mode이면 read-only `design-reviewer`를 실행해 `_workspace/02_design/design-review.md`에 저장한다.
- `NEEDS_DECISION`은 Phase 2 체크포인트에서 최대 3개씩 확인하고 `BLOCKED`면 구현하지 않는다.
