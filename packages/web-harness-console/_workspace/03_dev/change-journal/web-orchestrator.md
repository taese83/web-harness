# Web Orchestrator Change Journal

## 2026-08-05 — Feature detail inspector

- MODIFIED: `src/indexer.mjs` — preserved 00/01/02 allowlist and expanded FEAT parsing with metadata, behavior, structured TC detail, related documents, and validated preview mapping
- MODIFIED: `public/app.js` — preserved project/tab/document navigation and added Feature selection, detail rendering, related document actions, and `feature` hash restoration
- MODIFIED: `public/styles.css` — preserved Console tokens and responsive breakpoints; added two-pane Feature layout with compact single-column reflow
- MODIFIED: `test/indexer.test.mjs` — added structured detail fixture and public detail assertions
- MODIFIED: `_workspace/01_plan/feature-plan.md`, `_workspace/02_design/api-schema.md`, `_workspace/02_design/layout-spec.md`, `_workspace/02_design/component-spec/content-panels.md` — synchronized canonical behavior
- CREATED: `_workspace/02_design/integration-overlay.json` — recorded existing dependency-free Node/static integration points
- FAILED: first parser regression run — bare `TC-001-1` lines produced no association; smallest parser compatibility path restored, second run passed 4/4
- EVIDENCE: package checks, browser snapshot and console log, artifact sharding, root 54-check harness validation

## 2026-08-05 — Executable preview mappings

- MODIFIED: `public/app.js`, `public/styles.css` — mapping cards now switch to Preview, preserve the selected anchor in the URL, label counts as `TC N`, and remove the desktop outer scrollbar while the iframe fills the remaining viewport.
- MODIFIED: `src/indexer.mjs` — exposes a concrete `previewRoute` when present while retaining the canonical route pattern in traceability.
- MODIFIED: Plan/Design contracts and appended `PC-004` — recorded the approved behavior change without rewriting prior decisions.
- EVIDENCE: FEAT-001 conditional form mapping opened the form and FEAT drawer; URL restored `tab=preview&anchor=wh-feat-001-tool-create-form`; body overflow was hidden with body/html scrollHeight equal to the 720px viewport; browser errors 0.
- EVIDENCE: Console tests 4/4, package syntax check, root Harness validation 54 checks, Console artifact sharding and `git diff --check` passed.

## 2026-08-05 — Hierarchical Sub Feature traceability

- MODIFIED: planning/design contracts and agent prompts — optional `FEAT-NNN-NN` children now carry stable title, TC subset, screen/scope, and preview anchor subset while the parent remains the aggregate.
- MODIFIED: `.claude/scripts/design-preview-status-lib.mjs` — traceability schema v2 validates parent/child ID ownership, TC ownership, anchor ownership, and `data-wh-subfeature`; schema v1 remains valid.
- MODIFIED: `src/indexer.mjs` and `public/app.js` — parses Sub Feature tables, merges schema v2 preview mappings, renders nested cards, restores `subfeature` hash state, and filters detail TC/anchors to the selected responsibility.
- MODIFIED: nocode-builder pilot — FEAT-004 split into create/rename/delete and FEAT-013 split into row entry/top mode tabs without changing parent FEAT or TC IDs.
- FIXED DURING BROWSER REVIEW: removed a literal `null` rendered by `replaceChildren` in Sub Feature detail.
- EVIDENCE: Console tests 5/5, syntax check, package artifact sharding, design-preview v1/v2/invalid fixture tests, root Harness validation 54 checks, and `git diff --check` passed.
- EVIDENCE: browser restored `FEAT-004-02`, displayed only TC-004-2/5, navigated to `wh-feat-004-02-table-rename`, and opened the FEAT-004-02 preview drawer. Direct create/delete Sub Feature anchors also opened their drawers.

## 2026-08-05 — Legacy Console response hotfix

- FIXED: `public/app.js` treats a missing `feature.subFeatures` as `[]` during selection and list rendering.
- PRESERVED: restarted/new servers still expose and render schema v2 children; an older running server continues to render the schema v1 flat Feature list without a reload-time exception.
- EVIDENCE: running 4310 API returned 26/26 Features without `subFeatures`; browser loaded FEAT-004 with no global error and rendered the Features heading/card. Indexer tests 4/4 and package syntax check passed.

## 2026-08-05 — Responsive Feature list width hotfix

