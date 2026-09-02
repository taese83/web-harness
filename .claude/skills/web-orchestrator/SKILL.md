---
name: web-orchestrator
description: [내부] Master orchestrator for building or extending any supported React/Vite or Next.js web application from a natural-language request or existing artifacts, including crawling, scheduled external-data ingestion, local domain state, AI, planning, implementation, QA, CI, and release evidence. 사용자 진입점은 /wh 하나다. Invoked by /wh for a complete service or cross-lifecycle web change.
argument-hint: "[service description or artifact paths]"
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Write, Edit, Bash, Agent, AskUserQuestion
metadata:
  version: 1.7.0
  maturity: eval-covered
  updated: 2026-09-02
  changelog: 공급원(provenance) 축 신설 — 기획·디자인·설계가 generated|supplied|absent 중 하나로 서고 Fresh Mode가 그 조합을 조립한다. 이전 — 디자인 발산 프로토콜(design-principles-research) 신설 + A/B 비교를 커밋된 단일 시안·근거 제시로 교체(멀티 시안은 opt-in).
---

# Web Orchestrator

**선행 로드**(시작 전 필독) — 앵커 안이 고정 진입 비용 전부다. 늘리려면 contract-hygiene ratchet(참조 수 + 바이트)이 막으므로 baseline을 의식적으로 갱신한다(I4).
<!-- always-read -->
- `references/interaction-contract.md`(질문·확인) · `references/request-type-contract.md`, `references/scenario-contract.md`(요청 유형·시나리오) · `references/operational-gotchas.md`(전 구간 금지·선행 조건) · `references/execution-contract.md`, `references/web-profile-contract.md`(실행 모드·프로필)
<!-- /always-read -->

**시점 로드** — 앵커 밖 계약은 전부 그 시점 직전에 읽는다(선행 로드 금지). **시점 표기가 곧 계약이다.**
- **Fresh mode 첫 intake 전** `../web-plan/references/planning-facilitation-contract.md`, `../web-plan/references/planning-readiness-contract.md` — Iterate/Resume mode는 Phase 1 intake를 반복하지 않으므로 읽지 않는다
- **첫 스폰 전** `references/execution-budget-contract.md` — 이후 **스폰이 끝날 때마다 결과 usage를 `_workspace/04_qa/execution-telemetry.json`에 기록한다** (usage 미제공 환경이면 `null`, 지어내지 않는다)
- **기존 source 변경 감지 시** `references/change-journal-contract.md`, `references/integration-overlay.md` · **첫 Phase 체크포인트 전** `references/approval-checkpoints.md` · **Phase 2 전** `references/design-approval-contract.md`와 디자인 원칙 허브 `references/design-principles.md` · **Phase 3 착수 전** `references/solution-design-contract.md` · **Phase 4 판정·release tier 보고 전** `references/release-tier-contract.md` · **완료 보고 전** `references/completion-contract.md`
- **재진입**(후속 턴·새 세션·압축 후 재관여)은 이 스킬 전체를 재로드하지 않는다 — `references/reentry-map.md`의 상황별 최소 로드가 정본이다. 전체 진입은 신규 서비스·모드 미판별에서만 필요하다

자연어 설명 하나 또는 기존 기획/디자인/API 문서로 완성된 웹 애플리케이션을 만든다. 입력 상태를 먼저 판별한 뒤 필요한 Phase만 실행한다.

