# Operational Gotchas

- 기존 문서는 read-only source of truth로 정규화하고 `gap-report.md`의 `BLOCKER`를 해소하기 전 구현하지 않는다.
- Phase 1/2 체크포인트를 건너뛰지 않는다.
- 감지 모드는 intake 직후 사용자에게 보여주며 잘못 감지되면 재판별한다.
- Vite scaffold 순서는 package → tooling → shared foundation → app shell이다. Next profile은 `/next-app` 계약을 따른다.
- data owner가 모두 끝난 뒤 `data-ui-binder`를 실행한다.
- foundation, surface contract, integrated source 뒤 development Gate A/B/C를 통과하고 실패를 후속 wave에 전가하지 않는다.
- local domain state, external ingestion, timeseries, analytics, AI mode는 각 선행 설계 계약이 끝나기 전에 구현하지 않는다.
- static/live/hybrid runtime mode를 하나로 고정하고 production fixture fail-open을 금지한다.
- provider key를 browser source 또는 `VITE_*`에 두지 않는다.
- destructive/side-effect tool은 approval, idempotency, authorization 계약이 필요하다.
- source·design·test·config 변경은 기존 QA receipt와 manifest를 stale로 만든다.
- final quality runner 이후 HANDOFF 외 release 대상 파일을 수정하지 않는다.
- 기존 디렉터리 덮어쓰기, 외부 dependency 설치, Git 초기화, 장기 server, 배포·PR·삭제는 먼저 확인한다.
- **다중 프로젝트 cwd**: harness 루트 밖 프로젝트(workspace/ 하위 등) 작업 시 모든 셸 명령은 명시적
  `cd` 또는 `--dir`/`--filter`/`--project`로 실행 위치를 고정하고, 검증 명령은 실행 위치를 증거에
  포함한다 — 잘못된 루트에서 filter 미매칭으로 나오는 가짜 green이 실제 사고 유형이다.
- **dev server 소유권**: 에이전트가 server를 시작·중지할 때 사용자에게 고지하고, 사용자가 보고 있는
  세션의 server는 확인 없이 중지하지 않는다 (중지된 server의 stale 화면을 최신으로 오인하는 왕복 방지).
- **인증 뒤 화면 검증**은 `auth-verification-contract.md`를 따른다 — fixture 없이는 표면 PASS 금지.
- **dev server 콘솔·HMR 신뢰**: 브라우저 콘솔 로그는 **누적 버퍼**라 수정·리로드 이후에도 과거 에러가 현재처럼 남는다.
  HMR의 `?t=<timestamp>` 모듈 에러는 stale일 수 있으니 타임스탬프로 판별하고, 판정 전 하드 리로드한다. 렌더 성공의
  증거는 **snapshot의 실제 콘텐츠(에러 폴백 아님)**이며, import·타입 오류 판정은 dev 콘솔보다 `tsc -b`/`build` exit를
  우선한다. (실사고: import 추가·tsc 통과 후에도 콘솔 stale 에러로 FAIL 오판, 여러 사이클 낭비.)
- **생성 바이너리 자산 검증**: 아이콘·이미지 등 생성 바이너리는 `file`이 "정상 PNG"로 통과해도 내용이 blank/깨짐일 수 있다
  (실사고: 셸 base64 전송 중 512 PNG가 blank, `file` 통과). **치수·픽셀 분포·해시 같은 내용 검증**을 거치고, dist 복사본과
  source의 해시 일치를 확인한다. SVG→PNG rasterizer(sharp/rsvg/magick)가 없으면 브라우저 canvas 렌더 또는 `sips`(macOS)를
  fallback으로 쓰되, 큰 base64를 셸로 손복사하지 말고 파일 경유로 전달한다.
