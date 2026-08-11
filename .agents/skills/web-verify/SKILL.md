---
name: web-verify
description: Runs only Phase 4 (QA) of the web-harness independently. Use to re-run quality checks on an existing project without rebuilding from scratch.
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Write, Edit, Bash, Agent
argument-hint: "[검증 대상 프로젝트 경로 (선택)]"
metadata:
  version: 1.0.0
  maturity: eval-covered
  updated: 2026-07-27
  changelog: 최초 버저닝 — adapter 재생성·검증 체계 도입과 함께 일괄 부여.
---

# Web Verify

검증 단계만 독립적으로 실행한다. 이미 구현된 프로젝트의 코드/UX/통합을 검사한다.

Read `../web-orchestrator/references/execution-contract.md` and `../web-orchestrator/references/qa-evidence-contract.md` before QA. Read `../web-orchestrator/references/minimal-change-contract.md` and `../web-orchestrator/references/retry-policy.md` before recommending retries.
`_workspace/02_design/visual-qa-contract.json`이 있으면 `../visual-design-verify/SKILL.md`와 세 reference를 읽고 `VISUAL_QA_MODE`를 유지한다.

Apply the QA Immutability Contract: verifier agents do not modify source/test/config files. They return report content, and the orchestrator persists it before routing fixes to owner agents.

## 실행

`/web-verify`를 입력하면 먼저 검증 대상 프로젝트 경로를 확인한다. 현재 디렉토리에 `package.json`이 없으면:

> 검증할 프로젝트 경로를 알려주세요. (예: `my-app/client`)

경로가 확인되면:

1. source를 수정하기 전에 built-in profile을 다시 잠근다. 기존 profile이 있으면 provider, deployment target과 capabilities를 그대로 전달하고, 없으면 `--requested auto`로 검출한다. resolver가 crawler/package script/scheduled workflow/generated-data marker를 찾았는데 ingestion 계약이 없거나 `external-ingestion` capability가 잠기지 않으면 즉시 `BLOCKED`다. 이 preflight 전에는 test/config 파일도 만들지 않는다.
2. 테스트 기반을 준비한다:
   - test-scaffolder
   - test-writer
   - `VISUAL_QA_MODE`이면 visual-test-writer. baseline은 갱신하지 않는다.
3. resolver stdout을 canonical `project-profile.json`에 저장하고 `_workspace/03_dev/web-execution-plan.json`을 다시 컴파일한다. package/toolchain drift, incompatible router/runtime, adapter hash 또는 plan binding 오류는 `BLOCKED`다.
4. 로컬 진단이면 오케스트레이터가 사용자 승인을 받은 뒤 `node .claude/scripts/run-quality-gates.mjs --all --allow-host-execution`을 실행한다. release 후보 증거는 격리 CI에서 승인 flag 없이 `WEB_HARNESS_ISOLATED_EXECUTION=1 node .claude/scripts/run-quality-gates.mjs --all`로 다시 생성한다. `external-ingestion` capability에서는 `ingestion` receipt가 같은 cohort에 포함되지 않으면 `BLOCKED`다. 로컬 receipt는 진단 전용이며 release attestation의 subject가 될 수 없다. non-zero여도 다음 verifier 보고서를 생략하지 않는다.
5. 독립 QA 에이전트 실행 (병렬 가능):
   - code-reviewer
   - ux-validator
   - integration-verifier
   - security-reviewer
   - api-contract-verifier
   - `_workspace/02_design/analytics-architecture.md`가 있으면 analytics-verifier
   - `_workspace/02_design/state-contract.md`가 있으면 state-invariant-verifier
   - locked profile에 `external-ingestion` capability가 있으면 data-quality-verifier
   - `_workspace/02_design/timeseries-architecture.md`가 있으면 timeseries-verifier
   - `_workspace/02_design/seo-spec.md`가 있으면 seo-verifier
   - `_workspace/02_design/performance-budget.md`가 있으면 performance-verifier
   - test-executor
   - browser-verifier
   - `VISUAL_QA_MODE`이면 visual-regression-verifier
