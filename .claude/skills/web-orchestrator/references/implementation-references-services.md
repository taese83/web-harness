# Implementation References — 비교 대상 운영 서비스(오픈소스)

허브: `implementation-references.md`. 판단 순서의 마지막(4)이다 — 따라 할 대상이 아니라 실제 규모에서의 선택을 비교한다. 설계 구조를 비교할 때
`system-architect`만 연다. 내용은 저장소 원문에서 확인하고 날짜를 적는다 — 아래는 무엇을 볼지의 색인이다(확인 2026-10). 산출물에는 쓰지 않는다.

- Bluesky social-app (https://github.com/bluesky-social/social-app) — 한 코드로 웹·모바일, 화면·상태·에러 분리, 테스트·e2e 폴더.
- Excalidraw (https://github.com/excalidraw/excalidraw) — 모노레포에서 라이브러리 패키지와 앱 분리, 커밋 전 typecheck·테스트 규칙.
- Cal.com (https://github.com/calcom/cal.com) — 타입 안전한 API·입력 검증·폼.
- Documenso (https://github.com/documenso/documenso) — 민감한 데이터의 작업 흐름·검증·테스트.

라이선스: 참고는 되지만 AGPL 등의 코드는 복사하지 않는다.

## 일반화 근거

- **웹 앱(SPA·Next)** — 위 서비스가 모두 이 형태다.
- **모노레포 라이브러리+앱** — Excalidraw가 라이브러리 패키지와 앱을 함께 둔다.

명명 수준 — eval·실사용 적용 전.
