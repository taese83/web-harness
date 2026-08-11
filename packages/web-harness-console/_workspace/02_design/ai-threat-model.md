# AI Threat Model — Codex Change Request Bridge

| Threat | Control | Verification |
|---|---|---|
| browser command/prompt/cwd injection | body allowlist is phase only; server builds argv/prompt/cwd | negative API tests |
| cross-origin local request | exact loopback Origin + intent + JSON + UUID idempotency | server tests |
| arbitrary project/request selection | current catalog and persisted request ownership | unit/server tests |
| request text prompt injection | quoted as untrusted change intent; system prompt fixes prohibited actions and source priority | prompt fixture review |
| hidden canonical auto-write | impact canonical read-only; apply confirmation creates only a temporary candidate; canonical promotion needs a second review approval | state/UX tests |
| credential leakage | filtered child environment; no token fields/output; raw events not public | static/security review |
| denial of wallet/process | one active/project, bounded timeout/output, no auto retry | fake clock/executor tests |
| broad impact/apply rescan consumes excessive tokens or times out | server-built bounded context, digest cache, approved-file apply scope, targeted checks; insufficient scope fails BLOCKED | prompt/cache/timeout tests |
| stale semantic cache authorizes wrong apply | cache key binds analyzer, effective request, all indexed document hashes and preview digests; apply rechecks context digest | mutation invalidation/stale apply tests |
| token telemetry leaks provider data | allowlist numeric usage fields only; raw JSONL and unknown keys are not persisted/public | parser negative tests |
| stale or unknown state | base drift shown; interrupted run never auto-resumes | persistence/browser |
| destructive Git/external action | candidate-only workspace-write sandbox and prompt prohibition; no danger bypass/add-dir. Non-Git 허용 flag는 contained server-created apply candidate에만 사용하고 canonical impact에는 사용하지 않음 | phase-specific argv/cwd assertion |
| candidate symlink/path escape | snapshot rejects symlinks; manifest relative paths, realpath containment, safe 03_dev storage | filesystem tests |
| stale-base overwrite | whole-project base digest must equal current before promotion; mismatch writes nothing | promotion test |
| partial promotion | touched file backup, candidate post-digest verification and rollback before decision append | promotion rollback test |
| forged/stale review transition | server derives latest apply, requires READY_FOR_REVIEW, binds exact run and permits one decision/run | negative API/storage tests |
| revision prompt injection | feedback is bounded, server-owned, quoted as untrusted and cannot override original request/policy | prompt assertion |
| stale impact after request edit | run snapshots effective request digest; apply rejects missing/mismatched revision binding and requires a new impact | unit/API transition test |
| request revision overwrite/path injection | exact body allowlist, server-derived filename/path, exclusive create, realpath/no-symlink containment, immutable target | storage/API security test |
| discard causes unrelated data loss | candidate was never promoted; discard records decision without canonical mutation | UI/server assertion |
| forged delete removes another request or canonical files | server resolves exact project/CHG ownership, derives allowlisted artifact paths and rejects body/path/run overrides, traversal and symlinks | negative API/filesystem tests |
| delete races an active run or erases approved history | active-run and any `APPROVED` decision checks execute immediately before transactional staging; conflict writes nothing | lifecycle/race tests |
| partial hard delete corrupts request state | same-filesystem staging with rollback on move failure; card refresh only after `204` | injected filesystem failure test |

Residual risk: candidate promotion is a bounded local filesystem transaction rather than a filesystem/database atomic primitive; process termination during the short promotion window requires digest-based recovery review. Large/dependency-heavy projects may exceed snapshot budgets and return BLOCKED. Existing direct apply audits remain legacy and do not gain retroactive candidate recovery.
