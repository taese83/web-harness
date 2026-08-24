# Change Scope

CHANGE_MODE: existing-change
REQUEST: packages에 Web Harness Console 로컬 서비스를 만들고 root `pnpm console`로 실행
OBSERVED_BASELINE: root는 web-harness control-plane이며 UI package/workspace script가 없음
TARGET_BEHAVIOR: 02_design까지 안전하게 인덱싱하고 문서·FEAT/TC·preview 상태·세션 변경점을 표시
ALLOWED_PATHS: `packages/web-harness-console/**`, `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`
PUBLIC_CONTRACTS_TO_PRESERVE: 기존 validate/ci scripts, .claude/.agents mirror, workspace 서비스 파일 read-only
NON_GOALS: 기존 preview 재생성/승인, dev/qa 인덱싱, 배포, 외부 dependency
CHANGE_BUDGET: 신규 local package, root script/workspace metadata, Node tests
TEST_EVIDENCE:
- `node --test packages/web-harness-console/test/*.test.mjs` — 3/3 PASS (FEAT/TC parsing, 00/01/02 allowlist + session diff, read-only/origin integration)
- `pnpm --filter @web-harness/console check` — PASS (server, indexer, browser module syntax)
- `node .claude/scripts/validate-artifact-sharding.mjs --project packages/web-harness-console` — PASS (13 artifacts)
- in-app browser smoke at `http://127.0.0.1:4310` — 8 projects observed; Documents excludes 03_dev/04_qa; nocode-builder shows 26 FEAT/53 TC, MISSING preview status, isolated preview content, refresh/UNCHANGED; console error log empty
- `pnpm validate` with the repository-pinned pnpm runtime — PASS (54 harness checks)
- `pnpm audit --prod --registry=https://registry.npmjs.org` — PASS (no known vulnerabilities)
CAPABILITY_ESCALATION: none — localhost-only read-only tool, 외부 API·secret·auth 없음
DOCS_TO_UPDATE: package-local 01_plan/02_design only

## Round 2 — Feature detail inspector

CHANGE_MODE: existing-change
REQUEST: Feature 항목 클릭 시 상세 내용 표시
OBSERVED_BASELINE: Features 탭은 FEAT ID·제목·TC ID 칩만 정적으로 표시하며 선택 상태와 상세 정보가 없음
TARGET_BEHAVIOR: Feature 카드를 선택하면 설명·메타데이터·Test Case Given/When/Then·관련 문서·Preview anchor 매칭 상태를 상세 패널에 표시하고 URL hash로 선택을 복원
ALLOWED_PATHS: `packages/web-harness-console/src/indexer.mjs`, `packages/web-harness-console/public/app.js`, `packages/web-harness-console/public/styles.css`, `packages/web-harness-console/test/indexer.test.mjs`, package-local `_workspace/**`
PUBLIC_CONTRACTS_TO_PRESERVE: 00/01/02 read allowlist, GET/HEAD-only API, preview origin isolation, safe textContent rendering, keyboard/focus semantics, 기존 project/tab/document deep link
NON_GOALS: Preview DOM에 FEAT badge overlay 삽입, workspace 문서 수정, dependency 추가, 서버 mutation endpoint
CHANGE_BUDGET: parser 1개 확장, Feature 2-pane UI, 관련 unit/browser assertions, canonical 문서 동기화
TEST_EVIDENCE: parser fixture 상세 필드, 기존 catalog/server regression, localhost Feature 선택·URL·상세 패널 browser smoke, root harness validation
CAPABILITY_ESCALATION: none — 기존 read-only 응답 shape 확장과 클라이언트 선택 상태만 변경
DOCS_TO_UPDATE: `_workspace/01_plan/feature-plan.md`, `_workspace/02_design/api-schema.md`, `_workspace/02_design/layout-spec.md`, `_workspace/02_design/component-spec/content-panels.md`

ROUND_RESULT: PASS (local iterate evidence; release attestation not created)
ROUND_TEST_EVIDENCE:
- `node --test packages/web-harness-console/test/*.test.mjs` — 4/4 PASS after one compatibility retry; previous bare `TC-*` line format preserved
- `pnpm --filter @web-harness/console check` — PASS
- `node .claude/scripts/validate-artifact-sharding.mjs --project packages/web-harness-console` — PASS (13 Markdown artifacts)
- in-app browser at `http://127.0.0.1:4310/#project=nocode-builder-0e2d5d16&tab=features&feature=FEAT-003` — selected card and detail heading agree; priority/screen/scope, behavior, 4 Given/When/Then cases, related document navigation, MISSING preview mapping, URL restore observed; console error log empty
- repository `pnpm validate` with pinned runtime — PASS (54 harness checks)
ROUND_EXIT_GATES: capability escalation not detected; existing package has no `_workspace/04_qa/evidence/` receipts to reissue; all listed canonical documents updated

## Round 3 — Preview mapping navigation

CHANGE_MODE: existing-change
REQUEST: Preview mapping이 있으면 카드를 실행해 해당 프리뷰 위치로 이동하고 Feature 상세 side panel을 자동으로 열며, 의미 없는 숫자 count를 `TC 3`처럼 명확히 표시
OBSERVED_BASELINE: mapping card는 read-only article이며 route/anchor를 표시만 하고, Preview iframe은 항상 root URL을 연다. Feature/mapping count badge는 숫자만 표시해 의미가 불명확
TARGET_BEHAVIOR: mapping card click/Enter/Space → Preview 탭 전환 → 안전하게 인코딩한 anchor query와 검증된 hash route로 iframe 로드 → preview가 anchor를 reveal/scroll하고 상세 drawer를 자동 오픈; 관련 count는 `TC N`으로 표기
ALLOWED_PATHS: `packages/web-harness-console/public/app.js`, `packages/web-harness-console/public/styles.css`, `packages/web-harness-console/src/indexer.mjs`, package-local `_workspace/**`, `workspace/nocode-builder/_workspace/02_design/preview/index.html`, `workspace/nocode-builder/_workspace/02_design/preview/app.js`, `workspace/nocode-builder/_workspace/02_design/preview/traceability.json`, `workspace/nocode-builder/_workspace/02_design/component-spec/traceability-overlay.md`, `workspace/nocode-builder/_workspace/02_design/layout-spec/tool-detail.md`, `workspace/nocode-builder/_workspace/03_dev/**`
PUBLIC_CONTRACTS_TO_PRESERVE: GET/HEAD-only API, preview origin isolation, safe textContent, project/tab/feature deep links, mapping-absent 안내, Preview approval 상태, preview CRUD/route/localStorage, backdrop/Esc/focus return
NON_GOALS: API mutation, cross-origin DOM access, 새 FEAT/TC 발명, dependency/approval/baseline 생성
CHANGE_BUDGET: Console state/hash 1필드, mapping button과 iframe URL 조합, preview query reveal handler, FEAT-001 conditional form activation metadata, UI copy/CSS 최소 수정
TEST_EVIDENCE: mapping keyboard/click, URL anchor state, Preview tab/iframe route, anchor scroll+drawer open, backdrop close, `TC N` copy, mapping-absent regression, syntax/unit/root harness/browser logs
CAPABILITY_ESCALATION: none — 기존 localhost read-only iframe navigation이며 새 서버/API/외부 연결 없음
DOCS_TO_UPDATE: package `_workspace/01_plan/feature-plan.md`, `_workspace/02_design/layout-spec.md`, `_workspace/02_design/component-spec/content-panels.md`; nocode-builder traceability overlay contract
RUNTIME_VERIFIABILITY: LOCAL_VERIFIABLE
SCOPE_EXPANSION_ROOT_CAUSE: 정본 route pattern에는 `:toolId` 같은 placeholder가 있어 직접 실행할 수 없다. indexer가 선택적 `previewRoute`를 실행용 route로 노출하고, tool-detail의 복합 목록 매핑 규칙을 정본 layout 문서에 기록한다.
USER_REFINEMENT: desktop Preview 탭에서는 Console 바깥 document scroll을 잠그고 iframe을 남은 viewport에 맞춰 중복 오른쪽 scrollbar를 제거한다. compact layout의 정상 page scroll은 유지한다.

## Round 4 — Hierarchical Sub Feature traceability

CHANGE_MODE: existing-change
REQUEST: 복합 Feature를 `FEAT-004-01` 같은 안정 하위 기능으로 문서화해 기획·TC·프리뷰 요소·변경 이력을 더 쉽게 매핑
OBSERVED_BASELINE: Feature/validator/Console은 `FEAT-NNN` 단일 계층만 인식하며 세부 동작은 parent anchor 또는 TC에만 표현된다. `FEAT-004-01`은 현재 validator/parser 정규식에서 거부된다.
TARGET_BEHAVIOR: parent `FEAT-NNN`을 보존하면서 선택적 `subFeatures[]`와 `subFeatureId=FEAT-NNN-NN`을 지원하는 traceability schema v2를 추가한다. v1은 계속 유효하고 Console은 parent 아래 하위 기능·TC·anchor를 계층적으로 표시한다.
ALLOWED_PATHS: `.claude/skills/web-plan/references/{design-readiness-contract,plan-history-contract}.md`, `.agents/skills/web-plan/references/{design-readiness-contract,plan-history-contract}.md`, `.claude/skills/web-orchestrator/references/design-approval-contract.md`, `.agents/skills/web-orchestrator/references/design-approval-contract.md`, `.claude/agents/{feature-planner,design-preview-builder}.md`, `.codex/agents/{feature-planner,design-preview-builder}.toml`, `.claude/scripts/{design-preview-status-lib,test-design-preview}.mjs`, `packages/web-harness-console/**`, `workspace/nocode-builder/_workspace/{01_plan,02_design/preview,02_design/component-spec,02_design/layout-spec,03_dev}/**`
PUBLIC_CONTRACTS_TO_PRESERVE: 기존 FEAT/TC ID, traceability schema v1, preview approval 상태 파생, 00/01/02 read allowlist, Console deep link·mapping navigation, preview CRUD/route/localStorage·접근성
NON_GOALS: 기존 모든 프로젝트의 강제 migration, 버튼마다 자동 subfeature 생성, 새 사용자 기능/TC 발명, production app 구현, dependency 추가, 승인/baseline 생성
CHANGE_BUDGET: 문서 계약 3종 mirror, agent prompt mirror, validator+fixture, Console parser/UI, nocode pilot migration(FEAT-004/013)
TEST_EVIDENCE: v1 fixture PASS, valid v2 fixture PASS, invalid parent/subfeature ownership FAIL, Console parser/indexer tests, nocode validator 26 parent FEAT·53 TC·subfeature/anchor coverage, browser parent/subfeature selection·mapping drawer, root harness validation
CAPABILITY_ESCALATION: none — 로컬 read-only 문서/traceability schema와 표시 계층 확장, 서버·인증·DB·외부 연결 없음
DOCS_TO_UPDATE: web-plan Feature List/plan history contract, design preview traceability contract, Console plan/design, nocode feature-plan/traceability overlay/tool-detail
RUNTIME_VERIFIABILITY: LOCAL_VERIFIABLE

