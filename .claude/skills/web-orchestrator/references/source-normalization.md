# Source Normalization

`source-artifact-ingestor`가 **획득된 원문을 `_workspace` 산출물로 바꿀 때** 따르는 규칙이다.
원문을 **어떻게 받는가**(공급 형태·인증 URL·Figma MCP·도구 부재)는 `source-artifacts.md`가 정본이며,
이 문서는 그 뒤 단계만 다룬다. 소비자는 `source-artifact-ingestor` 하나다.

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
- 여러 노드의 변수를 `design-system.md`로 합칠 때 **컬렉션을 통합하지 않는다.** 컬렉션별로 구분해
  적고 각 토큰에 출처 노드를 남긴다. 어휘를 하나로 고르는 것은 정규화가 아니라 사용자 결정이다.
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

## 일반화 근거

축은 **원문을 산출물로 바꿀 때 무엇을 옮기고 무엇을 갭으로 세우는가** 하나이며, 원문의
도구·도메인·산출 형태와 무관하다. 도메인 어휘가 들어올 자리가 없다 — 분류 이름 넷
(`INFO`·`ASSUMPTION`·`CONFLICT`·`BLOCKER`)과 산출물 경로뿐이다.

성립하는 형태 둘:

- **화면 단위가 route가 아닌 서피스**(대화 턴·카드형). 입력이 슬라이드 덱처럼 화면 명세가
  아닌 문서라도 같은 변환 규칙이 선다 — 화면 목록을 세울 수 없으면 그것이 `BLOCKER`이고,
  분류가 그 사실을 이름으로 낸다.
- **기존 route 화면의 기능 추가**(브라운필드). 입력이 이슈 트래커 티켓 본문 한 건이라도
  같은 규칙이 선다 — 원문이 말하지 않은 자리가 `ASSUMPTION`으로 남고 `BLOCKER`는 0이다.

두 형태는 서비스 형태(대화 턴 / route)와 입력 형태(덱 / 단일 티켓 본문) 양쪽이 다르고,
분류 규칙은 어느 쪽에도 형태별 분기를 갖지 않는다.

**증거의 등급(정직)**: 위 두 형태는 로컬 프로브에서 확인했고 **그 프로브는 커밋되지 않는다**
(`workspace/*`가 `.gitignore`에 있다). 그러므로 이 절의 실행 기록은 깨끗한 checkout에서
재현할 수 없는 **자기보고**이며, eval fixture로 승격되기 전까지는 그 등급이다 — 참조 서비스를
계약에 경로로 박지 않는 것이 I3 규율이라 경로를 인용하지 않는다.
**이 커밋에서 재현 가능한 것은 하나다**: 옮긴 네 절이 HEAD~ 대비 바이트 동등하다는 사실.

**이 커밋의 범위(정직)**: 규칙의 **이동**이다. 규칙 자체는 바뀌지 않았고 새 어휘도 없다 —
이동으로 달라지는 것은 누가 무엇을 읽는가뿐이다.
