---
name: browser-agent
description: Designs and builds constrained browser agents with domain and action allowlists, planner-executor separation, Playwright or accessibility tools, visual fallback, isolated sessions, approval gates, evidence, replay, and prompt-injection tests.
argument-hint: "[allowed sites, tasks, and risk policy]"
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Write, Edit, Bash, Agent, AskUserQuestion
metadata:
  version: 1.1.0
  maturity: eval-covered
  updated: 2026-08-03
  changelog: implementation-contract 추가 — 운영 구현 결정(P1-7 브랜치 심화).
  status: experimental
---

# Browser Agent

범용 browser 권한을 주지 않고 허용 도메인·작업·action이 명시된 workflow를 만든다. `browser-verifier`와 달리 제품 runtime을 구현하는 skill이다.

항상 `../ai-app-orchestrator/references/production-contract.md`와 `references/browser-safety-contract.md`를 읽는다. 구현 결정은 `references/implementation-contract.md`를 따른다.

## Mode

`AI_MODE`, `TOOL_AGENT_MODE`, `BROWSER_AGENT_MODE`를 활성화한다.

## Workflow

1. domain, origin, read·write action, credential, 성공 조건을 intake한다.
2. `/ai-app-orchestrator` 설계 gate를 완료한다.
3. 공식 API가 있으면 browser보다 먼저 선택한다.
4. `browser-agent-builder`가 planner, policy, executor, verifier, replay를 구현한다.
5. `human-approval-builder`가 submit·send·purchase·delete·publish를 보호한다.
6. `ai-security-reviewer`와 `agent-trace-verifier`가 공격 fixture와 replay를 검증한다.

## Hard Stops

- unrestricted navigation, shell, filesystem, arbitrary script
- shared production browser profile
- page content를 system instruction으로 취급
- high-impact action의 preview·approval 없음
- replay evidence 없음

## 완료 조건

- domain escape, approval bypass, secret leak이 0이다.
- session이 격리되고 종료 시 credential이 정리된다.
- DOM·accessibility tool을 우선하고 vision은 fallback이다.
- UI 변경, popup, stale element, injection fixture가 통과한다.