ROUND_RESULT: LOCAL_PASS
ROUND_TEST_EVIDENCE:
- design preview validator fixtures: schema v1 valid, schema v2 valid, invalid Sub Feature ownership rejected
- nocode-builder snapshot refresh: `UNAPPROVED`, errors 0, 26 parent FEAT, 53 unique TC, 5 Sub Features, 18 anchors
- Console tests 5/5 and package syntax check PASS; Console artifact sharding PASS
- browser: Sub Feature hash restore, TC/anchor subset detail, Preview mapping navigation and drawer auto-open PASS; literal `null` regression fixed
- repository pinned runtime `pnpm validate`: Harness validation PASS (54 checks)
- `git diff --check`: PASS
ROUND_EXIT_GATES: no capability escalation; schema v1 compatibility preserved; approval/baseline not created

## Round 6 — Append-only Change Request workflow

CHANGE_MODE: existing-change
REQUEST: 현재 Preview의 기능 수정 요청을 기획·TC·디자인 change set으로 기록하고 기준점·이력·version intent를 보존
OBSERVED_BASELINE: Console은 GET/HEAD-only이며 Changes는 server-start file diff만 제공한다. 사용자는 Preview에서 결정을 내리거나 변경 의도를 영구 기록할 수 없다.
TARGET_BEHAVIOR: Features/Preview에서 현재 추적 context가 prefill된 dialog로 요청을 제출하고, 서버는 `_workspace/01_plan/change-requests/CHG-*.md` 하나만 append-only 생성한다. Changes에서 request history를 조회한다.
ALLOWED_PATHS: `packages/web-harness-console/{src,public,test,_workspace,README.md,server.mjs}/**`
PUBLIC_CONTRACTS_TO_PRESERVE: 00/01/02 indexing, canonical document/preview read-only, preview GET/HEAD origin isolation, safe document paths, existing deep links/mapping/fixture behavior, dependency-free runtime
NON_GOALS: canonical plan/design/preview 자동 수정, request 승인·상태 전이, approved design version 발행, Git commit/PR, auth/external API/database
CHANGE_BUDGET: dedicated POST 1개, append-only storage/parser 1개, modal+history UI, contract/integration/security tests
CAPABILITY_ESCALATION: detected — localhost filesystem mutation endpoint 추가. Same-origin intent, bounded JSON, idempotency, exclusive create, symlink boundary와 contract/security verification이 필요하다.
PROFILE_STATUS: UNPROFILED_CUSTOM_CONTROL_PLANE — profile resolver가 `PROFILE_NOT_DETECTED`를 반환했다. 이번 결과는 local diagnostic evidence이며 release readiness를 주장하지 않는다.
RUNTIME_VERIFIABILITY: LOCAL_VERIFIABLE
DOCS_TO_UPDATE: requirements, feature plan, decision log, UX/project brief, API/layout/component/change-set contract, README, change journal

ROUND_RESULT: LOCAL_PASS (release attestation not created; custom profile remains unprofiled)
ROUND_TEST_EVIDENCE:
- pinned Node 22.22.3 / pnpm 11.18.0: Console tests 7/7 PASS and syntax check PASS
- API integration: canonical feature-plan unchanged, one `PROPOSED` file created, replay returned the same ID, invalid Origin/intent/media/target rejected, Preview POST remained 405
- storage security: symlinked `change-requests` directory rejected without writing outside the project
- browser at temporary 4320/4321: Feature and mapped Preview dialogs showed FEAT/anchor/TC/base digest; title autofocus and Esc→trigger focus restoration observed; Changes separated persistent requests/session diff; warning/error logs 0
- package artifact sharding PASS (14 artifacts); `git diff --check` PASS
- security/API contract self-review PASS in `_workspace/04_qa`; no tracked secret-bearing paths
- repository pinned `pnpm validate` PASS (54 harness checks)
ROUND_EXIT_GATES: capability escalation reviewed; canonical overwrite and arbitrary path remain blocked; no existing package evidence receipts required regeneration

## Round 4 hotfix — Legacy server response compatibility

CHANGE_MODE: bug-fix
REQUEST: `Console 데이터를 불러오지 못했습니다: Cannot read properties of undefined (reading 'find')`
ROOT_CAUSE: 새 정적 UI가 재시작 전 Console 서버의 구버전 Feature 응답에서 누락된 `subFeatures`를 배열로 가정했다.
TARGET_BEHAVIOR: `subFeatures`가 없는 구버전 응답을 빈 배열로 정규화해 평면 Feature 화면을 유지하고, 새 응답에서는 계층 UI를 그대로 표시한다.
ALLOWED_PATHS: `packages/web-harness-console/public/app.js`, package-local `_workspace/03_dev/**`
PUBLIC_CONTRACTS_TO_PRESERVE: schema v1 평면 화면, schema v2 계층 화면, feature/subfeature URL hash, preview mapping
CAPABILITY_ESCALATION: none
TEST_EVIDENCE: 재시작된 4310 브라우저에서 list `clientHeight=scrollHeight=3367px`, `max-height:none`, `overflow-y:visible`, nested scrollbar=false; 너비는 기존 360px 유지; nocode-builder `UNAPPROVED`, FEAT-004-01과 Preview mapping 정상 노출
TEST_EVIDENCE: 1280px viewport에서 Feature list가 고정 360px에서 374.8px로 확장되고 grid가 374.8px/562.2px의 2:3 유동 열로 계산됨; INVALID 상태는 실제 validator 오류 문구를 표시
TEST_EVIDENCE: 현재 4310 서버가 26/26 Feature에서 `subFeatures` 누락 응답을 반환하는 상태로 브라우저 재검증 — 오류 문구 0건, Features heading과 FEAT-004 카드 정상 렌더; indexer tests 4/4, package check, `git diff --check` PASS

## Round 4 hotfix — Responsive Feature list width

CHANGE_MODE: ui-change
REQUEST: Feature 목록 너비가 고정돼 보이며 좁은 화면에서는 고정 패널처럼 내부 scrollbar도 남음
ROOT_CAUSE: desktop grid 첫 열이 최대 360px로 고정되고, 단일 열 breakpoint에서도 `max-height`와 `overflow:auto`가 유지되어 목록이 420px 내부 스크롤 영역으로 제한됨
TARGET_BEHAVIOR: desktop에서는 목록:상세가 2:3 유동 비율로 확장되고, 904px 이하에서는 목록이 컨테이너 너비 100%와 콘텐츠 높이를 사용하며 document scroll만 유지
ALLOWED_PATHS: `packages/web-harness-console/public/{styles.css,app.js}`, package-local `_workspace/03_dev/**`
PUBLIC_CONTRACTS_TO_PRESERVE: desktop sticky two-pane list, compact single-column order, keyboard navigation, Preview mapping detail
CAPABILITY_ESCALATION: none

## Round 4 hotfix clarification — Feature list height

CHANGE_MODE: ui-change correction
REQUEST: “너비말고 높이” — 고정된 목록 높이와 내부 scrollbar 제거
SUPERSEDES: 직전 width 해석과 2:3 유동 열 변경은 원복
ROOT_CAUSE: desktop `.feature-list`가 `max-height: calc(100vh - 240px)`와 `overflow:auto`로 별도 scroll container를 생성
TARGET_BEHAVIOR: 기존 desktop 열 너비(최대 360px)는 유지하고, 모든 viewport에서 Feature 목록 높이는 전체 콘텐츠만큼 늘어나며 document scrollbar만 사용
ALLOWED_PATHS: `packages/web-harness-console/public/styles.css`, package-local `_workspace/03_dev/**`
PUBLIC_CONTRACTS_TO_PRESERVE: desktop two-pane width, compact single-column order, Feature selection/hash, keyboard navigation
CAPABILITY_ESCALATION: none

## Round 5 — Deterministic isolated preview fixture

CHANGE_MODE: existing-change
REQUEST: 실제 저장 상태에서 seed entity가 사라져도 Preview mapping의 이름 변경·삭제 동작을 재현 가능하게 유지
TARGET_BEHAVIOR: validated anchor의 선택적 fixture metadata를 API에 노출하고 iframe query로 전달; preview는 일반 localStorage와 격리된 canonical state로 mapping을 실행
ALLOWED_PATHS: `packages/web-harness-console/{src,indexer.mjs,public,test,_workspace}/**`, preview traceability/validator/store/docs
PUBLIC_CONTRACTS_TO_PRESERVE: read-only API, cross-origin iframe, safe route validation, mapping drawer auto-open, 일반 preview 저장 데이터
CAPABILITY_ESCALATION: none
ROUND_RESULT: LOCAL_PASS — 임시 4320/4321 통합 서버에서 Console mapping query가 `canonical-seed` isolated fixture를 열고 drawer를 자동 표시; cascade 삭제 뒤 reload하면 fixture가 reset됨
TEST_EVIDENCE: Console tests 6/6, isolated localStorage boundary read 0/write 0, package check PASS, preview validator `UNAPPROVED` errors 0, pinned root harness 54 checks PASS, browser logs 0

## Round 7 — Preview FEAT drawer Change Request action

CHANGE_MODE: existing-change
REQUEST: Preview에서 FEAT/TC 시나리오를 보여주는 side drawer 안에 `변경 요청` 버튼을 추가
OBSERVED_BASELINE: Features 상세 header와 Preview 상단 toolbar에는 변경 요청 action이 있지만, iframe 안의 `FeatureDetailPanel`에는 action이 없어 시나리오를 읽은 사용자가 문맥을 유지한 채 바로 요청할 수 없다.
TARGET_BEHAVIOR: 모든 mapped FEAT/Sub Feature drawer의 하단에 `변경 요청` 버튼을 표시한다. 버튼은 현재 feature/subfeature/anchor ID만 Console에 전달하고 Console이 현재 catalog에서 ownership·TC·digest를 다시 계산한 뒤 기존 `ChangeRequestDialog`를 연다. 취소 시 preview 버튼으로 focus를 복귀한다.
ALLOWED_PATHS: `packages/web-harness-console/{public,test,_workspace}/**`, `workspace/nocode-builder/_workspace/{02_design/component-spec,02_design/preview,02_design/visual-qa-contract.md,03_dev}/**`, `.claude/agents/design-preview-builder.md`, `.codex/agents/design-preview-builder.toml`, `.claude/skills/web-orchestrator/references/design-approval-contract.md`, `.agents/skills/web-orchestrator/references/design-approval-contract.md`
PUBLIC_CONTRACTS_TO_PRESERVE: Console append-only request endpoint와 server-derived context, preview GET/HEAD-only origin, cross-origin DOM 격리, 기존 Features/toolbar action, FEAT/Sub Feature/TC/anchor ID, drawer backdrop·Esc·focus trap, preview CRUD/route/localStorage, 승인 상태 파생
NON_GOALS: preview iframe의 직접 API/file mutation, arbitrary message payload 신뢰, Change Request 상태 전이, 새 Feature/TC 발명, dependency·baseline·approval 생성, 다른 기존 preview 일괄 migration
CHANGE_BUDGET: Console message contract helper+handler+test, nocode preview drawer action/CSS, canonical plan/design/generator contract 최소 갱신
TEST_EVIDENCE: valid/invalid message contract unit, Console regression suite, preview validator, drawer button→prefilled dialog browser smoke, origin/source/ownership rejection, cancel focus return, 320px/desktop layout review, syntax/Harness/diff checks
CAPABILITY_ESCALATION: none — 기존 localhost preview→Console UI 신호만 추가하며 서버 endpoint·권한·외부 연결은 늘리지 않음. Console은 메시지 데이터를 authority로 사용하지 않고 current catalog로 재검증
DOCS_TO_UPDATE: Console requirements/feature-plan/ux-brief/decision-log/layout/component/change-set contract, nocode traceability overlay/visual QA contract, future design-preview builder contract
RUNTIME_VERIFIABILITY: LOCAL_VERIFIABLE
PROFILE_STATUS: `PROFILE_NOT_DETECTED` — custom localhost control plane이므로 local Iterate evidence로 판정
VISUAL_QA_MODE: true — 기존 drawer visual contract를 확장하되 승인 baseline/manifest는 사용자 명시 승인 전 생성하지 않음

