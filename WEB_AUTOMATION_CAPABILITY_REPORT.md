# web-harness Agent Skill 자동화 역량 평가 보고서

- 평가일: 2026-08-03 (Asia/Seoul)
- 관점: 시니어/스태프급 웹 엔지니어링 — "현대 웹 개발에서 이 하니스로 구현을 어디까지 자동화할 수 있는가"
- 평가 대상: `.claude/` 하니스 전체 — **skill 29개, subagent 88개, reference 계약 50여 개, 강제 스크립트 71개(~1.5만 줄), adapter profile 2개, eval 시나리오 61개** (총 약 3.5만 줄)
- 평가 방법: 29개 SKILL.md 전수 독해, 88개 agent 정의 전수 frontmatter + 55개 심층 독해, hook/validator/receipt/attestation 코드 실독, 소유권 레지스트리와 실제 강제 동작 교차 검증
- 선행 문서와의 관계: [CLAUDE_WEB_ENGINEERING_AUDIT.md](CLAUDE_WEB_ENGINEERING_AUDIT.md)(2026-07-13, agent 46개 시점)의 P0 지적사항은 현재 대부분 해소됐다. 본 보고서는 **현재 상태(agent 88개)** 기준의 역량 평가다.

---

## 1. 결론 요약

### 1.1 종합 판정

> **web-harness는 "코드를 생성하는 도구"가 아니라 "생성된 코드를 신뢰할 수 있게 만드는 체계"로서 업계 최상위권이다.**
> 증거(evidence) 계층 — 소스 fingerprint에 결합된 machine receipt, read-only verifier의 4중 강제, Ed25519 서명 attestation, 위조 불가능한 release gate — 는 상용 코드 생성 에이전트 제품을 포함해도 흔치 않은 수준이다.
>
> 반면 **커버리지는 좁다.** React 생태계 2개 profile(react-vite-spa certified, next-app-fullstack compatible)에 집중되어 있고, 현대 웹의 큰 축인 **백엔드 실구현·SEO/콘텐츠·i18n·결제·성능 예산·비-AI 관측성**은 에이전트가 존재하지 않는다.

한 줄 요약: **"깊이는 S급, 폭은 C급."** 사내 도구·대시보드류는 사람 개입 3~4회로 QA 증거까지 뽑아낼 수 있지만, 커머스·콘텐츠·풀스택 백엔드는 아직 사람이 주도해야 한다.

### 1.2 카테고리별 자동화 점수 (요약표)

축별 0~100: 해당 카테고리 프로젝트를 이 하니스로 수행할 때 각 단계가 자동화되는 비율/품질.

| # | 웹 카테고리 | 기획·설계 | 구현 | QA·검증 | 배포·릴리스 | **종합** | 등급 |
|---|---|---|---|---|---|---|---|
| 1 | 사내·관리자 CRUD SPA (React/Vite) | 90 | 90 | 95 | 75 | **88** | **A** |
| 2 | 로컬 도메인 상태 앱 (offline CRUD·보드형 도구) | 90 | 85 | 90 | 75 | **84** | **A** |
| 3 | 시계열·실시간 대시보드 | 90 | 80 | 70 | 70 | **78** | **B+** |
| 4 | 외부 데이터 수집·정적 콘텐츠 사이트 | 85 | 80 | 90 | 55 | **76** | **B+** |
| 5 | Semantic Analytics·BI 차트 빌더 | 80 | 75 | 65 | 70 | **72** | **B** |
| 6 | npm 라이브러리·디자인 시스템 | 75 | 75 | 60 | 70 | **70** | **B** |
| 7 | Next.js 풀스택 (App Router SSR/RSC/BFF) | 80 | 70 | 75 | 50 | **68** | **B-** |
| 8 | 인증 중심 서비스 (로그인·권한 SaaS) | 70 | 65 | 70 | 55 | **65** | **C+** |
| 9 | AI Agent 웹 서비스 (5종) | 90 | 45 | 70 | 40 | **58** | **C** |
| 10 | 풀스택 백엔드·DB 서비스 | 40 | 30 | 25 | 30 | **32** | **D** |
| 11 | 콘텐츠·SEO·마케팅 사이트 (블로그·CMS) | 35 | 20 | 25 | 30 | **26** | **D-** |
| 12 | 이커머스·결제 | 20 | 10 | 15 | 15 | **15** | **F** |
| 13 | 모바일·PWA·하이브리드 | 10 | 5 | 10 | 5 | **8** | **F** |

횡단(cross-cutting) 인프라 점수:

| 영역 | 점수 | 비고 |
|---|---|---|
| 증거·품질 게이트 체계 | **95 (S)** | receipt/fingerprint/attestation/manifest v3 — 위조 불가 설계 |
| 실행 안전·공급망 (hook·broker) | **95 (S)** | argv-only Bash, 소유권 레지스트리, frozen install, secret 차단 |
| 기획·설계 산출물 체계 | **85 (A)** | 27개 `_workspace` 산출물, sharding 계약, 승인 체크포인트 |
| 에이전트 프롬프트 품질 | **75 (B+)** | SPA·CI 계열은 수치화된 계약, AI·analytics 계열은 얇음 (이중 분포) |
| 관측성·성능·운영 (비-AI 앱) | **30 (D)** | perf budget owner·RUM·에러추적·SLO 부재 |
| 프레임워크·스타일링 다양성 | **25 (D-)** | React 2 profile + MUI/Emotion 하드코딩 |

