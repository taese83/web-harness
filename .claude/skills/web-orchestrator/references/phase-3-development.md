# Phase 3 — 개발 (순서 있음)

`web-orchestrator`의 Phase 3 본문이다. **Phase 2 체크포인트를 통과한 시점에 읽는다**(선행 로드 금지).
SKILL.md 본문에서 시점 로드로 강등했다(2026-08-27) — 강등 근거와 한계는 `docs/protected-core.md` §4.

`_workspace/02_design/preview/`가 존재하면 첫 source edit 전에 `node .claude/scripts/validate-design-preview.mjs --project {root} --json`을 실행한다. 상태가 `APPROVED`가 아니면 `BLOCKED`이며, `STALE`이면 바뀐 스펙에서 프리뷰를 재생성·재확인·재승인한다. production builder에는 승인된 source digest가 묶은 design-system/layout-spec/component-spec/feature-plan만 전달하고 preview HTML/CSS/JS는 구현 입력으로 전달하지 않는다.

## 착수 전 — Gate 0

첫 줄을 쓰기 전에 `development-gates-contract.md`의 **Gate 0**(개발 착수 준비)를 통과한다.
개발 중에 막히는 것은 여기서 미리 닫는다. 개발 중 `BLOCKED` 중 **착수 전에 알 수 있었던 원인**은 Gate 0의 결함이다 — Gate A·B·C가 방금 쓴 코드를 막는 것은 정당한 차단이며 예외다.

## 형상 규율 — 이 단계의 커밋·브랜치

개발 단계에 들어가면 **묻지 않고 진행한다**. 확인을 받는 지점은 **PR 직전 하나뿐**이다.

산출물끼리 어긋나 막히는 것도 예외가 아니다 — `interaction-contract.md`의 "묻지 않는 것"을
그대로 따른다.

- **디자인은 최대한 구현한다.** design-system·component-spec·layout-spec에 정해진 것은 그대로
  따르고 임의 값으로 대체하지 않는다. 정본에 **없거나 맞지 않으면** 적정한 값을 판단해 정한 뒤
  **정본에 추가·수정한다** — 디자인은 확정 뒤에도 바꿀 수 있는 산출물이다. 없다고 멈추지 않고,
  정본을 고쳤으면 무엇을 왜 바꿨는지 PR에 남긴다. 기계 게이트로 강제하지는 않는다.
- **권장안을 낼 수 있으면 묻지 않는다.** 선택지에 "(권장)"을 붙일 수 있다는 것은 판단이 이미
  섰다는 뜻이고, 그 상태에서 묻는 것은 결정을 사용자에게 떠넘기는 것이다. 권장안으로 진행한 뒤
  **무엇을 왜 그렇게 정했는지 한 줄로 보고**한다 — 사용자는 그때 뒤집으면 된다. 아래 "묻는
  경우 넷"도 이 단서를 먼저 통과해야 한다: **문서로 답이 나오면 그 답으로 진행한다.**
- **먼저 최신으로 맞춘다.** 분기 전에 base 브랜치를 `fetch`하고 최신 상태로 올린다. 오래된
  base에서 따면 충돌을 스스로 만들고, 이미 머지된 남의 작업을 되돌리는 diff를 낸다.
  `origin/<브랜치>` 참조는 **마지막 fetch 시점의 스냅샷**이라 fetch 없이는 "최신"을 알 수 없다.
  **base가 뒤처져 있으면 묻지 않고 fast-forward한다** — 발산이 없으면 되돌릴 것이 없다.
  양쪽이 다 앞선 진짜 발산일 때만 멈춘다.
- **dev 브랜치를 딴다.** 공유 브랜치(`main`·`develop`·티켓 청구 브랜치)에 직접 커밋하지 않는다.
  티켓 흐름이면 청구 브랜치에서 `feat/<FEAT-NNN>-<슬러그>`로 분기한다(그 브랜치가 PR base다).
