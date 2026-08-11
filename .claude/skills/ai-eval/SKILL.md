---
name: ai-eval
description: Designs and runs staged evaluations for AI web applications and agents. Use for golden datasets, adversarial scenarios, retrieval and tool-call grading, trace assertions, prompt-injection tests, ACL checks, cost and latency gates, release thresholds, or regression testing after model, prompt, tool, or workflow changes.
argument-hint: "[service, scenario, or result path]"
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Write, Edit, Bash, Agent
metadata:
  version: 1.1.0
  maturity: eval-covered
  updated: 2026-07-27
  changelog: runtime eval executor 파이프라인(run-eval-executor.mjs) 연결 — 시나리오 실행·채점·검증 자동화.
---

# AI Eval

정적 계약, 실행 trace, 품질 grader를 단계적으로 검증한다.

항상 `references/eval-ladder.md`를 읽는다. scenario catalog JSON 전체를 context에 로드하지 않고 `run-ai-evals.mjs --list`, `--service`, `--stage`, `--scenario`로 필요한 계약만 조회한다. catalog 자체를 편집할 때만 `../../evals/ai-scenarios.json`을 읽는다.

## 순서

1. `node .claude/scripts/test-ai-harness.mjs --stage baseline`
2. `node .claude/scripts/test-ai-harness.mjs --through eval-contracts`
3. `node .claude/scripts/run-ai-evals.mjs --list`
4. 선택 scenario 실행 — 기본은 executor 파이프라인:
   `node .claude/scripts/run-eval-executor.mjs --scenario <id> --dry-run`으로 비용 확인 후 `--full`
   (격리 fixture 배포 → headless 실행 → read-only grader 채점 → 기계 evidence 검증까지 자동).
   수동 실행이 필요하면 `../../evals/README.md`의 수동 절차를 따른다.
5. 자동 파이프라인이 result JSON 작성과 `--verify-result` 검증을 수행 — 수동 실행 시에만 직접 작성 후
   `node .claude/scripts/run-ai-evals.mjs --verify-result <file>`
6. 서비스 전체 결과를 모은 뒤 release threshold 판정

## Verifier

- `ai-eval-runner` → `qa-ai-evals.md`
- `ai-security-reviewer` → `qa-ai-security.md`
- `data-access-verifier` → `qa-data-access.md`
- `cost-latency-verifier` → `qa-ai-cost-latency.md`
- `agent-trace-verifier` → `qa-agent-traces.md`

Verifier는 source, test, fixture, snapshot을 수정하지 않는다.

## Release Gate

- critical assertion은 모두 PASS
- FAIL을 BLOCKED로 바꿔 우회하지 않음
- PASS assertion마다 재현 가능한 evidence 존재
- model·prompt·workflow·tool version 기록
- ACL leak, approval bypass, unauthorized side effect는 0

## 완료 조건

- 정적 harness 검증과 runtime scenario 결과를 구분한다.
- 정상·실패·공격 fixture가 모두 있다.
- 변경 전 baseline과 변경 후 결과를 비교한다.
- threshold 미달이면 owner agent와 재현 절차를 기록한다.
