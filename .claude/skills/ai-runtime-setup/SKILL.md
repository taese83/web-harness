---
name: ai-runtime-setup
description: Scaffolds the trusted server-side foundation for AI web applications. Use when adding a model gateway, agent sessions, typed tools, approvals, streaming, provider abstraction, budgets, traces, queues, or a migration path from mock AI to real providers.
argument-hint: "[runtime requirements or project path]"
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Write, Edit, Bash, Agent, AskUserQuestion
metadata:
  version: 1.0.0
  maturity: eval-covered
  updated: 2026-07-27
  changelog: 최초 버저닝 — adapter 재생성·검증 체계 도입과 함께 일괄 부여.
---

# AI Runtime Setup

`../ai-app-orchestrator`의 설계 산출물을 구현 가능한 server runtime으로 변환한다.

항상 `references/runtime-contract.md`와 `../ai-app-orchestrator/references/production-contract.md`를 읽는다.

## 선행 조건

- `ai-architecture.md`
- `tool-contracts.md`
- `ai-threat-model.md`
- `cost-latency-budget.md`

없으면 구현하지 않고 `BLOCKED`를 반환한다.

## 순서

1. `agent-runtime-scaffolder` — session, workflow, cancel, resume
2. `model-gateway-builder` — provider adapter, model routing, server secret
3. `tool-adapter-builder` — typed tool registry와 downstream auth
4. `human-approval-builder` — side effect가 있으면 approval state와 UI
5. `ai-observability-builder` — trace, token·cost·latency, redaction
6. 서비스 builder — 공통 runtime 위에만 구현

## 금지

- web app에서 provider 직접 호출
- provider SDK type을 domain package 밖으로 노출
- arbitrary tool, raw shell, unrestricted SQL
- retry 때 side effect 중복 실행
- request memory에만 approval 상태 보관

## 완료 조건

- mock provider와 real provider가 같은 internal interface를 구현한다.
- streaming event가 provider-neutral schema로 변환된다.
- request별 budget과 cancellation이 적용된다.
- read tool과 approval-required write tool fixture가 있다.
- trace에서 prompt 원문 수집이 기본 비활성화된다.
