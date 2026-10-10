---
name: team-flow
description: Ticket-based team development flow for web-harness — 검토한 계획의 FEAT 전체를 WORK(공통 기반·기능별·통합 작업)로 분해·검토해 트래커(GitHub Issues·Jira)에 발행하고, 개발자가 WORK를 하나씩 픽업해 PR로 완료한다. 계획/디자인이 끝나 여러 개발자가 나눠 개발할 때 쓴다. "개발 준비해줘"·"WORK로 분해"(claim), "티켓 발행"(claim --publish), "뭐 개발할 수 있어"·"보드"(board), "이 티켓 픽업"(pickup), "PR 연결"(link)로 요청. FEAT/TC는 요구사항, WORK는 실행 단위다.
disable-model-invocation: true
effort: high
allowed-tools: Read, Glob, Grep, Bash, AskUserQuestion, Agent
argument-hint: "[claim | claim --publish | create | board | pickup <티켓키> | link <티켓키> <pr-url>] (또는 자연어)"
metadata:
  version: 1.0.0
  maturity: contract-only
  updated: 2026-09-14
---

# Team Flow

기획→디자인이 끝난 계획을 **팀이 나눠 개발**하는 티켓 흐름의 진입점. 모델은 **WORK 하나**다 —
FEAT/TC는 요구사항(무엇이 되어야 하는가)이고, WORK는 실행 단위(누가 어떤 경계에서 무엇을 만드는가)다.
공통 기반은 WORK 하나로 여러 FEAT가 함께 쓰고, TC가 없는 기반 작업은 기술 검증(`checks`)으로 끝난다.

순수 코어(`.claude/scripts/ticket/*.mjs`)와 트래커·git 실행부를 **사람 승인**으로 엮는다. 요청 없이
스스로 발사하지 않는다. 계약·절차·키의 정본은 `references/work-plan-contract.md`, 불변식은
`docs/protected-core.md`.

> **실행 환경 한계(정직 공시)**: gh/git·트래커 네트워크 호출은 **플러그인 배포판에서만** 동작한다.
> 하네스 저장소 자체 세션은 global Bash policy가 네트워크를 막는다. `ticket/cli.mjs`는 명령별 인자
> 계약으로 등재돼 있고, 게이트를 끄는 탈출 플래그(`--accept-*`·`--replace-scope`)는 열지 않는다.

## 실행부 executor CLI

`node .claude/scripts/ticket/cli.mjs <cmd>`가 실행한다(결과 JSON, 게이트 차단 = exit 2).

```
cli.mjs claim [--features FEAT-001,…]                                   # 준비(P0)·검토(P1) — 외부 쓰기 없음
cli.mjs claim --publish [--work-ids a,b] [--parent <KEY>] [--epic <KEY>] [--repo o/r] [--confirm]  # 확인한 판본만 발행 · 옛 판본 티켓은 동기화 · --epic은 Jira 에픽(Cloud parent, DC epicLinkField) · workLink 미선언이면 본문 참조(link-only)
cli.mjs board [--developer me] [--repo o/r]                             # 지금 집을 수 있는 WORK
cli.mjs board --by-feature                                              # 부모 FEAT 집계(머지 ≠ 인수)
cli.mjs claim --publish --aggregate [--features …] [--confirm]          # FEAT별 집계 티켓 발행·갱신
cli.mjs claim --publish --resolve <WORK-ID|FEAT-ID> --ticket <키> [--confirm]  # 결과를 모르는 발행을 확정(본문 마커 확인)
cli.mjs pickup <티켓키> --developer me [--repo o/r] [--dry-run] [--assessment <지문>] [--reassess]  # 게이트 → 배정 → change-scope 발급(사람 개발 티켓은 배정 → 판정 → 확인부터). 본문을 고친 뒤 --reassess: 판정서를 이력으로 옮기고 바뀐 절만 다시 판정(손으로 치우지 않는다)
cli.mjs link <티켓키> <pr-url> [--base <브랜치>] [--dry-run]              # 완료 주장(STALE·수용 기준·기대 base) → 로컬 기록 + PR 본문 문단
cli.mjs intake <티켓키> --repo o/r                                         # 사람이 쓴 기획 티켓을 공급 원문으로
cli.mjs configure --provider <github|jira> [--set k=v]… [--replace] [--confirm]  # 트래커 설정 기록
cli.mjs create --draft <초안.md> [--epic <KEY>] [--repo o/r] [--confirm --digest <지문>]  # 기획 없이 기능만 구현하는 개발 티켓 생성(손 티켓과 같다)
cli.mjs pilot-report [--keys A-1,A-2] [--no-tracker]                        # 실측 집계(읽기만) — 흐름 로그·판정·등록·연결 + 트래커·PR
```

