# Agent Trace QA — Codex Run Bridge

## Result

PASS

- Audit events bind schema version, run/request/phase IDs, sequence, timestamps, connection version, base preview digest, final status, thread ID and bounded result/error.
- Raw chain-of-thought, command stream, environment and credentials are not persisted.
- Nonterminal records loaded without an owning process become `INTERRUPTED` and are never automatically resumed.
- Review decision events separately bind event/request/exact apply run IDs, decision, bounded reason and timestamp; original CHG and Codex run audits remain unchanged.
- New impact audits bind public analyzer/context/project digests and manifest size/document count. Cache reuse records its own ordered run events plus source run ID without fabricating a model thread or token usage.
- Allowlisted token usage is retained on completed and failed/timed-out terminal events when emitted before termination. Raw JSONL, prompt, reasoning and unknown provider fields remain absent.

## 2026-08-07 — 검증 근거 (test mapping)

2026-08-07 `pnpm run console:test` 42/42 PASS 기준.

- "nonterminal 기록의 INTERRUPTED 파생·자동 재개 없음" — `codex-runs.test.mjs` 'one active run is allowed and a nonterminal audit becomes interrupted after manager loss'.
- "review decision event의 exact apply run 결속" — `change-request-reviews.test.mjs` 'review decisions append once, bind to the exact apply run, and replay idempotently'와 'review decisions reject invalid transitions and terminal rewrites'.
- "cache 재사용은 자체 run event를 기록하고 새 model 호출 없음" — `codex-runs.test.mjs` 'unchanged impact context creates a cached audit without another model invocation and invalidates on project change'. `sourceRunId` 필드 단위 단정은 테스트 미커버.
- "terminal event의 allowlisted token usage 보존" — `codex-runs.test.mjs` 'failed and timed-out runs preserve only measured token usage'와 'Codex JSONL token usage is allowlisted and malformed usage remains unmeasured'.
- "audit event의 schema version·sequence·timestamp 등 필드 단위 결속"과 "raw chain-of-thought/command stream/environment 비영속" 전체 부정 주장 — 필드 단위 직접 테스트 미커버. usage allowlist 테스트가 unknown field 미노출을 부분 커버한다.
