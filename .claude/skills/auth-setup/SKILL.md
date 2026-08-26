---
name: auth-setup
description: Adds authentication and authorization to a completed web-harness project. Sets up a secure cookie or OIDC PKCE strategy, Axios credentials/interceptors, refresh flow, protected routing, and login/logout UI. Use after /web-orchestrator completes when the service requires login.
argument-hint: "[identity provider or auth requirements]"
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Write, Edit, Bash, Agent, AskUserQuestion
metadata:
  version: 1.1.0
  maturity: eval-covered
  updated: 2026-08-03
  changelog: 인증 엔드포인트 남용 방어 절 신설 — rate limit·body 캡·입력 검증·응답 균일성·백오프를 작업 순서와 완료 조건에 강제하고, serverless in-memory rate limit의 soft limit 한계 고지 의무 추가.
---

# Auth Setup

완성된 프로젝트에 서버 세션 cookie 또는 OIDC Authorization Code + PKCE 기반 인증을 추가한다. 브라우저 라우트 가드는 UX 기능일 뿐 서버 인가를 대체하지 않는다.

Read `references/auth-patterns.md` and `.claude/skills/web-orchestrator/references/minimal-change-contract.md` before writing any auth code. 기존 API/router/session contract와 사용자 변경을 먼저 확인하고 auth에 필요한 owner 경로만 수정한다.

서버가 OAuth code exchange를 직접 수행하는 방식이면 (Google/GitHub/Kakao BFF 흐름) `references/oauth-server-flow.md`를 함께 읽는다. Session cookie, JWT signing, `_lib/session.ts`, `_lib/oauth.ts`, callback state 검증까지의 구체 계약이 있다.

Secret이 유출되었거나 정기 회전이 필요한 경우 `references/secret-rotation.md`의 rotation runbook을 따른다. Provider console에서 rotate → `.env.local` 갱신 → 배포 dashboard 갱신 → 재배포 → 검증 순서를 지킨다.

## Start

`/auth-setup`을 호출하면 intake를 진행한다:

1. **인증 아키텍처** — BFF + 서버 세션 cookie (권장) / OIDC Authorization Code + PKCE
2. **Identity Provider/BFF 계약** — issuer, client ID, redirect URI, session/current-user endpoint
3. **세션 갱신** — 서버 cookie 갱신 endpoint 또는 OIDC SDK의 rotation 정책
4. **보호할 경로** — 로그인 없이 접근 불가한 라우트 목록
5. **서버 인가 계약** — endpoint별 role/scope와 401/403 응답
6. **CSRF/CORS** — CSRF token 전달 방식, allowed origin, credential 정책

## 작업 순서

1. **Auth entity 생성**
   - `src/entities/auth/model/types.ts` — `AuthUser`, `AuthSession` 타입
   - `src/entities/auth/model/authStore.ts` — 사용자와 세션 확인 상태만 보관; credential 저장 금지
   - `src/entities/auth/api/queries.ts` — `currentUserQueries`
   - `src/entities/auth/index.ts` — 공개 API

2. **Axios 인터셉터 설정** (`src/shared/api/api.ts` 수정)
   - BFF cookie 방식: `withCredentials: true` + 상태 변경 요청의 CSRF 헤더
   - OIDC PKCE 방식: 검증된 OIDC SDK에서 받은 in-memory access token만 request interceptor에 주입
   - response interceptor: 401 → single-flight 세션 갱신 → 원 요청 1회 재시도 → 실패 시 session-expired event

3. **Login feature 생성**
   - `src/features/login/ui/LoginForm.tsx` — react-hook-form + Zod 유효성 검사
   - `src/features/login/api/mutations.ts` — `useLogin`, `useLogout` mutation

4. **Protected Route 래퍼**
   - `src/app/routes/ProtectedRoute.tsx` — 비인증 시 `/login`으로 redirect

5. **라우팅 수정** (`src/app/routes/Routes.tsx` 수정)
   - 보호 경로를 `<ProtectedRoute>`로 감싼다
   - `/login` 페이지 추가

6. **MSW 핸들러 추가** (`src/mocks/handlers/auth.ts`)
   - BFF 방식이면 `POST /api/auth/login` 또는 redirect callback — 성공/실패 케이스
   - `POST /api/auth/logout`
   - `POST /api/auth/refresh` (refresh 필요 시)

7. **인증 엔드포인트 남용 방어** (서버 구현이 이 프로젝트 범위에 있으면 생략 불가)

   인증 엔드포인트는 미인증 상태에서 호출되는 공개 표면이라 다른 API의 인증 가드로 보호되지 않는다. 서버 측에 다음을 둔다:

   | 방어 | 대상 | 요구 |
   |---|---|---|
   | rate limit | login, refresh, password reset, OAuth callback | 식별자(계정·IP) 단위 window 상한 + 초과 시 429. 실패 시도는 성공보다 엄격하게 |
   | body 크기 캡 | 모든 인증 POST | JSON 파싱 전 byte 상한(수 KB로 충분) |
   | 입력 스키마 검증 | credential·code·state 파라미터 | 타입·길이 상한. 미지 키 드롭 |
   | 응답 균일성 | login 실패 | "계정 없음"과 "비밀번호 불일치"를 구분하지 않는다(계정 열거 방지). 타이밍 차이도 최소화 |
   | 스팩 확정·백오프 | 반복 실패 | 점증 지연 또는 일시 스팩 확정. 스팩 확정 상태를 공격자에게 상세히 노출하지 않는다 |

   rate limit이 in-memory이고 serverless에 배포된다면 **인스턴스 간 비공유·cold start 리셋되는 soft limit**임을 코드 주석과 HANDOFF에 명시한다 — 하드 보장으로 표기하지 않는다. 하드 보장이 필요하면 공유 저장소(DB·KV) 카운터로 승격한다.

   서버가 이 프로젝트 밖(별도 BFF·IdP)이면 위 항목을 **서버 인가 계약**으로 문서화하고 완료 보고에 "서버 측 책임 — 확인 위임"으로 남긴다. 미확인 상태를 PASS로 표기하지 않는다.

8. **code-reviewer 에이전트로 검사**

## 완료 조건

- 비인증 상태에서 보호 경로 접근 시 `/login`으로 리다이렉트된다
- 로그인 성공 후 현재 사용자/세션 상태가 갱신되고 이전 경로로 복귀한다
- access/refresh token이 Web Storage, IndexedDB, Zustand persist에 저장되지 않는다
- cookie 방식은 CSRF/CORS와 `HttpOnly`, `Secure`, `SameSite` 서버 계약이 문서화된다
- 401 동시 응답은 single-flight 갱신 한 번으로 합쳐지고 재시도 loop가 없다
- 모든 보호 API가 서버에서 role/scope를 검증하며 401/403 계약 테스트가 있다
- 인증 엔드포인트(login·refresh·reset·callback)에 rate limit·body 캡·입력 검증이 있고, login 실패 응답이 계정 존재를 구분하지 않는다 (서버가 범위 밖이면 계약 문서화 + 확인 위임 명시)
- in-memory rate limit을 serverless에 쓰는 경우 soft limit 한계가 코드·HANDOFF에 명시된다
- `.env*`가 `.gitignore`에 포함되고 OAuth client secret·session secret이 저장소에 커밋되지 않았다
- `pnpm build`가 오류 없이 완료된다
