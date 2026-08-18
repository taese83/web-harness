# Web Harness

Claude Code의 skill과 subagent를 이용해 웹 애플리케이션을 **기획 → 설계 → 구현 → 검증 → 인수인계** 순서로 개발하는 프로젝트 harness다.

React/Vite SPA와 Next.js App Router 애플리케이션부터 시계열·semantic analytics 대시보드와 AI Agent 기반 서비스까지 지원한다. 주니어 개발자는 하나의 자연어 명령으로 시작하고, 전문 Agent가 역할과 파일 소유권을 나누어 작업하도록 설계되어 있다.

> 이 저장소는 완성된 웹 서비스가 아니라 **웹 서비스를 만드는 개발 Agent 체계**다.  
> `.claude/agents`는 개발을 수행하는 build-time Agent이며, 실제 서비스에서 동작하는 runtime Agent는 생성되는 애플리케이션 내부에 별도로 구현된다.

---

## 5분 만에 시작하기

### 1. Harness 검증

```bash
nvm use
pnpm install --frozen-lockfile
pnpm run ci
```

현재 기준 다음을 검증한다.

- 31개 skill <!-- inventory:skills -->
- 99개 agent <!-- inventory:agents -->
- built-in profile 3개: `react-vite-spa`, `next-app-fullstack`, `vite-serverless-hybrid` — 모두 compatible (`certified`는 T1 격리 CI receipt를 요구하는 기계 게이트로 강제되며, 현재 충족 레인 없음)
- agent별 파일 소유권
- read-only verifier 경계
- 문서 위생 (깨진 경로 참조·하드코딩 잔재·스킬 버저닝·README inventory)
- 전역 Bash 정책 fixture 49개
- profile resolver·DAG·deployment conflict assertion 54개
- Next.js adapter contract case 15개
- 전체 harness integration check 47개
- 일반 웹 eval contract 39개
- AI eval scenario 31개
- AI secret·tool safety hook
- Web Harness Console 정적 검사와 API·보안·traceability 회귀 테스트

skill/agent 개수 라인의 `<!-- inventory -->` 마커는 `validate-harness.mjs`가 실제 개수와 대조한다 — 수치가 어긋나면 검증이 실패하므로 README가 stale해질 수 없다.

> AI 서비스 브랜치 5종(ai-code-review-bot, browser-agent, customer-support-ai, enterprise-search-ai, ai-analytics-dashboard)은
> frontmatter `metadata.status: experimental` — 계약 요약 수준의 스텁이며 코어 수명주기(web-orchestrator 계열)와 완성도 기준이 다르다.

### 2. Claude Code에서 프로젝트 시작

```text
/web-orchestrator

관리자가 고객과 주문을 조회하고 상태를 변경할 수 있는 웹 서비스를 만들어줘.
API는 우선 Mock으로 구현하고 실제 API 연결 가이드도 제공해줘.
모르는 요구사항은 질문하거나 합리적인 기본값을 제안해줘.
```

### 3. 생성 결과 실행

```bash
node .claude/scripts/run-package-operation.mjs --project . --operation install
pnpm dev
```

### 4. 검증

```text
/web-verify

핵심 사용자 흐름, 반응형, 접근성, API contract와 브라우저 동작을 검증해줘.
```

---

## 해결하려는 문제

웹 개발을 자연어로 요청할 수 있어도 다음 문제가 남는다.

- 요구사항이 불명확한 상태에서 바로 코드를 생성한다.
- 하나의 Agent가 기획·설계·코드·테스트를 모두 담당한다.
- 파일 수정 책임이 겹쳐 기존 구현이 덮어써진다.
- Mock과 실제 API 계약이 달라진다.
- 크롤러·정적 snapshot·runtime API가 서로 다른 데이터 경로를 설명하고, 빈 수집 결과가 정상 데이터로 배포된다.
- 필터·정렬·드래그·삭제가 결합된 로컬 상태에서 숨겨진 데이터나 참조 관계가 손상된다.
- 테스트가 실패해도 Agent가 직접 test나 snapshot을 고쳐 PASS로 만든다.
- 실행되지 않은 명령을 QA Markdown에 exit 0으로 기록하거나 소스 변경 뒤 오래된 QA를 재사용한다.
- AI 기능에서 provider secret, prompt injection, 과도한 tool 권한이 누락된다.
- “동작하는 데모”와 “운영 가능한 제품”이 구분되지 않는다.

Web Harness는 이를 다음 구조로 해결한다.

1. 요구사항과 가정을 먼저 기록한다.
2. 설계 산출물이 완료되기 전 구현을 시작하지 않는다.
3. Agent마다 독립적인 책임과 소유 경로를 부여한다.
4. 구현 Agent와 read-only 검증 Agent를 분리한다.
5. 정적 규칙은 prompt가 아니라 hook과 validator로 강제한다.
6. Mock과 실제 연동이 같은 adapter contract를 사용한다.
7. AI 서비스는 runtime, data, tool, approval, trace, eval을 별도 설계한다.
8. 브라우저 소유 도메인 상태는 명시적 command, 불변식, migration, recovery 계약으로 관리한다.
9. 외부 수집 데이터는 source 권한, runtime schema, quality SLO, atomic promotion, clean-build 계약으로 관리한다.
10. release는 모델이 작성한 PASS가 아니라 실제 process receipt와 source fingerprint로 검증한다.

---

## 주요 기능

### 일반 웹 개발

- 요구사항과 MVP 범위 작성
- UX brief와 기능 계획 — 화면별 정보 위계·디자인 방향·Feature List(keep/cut/defer 다듬기)와 append-only 기획 변경 대장
- 구현 전 디자인 프리뷰 루프 — 발산 조사가 커밋한 단일 시안을 디자인 근거와 함께 무의존 프리뷰로 확인·승인 (비교 토글은 opt-in)
- 기술 스택과 rendering profile 결정
- React + TypeScript + Vite 기반 생성 또는 Next.js App Router compatible 경로
- Feature-Sliced Design 구조
- Router, Query, form, mutation, Mock API
- 접근성, 반응형, error·loading·empty 상태
- Vitest와 Playwright
- API contract, 통합, 보안, 브라우저 QA
- 배포·릴리스 handoff

### Built-in web profile

| Profile | 현재 등급 | 범위 | 기본 artifact |
|---|---|---|---|
| `react-vite-spa` | compatible | React/Vite CSR, static CDN/container | `dist` |
| `vite-serverless-hybrid` | compatible | React/Vite CSR + app-root Vercel Functions | `dist` + root `api/` |
| `next-app-fullstack` | compatible | App Router, Node SSR/RSC/BFF, 조건부 static export | `.next`, `out` |

`certified`는 2026-08-18부터 기계 게이트(`validate-certified-evidence`)가 격리 CI 폐곡선
receipt를 요구한다 — 현재 충족 레인이 없어 세 프로파일 모두 compatible이다(승격 절차는
`docs/ci-activation-runbook.md`).

