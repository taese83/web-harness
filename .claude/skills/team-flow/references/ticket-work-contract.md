# 사람이 만든 개발 티켓 → WORK (판정 계약)

사람이 트래커에 직접 만든 개발 티켓(팀이 `개발 티켓`으로 선언한 Jira 컴포넌트 · GitHub 라벨)을 `pickup <키>`가 받는다.
기획·디자인이 필요 없으면 **티켓을 WORK 모양으로 완성**해 착수하고, 필요하면 착수하지 않고 티켓에 요청을 남긴다.
검토한 계획이 발행한 WORK와 같은 픽업·편집 대조·링크·머지 판정·보드·자동 닫기를 탄다. 코드: `ticket/ticket-work.mjs`(검증) ·
`ticket/ticket-work-run.mjs`(실행).

## 흐름

0. 진입 가드(외부 쓰기 0): 원장이 이 키를 **계획 WORK로 발행**했으면(마커를 못 읽은 경우) `TICKET_IS_PLAN_WORK` ·
   집계·공급 원문·옛 FEAT 마커가 있거나 원장이 집계 티켓으로 아는 키면 `TICKET_NOT_DEV_WORK` ·
   제목·본문이 **인젝션 의심**이면 `TICKET_INJECTION_SUSPECT`. 셋 다 판정 요청·미리보기·쓰기보다 먼저 멈춘다.
1. `pickup <키> --developer <나>` → 판정서가 없으면 `TICKET_ASSESSMENT_REQUIRED`(외부 쓰기 0). CLI가 원문을 **격리 스냅샷**
   (`ticket-assessments/<키>.ticket.md` — 에이전트가 쓸 수 없는 자리)으로 남기고, 스킬이 `system-architect`를
   **티켓 판정 모드**로 스폰한다. 에이전트는 트래커 본문이 아니라 이 스냅샷을 읽는다.
2. 에이전트가 `_workspace/03_dev/ticket-assessments/<키>.json`을 쓴다(아래 스키마). 스킬이 **같은 턴에서** 다시 `pickup` → CLI가 검증한다.
   1~2는 사용자에게 보고하지 않는 중간 단계다(`outcome: assessing`).
3. 판정이 `needs-planning`·`needs-design`·`undecidable`이면 **티켓에 그 판정 라벨을 달고 요청 코멘트**를 단다(exit 2). 같은 판정서로 다시 부르면
   코멘트를 쌓지 않는다(코멘트 마커의 판정서 지문 `asm=`).
   코멘트는 **새 판정서일 때만** 단다 — 같은 판정서로 다시 불러도 쌓이지 않는다.
4. `startable`이면 `TICKET_WORK_PREVIEW`(`outcome: confirm`) — 사용자에게는 `review`(AI가 제안한 완료 조건·테스트 항목, 수정 범위,
   레인, 추가될 라벨, 하지 않는 것, 디자인 부채)만 보여준다 — 이 확인이 스팩 승인을 대신하므로 승인 대상을 빠짐없이 싣는다. 결과에는 판정·완료 조건·테스트 항목·**완성될 본문** 전체가 함께 실린다.
   트래커에 쓰지 않는다. 미리보기 본문의 「원문」 자리는 크기만 적는다(비신뢰 원문을 싣지 않는다 — 쓸 때 그대로 보존한다).
   진행 중 작업과 겹쳐 착수할 수 없으면 티켓을 채우지 않는다.
5. 개발자가 확인하면 스킬이 결과의 `confirmWith`(`--assessment <지문>`)를 붙여 다시 부른다 — 지문은 사용자에게 보이지 않는다.
   지문이 지금 판정서와 다르면 멈춘다(미리보기 뒤에 판정서가 바뀌었다).
6. 티켓 완성(본문 · 역할 라벨 · 보이지 않는 마커 · 판정 라벨 제거) = **등록** → 기존 픽업(배정·전이·change-scope).
   **티켓이 등록 기록이다** — 원장에 쓰지 않고 AI 맥락도 첨부하지 않는다. 픽업·보드·`link`는 티켓을 읽어 등록을 안다(모든 클론이 같은 것을 본다).
   change-scope의 `origin: ticket`, `lane`, `specApproval`. **`specApproval: required`(change이면서 자기검사 다섯 항목이 모두
   「아니오」가 아님)일 때만** 구현 전에 `/wh change`의 1-A 스팩 승인을 거친다. fix와 새 계약 없는 change는 미리보기 확인이 승인이다 —
   판정서 검증이 수정 범위가 스팩 경계 안이고 새 route가 없음을 이미 확인했다.

## 판정 기준

`/wh` fix 자기검사(`web-orchestrator/references/request-type-contract.md`)의 다섯 항목에 **예·아니오·모름과 근거**를 적는다.
모름은 착수 불가로 센다.

