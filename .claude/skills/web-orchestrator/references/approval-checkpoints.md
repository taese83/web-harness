# Phase Approval Checkpoints

## Phase 1 → Phase 2

Phase 1이 끝나면 다음 내용을 사용자에게 보여주고 명시적으로 확인한다.

- 서비스명과 사용자 목표
- 대상 화면/기능, 현재 pain, 관찰 가능한 성공 조건
- **Feature List 다듬기**: `feature-plan.md`의 Feature List 표(FEAT ID·가치·우선순위·화면 매핑)를 그대로 보여주고 항목별 `keep | cut | defer`를 확인한다 — 최대 2라운드, 라운드마다 변경된 행만 재표시, 결정은 decision-log에 `PC-NNN` 엔트리로 기록 (`design-readiness-contract.md`, `plan-history-contract.md`)
- ux-brief의 디자인 방향 요약과 `ASSUMPTION(시안 확정)` 항목 (프리뷰 루프에서 확정 예정임을 안내)
- 자동 `UX Check`, critical state, 정규화한 주석과 Phase 2 확인 항목
- `mock | dev-read-only | real-read-only | production-integration-later` 데이터 전략과 Mock→real 조건
- `S | M | L | XL` 상대 노력도, driver, `invest | reduce | split`, 가장 작은 가시적 검토 단위
- `WEB_PROFILE`, 주요 라이브러리, provider/runtime target
- 미해결 `ASSUMPTION`, `NEEDS_DECISION`, `BLOCKED`
- `plan-review.md`의 `PASS | NEEDS_DECISION | BLOCKED`와 최대 3개의 우선 결정사항

수정 요청이 있으면 해당 planning wave만 다시 실행한 후 체크포인트를 반복한다. 확인 전에는 Phase 2를 시작하지 않는다.

## Phase 2 → Phase 3

**판정 기준: 개발이 이 문서만으로 질문 없이 진행 가능한가.** 보여주고 "괜찮아 보인다"를 받는
것이 승인이 아니다 — 사람이 읽기에 충분한 문서와 **기계가 읽을 수 있는 문서**는 다르고,
그 간극의 대가는 개발 중의 질문으로 돌아온다(2026-08-30 실측: 병렬 순서가 산문 한 줄에만
있어 11건이 전부 착수 가능으로 보였고, FEAT별 경로가 없어 충돌 검사가 통째로 미수행이었다).

```bash
node .claude/scripts/validate-handoff-readiness.mjs --project {root} --to development
```

`HOLES`면 **승인을 진행하지 않는다.** 각 구멍은 "개발 중에 되묻게 될 것"의 목록이며,
지금 메우는 비용이 그때 메우는 비용보다 싸다. 검사 항목은 다음 단계의 기계가 실제로 읽는
것에서 도출한다 — 의존·경로 선언, 설계 미결정 종결, 스팩 tier, 확정 결정의 실물 반영.

그 위에 아래 내용을 사용자에게 보여주고 명시적으로 확인한다.

- 화면·route 목록과 핵심 정보 구조
- shared/feature component 목록과 기존 디자인 재사용 범위
- API endpoint, Mock/OpenAPI adoption, 상태 및 오류 계약
- 색상·타이포그래피·responsive/layout-stability 기준
- `DESIGN_PROTOTYPE_MODE`와 prototype/screenshot이 있으면 시각 자료
- Design Preview Loop 결과: 프리뷰 URL(또는 스크린샷), FEAT/TC 배지·side panel 추적성, 시안 확정 내역(커밋 방향·기각 방향·근거), `validate-design-preview.mjs`의 `APPROVED` 상태, `design-review.md`의 source/preview/traceability 승인 해시, 미결 `NEEDS_DECISION` (`design-approval-contract.md`) — 프리뷰는 실렌더링 근사치라는 한계 문구 포함
- `VISUAL_QA_MODE`이면 target/state/mode matrix, reference mapping, threshold와 baseline 승인자
- 새 `ASSUMPTION`, `NEEDS_DECISION`, `BLOCKED`
- `design-review.md`가 있으면 최대 3개의 우선 결정사항

