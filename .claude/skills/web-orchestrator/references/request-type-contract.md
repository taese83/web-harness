# Request Type Contract

웹 요청을 프로젝트 유형과 별개로 다음 작업 유형 중 하나로 판정한다.

| REQUEST_TYPE | 의미 | 기본 흐름 |
|---|---|---|
| `greenfield-service` | 빈 대상에 신규 서비스 생성 | Phase 1~4 전체 |
| `feature` | 기존 서비스에 사용자 기능 추가 | 기능 mini-cycle (진입점별 실행 형태는 아래 참조) |
| `ui-change` | 데이터 계약 변경 없는 UI 수정 | 간소 기획 → 디자인 → UI QA |
| `bug-fix` | 기대 동작과 다른 결함 수정 | 재현 → root cause → 최소 수정 → 회귀 QA |
| `refactor` | 외부 동작을 보존하는 구조 개선 | baseline → 변경 → Before/After 검증 |
| `api-integration` | Mock/수동 client를 실제 계약에 연결 | contract diff → 부분 전환 → API QA |
| `infrastructure` | toolchain, build, deploy, runtime 기반 변경 | 영향 계약 → 구현 → profile QA |
| `verification-only` | source 변경 없는 검증 | read-only verifier만 실행 |

## 진입점과 게이트 강도 (같은 유형이 두 경로로 갈 때)

`feature`·`ui-change`·`bug-fix`·`refactor`·`api-integration`은 두 진입점 어디로도 들어올 수 있다.

- `/feature-add` 호출 → 그 skill의 Phase 1~4 mini-cycle
- `/web-orchestrator` 호출 → `execution-contract.md`의 **Iterate mode** 경량 루프

**진입점이 게이트 강도를 바꾸지 않는다.** 어느 쪽이든 ① change brief 전 필드 기록(`CAPABILITY_ESCALATION`·`DOCS_TO_UPDATE` 포함)
② 라운드 종료 게이트 3종(승격 QA·evidence 재발급·문서 동기화) ③ 유형별 필수 증거(아래)가 동일하게 적용된다.
차이는 체크포인트 형식뿐이다 — Iterate mode는 intake 배너를 생략하고, `/feature-add`는 기획·설계 확인
체크포인트를 명시적으로 제시한다.

**산출물 생성은 진입점이 아니라 요청 유형이 정한다(2026-08-26 정정 — 종전 "Iterate는 설계 재생성을
항상 생략"은 §0-1과 모순이었다).** `feature`는 기획·디자인이 없으면 요청 범위에 맞춰 최소로 만든다.
`bug-fix`·`refactor`·`verification-only`는 만들지 않는다. `ui-change`·`api-integration`은 바뀌는
산출물만 개정한다. 스팩은 어느 유형이든 없으면 실측으로 만들고, 레이어·라이브러리·형태가 바뀔 때만
재확정한다(재확정은 receipt를 stale로 만든다). **사용자는 `/feature-add`를 직접 부르지 않는다** —
`/web-orchestrator`가 유형을 판정해 진행하고, `/feature-add`는 명시 호출용으로 남는다.

경량 경로라는 이유로 게이트를 건너뛰는 것은 진입점 선택으로 QA를 우회하는 것이며 허용되지 않는다.

## 판정 원칙

1. 대상 디렉터리와 사용자 발화를 함께 본다.
2. 여러 유형이 섞이면 사용자 목표를 달성하는 가장 작은 coherent type을 선택하고 부수 작업은 `NON_GOALS`로 둔다.
3. `bug-fix`를 기능 추가로, `ui-change`를 전체 redesign으로 승격하지 않는다.
4. 판정이 source 수정 범위를 크게 바꾸는 경우에만 한 번 확인한다.

## 유형별 필수 증거

- `bug-fix`: 변경 전 최소 재현과 변경 후 동일 재현
- `refactor`: public behavior baseline과 Before/After matrix
- `ui-change`: reference 화면·기존 token·layout stability·요청 외 변경 없음(있다면 사전 승인 근거)
- `api-integration`: producer/consumer contract diff와 선택 endpoint
- `verification-only`: verifier가 source를 수정하지 않았다는 경계