`--developer me`는 트래커의 현재 인증 계정(Jira Cloud accountId·서버 username·GitHub login)으로 풀린다 — 풀지 못하면 픽업은 쓰기 전에 멈춘다.

`claim --publish`·`configure`는 `--confirm` 없이 미리보기다.
`pickup`·`link`·`intake`는 **사용자의 요청이 곧 승인**이다(미리보기는 `--dry-run`). 결과의 `sessionHint`대로 **티켓 경계(link 뒤·다음 pickup 전)에서 새 세션을 권한다** — 상태는 파일에 있다.

## Start — 자연어 의도 매핑

| 사용자가 말하면 | 모드 |
|---|---|
| "개발 준비해줘", "WORK로 분해해줘", "공통 기반부터 나눠줘", "분해안 보여줘" | `claim` |
| "이슈/티켓 발행해줘", "분해안대로 올려줘" | `claim --publish` (미리보기 → 확인 → `--confirm`) |
| "뭐 개발할 수 있어", "보드 보여줘", "남은 거 뭐야" | `board` |
| "이 티켓 픽업할게", "PF-104 가져갈게", "이거 개발 착수" | `pickup <티켓키>` |
| "PR 연결해줘", "이 작업 끝났어" | `link <티켓키> <pr-url>` |
| "머지됐어", "완료 반영해줘" | `board` (머지는 기록하지 않고 읽는다) |
| "머지 되돌렸어", "그 작업 다시 열어줘" | 되돌림 PR(`Revert "[키] …"`)을 머지하거나 트래커에서 티켓을 다시 열라고 안내한다(하네스가 기록하지 않는다) |
| "FEAT별로 어디까지 됐어", "기능 단위 진행" | `board --by-feature` |
| "이 Jira 기획 티켓 읽어줘", "티켓에서 기획 가져와" | `intake <티켓키>` |
| "개발 티켓 만들어줘", "공통 로직을 티켓으로 나눠줘", "기획 없이 기능 티켓" | `create` (초안 → 미리보기 → 확인 → `--confirm`) |
| "실측 집계해줘", "파일럿 결과 보여줘" | `pilot-report` (결과의 `markdown`을 그대로 보여 준다) |

**티켓 종류마다 문이 다르다** — 기획 티켓은 `intake`로 **공급 원문**이 되고(개발 티켓이 아니다), 개발은
계획이 발행한 **WORK 티켓**과, 팀이 선언한 분류의 **사람 개발 티켓**(판정·확인을 거쳐 로컬에 등록한 뒤)만 집는다. 분해된 FEAT를 집으려 하면 어느 WORK로 가야 하는지 돌려준다.
판정 기준은 `references/ticket-kinds.md`가 정본이다.

## 역할

- **개발 준비 담당자**: 계획 FEAT 전체를 분석·분해하고 검토받아 발행한다. 공통 경계·의존을 조정한다.
- **개발자**: 보드에서 WORK를 하나씩 픽업 → 개발 → PR → 완료. 계약·경계 안의 세부 구현까지 매번 승인받지 않는다.
- **최종 브랜치 → develop 머지는 사람 몫**(하네스 범위 밖 — 정직 경계).

## 모드

### `claim` — 준비·검토

