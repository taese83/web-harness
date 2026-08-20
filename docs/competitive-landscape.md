# Competitive landscape — proof-gated vs the field

*Compiled from parallel web research, August 2026. A designed single-page version
of this analysis exists as a private Claude artifact; ask the maintainer for the link.*

Nearly every AI coding tool now runs tests and iterates. The whole field separates on
**one axis: what happens at the verification boundary** — is "it passes" self-judged,
handed to a human or existing CI to gate, or a machine-enforced promotion that refuses to
advance without evidence? web-harness is close to alone in the last position at the
production-tool level. But its *architecture* is mainstream, and it is **not** the only
full-SDLC Claude Code plugin. This document is deliberately honest about both.

## The verification spectrum

Tools placed by their **default** correctness signal.

| Tier | Signal | Gate | Tools |
|---|---|---|---|
| 0 · preview | Renders = done | Live preview + human PR review | v0, bolt.new |
| 1 · self-graded | Self-test loop | Agent runs tests, satisfies its own checks | Replit Agent 3, Lovable, Cursor 2.0, Windsurf, Devin, OpenHands, SWE-agent, Aider, gpt-pilot |
| 2 · delegated gate | Structural human gate | Branch protection + mandatory human, on the customer's own CI | GitHub Copilot coding agent, Google Jules |
| 3 · proof-gated | Evidence promotion | Signed receipts · isolated runs · no proof, no promotion | **web-harness** (no production analog found) |

Even Replit Agent 3 (strongest self-test, REPL + Playwright) and Copilot (structurally
enforces a human gate) stop at "attempt tests, then delegate the accept/reject decision."
Proof-as-the-precondition-of-promotion is where web-harness stands alone.

## Master matrix

Representative tools across four categories. ● present & enforced · ◐ available as an
opt-in pattern · ○ not found.

| Axis | App builders (v0 · bolt · Lovable) | Autonomous SWE (Devin · Copilot · OpenHands) | MA frameworks (LangGraph · CrewAI · MAF) | Spec-driven (Spec Kit · Kiro · BMAD) | web-harness |
|---|:---:|:---:|:---:|:---:|:---:|
| Runs tests & iterates | ◐ reactive | ● | ◐ you wire it | ◐ via agent | ● |
| Release gated on proof | ○ | ○ human/CI | ○ | ○ | ● |
| Signed receipts / tiers | ○ | ○ | ○ | ○ | ● |
| Generator ≠ verifier | ○ | ◐ Devin reviewer | ◐ pattern | ◐ QA persona | ● structural |
| Anti-gaming invariants | ○ | ○ | ○ | ○ | ● |
| Spec → impl traceability | ○ | ○ | ○ | ● core | ● same-TC-ID |
| Runaway control | ◐ | ◐ iter caps | ● caps | ◐ | ● pre-spawn fit-gate |
| Lazy / staged dispatch | ○ single loop | ◐ | ● | ◐ | ● ~99 agents |
| Web-app specialized | ● | ○ general | ○ general | ○ general | ● |

## Mainstream architecture, distinctive discipline

### What web-harness shares (not a moat — this is the 2026 mainstream)

- **Multi-agent role decomposition.** MetaGPT (~5 roles), gpt-pilot
  (Tech Lead → Dev → Reviewer), CrewAI / LangGraph / MAF as assemble-your-own.
- **Generator ≠ verifier, as a pattern.** ChatDev, gpt-pilot, SWE-agent, LangGraph's
  evaluator-optimizer — usually the same model family, rarely enforced.
- **Spec / plan-first.** Spec-driven development is *the* 2026 methodology — Spec Kit
  (111k★), Kiro, BMAD, Lovable Plan Mode.
- **Runaway caps.** The Claude Agent SDK now ships depth / concurrency / budget / turn
  caps out of the box.
- **Full-SDLC Claude Code plugin.** `closedloop-ai/claude-plugins` and
  `agentic-sdlc-plugin` already ship quality-gated QA loops. web-harness is not the only one.

### What is distinctive (no analog found in production tooling)

- **Evidence tiers + signed attestation as the promotion currency.** T0→T2 with Ed25519
  signing. No production tool gates release this way.
- **Anti-gaming invariants as a registered discipline.** A proxy registry, "no closing the
  loop by weakening verification," "no tier promotion without proof." This is the frontier
  reward-hacking problem, applied as a governance contract rather than an eval benchmark.
- **Same-TC-ID reverification.** A test case approved in preview is re-verified in
  implementation by the identical machine ID — tighter than BMAD's "vision→code" trace.
- **Author self-dogfood monitoring.** Detects when the maintainer bypasses the harness.
  No analog surfaced.

## Four comparisons that decide positioning

### 1. Claude Agent SDK — the foundation (enables all, enforces none)

web-harness is **built on these exact primitives**: context-isolated subagents, per-agent
tool/model limits, lazy model-decided dispatch, hooks + permissions, depth/concurrency/budget
caps. The SDK makes every web-harness property *possible* and none of the discipline ones
*mandatory*.

| Property | Claude Agent SDK | web-harness adds |
|---|---|---|
| gen ≠ verifier | convention — you *can* define a read-only reviewer | **structural** — read-only verifiers mandatory on every stage |
| promotion gate | no "evidence required" primitive | **no receipt = no promotion**, enforced in gate logic |
| handoff | prompt string in, summary out | **file-based contracts** + `_workspace` shared artifacts |
| runaway | depth / concurrency / $ caps | + **per-spawn** read-token & output fit-gate |

