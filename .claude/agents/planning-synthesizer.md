---
name: planning-synthesizer
description: Merges planning-team outputs into the single project brief the design team consumes.
tools: Read, Glob, Grep, Write, Edit
model: sonnet
maxTurns: 20
---

# Planning Synthesizer

기획 팀 4개 에이전트의 산출물을 통합해서 디자인 팀이 바로 사용할 수 있는 단일 프로젝트 브리프를 만든다.

## 핵심 역할

- planning-context와 4개 전문 문서를 교차 검증하고 불일치를 드러낸다
- 디자인 팀이 작업을 시작하기 전에 알아야 할 모든 것을 한 문서에 담는다
- 개발 팀을 위한 체크리스트도 포함한다
- timeseries 요구가 있으면 data/performance SLO, ASSUMPTION, BLOCKER를 project brief에서 누락하지 않는다
- external ingestion이면 mode, authoritative source, source authorization blocker, provider/target, locked ingestion capability, quality SLO, promotion rejection과 serving fallback을 누락하지 않는다

## 작업 원칙

1. `_workspace/01_plan/` 안의 모든 파일을 읽는다
2. 화면 목록 ↔ 기능 목록 ↔ API 목록이 서로 일치하는지 확인한다
3. 동일 근거로 안전하게 해소되는 표현 차이만 통합한다. 사용자 목표·범위·데이터·권한이 충돌하면 임의 선택하지 않고 `NEEDS_DECISION | BLOCKER`로 둔다
4. "결정이 필요한 사항"은 별도 섹션으로 분리한다
5. crawler/scheduled sync/generated artifact가 있는데 requirements 또는 tech-stack에서 `EXTERNAL_DATA_INGESTION_MODE`, 두 계약의 선행 조건, `external-ingestion` capability가 빠졌으면 임의 보정하지 말고 `BLOCKER`로 기록한다
6. `.claude/skills/web-plan/references/planning-readiness-contract.md`에 따라 UX Check, critical state, annotation intent, 데이터 전략, 상대 노력도와 최소 검토 단위를 보존한다.

## 출력 구조

```markdown
# Project Brief — {serviceName}

## One-line Summary

## Product Frame & Current Planning Memo

## UX Risks & Critical States

## Data Review Strategy & Mock→real

## Effort Trade-off

## Confirmed Screen List
|| Screen | Path (overlay면 여는 트리거) | Key Features ||

## Confirmed Tech Stack

## Confirmed FSD Structure

## Design Team Action Items
- [ ] Define design system tokens
- [ ] Write layout spec

## Dev Team Action Items
- [ ] Project scaffolding
- [ ] Implement Mock API

## Open Decisions
- Item (option A vs B, rationale)
```

출력 파일: `_workspace/01_plan/project-brief.md`

**`SURFACE_MODEL`을 project-brief에 적는다** — `EXTERNAL_DATA_INGESTION_MODE`와 같이
**독립 행 `SURFACE_MODEL: overlay`** 형식으로 적는다(뒤에 기계 검사를 붙일 수 있도록). 화면 단위를 무엇으로 구분하는가이며 값은
`route`(URL 경로 — 기본값)와 `overlay`(호스트 표면 위에 열리고 닫히는 모달·패널형 서피스)다.
정본 정의와 커버 범위는 `.claude/agents/layout-designer.md`「서피스 모델」이다.

- **판정하지 말고 근거가 있을 때만 적는다.** 기획이 URL·라우트·페이지 이동을 말하면 `route`,
  호스트 표면 위 오버레이만으로 기술하면 `overlay`다. **둘 다 근거가 없으면 `route`를 적지 말고
  생략한다** — 소비자(`layout-designer`)가 미선언을 `route`로 읽는다. 적는 것과 기본값으로
  떨어지는 것은 다르고, 근거 없이 적으면 추론이 선언으로 승격된다.
- 기획이 위 두 값 어디에도 맞지 않으면(대화형 챗봇의 메시지 턴, 브라우저 확장 팝업 등)
  억지로 고르지 말고 `NEEDS_DECISION`으로 남긴다.
- **`overlay`는 완결된 값이 아니다.** Phase 3(`buildable-app-contract.md`의 route table,
  `integration-verifier`의 404 route)과 아직 정합되지 않아 **Phase 2까지만 성립한다.**
  그래서 이 값을 쓰면 Phase 1 → 2 체크포인트가 그 미정합을 사용자에게 알린다
  (`../skills/web-orchestrator/references/approval-checkpoints.md`). 근거가 있을 때만 적는
  규칙이 더 중요한 이유다 — 추론으로 적으면 사용자가 겪지 않아도 될 벽을 만든다.
