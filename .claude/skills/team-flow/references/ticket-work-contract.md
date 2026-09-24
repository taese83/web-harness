# 사람이 만든 개발 티켓 → WORK (판정 계약)

사람이 트래커에 직접 만든 개발 티켓(팀이 `개발 티켓`으로 선언한 Jira 컴포넌트 · GitHub 라벨)을 `pickup <키>`가 받는다.
**티켓 원본(본문·속성·라벨)은 고치지 않는다.** 판정·등록·연결은 개발자 로컬 기록(git 제외)이고, 티켓에는 배정·진행 전이와
사람이 읽는 코멘트(흐름 3·6 — 확인한 착수 불가 요청·임의 디자인 알림·가정 알림)만 남는다. 다른 클론은 배정·상태로만 안다.
확정한 판정은 계획이 발행한 WORK와 같은 픽업·링크·머지 판정·보드·자동 닫기를 탄다. 코드: `ticket/ticket-work.mjs`(검증) ·
`ticket/ticket-work-run.mjs`(실행).

## 흐름

0. 진입 가드(외부 쓰기 0): 원장이 이 키를 **계획 WORK로 발행**했으면(마커를 못 읽은 경우) `TICKET_IS_PLAN_WORK` ·
   집계·공급 원문·옛 FEAT 마커가 있거나 원장이 집계 티켓으로 아는 키면 `TICKET_NOT_DEV_WORK` ·
   제목·본문이 **인젝션 의심**이면 `TICKET_INJECTION_SUSPECT`. 셋 다 배정·판정 요청·미리보기·쓰기보다 먼저 멈춘다.
1. **배정이 먼저다.** 남이 배정돼 있으면 판정하지 않고 멈춘다(`TICKET_ASSIGNED_TO_OTHER`). 아니면 배정 직전에 다시 읽고 나로 배정한 뒤,
   배정 직후 다시 읽어 남도 보이면 물러난다. 착수 불가로 판정돼도 배정은 남긴다 — 판정한 사람이 필요하면 직접 푼다.
2. 판정서가 없으면 `TICKET_ASSESSMENT_REQUIRED`. CLI가 원문을 **격리 스냅샷**(`ticket-assessments/<키>.ticket.md` — 에이전트가 쓸 수 없는
   자리)으로 남기고, 스킬이 `system-architect`를 **티켓 판정 모드**로 스폰한다. 에이전트는 트래커 본문이 아니라 이 스냅샷을 읽고
   `_workspace/03_dev/ticket-assessments/<키>.json`을 쓴다(아래 스키마). 스킬이 **같은 턴에서** 다시 `pickup` → CLI가 검증한다.
   이 단계는 사용자에게 보고하지 않는 중간 단계다(`outcome: assessing`).
3. 판정이 `needs-planning`·`needs-design`·`undecidable`이면 **요청 코멘트를 먼저 보여 준다**(`requestComment`, 쓰기 0). 개발자가 확인하면
   스킬이 `confirmWith`(`--assessment <지문>`)를 붙여 다시 부르고, 그때 그 코멘트를 남긴다(라벨은 달지 않는다). 같은 판정서로 다시 확인해도
   코멘트를 쌓지 않는다(남긴 지문은 로컬 `<키>.notified.json`).
4. `startable`이면 `TICKET_WORK_PREVIEW`(`outcome: confirm`, 쓰기 0) — 사용자에게는 `review`(AI가 제안한 완료 조건·테스트 항목, 수정 범위,
   레인, 하지 않는 것, 디자인 부채, 임의 디자인·기획 미정 가정과 그 알림 문구)만 보여준다 — 이 확인이 스팩 승인을 대신하므로 승인 대상을 빠짐없이 싣는다.
   미리보기에는 비신뢰 원문을 싣지 않는다. 진행 중 작업과 겹치면 그 겹침과 선행을 함께 보여 주고, 확인 지문이 겹침을 묶는다(아래).
   확인 지문이 틀리면 기대 지문을 돌려주지 않고 미리보기부터 다시 보게 한다.
