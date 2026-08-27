# Next Backend Patterns Contract

Route Handler·Server Action의 실전 백엔드 패턴 계약이다. `app-router-boundary-contract.md`(경계)와 `rendering-deployment-contract.md`(렌더링)가 "어디서"를 정하면, 이 문서는 "어떻게"를 정한다. `developer`가 구현 전에 읽고, 위반은 `next-contract-verifier`의 검토 대상이다.

## 1. 엔드포인트 공통 가드 (vite-serverless-hybrid §7의 Next 이식)

공개 HTTP 표면(모든 Route Handler)과 모든 Server Action에 5종 가드를 적용한다. 파일 추가만으로 표면이 늘어나므로 **가드가 handler 구현보다 앞선다**:

| 가드 | Route Handler | Server Action |
|---|---|---|
| method 제한 | 파일 라우팅의 named export(GET/POST…)만 — 사용하지 않는 method는 export하지 않는다 (자동 405) | 해당 없음 (POST 고정) |
| 인증·인가 | handler 내부에서 session 재확인 + role/resource/tenant 검사 (미들웨어 검사만으로 통과 금지) | action 시작점에서 fresh session + resource authorization |
| body 캡 | `request.json()` 전에 `Content-Length` 검사 + 스트림 캡 (기본 1MB, 업로드 route만 별도 상한) | 입력 DTO 크기를 schema에서 제한 (배열 max, 문자열 max) |
| 스키마 검증 | 모든 input(body·query·params)을 runtime schema로 검증 — 실패는 400 + 필드 단위 사유 | 모든 argument를 runtime schema로 검증 |
| rate limit | IP/사용자 단위 — 인증·mutation endpoint 필수, read는 표면 성격에 따라 | mutation action 필수 |

- **표면 균질성**: 한 endpoint라도 가드가 비면 그 표면 전체가 뚫린 것이다 — `api-schema.md`의 endpoint × 5종 가드 매트릭스에 공백이 없어야 완료다.
- serverless/다중 인스턴스에서 in-memory rate limit은 인스턴스당 soft limit이다 — 이 한계를 코드 주석과 QA 보고에 명시하고, 정식 한도가 요구면 외부 store(Upstash 등) 기반을 선택한다 (이 결정은 tech-stack 몫).
- 응답 균일성: 인증 실패는 존재 여부를 누설하지 않는 동일 형태(401/403)로, 검증 실패만 필드 사유를 담는다.

## 2. 트랜잭션 경계

- **하나의 사용자 행동 = 하나의 트랜잭션 경계**. 여러 테이블 mutation이 한 행동이면 단일 트랜잭션으로 묶고, Server Action/Route Handler가 그 경계의 소유자다 — UI 레이어나 여러 fetch 호출로 쪼개지 않는다.
- serverless 환경에서는 **pooled DSN으로 트랜잭션을 열고 요청 안에서 닫는다**. 요청 밖으로 트랜잭션·연결을 들고 나가지 않는다 (`server-db-migration`의 pooled/direct DSN 분리 계약과 정합).
- 트랜잭션 안에서 외부 API 호출 금지 — 외부 호출은 트랜잭션 밖에서 먼저(검증) 또는 뒤에(통지) 수행하고, 뒤 단계 실패는 보상(compensation) 또는 재시도 대상으로 기록한다.
- 실패 시 부분 커밋이 없어야 한다 — "저장은 됐는데 카운터가 안 올랐다"는 상태를 만들지 않는다.

## 3. Idempotency 레시피

destructive/retriable mutation의 "idempotency 또는 precondition" 요구를 다음 중 하나로 구현한다:

1. **Idempotency key**: 클라이언트가 생성한 key를 unique 컬럼에 저장 — 중복 요청은 최초 결과를 반환 (결제·생성 계열).
2. **Precondition(낙관적 스팩 확정)**: `updated_at`/version을 조건에 포함한 조건부 UPDATE — 충돌 시 409 + 최신 상태 반환 (수정 계열).
3. **자연 멱등**: DELETE는 "이미 없음"을 성공(204)으로 처리 (삭제 계열).

재시도 가능한 실패(네트워크·타임아웃)와 불가능한 실패(검증·권한)를 응답 코드로 구분한다 — 클라이언트 재시도 정책이 이 구분에 의존한다.