- FIXED: desktop Feature/detail columns now expand at a 2:3 ratio instead of capping the list at 360px; compact layout uses `minmax(0, 1fr)` and content-driven height instead of a 420px internal scroll panel.
- IMPROVED: INVALID mapping empty state shows the first traceability validator error instead of incorrectly claiming that the Feature has no anchor.
- PRESERVED: desktop sticky two-pane behavior remains unchanged.
- EVIDENCE: at a 1280px viewport the live 4310 UI computed the columns as 374.8px/562.2px rather than a fixed 360px list; the mapping panel surfaced `traceability.json schemaVersion must be 1` from the stale server.

## 2026-08-05 — Correction: Feature list height

- USER CLARIFICATION: the fixed dimension was height, not width.
- REVERTED: restored the original desktop Feature column cap of 360px.
- FIXED: removed the Feature list viewport-derived `max-height`, sticky positioning, padding compensation, and nested `overflow:auto`; the full list now participates in document scrolling at every breakpoint.
- EVIDENCE: after restarting 4310, the live list measured `clientHeight=scrollHeight=3367px`, `max-height:none`, `overflow-y:visible`, no nested scrollbar, and the original 360px width. The project reported `UNAPPROVED` and exposed FEAT-004-01 with its Preview mapping.

## 2026-08-06 — Append-only Change Request workflow

- ADDED: `src/change-requests.mjs` — validates user fields and Feature/Sub Feature/anchor ownership, derives TC/document/preview digest context, rejects symlink escapes, and writes only new `CHG-YYYYMMDD-NNN.md` files with idempotent exclusive-create semantics.
- MODIFIED: `server.mjs` and `src/indexer.mjs` — added one guarded POST endpoint, 16 KiB JSON cap, same-loopback Origin/intent validation, persistent request indexing, preview digests and request counts. All other mutation paths and the Preview server remain read-only.
- MODIFIED: `public/app.js`, `styles.css`, `index.html` — added accessible Feature/Preview Change Request dialog, explicit canonical-write boundary copy, keyboard cancel/focus return, and persistent request cards separated from session file diffs.
- MODIFIED: Plan/Design contracts and `PC-006` — defined `PROPOSED → IMPACT_REVIEW → IN_REVIEW → APPROVED → RELEASED`, atomic planning/TC/design handling and patch/minor/major intent without inventing an approved version.
- ADDED: API/security reports and unit/integration coverage for cross-origin, intent, media type, invalid target, idempotency, canonical immutability, Preview method boundary and symlink containment.
- FIXED DURING BROWSER REVIEW: the initial dialog element omitted its form child; the form was attached, title autofocus added, and explicit Esc close restored focus to the invoking button.
- EVIDENCE: pinned toolchain tests 7/7, package syntax, artifact sharding, root 54-check harness validation and `git diff --check` passed. Temporary 4320/4321 browser smoke showed mapped FEAT/anchor/TC/digest context, separate Changes sections and zero warning/error logs.
- LIMITATION: built-in profile resolver returned `PROFILE_NOT_DETECTED`; this is local iterate evidence, not release attestation.

## 2026-08-06 — Preview drawer Change Request bridge

- ADDED: a bounded `web-harness:request-change` message contract and exact iframe-source/origin validation between the mapped Preview drawer and Console.
- MODIFIED: the Console Preview iframe now receives its loopback Console origin and opens the existing Change Request dialog only after re-resolving Feature/Sub Feature/anchor ownership, TC, documents, and preview digest from the current catalog.
- MODIFIED: canceling the Console dialog acknowledges the request back to the Preview so keyboard focus returns to the drawer action.
- PRESERVED: the Preview remains GET/HEAD-only and cannot submit the append-only endpoint directly; a standalone Preview does not render the action.
- EVIDENCE: Console tests 9/9, package syntax check, package artifact sharding, preview validator errors 0, root Harness validation 54 checks, and `git diff --check` passed.
- EVIDENCE: browser smoke opened the FEAT-002 drawer action, then a Console dialog containing FEAT-002, `wh-feat-002-tool-list`, TC-002-1~3, and the current `UNAPPROVED` digest; cancel restored focus to the drawer button. Direct Preview rendered no Change Request action.
- APPROVAL: no design approval or visual baseline was created. This is local Iterate evidence and remains `UNAPPROVED`.

## 2026-08-06 — Approval-gated Codex Change Request execution

