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
| `qa-security.md` | credential storage, authz, CSRF/CORS, XSS, secret, CI supply-chain issue | `developer` · `environment-scaffolder` · `auth-setup` 스킬 owner |
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

## Iterate 라운드 (`change`·`fix`)

스폰이 늘수록 같은 파일을 새 문맥이 다시 읽는다 — 라운드의 스폰을 줄이는 규칙이다.

- **구현은 `developer` 1회 스폰이 코드와 그 테스트를 함께 쓴다**(소스·테스트를 스폰으로 나누지 않는다). **크면 모듈 단위로 나눈다** — 테스트 항목이
  15개 또는 쓰기 경로(`ALLOWED_PATHS` 항목)가 8곳을 넘으면 모듈(`spec.json` `moduleBoundaries` 단위)마다 의존의 아래부터 developer를 순서대로
  스폰한다. 스폰 직전에 그 모듈 경로만 담은 범위 펜스(라운드 범위의 부분집합)를 change-scope에 append해 훅이 그 모듈만 쓰게 하고, 그 모듈의
  테스트 항목만 넘긴다(각 스폰이 그 모듈의 코드와 테스트를 함께 쓴다). 마지막 모듈 뒤에는 라운드 전체 범위 펜스를 다시 append한다 — 범위 대조·
  확장이 라운드 기준으로 돌아간다. 게이트는 모든 모듈 뒤 한 번이다. 한 스폰에 다 맡기면 턴 한도에 걸려 이어 쓰기가 반복된다. 수치는 단일 실측
  교정이라 재교정 전제다(Phase 3 빌더 분해는 `spawn-decomposition-contract.md`의 기계 게이트가 맡고, Iterate는 이 산문 규칙이다). 메인은 source를 쓰지 않는다 — 고칠 것은 developer 수정 스폰으로 보낸다. developer가 못 채운 것을 메인이 직접 완결하는 폴백(`execution-contract.md` Agent invocation)은 Iterate source에 적용하지 않는다 — 수정 스폰이거나 `BLOCKED`다.
- 검사는 메인이 `node .claude/scripts/run-quality-gates.mjs --project {root} --check <id> --failure-summary`로 돌리고, 통과하지 못하면 `_workspace/04_qa/failure-summary.json`(실패 위치만 — 테스트 이름·파일:줄·규칙 id)을 수정 스폰의 입력으로 준다. 첫 실행은 사용자 승인 뒤 `--allow-host-execution`이다. 영수증 `status: BLOCKED`(스크립트 부재·engine·의존 그래프 등 환경 원인)는 수정 스폰의 입력이 아니다 — 라운드를 `BLOCKED (사유)`로 멈춘다.
- light 경로에서는 수정도 **구현한 developer를 SendMessage로 이어서** 시킨다(같은 컨텍스트 — 불가하면 새 수정 스폰). 횟수 상한은 같다. 모듈로
  나눴으면 첫 모듈은 계획 패스 developer가 잇고 나머지는 새 스폰이며, 수정은 실패 위치가 속한 모듈의 developer가 맡는다.
- **구현 스폰 뒤의 developer 스폰은 종류(수정·이어 쓰기)와 무관하게 게이트 실패·리뷰 finding 합산 라운드당 최대 2회**이고(모듈 스폰은 구현
  스폰이라 세지 않는다 — 2회 상한은 모듈 수와 무관하게 라운드당이다) 위 진전 조건을 따른다. 초과하거나 남은 FAIL이 있으면 라운드는 `BLOCKED`다 — 상한을 늘리지 않는다.

## Hard Stop Conditions

Stop and ask the user when:

- the target directory contains unrelated user files
- installing dependencies fails due to registry/network/authentication issues
- generated requirements contradict the user's original request
- real API credentials or production mutations are needed
- local domain state has unresolved data-loss behavior or an undefined destructive-action policy
- external source authorization, authoritative runtime mode, or fail-closed/last-known-good policy is unresolved
- any single QA report has failed 3 or more times (persistent failure — likely a spec contradiction or environment issue)
