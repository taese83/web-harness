# change 레인 → 개발 — 스팩 승인 체크포인트

`change` 레인(`request-type-contract.md`)은 **동작을 새로 정의한다.** 정의가 맞는지 확인받기 전에
구현하면 되돌림이 코드에서 일어난다. 사람 티켓 작업(change-scope `origin: ticket`)은 `specApproval: required`일 때만
이 문서를 거친다(`team-flow/references/ticket-work-contract.md` 흐름 6). 아래 네 단계를 거친 뒤 사용자에게 보여주고 확인한다.
`execution-contract.md` Iterate 1-A가 부른다. 질문 규칙은 `approval-checkpoints.md`와 같다(한 번에 최대 3개).

## light 경로 — 쓰는 에이전트 하나

①~③을 기획·설계 스폰 대신 **developer 계획 패스 1회**로 한다. ④ 스팩 확정과 ✋ 승인은 그대로다.
기획·구현을 역할별 스폰으로 나누면 인계마다 결정이 새고 조정 비용이 커진다 — 한 컨텍스트가 계획하고 구현한다.

- **판정(기본값):** 요청이 제품 의도를 새로 정하지 않으면(새 사용자 역할·새 화면군·새 외부 연동이 없으면) light다. 사용자가 `full`을
  말하면 아래 ①~③이다.
- **기준은 문서가 아니라 라운드에 싣는다(문서 축소):** 계획 패스는 **기획 문서를 쓰지 않는다** — 이번 라운드의 완료 조건
  `ACC-R<n>-<k>`(각각 `LOCAL_VERIFIABLE | DEPLOY_ONLY`)와 테스트 항목 `TT-R<n>-<k>`를 반환하고, 메인이 change-scope 라운드 항목의
  `ACCEPTANCE`·`TEST_ITEMS`에 싣는다(`minimal-change-contract.md`). 사람 티켓 작업(`origin: ticket`)은 티켓 완료 조건·`TT-`가 그
  자리다. `PC-NNN`·plan-delta도 없다. **예외 하나:** 잠긴 스팩이 feature-plan을 결박했고(`acceptanceSource: feature-plan`) 이번
  라운드가 `acceptanceRefs`에 든 **승인된 TC의 동작을 바꾸면** — 안 고치면 승인된 TC가 코드와 어긋난다 — 메인이 다음 `PC-NNN`으로
  `validate-plan-delta.mjs --snapshot`을 뜨고 펜스에 `"PLAN_WRITEBACK": "tc-rows"`를 더한다. 그때만 developer가 그 TC 행과 plan-delta를
  고친다(requirements·decision-log·ux-brief는 쓰지 않는다). 훅이 이 세트를 강제한다(펜스는 좁히기만 하고 스팩이 천장이다).
- **계획 패스:** 메인이 change-scope.md에 아래 펜스를 **그대로**(info-string `json change-scope`까지) append한 뒤 developer를 스폰한다.
  그 범위가 현재인 동안 developer는 API 계약(웹 `api-schema.md`, 라이브러리·CLI `api-design.md`)만 쓴다 — 소유권 훅이 source·기획
  문서를 막는다. `solution-design.md`는 쓰지 않는다(결정 블록이 스팩의 layerMap, 곧 쓰기 소유권을 낳는다). 반환 뒤(write-back 라운드면
  `--verify` 뒤) ④ 스팩은 **입력이 바뀌었을 때만** ✋ 전에 다시 확정한다(API 계약·TC 행). `acceptanceRefs`·`specTier`는 그대로다.
  반환: `ACC-`·`TT-` 항목 · change brief 필드(`DOCS_TO_UPDATE: none (대조: …) | 목록` 포함) · 열린 질문(최대 3, 추천안 포함) ·
  개발 노트에 남길 것(결정·제약 — 없으면 `none`) · `ESCALATE_TO_FULL: none | <사유>`.

```json change-scope
{"PHASE": "plan", "ALLOWED_PATHS": ["_workspace/02_design/api-schema.md", "_workspace/02_design/api-design.md"]}
```

- **승격:** 새 레이어·라이브러리·형태, 그 밖의 `solution-design.md` 결정 변경이 필요하거나 제품 의도 결정이 남으면
  developer가 `ESCALATE_TO_FULL`로 알리고,
  메인은 ①~③으로 넘어간다(계획 패스가 반환한 `ACC-`·`TT-`는 ①의 입력이 된다).
- **✋ 뒤:** 메인이 구현 범위 펜스(`PHASE` 없음)를 append하고 **같은 developer를 이어서**(SendMessage) 구현시킨다. 이어가기가
  불가하면 새 developer 스폰에 계획 패스 반환과 승인된 `ACC-`·`TT-`를 넘긴다.

## ① 기획 개정 — 항상(full)