### 1.2R 재평가 — P0·P1 조치 반영 (2026-08-03 동일일 재측정)

P0 6건 + P1 7.5건 조치 후 재산정한 점수다. **원칙**: 점수 상승은 "계약·소유권·검증 계층이 실제로 생겼는가"에만 근거한다. 신규 에이전트 9종(next-contract-designer, db-migration-writer, seo-meta-builder, seo-verifier, performance-budget-designer, performance-verifier, timeseries-verifier, i18n-builder, web-observability-builder)은 validator 49개 검사는 통과했지만 **golden eval scenario와 실전 실행 증거가 아직 없다** — 따라서 상한이 아닌 보수 점수를 부여했다. 실전 증거가 쌓이면 괄호 안 잠재치까지 상승 여지가 있다.

| # | 웹 카테고리 | 이전 | **현재** | Δ | 상승/동결 근거 |
|---|---|---|---|---|---|
| 1 | 사내·관리자 CRUD SPA | 88 | **90** | +2 | perf budget 삼각형, 관측성 builder, 의존성 감사 판정, 인프라 무결성(미러 drift·schema parity) |
| 2 | 로컬 도메인 상태 앱 | 84 | **85** | +1 | 간접 수혜만 (perf/관측성) |
| 3 | 시계열·실시간 대시보드 | 78 | **82** | +4 | `timeseries-verifier`로 §2.3 미완결 삼각형 해소 — QA축 70→80. WS 서버측은 여전히 부재 |
| 4 | 외부 데이터 수집·정적 사이트 | 76 | **78** | +2 | 공개 정적 사이트에 SEO owner/verifier 직접 수혜. live-api/hybrid release는 여전히 BLOCKED |
| 5 | Semantic Analytics·BI | 72 | **72** | 0 | 변경 없음 (verifier 본문 7줄 문제 미해소) |
| 6 | npm 라이브러리·디자인 시스템 | 70 | **73** | +3 | version-analyzer의 export 표면 diff 판정 — 단, api-extractor 수준 도구화는 아님(문서 계약) |
| 7 | Next.js 풀스택 | 68 | **73** (→80 잠재) | +5 | 무소유였던 6대 매트릭스에 `next-contract-designer` owner 부여(설계 결손 해소) + SEO 계층으로 profile 존재 이유 완성. Edge/미들웨어/Docker 제외는 유지 |
| 8 | 인증 중심 서비스 | 65 | **66** | +1 | 간접 수혜만. RBAC/멀티테넌시/passkey 설계 여전히 부재 |
| 9 | AI Agent 웹 서비스 | 58 | **58** | 0 | P1-7 미착수 — experimental 스텁 5종 변화 없음. 정직하게 동결 |
| 10 | 풀스택 백엔드·DB | 32 | **38** | +6 | `db-migration-writer` + `migrations/**` 소유권 — subagent가 마이그레이션을 물리적으로 쓸 수 있게 됨(agent 삼각형 첫 단추). 백엔드 프레임워크 builder·GraphQL은 여전히 0 |
| 11 | 콘텐츠·SEO·마케팅 사이트 | 26 | **40** | +14 | 최대 상승 — SEO owner+verifier와 i18n 스킬이 이 카테고리의 0점 영역을 직접 타격. CMS 커넥터/MDX/에디토리얼 프리뷰 부재로 40 상한 |
| 12 | 이커머스·결제 | 15 | **16** | +1 | 일반 인프라 수혜만 |
| 13 | 모바일·PWA | 8 | **8** | 0 | 변경 없음 |

횡단 인프라 재평가:

| 영역 | 이전 | **현재** | 근거 |
|---|---|---|---|
| 증거·품질 게이트 체계 | 95 | **96** | schema parity tripwire, 미러 drift 강제 편입, verifier 명령 실행가능성 검사(ux-validator의 죽은 검사 부활) |
| 실행 안전·공급망 | 95 | **95** | pnpm pin currency 사고(upstream broken 11.13.0)를 겪고 갱신 — 강제력은 동일, pin 신선도 관리가 새 리스크로 확인됨 |
| 기획·설계 산출물 체계 | 85 | **88** | 무소유 산출물 4종 해소 + `ORCHESTRATOR_AUTHORED_ARTIFACTS` 감사 가능 선언 |
| 에이전트 프롬프트 품질 | 75 | **78** | MUI 전제-조건선택 모순 제거, verifier 문서 명령의 정책 일치 강제 |
| 관측성·성능·운영 (비-AI) | 30 | **55** | perf budget 삼각형 + `web-observability-builder`(에러추적·release 태깅·RUM sink·PII scrubbing) — 알림 라우팅/SLO/synthetic 모니터링 부재로 55 상한 |
| 프레임워크·스타일링 다양성 | 25 | **30** | MUI 조건화는 전제 제거일 뿐 — Tailwind/shadcn profile 실구현 전까지 소폭 |

