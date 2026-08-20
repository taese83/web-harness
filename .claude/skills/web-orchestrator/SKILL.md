---
name: web-orchestrator
description: Master orchestrator for building or extending any supported React/Vite or Next.js web application from a natural-language request or existing artifacts, including crawling, scheduled external-data ingestion, local domain state, AI, planning, implementation, QA, CI, and release evidence. Invoke explicitly with /web-orchestrator for a complete service or cross-lifecycle web change.
argument-hint: "[service description or artifact paths]"
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Write, Edit, Bash, Agent, AskUserQuestion
metadata:
  version: 1.6.6
  maturity: eval-covered
  updated: 2026-08-18
  changelog: 디자인 발산 프로토콜(design-principles-research) 신설 + A/B 비교를 커밋된 단일 시안·근거 제시로 교체(멀티 시안은 opt-in).
---

# Web Orchestrator

**선행 로드**(시작 전 필독) — 앵커 안이 고정 진입 비용 전부다. 늘리려면 contract-hygiene ratchet(참조 수 + 바이트)이 막으므로 baseline을 의식적으로 갱신한다(I4).
<!-- always-read -->
- `references/interaction-contract.md`(질문·확인) · `references/request-type-contract.md`, `references/scenario-contract.md`(요청 유형·시나리오) · `references/operational-gotchas.md`(전 구간 금지·선행 조건) · `references/execution-contract.md`, `references/web-profile-contract.md`(실행 모드·프로필)
<!-- /always-read -->

**시점 로드** — 앵커 밖 계약은 전부 그 시점 직전에 읽는다(선행 로드 금지). **시점 표기가 곧 계약이다.**
- **Fresh mode 첫 intake 전** `../web-plan/references/planning-facilitation-contract.md`, `../web-plan/references/planning-readiness-contract.md` — Iterate/Resume mode는 Phase 1 intake를 반복하지 않으므로 읽지 않는다
- **첫 스폰 전** `references/execution-budget-contract.md` — 이후 **스폰이 끝날 때마다 결과 usage를 `_workspace/04_qa/execution-telemetry.json`에 기록한다** (usage 미제공 환경이면 `null`, 지어내지 않는다)
- **기존 source 변경 감지 시** `references/change-journal-contract.md`, `references/integration-overlay.md` · **첫 Phase 체크포인트 전** `references/approval-checkpoints.md` · **Phase 2 전** `references/design-approval-contract.md`와 디자인 원칙 허브 `references/design-principles.md` · **Phase 4 판정·release tier 보고 전** `references/release-tier-contract.md` · **완료 보고 전** `references/completion-contract.md`
- **재진입**(후속 턴·새 세션·압축 후 재관여)은 이 스킬 전체를 재로드하지 않는다 — `references/reentry-map.md`의 상황별 최소 로드가 정본이다. 전체 진입은 신규 서비스·모드 미판별에서만 필요하다

자연어 설명 하나 또는 기존 기획/디자인/API 문서로 완성된 웹 애플리케이션을 만든다. 입력 상태를 먼저 판별한 뒤 필요한 Phase만 실행한다.

(`references/execution-contract.md`·`references/web-profile-contract.md`는 위 선행 로드에 포함된다.) Read `references/source-artifacts.md` only when ingesting existing planning/design/API documents. Read `references/minimal-change-contract.md`, `references/buildable-app-contract.md`, and `references/development-gates-contract.md` before Phase 3, and `references/qa-evidence-contract.md` before Phase 4. Read `references/retry-policy.md` before deciding any QA retry. Read `references/local-domain-state.md` when browser-owned persisted domain data or complex shared client state is detected. Read `references/external-data-ingestion.md` when crawling, file import, scheduled third-party sync, or build-generated runtime data is detected. Read `references/untrusted-content-quarantine.md` whenever external content enters the run (ingestion, RAG, browser agent, support transcripts, user-supplied external files) and **pass its path to every collecting agent's prompt** — that contract's `INJECTION_SUSPECT` marker is release-blocking, so an unwired round leaves the rule permanently unfired. Read `references/error-handling-patterns.md` before generating `src/shared/api/api.ts`. Read `references/env-management.md` before generating any `.env` file. Read `references/performance-patterns.md` before configuring Vite build options or writing any lazy-loaded route or component. Read `references/background-jobs-contract.md` when 예약·주기 작업 또는 응답 후 완료가 보장되어야 하는 후처리(웹훅·발송·집계)가 감지될 때 — outbox + scheduled runner가 기본 구조다. Read `references/realtime-provider-contract.md` when 실시간 알림·presence·라이브 반영이 요구되고 `TIMESERIES_MODE`가 아닐 때 — managed provider 소비만 지원하며 WS 서버 구축은 범위 밖이다.

