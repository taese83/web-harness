---
name: enterprise-search-ai
description: Designs and builds ACL-aware enterprise document search and RAG with connectors, ingestion, hybrid retrieval, reranking, citations, freshness, deletion propagation, no-answer behavior, and retrieval-quality evaluations.
argument-hint: "[document sources, users, and access model]"
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Write, Edit, Bash, Agent, AskUserQuestion
metadata:
  version: 1.1.0
  maturity: eval-covered
  updated: 2026-08-03
  changelog: implementation-contract 추가 — 운영 구현 결정(P1-7 브랜치 심화).
  status: experimental
---

# Enterprise Search AI

문서 ACL을 보존하는 ingestion과 query-time filtering을 먼저 만들고 grounded answer를 추가한다.

항상 `../ai-app-orchestrator/references/production-contract.md`와 `references/retrieval-contract.md`를 읽는다. 구현 결정은 `references/implementation-contract.md`를 따른다.

## Mode

`AI_MODE`와 `RAG_MODE`를 활성화한다. 문서로부터 action까지 수행하면 `TOOL_AGENT_MODE`도 활성화한다.

## Workflow

1. source, owner, ACL, freshness, deletion SLA를 intake한다.
2. `/ai-app-orchestrator` 설계 gate를 완료한다.
3. `developer`가 connector·index·retrieval을 구현한다.
4. UI에 citation, source date, no-answer, feedback을 표시한다.
5. `data-access-verifier`와 `ai-eval-runner`가 ACL·retrieval·grounding을 검증한다.

## Hard Stops

- 문서 ACL을 ingestion에서 보존하지 않음
- 생성 후 answer filtering만 사용
- 삭제·권한 변경 전파 정책 없음
- source 없는 답변을 사실처럼 표시

## 완료 조건

- cross-user·cross-tenant leak이 0이다.
- hybrid retrieval과 metadata filtering이 있다.
- citation correctness와 no-answer precision을 측정한다.
- stale·deleted·malicious document fixture가 통과한다.
