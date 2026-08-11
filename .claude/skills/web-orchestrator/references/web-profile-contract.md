# Web Profile Contract

Web Harness의 범용 실행 범위는 세 built-in profile로 제한한다.

| Profile | Support | Primary use | Default deployment |
|---|---|---|---|
| `react-vite-spa` | certified | CSR SPA, external API, static hosting | `static-cdn` |
| `next-app-fullstack` | compatible | App Router, RSC/SSR/SSG/ISR, framework BFF | `node-server` |
| `vite-serverless-hybrid` | compatible | Vite SPA + 얇은 serverless functions (루트 `api/`, endpoint 5~30개) | `vercel-hybrid` |

`compatible`은 계약·정적 fixture·DAG가 검증됐다는 뜻이며 host-run golden, 실제 배포/rollback, 격리 CI와 외부 attestation evidence를 대신하지 않는다. 체크인된 hybrid golden도 이 하한을 완화하지 않는다. Next profile을 `certified`로 승격하려면 exact toolchain에서 Node, Docker, 조건부 static target의 golden evidence가 모두 필요하다.

`vite-serverless-hybrid`는 루트 `api/` 디렉토리가 감지 마커다 — `react-vite-spa`는 루트 `api/`를 forbidden marker로 배제하므로 두 profile은 상호 배타로 감지된다. hybrid의 release DAG는 일반 Vite evidence에 `api.unit`(serverless handler unit)과 `api.guards`(§7 엔드포인트 가드 5종 — security) receipt를 추가로 요구한다. SSR/RSC/Server Actions는 conflict로 차단된다 — 그 요구는 `next-app-fullstack`의 몫이다.

## Resolution

기존 project는 source를 수정하기 전에 실행한다.

```bash
node .claude/scripts/web-core/resolve-profile.mjs --project-root {project-root} --requested auto
```

greenfield는 tech advisor가 요구사항에 맞는 profile을 명시한 뒤 `--requested`로 고정한다. CLI stdout의 JSON을 그대로 `_workspace/01_plan/project-profile.json`에 기록한다. 오류 JSON이나 non-zero exit를 성공으로 변환하지 않는다.

```bash
node .claude/scripts/web-core/resolve-profile.mjs --project-root {project-root} --requested {profile-id} --provider {generic|vercel} --deployment {target} [--capability {capability} ...]
node .claude/scripts/web-core/compile-execution-plan.mjs --profile-file _workspace/01_plan/project-profile.json
```

execution plan stdout은 `_workspace/03_dev/web-execution-plan.json`에 기록한다. adapter manifest의 shell 문자열을 실행하지 않으며 built-in allowlist와 argv-only command contract만 사용한다.

adapter의 `provides`는 지원 가능한 capability 목록이고 profile JSON의 `capabilities`는 현재 요구에서 실제 활성화한 목록이다. 둘을 동일시하지 않는다. Next 기본값은 공개 App Router/RSC/SSG/SSR/streaming 최소 집합이며 auth, cookie identity, BFF, handler mutation, Server Action은 명시적 요구가 있을 때만 enable한다. package metadata가 완성되면 같은 선택으로 profile과 plan을 다시 잠근다.

deployment `provider`는 Vercel 같은 운영 서비스이고 `target`은 `static-cdn`, `node-server`, `static-export` 같은 runtime 형태다. 둘을 같은 값으로 취급하지 않는다. `vercel` provider는 React/Vite의 `static-cdn`, Next의 `node-server|static-export`만 허용한다.

Vercel provider 선택 시 static `vercel.json`은 profile-bound machine validator 대상이다. official schema URL, frozen install, external ingestion의 pre-build semantic validation과 post-build `public → dist|out` digest validation, framework/output matrix, internal-only routing, global baseline security headers와 non-immutable runtime data cache를 만족하지 못하거나 `vercel.ts`/Vercel Cron/inline environment value로 책임을 우회하면 quality runner와 release를 `BLOCKED` 처리한다. wrapper는 preview/build parity 검증이며 악의적 detached process를 격리하는 신뢰 경계가 아니다. static external-ingestion production은 격리 build 종료 후 attested prebuilt digest를 동일 Vercel deployment에 전달하는 protected broker adapter가 추가되기 전까지 release `BLOCKED`다.