5. 개발자가 확인하면 스킬이 `confirmWith`를 붙여 다시 부른다 — 지문은 사용자에게 보이지 않는다. 지문이 지금 판정서와 다르면 멈춘다.
6. 확인 = **로컬 등록**(`<키>.registered.json` — 확정한 정의·판정서 지문·확인할 때의 원문 지문) → 기존 픽업(전이·change-scope).
   임의 디자인이면 그 사실을, 가정이 있으면 그 가정을 티켓 코멘트로 알린다(같은 판정으로는 한 번). change-scope의 `origin: ticket`, `lane`,
   `specApproval`, 그리고 있으면 `assumptions`·`designDebt`(구현이 따를 결정). **`specApproval: required`
   (change이면서 자기검사 다섯 항목이 모두 「아니오」가 아님)일 때만** 구현 전에 `/wh change`의 1-A 스팩 승인을 거친다.
   fix와 새 계약 없는 change는 미리보기 확인이 승인이다.

## 개발 티켓 양식 (손·하네스 공통)

손으로 만들든 하네스가 만들든(`create`) 개발 티켓 본문은 네 절이다 — 판정이 흔들리지 않게 같은 양식을 쓴다.

| 절 | 쓰는 법 | 판정서로 가는 곳 |
|---|---|---|
| 목적 | 이 작업이 이루는 것 한 문장. 아래에 `근거:`(기획 문서·페이지) 한 줄 | `objective` |
| 작업 내용 | 무엇을 어디에(경로) 만드는지 목록, 끝에 `하지 않는 것:` | `writePaths`의 근거 · `nonGoals` |
| 완료 조건 | 확인할 수 있는 문장만 목록으로. 의도 문장(「참고할 수 있게 한다」)은 쓰지 않는다 | `acceptance`(`source: ticket`) |
| 선행·협의 | `선행: <티켓 키 또는 같은 초안의 제목>` · `협의: 무엇이 미정 — 가정안` | `dependsOn`(티켓 키) · `assumptions` 또는 `needs-planning` |

`create`는 이 양식을 기계로 검사한다(네 절·완료 조건 목록·FEAT/TC 없음·같은 제목의 열린 개발 티켓 없음). 만든 티켓은
WORK 마커 없이 팀의 개발 티켓 분류만 붙어 손 티켓과 똑같이 `pickup`이 판정한다. 기획 요구사항(FEAT/TC)은 계획이 발행하는 WORK의 몫이다.

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
새 화면은 `needs-design`이다 — **임의 디자인 지시**가 있으면 예외다(`designByImplementer`):

- 티켓 본문에 「디자인은 임의로」 같은 지시가 있으면 `source: ticket`과 그 문장을 `quote`로 **그대로** 옮긴다 — CLI가 원문과 대조한다.
- 판정이 `needs-design`으로 나온 뒤 개발자가 「디자인은 임의로 하라」고 지시하면 `source: developer`로 다시 판정한다 — 미리보기 확인이 그 승인이다.
  사용자가 지시하지 않았는데 에이전트가 스스로 넣지 않는다.
- 어느 쪽이든 무엇을 임의로 정하는지 `designNeeds`에 비차단(`blocking: false`)으로 적고, 확인하면 티켓에 임의 디자인 알림 코멘트를 남긴다.
  기획 필요(`needs-planning`)에는 쓰지 않는다. 접근성 하한(키보드·레이블·대비)은 임의 디자인에서도 그대로다.