수정 요청이 있으면 해당 design wave만 다시 실행한 후 체크포인트를 반복한다. 확인 전에는 Phase 3 source edit를 시작하지 않는다.

## change 레인 → 개발

`change` 레인(`request-type-contract.md`)은 **동작을 새로 정의한다.** 정의가 맞는지 확인받기 전에
구현하면 되돌림이 코드에서 일어난다. 아래 네 단계를 거친 뒤 사용자에게 보여주고 확인한다.

### ① 기획 개정 — 항상

바뀌는 요구사항과 Feature List 항목만 개정한다. `tech-advisor`·`planning-synthesizer`는 실행하지
않는다 — 스택과 project-brief는 이미 고정돼 있고 이번 변경이 그것을 바꾸지 않는다.
바꾼다면 그때만 해당 wave로 승격한다.

요구사항이 실제로 바뀌지 않는 변경(예: `infrastructure`)이면 개정할 것이 없다. 그때는 빈
단계를 통과시키지 말고 **`기획 개정: none (사유: 사용자 관찰 동작 무변경)`**을 남긴다 —
「바꿀 게 없었다」와 「안 봤다」를 구분하기 위해서다.

### ② 디자인 델타 감지 — 항상, 리서치 없음

개정된 기획을 `_workspace/02_design/`의 canonical 문서와 **대조**해 어긋나는 것을 뽑고
`DOCS_TO_UPDATE`(`minimal-change-contract.md`)에 기록한다. 새로 만드는 것이 아니라 대조다 —
`ux-researcher` 같은 리서치 에이전트는 실행하지 않는다.

**감지 결과가 비어 있어도 그 사실을 남긴다.** `DOCS_TO_UPDATE: none (대조: layout-spec,
component-spec, api-schema, design-system, state-contract)`처럼 **무엇을 대조했는지** 함께 적는다.
비었다는 결론과 게으른 감지는 결과가 같아서, 대조 목록이 없으면 구분할 수 없다.

### ③ 감지된 문서만 개정

`DOCS_TO_UPDATE`에 나열된 문서만 해당 Phase 2 에이전트로 개정한다. 나열되지 않은 문서는 손대지
않는다. 신규 화면·데이터 계약·아키텍처 변경이면 그 부분만 승격한다.

### ④ 스팩 확정

변경 범위의 스팩(수용 기준·TC)을 확정한다. 없으면 실측으로 만든다.

### ✋ 승인 체크포인트

다음을 보여주고 확인한다. **확인 전에는 source edit를 시작하지 않는다.**

- 기획 변경: 개정된 요구사항·Feature List 항목 (변경된 행만)
- 디자인 변경: `DOCS_TO_UPDATE`와 **대조한 문서 목록**, 각 문서의 개정 요지 1줄
- 스팩: 수용 기준과 TC, `LOCAL_VERIFIABLE | DEPLOY_ONLY` 라벨
- change brief: `ALLOWED_PATHS`·`PUBLIC_CONTRACTS_TO_PRESERVE`·`NON_GOALS`·`CAPABILITY_ESCALATION`
- 새 `ASSUMPTION`·`NEEDS_DECISION`·`BLOCKED`

수정 요청이 있으면 해당 단계만 다시 실행하고 체크포인트를 반복한다.

`fix`·`verify` 레인은 이 체크포인트를 거치지 않는다 — 동작을 새로 정의하지 않으므로 승인받을
대상이 없다. 대신 유형별 보존 증거(`request-type-contract.md`)가 의무다.

## 질문 규칙

한 번에 최대 3개만 질문한다. 구조를 바꾸지 않는 세부 선호는 제안값과 근거를 함께 제시하고 승인 항목에 포함한다.