`.claude/skills/timeseries-dashboard/references/detection-contract.md`를 단일 판별 기준으로 사용한다. 시간축 series와 시각적 탐색이 핵심이고 historical range, realtime, high-volume 중 하나가 필요하면 `TIMESERIES_MODE: true`로 기록한다. realtime은 필수 조건이 아니며 한국어·영어 prompt와 기존 source artifact를 의미 기반으로 판별한다. 단순 WebSocket 채팅·알림·협업은 제외하고, 시간축 chart가 핵심인지 불명확할 때만 한 번 확인한다.

`.claude/skills/analytics-chart-builder/references/detection-contract.md`를 semantic analytics 판별 기준으로 사용한다. metric/dimension/aggregation 선택과 chart type 또는 dashboard panel 편집이 핵심이면 `ANALYTICS_BUILDER_MODE: true`로 기록한다. 시계열도 있으면 transport/buffer는 timeseries, semantic query/chart compatibility/dashboard config는 analytics가 소유한다.

`.claude/skills/ai-app-orchestrator/references/detection-contract.md`를 AI 기능의 단일 판별 기준으로 사용한다. 모델 생성, RAG, model-selected tool, 코드리뷰, AI 고객센터, AI analytics, browser action이 핵심이면 `AI_MODE: true`와 모든 submode를 기록하고 `/ai-app-orchestrator`의 설계·runtime·QA gate를 적용한다. 일반 검색, 고정 규칙, read-only Playwright QA는 제외한다.

`.claude/skills/web-orchestrator/references/local-domain-state.md`를 browser-owned domain state의 단일 판별 기준으로 사용한다. localStorage/IndexedDB/offline CRUD 또는 정렬·이동·다중선택·참조 불변식이 있으면 `LOCAL_DOMAIN_STATE_MODE: true`로 기록한다. 단순 theme/language persistence만 있으면 제외한다.

`.claude/skills/web-orchestrator/references/external-data-ingestion.md`를 외부 데이터 수집의 단일 판별 기준으로 사용한다. 크롤링·스크래핑·RSS/CSV/import·scheduled third-party sync·build-generated runtime artifact가 있으면 `EXTERNAL_DATA_INGESTION_MODE: true`로 기록한다. 별도 수집·정규화·승격 단계 없이 일반 내부 API를 조회만 하면 제외한다.
시각 QA, Figma/reference image, `DESIGN_PROTOTYPE_MODE`, 브랜드 핵심 화면, theme/locale matrix가 있으면 `.claude/skills/visual-design-verify/SKILL.md`를 읽고 `VISUAL_QA_MODE: true`로 기록한다. 기존 `visual-qa-contract.json`도 활성 조건이다.

`.claude/skills/web-orchestrator/references/companion-skill-detection.md`를 보조 skill 감지의 단일 기준으로 사용한다. 감지 시점의 project state와 intake 결과를 종합해 다음 flag를 기록한다: `HYBRID_SERVERLESS_MODE`(Vite SPA + serverless functions), `SERVER_DB_MODE`(Postgres/SQLite/MySQL 사용), `API_CONTRACT_MODE`(client/server 분리 개발 또는 계약 강제 요구), `MOCK_SERVICE_MODE`(MSW handler 필요), `OAUTH_SERVER_MODE`(서버 OAuth code exchange 흐름), `I18N_MODE`(다국어 catalog·locale routing — `/i18n-setup` + `i18n-builder`), `OBSERVABILITY_MODE`(에러 추적·RUM — `web-observability-builder`). 각 flag는 해당 companion skill/agent의 execution을 Phase 3에 삽입한다. **`UI_LANE`**(mui | tailwind-shadcn)은 감지가 아니라 **결정**이다 — 그린필드는 tech-advisor가 lib-catalog §UI 판단 축으로 정해 tech-stack.md에 기록하고, 브라운필드는 integration-overlay `uiLane` 실측이 우선한다. Phase 3 완료 시 `validate-ui-lane.mjs`로 방출-선택 일치를 검사한다.

## Start

사용자가 자연어 설명과 함께 `/web-orchestrator`를 호출하면 이미 답한 내용을 제외하고 아래 제품 중심 intake를 진행한다:

> 어떤 화면/기능이 대상이고, 누가 그곳에서 어떤 일을 끝내려 하나요? 지금 가장 불편한 점과 성공했음을 확인할 변화도 알려주세요. 기존 기획·디자인 자료가 있으면 함께 근거로 사용합니다.

`interaction-contract.md`에 따라 한 번에 최대 3개 질문만 한다. 제품 목적을 먼저 확인하고, 다음 단계 구조를 바꾸는 데이터·규모·운영 질문만 순서대로 이어간다.