| 판정 | 조건 |
|---|---|
| `startable` + `fix` | 다섯 항목 전부 아니오(동작 보존) |
| `startable` + `change` | 새 동작이지만 아래 필요 조건에 해당하지 않는다 · 새 route·화면은 아니다 · 테스트 항목 1개 이상 |
| `needs-planning` | 완료 조건을 관찰 가능한 문장으로 주지 못한다 · 새 사용자 흐름·정책(권한 규칙·데이터 보존/삭제·금액·상태 전이)을 정해야 한다 · 여러 기능에 걸친다 · 기존 계획 FEAT의 동작을 바꾼다 |
| `needs-design` | 새 route·화면 · 모양이 정해지지 않은 사용자에게 보이는 새 상태 · 디자인 연결이 있는 프로젝트에서 연결 없는 조건 |
| `undecidable` | 스팩(소유 경계)이 없다 · 수정 범위를 정할 수 없다 · 필수 항목에 모름 |

디자인 없이 운영하는 팀에서 기존 화면에 상태를 더하는 일은 `designNeeds`에 `blocking: false`(부채)로 적고 진행할 수 있다.
새 화면은 언제나 `needs-design`이다.

## 판정서 스키마

```json
{
  "schemaVersion": 1,
  "ticket": {"key": "AOA-31", "provider": "jira"},
  "verdict": "startable | needs-planning | needs-design | undecidable",
  "lane": "fix | change | null",
  "objective": "이 작업이 이루는 것 한 문장",
  "roles": ["fe"],
  "selfCheck": [{"id": "new-route | new-data-contract | new-auth-path | new-external-dependency | public-contract-change",
                 "answer": "yes | no | unknown", "evidence": ["src/app/routes.tsx:12"]}],
  "planningNeeds": [{"what": "…", "why": "…"}],
  "designNeeds": [{"what": "…", "why": "…", "blocking": true}],
  "reasons": ["undecidable일 때 사유"],
  "writePaths": ["src/pages/members/list/"],
  "nonGoals": [],
  "acceptance": [{"text": "…", "source": "ticket | proposed"}],
  "testItems": [{"id": "TT-AOA-31-1", "text": "…", "source": "ticket | proposed"}],
  "dependsOn": []
}
```

CLI가 막는 것:

- 자기검사 다섯 항목 누락·근거 없음 · `fix`인데 「예」 · 착수 가능인데 「모름」 · 새 route인데 착수 가능
- `writePaths`가 비었거나 프로젝트 상대 경로가 아니거나 **스팩 `layerMap` 밖** · 스팩이 없음 — 경로 모양(`./` 접두·글롭 꼬리·파일/디렉터리)은
  소유권 훅과 같은 정규화로 읽되, 앱 접두(`apps/x/…`)는 붙이지 않는다
- `acceptance`가 비었음 · `source: ticket`인데 **원문에 그 문장이 없음**(지어낸 조건을 티켓 출처라 부르지 않는다)
- `testItems` ID가 `TT-<키>-<순번>`이 아님 · change인데 테스트 항목이 없음 — 기획 TC(`TC-…`)와 다른 공간이다
- `dependsOn`이 원장·계획에 없는 작업 · 미선언(`[]`로 명시한다)
- 진행 중(발행·등록됐고 머지 전)인 다른 작업과 `writePaths`가 겹침 → `ticket-overlaps-active-work`

`source: proposed`는 AI 제안이다. 개발자가 지문으로 확인하기 전에는 기준이 아니고 트래커에도 쓰지 않는다.

## 완성한 티켓

- 본문 = WORK 문서 섹션(완료 조건·테스트 항목·수정 범위·하지 않는 것·선행 작업·참고) + 맨 아래 **「원문」** 섹션에 사람 본문 그대로.
  편집 대조 파서는 「원문」 아래를 읽지 않는다.
- 마커는 계획 WORK와 같은 곳(GitHub 본문 주석 · Jira 이슈 속성). 계획 ID·작업 ID는 티켓 키에서 결정적으로 만든다 —
  쓰기 도중 실패해도 재시도가 같은 ID를 쓴다. 판본 자리는 판정서 지문이다.
- 역할 라벨을 더한다(떼지 않는다). 레인·스팩 승인·역할은 「참고」 절에 적는다 — 픽업이 되읽는다(없으면 스팩 승인을 받는다).
- 이후 사람 편집은 **정의를 바꾼다** — 본문이 정의이므로 다음 픽업이 고친 완료 조건·테스트 항목·수정 범위를 쓴다(편집 이력은 트래커에 남는다).
  집은 뒤 고쳤으면 `link`가 STALE로 막는다(`--accept-unverified-scope`로 넘기면 연결 기록에 남는다) — 다시 집으면 새 정의로 이어간다.
  등록 뒤에는 판정서의 출처(`ticket`·`proposed`)를 구별하지 않는다.
