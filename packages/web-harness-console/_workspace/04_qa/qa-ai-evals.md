# AI Evaluation QA — Codex Run Bridge

## Result

PASS

- Static AI ladder passed baseline→foundation→routing→services→policy→eval-contracts with 31 valid scenarios.
- Project tests cover connected/missing auth, prompt/argv policy, idempotency, approval transition, active conflict and interrupted recovery.
- Review tests cover exact apply binding, required reason, idempotent replay, one decision/apply, review-before-reapply, terminal block and revision feedback prompt binding.
- Real model behavior was not used as deterministic acceptance evidence; the user-triggered live run remains an operational smoke step.

## Round 11 — Candidate workflow

- deterministic tests cover isolated executor cwd, pre-review canonical immutability, server-owned changed paths, stale baseline rejection, single promotion, rollback, revision no-promotion, traversal and symlink rejection.
- root static AI ladder and 42 repository eval scenario contracts passed through `eval-contracts`; the Console candidate path added no provider/model routing change.
- no live model run was started for QA, so provider token, latency and actual candidate quality remain `NOT_MEASURED`.

## 2026-08-07 — Scenario count reconciliation

- Round 11의 "42 repository eval scenario contracts"는 `.claude/evals/scenarios.json`(harness 전반 eval 시나리오, 42개 항목)을 센 수치였다. `test-ai-harness.mjs --through eval-contracts`의 eval 단계(`run-ai-evals.mjs --validate`)가 검증하는 대상은 `.claude/evals/ai-scenarios.json`의 AI eval scenario contract이며, 2026-08-07 재확인에서 `AI eval contracts are valid (31 scenarios).`를 출력했다.
- 따라서 eval-contracts 단계 기준의 올바른 수치는 31이고, change-scope Rounds 8~15와 qa-api-contract의 31이 정확하다. 42를 eval-contracts 통과 주장에 결합한 것은 서로 다른 파일을 센 수치의 혼동이었다. 원문은 append-only 원칙에 따라 보존한다.
