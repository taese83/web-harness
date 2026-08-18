# Contributing

This repository is a control plane that validates itself. Contributions are welcome, but the
bar is unusual: **claims require receipts**, and several things that are conventions elsewhere
are machine-enforced here.

## Toolchain (exact, not approximate)

- Node **22.22.3** (`.nvmrc` / `.node-version`; engine floor ≥22.22.0)
- pnpm **exactly 11.18.0**, installed directly: `npm install -g pnpm@11.18.0`
  — **corepack shims are rejected** by the toolchain validator
- Verify with `node .claude/scripts/validate-toolchain.mjs` — its failure messages are
  actionable; read them before asking

## The one command that matters

```bash
pnpm run ci
```

Green means: mirror drift, toolchain, console checks/tests, gate regression suites
(`node --test`), 58 harness validators, AI-harness contract stages, and the plugin build.
**Do not commit on red.** If a gate blocks you, the default assumption is that your change —
not the gate — is wrong (invariant I2). Fix the modeling; never weaken the check to pass.

## Things this repo enforces that others don't

- **`JUDGMENT:` commit blocks.** Substantive changes (contracts, gates/validators, new
  skills/agents, tier labels) must run the read-only `harness-change-reviewer` agent first
  and record 1–3 lines of judgment evidence in the commit body. See `CLAUDE.md` and
  `docs/protected-core.md` §2 for the per-class questions.
- **Mirrors are generated, never edited.** `.agents/` and `.codex/` come from
  `node .claude/scripts/build-adapters.mjs`. Edit `.claude/` only, regenerate, and the
  byte-drift validator keeps you honest.
- **Markers are language-neutral anchors.** Machine-matched contract markers use
  `<!-- marker:... -->` anchors (see `docs/marker-delock-plan.md`). Prose may be translated
  freely; deleting an anchor fails CI (`validate-marker-integrity`).
- **Labels cost evidence.** `supportLevel: certified` requires a golden project with an
  isolated-CI receipt (`validate-certified-evidence`). Editing the label without the
  evidence fails CI — by design.
- **The Bash policy hook is strict.** In-session shell commands here block pipes to
  arbitrary sinks, redirects, `find`, unquoted globs, and raw `git` for subagents. This is
  the repo's own runaway/safety policy (`enforce-global-bash-policy.mjs`), not a bug in
  your terminal. Use the typed runner scripts (`run-git-inspection.mjs` etc.) where provided.

## Working with AI sessions (hard-won)

- **One writing session per checkout.** Two parallel sessions committing from the same
  working tree will sweep each other's uncommitted changes into unrelated commits (this
  happened; the repair is recorded in commit history). Use `git worktree` for parallel work.
- Stage explicit paths (`git add <files>`), not `git add -A`, when any other session might
  be active.

## Honesty registry

Known proxy gates and their measured limits live in `docs/protected-core.md` §4. If you
discover a bypass, registering it there is part of the fix — silence is the only wrong move.

## License

MIT — see [LICENSE](LICENSE). By contributing, you agree your contributions are licensed
under the same terms.
