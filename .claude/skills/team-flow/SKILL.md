---
name: team-flow
description: Ticket-based team development flow for web-harness — 완료된 계획을 기능 브랜치 위 GitHub Issues로 일괄 청구하고(기획자), 개발자가 하나씩 픽업해 증거 PR을 올린다. 계획/디자인이 끝나 여러 개발자가 나눠 개발할 때 쓴다. "이슈 발행해줘"·"티켓 일괄 청구"(claim), "뭐 개발할 수 있어"·"보드"(board), "이 티켓 픽업"(pickup), "PR 연결"(link)로 요청. FEAT/TC 왕복: emit → claim → pickup → change-scope → PR(Closes #N).
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Bash, AskUserQuestion
argument-hint: "[claim | board | pickup <FEAT> | link <FEAT> <pr-url>] (또는 자연어)"
metadata:
  version: 0.5.0
  maturity: contract-only
  updated: 2026-09-02
  changelog: 티켓 트래커를 provider 인터페이스 뒤로 분리하고 Jira를 붙였다 — claim이 트래커를 한 번 묻고(점 0-A) 고정하며, pickup은 전이 능력이 있으면 in-progress로 전이하고 없으면 그 사실을 표시한다. 자동 닫기 워크플로우는 비-GitHub을 PENDING으로 남긴다. 이전 — claim이 이슈 자동 닫기 워크플로우를 청구 브랜치에 설치(원장 결속 근거, 멱등). 분기 전 최신화를 첫 규칙으로 명시(claim·pickup·board도 origin 판정 전 fetch 선행). 이전 — 개발 절이 파이프라인 개발 단계 공통 계약임을 명시(정본은 web-orchestrator Phase 3 §형상 규율). 이전 — 픽업 이후 개발 절 신설 — dev 브랜치 분기·자체 판단 개발·확인 없는 분할 커밋과 푸시, 확인 지점은 PR 직전 하나로. AI 공동저자 트레일러 금지. 이전 — executor CLI 배선(claim/board/pickup/link, --confirm 게이트·exit 2) + 라우팅 0단계 + allowlist 미등재 결정 공시 + 리뷰 반영(link STALE 미수행 loud·부분 차단 exit 정렬·change-scope 덮어쓰기 가드). 이전 — 실행 환경 한계 공시(0.1.1), 진입점 초판(0.1.0).
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

0-A. **전제(점 0-A): 어느 트래커에 청구하는가.** `_workspace/03_dev/ticket-provider.json`을 읽는다.
   설정이 없어도 **원장에 기록이 있으면 GitHub이다**(이미 그렇게 돌고 있다 — 다시 묻지 않는다).
   설정도 기록도 없으면 **최초 청구**이므로 한 번 묻는다:

   - **GitHub Issues** — 코드와 같은 시스템. `Closes #N`이 자동으로 닫는다
   - **Jira** — 프로젝트 정보가 필요하다. `cli.mjs`가 물을 항목을 함께 돌려준다(`questions`):
     주소·REST 버전(Cloud 3 / Data Center 2)·프로젝트 키·이슈 타입·**전이 매핑**·assignee 표기.
     **전이 매핑은 팀마다 다르다** — "In Progress"인 곳도 "진행중"인 곳도 transition id로만
     되는 곳도 있어 하네스가 지어내지 않는다. 비우면 전이하지 않고 그 사실을 표시한다.
     **토큰은 설정 파일이 아니라 환경변수**(`JIRA_TOKEN`, Cloud는 `JIRA_EMAIL`도)로 준다.

   **Jira 배선 범위** — 여기까지다: `claim`(발행)·`pickup`(조회·배정·전이). 아직 **GitHub 전용**인 것:
`board`(gh로 이슈 목록을 돈다 — Jira면 트래커 조회 실패로 표기되고 배정 상태가 빠진다),
supersede 옛 티켓 닫기(`priorTicketPending`으로 표기만), 머지 후 자동 닫기(아래 PENDING).
**link의 PR 본문에는 Jira 키에 `Closes`를 적지 않는다** — 닫지 못하는 것을 닫는다고 쓰지 않는다.

**한 번 고르면 고정이다.** 다른 트래커를 요청해도 조용히 바꾸지 않고 `ticket-provider-switch`로
   막는다 — 기존 티켓이 다른 트래커에 남아 있고 board가 두 소스를 읽어야 한다.

0. **전제(점 0): 청구할 기획이 있는가.** `_workspace/01_plan/feature-plan.md`가 없거나
   `_workspace/03_dev/spec.json`의 `specTier`가 `unverifiable`이면 **청구할 단위가 없다.**
   이것은 도구 오류가 아니라 `PLAN_SOURCE: absent`로 만든 프로젝트의 **설계된 결과**다
   (`../web-orchestrator/references/provenance-contract.md` §2) — 수용 기준 없이 나눠 주면
   "완료"의 판정이 개발자마다 갈린다. 실패로 끝내지 말고 해소 경로를 보여준다:

   - **기획을 지금 붙인다**(권장) — `provenance-contract.md` §3 지연 공급. 기획 wave를 실행하거나
     기존 문서를 공급하면 `LOCK_INPUTS` 변화로 스팩이 stale이 되고, `acceptanceSource: "feature-plan"`
     으로 재확정하면 `verifiable`로 올라 청구가 열린다
   - **범위만큼만 붙인다** — 이번에 나눠 줄 기능만 FEAT/TC로 세운다. 전체 기획을 소급하지 않는다
     (`../web-orchestrator/references/approval-checkpoints.md`「change 레인 → 개발」①과 같은 방식)
   - **혼자 계속 간다** — 청구하지 않고 단독 개발을 이어간다. 그때 `unverifiable`은 유지된다

   `feature-planner`로 되돌리기 전에 이 판정을 먼저 한다 — 단위가 **부실한 것**과 애초에 **없는 것**은
   다른 문제이고, 후자에 TC 발명으로 답하면 수용 기준이 구현의 사본이 된다.

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

5. **이슈 자동 닫기 설치.** 발행과 함께 `.github/workflows/ticket-close.yml`과
   `.github/scripts/close-merged-tickets.mjs`를 청구 브랜치에 놓는다(멱등 — 이미 있으면
   덮지 않는다). **커밋·push는 브랜치를 만든 사람 몫**이고 CLI는 경로만 알린다.

   왜 필요한가: GitHub의 `Closes #N` 자동 닫힘은 **기본 브랜치 머지에서만** 발동한다.
   팀 흐름은 여러 티켓을 청구 브랜치에 모아 통합하므로 그 머지에서는 안 닫힌다. 그런데
   하네스의 완료 판정(`claim-scope`의 의존 해제·`board`의 merged)은 이미 "청구 브랜치
   머지 = 완료"다 — 이 워크플로우가 없으면 보드는 완료라는데 이슈는 열린 채 남는다.

   **GitHub이 아닌 트래커는 이 워크플로우가 닫지 못한다.** 원장의 `provider`로 갈라, 비-GitHub
   레코드는 `PENDING`으로 로그에 남기고 건수를 경고한다 — 인증·전이 매핑이 CI에 갖춰지지 않은
   채로 도는 경우가 흔해 여기서 전이를 수행하지 않는다. **조용히 건너뛰지는 않는다**: 건너뛴 것과
   닫은 것이 로그에서 구분되지 않으면 "보드는 완료인데 티켓은 열린 채"가 원인 없이 재현된다.

   닫는 근거는 **원장 하나뿐**이다. PR 본문의 `#N`은 작성자가 아무 숫자나 적을 수 있어
   남의 티켓을 닫는 경로가 된다. 원장에 `prUrl`이 기록되고 `branch`가 그 PR의 base와
   같을 때만 닫는다 — 즉 `link`를 거친 PR만이다.

**계획이 바뀌면 대체 발행한다.** 이미 발행된 티켓의 본문은 **고쳐 쓰지 않는다** — 그것을
읽고 작업 중인 개발자 밑에서 계약이 조용히 바뀐다. 새 티켓을 내고 옛 것은 코멘트와 함께
닫으며(`완료가 아니라 superseded`), 원장에 `supersedes`로 무엇을 무엇이 대체했는지 남긴다.
미리보기에 `대체 N`으로 나오고 `--confirm` 뒤에 실행된다. 종전에는 이 경로가 배선되지 않아
(`batch-claim`이 변경분을 `alreadyClaimed`로 접었다) 계획이 바뀌면 티켓이 영원히 낡은 채
남았다(2026-08-30 실측).

### `board` — 개발자 가용성 보드 (읽기 전용)

1. 현재 브랜치 확인(`git-origin.resolveCurrentBranch`).
2. 이슈 배정 조회(`resolveIssue`) + 원장 → `assign.buildAvailabilityBoard` →
   `claim-scope.annotateBoardScope`(layer + foundation/deps/collision 강등).
3. 출력: FEAT마다 `unclaimed/pickupable/mine/in-progress/blocked` + layer + stale. **지금 안전하게
   집을 수 있는 것**(pickupable, 미blocked)만 강조. 브랜치는 그룹 축이 아니라 컨텍스트(공통 base).
4. **미선언을 "없음"으로 읽지 않는다.** 계획에 `<!-- web-harness:unit feat=… dependsOn=… paths=… -->`가
   없으면 `deps-undeclared`로 막고(`undeclaredDeps`), 충돌 검사는 "0건"이 아니라 **미수행**으로
   보고한다(`collisionUnchecked`). 의존이 없으면 `dependsOn=none`으로 명시해야 통과한다.
   근거: 순서가 산문에만 있으면 기계는 못 읽는다 — 실측에서 11건이 전부 착수 가능으로 보였고
   실제로는 4건이었다(2026-08-30).

### `pickup <FEAT>` — 개발자 착수

**배정 뒤 상태 전이 — 능력이 있을 때만.** provider가 `transition`을 제공하면 `in-progress`로
전이하고, 없으면 배정만 한다. 결과는 `transition: {supported, done, ...}`로 **항상 표시한다** —
GitHub Issues는 상태가 open/closed뿐이라 `supported: false`이고, 그것은 실패가 아니라 능력의
차이다. 안 한 것과 못 한 것을 구분하지 않으면 사용자는 티켓이 진행중으로 바뀐 줄 안다.
전이가 실패해도 배정은 되돌리지 않되 `error`를 감추지 않는다.

**묻지 않고 실행한다.** 게이트가 전부 통과했고, 배정 대상은 요청자 자신이며, 되돌릴 수 있다 —
여기서 한 번 더 확인을 받는 것은 판단을 요구하는 게 아니라 의식이다. 개발 단계의 확인 지점은
**PR 직전 하나뿐**이다(`phase-3-development.md` 형상 규율). 미리보기가 필요하면 `--dry-run`.
`link`도 같다 — "이 PR이 이 티켓의 것"이라는 사실 기록이라 판단할 것이 없다.
**`claim`은 예외다**: 기획자가 트래커에 이슈를 무더기로 내는 아웃바운드 행위이므로 `--confirm`을
유지한다.

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

아래 규율은 파이프라인의 **개발 단계 공통 계약**이다 — 티켓을 거치지 않는 경로도 같다
(`web-orchestrator` Phase 3 §형상 규율이 정본). 티켓 고유는 1번의 분기 base와 5번의 `link`뿐이다.

1. **최신으로 맞춘 뒤 dev 브랜치를 딴다.** 청구 브랜치를 `fetch`·최신화하고 거기서
   `feat/<FEAT-NNN>-<짧은-슬러그>`로 분기한다.
   **청구 브랜치가 base보다 뒤처져 있으면 묻지 않고 fast-forward한 뒤 분기한다** — 발산이
   없으면 되돌릴 것이 없고, 뒤처진 채 분기하면 이미 확정된 의존성·수정이 빠진 위에서
   개발하게 된다. 발산이 있으면(양쪽 다 앞서 있으면) 그때만 묻는다.
   청구 브랜치는 여러 티켓의 공통 base라 직접 커밋하지 않는다 — PR의 base가 그 브랜치다.
2. **자체 판단으로 개발한다.** 기획·디자인·설계·스팩은 이미 확정된 산출물이므로 그대로
   따르고, 해석 여지는 스스로 정한다.

   > **디자인은 최대한 구현한다.** 티켓 본문의 "참고 정본(디자인)" 절이 가리키는 문서를
   > 읽고, 거기 정해진 것(색·간격·타이포·상태·접근성)은 **그대로 따른다** — 임의로 다른
   > 값을 쓰지 않는다. 정본에 **없거나 이 화면에 맞지 않으면** 적정한 값을 판단해 정하고,
   > **그 값을 정본에 추가하거나 수정한다**(디자인은 확정 뒤에도 바꿀 수 있는 산출물이다).
   > 없다고 멈추거나 묻지 않는다. 정본을 고쳤으면 무엇을 왜 바꿨는지 PR에 남긴다.
   > 기계 게이트로 강제하지는 않는다 — 판단의 자리를 남겨 두기 위해서다.

   > **권장안을 낼 수 있으면 묻지 않는다.** 선택지에 "(권장)"을 붙일 수 있다는 것은 판단이
   > 이미 섰다는 뜻이고, 그 상태에서 묻는 것은 결정을 사용자에게 떠넘기는 것이다. 권장안으로
   > 진행한 뒤 **무엇을 왜 그렇게 정했는지 한 줄로 보고**한다 — 사용자는 그때 뒤집으면 된다.
   > 아래 넷도 마찬가지다: 넷 중 하나에 해당하더라도 **문서로 답이 나오면 그 답으로 진행한다.**
   > 정말로 묻는 것은 **근거로 정할 수 없을 때**뿐이다.

   판단을 멈출 후보는 넷이다(위 단서를 통과한 경우에만 실제로 묻는다):
   - 스펙에 없는 동작을 만들어야 한다(TC 발명 금지 — feature-planner 되돌림).
   - change-scope의 ALLOWED_PATHS 밖을 고쳐야 한다.
     **단, ALLOWED_PATHS가 비어 있으면 그것은 계획 결함이지 질문거리가 아니다** — 자기 TC를
     검증할 수 없는 경로 선언은 성립하지 않는다. 이미 선 소유 규칙(같은 공백을 앞선 FEAT가
     어떻게 갈랐는가)을 적용해 스스로 정하고, 계획의 `paths=` 선언을 함께 고친다.
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
