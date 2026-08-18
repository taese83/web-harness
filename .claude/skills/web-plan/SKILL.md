---
name: web-plan
description: Runs only Phase 1 (Planning) of the web-harness independently with product-first intake, UX risk review, data strategy, effort trade-offs, and readiness validation before design or implementation.
argument-hint: "[service description]"
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Write, Edit, Bash, Agent
metadata:
  version: 1.1.0
  maturity: eval-covered
  updated: 2026-08-06
  changelog: ASSUMPTION 관용구를 시안 확정(발산 조사가 커밋한 단일 시안 승인)으로 교체 — design-readiness-contract.
---

# Web Plan

기획 단계만 독립적으로 실행한다. 구현 없이 제품 맥락, 요구사항, UX, 기능 계획, 기술 스택과 준비도 판정을 산출한다.

먼저 `references/planning-facilitation-contract.md`, `references/planning-readiness-contract.md`, `../web-orchestrator/references/interaction-contract.md`, `../web-orchestrator/references/execution-contract.md`를 읽는다. crawling, file import, scheduled sync 또는 build-generated runtime data가 있으면 `../web-orchestrator/references/external-data-ingestion.md`도 읽는다.

## 실행

`/web-plan {서비스 설명}`을 입력하면:

1. `_workspace/01_plan/`을 만들고 `planning-facilitator`가 제품 중심 intake와 기존 근거를 `_workspace/01_plan/planning-context.md`, `decision-log.md`에 정리한다.
2. 제품 맥락 뒤 external ingestion을 의미 기반으로 판별한다. 해당하면 `EXTERNAL_DATA_INGESTION_MODE: true`를 고정하고 source 권한, authoritative source, `static-snapshot|live-api|hybrid`, cadence, freshness, count·coverage, promotion rejection, serving fallback, root/provider cwd를 planning agent 입력에 포함한다. source 권한 또는 authoritative source가 없으면 `BLOCKER`로 남긴다.
3. `requirements-analyst` → `requirements.md`
4. `ux-researcher` → `ux-brief.md`
5. `feature-planner` → `feature-plan.md`. UX 결정과 requirement를 모두 입력으로 사용한다.
6. `tech-advisor` → `tech-stack.md`. 제품·기능·데이터 전략을 입력으로 사용한다.
7. `planning-synthesizer` → `project-brief.md`
8. read-only `plan-reviewer` 본문을 `plan-review.md`로 저장한다. L/XL·권한·destructive·realtime은 심화 검토하고, 모든 요청에 readiness gate를 적용한다.
9. `PASS | NEEDS_DECISION | BLOCKED`와 최대 3개 우선 결정을 함께 출력한다. `BLOCKED`면 Phase 2로 넘기지 않는다.

external ingestion이면 requirements, tech-stack, project-brief 세 파일 모두 현재 mode와 `EXTERNAL_DATA_INGESTION_MODE: true`를 포함해야 한다. planning-only 단계에서는 crawler, runtime artifact, prototype source를 만들거나 commit/push/PR을 수행하지 않는다.

Claude Code의 Task 도구가 있으면 각 이름을 `subagent_type`으로 호출한다. Task 도구가 없으면 현재 에이전트가 같은 출력 파일 계약을 지키며 직접 작성한다.

산출물 검토 후 `/web-orchestrator`의 Phase 2부터 이어서 실행 가능하다.
이미 `_workspace/01_plan/` 산출물이 존재하면 `/web-orchestrator`는 같은 진입점에서 이를 감지해 Phase 2 또는 Phase 3으로 이어서 실행한다.
