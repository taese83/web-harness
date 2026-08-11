---
name: ai-app-orchestrator
description: Orchestrates production-oriented AI web applications and runtime agents. Use for RAG, enterprise search, model tool use, code-review bots, customer-support agents, AI analytics, browser agents, realtime voice, MCP integrations, or any web product whose output or action depends on a model.
argument-hint: "[AI service requirements or existing project path]"
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Write, Edit, Bash, Agent, AskUserQuestion
metadata:
  version: 1.1.0
  maturity: eval-covered
  updated: 2026-08-04
  changelog: 실행 예산 배선 — ① execution-budget-contract.md를 선행 로드 대상에 추가(그간 AI 오케스트레이터만 이 계약을 참조하지 않아 빌더 스폰이 무예산으로 돌던 근본 원인 해소) ② Phase C/D 구현 스폰마다 스폰 완결성 게이트 적용(완결성 마커·verify-spawn-completion.mjs·runaway 임계, 깨진 산출물 위 진행 금지) ③ 스폰별 usage를 execution-telemetry.json에 기록.
---

# AI App Orchestrator

AI 기능을 일반 웹 UI가 아니라 운영 가능한 server-side agent system으로 설계·구현·검증한다.

항상 `../../ai-harness.json`, `references/detection-contract.md`, `references/production-contract.md`를 읽는다. Runtime 구현 전 `../ai-runtime-setup/references/runtime-contract.md`, QA 전 `../ai-eval/references/eval-ladder.md`를 읽는다. RAG/browser/support 등 외부 콘텐츠를 읽는 경로가 있으면 `../web-orchestrator/references/untrusted-content-quarantine.md`의 읽기/행동 분리를 runtime 설계와 tool 권한에 적용한다.

실행 예산·telemetry·스폰 완결성은 `../web-orchestrator/references/execution-budget-contract.md`를 첫 스폰 전에 읽는다. 스폰이 끝날 때마다 결과 usage를 `_workspace/04_qa/execution-telemetry.json`에 기록하고(미제공 환경이면 `null`, 지어내지 않는다), **구현/빌더 계열 스폰마다 다음 의존 단계로 진행하기 전에 스폰 완결성 게이트**(완결성 마커 확인 · owned 경로에 `verify-spawn-completion.mjs` 실행 · runaway 임계 점검)를 통과시킨다. 게이트 실패 산출물 위에 다음 단계를 쌓지 않는다.

## Mode 판별

`detection-contract.md`를 단일 판별 기준으로 사용한다. `AI_MODE`가 활성화되면 적용되는 submode를 모두 기록한다.

- `RAG_MODE`
- `TOOL_AGENT_MODE`
- `CODE_REVIEW_AGENT_MODE`
- `REALTIME_VOICE_MODE`
- `ANALYTICS_AGENT_MODE`
- `BROWSER_AGENT_MODE`

모호하면 데이터 접근 범위, side effect, 사람 승인 여부만 한 번 확인한다. provider 선택은 architecture 단계로 미룬다.

## Intake

1. 핵심 사용자 작업과 실패 비용
2. 읽기·쓰기 데이터와 authoritative system
3. 허용 도구, 금지 행동, 사용자·tenant 권한
4. autonomy level L0~L4와 승인 지점
5. latency, 품질, token·비용 budget
6. 개인정보, 보존, 삭제, 감사 요구
7. 정상·실패·공격 시나리오
8. Mock 범위와 실제 연결 대상

모르는 값은 `ASSUMPTION`으로 기록한다. identity, tenant, write action, 규제 데이터가 불명확하면 `BLOCKER`다.

## Phase A — AI 계획

순차 실행:

1. `ai-requirements-analyst`
   - `_workspace/01_plan/ai-requirements.md`
   - `_workspace/01_plan/autonomy-risk-matrix.md`
2. 기존 일반 Plan agent를 필요한 범위에서 실행한다.

## Phase B — AI 설계 Gate

`ai-requirements.md` 완료 후 다음을 병렬 실행한다.

- `ai-solution-architect` → `_workspace/02_design/ai-architecture.md`, `_workspace/02_design/cost-latency-budget.md`
- `data-governance-architect` → `_workspace/02_design/data-governance.md`
- `tool-contract-designer` → `_workspace/02_design/tool-contracts.md`
- `ai-threat-modeler` → `_workspace/02_design/ai-threat-model.md`
- `ai-eval-designer` → `_workspace/02_design/eval-plan.md`

여섯 설계 산출물이 모두 완료되기 전 runtime 구현을 시작하지 않는다.

## Phase C — 공통 Runtime

`/ai-runtime-setup`을 실행해 다음 owner를 순서대로 사용한다.

1. `agent-runtime-scaffolder`
2. `model-gateway-builder`
3. `tool-adapter-builder`
4. `human-approval-builder` — write·high-impact tool이 있을 때
5. `ai-observability-builder`

브라우저에 provider secret을 두거나 모델이 인증·tenant를 결정하게 만들지 않는다.

각 builder 스폰 직후 execution-budget-contract의 **스폰 완결성 게이트**를 적용한 뒤 다음 builder로 넘어간다: 반환의 완결성 마커(`SPAWN_RESULT: complete`) 확인 → 해당 builder의 owned 경로(`agent-registry.mjs`가 강제하는 prefix)에 `node .claude/scripts/verify-spawn-completion.mjs --root {project} --paths {prefix}` 실행 → runaway 임계 점검. 게이트 실패면 완료로 처리하지 않고 re-spawn(retry 예산) 또는 `NEEDS_DECISION` — 깨졌거나 불완전한 runtime 위에 후속 builder를 쌓지 않는다.

## Phase D — 서비스 Branch

- 코드리뷰 → `/ai-code-review-bot`
- 사내 문서 검색 → `/enterprise-search-ai`
- 고객센터 → `/customer-support-ai`
- AI 대시보드 → `/ai-analytics-dashboard`
- 브라우저 자동화 → `/browser-agent`

여러 branch가 필요하면 공통 runtime을 한 번만 만들고 typed contract를 공유한다.

## Phase E — AI QA Gate

`/ai-eval`을 실행한다.

- `ai-eval-runner`
- `ai-security-reviewer`
- `data-access-verifier`
- `cost-latency-verifier`
- `agent-trace-verifier`

Verifier는 source를 수정하지 않고 보고서 본문만 반환한다. 오케스트레이터가 `_workspace/04_qa`에 저장한다.

## Hard Stops

- server-side model gateway와 secret boundary가 없음
- tool schema, scope, timeout, audit가 없음
- side effect tool에 approval·idempotency 계약이 없음
- tenant·ACL이 모델 출력에 의존함
- critical adversarial scenario와 release threshold가 없음
- unbounded turn, tool call, context, cost 또는 wall-clock 실행

## 완료 조건

- manifest의 `AI_MODE.requiredArtifacts`가 모두 존재한다.
- Mock과 실제 provider·tool adapter가 같은 내부 contract를 사용한다.
- 모든 tool call은 downstream authorization을 거친다.
- critical eval, data-access, security, cost, trace 보고서가 PASS다.
- HANDOFF에 provider·data source·tool·secret·rollback 전환 가이드가 있다.