- **확정 산출물은 자체 판단으로 따른다.** 기획·디자인·설계·스팩은 이미 승인된 입력이므로 해석
  여지는 스스로 정한다. 멈추고 묻는 경우는 넷뿐이다:
  스펙에 없는 동작을 만들어야 할 때(**TC 발명 금지** — feature-planner 되돌림) ·
  `change-scope`의 `ALLOWED_PATHS` 밖을 고쳐야 할 때 · 확정된 계약·결정과 충돌할 때 ·
  되돌리기 어렵거나 팀 전체에 영향이 가는 조치가 필요할 때.
  **`ALLOWED_PATHS`가 비어 있는 것은 질문거리가 아니라 계획 결함이다** — 자기 TC를 검증할 수
  없는 경로 선언(`paths=none` 등)은 성립하지 않는다. 같은 공백을 앞선 FEAT가 어떻게 갈랐는지
  (선 소유 규칙)를 적용해 스스로 정하고, 계획의 `paths=` 선언을 함께 고친다.
- **커밋은 묻지 않고 계속하되 한 커밋 = 한 가지 변화**로 쪼갠다. 리팩터링과 기능 추가를 섞지
  않고, 커밋마다 무엇을·왜 바꿨는지 남기며 실측이 있으면 수치를 적는다(주장과 증명을 섞지
  않는다). **AI 공동저자 트레일러(`Co-Authored-By: Claude …`)는 넣지 않는다.**
- **커밋 후 dev 브랜치에 푸시한다.** 확인 없이 한다 — 되돌릴 수 있고 그 브랜치 안에 갇힌다.
- **PR 직전에 확인받는다.** 변경 요약·영향 파일·TC 결과·남은 미결을 보이고 승인 뒤에만 만든다.
  PR은 리뷰어를 부르고 base 브랜치로 나가는 **팀을 향한 행위**라 자율 범위 밖이다.

Gate A·B·C와 스폰 완결성 게이트는 이 규율과 무관하게 그대로 밟는다 — 커밋 자율은 게이트
면제가 아니다.

source 존재 여부로 `CHANGE_MODE: greenfield | existing-change`를 먼저 결정한다. `existing-change`이면 첫 edit 전에 `_workspace/03_dev/change-scope.md`에 `TARGET_BEHAVIOR`, `ALLOWED_PATHS`, `PUBLIC_CONTRACTS_TO_PRESERVE`, `NON_GOALS`, `CHANGE_BUDGET`, `TEST_EVIDENCE`, `CAPABILITY_ESCALATION`, `DOCS_TO_UPDATE`를 기록한다(스키마는 `minimal-change-contract.md`가 canonical). 모든 implementation/retry agent prompt에 이 필드를 전달하고 scope 확대가 필요하면 확대된 경로를 수정하기 전에 brief를 갱신한다. `CAPABILITY_ESCALATION: detected`이면 Phase 4에서 `security-reviewer` 재투입이 의무다.

`existing-change`이면 `_workspace/02_design/integration-overlay.json`이 있어야 한다 — **스팩 확정 전에** 만든다(`solution-design-contract.md` §6). 여기서 처음 만들면 스팩이 즉시 stale이 된다. 각 owner는 `change-journal-contract.md`에 따라 자기 `_workspace/03_dev/change-journal/{agent-name}.md`에 생성·수정·실패·증거를 기록한다.

프로필은 **스팩 확정 전에** 해석돼 있어야 한다(§6) — `project-profile.json`이 `LOCK_INPUTS`라 여기서 처음 만들면 확정한 스팩이 곧바로 낡는다. 아직 없으면 `web-profile-contract.md`의 resolver를 실행하고 **스팩을 재확정한다.** 이때 intake에서 판별한 요청 언어를 `outputLanguage`로 프로필에 병합하고 산출 스폰마다 주입한다 — 규약·검사는 `development-gates-contract.md` Gate L. 기존 project는 `--requested auto`, greenfield는 tech-stack의 명시 profile/provider/deployment/capability를 전달한다. resolver는 crawler script, ingestion package, scheduled refresh workflow를 발견했는데 두 ingestion 계약 또는 `external-ingestion` capability가 없으면 fail-closed해야 한다. stable stdout JSON을 `_workspace/01_plan/project-profile.json`에 그대로 저장하고 `--profile-file`로 DAG를 컴파일해 `_workspace/03_dev/web-execution-plan.json`에 저장한다. profile conflict, provider-target conflict, forbidden marker, ingestion contract/capability 누락, stale adapter hash는 `BLOCKED`다. **구현 스폰마다 `.claude/skills/component-gen/references/ts-conventions.md` 경로를 prompt에 전달한다** — Phase 2가 designer에게 디자인 원칙 허브를 넘기는 것과 같은 방식이며, 코드 작성 규약이 사후 `code-reviewer` 지적이 아니라 생성 시점에 적용되게 한다(포매팅 정본은 생성된 `.prettierrc`).