별도 분해 명령도 미리 만든 work-plan 파일도 요구하지 않는다 — 결과의 `phase`가 다음 할 일을 말한다:
설계 자료 보존(`source-artifact-ingestor`) → `system-architect`의 분석(P0)·계획(P1) 작성 → 검토표
(`_workspace/03_dev/work-plan-review.md`). CLI는 **검증만** 하고 지문(명세·입력 파일)은 CLI가 계산한다.
외부 쓰기가 없다. `*_INVALID`(exit 2)면 `errors`를 그대로 돌려 고치게 한다 — 검사를 약화하지 않는다.

**전제: 청구할 기획이 있는가.** `_workspace/01_plan/feature-plan.md`가 없거나 스팩의 `specTier`가
`unverifiable`이면 나눠 줄 수용 기준이 없다 — 도구 오류가 아니라 `PLAN_SOURCE: absent`의 설계된 결과다
(`../web-orchestrator/references/provenance-contract.md` §2). 기획을 지금 붙이거나(§3 지연 공급), 이번에
나눌 범위만 FEAT/TC로 세우거나, 혼자 계속 간다. **기획·디자인 없이 팀이 나눠 개발할 범위면 `create`로 개발 티켓을
만들어 `pickup`한다** — 이것이 기획 없는 팀의 정식 경로다(예외 인수가 아니다). TC 발명으로 답하지 않는다.

### `claim --publish` — 발행

**확인한 판본만** 나간다. 미리보기가 무엇을 어디에 낼지 외부 쓰기 0으로 보여주고, 같은 요청에 `--confirm`을
붙였을 때만 쓴다. 검토 뒤 계획이 바뀌면 발행하지 않는다. 쓰기 전에 시도를 원장에 남기고, 응답 유실은
`unknown`으로 두어 다음 실행이 **조회로 확인**한다(부재를 단정해 재발행하지 않는다). 트래커가 정해지지
않았으면 먼저 묻고 `configure`로 기록한다 — 항목·GitHub Enterprise `host`·공유 여부는
`references/tracker-config.md`. Jira 토큰은 설정 파일이 아니라 환경변수(`JIRA_TOKEN`, Cloud는 `JIRA_EMAIL`)다.

### `create` — 기획 없이 기능만 구현하는 개발 티켓

계획(FEAT/TC) 없이 기능만 구현할 티켓을 만든다. `system-architect`를 **티켓 초안 모드**로 스폰해 요청과 코드를 분석한
초안을 `_workspace/03_dev/ticket-drafts/<이름>.md`에 쓰게 한다(양식은 `references/ticket-work-contract.md` 「개발 티켓 양식」).
`create --draft <파일>`은 쓰기 0의 미리보기이고, 사용자가 확인하면 미리보기의 `confirmWith`(`--confirm --digest <지문>`)로 만든다 —
미리보기 뒤 초안이 바뀌면 멈춘다. 완료 조건은 이후 판정에서 티켓 출처가 되므로 미리보기에서 빠짐없이 보여 준다. 만든 티켓은 WORK 마커 없이 팀의
개발 티켓 분류만 붙어 **손으로 만든 티켓과 같다** — 다음은 티켓마다 `pickup`의 판정이다. 초안 에이전트가 판정(`<이름>.assessments.json`)도
썼으면 만든 티켓에 미리 두고, pickup은 트래커 본문·스팩·수정 범위 코드가 만든 때와 같으면 판정 에이전트 없이 미리보기로 간다(다르면 버리고 판정한다). 같은 제목의 열린 개발 티켓은 만들지 않고
그 키를 돌려준다(다시 실행해도 두 번 만들지 않는다). **이미 끝낸 작업을 다시 만들지 않는다** — 초안 에이전트가 요청과 같은 일을 하는
기존 코드·스팩 결정을 먼저 찾아 겹치면 차이만 쓰고, 미리보기의 `recentDone`(최근 끝난 개발 티켓)을 사용자에게 함께 보여 겹치는 것이 있으면
만들지 않는다. 같은 제목 대조는 열린 티켓만 보므로 끝난 티켓과의 겹침은 이 두 겹이 가린다.

### `board` — 지금 집을 수 있는 것 (읽기 전용)