Hybrid profile은 root `api/`, Web Standard Vercel Functions, endpoint 5종 가드와 `api.unit`·`api.guards` receipt를 요구한다. `golden/vite-serverless-hybrid/`는 host/격리 CI 재현 경로를 제공하지만 실제 provider 배포와 외부 attestation이 없으면 certified로 승격하지 않는다.

Next.js는 지원 capability와 실제 enabled capability를 분리한다. 기본 공개 profile은 auth/BFF/mutation을 자동 활성화하지 않으며 route/server-client/auth/env/cache/deployment matrix, canonical execution-plan digest, target별 command receipt와 artifact directory digest가 모두 현재 fingerprint에 연결돼야 release가 가능하다. Pages-only/mixed Router, Edge runtime, custom server, 무조정 multi-instance는 초기 범위 밖이다. `docker-standalone`은 실제 registry image의 immutable OCI digest를 생성·회수하는 typed broker가 아직 없어 resolver 단계에서 fail-closed `BLOCKED`다. Node·static production golden과 실제 rollback evidence가 완료되기 전 adapter 자체를 certified로 승격하지 않는다.

### 로컬 도메인 상태 앱

- localStorage·IndexedDB·offline CRUD 자동 판별
- authoritative state와 filtered·sorted·virtualized view 분리
- 구조 변경을 broad patch가 아닌 명시적 command로 제한
- 이동·정렬·삭제의 precondition과 postcondition 정의
- hidden data, stale selection, duplicate ID, dangling reference 방지
- runtime schema, version migration, invalid-state recovery
- quota·size·count 상한과 deterministic fixture
- 상태 불변식 전용 `qa-state.md` release gate

### 외부 데이터 수집 앱

- crawling·scraping·RSS·CSV·scheduled sync·build-generated artifact 자동 판별
- `static-snapshot`, `live-api`, `hybrid` runtime mode 고정 (`static-snapshot`만 현재 built-in release evidence 지원)
- source authorization·allowlist·rate/timeout·credential 계약
- raw → normalized → runtime artifact의 schema 경계
- freshness·count·coverage·duplicate·diff threshold
- empty·partial·selector drift·count-drop fixture
- temp validation 후 atomic promotion과 last-known-good 보존
- root·workspace·배포 provider clean-build matrix
- static snapshot의 required/검증된 optional/last-known-good source와 실제 `dist/|out/` 배포 복사본의 byte-identical digest 검증
- strict runtime contract와 같은 `--all` cohort의 `ingestion` machine receipt
- full-SHA GitHub Actions, exact generated path, read-only collection과 protected CI allowlist에 결합된 단일 promotion broker policy
- provider와 runtime target 분리, Vercel static config의 build/output/routing/header machine validation
- Vercel static external-ingestion production은 격리 build 종료 후 attested prebuilt digest를 동일 deployment에 결합하는 protected broker가 추가되기 전 release fail-closed
- 전용 `qa-data-quality.md` release gate

greenfield 수집 앱은 web package, crawler, contract, generated artifact와 workflow를 하나의 canonical project/release root에 둔다. parent crawler + nested client를 서로 다른 root로 검증해 한쪽만 PASS시키지 않는다.

### 시계열 대시보드

- historical 날짜 범위 조회
- realtime WebSocket, SSE 또는 polling
- snapshot + stream 결합
- reconnect, resume, gap recovery
- duplicate·out-of-order 처리
- bounded ring buffer
- downsampling과 aggregation
- Web Worker 도입 기준
- chart render·memory·interaction budget
- deterministic realtime Mock
- 실제 stream API 전환 가이드

### Semantic analytics와 차트 빌더

- metric·dimension catalog와 aggregation/filter/group/order query AST
- cardinality·row·time range·execution budget
- line, bar, funnel, retention, flow, table compatibility matrix
- funnel·retention·flow 전용 결과 계약
- chart draft·validation·preview·save 흐름
- dashboard panel add·move·resize·duplicate·remove
- saved revision, optimistic conflict와 unsaved-change 보호
- deterministic analytics fixture와 전용 `qa-analytics.md` release gate

시계열과 함께 요청되면 WebSocket·buffer·gap recovery는 timeseries mode가, metric 의미·query·chart compatibility·dashboard config는 analytics builder mode가 담당한다.

### AI Agent 웹 서비스

- server-side model gateway
- provider adapter와 fallback
- agent session, workflow, cancel, resume
- typed tool contract
- downstream authorization
- 사람 승인과 idempotency
- retrieval ACL과 data governance
- prompt injection·excessive agency threat model
- token·비용·지연 budget
- trace와 PII redaction
- evidence 기반 AI eval
- progressive autonomy

### 지원하는 AI 서비스

1. AI 코드리뷰 봇
2. 사내 문서 검색 AI
3. AI 고객센터
4. AI 대용량 데이터 대시보드
5. 제한형 브라우저 Agent

---

## 전체 구조

```text
사용자 명령
    |
    v
Orchestrator Skill
    |
    +-- 요구사항 Agent
    +-- 설계 Agent
    +-- 구현 Agent
    +-- 서비스 전용 Agent
    +-- Read-only QA Agent
    |
    v
생성 프로젝트 + _workspace 산출물 + HANDOFF
```

### 일반 웹 실행 단계

```text
Phase 1: Plan
  requirements -> UX -> feature plan -> tech stack -> project brief

Phase 2: Design
  mode architecture -> ingestion/state contract -> design system -> layout -> API -> component spec

Phase 3: Develop
  package -> tooling -> foundation -> ingestion/runtime -> app shell -> feature/data/UI

Phase 4: QA
  test setup -> machine quality receipts -> read-only QA -> signed attestation -> manifest v3

Release
  reports + receipts + source fingerprint -> retry routing -> HANDOFF
```

### AI 웹 실행 단계

```text
AI Requirements
    |
    v
AI Design Gate
  architecture
  tool contracts
  data governance
  threat model
  eval plan
  cost/latency budget
    |
    v
Common Runtime
  agent API
  model gateway
  tool adapters
  human approval
  observability
    |
    v
Service Builder
    |
    v
AI Eval + Security + Data Access + Cost + Trace QA
```

AI 필수 설계 문서가 완성되지 않으면 runtime 구현 단계로 진행하지 않는다.

---

## 디렉토리