**스팩이 확정돼 있으면(`_workspace/03_dev/spec.json`) `references/shape-routing-contract.md`를 먼저 읽고 `targetShapes`가 고르는 빌더 세트를 적용한다** — `library`·`cli`는 `shape-routing-contract.md` §2의 `library` 행 세트로 가고 아래 웹 파이프라인을 돌지 않는다. 확정이 없으면 기존 `WEB_PROFILE` 경로다(무발화). `WEB_PROFILE: next-app-fullstack`이면 `/next-app`에 Phase 3 구현과 Next contract QA를 위임하고 아래 Vite 전용 1~6단계를 실행하지 않는다. `WEB_PROFILE: react-vite-spa` 또는 `vite-serverless-hybrid`일 때만 아래 단계를 실행한다 — hybrid는 같은 단계에 serverless handler 구현이 추가된다.

1. 패키지/도구/앱 기반 생성 (순서 있음):
   - `environment-scaffolder` — package/workspace metadata → TS/Vite/ESLint/Vitest 설정까지 한 스폰
   - `developer` — shared/api/config/store/env/MSW 기반
   - `EXTERNAL_DATA_INGESTION_MODE`이면 `developer` — adapter/normalize/schema/quality/atomic promotion 구현
   - `HYBRID_SERVERLESS_MODE`(`WEB_PROFILE: vite-serverless-hybrid`)이면 `/vite-serverless-hybrid`의 계약으로 루트 `api/` handler를 구현한다 — **§7 엔드포인트 공통 가드 5종이 handler 구현보다 앞선다** (release DAG의 `api.guards`·`api.unit` receipt가 강제). `SERVER_DB_MODE`·`OAUTH_SERVER_MODE`가 이 위에 조합된다
   - `SERVER_DB_MODE`이면 `/server-db-migration`을 실행해 `migrations/` 디렉토리, idempotent SQL 규칙, direct/pooled DSN 분리, 러너 script를 준비한다. 실제 migration 실행은 사용자 승인 후
   - `developer` — main/App/router/theme/home shell
2. 지원 companion과 API 계약 확정:
   - `API_CONTRACT_MODE`이면 `/api-contract-typegen`을 실행해 client/server가 공유할 schema(Zod 또는 OpenAPI codegen)를 확정한다. Mock handler와 entity/feature builder가 이 schema를 참조한다
   - `OAUTH_SERVER_MODE`이면 `/auth-setup`을 실행해 `_lib/oauth.ts`, `_lib/session.ts`, `api/auth/*/{start,callback}.ts`, `authGuard`를 구현한다. 이후 protected handler가 이 guard를 사용한다
   - `MOCK_SERVICE_MODE`이고 `developer`의 기본 셋업 이상이 필요하면 `/mock-service-setup`을 실행해 handler·fixture·시나리오 스위치·bypass mode를 조직한다
