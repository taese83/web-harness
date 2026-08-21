# Field-guide gap analysis — reference implementation, plus a layer

*Compiled August 2026. A designed single-page version exists as a private Claude artifact;
ask the maintainer for the link. Companion to [competitive-landscape.md](competitive-landscape.md).*

An agentic-engineering "field guide" — framed around Anthropic's CCA exam and circulated as
a third-party podcast summary — lists ten patterns for running agents well. Checked against
web-harness's actual code, the efficiency layer is essentially complete. The one thing the
guide never mentions is the layer that distinguishes web-harness.

**Source caution.** The guide is a third-party podcast summary on a finance aggregator, not a
primary Anthropic source. Exam specifics (fee, weightings, retake cadence) are treated as
**unverified** and excluded from scoring. The engineering patterns themselves are sound and
independently corroborated; only those are scored here.

## Scorecard

| Verdict | Count | Meaning |
|---|:---:|---|
| ✅ owns it | 7 | web-harness code implements it |
| ↗ inherited | 2 | provided by the Claude Code runtime it plugs into — honestly, not its own contribution |
| ○ N/A | 1 | an optimization axis that doesn't apply to a plugin |
| ➕ exceeds | 3 | beyond the field guide entirely |

## The efficiency layer — ten patterns, checked against the code

Each verdict is backed by a named file or mechanism, verified by direct code inspection —
the same discipline the tool applies to itself.

| # | Field-guide principle | Verdict | Code evidence |
|---|---|---|---|
| 01 | **Inspect the stop reason & loop** (tool_use → run · end_turn → confidence gate · max_tokens → partial) | ↗ inherited | The Claude Code runtime owns the agent loop. web-harness is a plugin on top — it does not implement its own `stop_reason` handling, and would not claim it as its contribution. |
| 02 | **Specialize subagents** (1–2 tools each; no tool-loaded generalist) | ✅ owns | 99 role-specialized agents. Every verifier is frontmatter-restricted to `Read, Glob, Grep, Bash`; builders add only `Write, Edit`. Tools scoped by role, not loaded wholesale. |
| 03 | **Isolate context** (each agent sees only its slice) | ✅ owns | File-based `_workspace/` contracts pass artifacts between agents; `artifact-sharding-contract` caps each agent's read scope in bytes — measured, not by convention. |
| 04 | **Summary-only handoff** (no reasoning-chain spillover to main window) | ✅ owns | The Agent tool returns only a subagent's final message (runtime); web-harness narrows it further — handoff is the written file contract, not the transcript. Spillover is structurally impossible. |
| 05 | **Critic gets claim + evidence only** (not the reasoning chain that produced it) | ✅ owns | Read-only verifiers separated from generators. `harness-change-reviewer` receives the diff and claims — never the generation session — and grades I1 "claim vs proof." Change-request verification compares against `affectedTestCaseIds` evidence alone. |
| 06 | **Token gate & compaction** (compress past ~150k tokens) | ↗ inherited | Reactive compaction is the runtime's. But web-harness adds a **pre-spawn** cap the guide doesn't describe: `validate-spawn-plan.mjs` refuses a spawn projected past 60k read tokens — prevention before the window fills, not compression after. |
| 07 | **CI non-interactive, permission-free** (pipelines run without gates) | ✅ owns | `WEB_HARNESS_ISOLATED_EXECUTION` drives `run-quality-gates.mjs` in an isolated, non-interactive run — the same evidence path that mints release receipts. |
| 08 | **Batch mode for latency-tolerant work** (~50% cost, results within 24h) | ○ N/A | A real Anthropic feature — but web-harness dispatches subagents through the runtime, it is not an API batch consumer. This optimization axis doesn't apply; N/A, not a gap. |
| 09 | **Hierarchical CLAUDE.md** (root → folder → directory scope) | ✅ owns | Root `CLAUDE.md` carries the judgment gate; per-project re-entry markers are owned and written by `package-scaffolder` so generated projects route back into the harness. |
| 10 | **Context-capacity discipline** ("don't fill the 1M window just because it's there") | ✅ owns | The fit-gate plus point-in-time loading (references read just before their phase, never up front) plus a tracked always-read budget keep the fixed surface small by design. |

## What the guide never reaches — three properties beyond it

- **➕ Evidence-tier promotion.** T0→T2 with Ed25519-signed attestation. The guide runs
  agents well; it never gates release on signed proof.
- **➕ Anti-gaming invariants.** A proxy registry in `protected-core §4`: no closing the loop
  by weakening verification, no tier promotion without proof.
- **➕ Generator ≠ verifier, made structural.** The guide reaches "isolate the critic."
  web-harness makes the verifier a mandatory gate the builder's output must pass.

## Conclusion

1. **The efficiency layer is essentially complete** — but honestly split: stop-reason and
   compaction are inherited from the Claude Code runtime, not web-harness's own contribution.
   The other seven it owns, and several it enforces more strictly than the guide (pre-spawn
   fit-gate, file-contract isolation, mandatory verification).
2. **The only "gap" is item 8, and it isn't one** — batch mode is an API-app optimization
   that doesn't apply to a subagent-dispatching plugin. Reported as N/A, not silently skipped.
3. **The guide stops at "run agents efficiently"** and never reaches "force verification into
   a production gate" — web-harness's distinctive layer. The field guide corroborates the
   foundation and leaves the moat outside the frame — the same conclusion the competitive
   review reached independently.

> A reference implementation of the field guide — plus the layer the field guide never names.

## Method & confidence

Each verdict is backed by a named file or mechanism in the repository, verified by direct
code inspection — verifier tool restrictions from agent frontmatter, the 60k read-token cap
from `validate-spawn-plan.mjs`, isolated execution from `WEB_HARNESS_ISOLATED_EXECUTION`,
hierarchical config from the root `CLAUDE.md` and `package-scaffolder` markers. Source guide:
a third-party podcast summary (finance.biggo.com); exam-specific claims are unverified and
excluded from scoring. The corroborating pattern — a critic that receives claims and evidence
rather than the generating reasoning chain — matches Anthropic's published multi-agent
research design.
