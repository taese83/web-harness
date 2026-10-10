# Reference Checklist — 웹 보안

허브: `implementation-references.md`(판단 순서·산출물에 드러내지 않기). 항목 ID는 스폰 반환에서만 인용한다(파일로 남는 산출물에는 쓰지 않는다).
CSP·보안 헤더는 `security-headers.md`가 정본이다 — 여기서 다시 쓰지 않는다.
출처: OWASP Cheat Sheet Series https://cheatsheetseries.owasp.org/ (HTML5 Security, CSRF Prevention, XSS Prevention) ·
OAuth 2.0 Security Best Current Practice(RFC 9700) https://datatracker.ietf.org/doc/rfc9700/ — 확인 2026-10.

## 토큰·세션 저장

- **SEC-1** 세션 식별자를 `localStorage`에 두지 않는다 — 자바스크립트가 늘 읽을 수 있다. `HttpOnly` 쿠키를 쓴다. `sessionStorage`도 XSS 한 번이면
  전부 읽힌다(OWASP HTML5).
- **SEC-2** API 호출에 쓰는 접근 토큰을 클라이언트가 들어야 하면 메모리에만 두고, 수명은 짧게, 갱신은 서버(쿠키)가 맡는다(도출). 토큰을 URL에
  싣지 않는다(RFC 9700) — 로그·분석 이벤트에도 싣지 않는다(도출).

## CSRF — 상태를 바꾸는 요청

- **SEC-3** 상태를 바꾸는 작업에 GET을 쓰지 않는다 — `SameSite=Lax`도 최상위 GET 이동에는 쿠키를 보낸다.
- **SEC-4** 쿠키 인증 API는 토큰 패턴(서버 상태가 있으면 synchronizer token, 없으면 세션에 결박한 서명 double-submit) 또는 사용자 정의 요청
  헤더(예: `X-CSRF-Token` — 교차 출처면 사전 요청이 생기고 CORS가 신뢰 출처만 허용할 때)를 요구한다. `SameSite`는 보조 방어다.
- **SEC-5** 서버는 `Sec-Fetch-Site`로 교차 사이트의 위험 메서드를 거부하고, Origin/Referer 확인을 대비책으로 둔다.

## XSS — 출력

- **SEC-6** 프레임워크의 자동 이스케이프에 기댄다. `dangerouslySetInnerHTML`·`innerHTML`은 필요할 때만, 그 전에 DOMPurify로 정화하고 정화 뒤
  내용을 고치지 않는다. 가능하면 `textContent`를 쓴다. `eval`류를 쓰지 않는다.
- **SEC-7** 사용자·외부 입력이 `href`·`src`로 가면 허용 스킴(https 등)을 검사한다 — 프레임워크의 `javascript:` 차단은 앱 수준 URL 검증을
  대신하지 않는다. 열린 리다이렉트(`?next=`)도 허용 목록으로 막는다.
- **SEC-8** 마크다운·생성된 응답처럼 외부에서 온 서식을 그릴 때도 같은 정화 규칙이다(원문 HTML 허용 여부를 명시적으로 정한다)(도출).

## 로그인(OAuth)

- **SEC-9** 브라우저 앱은 Authorization Code + PKCE를 쓴다 — implicit 흐름을 쓰지 않는다. `state`(또는 PKCE)로 로그인 CSRF를 막고, 리다이렉트
  URI는 정확히 일치하는 등록값만 허용한다(RFC 9700).
- **SEC-10** 로그아웃은 서버 세션·갱신 토큰을 무효화한다 — 클라이언트 상태만 지우지 않는다(OWASP Session Management
  https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).

## 의존성·비밀

- **SEC-11** 비밀(API 키·클라이언트 시크릿)을 번들에 넣지 않는다 — 빌드 시 공개 접두사가 붙는 환경 변수는 공개값이다(`env-management.md`).

## 일반화 근거

- **웹 앱(SPA)** — 토큰 저장·XSS 출력·OAuth 항목이 클라이언트에 적용된다.
- **serverless·API 핸들러** — CSRF·Fetch Metadata·세션 무효화 항목이 서버에 적용된다.

명명 수준 — eval·실사용 적용 전. 이 파일의 항목은 모두 하한이다(허브 판단 순서).