첫 intake는 `planning-facilitation-contract.md`에 따라 **대상 화면/기능 → 사용자와 끝내려는 업무 → 현재 pain과 관찰 가능한 성공 조건**에서 모르는 항목만 최대 3개 묻는다. API, branch, 파일, 라이브러리, 배포 방식은 제품 의도를 고정한 뒤 구조를 바꾸는 경우에만 묻는다. 프로젝트 이름·위치는 설명과 현재 디렉토리에서 추론하고 기존 PRD, Figma/export, API/OpenAPI, 주석이 있으면 근거로 먼저 읽는다. provider/runtime target, 인증, 다국어, 외부 수집은 다음 단계에서 `ASSUMPTION | NEEDS_DECISION | BLOCKER`로 기록한다.

`TIMESERIES_MODE`이면 일반 intake 뒤 `.claude/skills/timeseries-dashboard/references/intake-and-slos.md`의 질문을 규모·SLO 단계에서 최대 3개씩 추가한다. 사용자가 모르는 값은 baseline을 제안하고 `ASSUMPTION`으로 requirements에 전달한다.

`ANALYTICS_BUILDER_MODE`이면 metric/dimension catalog, MVP chart type, query budget, dashboard 저장·공유·revision을 단계적으로 확인한다. metric 의미나 query execution authority가 불명확하면 구현 전 `BLOCKER`다.

`AI_MODE`이면 같은 intake에서 핵심 task와 실패 비용, read/write 데이터, authoritative system, autonomy L0~L4, 사람 승인, tenant·PII, quality·latency·cost budget, Mock와 실제 tool/provider 경계를 추가한다. identity, tenant, high-impact action의 승인자가 불명확하면 구현 전에 한 번 확인한다.

`EXTERNAL_DATA_INGESTION_MODE`이면 source와 사용 권한, payload/문서 형식, 갱신 주기, freshness SLO, 최소 count·coverage, invalid candidate의 promotion rejection, serving fallback의 `last-known-good|unavailable`, `static-snapshot|live-api|hybrid`, root/provider build cwd를 한 번에 확인한다. scheduled refresh에는 manual recovery도 함께 요구한다. 모르는 운영 값은 보수적 baseline을 `ASSUMPTION`으로 제안하되 source 사용 권한과 authoritative source가 불명확하면 `BLOCKER`로 둔다.

## Workspace 초기화

intake 완료 후 즉시 실행:
```bash
mkdir -p _workspace/00_source _workspace/01_plan _workspace/02_design _workspace/03_dev _workspace/04_qa _workspace/RELEASE
```

## 입력 모드 판별

각 에이전트는 `.claude/agents/{agent-name}.md`에 정의된 subagent다. Claude Code의 Task 도구가 있으면 `subagent_type`에 아래 이름을 그대로 넣어 호출한다. Task 도구가 없으면 같은 순서와 출력 파일 계약을 지키며 현재 에이전트가 직접 실행한다.

Workspace 초기화 후 **모드 감지 결과를 사용자에게 먼저 보여주고** 다음 순서로 진행한다:

```
🔍 감지된 모드:
  REQUEST_TYPE: {request-type-contract의 값}
  TIMESERIES_MODE: true/false  (판별 근거 한 줄)
  ANALYTICS_BUILDER_MODE: true/false (판별 근거 한 줄)
  AI_MODE:         true/false  (판별 근거 한 줄)
  LOCAL_DOMAIN_STATE_MODE: true/false
  EXTERNAL_DATA_INGESTION_MODE: true/false
  VISUAL_QA_MODE: true/false
  WEB_PROFILE: react-vite-spa | next-app-fullstack | vite-serverless-hybrid  (판별 근거 한 줄)

🔧 감지된 companion skill:
  `companion-skill-detection.md`의 일곱 flag와 각 판별 근거

→ 틀린 항목이 있으면 알려주세요. 맞으면 계속 진행합니다.
```

사용자가 수정 요청 없이 계속 진행하면 다음 단계로 넘어간다. 모드가 잘못 감지됐으면 즉시 재판별하고 다시 보여준다.

입력 모드 판별:

0. **Iterate Mode** — 이미 buildable한 기존 프로젝트에 `request-type-contract.md`의 `feature`·`ui-change`·`bug-fix`·`refactor`·`api-integration`·`verification-only` 같은 **범위가 좁혀진 변경 요청**이 오면(대상 앱이 이미 존재하고 이번 요청이 신규 서비스 생성이 아니면) Phase 1~2 intake·설계를 반복하지 않고 `execution-contract.md`의 **Iterate mode** 경량 루프로 수행한다. 첫 감지 배너는 1줄로 축약하고, Plan/Design 산출물은 이미 있으면 재사용한다. 신규 화면·데이터 계약·아키텍처 변경이 필요하면 그 부분만 해당 Phase 에이전트로 승격한다. 경량 루프여도 `execution-contract.md`의 **Iterate round exit gates**(승격 QA·evidence 재발급·문서 동기화) 3종은 생략하지 않는다 — 진입점이 게이트 강도를 바꾸지 않는다(`request-type-contract.md`).
1. **Resume Mode** — `_workspace/01_plan`과 `_workspace/02_design`의 필수 파일이 모두 존재하면 Phase 3부터 시작한다.
2. **Source Artifact Mode** — 사용자가 기존 기획/디자인/API 문서나 폴더를 제공했으면 `source-artifact-ingestor`를 실행한다.
   - `planning-context.md`를 포함해 정규화하고 read-only `plan-reviewer` readiness gate를 통과한 뒤 다음 Phase로 간다.
   - 정규화 후 Plan/Design 필수 파일이 모두 있으면 Phase 3부터 시작한다.
   - Plan만 충분하면 Phase 2부터 시작한다.
   - Design만 충분하면 `source-artifact-ingestor`가 최소 Plan 산출물을 `ASSUMPTION`으로 생성하고, 누락된 Design 산출물만 Phase 2 에이전트로 보강한다.
   - `gap-report.md`에 `BLOCKER`가 있으면 사용자에게 BLOCKER 목록을 보여주고 해소 방법을 확인한 뒤 진행한다. 자동으로 Phase 3으로 넘어가지 않는다.
3. **Fresh Mode** — 기존 산출물이 없으면 Phase 1부터 전체 실행한다. 신규 서비스 요청은 골격만 만드는 `/project-init`으로 축소하지 않는다 — `project-init`은 scaffold 전용이고 기획·설계·QA 게이트를 갖지 않는다. 반대로 사용자가 **골격만** 명시했으면 Phase 1을 강요하지 않고 `/project-init`으로 넘긴다.

## Phase 실행 순서

### Phase 1 — 기획 (순서 있음)

**Wave 0** — `planning-facilitator`가 `_workspace/01_plan/planning-context.md`, `decision-log.md`를 작성한다.

**Wave 1** — `requirements-analyst` → `_workspace/01_plan/requirements.md`

**Wave 1-A — AI_MODE 조건부**:
- `ai-requirements-analyst` → `_workspace/01_plan/ai-requirements.md`, `_workspace/01_plan/autonomy-risk-matrix.md`

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

### Phase 2 — 디자인 (순서 있음)

Phase 2를 시작하기 전에 `references/artifact-sharding-contract.md`를 읽는다. 이 Phase의 설계 산출물은 하류 5~18개 에이전트가 각자 다시 읽으므로 크기 예산과 분할 규칙을 지켜야 한다. designer 계열 agent prompt에 이 계약 경로를 함께 전달한다. **디자인 원칙 허브 `references/design-principles.md`의 경로도 designer 계열 agent prompt에 함께 전달한다** — 각 agent는 허브의 소비자 맵에서 자기 담당 절만 읽고 그 수치·규칙을 기본값으로 쓴다(사용자 브랜드 제약이 이기되 접근성 하한은 협상 불가). **Phase 1·2 각 Wave 완료 시 `node .claude/scripts/validate-artifact-sharding.mjs --project {project-root}`를 실행하고 exit 1이면 해당 designer를 다시 실행해 분할한 뒤 진행한다** — 산문 판단이 아니라 바이트 측정이 판정 근거다.

**Wave -1 — AI_MODE 조건부 설계 Gate**:
- 다음 agent를 병렬 실행한다:
  - `ai-solution-architect` → `_workspace/02_design/ai-architecture.md`, `_workspace/02_design/cost-latency-budget.md`
  - `data-governance-architect` → `_workspace/02_design/data-governance.md`
  - `tool-contract-designer` → `_workspace/02_design/tool-contracts.md`
  - `ai-threat-modeler` → `_workspace/02_design/ai-threat-model.md`
  - `ai-eval-designer` → `_workspace/02_design/eval-plan.md`
- AI manifest의 필수 설계 산출물이 모두 완료되기 전 Phase 3을 시작하지 않는다.

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

**Wave 2** — 단독 실행 (design-system.md + layout-spec.md 존재 후). **프리뷰 전에 방향 승인이 선행한다** — `design-approval-contract.md` 0단계(후보 타일 3종 → 사용자 선택). 방향 기각을 프리뷰에서 받으면 5배 비싸다(실측):
- `component-designer` → `_workspace/02_design/component-spec.md`. 완료 후 `design-approval-contract.md`의 **Design Preview Loop**를 기본 실행한다: `design-preview-builder` → `validate-design-preview.mjs --write-source-snapshot`으로 FEAT/TC/DOM trace와 입력 digest 고정 → `preview-server.mjs` 서빙 → 피드백은 스펙에 먼저 반영 후 재생성(≤3라운드) → 명시적 사용자 승인 뒤 `validate-design-preview.mjs --record-approval`로 승인 해시 기록
- `VISUAL_QA_MODE`이면 `visual-contract-designer` → `_workspace/02_design/visual-qa-contract.md`, `visual-qa-contract.json`

