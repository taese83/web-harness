# Iterate 레인 카드 — `change`·`fix` 한 라운드의 순서·명령·양식

오케스트레이터는 `change`·`fix` 라운드를 **이 카드로 시작한다.** 규칙의 정본은 각 단계에 적힌 계약이다 —
그 계약은 **그 단계가 막히거나 카드로 판단이 서지 않을 때만** 해당 절을 연다. 계약을 미리 통째로 읽지 않는다
(읽은 문서는 이후 모든 호출에 다시 실려 비용이 된다). 카드와 계약이 다르면 계약이 이긴다.

## 첫 판단 — 계약을 열기 전에

- **레인**: 가르는 축은 규모가 아니라 동작이 새로 정의되는가다. `fix`여도 ① 새 route·화면 ② 새 데이터 계약 ③ 새 권한·인증
  경로 ④ 새 외부 의존 ⑤ 기존 공개 계약(public API·wire schema·route·persisted state·접근성) 변경 중 하나면 `change`로 승격한다.
- **브라운필드 첫 작업**(스팩 잠금 없음): 설계 공급원 1문항만 묻는다 — 실측(`measured`, 추천) 또는 사용자 설계 문서(`supplied`).
- **`CAPABILITY_ESCALATION: detected`**: ① 서버 실행 경로 신규 ② 인증·세션·DB·서버 SDK 의존 추가 ③ 클라이언트→자체 서버
  fetch·mutation 도입 ④ 외부 API 키 소비 코드 — 하나라도 있으면.
- **e2e 도구가 없는 화면 앱**: 스팩 확정이 `testLayers.e2e`를 요구한다 — 설계 단계(system-architect)가 도입 여부를 ✋ 결정으로 올린다.
- **막히면** 스크립트 소스를 읽지 않는다 — 거부 JSON의 `fix`와 `<script> --help`가 답한다. 그래도 안 풀리면 그 단계의 계약 절만 연다.

## 순서

| # | 단계 | 명령·산출 | 정본 |
|---|---|---|---|
| 1 | 공급 감지 — 요청에 문서·링크·시안이 붙었을 때만 | `00_source/` 기록 | `provenance-contract.md` §6 |
| 2 | **`change`만**: light면 developer 계획 패스 1회(아래 「light」), full이면 ① 기획 개정 → ② 디자인 델타 감지 → ③ 감지 문서만 개정 | 에이전트 스폰(아래 「반환」). 설계 에이전트는 `DOCS_TO_UPDATE`가 `none`이 아닐 때만 | `change-lane-checkpoint.md` light·①~③ |
| 3 | **`change`만**: ④ 스팩 확정 | `node .claude/scripts/spec.mjs --project-root {root}` → stdout을 `_workspace/03_dev/spec.json`에 그대로 저장. `SPEC_NOT_SETTLED`면 그 결정을 ✋에 싣는다 | `change-lane-checkpoint.md` ④ |
| 4 | change brief — 라운드별 1항목 append | `_workspace/03_dev/change-scope.md`(아래 양식) | `minimal-change-contract.md` |
| 5 | **`change`만**: ✋ 스팩 승인 — 승인 전 source edit 없음 | 아래 「✋에 싣는 것」 | `change-lane-checkpoint.md` ✋ |
| 6 | Gate 0 — 첫 source edit 전 | `node .claude/scripts/validate-development-readiness.mjs --project {root}` | `development-gates-contract.md` Gate 0 |
| 7 | 구현 — `developer` **1회**가 코드와 그 테스트를 함께(범위는 change brief). 메인은 source를 쓰지 않는다 | 스폰마다 telemetry 1행 append(아래) | `retry-policy.md` Iterate 라운드 |
| 8 | 게이트 — 프로젝트 toolchain pin(`.nvmrc`)으로 typecheck·lint·test·build | `node .claude/scripts/run-quality-gates.mjs --project {root} --check <id> --failure-summary` (첫 실행은 사용자 명시 승인 뒤 `--allow-host-execution` — 훅이 확인을 띄운다. 사용법 `--help`) — 실패면 `_workspace/04_qa/failure-summary.json`을 developer 수정 스폰에, `BLOCKED`(환경 원인)면 라운드 `BLOCKED`. 수정은 리뷰 finding과 합산 라운드당 2회, 초과·잔여 FAIL은 `BLOCKED` | `retry-policy.md` Iterate 라운드 |
| 8-0 | 재검증 금지 — 영수증 PASS 뒤 메인은 테스트를 다시 돌리거나 diff를 통독하지 않는다 | 의심이면 그 check를 러너로 다시. 범위 대조는 `run-git-inspection.mjs --operation diff-stat` 한 번 | `qa-evidence-contract.md` Iterate evidence |
| 8-1 | 런타임 검증 — 수용 기준마다 | `LOCAL_VERIFIABLE`은 브라우저·CLI로 직접 확인한 증거, `DEPLOY_ONLY`는 `TEST_EVIDENCE`에 `DEPLOY_ONLY — 사용자 위임`. 미검증 경로를 PASS로 보고하지 않는다 | `execution-contract.md` Runtime verifiability |
| 8-2 | 위험 트리거 리뷰 — 신호가 있을 때만 새 문맥 리뷰어 역할별 1회, 마지막 수정 뒤 역할별 재확인 1회. 신호 0이면 `review: none-required` | 리뷰어 입력은 라운드 diff·수용 기준·change brief뿐, `CONFIRMED`만 판정 산입, 남은 FAIL은 `BLOCKED` | `qa-evidence-contract.md` Iterate evidence |
| 9 | 라운드 종료 게이트 3종 | ① (light는 위 「light」 4) `CAPABILITY_ESCALATION: detected`면 `security-reviewer`(서버 계약이 생겼으면 `api-contract-verifier`) ② `_workspace/04_qa/evidence/`가 있으면 `node .claude/scripts/run-quality-gates.mjs --project {root} --all` ③ `DOCS_TO_UPDATE` 개정 완료 | `qa-evidence-contract.md` Iterate evidence |
| 10 | 완료 보고 | changed files · 보존 contract · scope deviation · 요청 외 변경 · evidence · 게이트 3종 상태 | `execution-contract.md` Iterate 6 |