```text
.claude/
├── agents/                 역할별 subagent
├── skills/                 사용자 명령, focused references, section-loaded assets
├── adapters/               React/Vite·Next built-in profile manifest와 계약 fixture
├── schemas/                project profile·adapter·execution plan JSON Schema
├── evals/                  일반·AI 시나리오 계약
├── scripts/                shared registry/evidence, validator와 safety hook
│   └── validators/         독립 fixture·settings·workflow 검증 모듈
├── settings.json           permission과 hook 등록
└── ai-harness.json         AI mode·service·agent manifest

_workspace/
├── 00_source/              기존 기획·디자인·API 원문 index
├── 01_plan/                요구사항과 계획
├── 02_design/              설계와 contract
├── 03_dev/                 개발 진행 산출물
├── 04_qa/                  QA 보고서, evidence receipt, signed attestation, manifest v3
└── RELEASE/                최종 HANDOFF
```

---

## Skill 사용법

### 시작점

| 명령 | 사용 시점 |
|---|---|
| `/web-orchestrator` | 일반·AI 웹 애플리케이션 전체 개발 |
| `/dev-orchestrator` | 웹 앱, React library, TypeScript utility 자동 분기 |
| `/web-plan` | 구현 없이 기획과 설계만 필요할 때 |
| `/project-init` | 새 React + TypeScript 프로젝트 scaffold |
| `/next-app` | Next.js App Router compatible profile 구현·계약 검증 |
| `/web-verify` | 기존 프로젝트의 QA만 재실행 |
| `/web-console` | Web Harness Console 시작·상태 확인·재시작·종료 |

### Web Console 운영

`/web-console`은 저장소에 포함된 Web Harness Console과 isolated preview 서버를 안전하게 운영하는 로컬 전용 스킬이다.

```text
/web-console start
/web-console status
/web-console restart
/web-console stop
```

| Action | 동작 |
|---|---|
| `start` | 기존 Console을 먼저 확인하고, 실행 중이 아닐 때만 `pnpm console`을 long-lived session으로 시작한다. |
| `status` | process를 변경하지 않고 4310/4311, indexed project 수와 Codex CLI 설치·인증·연결 상태를 확인한다. |
| `restart` | 현재 작업이 소유한 session은 정상 종료 후 재시작한다. 외부 작업의 process는 사용자 확인 없이 종료하지 않는다. |
| `stop` | 소유한 session만 바로 종료하고 두 port가 해제됐는지 확인한다. |

- Console: `http://127.0.0.1:4310/`
- Isolated preview: `http://127.0.0.1:4311/`
- 상태 API: `GET /api/projects`, `GET /api/codex/status`
- 결과 상태: `RUNNING`, `ALREADY_RUNNING`, `STOPPED`, `PORT_CONFLICT`, `FAILED`

스킬은 root `package.json`의 `scripts.console`과 `packages/web-harness-console/server.mjs`를 모두 확인한 뒤 실행한다. 4310을 다른 서비스가 사용 중이면 해당 process를 임의 종료하지 않고 `PORT_CONFLICT`로 보고한다. 고정 Node 경로가 필요할 때도 기존 `PATH` 앞에만 추가해 Codex CLI 탐색 경로를 보존한다. 브라우저 열기나 특정 project/tab 이동은 함께 요청한 경우에만 수행한다.

터미널에서 직접 실행하려면 `pnpm console`을 사용한다. Console의 Change Request와 Codex 적용 흐름은 [`packages/web-harness-console/README.md`](packages/web-harness-console/README.md)를 참고한다.

### 일반 개발

| 명령 | 역할 |
|---|---|
| `/feature-add` | 기존 앱에 기능 추가 |
| `/component-gen` | UI 컴포넌트 생성·수정 |
| `/api-connect` | Mock API를 실제 API로 전환 |
| `/auth-setup` | session·OIDC 기반 인증 설계·구현 |
| `/fsd-scaffold` | FSD layer와 slice 생성 |
| `/i18n-setup` | 다국어 catalog·locale routing·번역 완전성 |
| `/pr-drafter` | 변경 사항으로 PR 설명 작성 |

### 시계열

| 명령 | 역할 |
|---|---|
| `/timeseries-dashboard` | historical·realtime 시계열 설계·구현·검증 |

### AI 공통

| 명령 | 역할 |
|---|---|
| `/ai-app-orchestrator` | AI 요구사항부터 runtime·QA까지 통합 |
| `/ai-runtime-setup` | model gateway, session, tool, approval, trace |
| `/ai-eval` | AI 정적 gate와 runtime scenario 검증 |

### AI 서비스

| 명령 | 역할 |
|---|---|
| `/ai-code-review-bot` | SCM 기반 AI 코드리뷰 |
| `/enterprise-search-ai` | ACL 기반 사내 문서 검색 |
| `/customer-support-ai` | 상담원 보조·고객 응대·handoff |
| `/ai-analytics-dashboard` | semantic metric 기반 AI 대시보드 |
| `/browser-agent` | 허용된 domain·action의 브라우저 업무 자동화 |

### 라이브러리와 버전

| 명령 | 역할 |
|---|---|
| `/lib-advisor` | library API와 packaging 자문 |
| `/version-bump` | 승인된 version 변경 |

---

## 어떤 명령으로 시작해야 하는가

### 새 웹 서비스

`/web-orchestrator`로 시작한다.

```text
/web-orchestrator

고객과 상담원이 문의를 주고받는 반응형 웹 서비스를 만들어줘.
로그인, 문의 목록, 상세, 답변, 검색이 필요해.
API는 Mock으로 시작하고 실제 연결 가이드를 제공해줘.
```

### 기존 기획·디자인 문서가 있는 프로젝트

```text
/web-orchestrator

다음 문서를 기준으로 웹 애플리케이션을 구현해줘.

- docs/product-requirements.md
- docs/screen-definition.md
- docs/openapi.yaml

원문은 수정하지 말고 누락 사항과 충돌을 먼저 보고해줘.
```

Agent는 원문을 `_workspace/00_source`에 정규화하고 누락된 Phase만 실행한다.

### 서버 없이 데이터를 관리하는 앱

```text
/web-orchestrator

브라우저에 저장되는 업무 보드를 만들어줘.
필터와 검색 중에도 항목 이동·정렬·다중 선택·삭제가 안전해야 하고,
이전 저장 버전이나 손상된 데이터도 복구할 수 있어야 해.
```

예상 mode는 `LOCAL_DOMAIN_STATE_MODE`다. 구현 전 `state-contract.md`가 생성되고, release 전 `qa-state.md`가 필수 evidence가 된다.

### 외부 데이터를 수집해 배포하는 앱

```text
/web-orchestrator

허용된 공개 API와 RSS에서 행사 정보를 매일 수집해 정적 웹으로 보여줘.
현재 runtime은 static snapshot으로 고정하고 source별 최소 건수와 freshness를 정의해줘.
한 source가 비거나 schema가 바뀌면 배포하지 말고 이전 정상 데이터를 유지해줘.
clean clone과 배포 provider의 build 경로도 동일하게 검증해줘.
```

예상 mode는 `EXTERNAL_DATA_INGESTION_MODE`다. 구현 전 `ingestion-contract.md`와 `runtime-data-contract.json`, release 전 `qa-data-quality.md`가 필수다.