- ADDED: `src/codex-runs.mjs` and structured output schema — probes the installed Codex CLI/login, builds server-owned prompts/argv, enforces read-only impact vs workspace-write apply, one active run, bounded timeout/output, no retry and append-only 03_dev audit.
- MODIFIED: `server.mjs` — added loopback/intent/idempotency-gated Codex status/run endpoints and project detail run projection without changing Preview or document read boundaries.
- MODIFIED: Changes UI — shows connected/disconnected recovery state, request-scoped impact action, bounded run result/thread ID and a separate L2 apply confirmation dialog.
- MODIFIED: AI planning/design contracts and canonical requirements/Feature/TC/API/layout/component/change-set documents; added conditional security/API/AI/browser QA reports.
- FIXED DURING LIVE REVIEW: this Codex CLI version writes successful `login status` text to stderr; connection probe now evaluates the combined bounded process output and the running Console reports `Codex connected`.
- EVIDENCE: Console syntax and 14/14 tests PASS; package artifact sharding 22 artifacts PASS; pinned root Harness 54 checks PASS; static AI ladder baseline→eval-contracts PASS with 31 valid scenarios; `git diff --check` PASS.
- EVIDENCE: hard-loaded Changes screen showed `CONNECTED`, `codex-cli 0.147.0-alpha.1.2`, two enabled impact actions, 40px connection action and zero browser warning/error logs.
- BOUNDARY: browser QA intentionally did not start a live model run. Actual request impact begins only when the user presses its action; no run audit or canonical project edit was created by verification.
- LIMITATION: custom profile remains `PROFILE_NOT_DETECTED`; provider token/cost/latency are `NOT_MEASURED`, so this is local Iterate evidence rather than release attestation.

## 2026-08-06 — READY_FOR_REVIEW decision actions

- ADDED: `src/change-request-reviews.mjs` — no-follow, realpath-contained append-only decision events bound to exact Change Request/apply run with UUID idempotency, bounded reason and terminal transition guards.
- MODIFIED: `server.mjs`, `src/indexer.mjs`, `src/codex-runs.mjs` — added guarded review endpoint/projection, blocked reapply before review and terminal reruns, and injected revision feedback into the next server-owned apply prompt as untrusted content.
- MODIFIED: Changes UI/CSS — added 승인·수정 요청·변경 폐기 dialogs, decision panels, `Codex 수정 반영`, required reasons, discard no-auto-restore warning, responsive wrapping and focus recovery.
- ADDED: review storage and server transition tests, including malformed audit fail-closed coverage; regression suite now passes 17/17.
- MODIFIED: canonical FEAT-011/TC-011, lifecycle/API/component/layout/AI contracts and security/API/AI/browser QA reports. Artifact threshold moved decision-log and api-schema to INDEX-based shards without dropping content.
- EVIDENCE: Console syntax/test PASS; browser showed three 40px actions with no overflow, required 2,000-char revision field, discard boundary and focus return; browser logs 0; artifact sharding 22 PASS; Harness 54 PASS; AI static ladder and 31 scenario contracts PASS.
- PRESERVED: CHG-20260806-002 remains READY_FOR_REVIEW because browser QA opened and canceled dialogs only. No review event, live model run, automatic restore, commit, push, PR or deploy occurred.
- LIMITATION: DISCARDED cannot restore existing direct workspace-write changes because prior runs lack an isolated candidate patch; introducing staged patch/worktree approval is a separate architecture round.
## 2026-08-06T16:25:25+0900 — Round 10 approved Feature revisions

- MODIFIED: `src/codex-run-output.schema.json`, `src/codex-runs.mjs` — structured affected FEAT/Sub Feature/TC and digest result contract; server-owned prompt keeps target identity
- MODIFIED: `src/change-request-reviews.mjs` — append-only approval `featureLinks` snapshot, target/ownership/digest validation, explicit legacy fallback
- MODIFIED: `src/indexer.mjs`, `server.mjs` — current-catalog refresh and `Feature.approvedChanges[]` projection without canonical Feature mutation
- MODIFIED: `public/app.js`, `public/styles.css` — approved history cards, CHG focus deep link, Feature↔Changes navigation; existing responsive/Preview behavior preserved
- MODIFIED: `test/change-request-reviews.test.mjs`, `test/codex-runs.test.mjs`, `test/indexer.test.mjs`, `test/server.test.mjs` — structured/legacy/mismatch/projection/API coverage
- MODIFIED: `README.md`, `_workspace/01_plan/**`, `_workspace/02_design/**`, `_workspace/04_qa/{qa-api-contract,qa-browser,qa-security}.md` — canonical contract and evidence sync
- EVIDENCE: Console syntax PASS; 19/19 tests PASS; artifact sharding PASS; Harness 54 PASS; AI static stages and 31 scenario contracts PASS
- EVIDENCE: browser 4320/4321 showed approved CHG-20260806-002 under FEAT-001 and verified exact CHG focus plus Target return; warning/error logs 0

