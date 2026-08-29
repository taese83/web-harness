---
name: team-flow
description: Ticket-based team development flow for web-harness — 완료된 계획을 기능 브랜치 위 GitHub Issues로 일괄 청구하고(기획자), 개발자가 하나씩 픽업해 증거 PR을 올린다. 계획/디자인이 끝나 여러 개발자가 나눠 개발할 때 쓴다. "이슈 발행해줘"·"티켓 일괄 청구"(claim), "뭐 개발할 수 있어"·"보드"(board), "이 티켓 픽업"(pickup), "PR 연결"(link)로 요청. FEAT/TC 왕복: emit → claim → pickup → change-scope → PR(Closes #N).
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Bash, AskUserQuestion
argument-hint: "[claim | board | pickup <FEAT> | link <FEAT> <pr-url>] (또는 자연어)"
metadata:
  version: 0.3.0
  maturity: contract-only
  updated: 2026-08-30
  changelog: 픽업 이후 개발 절 신설 — dev 브랜치 분기·자체 판단 개발·확인 없는 분할 커밋과 푸시, 확인 지점은 PR 직전 하나로. AI 공동저자 트레일러 금지. 이전 — executor CLI 배선(claim/board/pickup/link, --confirm 게이트·exit 2) + 라우팅 0단계 + allowlist 미등재 결정 공시 + 리뷰 반영(link STALE 미수행 loud·부분 차단 exit 정렬·change-scope 덮어쓰기 가드). 이전 — 실행 환경 한계 공시(0.1.1), 진입점 초판(0.1.0).
---

# Team Flow

기획→디자인이 끝난 계획을 **팀이 나눠 개발**하는 티켓 흐름의 진입점. 순수 코어(`.claude/scripts/ticket/*.mjs`)와
gh/git 실행부를 **confirm 게이트**로 엮는다. 이 스킬은 pr-drafter처럼 사람 확인을 요구하는 side-effect
(이슈 생성·self-assign·PR·원장 기록)를 절대 침묵 자동발사하지 않는다.

설계 정본은 `docs/team-workflow-integration-design.md`, 불변식은 `docs/protected-core.md`. 시작 전 설계 doc의
"형상 규율 4점(VCS 게이트)"과 "청구≠픽업" 절을 읽는다.

> **실행 환경 한계(정직 공시)**: gh/git 실행부는 **플러그인 배포판에서만** 동작한다. 하네스 저장소
> 자체 세션은 global Bash policy가 `git`/`gh`를 `DENY_NETWORK`로 차단하고 ticket 스크립트를
> allowlist하지 않으므로, repo-내에서는 미리보기(순수 코어)까지만 가능하다.
> **allowlist 재검토 결론(2026-08-24)**: 등재하지 않는다 — repo 안전 정책을 약화하지 않고
> executor CLI(`.claude/scripts/ticket/cli.mjs`)는 플러그인 런타임 전용으로 둔다.

## 실행부 executor CLI

각 모드의 실행은 `node .claude/scripts/ticket/cli.mjs <cmd>`가 담당한다(결과 JSON, 게이트 차단
= exit 2). **side-effect는 `--confirm` 없이는 절대 실행되지 않는다** — 스킬이 미리보기를 사람에게
보여주고 확인받은 뒤에만 `--confirm`을 단다.

```
cli.mjs claim  --repo <o/r> [--units u.json] [--assignee me] [--confirm]   # origin 게이트→미리보기→발행
cli.mjs board  --repo <o/r> [--developer me]                               # 배정·merged(gh pr state) 실측 보드
cli.mjs pickup <FEAT> --repo <o/r> --developer me [--confirm]              # 게이트→TOCTOU 재판정→self-assign→change-scope 발급
cli.mjs link   <FEAT> <pr-url> [--confirm]                                 # STALE 차단→verified Closes→원장 링크(멱등)
```

내장 안전장치: 청구 원장 append는 최초-digest 가드(`LEDGER_REBIND_REFUSED`), pickup은 assign
직전 재조회·재판정 + 사후 다중배정 감지(동시 배정이면 사람 조율로 되돌림 — 자동 판정 안 함),
link는 change-scope STALE이면 완료 차단. merged 판정의 출처는 `gh pr view --json state`
(`resolveMergedFeatures`)다 — 추측하지 않는다.

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

0. **라우팅(§4-3)**: 티켓의 브랜치(원장 `branch`/이슈 스탬프)가 현재 브랜치와 다르면
   `route.computeSwitchPlan`으로 판정 — dirty/컨플릭/상태미상이면 **차단**(침묵 스태시·자동
   해결 금지), 다른 티켓 진행 중이면 경고, 클린이면 **확인 1회** 뒤 `git-origin.switchBranch`로
   전환. "다른 티켓 진행 중"의 산출자는 `_workspace/03_dev/change-scope.md` 존재(+그 안의
   FEAT ID) — 콘솔 판정(`detectActivePickup`)과 같은 소스라 두 채널의 답이 일치한다.
   `switchBranch`는 **checkout 직전 재검사를 내장**한다(판정↔실행 간극 봉합 — 그 사이 dirty가
   생기면 `SWITCH_BLOCKED` loud 거부). untracked 파일이 대상 브랜치의 추적 파일과 겹치면
   git이 checkout을 거부한다(loud) — 그 경우 파일 이동/정리 후 재시도 안내.
   전환해도 아래 게이트는 그대로 밟는다(라우팅 ≠ 게이트 우회).
1. **준비 게이트(점 2·3·4)**: `sync-guard.evaluatePickupReadiness`
   - 브랜치 대조(원장 `branch` vs 현재) — 불일치면 청구 브랜치로 전환 안내.
   - 컨플릭 감지(`resolveWorkingState`) — 미해결이면 **차단**(해결은 개발자 git 작업, 하네스는 자동 X).
   - 형상 대조 — 청구 형상≠로컬이면 청구 형상으로 pull 안내(`reconcileClaimVersion`).
2. **소유권 + 비신뢰 격리**: `assign.pickupWithOwnership`(ledgerRecord 전달) — 남이 배정했으면 차단,
   미배정이면 self-assign 필요(`assignArgs`, confirm 뒤). 이슈 본문 인젝션은 `pickup.scanUntrustedBody`가
   플래그, 스펙 미완/미지 FEAT는 feature-planner 되돌림(TC 발명 금지).
3. **change-scope 발급**: `pickup.buildChangeScope` → `_workspace/03_dev/change-scope.md`.
   ALLOWED_PATHS는 FEAT 소유 seed + 개발자 확인. 이후 개발은 표준 web-orchestrator Iterate 흐름.

### 개발 — 픽업 이후 (dev 브랜치)

픽업이 끝나면 change-scope가 발급된 상태다. 여기서부터는 **묻지 않고 진행한다** — 확인을
받는 지점은 **PR 직전 하나뿐**이다.

1. **dev 브랜치를 딴다.** 청구 브랜치에서 `feat/<FEAT-NNN>-<짧은-슬러그>`로 분기한다.
   청구 브랜치는 여러 티켓의 공통 base라 직접 커밋하지 않는다 — PR의 base가 그 브랜치다.
2. **자체 판단으로 개발한다.** 기획·디자인·설계·스팩은 이미 확정된 산출물이므로 그대로
   따르고, 해석 여지는 스스로 정한다. 판단을 멈추고 물어야 하는 경우는 아래 넷뿐이다:
   - 스펙에 없는 동작을 만들어야 한다(TC 발명 금지 — feature-planner 되돌림).
   - change-scope의 ALLOWED_PATHS 밖을 고쳐야 한다.
   - 확정된 계약·결정과 충돌한다(결정 로그를 뒤집어야 한다).
   - 되돌리기 어렵거나 팀 전체에 영향이 가는 조치가 필요하다.
3. **커밋은 묻지 않고 계속한다.** 다만 **한 커밋 = 한 가지 변화**로 쪼갠다 — 리팩터링과
   기능 추가를 섞지 않고, 스펙 문서 갱신과 구현을 필요 이상으로 묶지 않는다. 커밋마다
   무엇을·왜 바꿨는지 본문에 남기고, 실측이 있으면 수치를 적는다(주장과 증명을 섞지 않는다).
   **AI 공동저자 트레일러(`Co-Authored-By: Claude …`)는 넣지 않는다.**
4. **커밋 후 dev 브랜치에 푸시한다.** 이것도 확인 없이 한다 — dev 브랜치는 그 티켓 전용이고
   공유 base가 아니다.
5. **PR 직전에 확인받는다.** 변경 요약·영향 파일·TC 결과·남은 미결을 보여주고 사람 확인을
   받은 뒤에만 PR을 만든다. 그다음 `link`로 이슈에 연결한다.

> **왜 커밋·푸시는 열고 PR은 닫는가**: dev 브랜치의 커밋·푸시는 되돌릴 수 있고 그 티켓
> 안에 갇힌다. PR은 리뷰어를 부르고 base 브랜치로 나가는 **팀을 향한 행위**다. 비협상의
> "사람 확인" 대상은 후자다.

### `link <FEAT> <pr-url>` — PR 연결

1. `pr.completionGate`(STALE·failing-TC 하드 차단) 통과 확인. **정직 표기**: CLI `link`가
   기계 강제하는 것은 STALE 대조(미수행이면 `stale-check-unavailable` 차단, `--accept-unverified-scope`
   명시 인수만 통과)와 원장 대조 close 참조까지다 — **failing-TC 차단은 아직 CLI에 evidence
   입력이 배선되지 않아** 이 절차(TC 결과를 completionGate에 넣어 확인)를 스킬 수행자가 지켜야
   한다(후속: evidence 입력 배선).
2. `pr.computeCloseLink`(원장 대조) → `provider-github.renderCloseReference`(verified만 `Closes #N`,
   미확인은 non-closing) → `pr.buildPrBody`(증거 tier 정직 라벨). base=기능 브랜치.
3. `pr.computePrLinkPlan` 멱등 → 원장에 prUrl append(`ledger-writer`).

## 비협상

- side-effect(이슈 생성·assign·PR·상태전이)는 **미리보기 → 사람 확인 → 실행**. 침묵 자동발사 금지.
  **예외는 dev 브랜치의 커밋·푸시뿐**이다(위 개발 절) — 되돌릴 수 있고 티켓 안에 갇힌다.
  PR은 예외가 아니다.
- 청구는 origin 푸시분에만(점 1). 픽업은 브랜치·형상·컨플릭 게이트 통과 후에만.
- 증거 위조 금지 — PR tier는 산출물 *존재*이지 통과 판정이 아니다(`pr.summarizeEvidence`).
- 컨플릭 자동 해결·최종 develop 머지는 하지 않는다(사람 몫 — 정직 경계).
