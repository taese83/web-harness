# Security Headers Contract — CSP·프레임 보호

배포 산출물에 붙는 보안 헤더의 기본값과 측정 방법. CSP는 **Report-Only로 시작**하고(알림 층), 위반을 측정으로
0에 가깝게 만든 뒤 **사용자가 고르면** 강제로 전환한다. 막는 CSP를 먼저 넣으면 앱이 조용히 깨진다.

## 기본 정책 — UI 레인·배포 대상별

정책은 **문자열이 아니라 함수**다 — API 출처가 환경마다 다르므로 `connect-src`는 env(`VITE_API_URL`)에서 만든다.
템플릿 `VITE_CONFIG`의 `contentSecurityPolicy()`가 정본이며, 배포 헤더도 같은 함수·같은 env로 만든다.

| 대상 | 정책(Report-Only로 시작) | 근거 |
|---|---|---|
| 공통 | `default-src 'self'; script-src 'self'; connect-src 'self' <API 출처>; img-src 'self' data: blob:; font-src 'self' data:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'` | Vite 빌드 산출물에는 인라인 스크립트가 없다. `data:`·`blob:`은 인라인 자산·미리보기·워커 때문이다 — `script-src`에는 넣지 않는다 |
| `UI_LANE: tailwind-shadcn` | + `style-src 'self'` | CSS가 파일로 나온다 |
| `UI_LANE: mui` | + `style-src 'self' 'unsafe-inline'` — **선언된 예외** | Emotion이 런타임에 `<style>`을 넣는다. 정적 호스팅은 요청마다 바뀌는 nonce를 줄 수 없어 이 예외가 유일한 선택지다. 스크립트가 아니라 스타일 예외다 |
| 서버가 HTML을 요청마다 만드는 대상(Next `node-server`) | nonce + `'strict-dynamic'`, MUI는 `createCache({nonce})` | nonce는 요청마다 새로 만들어야 의미가 있다. Next는 nonce를 쓰면 모든 페이지가 dynamic rendering이 된다 — 하네스는 이 경로를 아직 검증하지 않았다 |

- **정적 대상에서 nonce를 쓰지 않는다** — Vite `html.cspNonce`나 고정 nonce는 빌드 시 값이 박혀 거짓 보안이다. Next `static-export`도 같다.
- **프레임 보호는 Report-Only 기간에도 강제한다** — Report-Only의 `frame-ancestors`는 막지 않는다. `X-Frame-Options: DENY`(또는 강제 헤더의 `frame-ancestors 'none'`)를 함께 건다.
- 외부 분석·폰트·이미지 도메인은 필요한 지시어에 도메인 단위로 더하고 이유를 한 줄 남긴다. `*`·`https:` 같은 광역 허용을 넣지 않는다.

## XSS 출구

HTML 문자열을 DOM에 넣는 길은 둘뿐이다 — 템플릿 `SAFE_HTML`(`<SafeHtml>`, DOMPurify 고정 설정)과 `JSON_LD`(`<JsonLd>`, `<` 이스케이프).
사용자·외부 URL은 `SAFE_URL`의 `toSafeHref()`(http·https·mailto)를 거친다 — React는 `javascript:`만 막고 `data:`는 통과시킨다.
`toSafeHref`는 `window`를 쓰므로 서버 렌더링 코드에서는 기준 출처를 인자로 받게 바꾼다.

## 측정 — Report-Only 위반을 증거로

헤더 없는 서버에서 돈 e2e는 위반 0을 보고한다 — 측정한 적 없는 green이다. 그래서:

1. 같은 정책을 `vite.config`의 `preview.headers`에 `Content-Security-Policy-Report-Only`로 건다(e2e가 도는 서버). preview는 **빌드와 같은 `--mode`**로 띄운다 — `vite preview`의 기본은 production 모드라, 다른 모드로 빌드하면 `connect-src`가 번들과 다른 env의 API를 담는다.
2. e2e smoke가 `securitypolicyviolation` 이벤트를 모아 첨부한다(Report-Only 위반에도 발생한다 — `disposition: "report"`).
3. `browser-verifier`는 위반 목록을 `qa-browser.md`에 적는다. **막지 않는다**(알림). 강제 전환은 위반이 설명된 뒤 사용자가 고른다.
4. 배포 헤더는 같은 함수·같은 env로 만든다 — preview와 배포가 다르면 측정이 배포를 대표하지 못한다.
5. smoke 첨부물(`csp-violations.json`)은 적용된 정책을 함께 담는다 — 정책이 `null`이면 빈 목록은 "측정 안 됨"이다.

## 호스트별 헤더

| 호스트 | 방법 | 함정 |
|---|---|---|
| Vercel | `vercel.json` `headers` | 헤더 누락은 `vercel-config-lib`가 일부(frame·nosniff·Referrer·Permissions)만 강제한다 |
| Netlify | publish 디렉터리의 `_headers` | 컨텍스트별 범위가 없다 |
| S3 + CloudFront | Response Headers Policy | 보안 헤더 패널의 CSP 값 길이 제한이 있다 — 길면 custom header로 |
| Nginx | `add_header … always` | 하위 블록에 `add_header`가 하나라도 있으면 상위 설정을 **상속하지 않는다** |

## 일반화 근거

- **SPA + 교차 출처 API**(react-vite-spa): `connect-src`를 env에서 만든다. MUI 레인은 스타일 예외가 필요하고 Tailwind 레인은 엄격 정책으로 동작한다 — 실측 `docs/audits/receipts/2026-09-20-csp-report-only.json`(강제 모드: MUI 스타일 깨짐·위반 1, Report-Only: 스타일 정상·위반 보고, 콘솔 error 0).
- **하이브리드 동일 출처 API**(vite-serverless-hybrid): API가 `/api` 같은 출처라 `connect-src 'self'`로 충분하다. 배포 헤더는 `vercel.json` — 명명 수준.
- **Next 풀스택**: nonce 경로라 설정이 다르다 — 원칙만 주고 하네스는 검증하지 않았다(명명 수준).
- 측정 범위는 smoke가 방문한 화면뿐이다(protected-core §4).
