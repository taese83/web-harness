---
name: team-flow
description: Ticket-based team development flow for web-harness — 완료된 계획을 기능 브랜치 위 GitHub Issues로 일괄 청구하고(기획자), 개발자가 하나씩 픽업해 증거 PR을 올린다. 계획/디자인이 끝나 여러 개발자가 나눠 개발할 때 쓴다. "이슈 발행해줘"·"티켓 일괄 청구"(claim), "뭐 개발할 수 있어"·"보드"(board), "이 티켓 픽업"(pickup), "PR 연결"(link)로 요청. FEAT/TC 왕복: emit → claim → pickup → change-scope → PR(Closes #N).
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Bash, AskUserQuestion
argument-hint: "[claim | board | pickup <FEAT> | link <FEAT> <pr-url>] (또는 자연어)"
metadata:
  version: 0.1.1
  maturity: contract-only
  updated: 2026-08-23
  changelog: 실행 환경 한계 공시 — repo-내 세션은 bash policy가 gh/git을 차단해 미리보기까지만 가능(플러그인 배포판에서만 실행부 동작). 이전 — 진입점 초판(일괄 청구·보드/픽업·PR 연결, 실행부 executor CLI·feature-plan→units 파서는 후속).
---

# Team Flow

기획→디자인이 끝난 계획을 **팀이 나눠 개발**하는 티켓 흐름의 진입점. 순수 코어(`.claude/scripts/ticket/*.mjs`)와
gh/git 실행부를 **confirm 게이트**로 엮는다. 이 스킬은 pr-drafter처럼 사람 확인을 요구하는 side-effect
(이슈 생성·self-assign·PR·원장 기록)를 절대 침묵 자동발사하지 않는다.

설계 정본은 `docs/team-workflow-integration-design.md`, 불변식은 `docs/protected-core.md`. 시작 전 설계 doc의
"형상 규율 4점(VCS 게이트)"과 "청구≠픽업" 절을 읽는다.

> **실행 환경 한계(정직 공시)**: gh/git 실행부는 **플러그인 배포판에서만** 동작한다. 하네스 저장소
> 자체 세션은 global Bash policy가 `git`/`gh`를 `DENY_NETWORK`로 차단하고 ticket 스크립트를
> allowlist하지 않으므로, repo-내에서는 미리보기(순수 코어)까지만 가능하다. 실행부 executor CLI
> 배선 시 allowlist 등재를 재검토한다(protected-core §4 "티켓 식별자 원장" 행의 선행 조건과 함께).

## Start — 자연어 의도 매핑

명령어를 외울 필요 없다. 요청을 아래 모드로 매핑하고, 애매하면 한 번만 되묻는다:

| 사용자가 말하면 | 모드 |
|---|---|
| "이슈/티켓 발행해줘", "일괄 청구", "티켓 나눠줘", "기능 티켓 만들어줘" | `claim`(기획자 일괄 청구) |
| "뭐 개발할 수 있어", "티켓 목록/보드 보여줘", "남은 거 뭐야" | `board` |
| "이 티켓 픽업할게", "FEAT-003 가져갈게", "이거 개발 착수" | `pickup <FEAT>` |
| "PR 연결해줘", "이슈에 PR 붙여줘" | `link <FEAT> <pr-url>` |

`claim`은 계획 전체를 한 번에 발행하는 게 기본이다 — 개발자가 개별 티켓을 따로 요청할 필요가 없다.
자연어로 들어와도 아래 각 모드의 **미리보기 → 확인 → 실행** 게이트는 그대로 지킨다.

## 역할 두 개

- **기획자(청구자)**: 계획 완료 → 기능 브랜치 생성·push → **한 요청으로 일괄 청구**(개별 아님).
- **개발자(픽업자)**: 그 브랜치로 이동 → 보드에서 하나씩 픽업 → 개발 → PR(Closes #N, base=기능 브랜치).
- **최종 브랜치→develop 머지는 사람 몫**(하네스 범위 밖 — 정직 경계).

## 모드

### `claim` — 기획자 일괄 청구

1. **전제(점 1): origin 동기.** `git-origin.resolveOriginPlanSync`로 feature-plan이 origin에 푸시돼
   일치하는지 확인. 로컬≠origin이면 `claim-guard.computeClaimEligibility`가 거부 →
   `claimEligibilityGuidance`를 사람에게 보여주고 **커밋·push 먼저**. 청구는 공유된 형상에만.
2. **브랜치.** 기능 기반 브랜치명을 확인/생성하고 push(자동). 이 브랜치가 모든 티켓의 공통 base.
3. **미리보기.** feature-plan units + 원장으로 `batch-claim.computeBatchClaimPlan` →
   `formatBatchClaimPreview`. foundation 먼저·의존 위상 순서, 경로 충돌·순환 경고를 **발행 전** 노출.
   충돌/순환이 있으면 발행하지 않고 상류(feature-planner) 수정으로 되돌린다.
4. **확인 → 발행.** 사람 확인 뒤에만, create 목록을 **순서대로** 돌며 `runner.claimFeature`
   (provider=`createGithubProvider`, ledger=`ledger-writer.appendLedgerRecord`, branch=현재 브랜치)로
   이슈를 생성하고 원장에 기록. 권한 부족이면 `permissions`가 등급별 안내(write=lazy-claim,
   triage=lead-emit, read=fork)로 정직 표기.

### `board` — 개발자 가용성 보드 (읽기 전용)

1. 현재 브랜치 확인(`git-origin.resolveCurrentBranch`).
2. 이슈 배정 조회(`resolveIssue`) + 원장 → `assign.buildAvailabilityBoard` →
   `claim-scope.annotateBoardScope`(layer + foundation/deps/collision 강등).
3. 출력: FEAT마다 `unclaimed/pickupable/mine/in-progress/blocked` + layer + stale. **지금 안전하게
   집을 수 있는 것**(pickupable, 미blocked)만 강조. 브랜치는 그룹 축이 아니라 컨텍스트(공통 base).

### `pickup <FEAT>` — 개발자 착수

1. **준비 게이트(점 2·3·4)**: `sync-guard.evaluatePickupReadiness`
   - 브랜치 대조(원장 `branch` vs 현재) — 불일치면 청구 브랜치로 전환 안내.
   - 컨플릭 감지(`resolveWorkingState`) — 미해결이면 **차단**(해결은 개발자 git 작업, 하네스는 자동 X).
   - 형상 대조 — 청구 형상≠로컬이면 청구 형상으로 pull 안내(`reconcileClaimVersion`).
2. **소유권 + 비신뢰 격리**: `assign.pickupWithOwnership`(ledgerRecord 전달) — 남이 배정했으면 차단,
   미배정이면 self-assign 필요(`assignArgs`, confirm 뒤). 이슈 본문 인젝션은 `pickup.scanUntrustedBody`가
   플래그, 스펙 미완/미지 FEAT는 feature-planner 되돌림(TC 발명 금지).
3. **change-scope 발급**: `pickup.buildChangeScope` → `_workspace/03_dev/change-scope.md`.
   ALLOWED_PATHS는 FEAT 소유 seed + 개발자 확인. 이후 개발은 표준 web-orchestrator Iterate 흐름.

### `link <FEAT> <pr-url>` — PR 연결

1. `pr.completionGate`(STALE·failing-TC 하드 차단) 통과 확인.
2. `pr.computeCloseLink`(원장 대조) → `provider-github.renderCloseReference`(verified만 `Closes #N`,
   미확인은 non-closing) → `pr.buildPrBody`(증거 tier 정직 라벨). base=기능 브랜치.
3. `pr.computePrLinkPlan` 멱등 → 원장에 prUrl append(`ledger-writer`).

## 비협상

- side-effect(이슈 생성·assign·PR·상태전이)는 **미리보기 → 사람 확인 → 실행**. 침묵 자동발사 금지.
- 청구는 origin 푸시분에만(점 1). 픽업은 브랜치·형상·컨플릭 게이트 통과 후에만.
- 증거 위조 금지 — PR tier는 산출물 *존재*이지 통과 판정이 아니다(`pr.summarizeEvidence`).
- 컨플릭 자동 해결·최종 develop 머지는 하지 않는다(사람 몫 — 정직 경계).
