# Web Harness

A control plane for building web applications with Claude Code — planning → design →
implementation → QA → handoff, driven by skills and subagents.

> 한국어 문서는 [README.ko.md](README.ko.md)를 참고하세요. (The full Korean documentation is
> the older and currently more detailed version; English docs are being migrated
> progressively — see [Documentation language](#documentation-language).)

## What this actually is

Most agent scaffolding helps a model write code faster. This one is built around a
different problem: **stopping an agent from reporting work as done when it isn't.**

The harness is a set of contracts, ownership rules, and machine gates that sit between
you and the agents. Its core rule is that a claim is not evidence. A builder saying "I
implemented the store" means nothing until the files exist, parse, and match the plan
that was fixed *before* the builder ran.

If that sounds like overhead, it is — deliberately. The tradeoff is worth it when the
output is a real service rather than a snippet.

## Quick start

```bash
nvm use
pnpm install --frozen-lockfile
pnpm run ci
```

A green run verifies:

- 31 skills <!-- inventory:skills -->
- 99 agents <!-- inventory:agents -->
- 2 built-in profiles: `react-vite-spa` (certified), `next-app-fullstack` (compatible)
- per-agent file ownership
- read-only verifier boundaries
- adapter mirror (`.agents`, `.codex`) drift and document hygiene
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

At service scale, the dominant failure mode we measured was not bad code — it was
builders spending 150–190k tokens re-reading specs and terminating before writing
anything. In one full pilot, 5 of 6 Phase 3 builders did this.

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
.agents/  .codex/   generated mirrors (never hand-edit)
docs/               protected-core (invariants + proxy registry), adoption guides
packages/           Web Harness Console (local approval UI)
```

`.claude/` is the only source of truth. Regenerate mirrors with:

```bash
node .claude/scripts/build-adapters.mjs
```

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

English migration is staged, and the ordering is deliberate: validators that keyed on
Korean string markers were made language-independent first, because translating the
bodies before that would have silently disabled those gates while CI stayed green.

1. ~~Make validators language-independent~~ (done)
2. This README (done) — Korean preserved at [README.ko.md](README.ko.md)
3. Agent bodies
4. Skill and contract bodies

## Further reading

- [docs/protected-core.md](docs/protected-core.md) — invariants I1–I6 and the proxy registry
- [docs/brownfield-adoption.md](docs/brownfield-adoption.md) — adopting into an existing codebase
- [CLAUDE.md](CLAUDE.md) — the judgment gate applied to changes in this repository
