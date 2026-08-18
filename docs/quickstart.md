# Quickstart

From zero to your first generated web app. Two paths: **plugin** (fastest, works from any
directory) and **repo mode** (full gates, for contributors and teams that want the harness's
own validation running locally).

> **Honesty first.** This harness generates real, production-shaped services — and that costs
> real tokens. The one fully recorded greenfield run (a booking service) consumed
> **2.8M tokens across 22 agent spawns** (planning 844k · design 1,130k · implementation 831k).
> The runaway gates *detect and contain* incomplete spawns (3 of 22 in that run, all recovered);
> whether they *reduce* runaway rates versus running without them has not been measured yet.
> No profile is currently `certified` — that label is machine-bound to isolated-CI evidence
> (`validate-certified-evidence`), and no lane has produced that evidence yet. All three
> built-in profiles are `compatible`: contracts, static fixtures, and DAGs are verified;
> deployment closed-loops are not.

## Prerequisites

| Requirement | Exact | Why exact |
|---|---|---|
| Node.js | **22.22.3** (engine floor ≥22.22.0) | `.nvmrc`/`.node-version` pin; toolchain preflight fails otherwise |
| pnpm | **11.18.0**, installed directly | Exact-match check. **Corepack shims are rejected** by the toolchain validator — install with `npm install -g pnpm@11.18.0` |
| Claude Code | current | The harness runs as Claude Code skills/agents |

```bash
nvm install 22.22.3 && nvm use 22.22.3
npm install -g pnpm@11.18.0 --ignore-scripts
```

## Path A — Plugin (recommended for first contact)

Install once, use from any directory:

```
/plugin marketplace add https://github.com/taese83/web-harness-plugin
/plugin install web-harness@web-harness-marketplace
```

Then, in an empty project directory:

```
/web-harness:web-orchestrator A kanban board for a small team — boards, cards,
drag-and-drop between columns, local persistence
```

What happens next:

1. **Intake** — the orchestrator asks up to 3 product-focused questions (target screens,
   who finishes what task, what "success" looks like). Answer in Korean or English.
2. **Phase 1 Planning → Phase 2 Design** — parallel agent waves produce requirements, UX
   brief, layout/component/API specs under `_workspace/`. You get **approval checkpoints**;
   the design preview is an interactive prototype you validate before implementation.
3. **Phase 3 Implementation → Phase 4 QA** — builders write the app (React 19 + Vite + TS
   strict, FSD structure); read-only verifiers produce QA reports with machine receipts.
4. Verify or iterate with `/web-harness:web-verify`.

Plugin-mode caveats (honest deltas from repo mode):

- The plugin ships **without** the toolchain preflight and harness self-validation — a wrong
  Node/pnpm version fails downstream with less helpful messages. Check the prerequisites
  table yourself.
- Session overhead is ~10k tokens (always-loaded surface).
- The repo-development Bash policy hook is not included (it is repo-specific).

## Path B — Repo mode (full gates)

```bash
git clone https://github.com/taese83/web-harness
cd web-harness
nvm use
pnpm install --frozen-lockfile
pnpm run ci        # green = toolchain, mirrors, 58 validators, gate regressions, AI contracts
```

New apps live **inside the checkout** under `workspace/` (gitignored):

```
/web-orchestrator 서비스 설명... 위치는 workspace/my-service
```

> **Important constraint:** the control-plane deployer (`deploy-harness.mjs`) refuses targets
> outside this repository — you cannot point it at `~/work/my-existing-app`. For existing
> projects, either clone them under `workspace/` (their `.node-version`/`.nvmrc` must match
> the harness pins or deployment aborts), or use the plugin path, which has no such
> constraint.

For the console (change-request loop, run monitoring): `pnpm run console`, and copy
`.claude/launch.example.json` → `.claude/launch.json` for your dev-server commands
(gitignored — a fresh clone has none).

## Existing projects (brownfield)

The entry point is **a change request, not an init ceremony** — see
[brownfield-adoption.en.md](brownfield-adoption.en.md). The short version: when the next
change arrives, the console drafts a mini-plan around it, you review the candidate (open the
plan file itself — the review screen lists files, it does not yet render line diffs), approve,
and the loop applies it. Two sharp edges the pilots hit:

- Test-case lines must be exactly `- TC-NNN-N: Given…, When…, Then…` — format violations
  surface as *silently missing* TCs; compare the console's parsed TC count after generation.
- Apps that redirect to an SSO server cannot render in the console's embedded preview
  (loopback-only CSP); use "open in new tab".

## What to expect from the gates

- Every spawn is budget-checked before launch (`validate-spawn-plan`) and completeness-checked
  after (`verify-spawn-completion` — an agent that writes zero files is a failure, not a
  silent pass). Interrupted builds resume without rewriting finished files
  (`resume-manifest`, tamper-evident).
- Detection efficacy is measured (unit 46/46, live n=1, 1,200-sample synthetic replay —
  `docs/efficacy/`). Outcome efficacy (do the gates improve completion rates?) is honestly
  **not yet measured**; the A/B protocol and its token budget are documented in the same
  directory.
- Quality labels cost evidence: `certified` requires a golden reference project with an
  isolated-CI closed-loop receipt, enforced by `validate-certified-evidence`. Claims without
  receipts fail CI.

## Where to go next

- [README](../README.md) — what this actually is, cost model, honesty registry
- [brownfield-adoption.en.md](brownfield-adoption.en.md) — the L0–L3 adoption ladder
- [ci-activation-runbook.md](ci-activation-runbook.md) — the path to the first `certified` lane
- `docs/protected-core.md` (Korean) — the invariants and the known-proxy registry; the
  self-critical heart of the project
