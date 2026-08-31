---
name: feature-add
description: [내부] change 레인에서 /wh가 호출한다. 사용자 진입점은 /wh 하나다 — 직접 호출하면 레인 표시와 게이트 안내를 받지 못한다. Adds a new feature to a completed web-harness project following FSD architecture. Runs the planning → design → development → QA mini-cycle for the new feature only. Use after /web-orchestrator completes.
argument-hint: "[feature request]"
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Write, Edit, Bash, Agent, AskUserQuestion
metadata:
  version: 1.5.0
  maturity: eval-covered
  updated: 2026-08-03
  changelog: 수정 라운드 게이트 3종 도입 — 04_qa receipt 재발급 의무, capabilities 승격 감지 시 security-reviewer/api-contract-verifier 재투입, canonical 문서(02_design) 동기화를 라운드 종료 조건으로 강제 (회귀 평가 회고 반영).
---

# Feature Add

> **이 스킬은 `change` 레인의 구현 세부다.** 사용자 진입점은 `/wh` 하나이며 레인 판정·표시와
> 승인 게이트는 `request-type-contract.md`·`approval-checkpoints.md`가 소유한다. 여기서
> 다시 정의하지 않는다 — **아래 체크포인트 서술이 그 두 계약과 어긋나면 그 두 계약이 정본이다.**
> `fix` 자기검사와 레인 표시 의무는 이 경로에도 동일하게 적용된다.

완성된 프로젝트에 새 기능을 기획 → 디자인 → 개발 → QA 미니 사이클로 추가한다.

Read `.claude/skills/web-orchestrator/references/request-type-contract.md` before selecting the mini-cycle. Before the first source edit, read `.claude/skills/web-orchestrator/references/scenario-contract.md`, `.claude/skills/web-orchestrator/references/design-approval-contract.md`, `.claude/skills/web-orchestrator/references/minimal-change-contract.md`, `.claude/skills/web-orchestrator/references/integration-overlay.md`, `.claude/skills/web-orchestrator/references/change-journal-contract.md`, and `.claude/skills/web-orchestrator/references/development-gates-contract.md`.

## Start

`/feature-add`를 호출하면:

> 어떤 기능을 추가할까요? 어느 화면에 붙는지, 현재 없는 이유(기획 미완, 우선순위 후순위 등)도 알면 더 정확하게 설계할 수 있어요.

인자(`/feature-add 기능명`)가 있으면 별도 질문 없이 바로 기획 단계로 넘어간다.

먼저 `REQUEST_TYPE`을 판정한다. `ui-change`, `bug-fix`, `refactor`, `api-integration`, `verification-only`면 전체 기능 mini-cycle을 강제하지 않고 해당 contract의 간소 흐름으로 전환한다. 판정이 수정 범위를 크게 바꿀 때만 확인한다.

---

## Phase 1 — 기획

기능 설명을 바탕으로 다음을 분석한다:

- **인수 조건(Must)**: "이렇게 되면 Done"을 검증 가능한 동작으로 기술한다
- **제외 항목(Won't)**: 이번 작업 범위 밖임을 명시해 scope 확대를 방지한다
- **엣지 케이스**: 빈 데이터, 권한 없음, 로딩 실패, 경계값 등 처리해야 할 예외 상황
- **영향 범위**: 변경이 예상되는 기존 화면/컴포넌트/API
- **시나리오**: `.claude/skills/web-orchestrator/references/scenario-contract.md`에서 관련 카테고리만 선택한 정상·실패·경계 동작

분석이 끝나면 **반드시** 사용자에게 확인을 받는다. 확인 없이 디자인 단계로 넘어가지 않는다.

```
📋 기획 확인 — 설계 전에 검토해주세요

기능: {기능명}
붙는 화면: {화면/페이지}

인수 조건 (이렇게 되면 완료):
  ✓ {검증 가능한 동작 1}
  ✓ {검증 가능한 동작 2}

제외 항목 (이번 범위 밖):
  • {Won't 항목}

처리할 엣지 케이스:
  • {케이스 목록}

영향받는 기존 기능:
  • {기존 화면/컴포넌트/API — 없으면 "없음"}

→ 수정이 필요한 항목이 있으면 알려주세요. 맞으면 설계를 시작합니다.
```

사용자가 수정을 요청하면 해당 항목을 반영하고 다시 보여준다.

**기획 write-back** (`.claude/skills/web-plan/references/plan-history-contract.md`): 기획 확인이 완료되면 `_workspace/01_plan/`이 존재하는 프로젝트에서 다음 세 가지를 한 세트로 수행한다 — ① `feature-planner` 경량 재호출로 `feature-plan.md`의 Feature List 표 현재화(신규면 `FEAT-NNN` 부여, 변경이면 해당 행 수정) ② 요구 수준 변경이면 `requirements-analyst` 경량 재호출로 `requirements.md` 해당 REQ 절 갱신 ③ `planning-facilitator`가 `decision-log.md`에 `PC-NNN` 엔트리 append(트리거: 기능 변경). `_workspace`가 없는 legacy 프로젝트는 change-scope.md에 사유를 남기고 생략한다. 이 write-back 없이 구현으로 넘어간 기능 변경은 미기록 변경이며 code-reviewer 검사 대상이다.

---

## Phase 2 — 디자인

기획 확인이 완료되면 다음을 설계한다:

- **FSD 슬라이스**: `/fsd-scaffold` 결정 트리 적용 → 레이어/슬라이스 경로와 이유를 한 줄로 결정
- **컴포넌트 트리**: 신규 컴포넌트 vs 기존 재사용 구분, Props 인터페이스
- **API/데이터**: 새 엔드포인트가 필요하면 메서드·경로·req/res 스키마 초안. 기존 API 재사용이면 어느 queryOptions를 쓰는지 명시
- **UX 상태**: loading / error / empty / success 각각 어떻게 보이는지 한 줄씩 기술
- **MSW 핸들러**: Mock API가 있으면 추가할 핸들러 경로 목록
- **기존 디자인 inventory**: UI library, theme, shared component, 유사 화면
- **레이아웃 전략**: 동적 요소가 나타날 때 고정 영역과 가변 영역
- **기존 결함 개선 제안 (해당 시)**: 작업 중 발견한 기존 코드·구조·레이아웃 결함과 개선 제안 —
  문제점·영향·범위를 명시하고 **사용자 승인 없이는 수행하지 않는다** (`minimal-change-contract.md` 게이트)
- **요청 외 변경 (해당 시)**: 요청에 없는 외형·문구·동작 변경 — 기본은 없음(baseline 보존).
  다른 화면·프로젝트 패턴 참조 시 따라오는 부수 속성도 여기에 명시하고 승인받는다

설계가 끝나면 **반드시** 사용자에게 확인을 받는다. 확인 없이 구현을 시작하지 않는다.

```
🎨 설계 확인 — 개발 전에 검토해주세요

FSD 슬라이스:
  신규: src/features/{slice}/
        └── ui/{Component}.tsx
        └── model/{store|hooks}.ts
        └── index.ts
  수정: src/pages/{Page}.tsx
  수정: src/mocks/handlers/{feature}.ts  (MSW 핸들러)

컴포넌트:
  신규: {ComponentName} — {역할 한 줄}
  재사용: {ExistingComponent} — {어디서 가져오는지}

API:
  {GET|POST} {/path} — {설명}  (신규 없으면 "기존 API 재사용")

UX 상태:
  loading: {스피너 / 스켈레톤 등}
  error:   {에러 메시지 / 재시도 버튼 등}
  empty:   {빈 상태 안내 문구 등}
  success: {정상 렌더링}

→ 구조나 API에 수정이 필요하면 알려주세요. 맞으면 개발을 시작합니다.
```

사용자가 수정을 요청하면 해당 항목을 반영하고 다시 보여준다.

---

## Phase 3 — 개발

디자인 확인이 완료되면 `_workspace/03_dev/change-scope.md`에 다음을 기록한다. 이 brief를 모든 owner와 `code-reviewer`에 전달한다.

```markdown
CHANGE_MODE: existing-change
REQUEST: {기능명}
TARGET_BEHAVIOR: {Phase 1 인수 조건}
ALLOWED_PATHS: {Phase 2에서 확정된 파일 목록}
PUBLIC_CONTRACTS_TO_PRESERVE: {기존 props/route/state}
NON_GOALS: {Phase 1 제외 항목}
CHANGE_BUDGET: {신규 N파일, 수정 M파일}
TEST_EVIDENCE: {인수 조건별 검증 방법}
CAPABILITY_ESCALATION: {none | detected: {신호 목록}}
DOCS_TO_UPDATE: {변경과 충돌하는 02_design canonical 문서 목록 — 없으면 none}
```

**capabilities 승격 감지 (기록 필수)**: 이번 변경이 다음 신호 중 하나라도 만들면 `CAPABILITY_ESCALATION: detected`로 기록한다 —
① `api/` 등 서버 실행 경로 신규 생성 ② 인증·세션·DB·서버 SDK 의존성 추가(예: `jose`, `@neondatabase/*`, `pg`, `next-auth`, LLM SDK)
③ 클라이언트에서 자체 서버 엔드포인트로의 fetch/mutation 도입 ④ 외부 API 키를 소비하는 코드 추가.
detected면 project profile의 capabilities를 현재화하고, **Phase 4에서 `security-reviewer`와 `api-contract-verifier` 재투입이 의무**가 된다
(최초 생성 시 `capabilities: base`였다는 사실은 면제 사유가 아니다 — 승격된 표면은 승격된 QA를 받는다).

**canonical 문서 동기화 (라운드 종료 조건)**: TARGET_BEHAVIOR가 `_workspace/02_design/`의 canonical 계약
(state-contract·api-schema·layout-spec·component-spec·design-system)과 충돌하면 해당 문서를 `DOCS_TO_UPDATE`에 나열하고,
**문서 개정 완료 전에는 라운드를 DONE으로 선언하지 않는다**. change-scope.md 누적 기록은 canonical 문서의 대체물이 아니다 —
다음 라운드의 에이전트는 canonical 문서를 믿고 움직이므로, 갱신 없이 닫힌 라운드는 미기록 계약 변경으로 code-reviewer 검사 대상이다.

구현 순서:

1. entity의 queryOptions 추가 (새 API 엔드포인트가 있는 경우)
2. MSW 핸들러 추가 (Mock API가 있는 경우 — 빠뜨리면 dev에서 404)
3. feature 슬라이스 생성 (model → ui 순서)
4. 컴포넌트 구현
5. 라우트/페이지 연결

각 owner는 자기 `_workspace/03_dev/change-journal/{agent-name}.md`에 생성·수정·실패·증거를 기록한다. 실패 시 자동 restore하지 않고 `change-journal-contract.md`의 사용자 제어형 복구를 따른다.

연결 완료 후 `development-gates-contract.md`의 Gate C를 실행한다. `FAIL|BLOCKED`이면 Phase 4로 넘기지 않고 owning agent만 수정한다.

`TIMESERIES/EXTERNAL_DATA` 성격이면 각 detection-contract를 먼저 적용하고 해당 contract 완료 전 pipeline code를 만들지 않는다.

---

## Phase 4 — QA (생략 불가)

**4-1. 테스트 보강** (`developer` 실행):
- Phase 1 인수 조건 각 항목을 unit/integration/browser test로 커버한다
- 엣지 케이스(empty/error/boundary)를 fixture로 포함한다

**4-2. 빌드 검증**:
- 검증 명령은 receipt 래퍼로 실행해 기계 기록을 남긴다 (산문 "통과했다" 금지):
  ```bash
  node .claude/scripts/record-verification.mjs --project {project-root} --label build \
    -- pnpm --filter {pkg} build
  ```
  → `{project-root}/_workspace/03_dev/verification-receipts.jsonl`에 명령·exit·**cwd** 기록
  (잘못된 실행 위치에서 나온 가짜 green을 receipt가 드러낸다)
- 기존 모노레포에서는 repo 전체가 아니라 **변경 패키지 + 의존 소비자** 스코프로 실행한다
  (`pnpm --filter <pkg>`, affected 기준). 건드리지 않은 인접 워크스페이스는 사유와 함께 skip으로 기록
- 에러가 있으면 즉시 수정하고 재실행한다
- **04_qa receipt 재생성 (배포 대상 프로젝트, 생략 불가)**: `_workspace/04_qa/evidence/`가 있는 프로젝트에서는
  라운드 종료 전에 `node .claude/scripts/run-quality-gates.mjs --project {project-root} --all`로 receipt를 재발급한다.
  receipt의 `sourceFingerprint`는 발급 시점 소스에 결속되므로, 소스를 고치고 receipt를 남겨두면
  **그 시점부터 모든 evidence가 검증 불가(stale)** 상태가 된다 — "이전 라운드에서 통과했다"는 현행 소스에 대한 증거가 아니다.
  재발급이 불가능한 환경이면 결과 보고에 "QA evidence: STALE (재발급 필요)"를 명시하고 완료로 선언하지 않는다.

**4-3. 코드 리뷰** (`code-reviewer` subagent 실행):
- change-scope.md + 추가/수정 파일 목록 + 기능 설명을 컨텍스트로 전달한다
- `code-reviewer`는 source를 수정하지 않고 TypeScript, MUI selector, FSD import, CJK IME, a11y, 고아 파일,
  **중복 코드·기존 로직 재사용성**을 검사한다
- 결함(FAIL)이면 finding owner가 수정하고 빌드 검증부터 재실행한다
- **중복·재사용성 발견은 리팩토링 제안으로 보고**하고, 적용 여부는 사용자 확인 후 결정한다
  (`minimal-change-contract.md` 개선 게이트 — 과공통화 경계 포함)

**4-3b. 승격 QA (CAPABILITY_ESCALATION: detected인 경우 생략 불가)**:
- `security-reviewer` subagent를 재투입한다 — 신규·변경된 서버 표면(api/ 전수)을 대상으로,
  엔드포인트별 공통 가드 매트릭스(인증 가드 · body 크기 캡 · 입력 스키마 검증 · rate limit)를 확인한다.
  한 엔드포인트에 있는 방어가 형제 엔드포인트에 없으면 그 자체가 finding이다 (표면 균질성 원칙)
- 서버 계약이 생기거나 변경됐으면 `api-contract-verifier`도 재투입한다
- 이 단계 없이 서버 표면이 추가된 라운드를 닫는 것은 보안 검증 공백을 영구화한다 —
  검증 불가 환경이면 결과 보고에 "승격 QA: BLOCKED (사유)"를 남기고 사용자에게 알린다

**4-4. 런타임 검증** (`/run` 스킬 또는 직접 확인):
- dev server를 기동하고 추가된 기능을 직접 확인한다
- 확인 항목: 기능 정상 동작, 콘솔 오류 없음, 모바일/데스크탑 레이아웃, 엣지 케이스(빈 데이터, 에러)
- **인증 뒤 화면**이면 `.claude/skills/web-orchestrator/references/auth-verification-contract.md`를 따른다 —
  auth fixture(storageState)가 있으면 에이전트가 직접 확인(시작 시 인증 상태 assert 필수),
  없으면 사용자 확인으로 전환하고 "런타임 검증: 사용자 위임 (AUTH_REQUIRED)"로 보고한다
- 시각적 회귀(기존 기능 깨짐)가 발견되면 즉시 수정 후 재확인한다
- dev server 기동이 불가한 환경이면 "런타임 검증: SKIP (이유)"로 보고한다
- 에이전트가 dev server를 시작·중지할 때는 사용자에게 고지하고, 사용자가 보고 있는 세션의 서버는
  확인 없이 중지하지 않는다

**4-5. 결과 보고**:
```
QA 결과
├── 빌드:       PASS / FAIL
├── 코드 리뷰:  PASS / WARN / FAIL (항목 목록)
├── 승격 QA:    N/A / PASS / FAIL / BLOCKED (CAPABILITY_ESCALATION detected 시에만)
├── QA evidence: FRESH (재발급 완료) / STALE (재발급 필요 — 완료 선언 불가)
├── 문서 동기화: N/A / DONE / PENDING (DOCS_TO_UPDATE 잔여 시 완료 선언 불가)
├── 런타임 검증: PASS / FAIL / SKIP (이유)
└── 종합: PASS면 완료 / FAIL이면 수정 후 재실행

추가된 파일: src/features/xxx/...
수정된 파일: src/pages/...

배운 것 (gotcha, 해당 시):
└── {예상과 다르게 동작한 것 — 라이브러리 함정, 빌드 차이, API 특이점 등}
```

**gotcha 축적 규칙**: 작업 중 예상과 다르게 동작한 것을 발견했으면 완료 보고에 기록하고,
재발 가능성이 있으면 관련 skill/계약 문서에 반영할지 제안한다 (반영은 사용자 승인 후).
가장 가치 있는 skill 콘텐츠는 이런 실패 경험의 축적이다.

---

## 원칙

- 기획 → 디자인 각 체크포인트에서 사용자 확인 없이 다음 단계로 넘어가지 않는다
- 증상 우회가 아닌 root cause를 해결하는 smallest coherent change만 수행한다
- 기존 화면·기능의 관측 가능한 상태는 보존 계약이다 — 요청 외 변경 금지, 기존 결함의 개선은
  문제점을 알리고 승인받은 뒤에만 수행한다 (`minimal-change-contract.md` 9·10조)
- 변경 결과를 직접 관측할 수 없는 환경에서는 변경 가설을 한 번에 하나만 적용하고 사용자 확인 후 진행한다
- 새 슬라이스는 FSD import 방향을 준수한다 (pages → features → entities → shared)
- **features 간 공유 타입**은 feature 내부에 정의하지 않는다 — `shared/lib/` 또는 `entities/<domain>/model/`에 두고 각 feature가 shared에서 import한다
- Mock API가 있으면 새 엔드포인트 MSW 핸들러를 구현과 동시에 추가한다
- TypeScript 오류 또는 코드 리뷰 FAIL이 있는 채로 완료를 선언하지 않는다
- `ALLOWED_PATHS` 밖의 파일을 수정해야 하면 change-scope.md를 갱신하고 이유를 명시한 뒤 진행한다