## 2026-08-06 — Commit-ready self-contained Preview fixture

- FIXED: `test/trace-fixture.test.mjs`가 gitignored `workspace/nocode-builder`를 직접 읽던 경로를 package 내부 `test/fixtures/design-preview/`로 교체했다.
- ADDED: sidebar FEAT/TC ownership을 나타내는 최소 app/traceability fixture와 normal persistence·`isolated-reset` 분기를 함께 가진 최소 store fixture.
- PRESERVED: 로컬 nocode-builder Preview는 추적 대상으로 바꾸거나 복사하지 않았고 Console runtime/API와 dependency도 변경하지 않았다.
- EVIDENCE: package test에서 local workspace 경로 참조 0건; trace fixture 2/2, Console 전체 20/20, syntax check, pinned Harness 54 checks, adapter mirror parity와 `git diff --check` PASS.

## 2026-08-06 — Isolated candidate apply and root CI gate

- ADDED: `src/change-candidates.mjs` — bounded regular-file snapshot, temporary candidate copy, server-computed diff bundle, stale-base validation, digest-checked promotion and touched-file rollback.
- MODIFIED: `src/codex-runs.mjs`, `server.mjs` — apply Codex cwd를 정본에서 candidate로 이동하고 `APPROVED` review에만 승격 transaction을 결속했다. revision/discard는 정본을 쓰지 않는다.
- MODIFIED: Changes UI — L2 확인을 candidate 생성으로 명확히 바꾸고 server-computed changed file kind/path, candidate/legacy 승인·수정·폐기 경계를 표시한다.
- MODIFIED: root `package.json`과 Harness validator — Console syntax/test가 `pnpm run ci`의 필수 순차 gate가 됐다.
- MODIFIED: canonical Plan/Design/API/AI/Security/Browser 문서 — candidate lifecycle, stale conflict, rollback, legacy 호환과 잔여 crash/retention 한계를 동기화했다.
- EVIDENCE: pinned root CI PASS; Console 23/23, Harness 55, AI eval contracts PASS; artifact sharding 22, adapter parity, diff whitespace PASS; temporary browser 4330/4331 warning/error 0 and horizontal overflow 0.
- PRESERVED: 사용자 4310 서버/탭, 기존 legacy run/audit, live CHG state. QA는 model run, review decision, commit, push, PR, deploy를 수행하지 않았다.

## 2026-08-06 — Page-grouped Feature planning and navigation

- MODIFIED: `web-plan` design-readiness contract와 feature-planner output template에 stable `PAGE-NNN` Page Groups, display label/route/order, Feature List의 단일 primary `페이지 그룹` 참조를 추가했다.
- MODIFIED: `src/indexer.mjs` — explicit Page Group을 우선 인덱싱하고 legacy 문서는 첫 `화면` component, 화면도 없는 문서는 `미분류`로 fail-visible 분류한다.
- MODIFIED: Features UI/CSS — 페이지 heading·메타·FEAT count 아래 기존 FEAT/Sub Feature tree를 묶되 selection/hash/detail/TC/revision 계약과 document scrolling을 보존한다.
- MODIFIED: Console canonical Plan/Design/API 문서와 README — PAGE-001~005/PAGE-000, FEAT-013과 TC-013-1~3, fallback/unknown-reference 계약을 동기화했다.
- EVIDENCE: Console syntax와 24/24 tests, root CI/Harness 55, AI static ladder와 31 scenario contracts, adapter parity, artifact sharding 22, diff whitespace가 PASS했다. 임시 4340/4341 브라우저에서 explicit 6개 page/13 FEAT와 legacy 7개 fallback page/26 FEAT, FEAT-013 hash/detail, 1280px overflow 0, nested scroll 없음, warning/error 0을 확인했다.
- PRESERVED: 기존 workspace 문서는 rewrite하지 않았고 사용자 4310 서버/탭, Preview digest, Change Request/revision history, dependency, API mutation surface를 변경하지 않았다.

## 2026-08-06 — Viewport-equal Features panes