**재평가 요약**: "깊이 S급/폭 C급" 구도에서 **폭의 바닥이 올라왔다**(최하위권 26→40, 32→38). 다음 점수 이동이 큰 순서: ① P1-7 AI 브랜치 심화(58→70 예상) ② P2-3 백엔드 실체화(38→65 예상) ③ 신규 에이전트 9종의 eval scenario 추가(전 카테고리 잠재치 실현의 전제) ④ P2-1 릴리스 tiering(점수보다 채택률에 작용).

### 1.3 "어디까지 자동화되는가" — 직접 답

**자동화 상한 (2026-08 현재 하니스 기준):**

- **카테고리 1~4 (사내 도구·대시보드·정적 수집 사이트)**: 전체 SDLC 노력의 **약 80~90%** 자동화 가능. 사람에게 남는 것: ① 요구사항 인테이크 답변 ② Phase 1→2, 2→3 승인 체크포인트 ③ quality runner 실행 승인 ④ 격리 CI + 외부 서명자 인프라 운영 ⑤ 실제 API/credential 연결.
- **카테고리 5~8 (analytics·라이브러리·Next·인증)**: **약 60~70%**. 설계 게이트는 강하지만 구현 폭이 좁아(예: Next의 Edge/미들웨어 제외, 인증의 RBAC 설계 부재) 사람이 아키텍처 판단과 빈칸을 메워야 한다.
- **카테고리 9 (AI 서비스)**: 설계·거버넌스·안전장치는 **90%** 자동화되나 실제 구현은 서비스당 빌더 1개 + 평균 45줄 experimental 스텁이라 **구현 자동화는 40~50%**. "설계는 자동, 구현은 반자동."
- **카테고리 10~13 (백엔드·콘텐츠·커머스·모바일)**: **10~35%**. 하니스 밖에서 사람이 주도하고, 하니스는 프론트 조각과 QA 규율만 제공.

**구조적으로 자동화가 "검증 가능"한 것과 "모델 판단"인 것의 경계** (인프라 분석에서 실코드로 확인):

- 결정론적(코드가 거부): Bash argv 정책, 파일 소유권, verifier read-only, receipt 위조 방지, 의존성 공급망(exact version·registry-only·ignore-scripts), HANDOFF 작성 차단.
- 모델 판단(프롬프트 준수): **모드 라우팅(TIMESERIES/AI/… 감지), Phase 실행 순서, eval assertion 채점, QA 보고서 서술부.** 이 경계가 이 하니스의 다음 고도화 지점이다.

---

## 2. 하니스가 잘하는 것 (구조 진단)

### 2.1 4중 방어로 강제되는 역할 분리

read-only verifier 21종의 "수정 불가"는 선언이 아니라 기계 강제다:

1. frontmatter `disallowedTools: Write, Edit` (도구 자체 미지급)
2. `enforce-agent-ownership.mjs` — verifier는 `AGENT_OWNERSHIP` 레지스트리에 항목이 없어 **부재로 차단**. 심볼릭 링크 탈출·상대경로도 realpath로 봉쇄
3. `enforce-verifier-bash.mjs` — 읽기 명령 7종 외에는 typed runner만 허용, `--write-manifest`·mutating runner 4종 차단
4. `enforce-global-bash-policy.mjs` — 전 서브에이전트 공통 argv-only 정책 (compound shell·리다이렉션·네트워크 명령 차단)

특히 `validate-harness.mjs`가 **훅 소스를 읽는 게 아니라 훅을 실제로 spawn해서 exit code를 assert**(소유권 44 케이스, verifier Bash 9 케이스)하는 점은 강제 계층의 부패를 막는 드문 설계다. "Write 권한 있는 agent는 Bash 금지"(소유권 훅 우회 차단) 규칙도 정확하다.

### 2.2 위조 불가능한 릴리스 증거

- machine receipt는 `run-quality-gates.mjs`만 생성 가능(훅이 `evidence/**`·`qa-manifest.json` 직접 Write 차단), 단일 cohort UUID·24h freshness·실행 전후 source fingerprint 일치 요구
- `release-gate-lib.mjs`는 manifest를 **제로부터 재유도해 byte 비교** — 손으로 고친 manifest는 탐지됨
- QA Markdown의 명령어·exit code까지 receipt와 대조 — "표만 PASS로 바꾸기" 불가
- Ed25519 attestation은 checkout 밖 trust config digest + CI identity와 대조 — host 실행 receipt로는 최종 게이트 통과 불가(fail-closed)

### 2.3 파이프라인 완결성 (설계→구현→검증 삼각형)

| 클러스터 | 설계 | 구현 | 전용 verifier | 판정 |
|---|---|---|---|---|
| SPA 코어 | Phase 2 6종 | 11 builders | 일반 verifier 7종 | **완결 (최고 밀도)** |
| 로컬 도메인 상태 | state-contract-designer | client-domain-state-builder | state-invariant-verifier | **완결 삼각형** |
| 외부 수집 | ingestion-contract-designer | pipeline-builder + ci-writer | data-quality-verifier | **완결 + 최강 증거사슬** |
| Visual QA | contract-designer | test-writer + baseline-manager | regression-verifier | **완결 + 승인 분리 모범** |
| AI | 설계 6종 | 런타임 5 + 버티컬 5 | verifier 5종 | 완결 (단, 구현 얇음) |
| Next.js | ⚠ 6대 매트릭스 **무소유** | 2 builders | next-contract-verifier | 설계 단계 결손 |
| 시계열 | timeseries-architect | realtime-data-builder | ❌ 전용 없음 (분산) | 미완결 |
| CI/배포 | n/a | 4 writers (경로 완전 분할) | ❌ 없음 | 미완결 |
| 라이브러리 | lib-api-designer | 7종 | pack-verifier(receipt 열람만) | 준완결 |