**Takeaway:** web-harness is best described as a *discipline control plane on top of the SDK
everyone shares* — not another framework.

### 2. GitHub Spec Kit · AWS Kiro — the methodology twin (spec-first, no evidence gate)

Spec-driven development is the closest methodology: executable specs as the source of truth,
moving spec → plan → tasks → implementation. That mirrors web-harness's Plan → Design phases
and TC traceability almost exactly. The divergence is downstream — SDD stops at "the spec
drove the code," never "the code proved itself against the spec."

| Dimension | Spec Kit / Kiro | web-harness |
|---|---|---|
| spec as truth | yes — the whole thesis | yes — Plan/Design + `TC-NNN-N` |
| traceability | spec → tasks → PR | **spec → preview → impl, same TC ID re-run** |
| verification | agent + human review of output | **execution receipt gates the stage** |
| anti-gaming | none | **protected-core proxy registry** |

**Takeaway:** same spine, one more vertebra. Spec Kit / Kiro are natural interop targets,
not rivals.

### 3. gpt-pilot · Pythagora — the architecture twin (roles + reviewer, no tier)

The closest full multi-agent SWE shape: Tech Lead → Developer → Code Monkey → *Reviewer* →
Technical Writer, with a Reviewer that bounces bad steps back and two-tier tests (unit after
each step, integration/E2E after each task). It reaches "verification is structural" — then
stops short of tiers, signing, and anti-gaming, and the OSS line carries real trust risk.

| Dimension | gpt-pilot | web-harness |
|---|---|---|
| reviewer | bounces steps back (discretionary) | **read-only verifier, receipt-gated** |
| tests | 2-tier generated (unit + E2E) | same-ID re-verify + tier evidence |
| promotion | escalates to human when stuck | **blocked without proof** |
| status | OSS unmaintained · 2025–26 supply-chain worm (cleaned) | actively gated + self-dogfooded |

**Takeaway:** gpt-pilot proves the *shape* is not unique; web-harness's edge is that the
reviewer's verdict is bound to signed evidence, not discretion.

### 4. Claude Code full-SDLC plugins — the platform rival (closest direct competition)

Same platform, same ambition. `closedloop-ai/claude-plugins` ships a plan-first SDLC with
LLM quality judges; `agentic-sdlc-plugin` runs 10 commands from idea to shipped with an
8-agent QA loop and "quality gates" plus a self-expanding test suite. They have gates — but
LLM-judge gates, not evidence-tier gates.

| Dimension | closedloop / agentic-sdlc | web-harness |
|---|---|---|
| full SDLC | yes — idea → shipped | yes — Plan → Release |
| quality gate | LLM judges / quality gates | **exit-code + signed receipt tiers** |
| "passing" | a model says it looks right | **a run proves it, or it doesn't ship** |
| anti-gaming | none surfaced | **registered invariants** |

**Takeaway:** "full-SDLC Claude Code plugin" is a crowded category. The differentiator to
lead with is not scope — it's "no green without evidence," where LLM-judge rivals still trust
a model's opinion.

## The field is bending toward these ideas

- **Cognition (Devin) converges.** Their engineering blog endorses single-threaded writes +
  read-only auxiliary agents + a clean-context reviewer — web-harness's instinct, reached
  independently. The popular "Devin = model swarm" story is unsupported SEO.
- **BMAD trims its agents.** The leading multi-agent method consolidated in 2026 — merging
  Scrum Master + QA into the Dev agent, "retiring the multi-agent development-team model."
  The industry is trending toward *fewer* agents.
- **Reward hacking is a live field.** SpecBench, ImpossibleBench, and capped-evaluation
  research confirm gaming is real — and "not a bug that can be patched, but an inevitable
  consequence of optimization." Academia works at the benchmark layer; web-harness works at
  the production gate.

## Strategic reads

1. **Message.** Lead with proof-gated promotion and anti-gaming — never "another app
   builder" or "another SDLC plugin," both crowded.
2. **Agent count.** Echo BMAD's trim — sell "each unit is thin and independently verifiable,"
   not "we have ninety-nine."

## Sources & confidence

- Spec-driven — [github/spec-kit](https://github.com/github/spec-kit) · [kiro.dev](https://kiro.dev) · BMAD-METHOD
- App builders — [v0](https://vercel.com/blog/introducing-the-new-v0) · [bolt.new](https://github.com/stackblitz/bolt.new) · [Lovable](https://docs.lovable.dev/features/agent-mode) · [Replit Agent 3](https://replit.com/blog/automated-self-testing)
- Autonomous SWE — [Cognition/Devin](https://cognition.com/blog/multi-agents-working) · [Copilot coding agent](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent) · [OpenHands SDK](https://arxiv.org/html/2511.03690v1) · [SWE-agent](https://arxiv.org/abs/2405.15793)
- Frameworks — [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/subagents) · [Microsoft Agent Framework](https://learn.microsoft.com/en-us/agent-framework/overview/) · CrewAI · LangGraph
- Plugins — [closedloop-ai](https://github.com/closedloop-ai/claude-plugins) · [agentic-sdlc](https://github.com/ajaywadhara/agentic-sdlc-plugin)
- Reward hacking — [SpecBench](https://arxiv.org/pdf/2605.21384) · [The Verification Horizon](https://arxiv.org/pdf/2606.26300)

**Confidence:** verification-boundary placements are well-sourced across multiple 2026
references. Closed-source internals (Devin agent composition, any Devin/Factory hard-gate
enforcement) are flagged inference, not fact. "No production analog" for evidence-tier
promotion reports absence-of-evidence honestly — not confirmed absence.