- 판정서를 고쳐 다시 확인하면 **재등록하고 본문을 새 판정서로 다시 쓴다.** 사람이 더한 항목이 새 판정서에 없으면
  `TICKET_EDITS_NOT_IN_ASSESSMENT`로 멈춘다 — 지금 티켓에 있는 항목이 새 판정서에 없으면 멈춘다(덮어써 잃지 않는다).

## 파일 수명

`_workspace/03_dev/ticket-assessments/`는 **작업 중에만 쓰는 로컬 파일**이다 — 커밋하지 않는다
(`.gitignore`에 `_workspace/03_dev/ticket-assessments/`를 넣는다). 남아야 할 사실은 티켓(본문·마커·라벨·코멘트)에 있다.

| 파일 | 지우는 때 |
|---|---|
| `<키>.ticket.md`(격리 사본) | 판정서가 검증을 통과하면 CLI가 지운다. 검증에 실패하면 다시 판정하도록 남긴다 |
| `<키>.json`(판정서) | `link`가 PR을 연결하면 지운다(정의는 티켓에 있다). 착수 불가 판정서는 남긴다 — 지우면 같은 티켓을 부를 때마다 다시 판정한다 |

## 보드

사람 티켓 절의 각 행은 `next`로 **다음 할 일**을 말한다. 판정 전(`unassessed`)과 착수 가능 판정
(`assessed` + `startable`)은 `blockedReason`이 없다 — 막힌 것이 아니라 `pickup`으로 이어가는 자리다.
막힌 행(기획·디자인 필요, 선행 미완료, 다른 개발자 배정)만 이유를 단다.

## 취소

등록된 티켓 작업을 다시 판정해 `needs-planning`·`needs-design`·`undecidable`이 나오면 그 판정 라벨이 **그 작업을 거둔다**(`withdrawn`) —
수정 범위를 놓고(겹침 대조에서 빠진다), 보드는 `ticket-<판정>`으로 막고, `link`는 `work-cancelled`로 막는다.
머지로 끝난 작업은 거두지 않는다. 다시 착수 가능으로 판정해 확인하면 같은 작업 ID로 되살아난다.
거두기 **전에** 이미 연결한 PR이 머지되면 완료다 — 머지는 사람의 승인이며, 머지가 판정보다 앞선다.

## 완료

`link <키> <PR>`은 완료 조건을 check로 잰다(대상 = 수정 범위 — 픽업 뒤 바뀌었는가) — 문장의 충족 자체는 자동 검증이 아니다.
테스트 항목 `TT-…`는 테스트 코드에 ID가 인용돼야 한다(기획 TC와 같은 규칙). 머지 판정·자동 닫기(v4)는 계획 WORK와 같다(옛 사본 재설치는 `work-plan-contract.md` 「자동 닫기」).
기획 없는 프로젝트의 `specTier`는 그대로 `unverifiable`이다 — 티켓 조건으로 올리지 않는다.

## 일반화 근거

인코딩하는 것은 「팀이 선언한 분류 + 스팩 소유 경계 + fix 자기검사」다. 컴포넌트·라벨 이름, 서비스 형태를 코드에 두지 않는다.

- **웹앱 UI 수정**(목록 화면에 상태 표시 추가) — 수정 범위는 화면 레이어, 새 화면이면 `needs-design`, 기존 화면 상태 추가는 change
- **API·CLI 비-UI 수정**(응답 필드 확장·명령 옵션 추가) — 수정 범위는 서버·명령 레이어, 공개 계약 변경이면 change이고 정책이 걸리면 `needs-planning`
- **트래커 두 종류** — Jira는 컴포넌트, GitHub은 라벨로 같은 분류를 선언한다(선언이 없으면 판정하지 않는다)

**진실 검증 수준: 명명 수준.** 판정 경계는 회귀·반증과 메모리 Jira e2e로 고정했고, 실 Jira(AOA) 왕복을 1회 돌았다(2026-09-16 — 판정 요구·요청 코멘트·미리보기 무쓰기·지문 확인·티켓 완성·사람 편집 반영·보드). PR 연결·머지 판정·자동 닫기 레그는 실 트래커에서 NOT_RUN이다.
`--assessment <지문>`은 **개발자 신원 증명이 아니다** — 지문을 본 누구(에이전트 포함)라도 붙일 수 있다. 스킬이 사용자 확인 뒤에만
붙이도록 규범으로 두며, 프록시 한계로 `docs/protected-core.md` §4에 등록했다.