<!-- repo-only:start -->
6. `_workspace/01_plan/ai-requirements.md` 또는 `_workspace/02_design/ai-architecture.md`가 있으면 AI 정적 gate를 순서대로 실행:
   - `node .claude/scripts/test-ai-harness.mjs --through eval-contracts`
<!-- repo-only:end -->
7. AI project이면 read-only AI verifier 실행:
   - ai-eval-runner
   - ai-security-reviewer
   - data-access-verifier
   - cost-latency-verifier
   - agent-trace-verifier
8. release 후보이면 격리 CI receipt가 완성된 뒤 checkout 밖에서 보호된 trust-config digest와 repository/revision/workflow/issuer/run identity를 주입한다. `node .claude/scripts/prepare-quality-attestation.mjs --project {project-root} --issuer-run-id <trusted-ci-run-id>`의 unsigned request를 project 밖의 trusted attester가 CI/OIDC, 격리, frozen install과 독립 대조한다. 일치할 때만 final subject를 구성·서명해 `_workspace/04_qa/evidence/quality-attestation.json`을 작성한다. private key와 보호된 context를 project child process에 전달하지 않는다.
9. locked profile이 `next-app-fullstack`이면 서명 완료 후 `node .claude/scripts/web-core/validate-next-contracts.mjs --project {project-root}`를 실행한다. 이어서 `next-contract-verifier`를 실행하고 반환 본문을 `_workspace/04_qa/qa-next-contract.md`에 저장한다. 로컬 진단, target-specific receipt·artifact digest 또는 trusted attestation이 없으면 `BLOCKED`로 남긴다.
10. `_workspace/04_qa/`에 모든 결과를 저장한 뒤 `node .claude/scripts/validate-release-gate.mjs --write-manifest`와 `node .claude/scripts/validate-release-gate.mjs`를 실행한다. source, receipt 또는 trust configuration이 서명 후 바뀌면 quality runner부터 다시 시작한다.
11. release gate exit 0일 때만 release-manager가 일반 QA와 조건부 QA 리포트를 종합해 HANDOFF를 만든다. exit 0이 아니면 `.claude/skills/web-orchestrator/references/release-tier-contract.md`에 따라 gate error를 분류해 tier(`DIAGNOSTIC_VERIFIED`/`ISOLATED_VERIFIED`/`NOT_VERIFIED`)를 판정하고, release-manager가 `_workspace/RELEASE/release-readiness.md`에 tier·근거·승급 경로를 기록한다. tier 라벨을 상향 표현으로 바꾸지 않는다.

Claude Code의 Task 도구가 있으면 각 이름을 `subagent_type`으로 호출한다. Task 도구가 없으면 현재 에이전트가 같은 출력 파일 계약을 지키며 직접 검사한다.

FAIL 항목은 아래 형식으로 출력한다:
```
❌ FAIL: qa-code.md
  원인: src/features/xxx/ui/Foo.tsx:12 — TS2345 타입 불일치
  수정 agent: component-builder (minimal-change-contract 적용)
  다음 단계: 수정 후 /web-verify를 다시 실행
```

직접 source를 수정하지 않는다. 수정은 `retry-policy.md`의 owner agent로 넘긴다.

AI critical scenario의 FAIL·BLOCKED, ACL leak, approval bypass, unauthorized side effect는 release PASS로 바꾸지 않는다.
일반 QA의 FAIL·BLOCKED·NEEDS_REVIEW와 필수 리포트 누락도 release PASS로 바꾸지 않는다.
visual contract가 있으면 `qa-visual.md`, browser `visualEvidence`, 승인 baseline manifest 중 하나라도 누락·stale이면 release PASS로 바꾸지 않는다.
analytics architecture가 있으면 `qa-analytics.md`의 FAIL·BLOCKED와 semantic/max fixture 누락도 release PASS로 바꾸지 않는다.
local domain state의 데이터 손실 가능성, invariant 위반, migration/recovery 누락도 release PASS로 바꾸지 않는다.
external ingestion의 missing/empty/schema-invalid artifact, architecture drift, production fixture fallback, atomic promotion 또는 clean-build evidence 누락도 release PASS로 바꾸지 않는다.
Markdown command 표는 machine receipt와 일치해야 하며 source가 바뀌면 quality runner부터 다시 실행한다.