바뀌는 요구사항과 Feature List 항목만 개정한다. `tech-advisor`는 실행하지
않는다 — 스택은 이미 고정돼 있고 이번 변경이 그것을 바꾸지 않는다.
바꾼다면 `tech-advisor`로 `tech-stack.md`(정본 — validator가 읽는다)를, `system-architect`로 `solution-design.md`를
같은 값으로 개정하고 ④에서 재확정한다 — 한쪽만 바꾸면 조용한 불일치가 된다(`solution-design-contract.md` §3).

요구사항이 실제로 바뀌지 않는 변경(예: `infrastructure`)이면 개정할 것이 없다. 그때는 빈
단계를 통과시키지 말고 **`기획 개정: none (사유: 사용자 관찰 동작 무변경)`**을 남긴다 —
「바꿀 게 없었다」와 「안 봤다」를 구분하기 위해서다.

**개정할 기획이 아예 없으면**(`PLAN_SOURCE: absent`로 세운 프로젝트, `provenance-contract.md` §1)
`none`으로 넘기지 않는다. `change` 레인은 **동작을 새로 정의하므로** 그 정의가 맞는지 판정할
기준이 이번 변경 범위에는 필요하다 — `none`의 사유("사용자 관찰 동작 무변경")가 여기서는
거짓이 되고, 거짓 라벨을 남기는 것이 빈 단계를 통과시키는 것보다 나쁘다.

**사람 티켓 작업(change-scope `origin: ticket`)이면 기획을 세우지도, 인수를 다시 받지도 않는다** — 이번 범위의
기준은 이미 있다: 개발자가 픽업 미리보기에서 확인한 판정서의 완료 조건과 `TT-` 테스트 항목이다(`approval-checkpoints.md` 「기획·디자인 `absent`
진입 → 개발」 ③의 티켓 예외와 같은 근거). ①에는 **`기획 개정: ticket-acceptance (<티켓 키> — 완료 조건 N · TT M)`**을
change-scope 라운드 항목에 남긴다 — 기준의 출처가 티켓이라는 사실이 라벨로 남고 `specTier`는 그대로다(기준 원문은 티켓, 인용은 PR의 `TT-`). 완료 조건이 비어 있거나 개발자 확인 전이면
이 예외는 서지 않는다(픽업이 이미 막는다). ②~④와 ✋승인은 그대로 선다 — ✋의 「스팩」 줄에는 그 완료 조건·TT를 싣는다.

그 밖의 경우(기획 `absent`)도 **기획 문서를 세우지 않는다** — 이번 라운드의 완료 조건·테스트 항목(`ACC-R<n>-<k>`·`TT-R<n>-<k>`,
light와 같은 형태)을 change-scope 라운드 항목에 싣고 ①에 **`기획 개정: change-acceptance (<라운드> — ACC N · TT M)`**을 남긴다.
기준의 출처가 이 라운드라는 사실이 라벨로 남고 `specTier`는 그대로다(`unverifiable`이 정직한 표시다). ✋에서 사용자가 그 기준을
승인하는 것이 이번 라운드의 인수다(`approval-checkpoints.md` ③의 예외와 같은 근거) — 한 번의 승인이 이후 라운드로 넓어지지 않는다.
요청이 구조를 가르는 선택(`interaction-contract.md` 「질문이 필요한 경우」)을 남기면 그것만 묻고, 나머지 미결은 ✋에
`ASSUMPTION`·`NEEDS_DECISION`으로 싣는다. 기획을 세워 `verifiable`로 올리고 싶으면 사용자가 `plan` 레인을 명시한다.

기획이 **있는** 프로젝트의 full ①은 `product-planner`(요구사항·decision-log 경량 재호출 — 조사하지 않는다)·`feature-planner`를
**바뀌는 행만** 개정하도록 실행한다(새 FEAT/TC는 `acceptanceRefs`에 들 때만 쓴다). decision-log 항목은 결정 한 줄씩이다.

## ② 디자인 델타 감지 — 항상, 리서치 없음

개정된 기획을 `_workspace/02_design/`의 canonical 문서와 **대조**해 어긋나는 것을 뽑고
`DOCS_TO_UPDATE`(`minimal-change-contract.md`)에 기록한다. 새로 만드는 것이 아니라 대조다 —
리서치(`product-planner`의 조사·UX brief 재작성)는 실행하지 않는다.

**감지 결과가 비어 있어도 그 사실을 남긴다.** `DOCS_TO_UPDATE: none (대조: layout-spec,
component-spec, api-schema, design-system, state-contract)`처럼 **무엇을 대조했는지** 함께 적는다.
비었다는 결론과 게으른 감지는 결과가 같아서, 대조 목록이 없으면 구분할 수 없다.