## 4. 파일 업로드

- **스트림으로 받고, 메모리에 전체 버퍼링하지 않는다**. 크기 상한을 스트림 단계에서 강제(초과 시 413)하고 `Content-Length` 신고값을 신뢰하지 않는다.
- content-type은 헤더가 아니라 **매직 바이트로 검증**한다. 허용 타입 allowlist 방식.
- 저장 경로에 사용자 입력을 넣지 않는다 — 서버 생성 key로 저장하고 원본 파일명은 메타데이터로만.
- 대용량(수 MB+)은 서버 경유 대신 **presigned URL 직접 업로드**를 기본으로 하고, 서버는 발급·완료 콜백 검증만 담당한다 (serverless body 한도·비용 회피).
- 업로드 endpoint는 §1 가드 + 인증 필수 — 익명 업로드 표면을 만들지 않는다.

## 5. 작업 위임 (응답 후 처리)

serverless 함수는 응답 반환 후 실행을 보장하지 않는다:

- **짧은 후처리(수 초)**: Next `after()` (또는 provider의 `waitUntil`)로 응답 후 실행을 등록한다 — 단 실패해도 사용자 상태가 깨지지 않는 부수 작업(로그·통지)만.
- **결과가 중요한 후처리**: 응답 전에 **DB에 작업 레코드를 커밋**하고(outbox 패턴), 실행은 scheduled job이 가져간다 — `.claude/skills/web-orchestrator/references/background-jobs-contract.md`의 계약을 따른다.
- **장기 실행(수십 초+)**: 이 profile의 범위 밖이다. 전용 워커/backend로 위임하고 함수는 enqueue만 한다. 함수 타임아웃을 늘려 버티는 설계 금지.
- fire-and-forget `fetch()` 후 즉시 반환하는 패턴 금지 — 실행 보장이 없다.

## 6. 에러 응답 envelope

- 모든 Route Handler는 **단일 에러 envelope**(`error-handling-patterns.md`의 형식)을 공유한다: `{ error: { code, message, fields? } }` + 적절한 status. handler마다 다른 형태 금지.
- 4xx는 사용자가 고칠 수 있는 정보를, 5xx는 상관 ID(correlation id)만 — stack, SQL, upstream 응답 본문, 내부 경로를 응답에 넣지 않는다 (boundary contract 3과 정합).
- Server Action의 예상 실패는 **throw가 아니라 반환값**으로 전달한다 (`{ ok: false, code, fields }`) — error boundary는 예상 밖 실패 전용이다.

## 7. 서버 관측 (server-side observability)

- 모든 mutation과 5xx에 **structured log 한 줄**: `{ requestId, route, userId?, action, outcome, durationMs }` — 문자열 조립 로그 금지. PII·credential·body 원문을 로그에 넣지 않는다.
- `requestId`(수신 헤더 또는 생성)를 응답 헤더와 로그에 공통으로 넣어 클라이언트 에러 보고와 서버 로그를 연결한다 — 프론트 관측(`web-observability-builder`)의 에러 이벤트가 이 ID를 첨부한다.
- 외부 API 호출은 대상·소요시간·결과를 로그에 남긴다 (비용·장애 진단의 최소 단위).
- 에러 추적 도구가 활성(`OBSERVABILITY_MODE`)이면 서버 예외도 같은 프로젝트로 보고하되 위 redaction 규칙을 통과한 뒤 보낸다.

## 완료 조건 (developer·verifier 공용)

- endpoint × 5종 가드 매트릭스에 공백 없음 (§1)
- 다중 테이블 mutation이 트랜잭션 경계 없이 흩어진 곳 없음 (§2)
- destructive/retriable mutation마다 idempotency 레시피 중 하나가 식별됨 (§3)
- 업로드 표면이 있으면 스트림 캡·매직 바이트·presigned 기준 충족 (§4)
- 응답 후 처리가 `after()`/outbox/위임 중 하나로 분류되고 fire-and-forget fetch 없음 (§5)
- 에러 envelope 단일 형식 + Server Action 예상 실패는 반환값 (§6)
- mutation·5xx structured log + requestId 왕복 (§7)
