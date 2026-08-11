# Source Artifacts Reference

Use this reference when the user already has planning, design, API, or product documents.

## Accepted Inputs

| Artifact type | Examples | Normalized output |
|---|---|---|
| Product planning | PRD, requirements, business rules, acceptance criteria | `_workspace/01_plan/planning-context.md`, `requirements.md`, `project-brief.md` |
| UX planning | IA, sitemap, user flows, personas, jobs-to-be-done, annotated screenshots | `_workspace/01_plan/ux-brief.md`, `feature-plan.md` |
| Tech planning | stack decision, browser support, deployment target, constraints | `_workspace/01_plan/tech-stack.md` |
| Visual design | Figma export, screenshots, screen specs, design QA notes | `_workspace/02_design/layout-spec.md`, `component-spec.md` |
| Design system | tokens, typography, color, spacing, component inventory | `_workspace/02_design/design-system.md` |
| API/data | OpenAPI, endpoint table, sample JSON, ERD, mock data | `_workspace/02_design/api-schema.md` |
| Timeseries | metric schema, stream protocol, dashboard query, retention, aggregation, performance SLO | `_workspace/02_design/timeseries-architecture.md` and related plan/design files |

## Recommended Input Layout

Prefer local, explicit paths:

```text
_inputs/
  planning/
    prd.md
    user-flows.md
    acceptance-criteria.md
  design/
    design-system.md
    screen-spec.md
    screens/
      dashboard.png
      users-list.png
  api/
    openapi.yaml
    sample-responses.json
```

If the user only has Figma, ask for one of:

- exported screen images for each key screen
- design tokens or style guide text
- screen-by-screen notes with component names, states, and interactions
- a pasted Figma summary if direct Figma access is unavailable

Do not assume a remote Figma/Notion/Google Docs URL is readable unless the runtime has access to its contents. If content is not accessible, ask for exported or pasted material.

Figma Remote MCP access가 명시적으로 승인·가용하면 frame/component/variable context와 node ID를 source inventory에 기록한다. Code Connect가 있으면 design component와 실제 code component mapping을 보존한다. 외부 전송과 seat/plan 제약을 확인하고, 연결 실패 시 export/hash 경로로 되돌아간다.

## Source Immutability

Treat existing planning, design, API, and product artifacts as read-only source of truth.

- Do not modify, rename, move, reformat, or delete original source files.
- Do not “fix” PRD, design, OpenAPI, screenshots, or exported files in place.
- Write normalized outputs only under `_workspace/01_plan` and `_workspace/02_design`.
- Write source inventory and traceability under `_workspace/00_source`.
- If source changes are needed, write proposals to `_workspace/00_source/source-change-proposals.md`.
- Only modify originals when the user explicitly asks for original-file edits as a separate task.

## Source Priority

When documents conflict:

1. Explicit user instruction in the current request wins.
2. PRD/requirements win for business rules and feature scope.
3. API/OpenAPI wins for request/response shapes.
4. Design files win for layout, visual hierarchy, spacing, and component placement.
5. Existing `_workspace` files win only when no newer external source is provided.

Record every conflict in `_workspace/00_source/gap-report.md`.

## Source Change Proposal Format

Use `_workspace/00_source/source-change-proposals.md` for suggested original-source changes:

```markdown
# Source Change Proposals

| Source | Section | Issue | Proposed change | Reason |
|---|---|---|---|---|
| `_inputs/api/openapi.yaml` | `GET /users` | response conflicts with sample JSON | align `status` enum with sample | implementation type safety |
```

## Normalization Rules

- Preserve the user's terminology for domain entities, menu labels, and business concepts.
- Convert design screens to routes and page responsibilities in `layout-spec.md`.
- Convert reusable UI patterns to `component-spec.md`.
- Convert visual tokens to `design-system.md`; if tokens are missing, mark defaults as `ASSUMPTION`.
- Convert API tables/OpenAPI/sample JSON to `api-schema.md`; if no API exists, use MSW-only mock endpoints and mark them as `ASSUMPTION`.
- Convert acceptance criteria to feature completion checks in `feature-plan.md`.
- Normalize target screen, primary user task, current pain, observable success, annotation intent, critical states, data strategy, and effort trade-off into `planning-context.md`.
- Apply `../../web-plan/references/planning-facilitation-contract.md` and `planning-readiness-contract.md`; missing product context or conflicting annotations remain `NEEDS_DECISION | BLOCKER`.

## Gap Categories

Use these labels in `gap-report.md`:

- `INFO` — useful context missing, but development can continue.
- `ASSUMPTION` — a reasonable default was chosen and documented.
- `CONFLICT` — two sources disagree; the chosen source and reason are recorded.
- `BLOCKER` — implementation should not continue without user input.

Treat these as `BLOCKER` unless the user explicitly allows assumptions:

- no target screen list and no way to infer routes
- no primary user role or audience for a role-sensitive app
- design contradicts required feature scope
- API requires real credentials or production mutations
- existing target directory contains unrelated user files

## Source Trace Format

Add this section to each normalized output:

```markdown
## Source Trace

| Section | Source | Notes |
|---|---|---|
| 화면 목록 | `_inputs/design/screen-spec.md#Dashboard` | route로 변환 |
| 결제 상태 | `_inputs/planning/prd.md#Billing` | business rule |
```