### 기존 앱에 기능 추가

```text
/feature-add

현재 주문 상세 화면에 배송지 변경 기능을 추가해줘.
주문 상태가 결제 완료일 때만 가능하고 변경 전 확인 dialog가 필요해.
기존 API·상태관리·컴포넌트 패턴을 유지해줘.
```

### 화면만 수정

```text
/component-gen

대시보드 필터가 모바일에서 세로로 너무 길어.
desktop 구조는 유지하고 mobile에서는 drawer로 변경해줘.
키보드 탐색과 focus 복귀를 포함해줘.
```

### Mock을 실제 API로 연결

```text
/api-connect

현재 사용자 목록 Mock을 제공된 OpenAPI와 실제 staging endpoint로 교체해줘.
기존 query key와 UI 상태는 유지하고 contract 차이를 먼저 보고해줘.
```

---

## 주니어 개발자 권장 작업 시나리오

### 1. 명령에는 “무엇”과 “제약”을 함께 작성한다

나쁜 요청:

```text
대시보드 만들어줘.
```

권장 요청:

```text
/web-orchestrator

운영자가 서비스 오류율과 응답 시간을 날짜별로 조회하는 대시보드를 만들어줘.

- 최근 30일 조회
- 서비스·환경별 필터
- 최근 1시간 실시간 표시
- API는 Mock
- 실제 WebSocket 연결 가이드
- 모바일 지원
- 성능 예산 포함
- 모르는 값은 ASSUMPTION으로 기록
```

### 2. 기술 선택보다 업무 정보를 제공한다

주니어 개발자가 반드시 제공할 정보:

- 누가 사용하는가
- 사용자가 완료하려는 작업
- 반드시 필요한 기능
- 읽는 데이터와 변경하는 데이터
- 권한과 승인
- 실패했을 때 영향
- Mock 또는 실제 API 상태

Agent에게 맡겨도 되는 정보:

- 폴더 구조
- 상태관리 library
- chart library
- runtime validation 방식
- test 배치
- Worker·cache·stream 구현 방식

특정 기술을 사용해야 하는 조직적 이유가 있으면 명시한다.

### 3. 모르는 값은 숨기지 않는다

```text
정확한 데이터량과 latency 목표는 아직 몰라.
중간 규모 서비스를 기준으로 보수적인 baseline을 제안하고
ASSUMPTION으로 기록해줘.
production 연결 전에 확인할 항목도 표시해줘.
```

Agent가 만든 임시 가정을 사실로 간주하지 않는다.

### 4. Plan을 검토한 후 구현한다

다음 파일에서 먼저 확인한다.

```text
_workspace/01_plan/requirements.md
_workspace/01_plan/project-brief.md
```

AI 프로젝트라면 추가 확인한다.

```text
_workspace/01_plan/ai-requirements.md
_workspace/01_plan/autonomy-risk-matrix.md
```

검토 질문:

- 요구 기능이 빠지지 않았는가
- 불필요한 기능이 추가되지 않았는가
- 사용자와 권한이 정확한가
- `ASSUMPTION`을 승인할 수 있는가
- `BLOCKER`가 남아 있지 않은가
- AI autonomy가 과도하지 않은가
- 외부 데이터의 source 사용 권한과 authoritative source가 확인됐는가
- 현재 runtime이 static snapshot, live API, hybrid 중 무엇인지 문서·코드·배포가 일치하는가

### 5. 수정은 구체적인 차이로 요청한다

```text
요구사항을 다음과 같이 수정해줘.

- 조회 기간: 7일 → 30일
- 실시간 화면 갱신: 매 event → 500ms batch
- 모바일: table → card
- 환불 action: 자동 실행 → 사용자 승인 후 실행

수정된 설계와 영향을 받는 agent만 다시 실행해줘.
```

“더 좋게”, “예쁘게”, “성능 좋게”만 사용하지 않는다.

### 6. 구현 후 직접 사용자 흐름을 확인한다

```bash
pnpm dev
```

최소 확인:

- 첫 진입
- 새로고침과 직접 URL 진입
- loading
- empty
- API error
- 입력 validation
- 모바일
- 키보드
- 로그아웃·권한 오류

### 7. QA는 반드시 별도 명령으로 실행한다

```text
/web-verify

핵심 사용자 흐름과 변경된 기능을 검증해줘.
FAIL은 직접 고치지 말고 수정 owner와 재현 방법을 보고해줘.
```

Verifier는 source와 test를 수정하지 않는다. 실패 수정은 가장 작은 owner Agent에게 다시 전달한다.

---

## AI 서비스 시작 예시

### AI 코드리뷰 봇

```text
/web-orchestrator

GitHub Pull Request를 분석해 리뷰 comment를 작성하는 AI 봇을 만들어줘.
TypeScript repository부터 지원하고 CI와 보안 분석 결과도 함께 사용해줘.
AI가 approve나 merge를 수행하면 안 되고 중복 comment를 방지해야 해.
GitHub 연동은 우선 Mock으로 만들어줘.
```

예상 mode:

```text
AI_MODE
TOOL_AGENT_MODE
CODE_REVIEW_AGENT_MODE
```

### 사내 문서 검색 AI

```text
/web-orchestrator

사내 문서를 검색하고 근거와 원문 링크를 포함해 답변하는 서비스를 만들어줘.
사용자와 부서별 문서 권한을 반드시 지켜야 해.
근거가 부족하면 답을 만들지 말고 담당 문서나 검색 방법을 안내해줘.
문서 source는 Mock으로 시작해줘.
```

예상 mode:

```text
AI_MODE
RAG_MODE
```

### AI 고객센터

```text
/web-orchestrator

고객 질문에 답하고 주문 상태를 조회하는 AI 고객센터를 만들어줘.
환불과 계정 변경은 반드시 사람 승인을 받아야 해.
언제든 상담원에게 대화 내용을 유지한 채 연결할 수 있어야 해.
CRM과 주문 API는 Mock으로 구현해줘.
```

예상 mode:

```text
AI_MODE
RAG_MODE
TOOL_AGENT_MODE
```

음성 기능이 포함되면 `REALTIME_VOICE_MODE`도 활성화된다.

### AI 대용량 데이터 대시보드

```text
/web-orchestrator

대용량 시계열 데이터를 날짜별·실시간으로 표시하고
자연어로 metric을 검색하거나 chart를 생성할 수 있는 대시보드를 만들어줘.
인증된 metric만 사용하고 무제한 SQL은 금지해줘.
API와 WebSocket은 Mock으로 시작하고 실제 연결 가이드를 제공해줘.
```

예상 mode:

```text
AI_MODE
TOOL_AGENT_MODE
ANALYTICS_AGENT_MODE
TIMESERIES_MODE
```

### 브라우저 Agent

