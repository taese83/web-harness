# Data Governance — Codex Change Request Bridge

- Data source: local Change Request Markdown, current repository files, Codex JSONL events, apply-run-bound review decision JSONL.
- Identity/tenant: local single-user loopback process; no remote tenant claims. Browser input never supplies identity or project root.
- Credentials: saved Codex CLI authentication is consumed by the CLI process only; tokens are never returned, logged, copied to prompt, or exposed to browser.
- Retention: Change Request, run audit and review decision audit remain in project `_workspace`; raw stdout/stderr is not persisted beyond bounded structured result/error metadata.
- Redaction: environment values, reasoning text, command output and tool payloads are excluded from public run records. Error messages expose typed categories and bounded sanitized text.
- Deletion: no Console delete endpoint. Manual removal remains an explicit repository operation outside this feature.
- Provenance: run record binds changeRequestId, request base digest, phase, Codex CLI version, threadId, timestamps and final status. Review event binds exact applyRunId, decision, bounded reason and timestamp; idempotency key is not public.