(`references/execution-contract.md`·`references/web-profile-contract.md`는 위 선행 로드에 포함된다.) Read `references/source-artifacts.md` only when ingesting existing planning/design/API documents. Read `references/minimal-change-contract.md`, `references/buildable-app-contract.md`, and `references/development-gates-contract.md` before Phase 3, and `references/qa-evidence-contract.md` before Phase 4. Read `references/retry-policy.md` before deciding any QA retry. Read `references/local-domain-state.md` when browser-owned persisted domain data or complex shared client state is detected. Read `references/external-data-ingestion.md` when crawling, file import, scheduled third-party sync, or build-generated runtime data is detected. Read `references/untrusted-content-quarantine.md` whenever external content enters the run (ingestion, RAG, browser agent, support transcripts, user-supplied external files) and **pass its path to every collecting agent's prompt** — that contract's `INJECTION_SUSPECT` marker is release-blocking, so an unwired round leaves the rule permanently unfired. Read `references/error-handling-patterns.md` before generating `src/shared/api/api.ts`. Read `references/env-management.md` before generating any `.env` file. Read `references/performance-patterns.md` before configuring Vite build options or writing any lazy-loaded route or component. Read `references/background-jobs-contract.md` when 예약·주기 작업 또는 응답 후 완료가 보장되어야 하는 후처리(웹훅·발송·집계)가 감지될 때 — outbox + scheduled runner가 기본 구조다. Read `references/realtime-provider-contract.md` when 실시간 알림·presence·라이브 반영이 요구되고 `TIMESERIES_MODE`가 아닐 때 — managed provider 소비만 지원하며 WS 서버 구축은 범위 밖이다.

`.claude/skills/timeseries-dashboard/references/detection-contract.md`를 단일 판별 기준으로 사용한다. 시간축 series와 시각적 탐색이 핵심이고 historical range, realtime, high-volume 중 하나가 필요하면 `TIMESERIES_MODE: true`로 기록한다. realtime은 필수 조건이 아니며 한국어·영어 prompt와 기존 source artifact를 의미 기반으로 판별한다. 단순 WebSocket 채팅·알림·협업은 제외하고, 시간축 chart가 핵심인지 불명확할 때만 한 번 확인한다.

`.claude/skills/analytics-chart-builder/references/detection-contract.md`를 semantic analytics 판별 기준으로 사용한다. metric/dimension/aggregation 선택과 chart type 또는 dashboard panel 편집이 핵심이면 `ANALYTICS_BUILDER_MODE: true`로 기록한다. 시계열도 있으면 transport/buffer는 timeseries, semantic query/chart compatibility/dashboard config는 analytics가 소유한다.


`.claude/skills/web-orchestrator/references/local-domain-state.md`를 browser-owned domain state의 단일 판별 기준으로 사용한다. localStorage/IndexedDB/offline CRUD 또는 정렬·이동·다중선택·참조 불변식이 있으면 `LOCAL_DOMAIN_STATE_MODE: true`로 기록한다. 단순 theme/language persistence만 있으면 제외한다.

`.claude/skills/web-orchestrator/references/external-data-ingestion.md`를 외부 데이터 수집의 단일 판별 기준으로 사용한다. 크롤링·스크래핑·RSS/CSV/import·scheduled third-party sync·build-generated runtime artifact가 있으면 `EXTERNAL_DATA_INGESTION_MODE: true`로 기록한다. 별도 수집·정규화·승격 단계 없이 일반 내부 API를 조회만 하면 제외한다.
시각 QA, Figma/reference image, `DESIGN_PROTOTYPE_MODE`, 브랜드 핵심 화면, theme/locale matrix가 있으면 `.claude/skills/visual-design-verify/SKILL.md`를 읽고 `VISUAL_QA_MODE: true`로 기록한다. 기존 `visual-qa-contract.json`도 활성 조건이다.

**보조 skill은 확정된 스팩이 고른다(2026-08-26).** 종전에는 intake에서 7종 flag(`HYBRID_SERVERLESS`·`SERVER_DB`·`API_CONTRACT`·`MOCK_SERVICE`·`OAUTH_SERVER`·`I18N`·`OBSERVABILITY`)를 미리 감지했으나, **소비 지점이 전부 Phase 3이고 그때는 이미 스팩이 있다.** 스팩이 더 정확하게 답한다 — `libraries.mock`은 선택뿐 아니라 대안과 근거 티어(`measured-absent` 등)를 담고, `targetShapes`는 hybrid 여부를, `communication`은 계약 형식을 담는다. Phase 3에서 `references/shape-routing-contract.md`와 스팩을 읽어 필요한 companion skill을 고른다. **`UI_LANE`**(mui | tailwind-shadcn)은 감지가 아니라 **결정**이다 — 그린필드는 tech-advisor가 lib-catalog §UI 판단 축으로 정해 tech-stack.md에 기록하고, 브라운필드는 integration-overlay `uiLane` 실측이 우선한다. Phase 3 완료 시 `validate-ui-lane.mjs`로 방출-선택 일치를 검사한다.

