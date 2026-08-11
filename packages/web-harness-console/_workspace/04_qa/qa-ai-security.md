# AI Security QA — Codex Run Bridge

## Result

PASS

- Request text is delimited as untrusted intent and cannot override server-owned sandbox/cwd/command policy.
- Side-effecting apply is L2 with dedicated approval and completed impact ownership.
- No provider secret, API key, raw reasoning, tool output or environment value enters browser/audit records.
- No automatic retry, arbitrary tool call, danger bypass, additional writable root or Git/external mutation path exists.
- Revision feedback is bounded and quoted as untrusted; browser cannot provide applyRunId or raw prompt.
- APPROVED/DISCARDED block later runs. DISCARDED does not trigger an automatic destructive restore.

## Round 11 — Candidate isolation

- workspace-write runs execute in a server-created temporary candidate rather than the canonical project root; the prompt also states the canonical boundary is outside cwd.
- candidate file truth is recomputed by the server with symlink, path, file-count and byte limits. Model-reported `affectedFiles` cannot authorize promotion.
- only an exact `APPROVED` review promotes the candidate after whole-tree stale-base validation. Revision/discard leave canonical files unchanged.
- candidate content/path tampering and post-apply canonical edits fail closed with typed errors and no decision event.
- residual denial-of-wallet is bounded by one active run, 20-minute apply timeout, 20,000 source files/128 MiB snapshot and 512 changed files/32 MiB diff.

## Round 17 — Bounded context and apply scope

- Impact receives only indexed target/trace metadata plus bounded related paths and explicitly refuses broad scans after four fallback reads.
- Semantic reuse requires exact analyzer/request/project/preview digest equality; stale evidence cannot authorize a new-format apply.
- Apply is confined by the approved impact file list and candidate sandbox. Insufficient evidence fails `BLOCKED` instead of expanding to repository-wide CI or lifecycle orchestration.
- Usage parser copies non-negative integer counters only; provider-specific unknown keys and raw event bodies are dropped.

## 2026-08-07 — 검증 근거 (test mapping)

2026-08-07 `pnpm run console:test` 42/42 PASS 기준.

- "request text는 untrusted, sandbox/cwd/command는 server-owned" — `codex-runs.test.mjs` 'server-owned prompt and argv keep request text untrusted and sandbox phases fixed'. Claude Code 경로의 도구 정책 argv는 `claude-code-cli.test.mjs` 'claude argv pins print/json-schema output and per-phase tool policy'.
- "apply는 L2 승인·completed impact ownership" — `server.test.mjs` 'Codex run endpoint is loopback-gated and separates read-only impact from approved apply'(승인 없는 apply 403)와 `codex-runs.test.mjs`의 owned review 검증.
- prompt injection 경계 — `server.test.mjs`의 browser 제공 `prompt` field 400 거부·`untrusted_review_feedback` 구획과 `preview-message-contract.test.mjs`의 bounded identifier·exact source/origin 검증 2건.
- Origin/intent 경계 — `server.test.mjs` 첫 테스트(비 loopback Origin 403, intent 누락 403, media 415)와 'malformed URL encoding and non-loopback Host headers are rejected without killing the server'.
- "APPROVED/DISCARDED 이후 실행 차단" — `server.test.mjs` 409 `CHANGE_REQUEST_REVIEW_TERMINAL`과 `change-request-reviews.test.mjs` terminal rewrite 거부.
- candidate isolation — `change-candidates.test.mjs` 5개 테스트(격리·rollback·stale 실패·symlink/traversal 거부·append-only 제외 2건).
- bounded context — `codex-runs.test.mjs` 'impact context is bounded and replaces broad repository inspection with current indexed evidence'와 cache invalidation 테스트.
- "provider secret/API key/environment 값 미유입" — usage allowlist 테스트가 unknown/provider field 미노출을 커버하나, child environment allowlist 자체와 "no automatic retry" 단정은 직접 테스트 미커버.
