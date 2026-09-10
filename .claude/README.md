# Web Harness Control Plane

This directory is the deployable Web Harness's canonical source of truth.

## Deploying into another project

> **Constraint (by design):** `deploy-harness.mjs` only accepts targets **inside this
> repository checkout** — it refuses external paths like `~/work/my-app`. To adopt the
> harness in an existing project, either clone that project under `workspace/` first
> (see `workspace/README.md`), or install the Claude Code **plugin**, which works from any
> directory (root `README.md` → "Install as a Claude Code plugin").

From the repository root:

```bash
node .claude/scripts/deploy-harness.mjs --target workspace/<existing-child-project>
```

The deployer validates the source repo, blocks symlinks, refuses to overwrite an existing
`.claude`, stages then atomically promotes, and re-validates the target. It never copies
`skills` alone: agents, scripts, evals, adapters, schemas, settings, and the toolchain pins
must travel together for MSW init, OpenAPI adoption, profile resolution, QA receipts, and the
release gate to work. Targets whose `.node-version`/`.nvmrc` differ from the harness pins are
refused — align them first.

## After deployment

1. `node .claude/scripts/validate-harness.mjs`
2. Start with `/wh` — the single entry point. It judges the lane and shows it:
   `/wh plan` (Phase 1 only, stops at the plan-reviewer readiness gate — not an approval checkpoint) · `/wh new` (full lifecycle) ·
   `/wh change` · `/wh fix` · `/wh verify`
3. For existing services, check the detected `CHANGE_MODE: existing-change` and the
   integration overlay
4. Skills below are invoked **by `/wh`**, not directly — calling one skips the lane banner
   and its gates
6. For Figma/reference images, visual regression, and theme/viewport checks,
   `VISUAL_QA_MODE` (via `/wh verify`) adds contracts and approved baselines

## Path rules

- `.claude/` is the canonical control plane — and since 2026-08-18, the **only** copy
  (the former `.agents/`/`.codex/` tool mirrors were removed after an audit found zero
  consumers).
- Add new skills/agents to `.claude` and pass `validate-harness.mjs`.
- When editing a skill document, bump `metadata.version` in its SKILL.md frontmatter and
  leave a one-line `changelog` (`metadata.version` is a validator-required field).

## Per-project configuration

An existing project's package manager, app root, aliases, UI library, API client,
auth/service context, MSW activation, and OpenAPI generator are recorded from detection
results into `_workspace/02_design/integration-overlay.json`. Unclear items are confirmed
with at most 3 questions at a time; existing public contracts are never replaced by guesses.
