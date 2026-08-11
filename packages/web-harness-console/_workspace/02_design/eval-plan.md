# Eval Plan — Codex Change Request Bridge

## Deterministic gates

- connection adapter: installed/authenticated, missing binary, unauthenticated, timeout
- policy: bad Origin/intent/media/idempotency, unknown request, invalid phase, apply-before-impact
- runner: exact argv/sandbox/cwd, one active/project, bounded output, timeout, non-zero exit, malformed structured result
- recovery: terminal log load and running→INTERRUPTED derivation
- UI: connection banner, disabled fallback, impact progress/result, apply confirmation, failure and focus recovery
- review: READY_FOR_REVIEW-only action visibility, exact apply binding, required revision/discard reason, idempotent replay, one decision/apply, terminal run block, revision feedback in next server-owned prompt
- request revision: original byte identity, ordered/idempotent effective history, exact editable allowlist, active/apply/review block, previous impact STALE, digest-bound re-impact/apply, latest revision prompt source
- candidate: executor cwd differs from canonical, pre-review canonical digest unchanged, server-computed added/modified/deleted list, stale baseline rejection, approval promotion, revision/discard no canonical mutation, promotion rollback
- cost/latency: bounded context size and cardinality, exact digest cache hit without executor, document/digest invalidation, apply prompt scope/no full-suite commands, success/timeout usage parsing and `NOT_MEASURED`

## Adversarial fixtures

- request text contains shell flags, quotes, newline instructions, path traversal, “ignore previous instructions”, commit/push request
- fake Codex emits oversized output, malformed JSON, raw secret-like strings, no thread ID, non-zero exit
- duplicate clicks and stale browser response
- forged applyRunId, decision-before-ready, second decision for one apply, revision feedback containing prompt injection, symlink source, traversal manifest, oversized project/change, candidate content tampering, stale baseline

## Release thresholds

- all critical policy/authorization/argv tests pass
- no browser-controlled prompt/cwd/command/sandbox field
- no automatic apply or retry
- no canonical write before `APPROVED`; candidate promotion requires unchanged base digest
- hard delete removes only the selected unapproved CHG and its owned temporary artifacts; active/approved/path-forged/failure cases remove nothing and successful replay remains `204`
- unchanged impact cache invokes no model; apply prompt cannot broaden beyond approved files and directly necessary trace artifacts
- existing Change Request/Preview regression suite passes
- security/API reports contain no FAIL; local browser has zero warning/error logs
