# Web Profile Contract

Web Harness의 범용 실행 범위는 두 built-in profile로 제한한다.

| Profile | Support | Primary use | Default deployment |
|---|---|---|---|
| `react-vite-spa` | compatible | CSR SPA, external API, static hosting | `static-cdn` |
| `vite-serverless-hybrid` | certified | Vite SPA + 얇은 serverless functions (루트 `api/`, endpoint 5~30개) | `vercel-hybrid` |

`compatible`은 계약·정적 fixture·DAG가 검증됐다는 뜻이며 host-run golden, 실제 배포/rollback, 격리 CI와 외부 attestation evidence를 대신하지 않는다. 체크인된 hybrid golden도 이 하한을 완화하지 않는다.

Next.js(`next-app-fullstack`)는 은퇴했다 — SSR/RSC/Server Action/framework BFF를 설계·검증하는 경로가 없다. `next` 패키지를 가진 프로젝트의 자동 감지, `--requested next-app-fullstack`, 그 profile을 잠근 `project-profile.json`은 resolver·plan compiler·quality runner·release gate에서 `ADAPTER_RETIRED`로 거절된다. 사용자에게 지원 범위 밖이라고 알리고, 같은 출처 BFF가 필요하면 `vite-serverless-hybrid`의 루트 `api/`를 검토하게 한다.

`certified`는 라벨이 아니라 증거다 — `supportLevel: certified`인
adapter는 `golden/{id}/`에 locked profile(certified 일치)과 격리 CI 폐곡선 receipt
(`_workspace/04_qa/t1-summary.json`, `ISOLATED_VERIFIED`)가 있어야 `validate-harness`가
통과한다(`validate-certified-evidence`). 어떤 레인이든 T1 폐곡선을 CI에서 그린으로 재현하면 같은 게이트 아래에서 certified를 획득한다.

`vite-serverless-hybrid`는 루트 `api/` 디렉토리가 감지 마커다 — `react-vite-spa`는 루트 `api/`를 forbidden marker로 배제하므로 두 profile은 상호 배타로 감지된다. hybrid의 release DAG는 일반 Vite evidence에 `api.unit`(serverless handler unit)과 `api.guards`(§7 엔드포인트 가드 5종 — security) receipt를 추가로 요구한다. SSR/RSC/Server Actions는 conflict로 차단된다 — 그 요구를 맡는 profile은 없다.

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

adapter의 `provides`는 지원 가능한 capability 목록이고 profile JSON의 `capabilities`는 현재 요구에서 실제 활성화한 목록이다. 둘을 동일시하지 않는다. package metadata가 완성되면 같은 선택으로 profile과 plan을 다시 확정한다.

deployment `provider`는 Vercel 같은 운영 서비스이고 `target`은 `static-cdn`, `node-server`, `static-export` 같은 runtime 형태다. 둘을 같은 값으로 취급하지 않는다. `vercel` provider는 `react-vite-spa`의 `static-cdn`과 `vite-serverless-hybrid`의 `vercel-hybrid`만 허용한다.

Vercel provider 선택 시 static `vercel.json`은 profile-bound machine validator 대상이다. official schema URL, frozen install, `pnpm run build` build command, framework/output matrix, internal-only routing, global baseline security headers와 non-immutable HTML cache를 만족하지 못하거나 `vercel.ts`/Vercel Cron/inline environment value로 책임을 우회하면 quality runner와 release를 `BLOCKED` 처리한다.

외부 데이터 수집 capability(`external-ingestion`·`scheduled-static-ingestion`)는 은퇴했다 — 잠긴 어댑터 해시를 지키려 어댑터 `provides`에는 남아 있지만 선택하면 resolver가 `CAPABILITY_RETIRED`로 거절한다.

## Selection

`react-vite-spa`를 선택한다.

- 인증된 내부 도구지만 검색 노출과 request-time rendering이 불필요하다.
- backend가 외부 API이고 browser CSR/static CDN이 요구사항을 충족한다.
- 기존 project가 React + Vite로 탐지된다.

`vite-serverless-hybrid`를 선택한다.

- 브라우저 SPA에 얇은 서버 함수(endpoint 5~30개, 같은 출처 BFF·비밀값 보관)가 필요하다.
- 기존 project가 React + Vite이고 루트 `api/`가 있다.

선호만으로 기존 project의 framework를 바꾸지 않는다. 탐지 profile과 요청 profile이 충돌하면 `BLOCKED`이며 migration은 별도 scope다.

## Phase routing

- 공통 Plan/Design은 기존 Phase를 사용한다.
- 두 profile 모두 Vite tooling/app shell 구현 wave를 사용한다 — hybrid는 serverless handler 구현이 추가된다.

profile JSON, enabled capability, execution plan, adapter manifest, package/toolchain, build-environment 또는 deployment matrix가 바뀌면 downstream evidence는 stale이다.
