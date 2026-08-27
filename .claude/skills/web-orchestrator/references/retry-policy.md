# Web Harness Retry Policy

Use this reference before retrying after Phase 4 QA.

## Retry Mapping

구현 에이전트는 `developer` 하나이므로 **retry 단위는 에이전트가 아니라 스폰 범위**다. 아래 표의
`developer`는 "어느 에이전트를 부르는가"가 아니라 "구현 층에서 고친다"는 뜻이고, 실제로 좁혀야
하는 것은 그 스폰의 `ALLOWED_PATHS`(= 실패가 속한 `moduleBoundaries`)다. 설계·계약 에이전트가
같은 행에 있으면 **구현보다 그쪽을 먼저 의심한다** — 스팩이 틀렸는데 구현을 고치면 다음 회차에
같은 finding이 돌아온다.

| Failing report | Common signal | Retry owner |
|---|---|---|
| `qa-code.md` | TypeScript, ESLint, import direction, missing dependency | `environment-scaffolder`(설정·의존성) 또는 `developer`(소스) |
| `qa-ux.md` | missing screen, wrong flow, missing loading/error/empty state | `layout-designer` · `component-designer` 우선, 그 다음 `developer` |
| `qa-integration.md` | build fails, dev server fails, MSW missing, route not reachable | `environment-scaffolder`(빌드·설정) 또는 `developer`(라우트·MSW 배선) |
| `qa-security.md` | credential storage, authz, CSRF/CORS, XSS, secret, CI supply-chain issue | `developer` · `environment-scaffolder` · `/auth-setup` owner |
| `qa-api-contract.md` | spec/type/schema/client/mock/stream drift | `api-schema-designer` · `timeseries-architect` 우선, 그 다음 `developer` |
| `qa-state.md` | invariant, filtered-view mutation, destructive guard, stale ID, persistence migration/recovery | `state-contract-designer` 우선, 그 다음 `developer` |
| `qa-data-quality.md` | source drift, schema/count/freshness failure, architecture mismatch, unsafe promotion, clean-build mismatch | `ingestion-contract-designer` 우선, 그 다음 `developer` · `environment-scaffolder` |
| `qa-test.md` | test failures (not WARN) | `environment-scaffolder`(테스트 인프라) 또는 `developer`(테스트·구현) |
| `qa-browser.md` | runtime route, viewport, keyboard, axe, console, network, visual/timeseries performance failure | `timeseries-architect` 우선(TIMESERIES_MODE), 그 다음 `developer` · `environment-scaffolder` |
| `qa-visual.md` | contract coverage, screenshot diff, baseline hash, render environment, token/reference drift, CLS | `visual-contract-designer` 우선, 그 다음 `developer` · `visual-baseline-manager` · `environment-scaffolder` |
| `qa-timeseries.md` | stream contract, unbounded buffer, reconnect/resume/gap, mock isolation, chart performance evidence | `timeseries-architect` 우선, 그 다음 `developer` |
| `qa-seo.md` | missing route metadata, robots/sitemap inconsistency, OG/JSON-LD, index policy drift | `developer` |
| `qa-perf.md` | bundle budget exceeded, asset policy violation, runtime budget (CLS/long task/heap) | `performance-budget-designer` 우선, 그 다음 `environment-scaffolder` · `developer` |

## Retry Rules

- Source를 수정하는 retry는 `minimal-change-contract.md`와 기존 `_workspace/03_dev/change-scope.md`를 그대로 입력으로 사용한다. finding 해결에 필요한 경로가 `ALLOWED_PATHS` 밖이면 edit 전에 scope expansion과 root cause를 기록한다.
- QA agents are read-only. They report failures and owner candidates, but do not modify failing files.
- Retry only the smallest **scope** that owns the failure. 구현 에이전트가 하나이므로 이 규칙은
  에이전트를 고르는 것이 아니라 `ALLOWED_PATHS`를 실패가 속한 모듈 경계로 좁히는 것으로 이행한다.
- Preserve the existing `_workspace` specs unless the failure is caused by a contradiction in the spec.
- After any source/design/test/config/workflow retry, rerun the approved `node .claude/scripts/run-quality-gates.mjs --all --allow-host-execution` (or the isolated-CI equivalent) because every prior command receipt is stale. Then regenerate the failed report and any report whose result changed; do not rerun unrelated analysis merely for ceremony.
- If a test failure is caused by missing test infrastructure, route to `environment-scaffolder`; if caused by missing/weak tests, route to `developer` scoped to the test paths; if caused by product logic, route to `developer` scoped to the failing module boundary. 두 경우의 차이는 에이전트가 아니라 스폰 범위다.
- Escalate to `release-manager` again only when all QA reports pass.
- **진전 조건 (retry는 조건 기반이다).** retry 전에 직전 실패 finding 목록을 기록하고, retry 후 finding 집합을 비교한다:
  - 집합이 **줄었으면** 진전이다 — cap 안에서 계속할 수 있다.
  - 집합이 **같거나 늘었으면** 즉시 Hard Stop — 남은 retry 예산이 있어도 같은 접근을 반복하지 않는다. 진전 없는 retry는 같은 실수를 더 비싸게 반복하는 것이다.
- **백스톱 cap: 보고서별 최대 2회.** 진전 중이어도 3회째 실패면 Hard Stop — 사용자에게 잔여 finding과 시도 이력을 보고하고 중단한다.
- Track retry counts and finding sets per report across the full QA cycle. Do not reset on partial passes.
- retry 스폰은 `execution-budget-contract.md`의 실행 예산에서 차감한다.

## Hard Stop Conditions

Stop and ask the user when:

- the target directory contains unrelated user files
- installing dependencies fails due to registry/network/authentication issues
- generated requirements contradict the user's original request
- real API credentials or production mutations are needed
- local domain state has unresolved data-loss behavior or an undefined destructive-action policy
- external source authorization, authoritative runtime mode, or fail-closed/last-known-good policy is unresolved
- any single QA report has failed 3 or more times (persistent failure — likely a spec contradiction or environment issue)