3. **구현 — `developer`를 모듈 경계마다 스폰한다.**
   **전제조건: `_workspace/03_dev/spec.json`이 있어야 한다.** 없으면 스폰하지 않는다 —
   `developer`는 기본 소유권이 비어 있어 layerMap 없이는 아무것도 쓸 수 없고, 스폰해 봐야
   디스크 변경 0건으로 반려된다(2026-08-30 실측). 스팩 확정(`spec.mjs`)으로 되돌린다.
   위쪽 "스팩이 확정돼 있으면 … 확정이 없으면 기존 `WEB_PROFILE` 경로다"는 **빌더 세트
   라우팅**에 대한 문장이지 소유권 면제가 아니다. 스팩의 `moduleBoundaries` 각각이 한 스폰의
   범위(`change-scope.md`의 `ALLOWED_PATHS`)가 되고, 소유권은 `layerMap`이 공급한다. **무엇을
   어느 순서로 만들지 지시하지 않는다** — 스팩이 정한 `architecture`·`layerMap`·`libraries` 안에서
   모델이 정한다. 경계가 겹치지 않으므로 병렬이 안전하다.
   - 구조 지시 빌더 6종(`app-shell`·`route`·`component`·`entity-query`·`feature-mutation`·
     `data-ui-binder`)은 2026-08-26에 제거됐다. 실측으로 그 소유권이 이미 성립하지 않았고
     (`src/pages/**` 3중 겹침, 비-FSD 어휘 무소유) 공급한 것은 격리가 아니라 FSD 경로 처방이었다.
4. **여전히 순서·조건이 걸리는 스폰** — 에이전트는 모두 `developer`이고 구별되는 것은 **실행
   조건과 스폰 범위**다. 3단계의 모듈 경계 스폰과 달리 아래는 앞선 산출물을 기다리거나 모드
   플래그가 켜져야 돈다:
   - Mock handler·fixture 범위. `TIMESERIES_MODE`에서는 realtime interface 완료 후로 미룬다 <!-- marker:timeseries-realtime-build-order -->
   - 차트·대시보드 범위(`TIMESERIES_MODE` · `ANALYTICS_BUILDER_MODE`) — 데이터 계층 완료 후
   - 폼 범위 · 로컬 도메인 상태 범위(`LOCAL_DOMAIN_STATE_MODE`) — 스키마 확정 후
   - SEO 산출물 범위 — 공개 노출 요구일 때만
5. browser Mock 사용 시 `public/mockServiceWorker.js`를 확인한다. dependency install이 승인·완료됐는데 파일이 없으면 실제 외부 격리가 적용된 setup job에서만 `WEB_HARNESS_ISOLATED_EXECUTION=1 node .claude/scripts/run-package-operation.mjs --project {project-root} --operation msw-init`을 실행한다. 사용자 승인만 있는 host 실행은 `BLOCKED`다
각 1·3·4단계 뒤 `development-gates-contract.md`의 Gate A·B·C를 실행하고 `FAIL|BLOCKED`면 다음 단계로 진행하지 않는다. 중간 receipt는 이후 source 변경 시 stale이며 Phase 4 release evidence를 대신하지 않는다. 이와 별개로 각 builder 스폰 직후 `execution-budget-contract.md`의 **스폰 완결성 게이트**(완결성 마커·`verify-spawn-completion.mjs`·runaway 임계)를 통과시킨다 — 실패면 re-spawn 또는 `NEEDS_DECISION`, 불완전 산출물 위에 다음 단계를 쌓지 않는다(품질 Gate A/B/C와 보완).
6. 배포 CI가 요구됐거나 `tech-stack.md`에 배포 target이 있으면 `environment-scaffolder`를 실행한다.
7. `scheduled-static-ingestion`이면 `environment-scaffolder`가 refresh workflow만 작성한다. workflow는 machine validator가 요구하는 kind/generated-path/direct-push metadata, read-only crawl job, 격리된 promotion 권한, concurrency를 포함해야 한다.
8. provider가 Vercel이면 `environment-scaffolder`가 root/app `vercel.json`, build/output/root 계약만 작성한다. ingestion workflow와 provider config를 일반 deploy agent가 임의 경로에 만들지 않는다. 모든 workflow/config는 source fingerprint 대상이므로 Phase 4 quality runner보다 먼저 완료한다.
9. `VISUAL_QA_MODE`이면 UI와 fixture 완료 후 `developer`를 시각 test/story 범위로 실행하고 baseline은 별도 승인 전까지 갱신하지 않는다.
