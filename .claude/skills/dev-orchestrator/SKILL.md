---
name: dev-orchestrator
description: DEPRECATED — 진입점은 /wh 하나다. 라이브러리·CLI 워크플로는 확정된 targetShapes가 고른다(shape-routing-contract.md). 이 스킬은 리다이렉트로만 남는다.
argument-hint: "[project description or artifact paths]"
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Write, Edit, Bash, Agent, AskUserQuestion
metadata:
  version: 1.0.0
  maturity: eval-covered
  updated: 2026-07-27
  changelog: 최초 버저닝 — adapter 재생성·검증 체계 도입과 함께 일괄 부여.
---

# dev-orchestrator — 사용하지 않는다 (2026-08-26)

**진입점은 `/web-orchestrator` 하나다.** 이 스킬이 소유하던 라이브러리 워크플로는
`.claude/skills/web-orchestrator/references/shape-routing-contract.md`로 옮겼다.

## 왜 합쳤나

진입점이 둘이면 **산출물 형태 분류가 스팩 확정보다 앞에서 산문으로** 일어난다. 그 판단은
확정된 `targetShapes`와 결속되지 않아, 스팩이 `["library"]`라고 확정해도 웹 경로로 들어온
프로젝트는 당시의 app-shell-builder·route-builder(2026-08-26 제거)를 돌았다 — 실측에서 라이브러리에
라우터를 만들었다. 형태는 기획·디자인을 거쳐 **실측·추론·질의로 확정된 뒤** 빌더를 골라야 한다.

`web-orchestrator`는 `dev-orchestrator`를 참조한 적이 없었다(언급 0회) — 위임이 단방향이라
웹으로 넘어간 뒤에는 돌아올 길도 없었다.

## 무엇을 쓰나

- 모든 진입: `/web-orchestrator`
- 형태별 빌더·검증 선택: `web-orchestrator/references/shape-routing-contract.md`
- 기존 source 수정 규율: `web-orchestrator/references/minimal-change-contract.md`가 canonical이며
  형태와 무관하게 적용된다
- 라이브러리 경로의 에이전트는 `lib-api-designer`(설계) · `developer`(구현) ·
  `environment-scaffolder`(설정·패키징) · `pack-verifier`(검증)다. 구 lib-scaffolder·
  lib-core-builder·lib-story-builder·lib-docs-generator는 2026-08-26에 제거됐고 그 소유는
  `developer`·`environment-scaffolder`가 흡수했다 — 라우팅 정본은 `shape-routing-contract.md` §2다