착수 가능 판정은 **픽업과 같은 축**이다(등록 · 발행 판본 · 미해결 결정 · 선행 머지 완료 · 소유). 트래커를
못 보거나 목록이 잘리면 배정을 **미상**으로 두고 그 사실을 적는다 — 「미배정」으로 읽지 않는다.

**사람이 만든 개발 티켓 절은 `next`(다음 할 일)로 보여준다.** 판정 전·착수 가능 판정 티켓은 막힌 것이 아니라
`pickup`으로 이어가는 자리다. `blockedReason`이 있는 행만 이유를 적는다(기획·디자인 필요, 선행 미완료,
다른 개발자 배정 등).

### `pickup <티켓키>` — 착수

인젝션 스캔(제목·본문 fail-closed, 의심 코멘트는 빼고 표시) · 종류 선판정 · 원장 등록 대조 · STALE(발행
판본 ↔ 지금 계획) · 미해결 결정 · **선행 머지 완료** · 수용 기준 존재 · 소유(배정 직전 재조회, 사후 다중
배정 감지) · 미해결 컨플릭을 지난 뒤 change-scope(`_workspace/03_dev/change-scope.md`)를 발급한다.
쓰기 경계는 검토받은 계획의 `writePaths`다. 막히면 **되돌림 코멘트가 티켓으로 간다**.

**사람이 만든 개발 티켓**(팀이 `개발 티켓`으로 선언한 Jira 컴포넌트 · GitHub 라벨)도 같은 `pickup`으로 받는다.
판정하기 전에 **나로 배정한다**(남이 맡았으면 멈춘다). 티켓 원본은 고치지 않고, 확인한 판정은 내 로컬에 등록한다.
사용자에게 묻는 것은 **확인 한 번**이다:
1. 결과의 `outcome`이 `assessing`이면 **같은 턴에서** `system-architect`를 티켓 판정 모드로 스폰하고, 끝나면 곧바로
   `pickup`을 다시 부른다 — 중간 결과를 사용자에게 보고하지 않는다. 한 번 판정한 뒤에도 `assessing`이면 멈추고 알린다(재시도 1회).
2. `confirm`이면 착수 가능은 `review`를, 착수 불가는 `requestComment`(티켓에 남길 요청)를 보여주고 확인을 묻는다. 확인하면 결과의
   `confirmWith`를 그대로 붙여 다시 부른다(`--assessment <지문>` — 지문은 사용자에게 보이지 않는다). 이 확인은 픽업 요청으로 대신하지 않는다.
3. 판정이 「디자인 필요」인데 사용자가 「디자인은 임의로」라고 지시하면 판정 에이전트에게 그 지시를 전해 다시 판정한다
   (`designByImplementer.source: developer`). 사용자가 지시하지 않았으면 넣지 않는다.
4. 스팩 승인을 한 번 더 받는 조건은 `ticket-work-contract.md` 흐름 6이 정본이다(`specApproval: required`).
정본: `references/ticket-work-contract.md`.

**묻지 않고 실행한다 — 픽업 요청이 곧 승인이다.** 승인 범위는 셋이다: 본인 배정 · `in-progress` 전이
(능력이 있을 때만 — 없으면 `transition.supported: false`로 표시) · 되돌림 코멘트. 머지·완료 전이는 하지 않는다.
사람 개발 티켓의 요청·임의 디자인 코멘트는 위 확인 뒤에만 남긴다.

### 개발 — 픽업 이후 (dev 브랜치)

여기서부터는 **묻지 않고 진행한다** — 확인 지점은 **커밋 직전**(아래 3)과 **PR 직전**(6)이다. 이 규율은 파이프라인의 **개발
단계 공통 계약**이다(`web-orchestrator` Phase 3 §형상 규율이 정본).

1. **최신으로 맞춘 뒤 dev 브랜치를 딴다.** 공통 base를 `fetch`·최신화하고 `feat/<짧은-슬러그>`로 분기한다.
   base가 뒤처져 있으면 fast-forward한 뒤 분기하고, 발산이 있을 때만 묻는다.
