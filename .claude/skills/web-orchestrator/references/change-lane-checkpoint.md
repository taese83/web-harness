# change 레인 → 개발 — 스팩 승인 체크포인트

`change` 레인(`request-type-contract.md`)은 **동작을 새로 정의한다.** 정의가 맞는지 확인받기 전에
구현하면 되돌림이 코드에서 일어난다. 사람 티켓 작업(change-scope `origin: ticket`)은 `specApproval: required`일 때만
이 문서를 거친다(`team-flow/references/ticket-work-contract.md` 흐름 6). 아래 네 단계를 거친 뒤 사용자에게 보여주고 확인한다.
`execution-contract.md` Iterate 1-A가 부른다. 질문 규칙은 `approval-checkpoints.md`와 같다(한 번에 최대 3개).

## ① 기획 개정 — 항상

바뀌는 요구사항과 Feature List 항목만 개정한다. `tech-advisor`는 실행하지
않는다 — 스택은 이미 고정돼 있고 이번 변경이 그것을 바꾸지 않는다.
바꾼다면 그때만 해당 wave로 승격한다.

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

그 밖의 경우에는 **이번 변경 범위만큼의 기획을 세운다**. 전체 기획을 소급해 만들지 않는다.
세울지는 묻지 않는다 — 세우는 것이 기본이고 `unverifiable` 유지는 사용자가 먼저 원할 때만이다. 요청이 구조를
가르는 선택(`interaction-contract.md` 「질문이 필요한 경우」)을 남기면 기획 wave 전에 그것만 묻고, 나머지 미결은
기획 산출물의 `ASSUMPTION`·`NEEDS_DECISION`으로 ✋에 싣는다.

- `product-planner`(요구사항·decision-log 경량 재호출 — 조사하지 않는다)·`feature-planner`를 **이번 변경 범위로 한정해** 실행하고, 그 결과를
  `_workspace/01_plan/feature-plan.md`에 FEAT/TC로 추가한다(파일이 없으면 여기서 생긴다).
- 그 순간 `provenance-contract.md` §3 지연 공급이 발동한다 — 새 입력이 `LOCK_INPUTS`에 들어가
  스팩이 stale이 되므로 ④에서 `acceptanceSource: "feature-plan"`으로 **재확정**한다.
- 결과로 `specTier`가 `unverifiable` → `verifiable`로 오른다. 기획 없이 시작한 프로젝트도
  기능이 추가되며 수용 기준이 자란다 — `docs/brownfield-adoption.md`의 L3 점진 정본화와 같은
  방향이며, 소급 기획을 요구하지 않고 그 지점에서 필요한 만큼만 만든다.
- 사용자가 그것도 원하지 않으면(티켓 작업이 아닐 때) `unverifiable`을 유지할 수 있다. 그때는 `approval-checkpoints.md`의
  「기획·디자인 `absent` 진입 → 개발」 ③ 명시 인수를 **이번 라운드에 대해 다시** 받는다 —
  한 번의 인수가 이후 모든 기능 추가로 확장되지 않는다.

## ② 디자인 델타 감지 — 항상, 리서치 없음

개정된 기획을 `_workspace/02_design/`의 canonical 문서와 **대조**해 어긋나는 것을 뽑고
`DOCS_TO_UPDATE`(`minimal-change-contract.md`)에 기록한다. 새로 만드는 것이 아니라 대조다 —
리서치(`product-planner`의 조사·UX brief 재작성)는 실행하지 않는다.

**감지 결과가 비어 있어도 그 사실을 남긴다.** `DOCS_TO_UPDATE: none (대조: layout-spec,
component-spec, api-schema, design-system, state-contract)`처럼 **무엇을 대조했는지** 함께 적는다.
비었다는 결론과 게으른 감지는 결과가 같아서, 대조 목록이 없으면 구분할 수 없다.

## ③ 감지된 문서만 개정

`DOCS_TO_UPDATE`에 나열된 문서만 그 문서의 설계 에이전트(API는 `api-schema-designer`)로 개정한다. 나열되지 않은 문서는 손대지
않는다. 신규 화면·데이터 계약·아키텍처 변경이면 그 부분만 승격한다.

## ④ 스팩 확정

변경 범위의 스팩(수용 기준·TC)을 확정한다. 없으면 실측으로 만든다. `node .claude/scripts/spec.mjs --project-root {root}`의
stdout을 `_workspace/03_dev/spec.json`에 그대로 저장한다(원장은 스크립트가 append한다 — `solution-design-contract.md`).
미결 결정이 남아 `SPEC_NOT_SETTLED`로 거부되면 그 결정을 ✋에 싣는다.

## ✋ 승인 체크포인트

다음을 보여주고 확인한다. **확인 전에는 source edit를 시작하지 않는다.**

- 기획 변경: 개정된 요구사항·Feature List 항목 (변경된 행만)
- 디자인 변경: `DOCS_TO_UPDATE`와 **대조한 문서 목록**, 각 문서의 개정 요지 1줄
- 스팩: 수용 기준과 TC, `LOCAL_VERIFIABLE | DEPLOY_ONLY` 라벨
- change brief: `ALLOWED_PATHS`·`PUBLIC_CONTRACTS_TO_PRESERVE`·`NON_GOALS`·`CAPABILITY_ESCALATION`
- 새 `ASSUMPTION`·`NEEDS_DECISION`·`BLOCKED`

수정 요청이 있으면 해당 단계만 다시 실행하고 체크포인트를 반복한다.

`fix`·`verify` 레인은 이 체크포인트를 거치지 않는다 — 동작을 새로 정의하지 않으므로 승인받을
대상이 없다. 대신 유형별 보존 증거(`request-type-contract.md`)가 의무다. (`verify`의 준비 단계가
source를 만들 때의 **착수** 승인은 이 체크포인트와 별개다 — `web-verify`·`visual-design-verify`가 소유한다.)

## 일반화 근거

- **기획·디자인 `absent`로 세운 브라운필드 웹 앱** — ①이 변경 범위만큼 기획을 세우고(`product-planner`·
  `feature-planner`) ✋에서 멈춘다. 배포본 평가 `change-lane-stops-at-spec-approval`(3회 실행)로 확인한다.
- **사람 티켓 작업**(`origin: ticket`, `specApproval: required`) — 기준이 티켓 완료 조건·`TT-`라 ①이 기획을 세우지
  않고 라벨만 남긴다. 명명 수준 — 평가 사례가 없다.
- **요구사항이 바뀌지 않는 변경**(`infrastructure`) — ①이 `none`과 사유를 남기고 ②~✋는 그대로 선다. 명명 수준.