- MODIFIED: `public/styles.css` — 905px 이상 Features 탭에서 workspace/content를 남은 viewport flex 영역으로 만들고 FeatureList/FeatureDetail을 같은 높이의 independent `overflow-y:auto` pane으로 고정했다. compact와 Preview 전용 layout은 유지했다.
- MODIFIED: `public/app.js` — hash/선택으로 재렌더된 현재 FEAT/Sub Feature를 desktop 목록의 nearest visible 위치로 자동 노출한다.
- MODIFIED: `test/server.test.mjs`, canonical REQ-021/FEAT-008-01/TC-008-8/PC-013, layout/component/browser QA 문서 — viewport/scroll/responsive 계약과 정적 회귀를 동기화했다.
- EVIDENCE: Console 24/24와 root CI/Harness 55, AI static ladder/31 scenarios, adapter parity, artifact sharding 22, diff whitespace PASS.
- EVIDENCE: temporary 4340/4341의 1280×720에서 list/detail 452.5px 동일 높이, 각각 3797/453 및 643/451 scroll extent, 독립 +80px scroll, body scroll 0, FEAT-021 자동 노출, horizontal overflow 0, browser warning/error 0.
- PRESERVED: 사용자 4310 서버/탭, 360px desktop list width, PAGE/FEAT/Sub Feature ordering, hash/detail/TC/Preview/approved history/Change Request, 904px 이하 single page scroll, dependency/API/security boundary.

## 2026-08-06 — Append-only Change Request revisions before apply

- ADDED: `src/change-requests.mjs` revision store/read model — immutable base CHG, server-derived `REV-NNN` Markdown, effective fields, revision history and SHA-256 current request digest.
- ADDED: guarded `POST .../change-requests/:CHG/revisions` and Catalog lifecycle checks; active run, any apply start and review decision reject editing.
- MODIFIED: `src/codex-runs.mjs` — every run snapshots request digest/revision ID, latest revision path enters the server-owned prompt, and stale impact cannot authorize apply.
- MODIFIED: Changes UI/CSS — prefilled `요청 수정` dialog, immutable target copy, revision disclosure, STALE impact warning and mandatory re-impact action.
- ADDED: storage, prompt/digest and API lifecycle regression tests, including original byte identity, idempotent replay, Origin/media guard, stale apply rejection and successful re-impact candidate flow.
- EVIDENCE: Console syntax와 27/27 tests, full root CI(adapter/toolchain/Harness/AI eval-contracts), temporary 4350/4351 browser overflow/log checks, `git diff --check` PASS.
- PRESERVED: user 4310 server/tab, original CHG/target, candidate/review/approval semantics, no automatic Codex run, dependency, commit, push, PR or deploy.

## 2026-08-06 — Fixed-height scrollable Codex result panels

- MODIFIED: `public/app.js`, `public/styles.css` — 목록형 completed Codex result에만 `is-scrollable`을 부여하고 320~480px viewport-responsive block size, internal overflow, stable gutter, sticky heading/status를 적용했다.
- PRESERVED: pending/error/summary-only 자연 높이, result 전체 content, request/review actions, API/run lifecycle, desktop/compact layout과 horizontal overflow 계약.
- MODIFIED: `test/server.test.mjs`, layout/component/browser QA 계약 — scroll state class와 CSS contract를 정적 회귀로 고정했다.
- EVIDENCE: 사용자 4310의 1280×720 CHG-20260806-002에서 `clientHeight/scrollHeight=344/606`, computed block-size 345.594px, panel scroll 0→220 동안 body scrollY 375 유지, sticky heading, horizontal overflow 0, warning/error 0을 확인했다. Console 27/27과 full root CI도 PASS했다.

## 2026-08-07 — Non-Git isolated candidate Codex apply

- FIXED: `src/codex-runs.mjs` — `.git`이 제외된 server-created apply candidate에서 Codex trust check가 실행 전에 실패하던 문제를 apply-only `--skip-git-repo-check`로 수정했다.
- PRESERVED: canonical impact repository validation, read-only/workspace-write sandbox phase, server-owned candidate cwd/prompt/schema, no danger-full-access/add-dir, candidate approval/promotion lifecycle.
- ADDED: `test/codex-runs.test.mjs` phase-specific regression — impact flag 0개, apply flag 정확히 1개를 고정한다.
- EVIDENCE: 변경 전 focused test는 4/5로 동일 실패를 재현했고 수정 후 focused 5/5, Console 27/27, root CI/Harness 55, AI eval contracts 31이 PASS했다. 4310/4311을 최신 source로 재기동했고 Codex status는 connected/authenticated였다.