2. **자체 판단으로 개발한다.** 계획·계약·디자인 정본을 그대로 따르고 해석 여지는 스스로 정한다. 기획·설계 문서는 새로 쓰지 않는다 —
   코드만 보고 알 수 없는 결정·제약이 있을 때만 `_workspace/03_dev/notes/<티켓>.md` 한 장(60줄 이내)을 코드와 함께 커밋한다(`minimal-change-contract.md`).

   > **디자인은 최대한 구현한다.** change-scope의 디자인 참조가 가리키는 정본에 정해진 것은 그대로 따르고,
   > 없거나 맞지 않으면 적정한 값을 정해 **정본에 추가·수정한다**. 바꿨으면 무엇을 왜 바꿨는지 PR에 남긴다.

   > **권장안을 낼 수 있으면 묻지 않는다.** 권장안으로 진행한 뒤 무엇을 왜 정했는지 한 줄로 보고한다.

   판단을 멈출 후보는 넷이다(문서로 답이 나오면 그 답으로 진행한다):
   - 스펙에 없는 동작을 만들어야 한다(TC 발명 금지 — 계획으로 되돌림).
   - change-scope의 `ALLOWED_PATHS` 밖을 고쳐야 한다(경계는 계획이 정한다 — 계획을 고쳐 재검토·발행).
   - 확정된 계약·결정과 충돌한다.
   - 되돌리기 어렵거나 팀 전체에 영향이 가는 조치가 필요하다.
3. **커밋마다 직전에 리뷰하고 고친 뒤 승인받는다.** 그 커밋에 들어갈 변경을 아래 5의 방식으로 리뷰(묶음 `--base HEAD` — 아직 커밋하지 않은
   변경)하고 지적을 선별해 고친 다음, 커밋 계획과 리뷰 처분을 함께 보여 주고 승인받는다. 커밋이 여러 개면 커밋마다 반복한다(이미 리뷰한 뒤
   바뀌지 않은 파일은 다시 리뷰하지 않는다 — `link`가 파일 내용으로 대조한다). 대상은 **코드 파일이 바뀐 커밋만**이다(문서·`_workspace`만이면 리뷰 없이 커밋).
   하네스 모드에서 리뷰 안 된 코드로 `git commit`하면 훅이 한 번 돌려보낸다(`remind-commit-review.mjs`). 커밋 계획 — 커밋마다 메시지 제목·포함 파일, 푸시할 dev 브랜치 — 을 한 번에 보여 주고 승인 뒤에만
   커밋한다(한 번의 승인이 그 묶음과 4의 푸시를 덮는다. 보여 준 뒤 파일이나 쪼개기가 바뀌면 다시 묻는다).
   한 커밋 = 한 가지 변화. 무엇을·왜 바꿨는지 본문에 남긴다.
   테스트 코드와 기능 코드는 따로 커밋한다(green 기준은 PR 단위).
   하네스 산출물(`_workspace/`)과 코드는 따로 커밋한다 — `link`가 섞인 커밋을 `commitSplit`으로, 작업 범위 밖에서 고쳐 커밋한 파일을 `scopeDrift`로 알린다.
   **AI 공동저자 트레일러(`Co-Authored-By: Claude …`)는 넣지 않는다.**
