# API Contract QA — Change Requests, Candidate Runs and Review Decisions

## Result

PASS

Local Iterate diagnostic only; no release attestation.

## Coverage

| Method | Path | Producer/consumer agreement |
|---|---|---|
| GET | `/api/projects/:id` | detail includes `changeRequests[].reviewDecisions/latestReviewDecision`, bounded `codexRuns[]`, documents/features/preview/changes |
| GET | `/api/codex/status` | UI connection panel consumes connected/version/reason without credential fields |
| POST | `/api/projects/:id/change-requests` | existing create dialog and append-only runtime unchanged |
| POST | `/api/projects/:id/change-requests/:changeRequestId/codex-runs` | client sends phase-only impact or phase/impactRunId/`create-isolated-candidate`; runtime rejects additional fields |
| POST | `/api/projects/:id/change-requests/:changeRequestId/review-decisions` | client sends decision/reason only; server derives latest apply and promotes its candidate only for APPROVED |

## Assertions

- impact returns `202 {created:true, run}`; idempotency replay returns `200 {created:false, run}` without internal idempotency/projectRoot fields.
- bad Origin/intent/media/body/request ID and apply-before-impact/approval failures return typed 4xx without process invocation.
- detail polling exposes PENDING/RUNNING/COMPLETED/FAILED/TIMED_OUT/INTERRUPTED and bounded structured result; raw prompt/stream/env is absent.
- process state is an append-only 03_dev audit and does not alter the immutable `PROPOSED` Change Request metadata. READY apply exposes bounded `candidate {status,baseDigest,candidateDigest,changedFiles[]}` metadata.
- review decision requires latest `COMPLETED/READY_FOR_REVIEW`; duplicate decision/apply-before-review/terminal rerun are typed 409 without extra process.
- revision feedback is stored append-only and appears in the next server-owned apply prompt as untrusted content.
- pre-apply request revision is a separate append-only Plan record. Detail returns effective fields plus `currentDigest/revisionCount/currentRevision/revisions`; private idempotency keys never cross the API.
- revision endpoint requires loopback Origin, `revise-change-request`, JSON and UUID idempotency. Active/apply/review transitions fail closed.
- each new run returns `requestDigest` and nullable `requestRevisionId`; apply with a pre-revision impact returns typed `CODEX_IMPACT_STALE`, while re-impact enables the normal candidate flow.
- Round 14 evidence: Console 27/27 and full root CI PASS; integration exercised original-preserving revision create/replay, Origin/media guards, stale apply 409, latest revision prompt, re-impact candidate, and post-apply revision 409.
- Round 16 contract: impact argv keeps repository validation; apply argv alone permits the server-owned non-Git candidate with one `--skip-git-repo-check`, without changing request body, endpoint, sandbox, cwd ownership or writable-root contract.
- existing Change Request, document, preview and message bridge assertions remain green in the 23-test regression suite, including malformed review audit fail-closed behavior.

## Findings

None.

## Round 17 — Bounded Codex execution

- `POST .../codex-runs`는 신규 process enqueue에 `202`, idempotent replay와 digest-exact impact cache에 `200`을 반환한다.
- cache hit도 고유 run ID의 append-only `PENDING→RUNNING→COMPLETED` audit를 만들고 `sourceRunId/contextDigest`를 공개하지만 executor invocation은 만들지 않는다.
- 새 impact는 public bounded context metadata를, 모든 run은 allowlisted nullable usage를 반환한다. malformed/unknown JSONL field는 노출하지 않는다.
- apply는 request digest와 새 impact context digest를 모두 확인하며 변경된 Plan/Design/preview evidence는 typed `CODEX_IMPACT_STALE`로 process 전에 거부한다.
- Evidence: focused Codex unit 9/9, Console/API/candidate suite 31/31, syntax, Harness 55 checks, AI static eval-contracts 31 scenarios PASS.

## Round 10 — Approved Feature revision projection

- Codex structured result now includes affected FEAT/Sub Feature/TC identifiers and nullable final source/preview digests.
- `APPROVED` review events expose an immutable `featureLinks` snapshot while idempotency keys remain private.
- `GET /api/projects/:id` derives `Feature.approvedChanges[]`; it does not mutate canonical Feature documents.
- Approval rejects target omission, unknown ownership and current-catalog digest mismatch before appending an event. Legacy apply results remain compatible through an explicit `request-context-legacy` snapshot.
- Console regression/API/storage suite: 19/19 PASS.

## Round 11 — Isolated candidate promotion

- apply executor receives a temporary candidate cwd; canonical project content remains byte-identical through `READY_FOR_REVIEW` and revision review.
- affected file paths published for apply are replaced with the server-computed candidate diff rather than model-declared paths.
- approval performs stale-base and bundle validation before mutation, refreshes the catalog against promoted content, then records the exact-run review event. Record failure triggers candidate rollback.
- revision and discard do not call promotion. Candidate-less legacy runs keep the prior direct-apply review contract and are explicitly labeled in the UI.
- Console 23/23 and root CI/Harness 55 checks PASS.

## Round 12 — Feature Page Group read model

- `GET /api/projects/:id`의 기존 Feature collection에 `pageGroup {id,label,route,order,source}` read metadata를 추가했다. 새 endpoint나 mutation contract는 없다.
- canonical `Page Groups` 참조는 `source: explicit`으로 반환하고 선언 순서가 아니라 numeric `순서`로 정렬한다.
- 알 수 없는 `PAGE-NNN` 참조는 삭제하지 않고 `unknown-reference`, legacy Feature List는 첫 `화면` component를 `screen-fallback`, 화면도 없는 FEAT는 `ungrouped`로 반환한다.
- 기존 FEAT/Sub Feature/TC, Preview mapping, approved change history와 hash identity는 그대로 유지된다.
- Console regression/API suite 24/24와 root CI/Harness 55 checks PASS.

## Round 18 — Unapproved Change Request deletion

- `DELETE /api/projects/:id/change-requests/:changeRequestId`는 same-loopback Origin과 `delete-change-request` intent를 요구하고 request body/path override를 거부한다.
- 성공과 well-formed missing replay는 body 없는 `204`다. malformed CHG는 400, unknown project는 404, active run과 `APPROVED` history는 typed 409이며 삭제 write가 없다.
- 서버가 exact CHG ownership에서 base/revision/run/decision/candidate를 파생해 함께 제거하고 catalog를 refresh한다. UI는 삭제 성공 후 request card/count/hash selection을 다시 계산한다.
- Evidence: artifact transaction 4 cases, catalog lifecycle guards, API Origin/intent/body/delete/replay assertions을 포함한 Console 42/42와 pinned root CI PASS.
