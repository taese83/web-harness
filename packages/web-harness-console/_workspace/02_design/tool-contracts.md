# Tool Contracts — Codex Change Request Bridge

## `revise_change_request`

- description: apply 시작 전 Change Request editable fields를 append-only revision으로 정정
- inputSchema: `{ projectId, changeRequestId, title, requestedChange, reason, expectedBehavior, versionIntent }` (target/path/digest hidden)
- sideEffect: `_workspace/01_plan/change-request-revisions` exclusive create; original CHG/canonical design write 없음
- requiredScopes: `local:request-revision:append`
- requiresApproval: explicit dialog submit
- idempotencyRequired: true
- timeoutMs: 5000
- auditEvent: `change.request.revised`

## `delete_change_request`

- description: canonical promotion 전의 Change Request 작업 초안과 server-owned 연결 artifact를 물리 삭제
- inputSchema: `{ projectId, changeRequestId }` (artifact path/run ID/body hidden)
- sideEffect: base request, revisions, owned run audits, review decisions, unapproved candidate bundle 삭제; canonical Source/Plan/Design write 없음
- requiredScopes: `local:request:delete`, `local:audit:delete`, `local:candidate:delete`
- requiresApproval: true, destructive confirmation
- idempotencyRequired: false; HTTP DELETE semantics make an already-absent well-formed CHG a `204` replay
- timeoutMs: 5000
- auditEvent: none; successful deletion intentionally leaves no tombstone
- preconditions: no active run and no `APPROVED` decision; exact project/CHG ownership and contained non-symlink artifact paths

## `codex_impact_review`

- description: persisted Change Request와 current repository를 read-only로 분석
- inputSchema: `{ projectId, changeRequestId }` (server-resolved project root/request content hidden)
- sideEffect: audit log append only
- requiredScopes: `local:project:read`, `local:audit:append`
- requiresApproval: user click
- idempotencyRequired: true
- timeoutMs: 300000
- auditEvent: `codex.run.impact`
- bounded input: FEAT/TC/anchor + 최대 12 related document metadata; fallback read 최대 4
- cache: completed READY/ALREADY_APPLIED만 analyzer/request/project digest exact match 시 재사용하며 새 audit를 남김

## `codex_apply_change`

- description: completed impact를 근거로 격리된 planning/TC/design/preview candidate 생성
- inputSchema: `{ projectId, changeRequestId, impactRunId }` (cwd/prompt/argv hidden)
- sideEffect: temporary candidate write, bounded candidate bundle과 audit append; canonical write 없음
- requiredScopes: `local:project:read`, `local:candidate:write`, `local:audit:append`
- requiresApproval: true, dedicated apply confirmation
- idempotencyRequired: true
- timeoutMs: 1200000
- auditEvent: `codex.run.apply`
- bounded execution: approved affectedFiles + directly necessary trace/journal; targeted checks only
- prohibited checks: repository-wide Harness/full CI/install/build-all

## Policy

- server validates exact loopback Origin, intent, media type, UUID idempotency key, current request ownership, request digest and phase transition.
- deletion is the narrow exception to append-only audit retention: it accepts no body/idempotency key, validates exact loopback Origin + delete intent, and is allowed only before canonical approval. Exact targets are transactionally staged and rolled back on failure.
- browser cannot request a command, raw prompt, cwd, model, sandbox, environment, additional writable directory, Git or network permission.
- adapter uses `spawn` with argv array and `shell:false`; `impact=canonical read-only`이며 Git repository 검사를 유지한다. `apply=temporary candidate workspace-write`는 candidate snapshot이 `.git`을 제외하므로 해당 phase에만 `--skip-git-repo-check`를 추가한다.
- output is schema-validated and bounded before persistence/publication.
- JSONL usage는 숫자 token field allowlist만 노출하고 raw event/provider payload는 폐기한다. cache hit와 `NOT_MEASURED`는 구분한다.

## `record_change_review`

- description: completed READY_FOR_REVIEW apply result에 사람의 검토 결정을 기록
- inputSchema: `{ projectId, changeRequestId, decision, reason }` (applyRunId는 server가 latest owned run에서 파생)
- sideEffect: append-only review audit; `APPROVED`만 digest-guarded candidate promotion, revision/discard canonical write 없음
- requiredScopes: `local:review:append`, approval에서만 `local:project:promote-candidate`
- requiresApproval: true, explicit decision dialog submit
- idempotencyRequired: true
- timeoutMs: 5000
- auditEvent: `change.review.recorded`

`REVISION_REQUESTED` feedback is treated as untrusted user content and added by the server to the next `codex_apply_change` prompt. `APPROVED|DISCARDED` make the request terminal. `DISCARDED` does not call Git restore/reset because candidate changes were never applied.