**Wave 3 — 조건부 디자인 검토**:
- `design-approval-contract.md`에 따라 기존 디자인 inventory와 `DESIGN_PROTOTYPE_MODE`를 판정한다.
- L/XL 또는 prototype mode이면 read-only `design-reviewer`를 실행해 `_workspace/02_design/design-review.md`에 저장한다.
- `NEEDS_DECISION`은 Phase 2 체크포인트에서 최대 3개씩 확인하고 `BLOCKED`면 구현하지 않는다.

### ✋ Phase 2 완료 체크포인트

`references/approval-checkpoints.md`의 Phase 2 → Phase 3 계약으로 화면·컴포넌트·API·시각 자료·미결정을 보여주고 확인받는다. 수정 시 해당 Wave만 재실행한다.

### Phase 3 — 개발 (순서 있음)

`_workspace/02_design/preview/`가 존재하면 첫 source edit 전에 `node .claude/scripts/validate-design-preview.mjs --project {root} --json`을 실행한다. 상태가 `APPROVED`가 아니면 `BLOCKED`이며, `STALE`이면 바뀐 스펙에서 프리뷰를 재생성·재확인·재승인한다. production builder에는 승인된 source digest가 묶은 design-system/layout-spec/component-spec/feature-plan만 전달하고 preview HTML/CSS/JS는 구현 입력으로 전달하지 않는다.

source 존재 여부로 `CHANGE_MODE: greenfield | existing-change`를 먼저 결정한다. `existing-change`이면 첫 edit 전에 `_workspace/03_dev/change-scope.md`에 `TARGET_BEHAVIOR`, `ALLOWED_PATHS`, `PUBLIC_CONTRACTS_TO_PRESERVE`, `NON_GOALS`, `CHANGE_BUDGET`, `TEST_EVIDENCE`, `CAPABILITY_ESCALATION`, `DOCS_TO_UPDATE`를 기록한다(스키마는 `minimal-change-contract.md`가 canonical). 모든 implementation/retry agent prompt에 이 필드를 전달하고 scope 확대가 필요하면 확대된 경로를 수정하기 전에 brief를 갱신한다. `CAPABILITY_ESCALATION: detected`이면 Phase 4에서 `security-reviewer` 재투입이 의무다.

`existing-change`이면 `_workspace/02_design/integration-overlay.json`을 먼저 생성·검증한다. 각 owner는 `change-journal-contract.md`에 따라 자기 `_workspace/03_dev/change-journal/{agent-name}.md`에 생성·수정·실패·증거를 기록한다.

구현 전에 `web-profile-contract.md`의 resolver를 실행한다. 이때 intake에서 판별한 요청 언어를 `outputLanguage`로 프로필에 병합하고 산출 스폰마다 주입한다 — 규약·검사는 `development-gates-contract.md` Gate L. 기존 project는 `--requested auto`, greenfield는 tech-stack의 명시 profile/provider/deployment/capability를 전달한다. resolver는 crawler script, ingestion package, scheduled refresh workflow를 발견했는데 두 ingestion 계약 또는 `external-ingestion` capability가 없으면 fail-closed해야 한다. stable stdout JSON을 `_workspace/01_plan/project-profile.json`에 그대로 저장하고 `--profile-file`로 DAG를 컴파일해 `_workspace/03_dev/web-execution-plan.json`에 저장한다. profile conflict, provider-target conflict, forbidden marker, ingestion contract/capability 누락, stale adapter hash는 `BLOCKED`다.

`WEB_PROFILE: next-app-fullstack`이면 `/next-app`에 Phase 3 구현과 Next contract QA를 위임하고 아래 Vite 전용 1~6단계를 실행하지 않는다. `WEB_PROFILE: react-vite-spa` 또는 `vite-serverless-hybrid`일 때만 아래 단계를 실행한다 — hybrid는 같은 단계에 serverless handler 구현이 추가된다.