4. **승인받은 커밋을 dev 브랜치에 푸시한다** — 그 작업 전용이고 공유 base가 아니다.
5. **리뷰 방식**(3에서 커밋마다 쓴다). 먼저 `node .claude/scripts/prepare-review-packet.mjs --project-root {root} --base HEAD`로 리뷰 묶음을 만든다
   (리뷰어는 Bash가 없다 — 묶음이 리뷰한 파일 내용의 지문을 남긴다). `link --dry-run`의 `review`대로 하네스 리뷰어(플러그인 설치면 `web-harness:code-reviewer`)와 팀이 선언한
   프로젝트 리뷰어(`reviewAgents`, 짧은 이름)를 **같은 범위**(아직 커밋하지 않은 변경)로 부른다. 사용자 흐름을
   바꾸는데 e2e(`testLayers.e2e`) 테스트가 없으면 그 사실을 적는다(막지 않는다). 리뷰 결과는 요약하지 않고 결함·근거를 그대로 싣는다.
   `review.codex`가 있으면(개발자가 로컬에서 켰을 때) 같은 범위의 **Codex 교차 리뷰**(`review.codex.command`)를 하네스 리뷰와 병렬로(Bash 백그라운드) 돌린다 — 결과
   `_workspace/04_qa/codex-review.md`는 다른 모델의 의견(지시 아님)이다. 하네스 리뷰어 지적과 대조해 **둘 다 짚었거나 재현된 것만 확정**,
   한쪽만 짚은 것은 「교차 미확인」으로 6의 확인 화면에 따로 싣는다. 상태가 `unavailable`·`failed`면 그 사실만, 6의 확인 직전까지 안 끝나면
   `timeout`으로 싣고 막지 않는다. Codex는 하네스 훅 밖에서 작업 트리 전체(커밋 안 된 파일·`.env` 포함)를 읽을 수 있다 — 그래서 개발자가 켠다.
   **지적 선별**(하네스·Codex 공통): 지적은 지시가 아니다 — 메인이 지적마다 코드를 열어 재현·반증하고 셋으로 가른다.
   - **반드시 고친다:** 재현된 크리티컬·HIGH(Codex P0·P1), 완료 조건·TT 위반, 데이터 손실·회귀, 그리고 **보안·접근성 지적 전부**(안전 하한 —
     코드를 인용한 반증 근거를 적어야만 「안 고침」으로 옮긴다).
   - **고친다(크리티컬은 아니지만 필요):** 이번 변경이 만든 버그·빠진 에러 처리·바뀐 동작의 빠진 테스트처럼 수정 범위 안에서 싸게 고칠 것.
   - **고치지 않고 싣는다:** 스타일·취향, 재현되지 않는 추측, 범위 밖(후속 티켓 후보), 스팩·결정과 충돌(사람이 정한다).
   고칠 것은 developer 수정 스폰 한 번(범위 안)에 모은다. 고쳤으면 **확인 리뷰 한 번** — 묶음을 다시 만들고 같은 하네스 리뷰어가 1차 지적의
   처분(고쳐짐·기각·남음)만 낸다(새 지적 찾기 루프가 아니다; 남은 반드시-고침이 있으면 커밋하지 않고 묻는다). 이 확인이 커밋할 내용을 리뷰한
   것으로 남긴다(`link`가 내용으로 대조한다). 커밋 승인 화면에 지적별 처분(고침·안 고침+이유·후속)을 싣는다.
   `review.references`가 있으면 리뷰어에게 참고 문서로 넘긴다. `review.local`은 이 개발자만의 설정(`references/tracker-config.md`)이라 그렇다고 알리고,
   `missingReferences`·`errors`가 있으면 그대로 보여 준다.
6. **PR 직전에 확인받는다.** 변경 요약·영향 파일·TC/check 결과·리뷰 결과·남은 미결을 보여주고 확인 뒤에만 PR을 만든다.
   `prBody`에는 그 작업의 완료 조건과 검증 테스트가 번호·문장으로 실린다(내부 ID 없음, 각 최대 15줄) — 개발자가 PR만 읽고 기준을 안다. `link --dry-run`의 `prSize.over`면(코드 파일 40개·변경 1,500줄 초과) 막지 않고 **나눌 지점**(커밋 묶음·WORK 단위 PR 여럿)을 제안해 묻는다 —
   그대로 가기로 하면 PR 본문에 나누지 않은 이유를 한 줄 적는다. 커밋 계획(3)을 세울 때 이미 넘을 것 같으면 그때 PR을 나눌 지점을 함께 보인다.
   `link --dry-run`의 `harnessReview`는 커밋마다 커밋 전 리뷰를 거쳤는지(파일 내용 대조) 보여 준다 — `reviewed: false`인 커밋은 이미 커밋된
   내용이라 묶음과 Codex(`review.codex.command`의 `HEAD`를 `{review.base}`로 바꿔)를 `--base {review.base}`로 돌려 PR 전에 리뷰하고, 그 사실과 처분을 확인 화면에 싣는다.