ROUND_RESULT: LOCAL_PASS — Preview drawer action부터 기존 Console Change Request dialog까지의 local Iterate 경로를 검증했으며 release attestation은 생성하지 않음
ROUND_TEST_EVIDENCE:
- Console message contract/regression tests 9/9, package syntax check, package artifact sharding PASS
- nocode-builder preview validator: `UNAPPROVED`, errors 0, 26 Feature, 18 anchor; source digest `196da02653d9dfbc2f6d5eef667e0eaa755a526acdb9851cfeab909f369ccceb`, preview digest `64aa41e2bd7c97e2a0a09c5553d11bfe50823882e1ada42348e4cd72e6733581`
- browser: FEAT-002 drawer action → Console dialog에 Feature/anchor/TC-002-1~3/current digest prefill PASS; cancel → drawer button focus return PASS; standalone Preview action absent PASS
- repository pinned runtime `pnpm validate`: Harness validation PASS (54 checks)
- `git diff --check`: PASS
ROUND_EXIT_GATES: exact iframe source/origin/current-catalog ownership 검증; Preview direct mutation 없음; approval/baseline 생성 없음; `PROFILE_NOT_DETECTED`라 local Iterate evidence만 주장

## Round 8 — Codex Change Request execution bridge

CHANGE_MODE: existing-change
REQUEST: Changes의 `PROPOSED` 요청을 실제 Codex 작업에 연결하고, 연결되지 않았을 때 원인과 복구 방법을 표시
OBSERVED_BASELINE: Change Request는 append-only Markdown으로만 저장되고 이후 Codex 실행 경로·연결 상태·영향 검토·적용 결과가 없다.
TARGET_BEHAVIOR: Changes 카드에서 Codex 연결 상태를 확인하고 `영향 검토`를 read-only Codex 세션으로 실행한다. 검토 완료 후 사용자 명시 확인을 거쳐 별도 workspace-write 세션으로 정본 기획·TC·디자인·Preview 변경을 수행한다. 실행 상태·bounded 결과·thread ID는 03_dev audit log에서 조회하며 연결 불가·인증 실패·timeout·process 실패를 typed state로 표시한다.
ALLOWED_PATHS: `packages/web-harness-console/{src,public,test,server.mjs,package.json,README.md,_workspace}/**`
PUBLIC_CONTRACTS_TO_PRESERVE: 00/01/02 read allowlist, append-only Change Request 원문, Preview GET/HEAD-only origin, exact loopback Origin/intent/idempotency boundary, current Feature/Sub Feature/anchor ownership, 기존 Changes/session diff, no commit/push, no browser secret
NON_GOALS: 등록 즉시 무승인 수정, danger-full-access, 자동 commit/push/PR, 외부 queue/database, remote multi-user auth, arbitrary shell/CLI argv from browser, automatic retry, production release attestation
CHANGE_BUDGET: Codex connection probe+bounded process runner+append-only run events, POST run endpoint 1개, Changes status/actions/approval dialog/polling, AI plan/design/security/eval contracts, focused tests
TEST_EVIDENCE: unavailable/authenticated probe, origin/intent/media/idempotency/ownership rejection, read-only impact argv, explicit apply approval and workspace-write argv, one active run/project, timeout/failure/interrupted recovery, output/schema truncation, Changes browser flow and focus, existing 9 tests regression, syntax/Harness/security/API reports
CAPABILITY_ESCALATION: detected — local server가 authenticated Codex process를 시작하고 workspace-write를 승인 후 허용하는 AI/tool-agent surface 추가. L2 approval, argv-only spawn, loopback/intent/idempotency, workspace containment, no automatic retry, bounded time/output/concurrency와 audit가 필수
DOCS_TO_UPDATE: `_workspace/01_plan/{requirements,feature-plan,ux-brief,decision-log,ai-requirements,autonomy-risk-matrix}.md`, `_workspace/02_design/{api-schema,change-set-contract,layout-spec,component-spec/content-panels,ai-architecture,tool-contracts,data-governance,ai-threat-model,eval-plan,cost-latency-budget}.md`
RUNTIME_VERIFIABILITY: LOCAL_VERIFIABLE
AI_MODE: true
SUBMODES: [TOOL_AGENT_MODE]
AUTONOMY_LEVEL: L2
PROFILE_STATUS: `PROFILE_NOT_DETECTED` — dependency-free custom localhost control plane, local Iterate evidence only

ROUND_RESULT: LOCAL_PASS — Codex CLI connected and approval-gated run path is locally verifiable; live model run remains user-triggered and was not started by QA
ROUND_TEST_EVIDENCE:
- installed runtime: `codex-cli 0.147.0-alpha.1.2`, `codex login status` authenticated via ChatGPT; server startup reports `Codex connected`
- Console package syntax PASS and regression/runtime/API tests 14/14 PASS in approved loopback context
- server policy tests: unsupported body field, bad Origin/intent/media, apply without approval, duplicate/active run and interrupted recovery rejected without extra process
- package artifact sharding PASS (22 artifacts); pinned repository `pnpm validate` Harness PASS (54 checks)
- static AI ladder baseline→foundation→routing→services→policy→eval-contracts PASS; 31 scenario contracts valid
- browser hard reload: CONNECTED/version copy, two enabled impact actions, 40px action, warning/error logs 0
- `git diff --check`: PASS
ROUND_EXIT_GATES: capability escalation security/API/AI reports updated; no existing evidence directory to reissue; canonical Plan/Design docs synchronized; actual live impact/apply not auto-started; no commit/push/PR/deploy

## Round 9 — READY_FOR_REVIEW decision actions

CHANGE_MODE: existing-change
REQUEST: `READY_FOR_REVIEW` Change Request 카드에서 승인·수정 요청·변경 폐기 결정을 직접 선택
OBSERVED_BASELINE: apply 결과는 `READY_FOR_REVIEW` 상태와 결과만 표시하며 검토 결정을 기록하거나 다음 Codex revision에 연결하는 action이 없다.
TARGET_BEHAVIOR: 완료된 apply 결과에 `승인`, `수정 요청`, `변경 폐기` action을 표시한다. 결정은 원본 Change Request와 run audit을 수정하지 않는 append-only event로 정확한 apply run에 결속한다. 수정 요청 사유는 다음 승인 기반 Codex apply에 server-side로 전달한다. 변경 폐기는 검토 결과를 종료하지만 안전한 기준점이 없는 기존 run의 실제 파일을 자동 복원하지 않는다.
ALLOWED_PATHS: `packages/web-harness-console/{src,public,test,server.mjs,package.json,README.md,_workspace}/**`
PUBLIC_CONTRACTS_TO_PRESERVE: Change Request 원문과 Codex run audit append-only, loopback Origin/intent/idempotency, current request/run ownership, impact→apply L2 승인, Preview GET/HEAD-only, no commit/push/PR/deploy, unrelated worktree 보존
NON_GOALS: 기존 apply의 자동 reverse patch, Git checkout/reset, 격리 worktree 후보 패치, release/version 발행, remote multi-user reviewer identity
CHANGE_BUDGET: review event store 1개, guarded POST endpoint 1개, Changes action/dialog/status, revision feedback prompt binding, focused unit/integration/UI regression, canonical Plan/Design/QA sync
TEST_EVIDENCE: exact apply-run binding, invalid transition/origin/intent/media/idempotency rejection, append-only replay, terminal decision run block, revision feedback server binding, card actions/dialog/focus, syntax/test/Harness/browser smoke
CAPABILITY_ESCALATION: detected — 기존 workspace-write AI 실행의 사람 검토 state와 재실행 prompt input을 확장하므로 approval/audit/security/API 검증을 재실행
DOCS_TO_UPDATE: `_workspace/01_plan/{requirements.md,feature-plan.md,ux-brief.md,decision-log/INDEX.md,decision-log/pc-001-050.md,ai-requirements.md,autonomy-risk-matrix.md}`, `_workspace/02_design/{api-schema/INDEX.md,api-schema/codex-review.md,api-schema/common-read.md,change-set-contract.md,layout-spec.md,component-spec/content-panels.md,ai-architecture.md,tool-contracts.md,data-governance.md,ai-threat-model.md,eval-plan.md,cost-latency-budget.md}`
RUNTIME_VERIFIABILITY: LOCAL_VERIFIABLE
AI_MODE: true
SUBMODES: [TOOL_AGENT_MODE]
AUTONOMY_LEVEL: L2
PROFILE_STATUS: `PROFILE_NOT_DETECTED` — dependency-free custom localhost control plane, local Iterate evidence only

ROUND_RESULT: LOCAL_PASS — READY_FOR_REVIEW 결정 action, append-only exact-run audit, revision feedback loop와 terminal policy를 로컬에서 검증했으며 실제 CHG-002 결정은 제출하지 않음
ROUND_TEST_EVIDENCE:
- Console syntax PASS, regression/API/storage tests 17/17 PASS in approved loopback context
- browser hard load: CHG-002 READY_FOR_REVIEW에 승인/수정 요청/변경 폐기, required reason, discard no-auto-restore copy, cancel focus return, 40px actions/no overflow, browser logs 0
- package artifact sharding PASS (22 artifacts); decision-log과 api-schema는 INDEX 기반 shard로 전환
- pinned repository `pnpm validate`: Harness validation PASS (54 checks)
- static AI ladder baseline→foundation→routing→services→policy→eval-contracts PASS; 31 scenario contracts valid
- no `_workspace/04_qa/evidence/` directory exists, so no stale machine receipt was retained
ROUND_EXIT_GATES: capability escalation security/API/AI/data/trace/browser reports updated; canonical Plan/Design docs synchronized; no live decision/model run, file restore, commit/push/PR/deploy

## Round 10 — Approved Change Request Feature revision history