1. 패키지/도구/앱 기반 생성 (순서 있음):
   - `package-scaffolder` — package/workspace metadata
   - `tooling-scaffolder` — TS/Vite/ESLint/Vitest 설정
   - `shared-foundation-builder` — shared/api/config/store/env/MSW 기반
   - `EXTERNAL_DATA_INGESTION_MODE`이면 `external-data-pipeline-builder` — adapter/normalize/schema/quality/atomic promotion 구현
   - `HYBRID_SERVERLESS_MODE`(`WEB_PROFILE: vite-serverless-hybrid`)이면 `/vite-serverless-hybrid`의 계약으로 루트 `api/` handler를 구현한다 — **§7 엔드포인트 공통 가드 5종이 handler 구현보다 앞선다** (release DAG의 `api.guards`·`api.unit` receipt가 강제). `SERVER_DB_MODE`·`OAUTH_SERVER_MODE`가 이 위에 조합된다
   - `SERVER_DB_MODE`이면 `/server-db-migration`을 실행해 `migrations/` 디렉토리, idempotent SQL 규칙, direct/pooled DSN 분리, 러너 script를 준비한다. 실제 migration 실행은 사용자 승인 후
   - `app-shell-builder` — main/App/router/theme/home shell
   - `AI_MODE`이면 `/ai-runtime-setup`을 실행해 `agent-runtime-scaffolder` → `model-gateway-builder` → `tool-adapter-builder` → 조건부 `human-approval-builder` → `ai-observability-builder` 순서로 공통 runtime을 만든다
2. 지원 companion과 API 계약 확정:
   - `API_CONTRACT_MODE`이면 `/api-contract-typegen`을 실행해 client/server가 공유할 schema(Zod 또는 OpenAPI codegen)를 확정한다. Mock handler와 entity/feature builder가 이 schema를 참조한다
   - `OAUTH_SERVER_MODE`이면 `/auth-setup`을 실행해 `_lib/oauth.ts`, `_lib/session.ts`, `api/auth/*/{start,callback}.ts`, `authGuard`를 구현한다. 이후 protected handler가 이 guard를 사용한다
   - `MOCK_SERVICE_MODE`이고 `mock-api-builder`의 기본 셋업 이상이 필요하면 `/mock-service-setup`을 실행해 handler·fixture·시나리오 스위치·bypass mode를 조직한다
3. route, 일반 Mock, 컴포넌트 구현:
   - `route-builder`
   - `mock-api-builder` — 일반 web app에서 `route-builder`와 병렬 실행 가능. `TIMESERIES_MODE`에서는 realtime interface 완료 후인 5단계로 미룬다 <!-- marker:timeseries-realtime-build-order -->
   - `component-builder`. 공개 노출(검색 유입·소셜 공유) 요구이면 `seo-meta-builder`가 `seo-spec.md`, robots/sitemap, `src/shared/seo/`를 작성한다
4. 데이터 계층 연결 (순서 있음):
   - `entity-query-builder`
   - 다음 agent 병렬 실행:
     - `realtime-data-builder` — `TIMESERIES_MODE`에서만 실행
     - `analytics-implementation-builder` — `ANALYTICS_BUILDER_MODE`에서만 실행
     - `feature-mutation-builder`
     - `form-state-builder` — 폼이 있을 때만 실행
     - `client-domain-state-builder` — `LOCAL_DOMAIN_STATE_MODE`에서만 실행
5. `TIMESERIES_MODE`이면 `mock-api-builder`를 실행해 완성된 `TimeseriesTransport` interface 기반 fake를 만든다.
   - browser Mock 사용 시 `public/mockServiceWorker.js`를 확인한다. dependency install이 승인·완료됐는데 파일이 없으면 실제 외부 격리가 적용된 setup job에서만 `WEB_HARNESS_ISOLATED_EXECUTION=1 node .claude/scripts/run-package-operation.mjs --project {project-root} --operation msw-init`을 실행한다. 사용자 승인만 있는 host 실행은 `BLOCKED`다
6. 모든 적용 대상 data owner가 완료된 뒤:
   - `data-ui-binder`
각 1·3·6단계 뒤 `development-gates-contract.md`의 Gate A·B·C를 실행하고 `FAIL|BLOCKED`면 다음 단계로 진행하지 않는다. 중간 receipt는 이후 source 변경 시 stale이며 Phase 4 release evidence를 대신하지 않는다. 이와 별개로 각 builder 스폰 직후 `execution-budget-contract.md`의 **스폰 완결성 게이트**(완결성 마커·`verify-spawn-completion.mjs`·runaway 임계)를 통과시킨다 — 실패면 re-spawn 또는 `NEEDS_DECISION`, 불완전 산출물 위에 다음 단계를 쌓지 않는다(품질 Gate A/B/C와 보완).
7. `AI_MODE`이면 활성화된 service branch를 공통 runtime 위에 실행한다:
   - `CODE_REVIEW_AGENT_MODE` → `/ai-code-review-bot`
   - `RAG_MODE`의 사내 검색 → `/enterprise-search-ai`
   - 고객센터 → `/customer-support-ai`
   - `ANALYTICS_AGENT_MODE` → `/ai-analytics-dashboard`
   - `BROWSER_AGENT_MODE` → `/browser-agent`