`fix`는 자기검사(`request-type-contract.md` — 하나라도 걸리면 `change`로 승격)를 통과한 뒤 2·3·5를 건너뛰고 유형별 보존 증거를 남긴다.

## light — 기본값(스팩이 feature-plan을 결박했거나 사람 티켓 작업이고, 제품 의도를 새로 정하지 않을 때)

1. 다음 `PC-NNN`으로 `validate-plan-delta.mjs --project {root} --change PC-NNN --snapshot` → change-scope.md에 아래 펜스를 **그대로**
   append(info-string까지 — 다른 표기는 차단이 켜지지 않는다. 쓰기 소유는 ALLOWED_PATHS가 아니라 고정 세트) → developer 계획
   패스 스폰(PC 번호를 넘긴다 — 티켓 작업은 snapshot·PC 없이). 안정 ID 0 경고에도 `--allow-no-ids`를 쓰지 않는다:

```json change-scope
{"PHASE": "plan", "ALLOWED_PATHS": ["_workspace/01_plan/feature-plan.md", "_workspace/01_plan/requirements.md", "_workspace/01_plan/decision-log.md"]}
```

2. 반환 뒤 `--verify`(티켓은 없음 — 기준은 change-scope의 ACC·TT) → 3행 `spec.mjs`로 ✋ **전에** 재확정(refs 그대로). TC는 `plan-lookup` 행을 싣는다. `ESCALATE_TO_FULL`(solution-design 변경 포함)이면 full. ✋에서 기준이 바뀌면 새 PC.
3. ✋ 뒤 구현 범위 펜스(`PHASE` 없음)를 append하고 **같은 developer를 SendMessage로 이어서** 구현·수정시킨다. 반환한 스폰이 이어지지
   않거나(세션 종료·비대화 실행 포함) 응답이 없으면 `TaskStop` 뒤 새 스폰에 계획 반환·TC ID를 넘긴다. telemetry `mode: resume`.
4. 리뷰는 라운드당 **한 스폰** — 규칙은 `qa-evidence-contract.md` Iterate evidence의 light 항목(9 ①도 그것이 채운다).

## 반환 — 산출물을 다시 읽지 않는다

✋와 보고는 **스폰 반환으로 조립한다.** 기획·설계 스폰 프롬프트에 반환 요구를 넣는다: 바뀐 행의 ID와
한 줄 요지(REQ·FEAT·TC·SD), open 결정(선택지·추천), `DOCS_TO_UPDATE`와 대조한 문서 목록. 반환이 준 ID를
`node .claude/scripts/plan-lookup.mjs --project {root} --id <ID,...>`로 꺼내 **그 행(산출물의 실제 행)을 ✋에 싣는다** —
반환의 요지가 아니라. 파일을 통째로 다시 열지 않는다. 못 찾은 ID(exit 1)만 해당 절을 읽는다.

## ✋에 싣는 것

기획 변경(바뀐 행만) · 디자인 변경(`DOCS_TO_UPDATE`와 대조한 문서 목록, 문서별 요지 1줄) ·
스팩(수용 기준·TC, `LOCAL_VERIFIABLE | DEPLOY_ONLY`) · change brief(`ALLOWED_PATHS`·`PUBLIC_CONTRACTS_TO_PRESERVE`·
`NON_GOALS`·`CAPABILITY_ESCALATION`) · 새 `ASSUMPTION`·`NEEDS_DECISION`·`BLOCKED`.

## change brief 양식

```markdown
CHANGE_MODE: existing-change
REQUEST: …
OBSERVED_BASELINE: …
TARGET_BEHAVIOR: …
ALLOWED_PATHS: a/b.ts, a/c.ts
PUBLIC_CONTRACTS_TO_PRESERVE: …
NON_GOALS: …
CHANGE_BUDGET: …
TEST_EVIDENCE: …
CAPABILITY_ESCALATION: none | detected: 신호 목록
DOCS_TO_UPDATE: none (대조: …) | 문서 목록
```

## telemetry 1행

`_workspace/04_qa/execution-telemetry.json`의 `spawns`에 append —
`{"run": "<시작시각>+iterate", "phase": "<단계>", "agent": "<이름>", "retry": false, "mode": "fresh", "tokens": <totalTokens>, "toolUses": <totalToolUseCount>, "durationMs": <totalDurationMs>}`.
값은 스폰 결과 metadata에서 옮긴다 — 없으면 `null`이다(`execution-budget-contract.md`). 구현 뒤의 developer 수정 스폰은 `retry: true`.

## 일반화 근거

- **브라운필드 웹 앱의 `change`** — 화면 기능·공통 모듈 두 변경 유형에서 관찰. light는 평가 사례
  `change-lane-light-plan-pass`로 고정하고 비용 효과는 재측정 전이다.
- **라이브러리·CLI의 `change`** — light 계획 패스가 `api-design.md`를 개정한다. 명명 수준 — 평가 사례가 없다.
- **라이브러리·CLI의 `fix`** — 같은 Iterate 루프에서 2·3·5를 건너뛴다. 명명 수준 — 평가 사례가 없다.