CHANGE_MODE: existing-change
REQUEST: 승인된 Change Request를 기존 FEAT/Sub Feature에 연결해 기능 관점의 revision 이력으로 조회
OBSERVED_BASELINE: Change Request는 생성 시 target Feature context를 보존하고 승인 결정은 exact apply run에 결속되지만, Features 상세에는 승인된 변경 이력이 없고 승인 event에는 최종 영향 FEAT/TC snapshot이 없다.
TARGET_BEHAVIOR: 새 apply 결과가 영향 FEAT/Sub Feature/TC와 최종 source/preview digest를 구조화해 반환한다. 승인 시 서버가 target 포함 여부와 ID 형식을 검증해 immutable featureLinks snapshot을 append-only decision event에 저장하고, indexer가 승인된 CHG를 기존 FEAT/Sub Feature의 `approvedChanges`로 투영한다. Features 상세에서 이력을 확인하고 Changes의 해당 CHG로 이동할 수 있다.
ALLOWED_PATHS: `packages/web-harness-console/{src,public,test,server.mjs,README.md,_workspace}/**`
PUBLIC_CONTRACTS_TO_PRESERVE: Change Request 원문·Codex run·review event append-only, 기존 legacy apply output 승인 호환, loopback Origin/intent/idempotency, exact apply-run ownership, FEAT/Sub Feature/TC ID ownership, Preview GET/HEAD-only, 기존 Features/Changes deep link와 focus, no commit/push/PR/deploy
NON_GOALS: 정본 feature-plan에 CHG ID를 직접 삽입, 승인 즉시 release/version 발행, 기존 승인 event rewrite, Git history/remote reviewer identity, 변경 폐기 자동 복원
CHANGE_BUDGET: Codex result optional trace fields, approval snapshot validation, indexer projection, Feature history section과 양방향 이동, focused unit/integration/UI regression, canonical Plan/Design sync
TEST_EVIDENCE: structured apply result normalization, target-mismatch approval rejection, legacy fallback snapshot, parent/Sub Feature approved history projection, Feature→Changes navigation, syntax/test/Harness/browser smoke
CAPABILITY_ESCALATION: none — 기존 승인 endpoint와 read model 안에서 무결성 검증·표시를 강화하며 새 서버 경로·권한·dependency·외부 연결을 추가하지 않음
DOCS_TO_UPDATE: `_workspace/01_plan/{requirements.md,feature-plan.md,decision-log/INDEX.md,decision-log/pc-001-050.md}`, `_workspace/02_design/{api-schema/common-read.md,api-schema/codex-review.md,change-set-contract.md,layout-spec.md,component-spec/content-panels.md}`
RUNTIME_VERIFIABILITY: LOCAL_VERIFIABLE
AI_MODE: true
SUBMODES: [TOOL_AGENT_MODE]
AUTONOMY_LEVEL: L2
PROFILE_STATUS: `PROFILE_NOT_DETECTED` — dependency-free custom localhost control plane, local Iterate evidence only

ROUND_RESULT: LOCAL_PASS — 승인된 CHG를 기존 FEAT/Sub Feature revision read model에 연결하고 실제 승인 이력의 양방향 탐색을 검증함
ROUND_TEST_EVIDENCE:
- Console syntax PASS; unit/integration/API/storage tests 19/19 PASS with loopback fixture
- target FEAT omission rejection, structured apply snapshot, legacy `request-context-legacy`, parent/Sub Feature projection assertions PASS
- browser at temporary 4320/4321: nocode-builder FEAT-001에 approved CHG-20260806-002 표시, history → exact Changes focus → Target → FEAT 복귀 PASS; warning/error logs 0
- package artifact sharding PASS (22 artifacts)
- pinned Node 22.22.3/pnpm 11.18.0 repository Harness validation PASS (54 checks)
- AI static ladder baseline→foundation→routing→services→policy→eval-contracts PASS; 31 scenario contracts valid
- no `_workspace/04_qa/evidence/` directory exists, so no stale machine receipt was retained
ROUND_EXIT_GATES: capability escalation 없음; canonical Plan/Design/API/component docs와 local QA reports 동기화; live decision/model run, commit/push/PR/deploy 없음

## Commit readiness — self-contained Preview trace fixture

CHANGE_MODE: existing-change
REQUEST: 커밋 전 Console 회귀 테스트가 gitignored 로컬 `workspace/nocode-builder`에 의존하지 않도록 정리
OBSERVED_BASELINE: `test/trace-fixture.test.mjs`가 저장소에 포함되지 않는 nocode-builder Preview의 app/store/traceability 파일을 직접 읽어 현재 작업공간에서만 통과함
TARGET_BEHAVIOR: Console package 내부의 최소 committed fixture만으로 sidebar FEAT/TC ownership과 isolated-reset localStorage 격리를 재현하고 새 clone/CI에서도 동일하게 실행
ALLOWED_PATHS: `packages/web-harness-console/test/**`, Console change scope/journal
PUBLIC_CONTRACTS_TO_PRESERVE: FEAT-002/FEAT-013 sidebar 책임, TC subset, isolated-reset의 일반 localStorage read/write 0회, production/사용자 workspace 비변경
NON_GOALS: nocode-builder workspace 추적 전환, 실제 Preview 파일 복제, Console runtime/API 변경, dependency 변경
CAPABILITY_ESCALATION: none — test fixture 경계만 변경
ROUND_RESULT: LOCAL_PASS — package test에서 `workspace/nocode-builder` 참조 0건; Console 20/20, syntax, Harness 54, adapter parity와 diff whitespace 검사 PASS

## Round 11 — Isolated candidate change application

CHANGE_MODE: existing-change
REQUEST: Codex apply가 검토 전에 실제 프로젝트를 수정하지 않도록 candidate workspace에서 변경을 만들고 승인 시에만 정본으로 승격
OBSERVED_BASELINE: apply는 project root를 cwd로 `workspace-write` Codex를 실행해 `READY_FOR_REVIEW` 시점에 정본 파일이 이미 변경된다. `DISCARDED`는 audit만 종료하며 복원할 안전한 patch가 없다.
TARGET_BEHAVIOR: apply마다 프로젝트 baseline을 독립 temporary candidate workspace에 복제하고 Codex는 그 경계만 수정한다. 결과는 bounded candidate manifest와 changed file bundle로 보존한다. 검토 전 정본 digest는 유지되고, `APPROVED`만 baseline 불변을 재검증한 뒤 candidate를 정본에 적용한다. `REVISION_REQUESTED|DISCARDED`는 정본을 건드리지 않는다.
ALLOWED_PATHS: `packages/web-harness-console/{src,public,test,server.mjs,package.json,README.md,_workspace}/**`, root CI integration files
PUBLIC_CONTRACTS_TO_PRESERVE: Change Request/run/review append-only audit, exact apply-run binding, FEAT/Sub Feature/TC·preview digest 승인 검증, loopback Origin/intent/idempotency, one active run, bounded timeout/output, no shell/commit/push/PR/deploy/danger-full-access, Preview/document read boundary
NON_GOALS: Git branch/worktree 의존, remote repository, automatic commit/rollback history, concurrent candidate merge, binary/huge project 무제한 복제, multi-user approval
CHANGE_BUDGET: candidate workspace/manifest module 1개, Codex manager와 review endpoint 연결, Changes copy/status, unit+server regression, canonical Plan/Design/Security/API 문서 동기화; dependency 없음
TEST_EVIDENCE: apply executor cwd 격리, 정본 pre-review 불변, candidate changed paths truth, stale baseline 승인 거부, 승인 시 단일 승격, revision/discard 정본 무변경, traversal/symlink/size bound, 기존 20 tests와 root CI/Harness
CAPABILITY_ESCALATION: none — 기존 workspace-write 공격 표면을 temporary candidate로 축소하고 승인 시 서버 검증 승격만 허용
DOCS_TO_UPDATE: `_workspace/01_plan/{requirements.md,feature-plan.md,decision-log/pc-001-050.md}`, `_workspace/02_design/{change-set-contract.md,api-schema/codex-review.md,component-spec/content-panels.md,layout-spec.md,ai-architecture.md,tool-contracts.md,ai-threat-model.md,eval-plan.md`
RUNTIME_VERIFIABILITY: LOCAL_VERIFIABLE
AI_MODE: true
SUBMODES: [TOOL_AGENT_MODE]
AUTONOMY_LEVEL: L2
PROFILE_STATUS: `PROFILE_NOT_DETECTED` — dependency-free localhost control plane의 local Iterate evidence

ROUND_RESULT: LOCAL_PASS — apply를 temporary candidate로 격리하고 review 승인에만 stale-guarded 정본 승격을 연결했다. Console 23/23, root CI/Harness 55, AI eval contracts, artifact sharding, adapter parity, browser smoke와 diff whitespace 검사가 통과했다.
ROUND_TEST_EVIDENCE:
- candidate unit/runtime/API: executor cwd 격리, 정본 pre-review/revision 불변, server diff, stale base, rollback, traversal/symlink fail-closed PASS
- pinned Node 22.22.3/pnpm 11.18.0 `pnpm run ci`: Console 23/23, Harness 55 checks, AI staged contracts PASS
- artifact sharding 22 artifacts, adapter mirror parity, `git diff --check` PASS
- browser temporary 4330/4331: Changes 정상 렌더, 1280px horizontal overflow 0, warning/error 0; live model run/review mutation 없음
ROUND_EXIT_GATES: Plan/Design/API/AI/Security/Browser 문서 동기화; dependency·commit·push·PR·deploy 없음; candidate retention과 crash-atomic durable transaction은 후속 운영 과제

## Round 12 — Page-grouped Feature planning and Console navigation

