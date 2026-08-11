# Next App Router QA and Evidence Contract

이 문서는 공통 QA evidence contract에 추가되는 Next adapter 전용 gate다. verifier가 작성한 설명이나 Markdown PASS 문구는 release evidence가 아니다.

## Status semantics

- `PASS`: 현재 source fingerprint에서 명령 또는 deterministic inspection이 성공했고 receipt가 존재한다.
- `FAIL`: 구현 또는 artifact가 선언한 contract를 위반한다.
- `BLOCKED`: 필수 tool, profile decision, test, runtime 또는 evidence가 없어 판정할 수 없다.
- `NOT_APPLICABLE`: profile resolver가 이유와 함께 제외했다.

Security violation을 `BLOCKED`나 `NOT_APPLICABLE`로 낮추지 않는다. 필수 check 누락을 PASS로 간주하지 않는다.

## Common required checks

| Check ID | Acceptance |
|---|---|
| `next.clean-install` | locked package manager로 clean dependency closure 성공 |
| `next.lint` | configured lint exits 0; script 없음은 BLOCKED |
| `next.typecheck` | no-emit typecheck exits 0 |
| `next.unit` | discovered test가 1개 이상이고 exits 0 |
| `next.build` | clean `next build` exits 0; unexpected source mutation 없음 |
| `next.route-contract` | 구현 route/method/status/rendering이 route matrix와 일치 |
| `next.client-boundary` | server-only import와 non-serializable prop 경계 위반 0건 |
| `next.secret-boundary` | synthetic secret canary의 browser-visible 유출 0건 |
| `next.production-start` | 선택 target의 production runtime 기동과 readiness 성공 |
| target-specific `next.*-browser` | 선택 artifact의 direct route, navigation, refresh, error UI, console/network 검사 성공 |
| target-specific `next.*-hydration` | 선택 artifact의 hydration mismatch/error 0건 |

Public route가 있으면 metadata, canonical, robots/status evidence를 요구한다. authentication이 있으면 선택 target의 `next.*-authz`와 `next.*-cache-isolation`을 요구한다. 선택 deployment별 check는 아래와 같다.

| Target | Additional check IDs |
|---|---|
| Node server | `next.production-start`, `next.node-smoke`, `next.node-browser`, `next.node-hydration`, `next.node-shutdown` |
| Docker standalone | 현재 typed OCI digest broker 부재로 profile resolution에서 `BLOCKED` |
| Static export | `next.export-artifact`, `next.static-host-smoke`, `next.static-browser`, `next.static-hydration` |

## Receipt contract

각 check receipt는 최소 다음을 포함한다.

- check ID, status, blocked reason
- adapter ID/version/hash와 exact Next.js/Node/package-manager versions
- argv array, cwd, start/end, timeout, exit code
- stdout/stderr digest. raw output tail·excerpt는 receipt에 저장하지 않음
- discovered test/route/artifact count
- source fingerprint before/after
- allowed generated-output mutations
- build artifact path and digest when applicable
- environment variable names allowlist와 public value set digest; 실제 values는 persisted receipt에 기록하지 않음
- canonical execution-plan digest, package script digest, reviewed lockfile와 effective top-level package/`.bin`/virtual-store graph digest, 직접 실행한 store binary digest
- 동일 `--all` quality cohort ID와 24시간 freshness

Source fingerprint에는 application source, tests, lockfile, package manifest, Next config, TypeScript config, route matrix, selected profile, adapter manifest, deployment config가 포함된다. 이 중 하나가 바뀌면 downstream build/browser/deploy/rollback evidence를 stale 처리한다.

Allowed generated output은 selected target에 맞는 `.next`, `out`, coverage, test result, Playwright trace/report로 제한한다. `.claude`, `.git`, `.github`, `_workspace`, `src`, `scripts`, `node_modules`, package metadata와 secret path는 exact root를 포함해 generated artifact 예외가 될 수 없다. source, tests, config, snapshot, lockfile mutation은 check 실패다.

## Production runtime tests

브라우저 검증은 `next dev`가 아니라 현재 fingerprint로 만든 production artifact를 사용한다.

각 runtime test script는 대상 artifact의 start, readiness, test, teardown을 한 process lifecycle 안에서 소유하고 timeout 뒤에도 child process를 남기지 않는다. manifest의 `next.production-start`도 장기 실행 `next start` 자체가 아니라 production start/readiness/teardown을 검증하는 종료 가능한 `test:production-start` script다. 서로 다른 receipt가 살아 있는 동일 server/container를 암묵적으로 공유하지 않는다.

- 각 public/protected/not-found route를 direct URL과 client navigation 양쪽에서 확인한다.
- expected `200`, redirect, `401`, `403`, `404` contract를 확인한다.
- browser console의 hydration, uncaught error, CSP violation과 failed request를 수집한다.
- HTML head와 response metadata/canonical/robots를 검사한다.
- streaming route는 fallback, completion, status timing을 검사한다.
- browser-visible HTML, RSC payload, JavaScript, source map, storage, logs에서 synthetic server secret canary가 없어야 한다.

## Authentication and cache isolation tests

protected Route Handler와 Server Action마다 최소 다음 fixture를 실행한다.

1. anonymous request
2. authenticated but wrong role
3. correct role but another resource owner/tenant
4. authorized request
5. invalid/expired session
6. malformed input and duplicate submission when mutation is retriable

각 handler/action 내부의 authorization evidence가 있어야 하며 layout/Proxy redirect만으로 PASS하지 않는다.

Cache isolation은 서로 다른 marker를 가진 identity A/B 또는 tenant A/B로 같은 route를 교차 요청한다. A의 marker가 B의 HTML, RSC, JSON, browser state에 나타나면 Critical `FAIL`이다. mutation 뒤에는 선언한 invalidation 범위 밖의 cache가 불필요하게 제거되지 않는지도 확인한다.

## Static export tests

- forbidden server capability scan을 build 전에 실행한다.
- clean build의 `out` file inventory와 digest를 기록한다.
- 실제 static server에서 root, nested route, dynamic generated route, 404, refresh를 확인한다.
- network log에 same-origin server mutation endpoint가 없어야 한다.
- build machine 없이 artifact만으로 smoke test를 재실행한다.

## Deployment and rollback evidence

Deployment receipt는 artifact digest, image digest if any, target, immutable release ID, health/smoke result를 현재 source fingerprint에 연결한다. 실제 deploy 권한이 없거나 target이 제공되지 않으면 local build를 deploy PASS로 위장하지 않고 `BLOCKED`다.

Rollback은 직전 검증 artifact/image digest를 재승격하고 smoke를 다시 실행한다. database migration이 있으면 이전 app artifact와 호환되는 expand-contract evidence가 없을 때 rollback을 PASS로 판정하지 않는다.

## Release hard stops

- required receipt 누락 또는 stale fingerprint
- zero discovered tests
- dev server에서만 얻은 browser evidence
- hydration error
- secret canary 유출
- Route Handler/Server Action authorization 누락
- cross-user/cross-tenant cache leak
- profile과 rendering/deployment artifact 불일치
- Docker/static runtime 부재를 추정 PASS로 처리

이 중 하나라도 있으면 HANDOFF 생성 전에 release를 중단한다.