## Start

사용자가 자연어 설명과 함께 `/web-orchestrator`를 호출하면 이미 답한 내용을 제외하고 아래 제품 중심 intake를 진행한다:

> 어떤 화면/기능이 대상이고, 누가 그곳에서 어떤 일을 끝내려 하나요? 지금 가장 불편한 점과 성공했음을 확인할 변화도 알려주세요. 기존 기획·디자인 자료가 있으면 함께 근거로 사용합니다.

`interaction-contract.md`에 따라 한 번에 최대 3개 질문만 한다. 제품 목적을 먼저 확인하고, 다음 단계 구조를 바꾸는 데이터·규모·운영 질문만 순서대로 이어간다.

첫 intake는 `planning-facilitation-contract.md`에 따라 **대상 화면/기능 → 사용자와 끝내려는 업무 → 현재 pain과 관찰 가능한 성공 조건**에서 모르는 항목만 최대 3개 묻는다. API, branch, 파일, 라이브러리, 배포 방식은 제품 의도를 고정한 뒤 구조를 바꾸는 경우에만 묻는다. 프로젝트 이름·위치는 설명과 현재 디렉토리에서 추론하고 기존 PRD, Figma/export, API/OpenAPI, 주석이 있으면 근거로 먼저 읽는다. provider/runtime target, 인증, 다국어, 외부 수집은 다음 단계에서 `ASSUMPTION | NEEDS_DECISION | BLOCKER`로 기록한다.

`TIMESERIES_MODE`이면 일반 intake 뒤 `.claude/skills/timeseries-dashboard/references/intake-and-slos.md`의 질문을 규모·SLO 단계에서 최대 3개씩 추가한다. 사용자가 모르는 값은 baseline을 제안하고 `ASSUMPTION`으로 requirements에 전달한다.

`ANALYTICS_BUILDER_MODE`이면 metric/dimension catalog, MVP chart type, query budget, dashboard 저장·공유·revision을 단계적으로 확인한다. metric 의미나 query execution authority가 불명확하면 구현 전 `BLOCKER`다.


`EXTERNAL_DATA_INGESTION_MODE`이면 source와 사용 권한, payload/문서 형식, 갱신 주기, freshness SLO, 최소 count·coverage, invalid candidate의 promotion rejection, serving fallback의 `last-known-good|unavailable`, `static-snapshot|live-api|hybrid`, root/provider build cwd를 한 번에 확인한다. scheduled refresh에는 manual recovery도 함께 요구한다. 모르는 운영 값은 보수적 baseline을 `ASSUMPTION`으로 제안하되 source 사용 권한과 authoritative source가 불명확하면 `BLOCKER`로 둔다.

## Workspace 초기화 — 최소 환경

디렉토리 6종 + `_workspace/web-harness.md`(재진입 마커 + 실측 기본 정보)가 전부다. 기획·디자인 문서는 **요청이 있을 때 그 요청에 맞춰** 생성한다 — 미리 만들지 않는다. 마커가 이미 있으면 덮어쓰지 않는다. 브라운필드 재진입도 같은 명령이다(멱등):
```bash
node .claude/scripts/init-workspace.mjs --project-root {project-root}
```

## 입력 모드 판별

각 에이전트는 `.claude/agents/{agent-name}.md`에 정의된 subagent다. Claude Code의 Task 도구가 있으면 `subagent_type`에 아래 이름을 그대로 넣어 호출한다. Task 도구가 없으면 같은 순서와 출력 파일 계약을 지키며 현재 에이전트가 직접 실행한다.

Workspace 초기화 후 **모드 감지 결과를 사용자에게 먼저 보여주고** 다음 순서로 진행한다:

```
🔍 감지된 모드:
  REQUEST_TYPE: {request-type-contract의 값}
  TIMESERIES_MODE: true/false  (판별 근거 한 줄)
  ANALYTICS_BUILDER_MODE: true/false (판별 근거 한 줄)
  LOCAL_DOMAIN_STATE_MODE: true/false
  EXTERNAL_DATA_INGESTION_MODE: true/false
  VISUAL_QA_MODE: true/false
  WEB_PROFILE: react-vite-spa | next-app-fullstack | vite-serverless-hybrid  (판별 근거 한 줄)
  PLAN_SOURCE: generated | supplied | absent      (사용자 선택)
  DESIGN_SOURCE: generated | supplied | absent    (사용자 선택)
  SOLUTION_SOURCE: generated | supplied | measured (absent 없음)

  (보조 skill은 Phase 3에서 확정된 스팩이 고른다 — intake에서 감지하지 않는다)

→ 틀린 항목이 있으면 알려주세요. 맞으면 계속 진행합니다.
```

세 `*_SOURCE`는 `references/provenance-contract.md`의 공급원이고 **`/wh`가 착수 전에 물어 받은 사용자
선택**이다(`../wh/SKILL.md` §1-B). 여기서는 되비추고 정정만 받는다 — 스스로 판정해 채우지 않는다.
확정 즉시 세 값을 `_workspace/web-harness.md` 마커에 적고, 있으면 그것이 정본이다(§5).

입력 모드 판별:

0-A. **공급 감지 — 모드보다 먼저.** 요청에 새 문서·링크·시안·Figma가 붙어 있으면 레인·모드와 무관하게 `source-artifact-ingestor`를 먼저 실행한 뒤 아래 판별로 돌아간다 — **기존 산출물이 있으면 `00_source/` 기록까지만**(record-only), 없으면 full 정규화(정본 `references/provenance-contract.md` §6). 없으면 Iterate가 먼저 걸려 사용자가 준 문서가 영영 읽히지 않는다.

0. **Iterate Mode** — 이미 buildable한 기존 프로젝트에 `request-type-contract.md`의 `change`·`fix` 레인 요청이 오면(`verify`는 read-only 경로로 간다)(대상 앱이 이미 존재하고 이번 요청이 신규 서비스 생성이 아니면) Phase 1~2 intake·설계를 반복하지 않고 `execution-contract.md`의 **Iterate mode** 경량 루프로 수행한다. 첫 감지 배너는 1줄로 축약하고, Plan/Design 산출물은 이미 있으면 재사용한다. 신규 화면·데이터 계약·아키텍처 변경이 필요하면 그 부분만 해당 Phase 에이전트로 승격한다. 경량 루프여도 `execution-contract.md`의 **Iterate round exit gates**(승격 QA·evidence 재발급·문서 동기화) 3종은 생략하지 않는다 — 진입점이 게이트 강도를 바꾸지 않는다(`request-type-contract.md`).
1. **Resume Mode** — `_workspace/01_plan`과 `_workspace/02_design`의 필수 파일이 모두 존재하면 Phase 3부터 시작한다.
2. **Source Artifact Mode**(`supplied`) — 사용자가 기존 기획/디자인/API 문서·폴더·링크·시안 이미지·Figma 참조를 제공했으면 `source-artifact-ingestor`를 실행한다. 받는 형태와 URL·이미지·Figma MCP의 처리 절차는 `references/source-artifacts.md`가 정본이다.
   - `planning-context.md`를 포함해 정규화하고 read-only `plan-reviewer` readiness gate를 통과한 뒤 다음 Phase로 간다.
   - 정규화 후 Plan/Design 필수 파일이 모두 있으면 Phase 3부터 시작한다.
   - Plan만 충분하면 Phase 2부터 시작한다.
   - Design만 충분하면 `source-artifact-ingestor`가 최소 Plan 산출물을 `ASSUMPTION`으로 생성하고, 누락된 Design 산출물만 Phase 2 에이전트로 보강한다.
   - `gap-report.md`에 `BLOCKER`가 있으면 사용자에게 BLOCKER 목록을 보여주고 해소 방법을 확인한 뒤 진행한다. 자동으로 Phase 3으로 넘어가지 않는다.