CHANGE_MODE: existing-change
REQUEST: 기획 단계의 `feature-plan.md`에 페이지 단위 대분류를 추가하고 Console Features 목록을 같은 대분류로 그룹핑
OBSERVED_BASELINE: Feature List는 `화면` 문자열만 가지며 페이지 자체의 안정 ID·표시명·순서 계약이 없다. Console은 FEAT/Sub Feature를 하나의 평면 목록으로 렌더링해 페이지별 기능 범위를 한눈에 구분할 수 없다.
TARGET_BEHAVIOR: 새 기획 문서는 `PAGE-NNN` Page Groups 표와 Feature List의 단일 primary `페이지 그룹` 참조를 작성한다. Console은 explicit Page Group을 label/order와 함께 인덱싱하고 페이지 section별로 FEAT tree를 표시한다. 기존 문서는 `화면`의 첫 항목을 fallback group으로 사용하고 화면도 없을 때만 `미분류`로 묶는다.
ALLOWED_PATHS: `.claude/agents/feature-planner.md`, `.claude/skills/web-plan/references/design-readiness-contract.md`, generated `.agents/.codex` adapter mirrors, `packages/web-harness-console/{src,indexer.mjs,public,test,README.md,_workspace}/**`
PUBLIC_CONTRACTS_TO_PRESERVE: FEAT/FEAT-NNN-NN/TC stable ID와 순서, Preview anchor·Change Request·approved revision ownership, feature/subfeature URL hash, 00/01/02 read allowlist, legacy feature-plan parsing, responsive/keyboard navigation, no new mutation/API/dependency
NON_GOALS: 기존 workspace의 feature-plan 일괄 rewrite, Preview source/digest 재생성, page route 실행 계약 변경, 접기/펼치기 persistence, 검색·필터, FEAT ID 재번호화
CHANGE_BUDGET: planning contract/feature-planner template, parser metadata 1개, Features group wrapper/CSS, focused unit/API/browser regression, Console Plan/Design/QA sync; dependency 없음
TEST_EVIDENCE: explicit PAGE label/order parse, multiple page group ordering, legacy screen fallback, missing screen ungrouped, FEAT/Sub Feature selection/hash/detail 회귀, desktop/compact DOM group headings, Console full tests, root CI/Harness, adapter parity, artifact sharding, browser warning/error/overflow
CAPABILITY_ESCALATION: none — 기존 read model과 Features 표시 계층만 확장하며 server endpoint·권한·외부 연결을 추가하지 않음
DOCS_TO_UPDATE: `web-plan/references/design-readiness-contract.md`, feature-planner output contract, Console `_workspace/01_plan/{requirements.md,feature-plan.md,decision-log/pc-001-050.md}`, `_workspace/02_design/{api-schema/common-read.md,layout-spec.md,component-spec/content-panels.md}`, README와 QA/browser 보고서
RUNTIME_VERIFIABILITY: LOCAL_VERIFIABLE
AI_MODE: true (기존 Console Codex bridge 유지, 이번 변경은 model/runtime surface 비확장)
SUBMODES: [TOOL_AGENT_MODE]
AUTONOMY_LEVEL: L2 (기존 상태 유지)
PROFILE_STATUS: `PROFILE_NOT_DETECTED` — dependency-free custom localhost control plane, local Iterate evidence only

ROUND_RESULT: LOCAL_PASS — 새 `PAGE-NNN` 기획 계약과 Console 페이지 그룹 탐색을 구현하고 explicit/legacy/미분류 경로를 검증함
ROUND_TEST_EVIDENCE:
- explicit Page Groups: `순서` 기준 6개 section, 13 FEAT, 47 TC를 표시하고 FEAT-013 선택/hash/detail 복원 PASS
- legacy screen fallback: nocode-builder 26 FEAT를 첫 `화면` 값 기준 7개 section으로 보존하고 FEAT-013을 `table-builder`에 배치 PASS
- 1280px에서 body horizontal overflow 0, Feature 목록 nested scroll 없음, browser warning/error 0
- Console syntax와 24/24 unit/API/integration tests PASS
- pinned Node 22.22.3/pnpm 11.18.0 root CI PASS: Harness 55 checks, AI static ladder와 31 scenario contracts PASS
ROUND_EXIT_GATES: canonical planning template와 generated adapter mirrors, Console Plan/Design/API/Browser 문서 동기화; 기존 workspace 일괄 migration, live model run, mutation API, dependency, commit/push/PR/deploy 없음

## Round 13 — Viewport-equal Feature panes

CHANGE_MODE: existing-change
REQUEST: Features 목록과 선택 상세 영역의 높이를 화면에 남은 공간 100%로 동일하게 맞추고 내용이 넘치면 각 영역 안에서 스크롤
OBSERVED_BASELINE: desktop Features는 두 열이 문서 흐름 전체 높이로 늘어나며 목록/상세 중 긴 쪽이 page 높이를 결정한다. Page Group 도입 후 목록과 상세의 길이가 커져 서로 다른 위치를 확인하려면 전체 document를 반복 이동해야 한다.
TARGET_BEHAVIOR: 905px 이상 Features 탭은 header·tabs·section heading을 제외한 남은 viewport를 두 pane이 같은 높이로 채운다. 목록과 상세은 각각 `overflow-y:auto`로 독립 스크롤하고 선택 FEAT/Sub Feature는 목록 viewport에 자동 노출된다. compact는 단일 page scroll을 유지한다.
ALLOWED_PATHS: `packages/web-harness-console/{public,test,_workspace}/**`
PUBLIC_CONTRACTS_TO_PRESERVE: 360px desktop list width, PAGE→FEAT→Sub Feature 순서, selection/hash/detail/TC/Preview/approved history/Change Request, 904px 이하 single-column page flow, Preview tab viewport behavior, keyboard/focus, no horizontal overflow
NON_GOALS: page group accordion, 검색·필터, pane resize, scroll 위치 persistence, 다른 탭 layout 변경, API/indexer/dependency 변경
CHANGE_BUDGET: Features desktop CSS viewport mode, selected item visibility helper, focused static/browser regression, layout/component/QA docs; dependency 없음
TEST_EVIDENCE: 두 pane computed height 동일, clientHeight가 viewport 남은 높이와 일치, 각각 scrollHeight>clientHeight일 때 독립 scroll, body overflow 잠금/가로 overflow 0, FEAT-021 deep link selected visible, compact CSS fallback, Console full tests와 root CI
CAPABILITY_ESCALATION: none — 기존 read-only Features presentation과 client selection visibility만 변경하며 서버·권한·외부 연결을 추가하지 않음
DOCS_TO_UPDATE: `_workspace/01_plan/{requirements.md,feature-plan.md,decision-log/pc-001-050.md}`, `_workspace/02_design/{layout-spec.md,component-spec/content-panels.md}`, `_workspace/04_qa/qa-browser.md`
RUNTIME_VERIFIABILITY: LOCAL_VERIFIABLE
AI_MODE: true (기존 Console Codex bridge 유지, 이번 layout change는 AI surface 비확장)
SUBMODES: [TOOL_AGENT_MODE]
AUTONOMY_LEVEL: L2 (기존 상태 유지)
PROFILE_STATUS: `PROFILE_NOT_DETECTED` — dependency-free custom localhost control plane, local Iterate evidence only

ROUND_RESULT: LOCAL_PASS — desktop Features 목록/상세을 동일 viewport 높이의 독립 scroll pane으로 전환하고 deep-link selection 노출을 검증함
ROUND_TEST_EVIDENCE:
- temporary 4340/4341, 1280×720: list/detail rect height 모두 452.5px, top 243.5px, bottom 696px
- list `scrollHeight/clientHeight=3797/453`, detail `643/451`, 두 pane `overflow-y:auto`; 각각 +80px 이동 후 body scrollY 0 유지
- FEAT-021 deep link selected card가 list viewport 안에 자동 노출(`scrollTop=2139`), horizontal overflow 0, warning/error log 0
- Console syntax와 24/24 tests, pinned root CI/Harness 55, AI static ladder와 31 scenario contracts PASS
ROUND_EXIT_GATES: capability escalation 없음; requirements/FEAT/TC/decision/layout/component/browser QA와 owner journal 동기화; evidence directory 없음; dependency·live model run·mutation·commit/push/PR/deploy 없음

## Round 14 — Append-only Change Request revisions before apply

CHANGE_MODE: existing-change
REQUEST: 영향도 검토 이후라도 실제 변경 적용 전에는 Change Request 요청사항을 수정할 수 있게 하고 수정 이력을 보존
OBSERVED_BASELINE: 최초 Change Request는 append-only 문서로만 생성되며 오기나 영향도 분석의 잘못된 전제가 발견되어도 적용 전 요청 내용을 정정할 수 없다. 이미 완료된 영향도 결과가 어떤 요청 본문을 기준으로 생성됐는지도 실행 계약에 결합되지 않는다.
TARGET_BEHAVIOR: apply 실행 전까지 제목·요청 내용·사유·기대 동작·버전 의도를 수정본으로 추가한다. 최초 요청은 불변으로 유지하고 revision 문서를 append-only로 보존한다. 수정 후 이전 영향도는 STALE이며 최신 요청 digest로 영향도를 다시 실행해야 apply할 수 있다.
ALLOWED_PATHS: `packages/web-harness-console/{src,public,test,server.mjs,README.md,_workspace}/**`
PUBLIC_CONTRACTS_TO_PRESERVE: 원본 CHG 불변, FEAT/Sub Feature/Preview target 불변, loopback Origin·intent·JSON·idempotency guard, one active run, candidate 격리와 exact review binding, 승인 시에만 정본 승격, 기존 Change/Run/Review audit 가독성
NON_GOALS: target Feature 변경, apply 시작 후 요청 본문 재작성, revision 삭제/덮어쓰기, 요청 수정만으로 자동 Codex 실행, 승인 candidate의 암묵적 무효화, remote 협업 편집
CHANGE_BUDGET: revision 저장/read model, guarded mutation endpoint 1개, run request digest 결합, Changes 수정 dialog·이력/STALE 표시, focused unit/API/browser regression, canonical Plan/Design/Security/API 문서 동기화; dependency 없음
TEST_EVIDENCE: 원본 markdown 불변과 revision 순서/idempotency, effective request read model, apply 전 수정 허용, active/apply/review 이후 수정 거부, 이전 impact digest apply 거부, 재검사 후 apply 허용, prompt 최신 revision 반영, Origin/intent/media/body guard, Console full tests와 root CI/browser
CAPABILITY_ESCALATION: detected — 기존 localhost mutation 경계에 guarded request-revision endpoint를 추가하고 Codex run/apply authorization을 최신 request digest에 결합
DOCS_TO_UPDATE: `_workspace/01_plan/{requirements.md,feature-plan.md,decision-log/pc-001-050.md}`, `_workspace/02_design/{api-schema/codex-review.md,change-set-contract.md,component-spec/content-panels.md,layout-spec.md,ai-architecture.md,tool-contracts.md,ai-threat-model.md,eval-plan.md`, README와 QA/API/Security/Browser 보고서
RUNTIME_VERIFIABILITY: LOCAL_VERIFIABLE
AI_MODE: true
SUBMODES: [TOOL_AGENT_MODE]
AUTONOMY_LEVEL: L2
PROFILE_STATUS: `PROFILE_NOT_DETECTED` — dependency-free custom localhost control plane, local Iterate evidence only

ROUND_RESULT: LOCAL_PASS — apply 전 append-only 요청 수정, 최신 request digest 기반 impact 만료/재검사, Changes 수정 UI와 보안 경계를 구현함
ROUND_TEST_EVIDENCE:
- original CHG byte identity, revision idempotency/order, symlink rejection, effective read model와 latest revision prompt PASS
- API `impact → revision → stale apply 409 → re-impact → isolated candidate`와 apply-start 이후 revision 409 PASS
- Console syntax와 27/27 tests, adapter parity, toolchain preflight, root CI/Harness/AI eval-contracts, `git diff --check` PASS
- temporary 4350/4351, 1280×720: CHG-003 prefilled revision dialog, immutable FEAT-020 target, approved CHG edit action 없음, horizontal overflow 0, warning/error 0; submit 없음
ROUND_EXIT_GATES: capability escalation reviewed; Plan/Design/API/AI/Security/Browser 문서와 owner journal 동기화; dependency·live revision/model run·candidate·commit/push/PR/deploy 없음; 사용자 4310 보존