> 커밋·푸시는 dev 브랜치 안의 일이라 승인 한 번으로 묶고, PR은 리뷰어를 부르고 base로 나가는 **팀을 향한 행위**라 따로 확인받는다.

### `link <티켓키> <pr-url>` — 완료

`link`는 **완료를 주장**한다: STALE 대조(대조 못 하면 `--accept-unverified-scope` 없이 막고, 넘기면 기록에
남긴다) · 소유 TC 인용 · `checks` 대상 실재와 **픽업 뒤 변화** · **기대 base**(PR에서 읽거나 `--base`, 모르면 막는다) · **PR의 티켓 키**
(제목 `[키] …` 또는 브랜치 `feature/키-…` — 둘 다 없으면 막고 PR을 못 읽으면 알린다) · 멱등. 미충족은 막고 `--accept-incomplete`로 넘기면 그 사실이 기록에 남는다.
기록은 **내 로컬**이다(원장·티켓에 쓰지 않는다). 리뷰어가 볼 것(닫는 줄·인수한 미충족·사람이 더한 조건)은 `prBody` 문단으로 돌려준다 —
PR 본문에 넣게 한다. 닫는 줄은 발행 원장의 트래커가 정한다(GitHub만 머지로 닫힌다 — Jira 키에 `Closes`를 적지 않는다).
완료는 기록하지 않는다 — 보드·픽업이 기대 base에 **머지된 PR을 제목·브랜치의 티켓 키로** 찾고(머지된 커밋·트래커의 끝남도) 그때그때 읽는다.
머지를 되돌리려면 되돌림 PR(`Revert "[키] …"`)을 머지하거나 트래커에서 티켓을 다시 연다 — 그 뒤의 머지만 완료로 센다.
`pickup`·`link`는 받지 않은 계획 개정이 원격에 있으면 멈춘다(`plan-behind-remote`) — 받은 뒤 다시 집는다.

**여러 사람이 쓰기 전에** 개발 준비 검사를 `--fix`로 한 번 돌린다(`team-sharing`): 원장에 `merge=union` 병합 규칙을,
`change-scope.md`·`ticket-assessments/`·`work-links/`·`ticket-drafts/`·`change-journal/`·`flow-log.jsonl`(개발자 로컬 기록)과 계획 판본 스냅샷(`*-revisions/`)·
승인 기록·원본 자료(`00_source/fetched·imported`)에 git 제외를 넣는다 — 팀이 읽지 않는 기계 산출물로 PR을 키우지 않는다
(원본이 없는 클론에서는 계획을 다시 `claim`하지 못한다 — 계획은 작성자가 고친다).
사람이 만든 개발 티켓만 쓰는 팀(원장 없이 트래커 설정만)도 같은 검사를 받는다. 없으면 원장이 충돌하고 남의 로컬 기록이 픽업을 막는다.

**머지 후 트래커 닫기**: GitHub은 `Closes #N`이 기본 브랜치 머지에서만 닫는다. 통합 브랜치 머지를 위해
개발 준비 검사가 `assets/ticket-close.yml`·`close-merged-tickets.mjs`(v5)를 설치한다 — **PR 제목의 이슈 번호**를, 그 PR이
기대 base(커밋된 계획의 baseBranch, 없으면 기본 브랜치)에 머지됐을 때만 닫는다. Jira는 닫지 않고, 부모 FEAT·집계 티켓도
닫지 않는다. 옛 판본 사본이 남아 있으면 준비 검사가 알린다(덮지 않는다).

### `board --by-feature` — 부모 FEAT 집계

필수 WORK가 전부 머지된 FEAT도 `works-merged`일 뿐 **인수 완료가 아니다** — 통합 revision의 TC 증거가 아직
연결되지 않아 닫을 수 있다고 하지 않는다. 제품 유예는 분모에서 빠지고 후속 상세화는 분모에 남는다. 트래커에
FEAT 단위로 보이게 하려면 `claim --publish --aggregate`로 집계 티켓을 낸다(개발 대상이 아니다).