```text
/web-orchestrator

허용된 사내 관리자 사이트에서 반복 업무를 수행하는 브라우저 Agent를 만들어줘.
조회부터 지원하고 submit, 전송, 삭제는 사용자 승인을 받아야 해.
허용 domain 밖으로 이동하면 안 되고 모든 작업을 replay할 수 있어야 해.
```

예상 mode:

```text
AI_MODE
TOOL_AGENT_MODE
BROWSER_AGENT_MODE
```

---

## 생성되는 주요 산출물

### 일반 Plan

| 파일 | 내용 |
|---|---|
| `requirements.md` | 기능·비기능 요구사항 |
| `ux-brief.md` | 사용자와 UX 원칙 |
| `feature-plan.md` | feature와 slice 계획 |
| `tech-stack.md` | 기술 선택과 근거 |
| `project-brief.md` | 구현 기준 문서 |

### 일반 Design

| 파일 | 내용 |
|---|---|
| `design-system.md` | token과 component 원칙 |
| `layout-spec.md` | 화면·반응형 구조 |
| `api-schema.md` | API runtime contract |
| `component-spec.md` | UI component contract |
| `timeseries-architecture.md` | 시계열 데이터·성능 설계 |
| `state-contract.md` | 로컬 도메인 상태·command·불변식·영속성 계약 |
| `ingestion-contract.md` | 외부 source·품질 SLO·promotion·복구·build matrix |
| `runtime-data-contract.json` | runtime mode와 generated artifact의 기계 판독 계약 |

### AI Design

| 파일 | 내용 |
|---|---|
| `ai-requirements.md` | AI task와 성공 기준 |
| `autonomy-risk-matrix.md` | 자율 수준과 승인 |
| `ai-architecture.md` | runtime과 workflow |
| `tool-contracts.md` | typed tool과 권한 |
| `data-governance.md` | ACL, PII, 보존, 삭제 |
| `ai-threat-model.md` | injection·agency 위협 |
| `eval-plan.md` | dataset·grader·threshold |
| `cost-latency-budget.md` | token·비용·지연 상한 |

### QA

일반 QA:

- `qa-code.md`
- `qa-ux.md`
- `qa-integration.md`
- `qa-security.md`
- `qa-api-contract.md`
- `qa-test.md`
- `qa-browser.md`
- `qa-state.md` (`LOCAL_DOMAIN_STATE_MODE`일 때 필수)
- `qa-data-quality.md` (`EXTERNAL_DATA_INGESTION_MODE`일 때 필수)
- `evidence/{build,typecheck,lint,test,coverage,browser,audit}.json`
- `qa-manifest.json` schema v3 (real parent/regular file만 허용하는 atomic write)

AI QA:

- `qa-ai-evals.md`
- `qa-ai-security.md`
- `qa-data-access.md`
- `qa-ai-cost-latency.md`
- `qa-agent-traces.md`

---

## 권장 원칙

### 1. Orchestrator-first

새 프로젝트에서는 전문 Agent를 직접 조합하지 않고 `/web-orchestrator`로 시작한다. Orchestrator가 요구사항과 mode를 판별한 후 필요한 Agent만 호출한다.

전문 skill은 다음 경우에 사용한다.

- 기존 프로젝트의 특정 영역만 변경
- 설계만 다시 수행
- 실패한 owner만 재실행
- 특정 AI service를 확장

### 2. Plan-before-code

요구사항과 설계 없이 구현을 시작하지 않는다.

- 일반 프로젝트: `project-brief.md` 확인
- 시계열 프로젝트: `timeseries-architecture.md` 확인
- 로컬 도메인 상태 프로젝트: `state-contract.md` 확인
- 외부 데이터 프로젝트: `ingestion-contract.md`와 `runtime-data-contract.json` 확인
- AI 프로젝트: 필수 AI 설계 문서 6개 확인

필터·검색·가상화된 화면의 index를 원본 상태 index로 사용하지 않는다. 이동·정렬·삭제는 store/domain 계층의 명시적 command가 precondition과 postcondition을 검증해야 한다.

### 3. Assumption과 Blocker를 구분

- `ASSUMPTION`: 구현은 가능하지만 나중에 확인해야 하는 값
- `BLOCKER`: 구현 전에 반드시 결정해야 하는 값

Blocker를 임의 기본값으로 바꾸어 진행하지 않는다.

### 4. Build-time Agent와 Runtime Agent를 구분

`.claude/agents`는 코드를 만드는 개발 Agent다.

실제 사용자 요청을 처리하는 Runtime Agent에는 별도로 다음이 필요하다.

- trusted server
- model gateway
- session·workflow state
- tool adapter
- approval
- trace
- eval

### 5. 결정론적 서비스와 AI 판단을 분리

AI가 담당할 수 있는 것:

- 의도 해석
- 검색 계획
- 허용된 tool 선택
- 요약과 설명
- chart·답변 초안

AI가 최종 결정하면 안 되는 것:

- 인증과 권한
- tenant
- 금액과 authoritative state
- 데이터 삭제·보존
- merge·결제·환불
- 무제한 SQL·shell·browser action

### 6. Browser에 Provider Secret을 두지 않는다

브라우저는 사내 BFF 또는 agent API를 호출한다.

Server가 담당한다.

- provider credential
- model routing
- prompt와 policy version
- tool registry
- token·비용 제한
- PII filtering
- trace와 audit

### 7. Tool은 Typed Contract로 만든다

모든 tool에 다음을 정의한다.

- name과 description
- input·output schema
- required scope
- side-effect 여부
- approval
- idempotency
- timeout
- audit event

Identity와 tenant는 모델 입력이 아니라 server context에서 주입한다.

### 8. Progressive Autonomy

| Level | 허용 범위 |
|---|---|
| L0 | 검색과 요약 |
| L1 | 초안과 추천 |
| L2 | 승인 후 실행 |
| L3 | allowlist의 저위험 action |
| L4 | 범용 자율 실행 — 기본 금지 |

처음에는 L0~L1로 시작하고 평가가 통과할 때만 범위를 넓힌다.

### 9. 최소 권한과 사람 승인

다음 action은 실행 전에 승인한다.

- 결제와 환불
- 계정·권한 변경
- 이메일·메시지 전송
- 게시와 외부 공유
- 삭제와 취소
- file upload
- PR merge

Approval UI에는 대상, 변경 내용, 금액, 수신자와 영향을 표시한다.

### 10. Mock과 실제 API는 같은 Adapter를 사용

Mock 전용 UI나 별도 데이터 구조를 만들지 않는다.

- 같은 request schema
- 같은 result schema
- 같은 error
- 같은 stream event
- 같은 pagination·cursor

Mock에는 성공뿐 아니라 timeout, 권한 거절, malformed result, reconnect, partial stream도 포함한다.

### 11. 모든 자원은 Bounded

숫자로 상한을 정의한다.

