# Codex 실행과 검토 API

## `GET /api/codex/status`

Returns `{ available, authenticated, connected, version, reason, checkedAt }`. Probe는 server-side binary/version/login status만 확인하며 credential을 반환하지 않는다.

## `POST /api/projects/:id/change-requests/:changeRequestId/revisions`

Adds one request revision before apply starts.

- Required headers: JSON, same loopback `Origin`, `X-Web-Harness-Intent: revise-change-request`, UUID `Idempotency-Key`.
- Body exact fields: `{ title, requestedChange, reason, expectedBehavior, versionIntent }`; target Feature/Sub Feature/anchor는 변경할 수 없다.
- server rejects unchanged body, active Codex run, any apply run, review decision, unknown CHG and malformed/oversized content with typed 4xx.
- revision is exclusive-created under `_workspace/01_plan/change-request-revisions/CHG-*-REV-NNN.md`; original CHG is never rewritten. `201` create, `200` idempotent replay.
- project detail exposes effective fields, `currentDigest`, `revisionCount`, `currentRevision`, and bounded `revisions[]` without private idempotency keys.

## `POST /api/projects/:id/change-requests/:changeRequestId/codex-runs`

Starts one bounded local Codex run.

- Required headers: JSON, same loopback `Origin`, `X-Web-Harness-Intent: start-codex-run`, UUID `Idempotency-Key`.
- Body: `{ phase: "impact" }` or `{ phase: "apply", impactRunId, approval: "create-isolated-candidate" }`.
- Browser cannot send prompt, command, cwd, model, sandbox, environment or writable roots.
- impact uses canonical project read-only and keeps the Codex Git repository check. Apply copies a bounded safe project snapshot excluding `.git` to a server-owned temporary candidate, uses `--skip-git-repo-check` only for that non-Git candidate, and uses workspace-write only there after completed owned impact and explicit approval.
- one active run; no automatic retry. `202` enqueue, `200` idempotent replay 또는 semantic impact cache hit.
- run events append under `_workspace/03_dev/codex-runs`; nonterminal restart state becomes `INTERRUPTED`.
- each run snapshots `requestDigest` and nullable `requestRevisionId`. Apply requires a completed owned impact bound to the current digest; otherwise `CODEX_IMPACT_STALE` is returned without starting a process.
- impact는 public `impactContext { analyzerVersion, contextDigest, projectDigest, documentCount, manifestBytes }`를 가진다. 동일 context의 완료 `READY|ALREADY_APPLIED` 결과는 `cache { hit:true, sourceRunId, contextDigest }`와 새 audit run으로 반환하며 model process를 만들지 않는다.
- apply는 최신 project context와 impact context도 비교한다. 새 형식 impact 이후 Plan/Design/preview evidence가 달라지면 `CODEX_IMPACT_STALE`다.
- `usage`는 관측된 non-negative integer token fields만 포함하거나 null이다. timeout/error에도 측정분이 있으면 보존하며 raw JSONL/provider payload와 비용 추정치는 반환하지 않는다.
- structured result 공통 필드에 `affectedFeatureIds[]`, `affectedSubFeatureIds[]`, `affectedTestCaseIds[]`, nullable 64-hex `sourceDigest`/`previewDigest`를 포함한다. 새 apply는 target FEAT를 영향 범위에 유지한다.
- completed `READY_FOR_REVIEW` apply는 `candidate: { status, baseDigest, candidateDigest, changedFiles[] }`를 추가한다. 절대 경로와 file content는 API에 노출하지 않고 changed path/kind/size만 표시한다.

## `POST /api/projects/:id/change-requests/:changeRequestId/review-decisions`

Records one review decision for the latest apply result.

- Required headers: JSON, same loopback `Origin`, `X-Web-Harness-Intent: record-change-review`, UUID `Idempotency-Key`.
- Body: `{ decision: "APPROVED" | "REVISION_REQUESTED" | "DISCARDED", reason: string }`; reason is required for revision/discard and bounded to 2,000 characters.
- server requires latest owned apply `COMPLETED/READY_FOR_REVIEW` and binds exact run ID.
- 새 apply는 candidate manifest가 필수다. `APPROVED`는 current baseline 재검증과 candidate 승격이 성공한 뒤에만 decision을 기록한다. `REVISION_REQUESTED|DISCARDED`는 candidate를 적용하지 않는다. candidate가 없는 legacy run만 기존 direct-apply 검토 호환 경계로 처리한다.
- events append under `_workspace/03_dev/change-request-decisions/<CHG>.jsonl`; original CHG/run files are never rewritten.
- `APPROVED` event는 target/affected FEAT·Sub Feature·TC, source/preview digest, `scopeSource`, `digestSource`를 `featureLinks` snapshot으로 보존한다. current catalog를 refresh한 뒤 target 포함·ownership·digest 일치를 검증한다.
- 구조화 범위가 없는 기존 apply는 request context를 사용하되 `scopeSource=request-context-legacy`로 구분한다.
- one decision per apply. `APPROVED|DISCARDED` are terminal; revision may be followed by another explicitly approved apply. A new apply is blocked while the latest READY_FOR_REVIEW result has no decision.
- `201` create, `200` idempotent replay.