crawler script, ingestion package, scheduled refresh workflow 또는 ingestion contract가 탐지되면 resolver는 두 ingestion contract를 요구하고 `external-ingestion`을 잠근다. runtime contract가 `static-snapshot`+`scheduled`이면 `scheduled-static-ingestion`도 잠근다. 명시 capability 목록이 이를 생략하거나 marker가 있는데 계약이 없으면 일반 web profile로 downgrade하지 않고 `BLOCKED`다.

locked profile을 읽는 quality/release/provider consumer도 현재 project를 다시 탐지한다. profile 생성 뒤 ingestion contract나 crawler가 추가되어 `external-ingestion` 또는 `scheduled-static-ingestion` capability가 빠진 상태는 stale profile로 즉시 `BLOCKED`다. detector는 bounded consistency check이며 임의 난독화 코드 부재의 증명은 아니므로 intake와 review에서 외부 수집 여부를 명시적으로 선언한다.

greenfield external-ingestion project는 web package, `_workspace`, ingestion source, runtime artifact와 `.github/workflows`가 같은 canonical project/release root 아래 있어야 한다. wrapper repository root에 crawler를 두고 nested client만 별도 release root로 검증하는 split-root 구조는 현재 built-in profile의 단일 fingerprint·receipt·workflow manifest 경계를 벗어난다. 기존 project가 이 구조라면 둘 중 하나만 검사해 PASS하지 말고 canonical root 통합 또는 별도 multi-root contract를 선행 migration scope로 `BLOCKED` 처리한다.

## Selection

`react-vite-spa`를 선택한다.

- 인증된 내부 도구지만 검색 노출과 request-time rendering이 불필요하다.
- backend가 외부 API이고 browser CSR/static CDN이 요구사항을 충족한다.
- 기존 project가 React + Vite로 탐지된다.

`next-app-fullstack`을 선택한다.

- public URL의 metadata/status/SEO와 SSR/SSG가 중요하다.
- Server Component, Route Handler, Server Action 또는 framework BFF가 필요하다.
- cookie identity를 server에서 판정하거나 request-time rendering이 필요하다.
- 기존 project가 Next App Router로 탐지된다.

선호만으로 기존 project의 framework를 바꾸지 않는다. 탐지 profile과 요청 profile이 충돌하면 `BLOCKED`이며 migration은 별도 scope다.

## Next hard stops

다음은 현재 compatible 범위 밖이다.

- Pages Router only 또는 App/Pages 혼합
- `app`과 `src/app` 동시 사용
- Edge runtime
- custom server
- coordination 계약 없는 multi-instance cache/revalidation
- 선택 deployment와 충돌하는 rendering/auth capability

Next target은 다음 release capability로 컴파일한다.

| Deployment | Execution target | Artifact |
|---|---|---|
| Node server | default `release.candidate` 또는 `release.node-server` | `.next` |
| Docker standalone | 현재 `BLOCKED` | typed broker가 증명한 `.next/standalone` + registry OCI digest가 추가돼야 활성화 |
| Static export | `release.static-export` | `out` |

static export는 cookie/request identity, Server Action, ISR, request-dependent handler, mutation handler, incomplete dynamic route가 하나라도 있으면 구현 전에 `BLOCKED`다.

## Phase routing

- 공통 Plan/Design은 기존 Phase를 사용한다.
- `react-vite-spa`만 Vite tooling/app shell/FSD 구현 wave를 사용한다.
- `next-app-fullstack`은 `/next-app`으로 위임하고 Vite 전용 `tooling-scaffolder`, `app-shell-builder`, Vite template을 호출하지 않는다.
- 공통 quality receipt와 release manifest는 유지하되 Next adapter 전용 contract check와 verifier를 추가한다.

profile JSON, enabled capability, execution plan, adapter manifest, package/toolchain, build-environment 또는 deployment matrix가 바뀌면 downstream evidence는 stale이다.