- input bytes
- context·output token
- agent turns
- tool calls
- wall-clock duration
- request cost
- query rows·scan bytes
- realtime buffer
- visible chart points
- concurrent jobs

### 12. Eval-first와 Evidence

Prompt를 먼저 반복 수정하지 않는다.

1. 정상 task 정의
2. 실패·공격 scenario 정의
3. assertion과 threshold 정의
4. 구현
5. trace와 evidence 수집
6. 회귀 비교

PASS에는 파일, command, trace ID, 정책 차단 event 또는 측정값이 필요하다.

### 13. Verifier는 수정하지 않는다

QA Agent는 source, test, config, snapshot을 수정하지 않는다.

Verifier가 수행하는 것:

- 재현
- evidence 수집
- PASS·FAIL·BLOCKED 판정
- 수정 owner 지정

수정은 가장 작은 책임 범위를 가진 구현 Agent가 수행한다.

### 14. 실제 시스템은 단계적으로 연결

권장 승격 순서:

```text
Local Mock
  -> Synthetic Fixture
  -> Read-only Staging
  -> Approval-required Write
  -> Limited Production
  -> Wider Rollout
```

처음부터 production credential이나 write 권한을 제공하지 않는다.

### 15. 외부 데이터는 실패를 성공처럼 보이지 않는다

- required source/artifact의 missing·empty·schema failure는 non-zero다.
- 개발 fixture fallback을 production fallback으로 사용하지 않는다.
- 새 결과를 모두 검증한 뒤 atomic하게 승격한다.
- 실패 시 last-known-good를 보존하되 stale 상태와 생성 시각을 노출한다.
- README, runtime consumer, build, deployment가 하나의 현재 mode를 설명해야 한다.

### 16. QA Markdown보다 Machine Receipt를 신뢰한다

`run-quality-gates.mjs`만 command receipt를 생성한다. verifier는 receipt를 읽어 보고서에 옮길 뿐 exit code를 추정하지 않는다.

- missing script와 test file 0개는 `BLOCKED`다.
- 실제 process exit가 non-zero면 `FAIL`이다.
- source·design·test·config·workflow가 바뀌면 기존 receipt는 stale이다.
- build도 promoted runtime data를 포함한 protected source를 수정할 수 없고 선택된 `dist|out|.next` 같은 deployment artifact만 다시 만들 수 있다. typecheck·lint·test·coverage·browser·audit의 protected-source 변경도 FAIL한다.
- manifest v3가 report, receipt, source fingerprint, package/workspace manifest, 외부 Ed25519 quality attestation을 함께 고정한다.
- receipt와 manifest의 직접 Write/Edit는 hook이 차단한다.

### 17. 최소 줄 수가 아니라 최소 완결 변경을 선택한다

기존 코드의 기능 구현·수정은 `.claude/skills/web-orchestrator/references/minimal-change-contract.md`를 따른다.

- 첫 edit 전에 `_workspace/03_dev/change-scope.md`에 목표 동작, 허용 경로, 보존할 public contract, `NON_GOALS`, 예상 변경 범위, test evidence를 기록한다.
- 기존 abstraction과 owner를 우선하고 요청과 무관한 rename, dependency upgrade, formatter-wide rewrite, cleanup refactor를 섞지 않는다.
- `CHANGE_BUDGET`은 line cap이 아니다. root cause 해결에 필요한 smallest coherent change인지 검토하는 기준이다.
- 범위를 넓혀야 하면 확대된 파일을 수정하기 전에 원인, 대안, blast radius를 기록하고 호환성 영향이 크면 사용자에게 확인한다.
- 코드리뷰는 `git diff --stat`, changed paths, public contract를 change brief와 대조한다.
- 보안·데이터 무결성 때문에 넓은 수정이 필요할 수 있지만 설명 없는 broad rewrite는 FAIL이다.

---

## 안전 장치

### 전역 Bash 정책

`.claude/scripts/enforce-global-bash-policy.mjs`가 agent type 유무와 관계없이 모든 Bash 호출에 먼저 적용된다.

- compound shell, redirection, expansion, glob 차단
- project 밖 경로와 secret-bearing path 읽기 차단
- bounded read와 argv-only control-plane command만 허용
- package/install·Git 초기화는 사용자 승인 후 typed operation broker로만 실행
- malformed input은 fail-closed

### 파일 소유권

`.claude/scripts/enforce-agent-ownership.mjs`가 Agent별 허용 경로를 검사한다.

예:

- model gateway Agent는 web UI를 수정하지 못한다.
- AI 요구사항 Agent는 runtime source를 수정하지 못한다.
- realtime Agent는 chart UI를 수정하지 못한다.
- local state builder는 entity state model 밖의 UI를 수정하지 못한다.
- ingestion contract Agent와 pipeline Agent는 설계·수집 코드·UI 책임을 넘나들지 못한다.
- verifier는 source를 수정하지 못한다.

### Verifier Bash

`.claude/scripts/enforce-verifier-bash.mjs`가 read-only verifier의 command를 제한한다.

- test·lint·build는 typed quality runner로만, Git inspection은 read-only broker로만 요청
- raw `pnpm`, `git`, `curl`과 arbitrary shell 차단
- snapshot update 금지
- file mutation 금지
- arbitrary Node 실행 금지

### AI Safety

`.claude/scripts/enforce-ai-safety.mjs`가 다음을 차단한다.

- browser source의 model provider credential
- browser source의 provider endpoint 직접 호출
- approval 없는 side-effect tool
- idempotency 없는 side-effect tool

Hook은 마지막 보안 경계가 아니다. 실제 runtime도 downstream authorization과 policy를 다시 검사해야 한다.

### Generated project 실행

quality runner는 project가 소유한 package script를 실행하므로 settings에서 자동 승인하지 않는다. local host에서는 사용자 승인 후 `--allow-host-execution`을 명시하고, 이 결과는 진단용이지 release 증거가 아니다. 격리 CI에서는 `WEB_HARNESS_ISOLATED_EXECUTION=1`과 실제 read-only host mount, deny-by-default network, process-group teardown를 함께 적용한다. 이 환경변수는 외부 격리 선언일 뿐 attestation이 아니며 receipt도 `isolationVerifiedByRunner: false`로 기록한다. isolated HOME과 environment allowlist는 host filesystem sandbox를 대체하지 않는다.

final release evidence는 하나의 `--all` cohort, 24시간 이내 freshness, 현재 package script·effective `node_modules` graph·public build environment digest, clean profile artifact build에 묶인다. 추가로 외부 attester의 Ed25519 private key가 cohort·source fingerprint·receipt digest·filesystem/network/process/install 격리 선언과 repository/revision/workflow/issuer provenance를 서명하고, checkout 밖에서 보호된 trust-config digest와 `.claude/quality-attesters.json`의 public key가 이를 함께 검증해야 한다. signed envelope는 `_workspace/04_qa/evidence/quality-attestation.json`에 둔다. 서명·외부 pin이 없거나 receipt가 사후 변경되면 release는 `BLOCKED`다. `src`, `.claude`, `_workspace`, package metadata나 secret 경로는 generated artifact 예외로 선언할 수 없다. profile-bound trivial/no-op script와 receipt cohort 혼합도 `BLOCKED`다.

