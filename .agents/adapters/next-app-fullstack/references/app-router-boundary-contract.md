# Next App Router Boundary Contract

`next-app-fullstack` adapter가 App Router 애플리케이션을 계획하거나 구현할 때 적용하는 경계 계약이다. 이 계약은 Pages Router, Edge runtime, custom server를 현재 compatible 범위에 포함하지 않는다.

## Discovery and lock

구현 전에 다음 값을 machine-readable project profile에 고정한다.

- Next.js exact version과 package-manager/Node engine
- router: `app`
- app root: `app` 또는 `src/app` 중 하나
- runtime: `node`
- cache model: `cache-components` 또는 선택한 Next.js 버전의 previous model
- deployment: 현재 `node-server` 또는 `static-export`. `docker-standalone`은 typed OCI evidence broker가 추가될 때까지 `BLOCKED`
- route별 rendering, authentication, cache scope, freshness contract

`next` dependency와 `app/layout.*`가 함께 있어야 새 App Router 프로젝트로 판정한다. `pages/`만 있는 프로젝트, App/Pages 혼합 프로젝트, custom server, Edge runtime은 자동 변환하지 않고 `BLOCKED`로 보고하여 별도 migration 승인을 받는다.

## Server and Client module graphs

1. `layout`과 `page`는 기본 Server Component로 유지한다.
2. state, event handler, effect, custom client hook, browser API가 필요한 가장 작은 entry file에만 `'use client'`를 둔다.
3. `'use client'` file의 모든 imports는 client module graph에 포함된다고 간주한다. 상위 layout/page에 편의상 directive를 추가하지 않는다.
4. database, filesystem, private upstream, privileged SDK, server environment를 읽는 module은 `import 'server-only'`로 표시하고 client graph에서 도달 불가능해야 한다.
5. browser 전용 module은 명시적인 client entry 뒤에 두며 Server Component가 직접 실행하지 않는다.
6. Server Component에서 Client Component로 전달되는 값은 React가 직렬화할 수 있는 최소 DTO여야 한다. secret, credential, database row 전체, class instance, function을 prop으로 넘기지 않는다.
7. context provider와 third-party interactive component는 좁은 client wrapper로 격리한다. provider가 root layout 전체를 불필요하게 client graph로 만들지 않게 한다.
8. client component가 server data를 필요로 하면 public Route Handler를 우회해 private server module을 import하지 않는다. Server Component의 DTO prop 또는 명시적인 HTTP/action contract를 사용한다.

경계 검증은 source directive 검색만으로 PASS하지 않는다. production build의 client chunks, HTML/RSC payload, source map 존재 시 source map을 검사하여 server-only canary와 secret canary가 없는지 확인한다.

## Route Handlers

`app/**/route.ts`는 공개 API endpoint와 같은 보안 수준으로 취급한다.

- 지원 HTTP method, request/response schema, content type, status, cache policy를 API contract에 선언한다.
- body, params, query, headers를 신뢰하지 않고 runtime schema로 검증한다.
- protected handler는 handler 내부에서 session을 확인하고 resource/role/tenant authorization을 다시 수행한다.
- layout, hidden UI, client redirect, Proxy의 optimistic check만으로 handler authorization을 대체하지 않는다.
- 인증 없음은 `401`, 인증됐지만 권한 없음은 `403`으로 구분한다. resource enumeration 방지 정책이 있으면 contract에 예외를 명시한다.
- mutation은 CSRF/origin policy, rate/abuse policy, idempotency 또는 duplicate-submission policy, audit requirement를 명시한다.
- error response에 stack, SQL, upstream credential, private object를 포함하지 않는다.
- 사용자별 응답에는 public/shared cache를 적용하지 않는다.

## Server Actions

`'use server'` function은 UI 내부 callback이 아니라 network를 통해 호출 가능한 mutation endpoint로 취급한다.

- action 시작 시 input runtime validation, fresh session 확인, resource/role/tenant authorization을 수행한다.
- page/layout에서 이미 확인했더라도 action에서 다시 확인한다.
- client가 보낸 user ID, tenant ID, role, price, ownership을 권한 근거로 신뢰하지 않는다.
- 반환값은 직렬화 가능한 최소 DTO 또는 typed error envelope로 제한한다.
- 중복 실행이 데이터 손실이나 이중 결제를 만들 수 있으면 idempotency key 또는 server-side precondition을 둔다.
- mutation 성공 뒤 cache invalidation 범위와 redirect 순서를 contract에 기록한다.
- action module은 client bundle로 들어갈 수 있는 public constant나 secret을 함께 export하지 않는다.

Server Action을 사용하는 profile은 `static-export`와 호환되지 않는다.

## Environment and secret boundary

- `NEXT_PUBLIC_*`는 이름과 무관하게 public, build-time-frozen browser input으로 취급한다. secret, private origin, privileged identifier를 넣지 않는다.
- `next.config.*`의 `env` option에 정의한 값도 client bundle 입력으로 취급하며 secret을 금지한다.
- non-public environment는 server-only validated config module에서만 읽는다. client graph가 이 module을 import하면 `FAIL`이다.
- 실제 `.env*` secret file은 commit하지 않는다. repository에는 값이 비어 있거나 명백한 non-secret placeholder만 있는 example/test fixture만 둔다.
- log, error response, trace, HTML, RSC payload, client JavaScript, source map, evidence output에서 secret을 redaction한다.
- build-time public environment는 artifact digest에 묶인다. 동일 image를 여러 환경에 승격할 때 runtime 값을 원하면 public build variable이 아니라 authenticated server endpoint 또는 dynamic server rendering contract를 사용한다.

QA는 무작위 실제 secret 대신 고유한 synthetic canary를 build/runtime environment에 주입하고 모든 browser-visible artifact에서 canary가 발견되지 않는 것을 증명한다.

## Required design outputs

Next 구현 전에 다음 설계 정보가 있어야 한다.

- route matrix: path, methods, rendering, auth, status, metadata, cache scope, freshness
- server/client boundary map: client entry와 server-only modules
- auth entry-point matrix: pages, Route Handlers, Server Actions, resource authorization
- environment classification: public build-time, private build-time, private runtime
- selected deployment target와 artifact contract

누락되면 구현을 추측하지 않고 `BLOCKED`로 반환한다.

## Primary references

- <https://nextjs.org/docs/app/getting-started/server-and-client-components>
- <https://nextjs.org/docs/app/guides/authentication>
- <https://nextjs.org/docs/app/guides/environment-variables>
- <https://nextjs.org/docs/app/getting-started/route-handlers>
