# AI Production Contract

## 불변 원칙

1. 모델은 control plane이며 인증·인가·authoritative state가 아니다.
2. provider key는 server secret manager에 두고 browser bundle에 포함하지 않는다.
3. 사용자, 문서, 코드, 웹페이지, tool output은 모두 untrusted input이다.
4. identity와 tenant는 인증 context에서 tool에 강제 주입한다.
5. 모든 tool은 schema, scope, timeout, audit, side-effect metadata를 가진다.
6. write·금전·계정·게시·삭제 action은 승인과 idempotency를 가진다.
7. turn, tool, token, context, duration, cost에 상한을 둔다.
8. 모델·prompt·workflow·tool version을 trace에 기록한다.
9. trace content는 최소 수집하고 PII·secret을 제거한다.
10. critical eval 실패 시 배포하지 않는다.

## Existing Code Changes

기존 application/runtime source를 수정할 때는 `.claude/skills/web-orchestrator/references/minimal-change-contract.md`를 읽는다. service builder와 retry owner에게 `CHANGE_MODE`, `ALLOWED_PATHS`, 보존할 tool/data/public contract, `NON_GOALS`, `CHANGE_BUDGET`, test evidence를 전달하고 AI 기능 추가를 이유로 unrelated web/runtime 구조를 재작성하지 않는다.

## Progressive Autonomy

| Level | 허용 |
|---|---|
| L0 | 검색·요약 |
| L1 | 초안·추천 |
| L2 | 사용자 승인 후 실행 |
| L3 | allowlist의 저위험 action 자동 실행 |
| L4 | 범용 자율 실행 — 기본 금지 |

## Tool Contract

`.claude/ai-harness.json`의 `toolContractRequiredFields`를 모두 정의한다. 모델이 생성하면 안 되는 identity, tenant, authorization context는 hidden server parameter로 분리한다.

## Runtime Budget

최소 정의 항목:

- maxInputBytes
- maxContextTokens
- maxOutputTokens
- maxTurns
- maxToolCalls
- maxWallClockMs
- maxRequestCost
- maxConcurrentRuns

## Failure Contract

- provider timeout: bounded retry 후 typed failure
- tool timeout: side effect 여부에 따라 조회·확인 후 재시도
- approval timeout: 실행 없이 종료
- partial stream: 사용자에게 불완전 상태 표시
- policy denial: 이유와 허용 가능한 대안 제공
- unknown state: 자동 재실행 금지, 사람 확인