dependency 설치는 typed broker의 `lockfile` → source/integrity diff 검토 → frozen `install` 순서로 분리한다. public registry exact version만 허용하고 lifecycle script, project/parent `.npmrc`, pnpm hook·override·patch, URL/Git/file dependency를 차단한다. 설치 후 `.pnpm`, top-level virtual-store package symlink, `.bin` shim의 content/metadata/provenance까지 전체 graph digest로 묶고 각 check 전후와 release 때 재계산한다. project workspace로 향하는 package symlink는 승인 root와 target-tree digest 계약이 추가될 때까지 release에서 fail-closed한다. package script는 `.bin` wrapper를 실행하지 않고 검증된 package manifest의 실제 store binary를 argv로 직접 실행한다. Git 검사는 system/global config, pager, external diff/textconv를 끈 read-only broker를 사용하고 untracked/initial staged 변경도 결과에 포함한다. Read/Grep/Glob에는 secret path 전용 hook을 추가로 적용한다.

---

## 검증 방법

### 릴리스 신뢰 단계 (tier)

release gate는 fail-closed로 유지되며, 도달한 신뢰 수준은 3단 tier 라벨로 보고된다 (`.claude/skills/web-orchestrator/references/release-tier-contract.md`). tier는 게이트 완화가 아니라 정직한 라벨이다.

| Tier | Evidence | 라벨 | 산출물 |
|---|---|---|---|
| T0 | host receipt (`--allow-host-execution`) | `DIAGNOSTIC_VERIFIED` | `release-readiness.md` |
| T1 | 격리 CI receipt + 전체 QA PASS | `ISOLATED_VERIFIED` | `release-readiness.md` |
| T2 | T1 + 외부 Ed25519 attestation + manifest v3 | `RELEASED` | `HANDOFF.md` |

### 전체 정적 검증

```bash
node .claude/scripts/validate-toolchain.mjs
node .claude/scripts/test-ai-harness.mjs --through all
```

### 생성 프로젝트 품질 검증

로컬에서는 진단 receipt만 만든다.

```bash
node .claude/scripts/run-quality-gates.mjs --all --allow-host-execution
```

최종 release는 격리 CI에서 다시 실행한다. CI 비밀키는 project filesystem·environment·child process에 주입하지 않고 외부 attester/service에만 보관한다.

```bash
WEB_HARNESS_ISOLATED_EXECUTION=1 node .claude/scripts/run-quality-gates.mjs --all
node .claude/scripts/prepare-quality-attestation.mjs --project . --issuer-run-id <trusted-ci-run-id>
# 외부 attester가 unsigned request를 CI/OIDC·격리·frozen install과 대조하고 final subject를 구성·서명
# Next profile이면 validate-next-contracts.mjs 실행 후 next-contract-verifier가 qa-next-contract.md를 작성
node .claude/scripts/validate-release-gate.mjs --write-manifest
node .claude/scripts/validate-release-gate.mjs
```

fresh deploy에는 release 전에 `.claude/quality-attesters.json`을 별도 프로비저닝해야 한다. 이 파일에는 `schemaVersion: 1`과 `{id, algorithm: "ed25519", publicKeyPem}` 형태의 canonical SPKI `PUBLIC KEY` PEM만 두며 private-key PEM은 형식 검증에서 거부한다. 보호된 CI 정책은 checkout 밖에서 `WEB_HARNESS_EXPECTED_TRUST_CONFIG_SHA256`, `WEB_HARNESS_REPOSITORY_ID`, `WEB_HARNESS_REVISION`, `WEB_HARNESS_WORKFLOW_REF`, `WEB_HARNESS_CI_ISSUER`, `WEB_HARNESS_CI_RUN_ID`를 주입해야 한다. scheduled ingestion은 추가로 `WEB_HARNESS_TRUSTED_PROMOTION_ACTIONS`에 허용된 `owner/action@full-sha` JSON 배열을 주입하며 그 digest가 모든 quality receipt에 결합된다. release validator는 이 값이 없거나 signed provenance와 다르면 fail-closed한다. project script에는 이 환경을 전달하지 않는다. prepare 결과는 바로 서명할 subject가 아니라 `quality-attestation-request.schema.json`을 따르는 unsigned request다. 외부 attester가 claims를 독립 검증하고 final `quality-attestation.schema.json` subject를 구성한다. trust key 형식은 `quality-attesters.schema.json`을 따른다. 개별 진단은 `--check build`, `--check test`, `--check browser`처럼 실행할 수 있지만, release하려면 모든 receipt가 현재 source fingerprint와 일치하도록 격리 CI에서 `--all`을 다시 실행하고 재서명한다. `qa-manifest.json`은 final-path/parent symlink를 거부하고 동일 directory의 mode `0600` 임시 파일을 atomic rename해 생성한다.

### 단계별 검증

```bash
node .claude/scripts/test-ai-harness.mjs --stage baseline
node .claude/scripts/test-ai-harness.mjs --stage foundation
node .claude/scripts/test-ai-harness.mjs --stage routing
node .claude/scripts/test-ai-harness.mjs --stage services
node .claude/scripts/test-ai-harness.mjs --stage policy
node .claude/scripts/test-ai-harness.mjs --stage eval-contracts
```

### AI Scenario 확인

```bash
node .claude/scripts/run-ai-evals.mjs --list
node .claude/scripts/run-ai-evals.mjs --service analytics-dashboard
node .claude/scripts/run-ai-evals.mjs --scenario analytics-query-budget
```

### 실행 결과 검증

```bash
node .claude/scripts/run-ai-evals.mjs \
  --verify-result path/to/result.json
```

정적 검증은 실제 model과 외부 시스템을 호출하지 않는다. Runtime scenario는 격리된 fixture와 staging에서 별도로 실행해야 한다.

자세한 순서는 [AI Agent Harness 테스트 가이드](docs/archive/AI_AGENT_HARNESS_TESTING.md)를 참고한다.

---

## 주니어 개발자 체크리스트

### 시작 전

- [ ] 사용자와 핵심 작업을 설명했다.
- [ ] Must Have와 제외 범위를 설명했다.
- [ ] 읽기·쓰기 데이터와 권한을 설명했다.
- [ ] Mock인지 실제 API인지 설명했다.
- [ ] 모르는 값은 ASSUMPTION으로 기록하도록 요청했다.

### 구현 전