## 2026-08-07 — Bounded impact/apply cost and timeout optimization

- MODIFIED: `src/codex-runs.mjs` — server-indexed FEAT/TC/anchor/document metadata manifest, analyzer/request/project digest cache, stale context apply guard, apply affected-file/targeted-check scope, JSONL token usage parsing을 추가했다.
- MODIFIED: `server.mjs`, `public/app.js` — semantic cache는 HTTP 200과 모델 호출 없음 메시지를 반환하고, run panel은 cache/context 규모 및 measured token 또는 `NOT_MEASURED`를 표시한다.
- FIXED: broad repository re-scan과 repository-wide Harness/CI/install/build-all을 apply prompt에서 금지해 20분 `CODEX_RUN_TIMED_OUT`의 주요 실행 증폭 경로를 제거했다. hard timeout과 retry 0은 유지한다.
- EVIDENCE: Codex focused 9/9, Console/API/candidate 31/31, syntax, root Harness 55 checks, AI static eval-contracts 31 scenarios, adapter mirror, diff whitespace PASS. 실제 post-change provider latency/token 감소는 기존 run을 자동 재실행하지 않아 NOT_MEASURED다.
- PRESERVED: 기존 timeout/legacy audit, isolated candidate·review approval boundary, canonical pre-approval immutability, browser input allowlist, no commit/push/PR/deploy.

## 2026-08-07 — Physical deletion of unapproved Change Requests

- ADDED: `src/change-request-deletion.mjs` — exact CHG의 base/revision/run/decision/candidate를 safe storage root에서 수집하고 same-filesystem staging/rollback 뒤 물리 삭제한다.
- MODIFIED: `src/indexer.mjs`, `server.mjs` — active run과 어느 `APPROVED` decision도 차단하는 guarded `DELETE .../change-requests/:CHG`를 추가했다. 성공/missing replay는 204이며 body·cross-origin·wrong intent·malformed ID를 거부한다.
- MODIFIED: `public/app.js` — eligible card의 `요청 삭제`, exact target과 복구 불가 범위를 표시하는 native confirmation, 성공 후 detail/count/hash refresh와 cancel focus 복원을 추가했다.
- ADDED: storage cascade/other-CHG isolation/idempotent missing/injected rollback/symlink, catalog lifecycle, API guard/replay와 static UI coverage.
- EVIDENCE: Console 42/42, pinned root CI, Harness 55, AI eval contracts 31, browser eligibility/dialog/cancel/focus/log smoke와 `git diff --check` PASS.
- PRESERVED: 기존 CHG 3건은 browser QA에서 삭제하지 않았고 active run 강제 종료, approved history 삭제, tombstone, model run, commit/push/PR/deploy를 수행하지 않았다.

## 2026-08-07 — P0 security hardening (ce7d4a6 소급 기록)

- FIXED: malformed percent-encoding GET crash → 400 `BAD_URL`, 양 서버 loopback Host 검증(403 `HOST_NOT_ALLOWED`), `01_plan/change-requests`·`change-request-revisions`의 candidate snapshot/promotion 제외(`CANDIDATE_PATH_UNSAFE`), review endpoint validate→promote→append 재정렬(prepare/commit 분리).
- FIXED: frontend selectProject race guard·error state, preview fallback route를 catalog 기반 첫 mapped anchor route로 일반화.
- EVIDENCE: 당시 `pnpm run console:test` 34/34, root `pnpm run ci` exit 0, isolated 4320/4321 browser 검증. Commit: ce7d4a6. 상세는 change-scope Round 19.

## 2026-08-07 — Claude Code executor support

- ADDED: `src/claude-code-cli.mjs`(프로브·argv·구조화 출력 파싱)와 `src/executor-adapters.mjs`(`--executor auto|codex|claude-code`, Codex 우선 auto 폴백). run 기록에 실행 백엔드 보존, 상태 API `executor`/`candidates` 필드.
- CHANGED: 연결 패널·버튼·run 라벨 executor-aware, Claude apply 경로는 Bash 차단으로 targeted check를 `NOT_RUN:`으로 정직 보고.
- EVIDENCE: `pnpm run console:test` 42/42, root `pnpm run ci` exit 0, browser에서 Claude Code 2.1.223 CONNECTED 확인. live model run은 `NOT_MEASURED`. Commit: 368567b. 상세는 change-scope Round 20.
