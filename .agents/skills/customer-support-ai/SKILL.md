---
name: customer-support-ai
description: Designs and builds AI customer support for agent-assist, grounded chat, CRM and ticket tools, approved transactions, human handoff, and optional realtime voice with PII, retention, replay, and conversation-quality controls.
argument-hint: "[support channels, policies, and integrations]"
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Write, Edit, Bash, Agent, AskUserQuestion
metadata:
  version: 1.1.0
  maturity: eval-covered
  updated: 2026-08-03
  changelog: implementation-contract 추가 — 운영 구현 결정(P1-7 브랜치 심화).
  status: experimental
---

# Customer Support AI

상담원 보조에서 시작해 저위험 자동화, 승인된 transaction, 음성 순으로 autonomy를 높인다.

항상 `../ai-app-orchestrator/references/production-contract.md`와 `references/support-contract.md`를 읽는다. 구현 결정은 `references/implementation-contract.md`를 따른다.

## Mode

- 기본: `AI_MODE`, `RAG_MODE`
- CRM·ticket·transaction: `TOOL_AGENT_MODE`
- 음성·전화: `REALTIME_VOICE_MODE`

## Workflow

1. channel, auth, PII, 정책, handoff SLO를 intake한다.
2. `/ai-app-orchestrator` 설계 gate를 완료한다.
3. `customer-support-agent-builder`가 conversation과 adapter를 구현한다.
4. transaction이 있으면 `human-approval-builder`를 실행한다.
5. multi-turn replay 후 `ai-eval-runner`, `data-access-verifier`, `ai-security-reviewer`를 실행한다.

## Hard Stops

- 사람이 연결될 수 없음
- 인증 전 개인정보·주문 action 허용
- 금전·계정 action에 approval·idempotency 없음
- transcript·audio 보존 정책 없음

## 완료 조건

- 상담원 이관 시 transcript, summary, intent, auth, tool result가 유지된다.
- 잘못된 transaction과 duplicate side effect가 0이다.
- PII masking, replay, policy violation fixture가 통과한다.
- 음성은 interruption과 disconnect 복구를 검증한다.