기획이 정하지 않은 **세부**(전달 방식·기본값·문구 같은 구현 선택)는 `assumptions`에 가정으로 적고 착수할 수 있다 — 임의 디자인과 대칭이다.
확인하면 가정 알림 코멘트를 티켓에 남겨 기획자가 바로잡을 수 있게 한다. 새 사용자 흐름·정책(권한 규칙·데이터 보존/삭제·금액·상태 전이)은
가정으로 정하지 않는다 — 그건 `needs-planning`이다. 이 구분은 판정 에이전트의 판단이고 CLI는 형식만 잰다.

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
  "dependsOn": ["WORK-… 또는 티켓 키(AOA-47 · #12)"],
  "designByImplementer": {"source": "ticket | developer", "quote": "ticket이면 원문 문장 그대로"},
  "assumptions": [{"what": "미정인 세부", "assumed": "어떻게 가정하는가", "why": "왜 가정해도 되는가"}]
}
```

CLI가 막는 것:

- 자기검사 다섯 항목 누락·근거 없음 · `fix`인데 「예」 · 착수 가능인데 「모름」 · 새 route인데 임의 디자인 지시 없이 착수 가능
- 임의 디자인: `source: ticket`인데 인용이 원문에 없음 · 비차단 디자인 부채가 없음 · 착수 가능이 아님
- 기획 미정 가정(`assumptions`): 착수 가능이 아님 · 항목에 무엇·가정·이유 중 빠진 것
- `writePaths`가 비었거나 프로젝트 상대 경로가 아니거나 **스팩 `layerMap` 밖** · 스팩이 없음 — 경로 모양(`./` 접두·글롭 꼬리·파일/디렉터리)은
  소유권 훅과 같은 정규화로 읽되, 앱 접두(`apps/x/…`)는 붙이지 않는다
- `acceptance`가 비었음 · `source: ticket`인데 **원문에 그 문장이 없음**(지어낸 조건을 티켓 출처라 부르지 않는다)
- `testItems` ID가 `TT-<키>-<순번>`이 아님 · change인데 테스트 항목이 없음 — 기획 TC(`TC-…`)와 다른 공간이다
- `dependsOn`의 WORK ID가 원장·계획에 없음 · 이 티켓 자신 · 미선언(`[]`로 명시한다). 사람 티켓은 **티켓 키**로 적는다 — 등록 전이어도
  키에서 작업 ID가 정해지고, 판정은 받되 착수는 선행이 머지(또는 트래커 완료)될 때까지 `dependency-incomplete`로 기다린다

CLI가 막지 않고 **보여 주는** 것: 이 클론이 아는 진행 중 작업(발행한 계획 작업 + 내가 등록한 티켓 작업, 머지 전)과 `writePaths`가 겹치면
미리보기 `review.overlaps`에 싣고, 확인 지문이 그 겹침 목록을 묶는다(판정서 지문만으로 확인하면 `TICKET_ASSESSMENT_MISMATCH`).
확인하면 겹친 채 등록하고 등록 기록에 `acceptedOverlaps`를 남긴다. 동료가 진행 중인 개발 티켓은 배정·상태로 `review.peers`에 보인다 —
수정 범위는 모르므로 겹침 판단은 사람 몫이고, 실제 충돌은 머지할 때 정리한다

`source: proposed`는 AI 제안이다. 개발자가 지문으로 확인하기 전에는 기준이 아니고 트래커에도 쓰지 않는다.

## 등록 기록(로컬)

- 확인한 판정은 `<키>.registered.json`에 둔다 — 정의(완료 조건·테스트 항목·수정 범위·레인·역할), 판정서 지문, 확인할 때의 원문 지문.
  작업 ID·계획 ID는 티켓 키에서 결정적으로 만든다. 티켓 본문·속성·라벨은 쓰지 않는다.
- 확인한 뒤 사람이 티켓 원문을 고치면 `link`가 원문 지문으로 알아보고 STALE로 막는다(`--accept-unverified-scope`로 넘기면 연결 기록과
  PR 본문 문단에 남는다) — 다시 판정·확인하면 새 정의로 이어간다.
- 판정서를 고쳐 다시 확인하면 등록 기록을 새 판정으로 바꾼다. 다시 판정해 착수 불가로 확인하면 등록 기록을 지운다(수정 범위를 놓는다).

## 파일 수명

`_workspace/03_dev/ticket-assessments/`는 **개발자 로컬 파일**이다 — 커밋하지 않는다(개발 준비 검사 `team-sharing`이
`.gitignore`에 넣는다). 팀이 함께 보는 사실은 트래커(배정·상태·코멘트)와 PR(제목·브랜치의 티켓 키·머지)에 있다.

| 파일 | 지우는 때 |
|---|---|
| `<키>.ticket.md`(격리 사본) | 판정서가 검증을 통과하면 CLI가 지운다. 검증에 실패하면 다시 판정하도록 남긴다 |
| `<키>.json`(판정서) | `link`가 PR을 연결하면 지운다(확정한 정의는 등록 기록에 있다). 착수 불가 판정서는 남긴다 — 지우면 같은 티켓을 부를 때마다 다시 판정한다 |
| `<키>.registered.json`(등록 기록) | 착수 불가로 다시 판정해 확인하면 지운다. 끝난 뒤에도 남는다(보드가 내 작업을 그린다) |
| `<키>.notified.json`(남긴 코멘트 지문) | 지우지 않는다 — 지우면 같은 판정의 코멘트를 다시 남길 수 있다 |

## 보드

사람 티켓 절은 **내 등록·판정(로컬)**과 트래커의 개발 티켓 목록(분류·배정)을 합친다. 각 행은 `next`로 **다음 할 일**을 말한다.
판정 전(`unassessed`)과 착수 가능 판정(`assessed` + `startable`)은 `blockedReason`이 없다 — 막힌 것이 아니라 `pickup`으로 이어가는 자리다.
막힌 행(기획·디자인 필요, 선행 미완료, 다른 개발자 배정)만 이유를 단다. 남의 사람 티켓은 배정으로만 보인다.

## 취소

등록한 티켓 작업을 다시 판정해 `needs-planning`·`needs-design`·`undecidable`로 확인하면 로컬 등록을 지운다 — 수정 범위를 놓고
(겹침 대조에서 빠진다), 요청 코멘트를 남긴다. 다시 착수 가능으로 판정해 확인하면 같은 작업 ID로 다시 등록한다.
거두기 **전에** 이미 연결한 PR이 머지됐으면 완료다 — 머지는 사람의 승인이며, 머지가 판정보다 앞선다.

## 완료

`link <키> <PR>`은 완료 조건을 check로 잰다(대상 = 수정 범위 — 픽업 뒤 바뀌었는가) — 문장의 충족 자체는 자동 검증이 아니다.
테스트 항목 `TT-…`는 테스트 코드에 ID가 인용돼야 한다(기획 TC와 같은 규칙). PR 제목이 티켓 키로 시작하거나 브랜치 이름에 키가 있어야 한다 — 머지 판정·자동 닫기(v5)는
계획 WORK와 같다(`work-plan-contract.md` 「완료」·「자동 닫기」).
기획 없는 프로젝트의 `specTier`는 그대로 `unverifiable`이다 — 티켓 조건으로 올리지 않는다. 대신 티켓 작업은 `unverifiable` 인수(`PC-NNN`)를
라운드마다 다시 받지 않는다 — 확인한 완료 조건·`TT-`가 그 라운드의 기준이다(1-A ①의 `ticket-acceptance`).

## 일반화 근거

인코딩하는 것은 「팀이 선언한 분류 + 스팩 소유 경계 + fix 자기검사」다. 컴포넌트·라벨 이름, 서비스 형태를 코드에 두지 않는다.

- **웹앱 UI 수정**(목록 화면에 상태 표시 추가) — 수정 범위는 화면 레이어, 새 화면이면 `needs-design`, 기존 화면 상태 추가는 change
- **API·CLI 비-UI 수정**(응답 필드 확장·명령 옵션 추가) — 수정 범위는 서버·명령 레이어, 공개 계약 변경이면 change이고 정책이 걸리면 `needs-planning`
- **트래커 두 종류** — Jira는 컴포넌트, GitHub은 라벨로 같은 분류를 선언한다(선언이 없으면 판정하지 않는다)

**진실 검증 수준: 명명 수준.** 판정 경계는 회귀·반증과 메모리 Jira·GitHub e2e로 고정했다. 로컬 등록·배정 먼저·확인 뒤 코멘트·임의 디자인
흐름과 PR 목록 조회·재오픈 이력 조회는 실 트래커에서 NOT_RUN이다.
`--assessment <지문>`은 **개발자 신원 증명이 아니다** — 지문을 본 누구(에이전트 포함)라도 붙일 수 있다. 스킬이 사용자 확인 뒤에만
붙이도록 규범으로 두며, 프록시 한계로 `docs/protected-core.md` §4에 등록했다.