## 보고 — CLI가 준 말을 그대로 옮긴다

CLI는 이미 사람이 읽을 문장(`guidance`·`notes`·`errors`·`bounce`)을 낸다. 그것을 **자기 말로 다시 쓰지
않는다** — 다시 쓰는 순간 하네스가 말하지 않은 원인·평가가 섞이고, 사용자는 어디까지가 도구의 판정인지
구분할 수 없게 된다.

**어느 명령에서도 넣지 않는다**: 하네스가 말하지 않은 원인을 따로 조사해 설명하는 절 · 하네스 판본 비교나
무엇이 바뀌었다는 설명 · 앞선 답을 정정하는 해설 · 요청하지 않은 평가·제안 · 게이트를 넘기는 방법
(`--accept-*`는 사용자가 물을 때만 말한다). 사용자가 물으면 그때 답한다.

| 명령 | 답의 형태 |
|---|---|
| `board` | 표 하나(`키 · 제목 · 상태 · 담당 · 다음 할 일`) + `notes` 그대로 + 한 줄 질문. 다른 열·절을 만들지 않는다 |
| `pickup` 확인(`outcome: confirm`) | 착수 가능이면 `review`만 — AI가 **제안한** 완료 조건·테스트 항목, 수정 범위, 레인, 임의 디자인·기획 미정 가정(알림 문구 포함), 겹치는 진행 중 작업과 동료 진행 티켓(있으면). 착수 불가면 `requestComment`를 그대로. 끝에 확인을 묻는 한 줄 |
| `pickup` 멈춤(`outcome: stopped`) | 「멈췄습니다」와 `guidance`·`bounce`의 이유·정해야 할 것을 그대로. 결과 코드(`TICKET_…`)를 보여주지 않고, 왜 막혔는지 따로 조사하지 않는다 |
| `create` 미리보기·결과 | 만들 티켓 제목 목록과 이미 있는 것(키), `recentDone`(최근 끝난 개발 티켓 — 못 읽었으면 그 사유)과 겹침을 확인해 달라는 한 줄. 결과면 만든 키와 「다음은 pickup」 한 줄. `errors`는 그대로 |
| `pickup` 시작(`outcome: started`) | 무엇이 나갔는지(배정·전이·코멘트)와 다음 할 일 한 줄. change-scope 내용을 풀어 쓰지 않는다. `trackerRead.guidance`·`ticketWork.guidance`가 있으면 그 한 줄도 옮긴다 |
| `claim` 검토 | `phase`와 다음 할 일. 계획을 통째로 다시 설명하지 않는다 |
| `claim --publish` 미리보기 | 무엇을 어디에 낼지 그대로 + 확인 한 줄 |
| `link` | 충족·미충족 항목 그대로 + `prBody`(PR 본문에 넣을 문단). `--dry-run`이면 `review`의 리뷰어로 리뷰한 뒤 연결한다. 미충족마다 해법을 지어내지 않는다. `commitSplit.guidance`·`scopeDrift.guidance`·`prTitle.guidance`·`prSize.guidance`가 있으면 그 한 줄도 옮긴다 |
| `*_INVALID` 오류 | `errors`를 목록으로 옮긴다. 해설·우회 제안을 붙이지 않는다 |

## 비협상

- 외부 쓰기(발행·배정·전이·코멘트·PR)는 **미리보기 또는 사용자의 요청 → 실행**. 침묵 자동발사 금지.
  커밋·푸시도 예외가 아니다 — 커밋 직전에 계획을 보여 주고 승인받는다(3). PR은 그와 별도로 확인받는다(6).
- 확인한 판본만 발행한다. 불확실을 부재로 읽지 않는다. 완료는 머지를 관측했을 때만이다.
- 증거 위조 금지 — 완료 판정은 프록시(TC 인용·대상 변화)이며 통과 판정을 주장하지 않는다.
- 컨플릭 자동 해결·최종 develop 머지는 하지 않는다(사람 몫 — 정직 경계).