**대조 대상은 `02_design/`에 실재하는 문서뿐이다**(`minimal-change-contract.md`) — 위 목록은 예시다. 시각 설계
문서(design-system·layout-spec·component-spec)는 `DESIGN_SOURCE`가 다스린다: 디자인 `absent` 프로젝트에서 없는 시각 설계
문서는 `DOCS_TO_UPDATE`에 넣지 않고 이 레인에서 세우지 않는다 — 화면 조건은 `phase-3-development.md` 「디자인 부채 청구」가
첫 화면 스폰 전에 받는다. 모드 계약(state-contract·performance-budget)과 API 계약(api-schema·api-design)은 공급원과
무관하다 — 이번 변경이 모드를 켜거나 계약을 만들면 그 설계자가 신설하고 `DOCS_TO_UPDATE`에 `신설 — 모드: …`로 적는다.
라벨은 실제 대조 집합을 적는다: `none (대조: solution-design; 시각 설계 문서 없음 — DESIGN_SOURCE: absent)`.

## ③ 감지된 문서만 개정

`DOCS_TO_UPDATE`에 나열된 문서만 그 문서의 설계 에이전트(API는 `api-schema-designer`)로 개정한다. 나열되지 않은 문서는 손대지
않는다. 데이터 계약·아키텍처 변경은 각 설계자(`api-schema-designer`·`system-architect`)로 개정한다. 없는 시각 설계 문서를
새로 만드는 것은 개정이 아니다 — 필요하다고 보면 ✋에 `NEEDS_DECISION`으로 올리고, 승인되면 `provenance-contract.md` §3
지연 공급(그 단계 wave만) 뒤 ④를 재확정한다.

## ④ 스팩 확정

변경 범위의 스팩(수용 기준·TC)을 확정한다. 없으면 실측으로 만든다. `node .claude/scripts/spec.mjs --project-root {root}`의
stdout을 `_workspace/03_dev/spec.json`에 그대로 저장한다(원장은 스크립트가 append한다 — `solution-design-contract.md`).
미결 결정이 남아 `SPEC_NOT_SETTLED`로 거부되면 그 결정을 ✋에 싣는다.

## ✋ 승인 체크포인트

다음을 보여주고 확인한다. **확인 전에는 source edit를 시작하지 않는다.**

- 기준: 라운드의 `ACC-`·`TT-`(또는 티켓 완료 조건·`TT-`), write-back 라운드·full이면 개정된 행만
- 디자인 변경: `DOCS_TO_UPDATE`와 **대조한 문서 목록**, 각 문서의 개정 요지 1줄. 디자인 `absent`면 유지한다고 적는다(청구는 첫 화면 스폰 전)
- 스팩: `LOCAL_VERIFIABLE | DEPLOY_ONLY` 라벨과 재확정 여부
- change brief: `ALLOWED_PATHS`·`PUBLIC_CONTRACTS_TO_PRESERVE`·`NON_GOALS`·`CAPABILITY_ESCALATION`
- 새 `ASSUMPTION`·`NEEDS_DECISION`·`BLOCKED`

수정 요청이 있으면 해당 단계만 다시 실행하고 체크포인트를 반복한다.

`fix`·`verify` 레인은 이 체크포인트를 거치지 않는다 — 동작을 새로 정의하지 않으므로 승인받을
대상이 없다. 대신 유형별 보존 증거(`request-type-contract.md`)가 의무다. (`verify`의 준비 단계가
source를 만들 때의 **착수** 승인은 이 체크포인트와 별개다 — `web-verify`·`visual-design-verify`가 소유한다.)

## 일반화 근거

- **기획·디자인 `absent`로 세운 브라운필드 웹 앱** — full은 ①이 기획을 세우지 않고 `change-acceptance` 라벨과 라운드 `ACC-`·`TT-`로
  ✋에서 멈춘다(평가 `change-lane-stops-at-spec-approval` — 요청이 full을 지정). light는 기획이 결박된 프로젝트에서도 계획 패스가
  기획 문서를 쓰지 않고 라운드 기준을 반환해 ✋에서 멈춘다(평가 `change-lane-light-plan-pass`, 시드 `brownfield-planned-project`).
  두 평가 모두 이번 변경 뒤 재실행 전이다.
- **라이브러리·CLI**(`api-design.md`) — 계획 패스가 쓰는 것은 API 계약뿐이고 기준은 같은 라운드 `ACC-`·`TT-`다. 명명 수준.
- **사람 티켓 작업**(`origin: ticket`, `specApproval: required`) — 기준이 티켓 완료 조건·`TT-`라 ①이 기획을 세우지
  않고 라벨만 남긴다. light 계획 패스는 기획 없는 시드에 티켓 범위를 얹은 평가 `change-lane-light-ticket-plan-pass`로 고정하되
  재실행 전이다.
- **요구사항이 바뀌지 않는 변경**(`infrastructure`) — ①이 `none`과 사유를 남기고 ②~✋는 그대로 선다. 명명 수준.
