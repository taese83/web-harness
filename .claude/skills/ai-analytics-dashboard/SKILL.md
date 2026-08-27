---
name: ai-analytics-dashboard
description: Builds AI-assisted high-volume analytics dashboards with governed metrics, semantic queries, query safety, chart specifications, grounded insights, historical ranges, and realtime time-series data. Use for Grafana-like AI analytics or natural-language metric exploration.
argument-hint: "[analytics, metric, and timeseries requirements]"
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Write, Edit, Bash, Agent, AskUserQuestion
metadata:
  version: 1.1.0
  maturity: eval-covered
  updated: 2026-08-03
  changelog: implementation-contract 추가 — 운영 구현 결정(P1-7 브랜치 심화).
  status: experimental
---

# AI Analytics Dashboard

LLM을 data plane이 아니라 metric·query·insight control plane으로 사용한다.

항상 `../ai-app-orchestrator/references/production-contract.md`와 `references/analytics-contract.md`를 읽는다. 구현 결정은 `references/implementation-contract.md`를 따른다. 시계열이면 `/timeseries-dashboard` 계약을 함께 적용한다.

## Mode

`AI_MODE`, `TOOL_AGENT_MODE`, `ANALYTICS_AGENT_MODE`를 활성화한다. 날짜별 series, historical, realtime, high-volume chart가 있으면 `TIMESERIES_MODE`도 활성화한다.

## Workflow

1. certified metric, dimension, tenant policy, query budget을 intake한다.
2. `/ai-app-orchestrator`와 `timeseries-architect` 설계를 완료한다.
3. `developer`가 semantic query와 insight 계층을 구현한다.
4. 기존 `realtime-data-builder`가 snapshot·stream data plane을 구현한다.
5. `data-access-verifier`, `cost-latency-verifier`, `ai-eval-runner`를 실행한다.

## Hard Stops

- 모델 생성 raw SQL을 직접 실행
- raw warehouse에 write credential 제공
- tenant·row filter를 모델이 생성
- 존재하지 않는 metric을 임의 생성
- scan, row, time, cost 상한 없음

## 완료 조건

- certified metric만 query한다.
- semantic query AST를 policy gate가 검증한다.
- historical·live chart 계약과 insight provenance가 연결된다.
- access, query budget, chart correctness fixture가 통과한다.
