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

## 기획·디자인 `absent` 진입 → 개발

기획 또는 디자인의 공급원이 `absent`인 경로(`provenance-contract.md` §1). 해당 Phase의
체크포인트는 **검사할 산출물이 없어서** 성립하지 않는다. 그 자리를 이 승인 하나가 대신한다.
빠지는 것은 체크포인트의 **대상**이지 강도가 아니다 — 아래 세 조건은 전부 기존 게이트다.

한 단계만 `absent`면 나머지 단계의 체크포인트는 **그대로 선다**. 디자인만 `absent`이면 Phase 1
체크포인트를 정상 수행하고 Phase 2 자리에 이 절이 들어간다. 기획이 있으면 `acceptanceSource`가
`feature-plan`이 될 수 있으므로 ③의 인수가 필요 없을 수도 있다 — ②의 실행 결과가 정한다.

### ① 스팩이 확정됐다 — 기계가 강제한다

`spec.mjs`가 `openDecisions`에 `status: "open"`이 하나라도 남으면 확정을 거부한다. 즉 설계자가
갈리는 결정을 스스로 닫을 수 없고, 오케스트레이터가 `interaction-contract.md`대로 사용자에게
물어 `confirmed`·`assumed`로 닫아야 확정이 난다. **기획이 없어도 사용자 왕복은 사라지지 않는다.**

### ② 인계 점검을 실제로 돌리고 결과를 그대로 보여준다

```bash
node .claude/scripts/validate-handoff-readiness.mjs --project {root} --to development
```

면제 집합은 **실측으로 확정한다**(2026-09-02, 기획 `absent` fixture 실행). 이 경로에서 나오는
HOLE은 2건이며, 둘 다 `absent` 선언이 곧 원인이다 — 독립된 결함이 아니라 **같은 사실의 재진술**이다.

| id | detail | 대조 | 면제 조건 |
|---|---|---|---|
| `plan` | `feature-plan이 없다` | 완전 일치 | `PLAN_SOURCE: absent`일 때만 |
| `spec` | `스팩이 unverifiable이다` | **접두 일치**(뒤에 설명이 이어진다) | `_workspace/03_dev/spec.json`이 **존재**할 때만 |

**면제는 id가 아니라 detail로 판별한다.** validator가 문구를 바꾸면 면제가 풀려 승인이 거부된다 — 그 방향이 fail-closed이므로 안전하다(통과가 아니라 차단으로 떨어진다). 두 id 모두 서로 반대되는 상태에 재사용되기 때문이다 —
실측(2026-09-02)에서 같은 `plan` id가 기획이 있는 프로젝트에서는 `의존 미선언 1/1 · 경로 미선언 1/1`을
냈다. 이것은 **진짜 결함이고 차단 대상**이다. `spec` id도 스팩 **부재**(`spec.json이 없다`)에
함께 쓰이므로, spec.json이 없는 프로젝트를 면제로 오독하면 스팩 없는 개발이 열린다.

**위 표의 두 줄에 정확히 해당하지 않는 HOLE이 하나라도 있으면 승인하지 않는다** — 설계 미결정이
열려 있거나, 경로·의존이 선언되지 않았거나, 확정 결정이 실물에 반영되지 않은 것은 기획 부재와
무관한 구멍이며 여기서 면제되지 않는다. **면제 집합을 늘리는 것은 의식적 행위다** — 새 HOLE이
`absent`의 파생이라고 판단되면 fixture로 실측하고 이 표에 추가하며 사유를 JUDGMENT에 남긴다.
그 자리에서 "이것도 당연한 결과"라고 넘기지 않는다(면제 creep).

`SKIPPED` 항목은 HOLE이 아니므로 차단하지 않는다. 다만 **개수와 사유를 사용자에게 함께 보여준다** —
기획 `absent` 경로에서는 10건 이상이 `단위를 읽지 못해 대조할 수 없다`로 건너뛴다(실측).
검사 미수행을 통과로 읽지 않게 하는 것이 이 표시의 목적이다.

### ③ `unverifiable`은 사용자가 명시적으로 인수한다

`spec: unverifiable` HOLE 하나만 남았으면 그것을 **없는 것처럼 넘기지 않는다.** `provenance-contract.md` §2의 대가를
그대로 제시하고 인수 여부를 묻는다.

