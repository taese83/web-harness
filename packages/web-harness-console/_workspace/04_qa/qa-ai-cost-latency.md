# AI Cost and Latency QA — Codex Run Bridge

## Result

PASS (static budgets and telemetry); live savings NOT_MEASURED

- Enforced: one active run, impact 5-minute timeout, apply 20-minute timeout, automatic retry 0, bounded output.
- Review decision is a bounded local append with a 5-second API budget and no model call; revision adds at most 2,000 characters to the next approved apply.
- Enforced: impact manifest caps 12 documents/24 TC/12 anchors and 4 fallback reads; apply prompt prohibits broad enumeration and root Harness/full CI/install/build-all.
- Enforced: completed impact semantic cache is exact-bound to analyzer, request, all indexed document hashes and preview digests; cache hit invokes no executor and records a new audit.
- Measured when supplied: JSONL input/cached/cache-write/output/reasoning/total tokens survive completion and timeout through a numeric allowlist. Missing events remain `NOT_MEASURED`; cache hit is distinguished from zero usage.
- `NOT_MEASURED`: monetary cost and post-change live provider latency/token reduction. The timeout-triggering request is not automatically rerun, so release claims remain limited to deterministic scope/cache/telemetry evidence.
