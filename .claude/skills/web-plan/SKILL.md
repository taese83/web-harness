---
name: web-plan
description: [내부] `/wh plan` 레인에서 /wh가 호출한다(Phase 1만 돌고 plan-reviewer readiness에서 멈춘다 — Phase 1 → 2 승인 체크포인트는 `/wh new`가 돈다). 사용자 진입점은 /wh 하나다 — 직접 호출하면 레인 표시와 게이트 안내를 받지 못한다. Runs only Phase 1 (Planning) of the web-harness independently with product-first intake, UX risk review, data strategy, effort trade-offs, and readiness validation before design or implementation.
argument-hint: "[service description]"
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Write, Edit, Bash, Agent
metadata:
  version: 1.3.0
  maturity: eval-covered
  updated: 2026-09-11
---

# Web Plan

기획 단계만 독립적으로 실행한다. 구현 없이 제품 맥락, 요구사항, UX, 기능 계획, 기술 스택과 준비도 판정을 산출한다.

먼저 `references/planning-facilitation-contract.md`, `references/planning-readiness-contract.md`, `../web-orchestrator/references/interaction-contract.md`, `../web-orchestrator/references/execution-contract.md`를 읽는다. crawling, file import, scheduled sync 또는 build-generated runtime data가 있으면 `../web-orchestrator/references/external-data-ingestion.md`도 읽는다.

## 실행

`/web-plan {서비스 설명}`을 입력하면:

0. **공급 취합 — 계획보다 먼저.** 요청에 기획 문서·링크가 붙어 있으면 `source-artifact-ingestor`로
   `_workspace/00_source/`에 원문을 보존한다(`/wh new`의 0-A와 같은 규칙 — 정본
   `../web-orchestrator/references/provenance-contract.md` §6). 기획 **티켓 키**가 붙어 있으면 티켓마다
   `node .claude/scripts/ticket/cli.mjs intake <키> --repo <o/r>`로 격리 스냅샷과 인벤토리 행을 만든다(기존
   입구 — 트래커 설정이 없으면 그 안내를 그대로 보여준다). 기획 티켓은 **출처**다 — 개발 작업으로 청구하지
   않고, 계획 요청만으로 개발 티켓을 발행하지 않는다. 이 단계를 건너뛰면 사용자가 준 자료가 계획에 닿지 않는다.
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

산출물 검토 후 **`/wh new`**(플러그인 설치면 `/web-harness:wh new`)로 이어서 실행한다 — 이미 `_workspace/01_plan/` 산출물이 있으면
그것을 감지해 Phase 2 또는 Phase 3부터 잇는다. 그때 기획 공급원은 **`generated`**(하네스가 만든 것)이며
Phase 1을 다시 돌지 않는다.
