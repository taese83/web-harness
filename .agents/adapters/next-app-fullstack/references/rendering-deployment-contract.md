# Next Rendering, Cache, and Deployment Contract

Next.js 기능 지원 여부는 framework 이름 하나로 결정하지 않는다. route rendering, request-time dependency, cache scope, deployment target을 함께 판정한다.

## Route rendering matrix

각 `page`, `layout`, `route`에 대해 다음 값을 고정한다.

| Field | Required values |
|---|---|
| `rendering` | `static`, `request-time`, `streamed`, `build-time-export` |
| `requestInputs` | cookies, headers, URL/query, identity, none |
| `dataClass` | public, authenticated, tenant, private |
| `cacheScope` | none, request, user, tenant, shared-public |
| `freshness` | immutable, TTL, on-demand, per-request |
| `mutationInvalidation` | tag/path/cache key or not-applicable |
| `statusContract` | success, not-found, redirect, auth/error status |
| `metadata` | title, description, canonical, robots, structured data as applicable |

Adapter는 source를 보고 rendering을 추측해 profile을 바꾸지 않는다. 구현이 route matrix와 다르면 `FAIL`; 요구사항이 선택한 deployment에서 불가능하면 구현 전에 `BLOCKED`다.

## Cache safety

1. exact Next.js version과 cache model을 profile에 잠근다. 서로 다른 cache model의 directive/API를 섞어 검증하지 않는다.
2. public immutable/TTL data만 `shared-public` cache 후보로 둔다.
3. session, authorization, tenant, locale-sensitive private response는 shared cache에 저장하지 않는다.
4. cache key에는 contract가 요구하는 tenant, locale, variant 등 모든 public partition dimension이 반영되어야 한다.
5. mutation은 영향을 받는 path/tag/key와 invalidation timing을 명시한다.
6. CDN을 Next server 앞에 두면 HTML과 RSC variation, private response, on-demand invalidation 전파를 별도 검증한다.
7. 다중 instance는 현재 compatible 범위가 아니다. shared cache, tag coordination, deployment ID/version skew 전략이 없으면 `BLOCKED`다.
8. cache test는 두 identity/tenant를 번갈아 요청하여 cross-user/cross-tenant 응답 혼합이 없음을 증명한다.

## Node server

`node-server`는 초기 full-stack 기준 target이다.

- required scripts: `build` executes `next build`; `start` executes `next start`
- build artifact: `.next`
- production evidence는 dev server가 아니라 clean build 뒤 production server로 수집한다.
- reverse proxy에서 malformed request, payload limit, rate limit, slow connection 방어를 담당한다.
- health/readiness, graceful `SIGTERM`/`SIGINT`, in-flight request drain을 검증한다.
- runtime secrets는 server process에만 주입하고 browser-visible output을 scan한다.
- single instance를 기본 compatible topology로 둔다. multi-instance는 명시적인 cache coordination contract가 필요하다.

## Docker standalone

`docker-standalone` 계약은 향후 `output: 'standalone'`을 요구하지만, 현재 quality runner가 registry의 immutable OCI digest를 직접 취득·결합하는 typed broker를 제공하지 않으므로 profile resolver에서 `NEXT_DOCKER_OCI_EVIDENCE_BROKER_REQUIRED`로 `BLOCKED`한다. 아래 항목을 모두 구현하기 전에는 선택하거나 수동 receipt로 우회하지 않는다.

- build artifact: `.next/standalone`
- runtime image에는 traced server files와 필요한 `public`, `.next/static` artifact가 포함되어야 한다.
- multi-stage build, non-root runtime user, read-only root filesystem 가능 여부, fixed base-image digest를 검증한다.
- runtime container에는 source repository, package-manager credential, build cache, test secret을 포함하지 않는다.
- health/readiness와 graceful shutdown을 실제 container에서 검증한다.
- custom server와 standalone output을 함께 선택하지 않는다.
- image digest를 release evidence와 rollback target에 기록한다.

Docker 자체 또는 승인된 container runtime이 없거나 typed broker가 image build/push 결과를 검증하지 못하면 Docker check를 PASS로 대체하지 않고 `BLOCKED`로 기록한다.

## Static export

`static-export`는 `output: 'export'`를 요구하며 artifact는 기본 `out` directory다. build 시점에 완결되는 공개 콘텐츠에만 사용한다.

다음 기능이 하나라도 필요하면 `BLOCKED`다.

- cookies 또는 request-time identity/authentication
- Server Actions
- Incremental Static Regeneration
- request object/value에 의존하는 Route Handler
- `GET` 이외의 mutation Route Handler
- `generateStaticParams`로 완결되지 않는 dynamic route
- rewrites, redirects, headers, Proxy
- Draft Mode
- default runtime image optimization
- intercepting routes 또는 server가 필요한 streaming behavior

Static export에서 허용되는 Route Handler는 build 시 정적 응답으로 확정되는 `GET`뿐이다. runtime request를 읽지 않아야 한다.

QA는 다음을 검증한다.

- `out`에 route별 HTML/asset과 404 artifact가 존재한다.
- direct URL과 refresh가 target static host의 routing contract에서 동작한다.
- browser에서 server endpoint 또는 mutation action 호출이 발생하지 않는다.
- secret/runtime-only environment 없이 clean build가 재현된다.
- configured trailing slash와 host rewrite가 route artifact mapping과 일치한다.

## Deployment selection table

| Requirement | Node server | Docker standalone | Static export |
|---|---:|---:|---:|
| Server Components | PASS | PASS | build-time only |
| Request-time SSR | PASS | PASS | BLOCKED |
| Cookie auth | PASS | PASS | BLOCKED |
| Route Handler mutation | PASS | PASS | BLOCKED |
| Server Action | PASS | PASS | BLOCKED |
| ISR/revalidation | PASS | PASS | BLOCKED |
| Static CDN only | not-applicable | optional static container | PASS |

`PASS`는 feature가 framework에서 가능하다는 뜻일 뿐 release evidence를 대체하지 않는다.

## Primary references

- <https://nextjs.org/docs/app/getting-started/deploying>
- <https://nextjs.org/docs/app/guides/self-hosting>
- <https://nextjs.org/docs/app/guides/static-exports>
- <https://nextjs.org/docs/app/api-reference/config/next-config-js/output>
- <https://nextjs.org/docs/app/getting-started/revalidating>