### 2.4 프롬프트에 축적된 실전 지식 (모범 사례)

- `entity-query-builder`: staleTime 수치 계약, 전 queryFn `signal` 의무, `unknown`→Zod parse(타입 단언 금지)
- `timeseries-architect`: "측정된 main-thread 시간이 frame budget(1000/targetHz)의 50% 초과 시 Worker 도입" — 유일한 수치 유도 기준
- `code-reviewer`: CJK IME 이중 제출(`isComposing`), MUI Menu focus, theme dot-path 검증 등 18개 정적 체크 + 자기검증(CONFIRMED/PLAUSIBLE) 프로토콜
- `publish-ci-writer`: npm trusted publishing(OIDC)·provenance·`--ignore-scripts`, 장기 NPM_TOKEN 생성 금지
- `server-db-migration`: pooled vs direct DSN 분리(Neon/Supabase 실전 footgun), expand-contract 5단계 — 저장소 내 실전 지식 밀도 최고
- `feature-add`(v1.3.0, 최다 반복 스킬): receipt에 **cwd 기록**(모노레포 오탐 green 차단), gotcha 축적 규칙("가장 가치 있는 skill 콘텐츠는 실패 경험의 축적")

---

## 3. 카테고리별 상세 평가

### ① 사내·관리자 CRUD SPA — 88점 (A)

- **근거**: 유일한 certified profile. 기획 7-wave → 설계 6종 → 11 builders(소유권 negative-lookahead까지 정밀 분할) → verifier 7종 병렬 → 서명 릴리스. FSD·TanStack Query·Zod·MSW·Playwright·axe 계약이 수치 수준으로 구체적. Iterate mode가 소규모 변경의 과잉 세리머니를 완화.
- **한계**: 백엔드는 MSW Mock까지 — 실 API는 `/api-connect` 전환 가이드. MUI+Emotion 하드코딩(Tailwind/shadcn 부재). 최종 릴리스는 외부 attester 인프라 필요(§5.1).
- **사람이 하는 일**: 인테이크 답변, 체크포인트 2회 승인, 실 API/credential 연결, 격리 CI 운영.

### ② 로컬 도메인 상태 앱 — 84점 (A)

- **근거**: designer→builder→verifier 완결 삼각형. `Partial<Entity>` 구조 필드 broad patch 금지, filter/search × mutation 6행 검증 매트릭스, persist version+Zod migrate+recovery가 복사 가능한 코드 수준으로 계약화. hidden-data 파괴 방지는 이 도메인의 실제 사고 유형을 정확히 겨냥.
- **한계**: 오프라인 **데이터**는 다루지만 오프라인 **앱**(service worker, manifest, install, background sync)은 없음 — PWA 요구가 붙는 순간 커버리지 이탈.

### ③ 시계열·실시간 대시보드 — 78점 (B+)

- **근거**: 수치화된 SLO 인테이크(초당 포인트·가시 포인트·메모리 예산) 없이는 구현 거부. transport 인터페이스 확정 후 Mock 작성 순서 강제로 Mock/실전 adapter 동일성 보장. reconnect/resume/gap/out-of-order가 1급 테스트 계약.
- **한계**: **전용 verifier 부재**(browser/api-contract/code-reviewer에 분산 — 조건부 체크가 누락되기 쉬운 구조). WebSocket **서버 측** 구현 owner 없음(클라이언트만 정교). 차트 라이브러리 선택·Worker/OffscreenCanvas 판단이 스킬 본문에 없음. alert/export가 인테이크에는 있으나 구현 계약 없음.

### ④ 외부 데이터 수집·정적 사이트 — 76점 (B+)

- **근거**: 하니스 전체에서 가장 강한 증거 사슬 — source 권한 계약, raw→normalized→runtime schema 경계, empty/drift/count-drop fixture, atomic promotion + last-known-good, clean-build matrix, 배포 사본 byte-digest 검증. "실패를 성공처럼 보이지 않는다" 원칙의 완전 구현.
- **한계**: **static-snapshot만 릴리스 가능** — `live-api`/`hybrid`는 evidence adapter 부재로 BLOCKED. Vercel static external-ingestion도 protected broker 부재로 BLOCKED. 즉 이 카테고리의 절반은 "구현은 되나 릴리스 불가" 상태.

### ⑤ Semantic Analytics·BI 빌더 — 72점 (B)

- **근거**: metric/dimension catalog + query AST + chart compatibility registry + dashboard config version/migration — BI 제품의 성숙한 골격. 시계열과의 소유권 분할(transport vs semantic)이 명문화.
- **한계**: 스킬 58줄·verifier 본문 7줄로 **깊이가 골격 수준**. drill-down/cross-filter/linked-brushing, 쿼리 캐싱/materialization, 스케줄 리포트, embedding 부재. 실제 warehouse 연결은 범위 밖.

