# Auth Verification Contract

인증(SSO 등) 뒤에 있는 화면을 에이전트가 브라우저로 검증할 때의 공통 계약이다.
로그인 자체를 자동화할 수 없는 환경(2FA, corporate SSO)을 전제로 한다.

## Auth Fixture (storageState)

1. **캡처는 사용자가 1회 수행한다** — headed 브라우저로 로그인 후 상태를 저장:
   ```bash
   npx playwright codegen --save-storage=playwright/.auth/user.json <app-url>
   ```
   또는 setup 스크립트에서 `page.pause()`로 사용자 로그인을 기다린 뒤 `context.storageState({path})`.
2. **에이전트는 fixture를 주입만 한다** — Playwright 테스트는 `use: {storageState}` + setup 의존 프로젝트,
   MCP 브라우저는 `--isolated --storage-state=<path>`(병렬 안전). 일회성 시각 확인은 사용자의
   로그인된 브라우저에 attach(브라우저 확장 / CDP autoConnect)하는 경로도 허용된다.
3. **sessionStorage 기반 토큰은 storageState에 저장되지 않는다** — 해당 앱은 `page.evaluate` 직렬화 +
   `addInitScript` 복원을 fixture 캡처 절차에 포함한다.

## False-pass 방지 (필수)

검증 시작 시 **인증 상태 sanity assert를 먼저 수행한다**: 로그인 후에만 보이는 요소를 명시적으로
확인하고, 로그인 페이지로 리다이렉트됐으면 그 검증은 PASS가 아니라 `AUTH_EXPIRED`다.
만료 시 에이전트는 재캡처를 사용자에게 요청하고 해당 항목을 `BLOCKED(AUTH_EXPIRED)`로 보고한다.
로그인 화면을 앱 화면으로 오인한 PASS는 무효다.

## 보안 규칙

- fixture 파일(`playwright/.auth/` 등)은 **반드시 .gitignore** + 파일 권한 600. 커밋되면 즉시 FAIL.
- 개인 계정이 아닌 **전용 테스트 계정 + 최소 권한**으로 캡처한다.
- 로그인된 세션으로 검증할 때는 대상 origin만 허용 목록에 두고, fixture 내용을 로그·리포트에 출력하지 않는다.
- attach 방식은 일상 브라우징 프로필이 아닌 검증 전용 프로필을 사용한다.

## 적용 지점

- `browser-verifier`: fixture가 있으면 주입 후 검증, 없고 대상이 인증 뒤 화면이면 `BLOCKED(AUTH_REQUIRED)`로
  보고하고 캡처 절차를 안내한다 (미인증 상태로 낸 표면 PASS 금지).
- feature mini-cycle 런타임 검증: fixture 있으면 에이전트가 직접 확인, 없으면 사용자 확인으로 전환하고
  "런타임 검증: 사용자 위임 (AUTH_REQUIRED)"로 기록한다.