8. 배포 CI가 요구됐거나 `tech-stack.md`에 배포 target이 있으면 `deploy-ci-writer`를 실행한다.
9. `scheduled-static-ingestion`이면 `ingestion-ci-writer`가 refresh workflow만 작성한다. workflow는 machine validator가 요구하는 kind/generated-path/direct-push metadata, read-only crawl job, 격리된 promotion 권한, concurrency를 포함해야 한다.
10. provider가 Vercel이면 `vercel-config-writer`가 root/app `vercel.json`, build/output/root 계약만 작성한다. ingestion workflow와 provider config를 일반 deploy agent가 임의 경로에 만들지 않는다. 모든 workflow/config는 source fingerprint 대상이므로 Phase 4 quality runner보다 먼저 완료한다.
11. `VISUAL_QA_MODE`이면 UI와 fixture 완료 후 `visual-test-writer`를 실행하고 baseline은 별도 승인 전까지 갱신하지 않는다.

### Phase 4 — 검증 (테스트 준비 → 결정론적 실행 → 판정)

package/config/source 구현이 끝난 현재 project를 대상으로 같은 deployment/capabilities로 profile resolver를 다시 실행하고 canonical `web-execution-plan.json`을 다시 컴파일한다. framework/toolchain declaration, adapter hash, plan graph가 달라졌거나 exact version이 아니면 quality runner 전에 `BLOCKED`다.

external ingestion greenfield에서는 web app과 crawler/workflow/runtime contract를 같은 canonical project root에 둔다. parent wrapper의 crawler와 nested web app을 서로 다른 release root로 만든 뒤 한쪽 evidence만으로 완료하지 않는다. 기존 split-root project는 자동 재배치하지 않고 migration decision이 확정될 때까지 `BLOCKED`다.

먼저 `test-scaffolder`와 `test-writer`를 순서대로 실행한다. 로컬 진단에서는 오케스트레이터가 사용자 확인 후 실제 process exit를 기록하는 quality runner를 실행한다:

```bash
node .claude/scripts/run-quality-gates.mjs --all --allow-host-execution
```

quality runner는 generated project의 package script를 실행하므로 실행 직전에 사용자 확인을 받는다. 이 host receipt는 진단 전용이다. release 후보는 격리 CI에서 `WEB_HARNESS_ISOLATED_EXECUTION=1 node .claude/scripts/run-quality-gates.mjs --all`로 다시 실행한다. `external-ingestion` capability에서는 built-in artifact semantic validation을 포함한 `ingestion` receipt가 같은 cohort에 반드시 있어야 한다. host public env는 자동 상속하지 않고 `_workspace/02_design/build-environment.json`에 이름이 명시된 공개 변수만 전달한다.

runner가 non-zero여도 보고서를 생략하지 않는다. `_workspace/04_qa/evidence/*.json`의 `FAIL`/`BLOCKED`를 owner에게 연결하는 QA 보고서를 생성하고 retry 여부를 판단한다. verifier가 Markdown에 임의의 exit code를 작성하거나 machine receipt를 대신 생성하면 안 된다.

그 다음 아래 read-only verifier를 병렬 실행한다:
- `code-reviewer` → `_workspace/04_qa/qa-code.md` (TypeScript, ESLint, FSD, a11y, 테스트 파일 존재 여부)
- `ux-validator` → `_workspace/04_qa/qa-ux.md`
- `integration-verifier` → `_workspace/04_qa/qa-integration.md`
- `security-reviewer` → `_workspace/04_qa/qa-security.md`
- `api-contract-verifier` → `_workspace/04_qa/qa-api-contract.md`
- `ANALYTICS_BUILDER_MODE`이면 `analytics-verifier` → `_workspace/04_qa/qa-analytics.md`
- `LOCAL_DOMAIN_STATE_MODE`이면 `state-invariant-verifier` → `_workspace/04_qa/qa-state.md`
- `EXTERNAL_DATA_INGESTION_MODE`이면 `data-quality-verifier` → `_workspace/04_qa/qa-data-quality.md`. 공개 노출 요구이면 `seo-verifier` → `qa-seo.md`, `performance-budget.md`가 있으면 `performance-verifier` → `qa-perf.md`, `TIMESERIES_MODE`이면 `timeseries-verifier` → `qa-timeseries.md` (모두 `_workspace/04_qa/`)
- `AI_MODE` 정적 gate: <!-- repo-only:start -->
  - `node .claude/scripts/test-ai-harness.mjs --through eval-contracts`<!-- repo-only:end -->