### ⑥ npm 라이브러리·디자인 시스템 — 70점 (B)

- **근거**: API-first 설계(api-design.md 계약) → tsup 스캐폴드 → core+Storybook → docs → changesets → trusted publishing CI → pack-verifier. 공급망 위생(provenance, ignore-scripts)은 모범.
- **한계**: 웹 QA 대비 얇음 — **`.d.ts` API diff 기반 breaking-change 검출 없음**(semver를 산문 추론), bundle size budget 없음, ESM/CJS 소비자 매트릭스는 publint 수준. pack/publish는 격리 CI receipt 없으면 BLOCKED. 다중 패키지 모노레포 릴리스 순서 없음.

### ⑦ Next.js 풀스택 — 68점 (B-)

- **근거**: 6대 매트릭스(Route/Server-Client/AuthZ/Env/Cache/Deployment) 설계 게이트는 저장소 내 최강 산출물 — Next 팀이 프로덕션에서 뒤늦게 발견하는 결정을 선제 강제. `compatible ≠ certified` 정직한 라벨링.
- **한계**: 제외 범위가 큼 — Edge runtime, Pages Router, Docker(OCI broker 부재로 BLOCKED), **미들웨어 무언급**, PPR/`unstable_cache` 미커버, `next/image`·폰트 최적화 없음. **SEO가 이 profile을 선택하는 명분인데 metadata/sitemap/OG 구현 에이전트가 없음.** i18n 라우팅(`[locale]`) 부재. 그리고 게이트 핵심인 `next-contract-matrices.md`가 **무소유 산출물**(§5.3).

### ⑧ 인증 중심 서비스 — 65점 (C+)

- **근거**: 토큰 커스터디 원칙이 정확하고 비타협적 — Web Storage 토큰 금지, HttpOnly+CSRF/OIDC PKCE, single-flight 401 refresh, 401/403 계약 테스트 의무, secret rotation 런북까지.
- **한계**: **RBAC/ABAC 권한 모델 설계가 없음**("role이 이미 있다"고 가정). 멀티테넌시·SSO/SAML·MFA·passkey/WebAuthn·세션 관리 UI 부재. Auth0/Clerk/Auth.js 등 SaaS 경로 없음. 서버 측 OAuth 흐름은 hybrid serverless에 걸리면 BLOCKED.

### ⑨ AI Agent 웹 서비스 — 58점 (C)

- **근거(설계 90)**: autonomy L0~L4, typed tool contract 9필드, threat model, data governance, eval-first가 `ai-harness.json` + 시나리오 31개(critical 16) + `enforce-ai-safety.mjs`(브라우저 provider key·미승인 side-effect 기계 차단)로 뒷받침. 이 설계 체계 자체는 업계 선도적.
- **한계(구현 45)**: 서비스 브랜치 5종이 **평균 45줄 experimental 스텁 + 빌더 1개**. RAG의 청킹/임베딩/벡터스토어/리랭커 선택 가이드 0, 커넥터 목록 0, `REALTIME_VOICE_MODE`는 스킬·빌더·계약이 전무한 **dangling mode**. eval도 통계 처리(신뢰구간·반복 분산·표본 수) 없음. frontmatter가 약속하는 "production RAG/support/browser agent"와 실제 제공물의 간극이 저장소에서 가장 큼.

### ⑩ 풀스택 백엔드·DB — 32점 (D)

- **근거**: `server-db-migration` 스킬(177줄)은 실전 지식 밀도 최고(idempotent DDL, pooled/direct DSN, expand-contract). Next Route Handlers/Server Actions 경로 존재.
- **한계**: **`migrations/**` 소유권이 레지스트리에 없어 서브에이전트가 마이그레이션 파일을 물리적으로 쓸 수 없음**(메인 스레드 전용). DB 스키마 설계 에이전트 0, 프레임워크-불문 백엔드 빌더(Express/Fastify/Hono/Nest) 0, ORM 0, 큐/배치(비-AI) 0, **GraphQL 전무**(SDL/codegen/클라이언트/N+1 verifier 모두 0), WS 서버 0. `vite-serverless-hybrid`는 183줄 가이드가 있으나 오케스트레이터가 hard-BLOCK하는 함정 상태(§5.4).

### ⑪ 콘텐츠·SEO·마케팅 — 26점 (D-)

- SEO는 requirements-analyst의 경고 배너와 tech-advisor의 profile 선택 사유로만 존재. **metadata/`<head>`/canonical/sitemap/robots/OG/JSON-LD를 소유한 에이전트 0, SEO verifier 0.** CMS 커넥터·MDX·에디토리얼 프리뷰·revalidation 0. i18n은 빈 `src/shared/lang/` 디렉토리가 전부.

### ⑫ 이커머스·결제 — 15점 (F)

- 장바구니/카탈로그/체크아웃/PG(Stripe·국내PG)/웹훅 idempotency/PCI 경계/세금 전무. 존재하는 것은 `feature-mutation-builder`의 "결제·재고 optimistic 완료 처리 금지" 원칙 한 줄 수준. (일반 CRUD 골격 재사용은 가능하므로 0은 아님.)