- [ ] `requirements.md`를 읽었다.
- [ ] `project-brief.md`를 읽었다.
- [ ] `BLOCKER`가 없다.
- [ ] 잘못된 `ASSUMPTION`을 수정했다.
- [ ] 로컬 도메인 상태라면 `state-contract.md`의 불변식과 복구 정책을 확인했다.
- [ ] 외부 데이터라면 source 권한, runtime mode, quality SLO, build matrix를 확인했다.
- [ ] AI 프로젝트의 autonomy와 high-impact action을 확인했다.

### 구현 후

- [ ] `pnpm dev`로 직접 확인했다.
- [ ] loading, error, empty 상태를 확인했다.
- [ ] 모바일과 키보드를 확인했다.
- [ ] Mock failure를 확인했다.
- [ ] 필터·검색과 이동·정렬·삭제 조합을 확인했다.
- [ ] 이전 버전·손상된 persisted state의 migration 또는 복구를 확인했다.
- [ ] `/web-verify`를 실행했다.
- [ ] quality receipt의 command, exit, test file 수, source fingerprint를 확인했다.

### Release 전

- [ ] 모든 일반 QA가 PASS 또는 승인된 WARN이다.
- [ ] 로컬 도메인 상태라면 `qa-state.md`가 PASS다.
- [ ] 외부 데이터라면 `qa-data-quality.md`와 clean-build matrix가 PASS다.
- [ ] `qa-manifest.json` schema v3가 현재 source·receipt·signed attestation을 가리킨다.
- [ ] AI critical scenario가 PASS다.
- [ ] ACL·tenant leak이 0이다.
- [ ] 승인 없는 side effect가 없다.
- [ ] 실제 secret이 browser에 없다.
- [ ] HANDOFF의 실제 API 전환과 rollback을 확인했다.

---

## Harness 확장

### 새 Skill

새 skill은 다음을 포함한다.

- 명확한 trigger description
- 짧은 core workflow
- 필요한 reference만 지연 로딩
- hard stop
- 완료 조건
- 사용하는 Agent 이름

### Skill·Agent 모듈 경계

- `SKILL.md`는 분기와 실행 순서만 유지한다. 권장 250줄 이하, validator hard limit은 300줄이다.
- Agent는 하나의 독립 산출물·소유권·평가 기준만 가진다. 역할 설명이 300줄을 넘으면 책임을 다시 나눈다.
- active reference는 한 주제만 다루고 300줄을 넘기지 않는다. 100줄을 넘으면 목차를 두거나 focused reference로 분리한다.
- 대형 boilerplate와 multi-library snippet은 `assets/`에 두고 `read-skill-section.mjs`로 필요한 section만 조회한다. 전체 catalog를 prompt context에 로드하지 않는다.
- scenario JSON 같은 machine data는 CLI의 `--list`, `--service`, `--scenario`로 조회하고, 계약 자체를 수정할 때만 원본을 읽는다.
- verifier 목록과 write ownership처럼 여러 hook이 공유하는 사실은 `agent-registry.mjs` 한 곳에서 관리한다.
- source fingerprint처럼 순수한 증거 계산은 `evidence-lib.mjs`, fixture 검증은 `scripts/validators/`에 분리한다.
- `dev-orchestrator`는 유형 분류만 하고 웹 수명주기는 `/web-orchestrator`에 전부 위임한다. 같은 phase·mode 규칙을 두 skill에 복제하지 않는다.
- 변경 후 `node .claude/scripts/validate-harness.mjs`로 line boundary, reference 경로, registry, section loading을 함께 검증한다.

### 새 Agent

다음 조건을 모두 만족할 때만 추가한다.

1. 독립적인 산출물이 있다.
2. 독립적인 file 또는 tool 권한이 있다.
3. 독립적인 평가 기준이 있다.
4. 기존 Agent의 context를 오염시키지 않아야 한다.

추가 후 ownership rule과 skill reachability를 등록한다.

### 새 AI 서비스

1. `.claude/ai-harness.json`에 service 등록
2. service skill 추가
3. service builder 추가
4. ownership 경로 추가
5. 정상·실패·공격 scenario 최소 5개 추가
6. detection marker 추가
7. Stage 0~5 전체 실행
8. 격리 runtime scenario 실행

---

## 제한 사항

- Harness validator PASS는 생성된 제품의 production readiness를 보장하지 않는다.
- local receipt는 external signed attestation의 subject로 허용되지 않으며, host 실행은 OS 수준 filesystem/network sandbox를 증명하지 않는다. 최종 release에는 격리 CI receipt와 trusted Ed25519 attestation이 모두 필요하다.
- Next `docker-standalone` release는 typed OCI build/registry digest broker가 추가될 때까지 `BLOCKED`다.
- external ingestion의 `live-api`와 `hybrid` release는 live-source machine evidence adapter가 추가될 때까지 `BLOCKED`다.
- built-in app profile은 React/Vite와 Next.js에 한정된다. library pack/publish는 격리 CI receipt가 없으면 `BLOCKED`다.
- 실제 provider·SCM·문서 저장소·CRM·warehouse·browser 연결에는 별도 credential과 staging이 필요하다.
- AI 모델의 출력은 확률적이므로 지속적인 dataset·trace 평가가 필요하다.
- 브라우저 Agent는 범용 자동화보다 허용 domain·action이 제한된 업무에 적합하다.
- 기업 검색은 원본 source의 ACL 품질에 의존한다.
- 고객센터 transaction과 음성 기능은 일반 chat보다 운영·보안 난도가 높다.

---

## 상세 문서

- [Web Harness Agent 고도화 리뷰](WEB_HARNESS_AGENT_HARDENING_REVIEW.md)
- [AI 서비스 개발 가능성 및 고도화 분석](docs/archive/AI_AGENT_WEB_SERVICE_FEASIBILITY.md)
- [AI Harness 순차 테스트 가이드](docs/archive/AI_AGENT_HARNESS_TESTING.md)
- [Claude 웹 엔지니어링 구조 감사](docs/archive/CLAUDE_WEB_ENGINEERING_AUDIT.md)
- [일반 Eval 계약](.claude/evals/README.md)

---

## 권장 첫 사용

처음 사용하는 주니어 개발자는 다음 요청으로 시작하는 것을 권장한다.

```text
/web-orchestrator

내가 만들려는 서비스의 요구사항을 먼저 분석하고,
불명확하거나 위험한 부분만 질문해줘.

구현 전에 requirements와 architecture를 작성하고
내가 확인해야 할 ASSUMPTION과 BLOCKER를 명확히 표시해줘.

API는 Mock으로 시작하되 실제 API와 같은 contract를 사용하고,
구현 후 test와 browser 검증을 실행해줘.
```

가장 중요한 원칙은 **Agent에게 모든 결정을 맡기는 것이 아니라, Agent가 만든 요구사항·가정·권한·검증 evidence를 개발자가 확인하는 것**이다.