```
✋ 스팩 승인 — specTier: unverifiable
   수용 기준(FEAT/TC)이 없습니다. 결과:
   · 무엇이 "완료"인지 판정할 기준이 없습니다 — 종료 조건은 실행 예산뿐입니다
   · 팀 인계(티켓 일괄 청구)가 막힙니다
   · 접근성·보안·receipt 등 안전 하한과 빌드·테스트 게이트는 그대로 적용됩니다
   · 나중에 기획을 붙여 재확정하면 verifiable로 승격됩니다
   · 팀으로 나눠 개발할 계획이 조금이라도 있으면 지금 기획을 세우는 편이 쌉니다 —
     나중에는 이미 만들어진 것에 수용 기준을 맞추게 되고, 그러면 그 기준은 구현의 사본이 됩니다
   이 상태로 개발을 진행할까요?
```

인수하면 `_workspace/01_plan/decision-log.md`에 `PC-NNN`으로 기록한다(`plan-history-contract.md`).
`decision-log.md`가 없으면(기획 `absent`) 이 인수 기록을 위해 만든다 — 인수는 남아야 한다.
**인수의 유효 범위는 이번 프로젝트의 단독 개발까지다** — 팀 인계로 확장되지 않으며,
`team-flow claim`은 이 인수와 무관하게 계속 막힌다. 거부하면 진행하지 않고 기획 공급원을
`generated`(Phase 1 실행) 또는 `supplied`(문서 제공)로 되돌려 다시 묻는다. 지금 인수하고
나중에 기획을 붙이는 것도 가능하다 — `provenance-contract.md` §3 지연 공급.

그 위에 아래 내용을 보여주고 확인한다.

- `targetShapes`와 그 근거 티어(`measured` | `inferred` | `confirmed` | `proposed`)
- `architecture.pattern`과 `layerMap` — 되돌리기 비용이 큰 결정이므로 여기서 확인한다
- `libraries` 각 항목의 선택·대안·사유, `constitution.substrate` 중 `declared` 항목과 rationale
- `moduleBoundaries`와 `nonGoals`
- `openDecisions` 중 `assumed`로 닫힌 항목 — 사용자가 보류해 추천안으로 확정된 것

수정 요청이 있으면 `system-architect`를 다시 실행하고 `spec.mjs`로 재확정한 뒤 이 절을 반복한다.
**확인 전에는 Phase 3 source edit를 시작하지 않는다.**

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

**개정할 기획이 아예 없으면**(`PLAN_SOURCE: absent`로 세운 프로젝트, `provenance-contract.md` §1)
`none`으로 넘기지 않는다. `change` 레인은 **동작을 새로 정의하므로** 그 정의가 맞는지 판정할
기준이 이번 변경 범위에는 필요하다 — `none`의 사유("사용자 관찰 동작 무변경")가 여기서는
거짓이 되고, 거짓 라벨을 남기는 것이 빈 단계를 통과시키는 것보다 나쁘다.

대신 **이번 변경 범위만큼의 기획을 세운다**. 전체 기획을 소급해 만들지 않는다.

- `requirements-analyst`·`feature-planner`를 **이번 변경 범위로 한정해** 실행하고, 그 결과를
  `_workspace/01_plan/feature-plan.md`에 FEAT/TC로 추가한다(파일이 없으면 여기서 생긴다).
- 그 순간 `provenance-contract.md` §3 지연 공급이 발동한다 — 새 입력이 `LOCK_INPUTS`에 들어가
  스팩이 stale이 되므로 ④에서 `acceptanceSource: "feature-plan"`으로 **재확정**한다.
- 결과로 `specTier`가 `unverifiable` → `verifiable`로 오른다. 기획 없이 시작한 프로젝트도
  기능이 추가되며 수용 기준이 자란다 — `docs/brownfield-adoption.md`의 L3 점진 정본화와 같은
  방향이며, 소급 기획을 요구하지 않고 그 지점에서 필요한 만큼만 만든다.
- 사용자가 그것도 원하지 않으면 `unverifiable`을 유지할 수 있다. 그때는 이 문서의
  「기획·디자인 `absent` 진입 → 개발」 ③ 명시 인수를 **이번 라운드에 대해 다시** 받는다 —
  한 번의 인수가 이후 모든 기능 추가로 확장되지 않는다.

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