### ⑬ 모바일·PWA — 8점 (F)

- 반응형 브레이크포인트와 320px reflow 검증뿐. RN/Expo·service worker·manifest·push 전무.

---

## 4. 발견된 구조적 결함 (실버그 — 우선 수정 대상)

분석 중 코드 레벨에서 확인된 실제 불일치들:

1. **`ux-validator`의 문서화된 검사가 정책에 막혀 실행 불가**: step 5가 `grep -rn …`을 지시하지만 전역 Bash 정책의 read 명령 allowlist는 `{pwd, ls, cat, head, tail, wc, rg}` — `grep` 미포함으로 fail-closed. 해당 검사는 조용히 수행 불가. (`code-reviewer`는 `rg`를 써서 정상.) → `rg`로 교체.
2. **`.codex/agents/` 스테일 미러**: canonical 88개 대비 78개 `.toml`만 존재 — analytics 3종, planning 2종, visual QA 4종, design-reviewer 등 **10개 누락**. `build-adapters.mjs`는 `agents/`를 미러 대상에 포함하지 않고 `.codex/`를 타겟하지도 않으며, 아무 validator도 `.codex/`를 검사하지 않는다.
3. **adapter drift 검사가 현재 비활성**: `validate-adapter-hygiene.mjs`가 `.agents/` 존재 여부로 소스 저장소를 판별하는데 이 저장소에 `.agents/`가 없어 drift·README 인벤토리 검사가 "skipped"로 조용히 통과. README의 "byte-wise 검출" 서술과 불일치.
4. **무소유 핵심 산출물 4종**: `next-contract-matrices.md`(Next 경로 전체를 게이트하는 문서), `build-environment.json`, `integration-overlay.json`, `change-scope.md` — 모두 오케스트레이터 **메인 스레드**가 작성. 메인 스레드는 소유권 훅·Bash 정책에서 면제이므로, 가장 중요한 계약 문서들이 가장 감시가 약한 표면에서 생성된다.
5. **JSON Schema 9종이 실행되지 않음**: 저장소는 의존성 0(ajv 없음)이라 스키마는 문서이고 실제 검증은 수기 JS가 중복 구현. 스키마 수정이 `adapter-lib.mjs`/`quality-attestation-lib.mjs`에 미러되지 않으면 조용히 발산. (유일한 예외: ingestion 데이터용 bounded schema interpreter.)
6. **attestation 파이프라인은 명세일 뿐 이 저장소에 실체가 없음**: `.claude/quality-attesters.json` 부재, `.github/` 부재, 외부 서명자 미제공 — 릴리스 게이트는 어디서도 통과할 수 없는 상태(fail-closed 자체는 정확한 동작이나, 문서 어디에도 "인프라를 별도 구축해야 한다"가 명시적 온보딩으로 없음). workflow-security 검증 9.4KB도 실제 workflow 없이 fixture만 검사.
7. **에이전트 개수·문서 표기**: README inventory 마커는 88로 일치하나, 구감사 문서와 일부 서술이 46/86 등 혼재. (경미)

---

## 5. 개선·고도화 로드맵

### P0 — 즉시 (구조 결함 수정, 1주 내)

> **조치 완료 (2026-08-03)**: 아래 6건은 보고서 작성 당일 모두 수정됐다 — verifier Grep 도구 전환 + 정책 tripwire, `.codex/agents` 90개 재생성·drift 검증 편입, deployment 마커 기반 판별로 조용한 skip 제거, `next-contract-designer`·`db-migration-writer` agent 신설과 소유권 등록, `validate-schema-parity.mjs` 추가. 진단 검증 48개 검사 통과(Node 22 전용 3개 검사는 최종 환경에서 재실행 필요).

| # | 항목 | 조치 |
|---|---|---|
| P0-1 | `ux-validator` grep→`rg` 교체 | 문서화된 검사가 실제로 실행되게 수정 + validator에 "verifier 프롬프트 내 명령이 Bash 정책 allowlist와 일치" 검사 추가 |
| P0-2 | `.codex/agents` 미러 정리 | 10개 누락 보충 + `build-adapters.mjs` 미러 대상에 포함하거나, 유지 의사가 없으면 삭제. 어느 쪽이든 validator로 drift 강제 |
| P0-3 | adapter drift 검사 활성화 | `.agents/` 존재 여부가 아닌 명시적 플래그/manifest로 소스 저장소 판별 — "조용한 skip" 제거 |
| P0-4 | 무소유 산출물 4종에 owner 부여 | `next-contract-matrices.md`는 신규 `next-contract-designer`(또는 기존 designer 확장)로, `change-scope.md`·`integration-overlay.json`은 레지스트리 등록 — 메인 스레드 작성 표면 축소 |
| P0-5 | `migrations/**` 소유권 등록 | `server-db-migration`을 스킬에서 agent 삼각형(schema-designer → migration-writer → migration-verifier)으로 승격하는 첫 단추 |
| P0-6 | 스키마-검증기 일치 검사 | 9종 JSON Schema와 수기 validator의 키/enum/const 일치를 assert하는 validator 추가 (또는 무의존 경량 스키마 실행기로 통합) |