## Round 15 — Fixed-height scrollable Codex result panels

CHANGE_MODE: existing-change
REQUEST: Changes 카드의 긴 Codex 변경 적용/영향 검토 결과 높이를 고정하고 패널 내부 스크롤로 확인
OBSERVED_BASELINE: affected files·risks가 긴 completed result는 `.codex-run-panel`이 콘텐츠 전체 높이만큼 늘어나 한 request card가 viewport 여러 배를 차지한다.
TARGET_BEHAVIOR: 목록형 result가 있는 Codex panel은 viewport 대응 320~480px 고정 높이를 사용하고 내부에서만 세로 스크롤한다. heading/status는 panel 상단에 sticky로 유지하고 short pending/error/summary-only panel은 기존 자연 높이를 보존한다.
ALLOWED_PATHS: `packages/web-harness-console/{public,test,_workspace}/**`
PUBLIC_CONTRACTS_TO_PRESERVE: result summary/files/risks/blockers/candidate/thread 전체 가독성, request/review actions, desktop 2-column과 compact reflow, keyboard/wheel/touch scrolling, horizontal overflow 0, API/run lifecycle 불변
NON_GOALS: result 접기/펼치기, 목록 pagination/search, request card 전체 높이 고정, API/result truncation 변경, 다른 Features/Preview pane 변경
CHANGE_BUDGET: result panel state class 1개, CSS fixed block-size/internal scroll/sticky heading, focused static/browser regression, layout/component/browser QA 문서 동기화; dependency 없음
TEST_EVIDENCE: long READY_FOR_REVIEW panel computed height 320~480px, scrollHeight>clientHeight, internal scrollTop 변화와 body scroll 불변, sticky heading, short panel 자연 높이, compact/desktop horizontal overflow 0, Console syntax/tests와 root CI
CAPABILITY_ESCALATION: none — 기존 rendered result의 presentation/scroll containment만 변경하며 server·mutation·권한·외부 연결을 추가하지 않음
DOCS_TO_UPDATE: `_workspace/02_design/{layout-spec.md,component-spec/content-panels.md}`, `_workspace/04_qa/qa-browser.md`, owner journal
RUNTIME_VERIFIABILITY: LOCAL_VERIFIABLE
AI_MODE: true (기존 Codex bridge 유지, AI 실행·도구 계약 비변경)
SUBMODES: [TOOL_AGENT_MODE]
AUTONOMY_LEVEL: L2 (기존 상태 유지)
PROFILE_STATUS: `PROFILE_NOT_DETECTED` — dependency-free custom localhost control plane, local Iterate evidence only

ROUND_RESULT: LOCAL_PASS — 긴 Codex 완료 결과를 viewport 대응 고정 높이의 내부 scroll panel로 전환하고 heading/status 고정을 검증함
ROUND_TEST_EVIDENCE:
- 사용자 4310/4311 최신 서버, 1280×720, CHG-20260806-002 READY_FOR_REVIEW: panel `clientHeight=344`, `scrollHeight=606`, computed `block-size=345.594px`, `overflow-y:auto`
- wheel 입력 후 panel `scrollTop=0→220`, body `scrollY=375` 유지; heading `position:sticky`, horizontal overflow 0, browser warning/error 0
- Console syntax와 27/27 tests, pinned root CI(adapter parity/toolchain/Harness/AI eval-contracts), `git diff --check` PASS
ROUND_EXIT_GATES: capability escalation 없음; layout/component/browser QA와 owner journal 동기화; 최신 4310 서버 실행 중; Change Request/revision/Codex run/review mutation·dependency·commit/push/PR/deploy 없음

## Round 16 — Non-Git isolated candidate Codex apply

CHANGE_MODE: existing-change
REQUEST: 변경 적용 실행 시 `Not inside a trusted directory and --skip-git-repo-check was not specified`로 실패하는 결함 수정
OBSERVED_BASELINE: impact는 canonical Git project에서 성공하지만 apply는 `.git`을 제외한 server-created temporary candidate를 cwd로 사용하면서도 Codex Git repository 검사를 그대로 요구해 process가 변경 전에 실패한다.
TARGET_BEHAVIOR: canonical impact는 기존 Git repository 검사를 유지하고, server-created/contained apply candidate에만 `--skip-git-repo-check`를 전달해 workspace-write Codex가 격리 복사본에서 실행된다.
ALLOWED_PATHS: `packages/web-harness-console/{src/codex-runs.mjs,test/codex-runs.test.mjs,_workspace}/**`
PUBLIC_CONTRACTS_TO_PRESERVE: impact read-only argv, apply candidate-only workspace-write, no danger-full-access/add-dir, server-generated cwd/prompt/schema, bounded timeout/output/audit, approval/digest/review/candidate promotion lifecycle
NON_GOALS: canonical project에서 repository 검사를 비활성화, candidate를 Git repository/worktree로 변경, 동시 실행 정책 변경, failed run 자동 재시도, 기존 실패 audit 삭제, commit/push/PR/deploy
CHANGE_BUDGET: apply argv 조건 1개, phase-specific regression assertion, AI/tool/API/security 문서와 QA/journal 동기화; dependency 없음
TEST_EVIDENCE: 기존 apply argv에는 skip flag가 없다는 최소 재현, impact에는 flag 없음/apply에 정확히 1개 존재 및 cd·sandbox 유지, focused/full Console tests와 root CI, 실제 신규 apply는 사용자 action으로 남김
CAPABILITY_ESCALATION: none — 이미 승인된 candidate-only Codex apply의 필수 CLI trust flag를 phase-scoped로 보정하며 server endpoint·권한·writable root·외부 연결을 추가하지 않음
DOCS_TO_UPDATE: `_workspace/02_design/{ai-architecture.md,tool-contracts.md,ai-threat-model.md,api-schema/codex-review.md}`, `_workspace/04_qa/{qa-api-contract.md,qa-security.md}`와 owner journal
RUNTIME_VERIFIABILITY: LOCAL_VERIFIABLE (argv/unit/integration); 실제 model apply 재실행은 사용자 명시 action
AI_MODE: true
SUBMODES: [TOOL_AGENT_MODE]
AUTONOMY_LEVEL: L2
PROFILE_STATUS: `PROFILE_NOT_DETECTED` — dependency-free custom localhost control plane, local Iterate evidence only

ROUND_RESULT: LOCAL_PASS — non-Git isolated apply candidate에만 Codex repository 검사 예외를 적용해 변경 전 재현을 해소하고 기존 sandbox/candidate 경계를 유지함
ROUND_TEST_EVIDENCE:
- before: focused argv regression 4/5 PASS, apply `--skip-git-repo-check` count 0로 동일 실패 재현
- after: focused 5/5, Console syntax와 27/27, root CI/Harness 55, AI eval contracts 31 PASS
- Codex CLI help에서 공식 `--skip-git-repo-check` option 확인; impact count 0, apply count 1, workspace-write/candidate cwd/no danger-full-access·add-dir assertion PASS
- 최신 server를 4310/4311에 재기동했고 `/api/codex/status`는 authenticated/connected `codex-cli 0.147.0-alpha.1.2` 반환
ROUND_EXIT_GATES: capability escalation 없음; AI/tool/API/security canonical 문서와 QA/owner journal 동기화; evidence directory 없음; 실제 model apply 자동 재실행·dependency·commit/push/PR/deploy 없음

## Round 18 — Physical deletion of unapproved Change Requests

CHANGE_MODE: existing-change
REQUEST: 정본에 반영되지 않은 Change Request는 취소 이력을 남기지 않고 Changes에서 직접 삭제
OBSERVED_BASELINE: Change Request는 생성·수정·Codex 실행·검토 결정만 지원하며, 실제 승격 전의 잘못되거나 불필요한 요청과 연결된 revision/run/candidate audit을 제거할 수 없다.
TARGET_BEHAVIOR: active Codex run과 `APPROVED` 승격이 없는 요청에 `삭제` action을 제공한다. 사용자 확인 후 원본·revision·run audit·review decision·미승인 candidate를 exact CHG 단위로 물리 삭제하고 카드/count/selection을 갱신한다. tombstone이나 취소 사유는 만들지 않는다.
ALLOWED_PATHS: `packages/web-harness-console/{src,public,test,server.mjs,_workspace}/**`
PUBLIC_CONTRACTS_TO_PRESERVE: same loopback Host/Origin/intent 경계, 정본 Source/Plan/Design 승인 전 불변, active run 단일성, 승인된 CHG/Feature revision 영구 보존, candidate 격리·승격, 다른 CHG artifact 격리, 기존 create/revise/run/review API
NON_GOALS: `APPROVED` 변경 삭제, active process 강제 종료, 취소/tombstone 이력, 삭제 사유, canonical 파일 rollback, 자동 commit/push/PR/deploy
CHANGE_BUDGET: guarded DELETE endpoint 1개, exact artifact transaction helper, catalog/run-manager lifecycle guard, Changes 확인 dialog/action, focused storage/API/UI tests, canonical Plan/Design/API/Security/QA 동기화; dependency 없음
TEST_EVIDENCE: base/revision/run/decision/candidate cascade, 다른 CHG 보존, missing replay 204, Origin/intent/ID guard, active/APPROVED conflict no-write, injected transaction failure rollback, dialog 취소/focus/card refresh, Console full tests와 root focused checks
CAPABILITY_ESCALATION: detected — localhost mutation 경계에 물리 삭제 capability를 추가하므로 API·security contract와 negative tests 필요
DOCS_TO_UPDATE: `_workspace/01_plan/{requirements.md,feature-plan.md,decision-log/pc-001-050.md}`, `_workspace/02_design/{api-schema/change-requests.md,change-set-contract.md,component-spec/content-panels.md,tool-contracts.md,ai-threat-model.md,eval-plan.md}`, `_workspace/04_qa/{qa-api-contract.md,qa-security.md,qa-browser.md}`와 owner journal
RUNTIME_VERIFIABILITY: LOCAL_VERIFIABLE
AI_MODE: true (기존 Codex run artifact lifecycle만 정리하며 model/tool execution 계약은 변경하지 않음)
SUBMODES: [TOOL_AGENT_MODE]
AUTONOMY_LEVEL: L2
PROFILE_STATUS: `PROFILE_NOT_DETECTED` — dependency-free custom localhost control plane, local Iterate evidence only

ROUND_RESULT: LOCAL_PASS — 승인 전 Change Request hard delete, exact artifact cascade, active/approved guard와 Changes confirmation을 구현함
ROUND_TEST_EVIDENCE:
- artifact cascade/other-CHG isolation/missing replay/injected rollback/symlink 4 cases와 catalog active/approved lifecycle PASS
- same-loopback Origin·delete intent·no body·malformed ID·204/replay API 및 UI static assertions PASS
- Console 42/42, pinned Node 22.22.3/pnpm 11.18.0 root CI, Harness 55, AI eval contracts 31, `git diff --check` PASS
- latest 4310/4311 browser: eligible CHG delete action, APPROVED action 0, exact confirmation copy, cancel focus return, warning/error 0; 실제 삭제 mutation 없음
ROUND_EXIT_GATES: capability escalation reviewed; Plan/Design/API/Security/Browser/owner journal 동기화; dependency·실제 CHG 삭제·model run·commit/push/PR/deploy 없음; 최신 Console session 44383 실행 중

