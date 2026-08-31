# Request Type Contract

웹 요청을 프로젝트 유형과 별개로 아래 유형 중 하나로 판정하고, 유형은 **레인 넷**으로 접힌다.
레인이 게이트를 정한다. 상세는 `approval-checkpoints.md`.

| REQUEST_TYPE | 레인 | 의미 |
|---|---|---|
| `greenfield-service` | `new` | 빈 대상에 신규 서비스 생성 |
| `feature` | `change` | 기존 서비스에 사용자 기능 추가 |
| `ui-change` | `change` | 데이터 계약 변경 없는 UI 수정 |
| `api-integration` | `change` | Mock/수동 client를 실제 계약에 연결 |
| `infrastructure` | `change` | toolchain·build·deploy·runtime 기반 변경 |
| `bug-fix` | `fix` | 기대 동작과 다른 결함 수정 |
| `refactor` | `fix` | 외부 동작을 보존하는 구조 개선 |
| `verification-only` | `verify` | source 변경 없는 검증 |

| 레인 | 경계 | 게이트 |
|---|---|---|
| `new` | 새 서비스 | Phase 1·2 체크포인트 |
| `change` | **동작이 새로 정의된다** | **✋ 스팩 승인** |
| `fix` | **동작을 보존한다** | 보존 증거(승인 없음) + 자기검사 |
| `verify` | source 미변경 | read-only 경계 |

가르는 축은 규모가 아니라 **동작이 새로 정의되는가**다.

**`fix` 자기검사(필수)** — 승인 게이트가 없으므로 우회로가 되지 않게 스스로 검사한다. 변경 범위에
① 새 route·화면 ② 새 데이터 계약 ③ 새 권한·인증 경로 ④ 새 외부 의존
⑤ **기존 공개 계약 변경**(`PUBLIC_CONTRACTS_TO_PRESERVE` 어휘: public API·wire schema·route·
persisted state·접근성) 중 하나라도 있으면 `fix`를 거부하고 `change`로 승격한다. 재량이 아니다.
⑤가 없으면 "새 것만 없으면 통과"가 되어 기존 계약을 승인 없이 바꿀 수 있다.

**레인 표시는 생략하지 않는다** — 진입 시 레인과 게이트를 1줄로 알린다. 경량 경로도 예외 없다.

`/wh`가 사용자 진입점이고 레인을 판정한다(`/wh fix ...`로 강제). 다른 스킬은 `/wh`가 호출한다.
**진입 방식이 게이트 강도를 바꾸지 않는다.**

## 판정 원칙

1. 대상 디렉터리와 사용자 발화를 함께 본다.
2. 여러 유형이 섞이면 가장 작은 coherent type을 고르고 부수 작업은 `NON_GOALS`로 둔다.
3. `bug-fix`를 기능 추가로, `ui-change`를 전체 redesign으로 승격하지 않는다.
4. 판정이 source 수정 범위를 크게 바꾸는 경우에만 한 번 확인한다.

## 유형별 필수 증거

- `bug-fix`: 변경 전 최소 재현과 변경 후 동일 재현
- `refactor`: public behavior baseline과 Before/After matrix
- `ui-change`: reference 화면·기존 token·layout stability·요청 외 변경 없음(있다면 사전 승인 근거)
- `api-integration`: producer/consumer contract diff와 선택 endpoint
- `verification-only`: verifier가 source를 수정하지 않았다는 경계
