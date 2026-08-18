# workspace/ — project workspace

Projects the harness creates or works on live here. **Everything except this README is
excluded from version control** (`.gitignore`: `workspace/*`) — each project here is
versioned in its own repository (GitHub etc.).

## Two usage modes

### 1. Create/work from a harness session (default)

Keep the session's working directory at the **web-harness root** and run skills from there.
The root `.claude` control plane (skills/agents/hooks) stays loaded; only the artifacts land
in this folder.

```text
/web-orchestrator An admin web service for viewing and updating orders. Location: workspace/order-admin
```

### 2. Deploy the harness into an existing GitHub project

Clone into this folder, deploy the control plane into the project, then open the session
**inside the project directory**:

```bash
git clone <repo-url> workspace/my-service
node .claude/scripts/deploy-harness.mjs --target workspace/my-service
cd workspace/my-service   # sessions run here from now on — the deployed .claude loads
```

Note: post-deploy target re-validation enforces the toolchain pins (Node/pnpm) — projects
with different pins are refused, so align them first. (The deployer only accepts targets
inside this repository — that is why the clone goes under `workspace/`. For projects that
must stay where they are, use the Claude Code plugin instead.)

## Rules

- Distinct from `_workspace/` (the planning/design/QA artifact directory the harness creates
  *inside* each project) — note the underscore.
- New apps go under `workspace/<name>` — never directly at the repo root.
- Commit/push cloned projects against their own repositories (nothing lands in web-harness).
- Eval run artifacts go to `eval-runs/`, not here (managed by `run-eval-executor.mjs`).