3. **Fresh Mode** — 기존 산출물이 없으면 "Phase 1부터 전부"가 아니라 **공급원별로 단계를 조립한다**. 조립 규칙·승인·`absent` 처리는 `references/provenance-contract.md` §4가 정본이며 **진입 전에 읽는다**. 어느 조합이든 설계·스팩은 서고 Phase 3·4는 동일하다.

## Phase 실행 순서

### Phase 1 — 기획 (순서 있음)

**Wave 0** — `planning-facilitator`가 `_workspace/01_plan/planning-context.md`, `decision-log.md`를 작성한다.

**Wave 1** — `requirements-analyst` → `_workspace/01_plan/requirements.md`

**Wave 2** — `ux-researcher` → `_workspace/01_plan/ux-brief.md`

**Wave 3** — `feature-planner` → `_workspace/01_plan/feature-plan.md`. UX 결정과 requirement를 함께 입력으로 사용한다.

**Wave 4** — 단독 실행 (planning-context.md + ux-brief.md + feature-plan.md + requirements.md 존재 후):
- `tech-advisor` → `_workspace/01_plan/tech-stack.md`
- `tech-stack.md`에 built-in `WEB_PROFILE`, deployment provider와 runtime target, selected capabilities, exact Node/pnpm/framework versions를 고정한다

**Wave 5** — 단독 실행 (모든 plan 파일 완료 후):
- `planning-synthesizer` → `_workspace/01_plan/project-brief.md`

**Wave 6 — 준비도 리뷰**:
- read-only `plan-reviewer`를 항상 실행하고 L/XL, realtime, 권한, destructive action, analytics builder이면 심화한다.
- 반환 본문은 `_workspace/01_plan/plan-review.md`에 저장한다.
- `NEEDS_DECISION`은 최대 3개씩 사용자 체크포인트에 포함하고 `BLOCKED`면 Phase 2를 시작하지 않는다.

---

### ✋ Phase 1 완료 체크포인트

`references/approval-checkpoints.md`의 Phase 1 → Phase 2 계약으로 범위·기술·미결정을 보여주고 확인받는다. 수정 시 해당 Wave만 재실행한다.

### Phase 2 — 디자인

**시점 로드**: `references/phase-2-design.md` — Wave 0/0-A/0-B(모드 조건부 선행) · Wave 1(디자인 시스템·레이아웃·API 스키마) · Wave 2(컴포넌트 + Design Preview Loop) · Wave 3(조건부 검토). 진입 시 읽지 않는다.

### ✋ Phase 2 완료 체크포인트

`references/approval-checkpoints.md`의 Phase 2 → Phase 3 계약으로(인계 점검 HOLES면 승인 금지) 화면·컴포넌트·API·시각 자료·미결정을 보여주고 확인받는다. 확인 후 Phase 3 착수 전에 `references/solution-design-contract.md`로 두 단계를 밟는다: ① `system-architect`로 구현 설계 결정을 기록하고 선택지를 제시한다(**관측·게이트 아님** — 실패하면 사실만 기록하고 재시도하지 않는다). ② `spec.mjs`로 스팩을 확정한다(**구현 스폰의 전제조건** — 없으면 `developer`가 아무것도 쓸 수 없다). ①은 건너뛸 수 있고 ②는 없다.

### Phase 3 — 개발

**시점 로드**: `references/phase-3-development.md` — `CHANGE_MODE` 판별과 change-scope · profile resolver와 DAG 컴파일 · `developer` 스폰(모듈 경계마다) · 환경/배포 단계 · Gate A·B·C와 스폰 완결성 게이트. Iterate·Resume mode는 여기서 진입하므로 이 파일부터 읽는다.

### Phase 4 — 검증

**시점 로드**: `references/phase-4-verification.md` — 무조건 verifier와 조건부 verifier · quality runner와 receipt · 서명 attestation · release gate와 tier 판정.