- `AI_MODE` read-only verifier:
  - `ai-eval-runner` → `_workspace/04_qa/qa-ai-evals.md`
  - `ai-security-reviewer` → `_workspace/04_qa/qa-ai-security.md`
  - `data-access-verifier` → `_workspace/04_qa/qa-data-access.md`
  - `cost-latency-verifier` → `_workspace/04_qa/qa-ai-cost-latency.md`
  - `agent-trace-verifier` → `_workspace/04_qa/qa-agent-traces.md`
- `test-executor` → `_workspace/04_qa/qa-test.md`
- `browser-verifier` → `_workspace/04_qa/qa-browser.md`
- `VISUAL_QA_MODE`이면 `visual-regression-verifier` → `_workspace/04_qa/qa-visual.md`

`TIMESERIES_MODE`에서는 API contract에 stream schema/cursor를 포함하고 browser QA에 normal/max/burst, reconnect/gap, visible-point, render cadence, heap trend를 포함한다.

`ANALYTICS_BUILDER_MODE`에서는 semantic query, chart compatibility, dashboard revision과 Funnel/Retention/Flow fixture를 QA에 포함한다. `qa-analytics.md` 누락이나 `BLOCKED`는 release hard stop이다.

`LOCAL_DOMAIN_STATE_MODE`에서는 state-contract의 invariant와 filter/search × mutation matrix를 unit/browser QA에 포함한다. 데이터 손실 가능성, 구조 필드 broad patch, hidden-data destructive action, migration/recovery 누락은 release hard stop이다.

`EXTERNAL_DATA_INGESTION_MODE`에서는 source fixture, runtime schema, empty/drift/count-drop, atomic promotion, last-known-good, clean clone/provider build matrix를 검증한다. static target에서는 promoted `public/` required/validated optional/last-known-good snapshot과 실제 `dist/|out/` 복사본 digest가 같아야 한다. `ingestion` machine receipt 누락, required artifact 누락·empty·schema/count/freshness/coverage failure, 배포 복사본 parity 실패, 실제 runtime mode와 locked capability 불일치는 release hard stop이다. Vercel static external-ingestion은 격리 build namespace 종료 후 attested immutable artifact를 동일 prebuilt deployment에 결합하는 protected broker evidence가 없으면 provider build가 통과해도 release `BLOCKED`다. Markdown `qa-data-quality.md`만으로 machine receipt를 대체하지 않는다.
`VISUAL_QA_MODE`에서는 승인 manifest와 browser `visualEvidence`를 요구한다. unreviewed baseline, stale hash, missing target/mode, snapshot mutation, 환경 drift는 release hard stop이다.

read-only verifier는 보고서 본문을 반환하고 오케스트레이터가 해당 경로에 저장한다. verifier에게 Write/Edit 권한을 부여하지 않는다.

Next 최종 리포트를 제외한 일반·조건부 QA 리포트와 격리 CI receipt가 완성되면 external quality attestation을 만든다. Next profile은 서명 뒤 machine validator와 read-only verifier를 순서대로 실행해 `_workspace/04_qa/qa-next-contract.md`를 저장한다. 그 다음 report hash, machine receipt, 전체 source fingerprint, 모든 package/workspace manifest hash와 attestation을 manifest v3에 고정한다:

```bash
node .claude/scripts/prepare-quality-attestation.mjs --project . --issuer-run-id <trusted-ci-run-id>
# unsigned request를 checkout 밖의 protected trust/CI identity와 대조해 final subject를 구성·서명한 뒤
# Next profile이면 validate-next-contracts.mjs와 next-contract-verifier를 실행한 뒤
node .claude/scripts/validate-release-gate.mjs --write-manifest
node .claude/scripts/validate-release-gate.mjs
```

필수 리포트 누락, `FAIL`, `BLOCKED`, `NEEDS_REVIEW`, receipt 누락·stale·non-zero exit, test file 0개, source/manifest hash 불일치 중 하나라도 있으면 release-manager를 실행하지 않는다. Markdown 표만 PASS로 바꿔서는 gate를 통과할 수 없다.

완료 후 `release-manager` 실행:
- FAIL 항목 있으면 해당 에이전트 재실행 (retry-policy.md 기준, 보고서별 최대 2회)
- 같은 QA 보고서가 3회 연속 FAIL이면 Hard Stop — 사용자에게 보고하고 자동 재시도를 중단한다
- 배포 CI, scheduled ingestion workflow 또는 provider config가 필요한데 Phase 4 전에 생성되지 않았다면 release를 중단하고 해당 owner agent 실행 후 quality runner부터 다시 시작
- release gate가 exit 0이고 모두 PASS(또는 정책상 WARN)일 때만 `_workspace/RELEASE/HANDOFF.md` 생성. 그 미만이면 `release-tier-contract.md`의 tier 판정에 따라 `release-manager`가 `release-readiness.md`로 tier 라벨과 승급 경로를 보고한다
