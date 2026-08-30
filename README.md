# Web Harness

A control plane for building web applications with Claude Code — planning → design →
implementation → QA → handoff, driven by skills and subagents.

> 한국어 문서는 [README.ko.md](README.ko.md)를 참고하세요. (A Korean translation kept in sync
> with this README; contract bodies are still being migrated — see
> [Documentation language](#documentation-language).)

## What this actually is

Most agent scaffolding helps a model write code faster. This one is built around a
different problem: **stopping an agent from reporting work as done when it isn't.**

The harness is a set of contracts, ownership rules, and machine gates that sit between
you and the agents. Its core rule is that a claim is not evidence. A builder saying "I
implemented the store" means nothing until the files exist, parse, and match the plan
that was fixed *before* the builder ran.

If that sounds like overhead, it is — deliberately. The tradeoff is worth it when the
output is a real service rather than a snippet.

## What it costs to adopt

Honest, machine-verified numbers — a ratchet fails the build if any of them drifts.

- **What *you* read**: this README + [docs/quickstart.md](docs/quickstart.md). That's the whole
  human onboarding path. The ~120 contract documents are read *by the agent*, on demand — not by you.
- **Fixed contract load per orchestrator run**: 46,221 bytes <!-- inventory:entry-cost --> of
  always-read contract files. That is a *byte* measurement of exactly those files — roughly 9k
  tokens at bytes/3, an approximation, not a token count. It deliberately **excludes** the skill
  file itself (~9k tokens), the per-spawn agent definitions, runtime hook injection, and everything
  loaded on demand — so treat it as the floor of one dimension, not the total context bill. The
  always/on-demand split is declared by an `<!-- always-read -->` anchor, and both the reference
  count and the byte size are ratcheted: growth fails the build until someone updates the baseline
  with a JUDGMENT record.
- **Token cost per app**: measured, not estimated. The reference pilot — a mid-size SPA taken from
  intake to a T0 receipt — spent roughly **12.7M tokens over ~90 spawns**, with **11% of spawns
  ending incomplete** (10 of 90). That is the *incompleteness* rate, not the retry rate — the retry
  rate in the same pilot was **37% (34 of 91)**. Token totals cover 77 of the 90 spawns, so 12.7M is
  a floor. (Scoped to that pilot's close; its telemetry file keeps accumulating for
  follow-up work, so treat these as the recorded order of magnitude, not a live counter. The
  authoritative record is `docs/efficacy/greenfield-pilot-2-protocol.md` appendix A.) This is the
  honest headline — the harness buys evidence, and evidence is expensive. If you want a prototype
  in minutes, use a prototype tool; this one is for when "it looks done" is not good enough.

## Quick start

**Building your first app?** Start with **[docs/quickstart.md](docs/quickstart.md)** — plugin
install, first generated app, honest cost expectations, and the brownfield path. The commands
below validate the *harness itself* (contributor path):

```bash
nvm use
pnpm install --frozen-lockfile
pnpm run ci
```

A green run verifies:

- 24 skills <!-- inventory:skills -->
- 46 agents <!-- inventory:agents -->
- 3 built-in profiles: `vite-serverless-hybrid` is `certified`; `react-vite-spa` and
  `next-app-fullstack` are `compatible`. The `certified` label is machine-bound to isolated-CI
  evidence (`validate-certified-evidence`): the hybrid lane's receipt is
  `golden/vite-serverless-hybrid/_workspace/04_qa/t1-summary.json`, minted `ISOLATED_VERIFIED` by the
  isolated `hybrid-t1` workflow. The committed receipt is the **B-7 re-run** (run 32636870973,
`declaredRevision` 97936f1), which replaced the first receipt (run 32614388125, revision 48b96b3)
because that one was minted before the promotion commit and carried a stale fingerprint — see
[docs/ci-activation-runbook.md](docs/ci-activation-runbook.md) B-7. T1 is the machine floor — T2 signed
  attestation is still separate
- per-agent file ownership
- read-only verifier boundaries
- document hygiene (broken repo-path references, hardcoded remnants, skill versioning, README inventory)
- global Bash policy fixtures, profile resolver/DAG assertions, Next.js contract cases,
  harness integration checks, web and AI eval contracts, AI secret/tool safety hooks,
  and the Console's static checks and regression tests

The skill/agent counts above carry `<!-- inventory -->` markers that `validate-harness.mjs`
compares against the real directories, so this README cannot silently go stale.

### Install as a Claude Code plugin

```
/plugin marketplace add https://github.com/taese83/web-harness-plugin
/plugin install web-harness@web-harness-marketplace
```

Then run `/web-harness:web-orchestrator`, `/web-harness:web-plan`, or
`/web-harness:web-console` from any project directory.

Cost note: the plugin adds roughly 10k tokens of always-on context per session. Disable
it when you aren't using it.

## How work flows

```
Phase 1  Planning      requirements, UX, feature plan, tech stack   → project brief
Phase 2  Design        design system, layout, components, API       → approval surface
         ── approval gate: nothing proceeds without it ──
Phase 3  Implementation  scaffolding, domain state, components, routes
Phase 4  QA            code, UX, security, browser, performance, state verifiers
         Release       handoff document
```

Two things make this different from a prompt chain:

**The approval gate is real.** Before implementation starts, you get a working surface to
approve — an interactive prototype for greenfield projects, or a *live delta* for
brownfield ones (your running dev server with only the change injected on top). Approval
is recorded with a digest of the source specs; if a spec changes afterward, the approval
goes `STALE` and Phase 3 is blocked until it's re-approved.

**Approved content is the input to implementation.** The same test-case IDs you approved
are the ones verified after implementation. Approval, implementation, and verification
are linked by identifier, not by memory.

## Ownership and safety

Every agent has a declared file-ownership scope, enforced by a hook. A component builder
cannot silently rewrite your build config. Verifier agents are read-only — they can find
problems but cannot "fix" them into passing.

A global Bash policy restricts what commands agents may run: validation scripts are
allowlisted with argument-level contracts, and anything outside that is denied rather
than best-effort permitted.

## Runaway prevention

When a spawn fails at service scale, it usually fails the same way: it spends 130–170k
tokens re-reading specs and terminates before finishing its output. Per-spawn telemetry
from a full service pilot (22 spawns, planning through implementation) puts the actual
rate at **3 incomplete spawns out of 22 — 15% of tokens**, all recovered by re-spawning
only the remainder. So this is a real failure mode with a real cost, not a constant one.

Three machine gates address it:

| Gate | What it does |
|---|---|
| `validate-spawn-plan.mjs` | Refuses a spawn *before* it runs if it declares too many outputs or too large a spec read surface |
| `verify-spawn-completion.mjs` | Fails when a spawn leaves no output, or leaves files truncated mid-edit |
| `resume-manifest.mjs` | Classifies each declared output as done/truncated/missing so only the remainder is re-spawned |

The plan can be locked (`--lock`) before the spawn, with the digest recorded in an
append-only ledger. Shrinking the manifest afterward to fake completion is caught as
`TAMPERED`.

Honest scope: these gates are calibrated against measured failures, but whether they
*reduce* runaway rate in practice has not been measured yet. See
[docs/protected-core.md](docs/protected-core.md) §4 for every known proxy and its limits.

## What it costs

Token usage is recorded per spawn, not estimated. The contract is explicit that when the
runtime does not report usage, the field is written as `null` — **values are never guessed
or filled in**. From one full service pilot (planning → design → implementation):

| Phase | Spawns | Tokens | Share |
|---|---|---|---|
| Planning | 10 | 844,039 | 30% |
| Design | 6 | 1,130,234 | 40% |
| Implementation | 6 | 831,449 | 30% |
| **Total** | **22** | **2,805,722** | |

The single largest spawn was the design-preview builder at 473k — the agent that produces
the interactive prototype you approve before any implementation starts. Cost concentrates
where rework risk is highest, which is the intended allocation rather than waste.

This instrumentation exists so claims about the harness can be checked against its own
records. It has already been used to correct an overstated failure-rate claim in this
README.

## Honesty as a design constraint

The repository keeps a registry of every place a check is a **proxy** rather than proof —
what it actually verifies, how it has been gamed, and what remains unresolved. Entries
are added when a weakness is found, including weaknesses found in the harness's own
gates. `docs/protected-core.md` §4 is that registry, and it is meant to be uncomfortable
reading.

Non-negotiables: never fabricate signing evidence locally, never weaken a gate to close a
loop, never promote a maturity tier without proof.

## Directory layout

```
.claude/            canonical source — skills, agents, scripts, evals, schemas
docs/               protected-core (invariants + proxy registry), adoption guides
packages/           Web Harness Console (local approval UI)
```

`.claude/` is the only source of truth. (The former `.agents/`/`.codex/` tool mirrors were
removed 2026-08-18 after an audit found zero consumers — the `.codex` hooks referenced a
Claude-only environment variable, proving they had never run under any other tool. If a
specific tool integration is wanted later, it will be generated in that tool's real format.)

## Limitations

- **Documentation is largely Korean.** Skill and agent *descriptions* — what the model
  routes on — are English, but most contract bodies are not yet translated.
- Builders still run away at service scale often enough that an orchestrator has to
  intervene; the gates catch it, they do not prevent it.
- SSR (Next.js), strict-CSP dev servers, and Shadow DOM are named but unproven surfaces
  for the live-delta preview.
- Thresholds (output fan-out, read budget) are calibrated from a single pilot service and
  need recalibration on differently shaped projects.

## Documentation language

Done so far:

1. **Validators made language-independent.** Several gates keyed on Korean string markers
   (`항상 … 읽는다`, `## 일반화 근거`, and others). Translating bodies first would have made
   those regexes stop matching — and most of them treated "marker absent" as a pass, so
   the gates would have gone quiet while CI stayed green. They now accept Korean, English,
   and a neutral `<!-- always-read -->` anchor, and a missing marker where the baseline
   expects one is a failure rather than a silent pass.
2. **This README** — a Korean translation kept in sync at [README.ko.md](README.ko.md).

Not done, and not a simple translation job:

Agent and skill bodies are still Korean. They cannot be translated file-type by file-type,
because **11 backtick-quoted Korean tokens are functional identifiers matched across
files**, not prose — `주 소비자` and `담당 범위` appear in 12 agent definitions (13 carry the
`consumer-read-protocol` anchor) and are
matched against the sharded-artifact read protocol; `ASSUMPTION(시안 확정)` is matched
against a design readiness contract. Translating agents alone would either leave them
half-Korean or silently break cross-file matching until the contracts followed.

So the real migration unit is a **marker cluster** — an agent plus every contract that
shares its literals — moved together with the validators that check them. That is a
refactor, not a translation pass, and it has not been started.

What this means in practice: the surfaces that affect adoption most — agent and skill
`description` fields, which is what the model routes on and what menus show — are already
English, as is this README. What remains Korean is the instruction detail you would read
when auditing or customizing an agent.

## Further reading

- [docs/protected-core.md](docs/protected-core.md) — invariants I1–I6 and the proxy registry
- [docs/brownfield-adoption.md](docs/brownfield-adoption.md) — adopting into an existing codebase
- [docs/competitive-landscape.md](docs/competitive-landscape.md) — where this sits in the 2026 tool landscape, and what actually distinguishes it
- [docs/field-guide-gap.md](docs/field-guide-gap.md) — ten agentic-engineering patterns checked against this codebase, with per-item evidence
- [CLAUDE.md](CLAUDE.md) — the judgment gate applied to changes in this repository
