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
- **판본이 여럿이면 최신판이 정본이다.** 근거는 ① 문서 자신의 변경 이력(이름은 문서마다 다르다)
  ② 명시적 버전 표기 순. 둘 다 없으면 고르지 말고 `QUESTION`으로 묻는다. 채택은 `CONFLICT`로 남기고
  구판은 지우지 않는다(`decision-log.md`에 대체 관계).
- **원문이 "스펙아웃"·"제외"·"보류"로 표시한 항목은 요구사항으로 세우지 않는다** — 주석을 달아 남기면
  하류가 살아 있는 요구로 읽는다. `Won't`로 옮기고 Source Trace에 표시 위치를 남긴다 — 지우면
  "작성자가 제외했다"와 "원문에 없었다"를 구별할 수 없다.
- Convert design screens to routes and page responsibilities in `layout-spec.md`.
  `SURFACE_MODEL: overlay`(`project-brief.md` 선언)면 route가 아니라 **서피스 맵**으로 변환한다
  — 어휘와 커버 범위는 `.claude/agents/layout-designer.md`「서피스 모델」이 정본이다.
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
- `ASSUMPTION` — **표현 기본값**만. 아래 경계를 지킨다.
- `QUESTION` — 원문 작성자에게 물어야 답이 나오는 것. 아래 「질문지」로 옮긴다.
- `CONFLICT` — two sources disagree; the chosen source and reason are recorded.
- `BLOCKER` — implementation should not continue without user input.

### `ASSUMPTION`과 `QUESTION`의 경계 — 지어낸 것은 묻는다

가르는 축은 **시안·계약이 오면 자동으로 대체되는가, 아니면 원문 작성자만이 답을 바꿀 수 있는가**다.
규모도 확신도도 아니다. **아래는 예시이지 분류표가 아니다** — 같은 항목이 서비스에 따라 갈린다.
브랜드 가이드가 계약인 서비스에서 색 토큰은 제품 결정이고(`source-artifacts.md`「Figma MCP」 절차 5가
팔레트→역할 매핑을 되묻게 하는 것과 같은 이유), 사내 관리자 도구에서 오류 문구는 i18n 키 자리표시자다.

- **제품 결정**(무엇을·언제·어떤 규칙으로·무슨 문구로) → **`QUESTION`**. 예: 재방문자에게 온보딩을
  다시 보일지, 한도 초과를 막을지 경고만 할지, 오류 문구
- **표현 기본값**(시안·계약이 오면 대체되는 자리표시자) → `ASSUMPTION`. 예: 색·타이포·간격 토큰,
  mock fixture 스키마, 파일 배치

**"일반적 관행이니까"는 `ASSUMPTION`의 사유가 될 수 없다** — 관행은 근거가 아니라 추측인데
`ASSUMPTION` 딱지가 붙으면 검토자는 이미 판단된 것으로 읽는다. 확신이 높아도 제품 결정이면
묻는다(실측 2026-09-07: "재방문자에게 온보딩 재노출 안 함"이 *일반적 관행*을 사유로 TC가 됐다).

Treat these as `BLOCKER` unless the user explicitly allows assumptions:

- no target screen list and no way to infer routes
  (**`SURFACE_MODEL: overlay`면 이 항목을 적용하지 않는다** — 화면 단위가 route가 아닌 것은
  결함이 아니라 선언된 형태다. 화면 목록 자체가 없으면 그때는 여전히 `BLOCKER`다)
- no primary user role or audience for a role-sensitive app
- design contradicts required feature scope
- API requires real credentials or production mutations
- existing target directory contains unrelated user files

## 질문지 — `00_source/author-questions.md`

`QUESTION`과 답이 필요한 `BLOCKER`·`NEEDS_DECISION`을 **원문 작성자가 그대로 읽고 답할 수 있는
문서**로 옮긴다. `gap-report.md`는 하네스 내부 기록이고 이 파일은 밖으로 나가는 문서다 — 합치지 않는다.

**자기완결적이어야 한다.** 작성자는 `_workspace`를 읽지 않는다 — 하네스 어휘(FEAT·TC·`PAGE-NNN`)를
설명 없이 쓰지 말고 **원문의 말로** 묻는다. 항목마다: `Q-NNN`(gap-report 상호 참조) · 질문 한 문장 ·
**원문 위치**(p.N·절 이름) · 답이 없으면 무엇이 막히는지 한 줄 · 선택지(있으면, **"둘 다 아님·모르겠음"을
항상 포함** — 선택지만 주면 유도가 된다) · `막음`/`나중`.

**`막음`은 `gap-report.md`의 `BLOCKER`와 같은 항목이다** — 질문지에만 있고 gap-report에 없으면
아무것도 멈추지 않는다(완료 조건과 오케스트레이터는 `BLOCKER`만 본다 — 둘 다 산문 규칙이다).
두 곳에 같은 항목을 두고 `Q-NNN`으로 상호 참조한다. `나중`은 진행을 허용하지만 **사유 없는
`ASSUMPTION`이 되어서는 안 된다** — 해당 항목은 정규화 산출물에 `QUESTION(Q-NNN)` 마커로 남겨
결정 없이 구현하면 안 되는 자리를 표시한다. 마커 없이 항목만 빠지면 발명이 사라지는 것이 아니라
**하류로 무표시 이동**한다(feature-planner·developer가 라벨 없이 채운다).

**0건이면 파일을 만들지 않고** `gap-report.md`에 `INFO`로 남긴다(`design-binding.json`과 같은 규율 —
만들지 않은 것과 묻지 않은 것을 구분한다). **답이 와도 원문은 고치지 않는다** — `decision-log.md`에
출처(누가·언제)와 함께 기록하고, 원문 수정은 `source-change-proposals.md`에 제안으로 남긴다.

### 이 절의 강도 — 기계 둘, 사람 하나, 나머지 산문

**기계가 보는 것은 둘뿐이다** — `validate-planning-facilitation.mjs`의 파일별 마커 검사와
`validate-contract-hygiene.mjs`의 `## 일반화 근거` 헤딩 검사. 변환 규칙·갭 분류·질문지 형식·
Source Trace 형식은 **전부 미검사**다.

**사람 탐지망은 하나 있다.** `plan-reviewer`가 `00_source/`의 `ASSUMPTION`/`QUESTION` 분류와
`QUESTION(Q-NNN)` 마커를 검토 항목으로 갖는다(`.claude/agents/plan-reviewer.md`). 그 판정은
read-only 지적이지 게이트가 아니며, **`QUESTION(Q-NNN)` 마커를 읽는 기계 소비자는 여전히 0이다.**
이 축은 `provenance-contract.md`의 `supplied` 자기보고와 같은 등급이고 `docs/protected-core.md`
§4에 등록한다.

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

**어디까지 실행됐는지 정직하게**: 위 두 형태에서 실제로 발화한 것은 **갭 4분류**
(`INFO`·`ASSUMPTION`·`CONFLICT`·`BLOCKER`)와 판본 선택까지다. **`QUESTION`·질문지·
`막음`/`나중`·`QUESTION(Q-NNN)` 마커는 어느 쪽에서도 실행된 적이 없다** — 두 프로브 모두 이
규칙이 생기기 전에 돌았다. 그 부분은 **명명 수준**이고 eval 시나리오에도 등록되지 않았다.
신설의 계기는 그 프로브 하나에서 "재방문자에게 온보딩 재노출 안 함"이 *일반적 관행*을 사유로
`ASSUMPTION`이 되어 TC까지 간 것이다 — 제품 결정이 표기 없이 하류로 넘어갔다.
