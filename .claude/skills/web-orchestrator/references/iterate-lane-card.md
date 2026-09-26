# Iterate 레인 카드 — `change`·`fix` 한 라운드의 순서·명령·양식

오케스트레이터는 `change`·`fix` 라운드를 **이 카드로 시작한다.** 규칙의 정본은 각 단계에 적힌 계약이다 —
그 계약은 **그 단계가 막히거나 카드로 판단이 서지 않을 때만** 해당 절을 연다. 계약을 미리 통째로 읽지 않는다
(읽은 문서는 이후 모든 호출에 다시 실려 비용이 된다). 카드와 계약이 다르면 계약이 이긴다.

## 순서

| # | 단계 | 명령·산출 | 정본 |
|---|---|---|---|
| 1 | 공급 감지 — 요청에 문서·링크·시안이 붙었을 때만 | `00_source/` 기록 | `provenance-contract.md` §6 |
| 2 | **`change`만**: ① 기획 개정 → ② 디자인 델타 감지 → ③ 감지 문서만 개정 | 에이전트 스폰(아래 「반환」) | `change-lane-checkpoint.md` ①~③ |
| 3 | **`change`만**: ④ 스팩 확정 | `node .claude/scripts/spec.mjs --project-root {root}` → stdout을 `_workspace/03_dev/spec.json`에 그대로 저장. `SPEC_NOT_SETTLED`면 그 결정을 ✋에 싣는다 | `change-lane-checkpoint.md` ④ |
| 4 | change brief — 라운드별 1항목 append | `_workspace/03_dev/change-scope.md`(아래 양식) | `minimal-change-contract.md` |
| 5 | **`change`만**: ✋ 스팩 승인 — 승인 전 source edit 없음 | 아래 「✋에 싣는 것」 | `change-lane-checkpoint.md` ✋ |
| 6 | Gate 0 — 첫 source edit 전 | `node .claude/scripts/validate-development-readiness.mjs --project {root}` | `development-gates-contract.md` Gate 0 |
| 7 | 구현 — `developer` 스폰, 범위는 change brief | 스폰마다 telemetry 1행 append(아래) | `execution-contract.md` Iterate 2 |
| 8 | 게이트 — 프로젝트 toolchain pin(`.nvmrc`)으로 typecheck·lint·test·build | 프로젝트 스크립트 | `development-gates-contract.md` |
| 8-1 | 런타임 검증 — 수용 기준마다 | `LOCAL_VERIFIABLE`은 브라우저·CLI로 직접 확인한 증거, `DEPLOY_ONLY`는 `TEST_EVIDENCE`에 `DEPLOY_ONLY — 사용자 위임`. 미검증 경로를 PASS로 보고하지 않는다 | `execution-contract.md` Runtime verifiability |
| 9 | 라운드 종료 게이트 3종 | ① `CAPABILITY_ESCALATION: detected`면 `security-reviewer`(서버 계약이 생겼으면 `api-contract-verifier`) ② `_workspace/04_qa/evidence/`가 있으면 `node .claude/scripts/run-quality-gates.mjs --project {root} --all` ③ `DOCS_TO_UPDATE` 개정 완료 | `qa-evidence-contract.md` Iterate evidence |
| 10 | 완료 보고 | changed files · 보존 contract · scope deviation · 요청 외 변경 · evidence · 게이트 3종 상태 | `execution-contract.md` Iterate 6 |

`fix`는 자기검사(`request-type-contract.md` — 하나라도 걸리면 `change`로 승격)를 통과한 뒤 2·3·5를 건너뛰고 유형별 보존 증거를 남긴다.

## 반환 — 산출물을 다시 읽지 않는다

✋와 보고는 **스폰 반환으로 조립한다.** 기획·설계 스폰 프롬프트에 반환 요구를 넣는다: 바뀐 행의 ID와
한 줄 요지(REQ·FEAT·TC·SD), open 결정(선택지·추천), `DOCS_TO_UPDATE`와 대조한 문서 목록. 반환이 준 ID로
`grep -n`해 **그 출력 줄(산출물의 실제 행)을 ✋에 싣는다** — 반환의 요지가 아니라. 파일을 통째로 다시 열지 않는다.
반환이 비었거나 grep이 ID를 찾지 못하면 그때 해당 절만 읽는다.

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
값은 스폰 결과 metadata에서 옮긴다 — 없으면 `null`이다(`execution-budget-contract.md`).

## 일반화 근거

- **브라운필드 웹 앱의 `change`** — 한 형태·변경 유형 2종(화면 기능, 공통 모듈)에서 오케스트레이터가 계약을 통째로
  읽고 산출물을 다시 연 것을 관찰했다. 명명 수준 — 카드 적용 뒤 효과는 재측정 전이다.
- **라이브러리·CLI의 `fix`** — 같은 Iterate 루프에서 2·3·5를 건너뛴다. 명명 수준 — 평가 사례가 없다.