## Round 17 — Token-bounded impact review context and cache

CHANGE_MODE: existing-change
REQUEST: Codex 영향도 검토와 변경 적용의 과도한 토큰·시간 사용을 줄이고 `CODEX_RUN_TIMED_OUT` 적용 실패를 해소하도록 usage 계측, context 축소, 동일 impact 재사용, apply 작업 범위 최적화를 적용
OBSERVED_BASELINE: impact prompt가 `Inspect the current repository`로 전체 탐색을 요구하고 effective request를 prompt와 파일 read로 중복 소비한다. apply도 candidate 전체를 재탐색하고 광범위한 검증을 자체 선택해 20분 timeout을 소진했다. 모든 audit `usage`는 null이며, 서로 다른 idempotency key의 동일 request/source/preview는 매번 새 model process를 시작한다. 실제 local impact session metadata는 입력 약 45만~188만 tokens를 기록했다.
TARGET_BEHAVIOR: server가 current FEAT/Sub Feature/TC/Preview anchor/관련 문서 metadata와 current digests를 bounded context manifest로 제공하고 impact의 broad repository enumeration/request reread를 금지한다. Apply는 승인된 impact result와 같은 manifest를 재사용해 affected files/target IDs 중심으로 수정·검증하고 unrelated repository/Harness 전체 검사를 금지하며, timeout 전 bounded phase contract 안에서 결과를 반환한다. Codex JSONL usage를 allowlisted 수치로 audit/UI에 표시하고, request+current project+prompt/analyzer version이 동일한 completed READY/ALREADY_APPLIED impact는 새 model 호출 없이 append-only cached run으로 재사용한다.
ALLOWED_PATHS: `packages/web-harness-console/{src/codex-runs.mjs,server.mjs,public/app.js,test,_workspace,README.md}/**`
PUBLIC_CONTRACTS_TO_PRESERVE: same guarded POST body/headers, append-only run audit and idempotency, latest request digest binding, impact read-only/apply candidate-only workspace-write, exact apply approval/review/promotion, no raw prompt/tool output/secret, existing legacy run readability, one active process, current Changes lifecycle/actions
NON_GOALS: provider/model 교체, reasoning level 강제, hard provider token cutoff, timeout 무조건 연장, arbitrary source content를 browser에 공개, BLOCKED impact cache, 자동 context 확장/model retry, 동시 실행 정책 변경, 기존 audit rewrite, 실제 impact/apply 자동 실행, dependency/commit/push/PR/deploy
CHANGE_BUDGET: runtime helper와 run metadata/cache path, JSONL usage parser, Changes compact usage/context copy, focused unit/API/static tests, Plan/Design/API/AI/QA docs; dependency 없음
TEST_EVIDENCE: bounded deterministic manifest와 no broad-scan/request-reread impact prompt, apply prompt의 exact impact files/IDs/context reuse 및 unrelated full-repository 검증 금지, project/request/prompt version cache invalidation and zero extra executor call on hit, cached run audit/apply compatibility, JSONL usage allowlist/malformed handling, timeout audit에 last measured usage 보존, legacy null usage, full Console/root AI CI와 localhost read-only smoke
CAPABILITY_ESCALATION: none — 기존 localhost Codex endpoint와 permission/sandbox를 유지하면서 model read scope·repeat execution·observability를 축소/강화하며 새 endpoint, secret, writable root, external API를 추가하지 않음
DOCS_TO_UPDATE: `_workspace/01_plan/{requirements.md,feature-plan.md}`, `_workspace/02_design/{ai-architecture.md,cost-latency-budget.md,tool-contracts.md,ai-threat-model.md,eval-plan.md,api-schema/codex-review.md,api-schema/common-read.md,component-spec/content-panels.md}`, `_workspace/04_qa/{qa-api-contract.md,qa-security.md,qa-ai-cost-latency.md,qa-agent-traces.md}`와 README/owner journal
RUNTIME_VERIFIABILITY: LOCAL_VERIFIABLE for manifest/cache/parser/UI; real provider token reduction requires the next user-started impact and remains measured, not inferred
AI_MODE: true
SUBMODES: [TOOL_AGENT_MODE]
AUTONOMY_LEVEL: L2
PROFILE_STATUS: `PROFILE_NOT_DETECTED` — dependency-free custom localhost control plane, local Iterate evidence only

## Round 19 — P0 security hardening and review-flow ordering (commit ce7d4a6 소급 기록)

CHANGE_MODE: bug-fix
REQUEST: 2026-08-07 리뷰에서 확인된 P0 보안 결함(GET decode crash, DNS-rebinding read, append-only 계약의 서버 미강제, 승격 전 검증 순서)과 frontend race/fallback 결함 봉합. 커밋은 Round 18 이전이나 QA 기록이 누락되어 소급 부기한다.
OBSERVED_BASELINE: malformed percent-encoding이 process를 종료시키고, Host header 미검증으로 DNS-rebinding read가 가능하며, `01_plan/change-requests`·`change-request-revisions`가 candidate snapshot에 포함되어 append-only 계약이 사람 검토에만 의존했다. review endpoint는 invalid body가 정본 승격을 촉발할 수 있는 순서였다.
TARGET_BEHAVIOR: 400 `BAD_URL`로 서버 생존 유지, 403 `HOST_NOT_ALLOWED`, append-only prefix의 candidate 제외와 `CANDIDATE_PATH_UNSAFE` 거부, prepare/commit 분리로 validate→promote→append 강제, selectProject race guard, catalog 기반 preview fallback route.
ALLOWED_PATHS: `packages/web-harness-console/{server.mjs,src,public,test}/**`
PUBLIC_CONTRACTS_TO_PRESERVE: `recordChangeRequestReview` compatibility wrapper, 기존 public API shape(신규 400/403 거부 외 불변), append-only audit·candidate·review lifecycle
NON_GOALS: ESLint 도입(zero-dependency 정책 결정 전 보류), crash-atomic promotion journal(후속 운영 과제)
CAPABILITY_ESCALATION: none — 거부 경로만 추가
RUNTIME_VERIFIABILITY: LOCAL_VERIFIABLE
PROFILE_STATUS: `PROFILE_NOT_DETECTED`

ROUND_RESULT: LOCAL_PASS — commit ce7d4a6 "fix(console): harden P0 security and review-flow ordering" (2026-08-07)
ROUND_TEST_EVIDENCE:
- 당시 `pnpm run console:test` 34/34 PASS(신규 회귀 3: malformed-encoding/Host 거부, append-only promotion 거부·non-staling CHG 생성, validation-before-promotion 순서)
- `pnpm run console:check` PASS, root `pnpm run ci` exit 0 (2026-08-07)
- isolated 4320/4321 browser: `/api/projects/%zz` 400 후 서버 생존, catalog 기반 preview fallback route 렌더, console error 0

## Round 20 — Claude Code executor support

CHANGE_MODE: feature
REQUEST: 영향 검토·변경 적용 실행기를 Codex CLI 단일 결합에서 분리해 Claude Code CLI로도 실행 가능하게 한다.
OBSERVED_BASELINE: `CodexRunManager`는 `connectionProbe`/`executor` 주입 지점을 갖지만 구현은 Codex CLI 전용이었고, 연결 패널·버튼 라벨이 Codex를 하드코딩했다.
TARGET_BEHAVIOR: `--executor auto|codex|claude-code` 서버 플래그. auto는 Codex 우선, 미연결 시 Claude Code 폴백. Claude 경로는 `--print --output-format json --json-schema`로 동일한 구조화 결과 계약을 강제하고, impact는 Read/Glob/Grep만, apply는 candidate 사본에서 파일 편집 도구까지 허용하며 Bash/네트워크 도구는 차단한다(targeted check `NOT_RUN:` 정직 보고). 상태 API `executor`/`candidates` 필드, run 기록 실행 백엔드 보존, executor-aware UI.
ALLOWED_PATHS: `packages/web-harness-console/{server.mjs,src,public,test}/**`, `packages/web-harness-console/{README.md,package.json}`
PUBLIC_CONTRACTS_TO_PRESERVE: `/api/codex/status` 경로·기존 필드, run audit schema(추가 필드 `executor`는 하위 호환), 구조화 출력 스키마, 승인 게이트·candidate 격리 lifecycle
NON_GOALS: live model run E2E(QA 미실행 — NOT_MEASURED), browser에서의 executor 선택 UI, `/api/codex/status` 경로 개명
CAPABILITY_ESCALATION: 새 CLI spawn 표면(claude) — 동일한 argv-only `shell:false`·env allowlist·timeout·SIGTERM/SIGKILL 규율 적용
RUNTIME_VERIFIABILITY: LOCAL_VERIFIABLE(라이브 실행 제외)
PROFILE_STATUS: `PROFILE_NOT_DETECTED`

ROUND_RESULT: LOCAL_PASS — commit 368567b (2026-08-07, PC-015 삭제 기능과 결합 트리 검증)
ROUND_TEST_EVIDENCE:
- `pnpm run console:test` 42/42 PASS(신규 4: 프로브 3상태, argv 도구 정책, 구조화 출력/오류 파싱, auto 폴백·디스패치)
- `pnpm run console:check` PASS, root `pnpm run ci` exit 0 (2026-08-07)
- browser: auto 프로브가 실제 머신에서 codex `CODEX_NOT_INSTALLED` + Claude Code 2.1.223 CONNECTED 보고, 연결 패널 executor-aware 렌더, console error 0

## Round 21 — Console preview approval (FEAT-014)

CHANGE_MODE: feature
REQUEST: 디자인 확정 루프의 Console 반쪽을 닫는다 — 사용자가 프리뷰를 보는 자리(Console)에서 UNAPPROVED 프리뷰의 승인을 기록한다.
OBSERVED_BASELINE: 승인 기록은 하네스 세션의 `validate-design-preview.mjs --record-approval` 전용이었고 Console은 상태 표시만 했다. CHG 승인 → STALE → 재생성 → 재승인 루프에서 확정 단계만 Console 밖으로 나가야 했다.
TARGET_BEHAVIOR: POST `/api/projects/{id}/preview-approval` (intent `record-preview-approval`) — UNAPPROVED에서만, body의 source/preview digest가 서버 재계산 값과 일치할 때만(검토한 프리뷰만 승인) canonical writer `recordPreviewApproval`이 `design-review.md`에 append-only 기록. Console발 승인은 `recordedVia: console-user-attested`로 하네스 세션 승인과 증거 출처 구분(lib에 optional 파라미터 추가, 기본값 `harness-session` — 기존 호출 하위 호환). 같은 digest·문구 재시도는 추가 write 없이 replay. Overview에 확인 진술 checkbox + 한 줄 승인 문구 폼(UNAPPROVED에서만 표시).
ALLOWED_PATHS: `packages/web-harness-console/{server.mjs,public,test,_workspace,README.md}/**`, `.claude/scripts/design-preview-status-lib.mjs`
PUBLIC_CONTRACTS_TO_PRESERVE: 승인 record schemaVersion 1(추가 필드는 parser 허용 확인), `design-review.md` append-only, GET API 불변, 기존 POST 경계, STALE 재승인은 하네스 재생성 절차 전용
NON_GOALS: STALE/DRAFT 상태의 Console 승인, 프리뷰 재생성 브리지, 승인 취소/철회, multi-user 승인자 identity, Phase 3 개발 트리거
CAPABILITY_ESCALATION: detected — 신규 mutation 표면 1개(append-only, digest race guard, loopback origin + intent + UNAPPROVED gate)
RUNTIME_VERIFIABILITY: LOCAL_VERIFIABLE
PROFILE_STATUS: PROFILE_NOT_DETECTED