### P1 — 커버리지 확장 (현대 웹 필수 축, 1~2개월)

> **조치 현황 (2026-08-03)**: P1-1(SEO — `seo-meta-builder`+`seo-verifier`), P1-2(성능 예산 — `performance-budget-designer`+`performance-verifier`), P1-3(i18n — `/i18n-setup` 스킬+`i18n-builder`+ux-validator 완전성 검사), P1-4(관측성 — `web-observability-builder`), P1-5(의존성 보안 — `security-reviewer` 감사 판정 확장), P1-6(MUI 하드코딩 4개 agent를 tech-stack 조건 선택으로 전환), P1-8(version-analyzer Public API Diff), P1-9 전반부(`timeseries-verifier`, §2.3 시계열 미완결 해소)를 구현·wiring 완료(skill 30, agent 97, companion flag 7). P1-7도 조치 완료 — experimental 스킬 5종에 `implementation-contract.md` 추가(v1.1.0): incremental diff·noise budget·baseline suppression(코드리뷰), 한국어 1급 임베딩 기준·pre-filter ACL·RRF(검색), handoff 상태기계·deflection 정의·`REALTIME_VOICE_MODE` dangling 해소(고객센터), NL→AST golden 쌍·catalog 거버넌스·chart-builder 경계(analytics), CAPTCHA 우회 명시적 거부·ToS/politeness(브라우저). 신규 역량 eval 시나리오 6개 추가(일반 계약 30→36). **잔여**: P1-9 후반부 CI/배포 전용 verifier(공급망 검사는 security-reviewer가 부분 커버 중).

우선순위는 "이미 강한 골격에 얹었을 때 점수 상승 폭" 기준.

1. **SEO/메타데이터 owner + verifier** — metadata·canonical·sitemap·robots·OG·JSON-LD를 소유하는 builder와 read-only SEO verifier. Next profile의 존재 이유를 완성한다. (카테고리 ⑦ 68→80, ⑪ 26→55 예상)
2. **성능 예산 삼각형** — `performance-budget.md` 설계 산출물(LCP/INP/CLS/번들 예산) + Lighthouse/size receipt를 quality runner에 편입 + perf verifier. 현재 receipt 인프라를 그대로 재사용 가능해 비용 대비 효과 최대.
3. **i18n 스킬** — message catalog·ICU·locale routing·추출 워크플로. visual QA의 locale matrix가 이미 소비자로 존재하므로 생산자만 만들면 된다. 한국어 제품 타깃 하니스에서 부재가 특히 아이러니한 지점.
4. **비-AI 관측성** — Sentry/OTel/RUM 초기화 builder + release tag·source map 업로드를 deploy CI에 연결. `ai-observability-builder`의 패턴 재사용.
5. **의존성 보안 verifier** — SCA/CVE·라이선스·SBOM. `evidence/audit.json` receipt가 이미 있으므로 판정 로직만 추가.
6. **스타일링 profile 분리** — MUI/Emotion 하드코딩(design-system-architect·component-builder 계열)을 tech-advisor의 조건 선택과 일치시키고 Tailwind+shadcn profile 추가. 현재 tech-advisor는 조건부라 말하는데 하류 4개 agent가 MUI를 전제하는 **내부 모순** 해소.
7. **AI 서비스 브랜치 심화** — 5종 스텁에 각각 구현 계약 reference 추가(RAG: 청킹/하이브리드 가중/리랭커; support: 핸드오프 상태기계; browser: CAPTCHA/ToS 정책). `REALTIME_VOICE_MODE`는 구현하거나 manifest에서 제거(dangling 해소).
8. **라이브러리 API diff** — api-extractor 기반 `.d.ts` diff를 version-analyzer 입력으로 — semver 판정을 산문에서 타입 증거로 전환.
9. **시계열 전용 verifier + CI/배포 verifier** — 분산된 조건부 검사를 전용 read-only agent로 승격해 §2.3 매트릭스의 미완결 2행 해소.

### P2 — 전략 고도화 (분기 단위)

> **P2-1·P2-2 1단계 조치 완료 (2026-08-03)**: `release-tier-contract.md` 신설 — T0 diagnostic / T1 isolated-verified / T2 attested-release 3단 라벨과 승급 경로, T2 미만은 `release-manager`가 `release-readiness.md`로 보고(HANDOFF 기계 강제는 유지 — 게이트 완화 없음). completion-contract·web-orchestrator·web-verify·README wiring 완료. P2-2 1단계로 하니스 자체 CI workflow(full-SHA pin, contents:read, validate-harness + test-ai-harness)를 작성했으나 **일부 조직의 GitHub pre-receive 정책이 workflow push를 차단**(플랫폼 승인 필요)해 `.claude/ci/harness-ci.yml`에 비활성 보관 중 — 승인 후 `.github/workflows/`로 이동하면 라우팅 회귀 36개 시나리오 계약이 push/PR마다 정적 검증되고 workflow 보안 검사가 실 workflow를 검사하게 된다(로컬에서 1 workflow checked PASS 확인 완료). 잔여: 플랫폼 워크플로 승인, run-eval-executor 기반 runtime 시나리오의 정기 실행(모델 호출 비용 정책 필요).