ROUND_RESULT: LOCAL_PASS (커밋 해시는 커밋 시 기록)
ROUND_TEST_EVIDENCE:
- `pnpm run console:test` 48/48 PASS (신규 2: ① origin/intent 거부·text/digest 검증·digest mismatch 409·성공 201 + recordedVia marker·replay 200 무추가쓰기·APPROVED 후 409·detail 반영, ② STALE 상태 승인 시도 409 `PREVIEW_NOT_APPROVABLE` + design-review.md 무변경 — 리뷰어 MEDIUM 반영)
- `node .claude/scripts/test-design-preview.mjs` PASS — recordedVia allowlist 거부·기본값 `harness-session` 기록·`console-user-attested` 기록 direct assertion 포함(리뷰어 MEDIUM 반영)
- STALE 검증 중 발견한 게이트 순서 결함 수정: 상태 게이트(409)를 digest 형식 검사(400)보다 앞으로 — STALE은 preview digest가 null이라 형식 검사가 먼저면 상태 문제가 입력 문제로 위장됐다. 거부 자체는 양쪽 다 fail-closed였고 신호의 진실성만 교정
- browser 4320: UNAPPROVED에서 폼 렌더, 진술+문구 입력 시에만 submit 활성(초기/해제 시 비활성), console error 0 — 실제 제출은 서버 테스트로 검증(정본 프로젝트 오염 방지)
- read-only `harness-change-reviewer` 실행: PASS_WITH_NOTES — MEDIUM 2건(STALE direct test, recordedVia allowlist test)은 같은 라운드에서 해소, LOW 2건(제품명 enum 네이밍, 비객체 JSON body 500)은 기존 패턴과 동일해 비차단 기록

## Round 20 hotfix — Claude executor JSON schema draft rejection

CHANGE_MODE: fix
REQUEST: Console 영향 검토가 Claude Code 실행기에서 `CLAUDE_CODE_RUN_FAILED: --json-schema is not a valid JSON Schema: no schema with key or ref "https://json-schema.org/draft/2020-12/schema"`로 즉시 실패한다(사용자 실측 보고).
OBSERVED_BASELINE: canonical `codex-run-output.schema.json`의 `$schema: draft/2020-12` 선언을 Claude CLI의 `--json-schema` 검증기가 로드하지 못해 run 시작 전에 거부. Codex `--output-schema` 경로는 수용. 재현: 원본 스키마 → 즉시 거부, `$schema` 제거본 → 검증 통과 후 다음 단계(인증) 진행 확인.
TARGET_BEHAVIOR: canonical 파일은 Codex용으로 유지하고 Claude 어댑터의 `readOutputSchema`가 `$schema` 선언만 벗겨 전달한다 — 나머지 키워드는 draft 간 동일 해석. 전달 스키마에 `$schema` 부재 + 계약 필드 유지 direct assertion 추가.
ALLOWED_PATHS: `packages/web-harness-console/{src/claude-code-cli.mjs,test/claude-code-cli.test.mjs}`
PUBLIC_CONTRACTS_TO_PRESERVE: 구조화 출력 계약(필드·required·additionalProperties) 불변, Codex 경로 무변경
NON_GOALS: 스키마 내용 변경, draft 업그레이드 협상
RUNTIME_VERIFIABILITY: LOCAL_VERIFIABLE + 실제 CLI 검증 단계 통과 실측
ROUND_RESULT: LOCAL_PASS

## Round 20 hotfix 2 — Claude executor positional prompt swallowed by variadic tool flags

CHANGE_MODE: fix
REQUEST: 스키마 수정 후 영향 검토가 `CLAUDE_CODE_RUN_FAILED: Input must be provided either through stdin or as a prompt argument when using --print`로 실패한다(사용자 실측 보고).
OBSERVED_BASELINE: Claude CLI의 `--allowedTools`/`--disallowedTools`는 가변 인자 옵션이라 argv 마지막의 positional 프롬프트를 도구 목록 값으로 삼킨다. 재현: `--allowedTools Read,Glob 'hello prompt'` → 동일 에러, `echo prompt | claude --print …` → 정상.
TARGET_BEHAVIOR: 프롬프트를 argv에서 제거하고 stdin으로 전달(`child.stdin.end(prompt)`, stdio pipe, EPIPE 무해화). argv 길이 한계 위험도 함께 제거.
ALLOWED_PATHS: `packages/web-harness-console/{src/claude-code-cli.mjs,test/claude-code-cli.test.mjs}`
PUBLIC_CONTRACTS_TO_PRESERVE: 도구 정책·스키마 강제·구조화 출력 계약 불변, Codex 경로 무변경
NON_GOALS: Codex argv 변경, 프롬프트 내용 변경
RUNTIME_VERIFIABILITY: LOCAL_VERIFIABLE + live E2E 검증 완료
ROUND_RESULT: LOCAL_PASS + E2E_PASS
ROUND_TEST_EVIDENCE:
- `pnpm run console:test` 48/48 PASS — argv에 positional 부재·stdin 캡처 assertion으로 갱신
- live E2E: 서버 재시작 후 CHG-20260807-001 impact 재실행 → COMPLETED/READY, 영향 파일 4개 식별, usage 실측(inputTokens 21 · cachedInputTokens 276,392 · outputTokens 6,793) — Round 20이 NON_GOALS로 미룬 live run 검증이 hotfix 2건으로 완료됨

## R1 — 콘솔 디자인 개편 1단계: 토큰 이식 + 전역 표면 (2026-08-24)

- **TARGET_BEHAVIOR**: 승인 렌더(Gate Rail)에서 추출한 디자인 시스템의 토큰을 콘솔에 이식해
  전 화면이 다크 시각 언어로 렌더된다. 기능·DOM 구조·문구는 변경하지 않는다(시각 층만).
- **ALLOWED_PATHS**: `packages/web-harness-console/public/styles.css`,
  `packages/web-harness-console/public/index.html`(color-scheme meta 1줄)
- **PUBLIC_CONTRACTS_TO_PRESERVE**: 클래스명·DOM 구조·app.js가 참조하는 셀렉터,
  기존 CSS 변수명(`--surface`·`--primary`·`--success` 등 — 레거시 alias로 재피복해 보존),
  `preview-frame` iframe 문서 배경(#fff — 생성 앱 자체 테마 영역, 콘솔 토큰 대상 아님)
- **NON_GOALS**: 게이트 레일·NEXT 존 등 신규 컴포넌트(2단계), 탭별 레이아웃 재배치(3단계),
  라이트 모드(시스템에 값 없음 — 승인 대기)
- **CHANGE_BUDGET**: 2파일 · CSS 변수 블록 교체 + 하드코딩 색 소탕(≈45개소)
- **TEST_EVIDENCE**: `console:check` 통과 · 라이브 브라우저 검증(4탭 렌더, 콘솔 에러 0) ·
  **자동 대비 스윕**: 가시 텍스트 전수 WCAG AA 검사 위반 0건(brand-mark는 gradient라
  스크립트 미측정 — 시스템 계산치 on-accent/accent 7.9:1로 대체 확인)
- **CAPABILITY_ESCALATION**: none (CSS·meta만, 서버·권한·데이터 경로 무변경)
- **DOCS_TO_UPDATE**: none — 02_design/design-system/이 이번 변경의 상류 정본이며 이미 반영됨
  (구 `design-system.md`는 3단계 완료 시 대체 표기 예정)

## R2 — 콘솔 디자인 개편 2단계: 게이트 레일 + '지금 존' (2026-08-24)

- **TARGET_BEHAVIOR**: Overview 상단에 파이프라인 게이트 레일(정체성)과 NEXT/PULSE 존(위계)이
  렌더되고, 표시되는 모든 상태·행동이 detail payload의 **실측 사실에서만** 파생된다. 근거 없는
  단계는 '판정 불가(unknown)'로 표기하고 pass로 격상하지 않는다.
- **ALLOWED_PATHS**: `public/gate-rail.mjs`(신규 순수 파생), `public/app.js`(렌더 3함수),
  `public/styles.css`(컴포넌트 스타일), `src/indexer.mjs`(summarizeStage — 단계 파일 존재 사실),
  `test/gate-rail.test.mjs`(신규), `package.json`(check 등재)
- **PUBLIC_CONTRACTS_TO_PRESERVE**: 기존 Overview 패널(metric-grid·preview·change)과 그 동작,
  detail payload의 기존 필드(추가만 — `stage` 신설), 탭 전환 API(setTab)
- **NON_GOALS**: 나머지 탭 정합(3단계), 사이드바 게이지(3단계), 라이트 모드
- **CHANGE_BUDGET**: 6파일 · 신규 모듈 1 + 렌더 3함수 + CSS 1블록 + indexer 1함수
- **TEST_EVIDENCE**: gate-rail 8/8(픽스처 7 + **실제 인덱서 payload 계약 1**) · console:check ·
  전체 CI green · 라이브 검증(레일 6게이트 실측 일치, 대비 스윕: 텍스트 위반 0 / 노드 보더
  최소 3.7:1) · **반증 확인**: preview 필드명을 되돌리면 계약 테스트가 실제로 fail
- **CAPABILITY_ESCALATION**: none (읽기 전용 파생 · 파일 존재 확인만, 쓰기·권한·네트워크 없음)
- **DOCS_TO_UPDATE**: none — design-system/components.md가 상류 정본이며 구현이 그것을 따름

### 라운드 중 발견·수정한 결함 (라이브 검증이 잡음)
1. **필드명 드리프트**: `preview.state`로 읽어 APPROVED 프로젝트가 "프리뷰 없음"으로 오표시.
   손수 만든 픽스처가 같은 오해를 담아 테스트는 통과했다 → 실제 인덱서 payload로 판정하는
   계약 테스트를 추가하고 반증(필드 되돌리면 fail)으로 실효 확인.
2. **기능 보더 하한**: 중립 게이트 노드가 `--line`(1.34:1)이라 원이 사실상 비가시 →
   accessibility.md 규칙대로 `--line-strong`(3.7:1) 적용.