1. **릴리스 세리머니 tiering** — 현재 기본이 enterprise 공급망 등급(격리 CI + 외부 Ed25519 서명자)이라 인프라 없는 팀은 **영구 미릴리스 상태**에 빠진다. `full-attestation / standard(격리 CI receipt만) / diagnostic` 3단 정책을 명시하고, 어떤 단계에서 무엇을 신뢰할 수 없는지 문서화. 지금의 fail-closed 정확성은 유지하되 온보딩 경로를 제공.
2. **모드 라우팅의 준결정화** — 현재 최대 리스크는 "모든 강제가 라우팅 이후"라는 점(라우팅 자체는 모델 판단). 이미 있는 61개 시나리오를 `run-eval-executor.mjs`로 정기 실행하는 회귀 파이프라인 + 라우팅 전용 경량 fixture를 CI에 편입.
3. **백엔드 실체화** — Hono/Fastify 기반 BFF profile(또는 `react-vite-spa-hybrid` profile 신설로 `vite-serverless-hybrid` 함정 해소) + DB 삼각형(P0-5의 완성) + GraphQL codegen 경로. 이것이 완성되면 카테고리 ⑩이 32→65 수준으로 상승하며 하니스의 "Mock까지" 한계가 사라진다.
4. **커머스·CMS profile** — 결제(PG 웹훅 idempotency·주문 상태기계)와 headless CMS 커넥터는 별도 조건부 profile로. 기존 external-ingestion의 promotion/quality 계약이 CMS 콘텐츠 파이프라인에 거의 그대로 이식 가능.
5. **eval 통계화** — 반복 실행 분산·최소 표본·신뢰구간·judge 보정을 `run-ai-evals.mjs` 결과 계약에 추가.
6. **문서 단일화** — release hard stop이 4개 파일에 중복 서술됨 → 단일 계약 파일 + 참조로 전환하고 validator로 중복 금지.

### 추가할 필요가 없는 것 (과잉 방지)

- 프레임워크 무한 확장(Svelte/Angular/Nuxt): 수요 증거 없이 profile을 늘리면 지금의 깊이가 희석된다. Remix/RR7 framework mode 정도가 다음 후보.
- agent 수 확대 자체: 88개는 이미 상한 근처. P1 항목 다수는 기존 agent 확장·reference 추가로 해결 가능하다.
- 마이크로프론트엔드/Module Federation: 이 하니스의 타깃(주니어가 하나의 앱을 완성) 대비 복잡도만 증가.

---

## 6. 최종 결론

1. **증거·강제 계층은 그대로 두고 배워야 할 자산이다.** receipt-fingerprint-attestation 사슬, spawn-and-assert 방식의 훅 자기검증, 소유권 레지스트리 단일화는 다른 팀 하니스에 이식할 가치가 있는 설계다.
2. **점수의 병목은 깊이가 아니라 폭이다.** 카테고리 1~4(80점대)와 10~13(30점 이하)의 격차가 곧 로드맵이다. SEO·성능예산·i18n·관측성 4종(P1 상위)은 기존 인프라 재사용률이 높아 투자 대비 커버리지 상승이 가장 크다.
3. **"자동화 상한"의 정직한 답**: 이 하니스가 잘 맞는 프로젝트(사내 도구·대시보드·정적 수집·로컬 상태 앱)에서는 **사람 개입을 요구사항 확인과 승인 5회 내외로 줄이면서 QA 증거가 서명된 산출물**을 얻을 수 있다 — 이는 2026년 현재 에이전트 웹 개발의 실질 최전선이다. 반면 그 경계 밖(백엔드·콘텐츠·커머스)에서는 하니스가 규율만 제공하고 구현은 사람 몫이며, 이 경계를 사용자에게 사전에 알려주는 것(모드 감지 배너처럼 "이 요청의 N%는 하니스 범위 밖" 고지)도 P1급 개선이다.
4. **가장 시급한 한 가지를 꼽으면 P2-1(릴리스 tiering)이다.** 현재 구조는 "완벽히 검증되거나, 영원히 릴리스 불가"의 이분법이라 실사용에서 하니스의 가장 강한 부분(증거 체계)이 오히려 채택 장벽이 된다. 신뢰 수준을 명시한 단계적 릴리스 경로가 열리면 나머지 로드맵의 가치가 배가된다.

---

## 부록 A. 평가 근거 요약

- 스킬 29종 전수: 코어 수명주기(orchestrator 계열) 성숙, `feature-add` v1.3.0·`ai-eval` v1.1.0만 반복 이력, 나머지 27종은 2026-07-27 일괄 v1.0.0
- 에이전트 88종: 전원 `model: sonnet`, `maxTurns` 15~45, Write 계열은 Bash 미보유·verifier 21종은 Write/Edit 미보유 — 예외 없음
- 강제 스크립트: 71개 `.mjs` ~1.5만 줄, hook 6종 + validator 16종, fixture 기반 정책 테스트(bash 49·ownership 44·workflow 보안)
- eval: 일반 30 + AI 31 시나리오(critical 16), 정적 구조 검증은 결정론적·assertion 채점은 모델/사람
- adapter: react-vite-spa(certified) / next-app-fullstack(compatible), deployment target-capability conflict 매트릭스 내장
