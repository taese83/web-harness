# AI Agent 기반 웹 서비스 개발 가능성 및 Harness 고도화 보고서

- 작성 기준일: 2026-07-13
- 분석 대상: 현재 저장소의 .claude/skills, .claude/agents, .claude/evals, hooks 및 검증 스크립트
- 대상 서비스: AI 코드리뷰, 사내 문서 검색, AI 고객센터, AI 대용량 데이터 대시보드, 브라우저 Agent
- 관점: 시니어 웹·플랫폼 엔지니어링, 운영 안정성, 보안, 평가 가능성, 확장성

> 이 문서에서 “사내 문석 검색”은 “사내 문서 검색”으로 해석한다.

---

## 1. 결론 요약

### 1.1 핵심 결론

다섯 서비스는 모두 기술적으로 개발 가능하다. 다만 “AI가 동작하는 데모”와 “기업 환경에서 신뢰할 수 있는 제품” 사이에는 큰 차이가 있다.

현재 harness는 일반 웹 애플리케이션 개발과 시계열 대시보드 구현에는 강하다. 특히 요구사항 수집, 역할 분리, 프런트엔드 품질 검증, 시계열 데이터 계약, 실시간 버퍼링과 렌더링 예산은 잘 갖추어져 있다. 반면 제품 내부에서 실행되는 AI Agent에 필요한 서버 런타임, 모델 게이트웨이, 검색·도구 계약, 권한 경계, Human-in-the-loop, trace 기반 평가, 비용 통제는 거의 없다.

가장 중요한 구분은 다음과 같다.

1. 현재 .claude/agents는 **개발을 수행하는 build-time agent**다.
2. 사용자가 이용할 AI 코드리뷰 봇·검색 AI·고객센터·브라우저 Agent는 **제품에서 실행되는 runtime agent**다.
3. build-time agent가 runtime agent 코드를 생성할 수는 있지만, 현재 구조만으로 runtime의 신뢰성·보안·운영성이 자동 확보되지는 않는다.

따라서 다섯 개의 독립적인 거대 skill을 만드는 것보다, 공통 AI 플랫폼 계층을 먼저 만들고 서비스별 얇은 vertical skill과 agent를 추가해야 한다.

### 1.2 구현 가능성 판단

| 서비스 | POC | 제한된 운영 환경 | 범용 자율 운영 | 현재 harness 적합도 | 권고 |
|---|---:|---:|---:|---:|---|
| AI 코드리뷰 봇 | 높음 | 높음 | 중간 | 약 45% | 1차 구축 |
| 사내 문서 검색 AI | 높음 | 높음 | 높음 | 약 35% | 1차 구축 |
| AI 고객센터 | 높음 | 텍스트 높음, 음성 중간 | 중간 | 약 30% | 3차 구축 |
| AI 대용량 데이터 대시보드 | 높음 | 높음 | 중상 | 약 70% | 2차 구축 |
| 브라우저 Agent | 높음 | 제한된 업무는 중상 | 낮음 | 약 30% | 마지막 구축 |

적합도 수치는 과학적 측정값이 아니라 현재 skill·agent·검증 경로가 필요한 역량을 얼마나 직접 지원하는지에 대한 아키텍처 준비도 추정치다.

권장 고도화 이후 목표 준비도는 다음과 같다.

- AI 코드리뷰 봇: 80~90%
- 사내 문서 검색 AI: 85~90%
- AI 고객센터: 텍스트 80~85%, 음성 70~80%
- AI 대용량 데이터 대시보드: 85~90%
- 브라우저 Agent: 허용된 도메인·행위에 한정하면 70~80%, 범용 자율 탐색은 50% 미만

### 1.3 개발 우선순위

1. **공통 AI foundation**
2. **사내 문서 검색 AI와 코드리뷰 봇**
3. **AI 대용량 데이터 대시보드**
4. **텍스트 고객센터, 이후 음성**
5. **업무 범위가 제한된 브라우저 Agent**

검색과 코드리뷰는 범위가 명확하고 정답 데이터와 사용자 피드백을 수집하기 쉬워 초기 평가 체계를 검증하기 좋다. 대시보드는 기존 시계열 기반을 재사용할 수 있다. 고객센터와 브라우저 Agent는 외부 시스템 쓰기, 개인정보, 금전·계정 영향이 커서 공통 안전 장치가 검증된 후 진행해야 한다.

---

## 2. 분석 기준

### 2.1 성숙도 정의

#### POC

- 정상 사례에서 핵심 흐름을 시연한다.
- 제한된 fixture 또는 mock 데이터를 사용한다.
- 사람이 결과를 수동 확인한다.
- 장애 복구, 멀티테넌시, 비용·보안 통제는 완전하지 않을 수 있다.

#### 운영 가능한 MVP

- 실제 인증과 데이터 소스를 연결한다.
- 권한, timeout, retry, idempotency, audit log가 있다.
- 정량 평가 데이터셋과 배포 gate가 있다.
- 모델 실패 시 fallback과 사람 이관이 있다.
- 비용·지연·오류를 관측할 수 있다.

#### Production

- 테넌트 격리, 개인정보 보호, 규제·보존 정책을 충족한다.
- 모델·도구·검색 품질 회귀를 지속 평가한다.
- 장애·provider 변경·모델 변경에 대응할 수 있다.
- SLO, 온콜, runbook, 점진 배포와 롤백이 있다.
- 고위험 행동은 최소 권한과 승인 정책으로 보호한다.

### 2.2 평가 축

| 축 | 질문 |
|---|---|
| 제품·UX | 사용자가 결과를 이해하고 수정·거부·재시도할 수 있는가 |
| Agent runtime | 상태, 도구 호출, handoff, retry, cancel, resume가 가능한가 |
| 데이터 | 수집, 정규화, 권한, 최신성, 삭제가 일관적인가 |
| 보안 | 입력·문서·웹페이지·도구 출력을 불신하고 권한 상승을 차단하는가 |
| 평가 | 정답 데이터, trace, grader, 회귀 gate가 있는가 |
| 운영 | 비용, token, latency, 오류, provider 의존성을 관리하는가 |
| 확장성 | 공통 기능을 재사용하면서 서비스별 정책을 격리하는가 |

---

## 3. 최신 AI 기반 웹 개발 방식

### 3.1 Prompt-first가 아니라 Eval-first

먼저 “좋은 답변”과 “허용되지 않는 행동”을 실행 가능한 시나리오로 정의하고, 그다음 prompt와 agent를 만든다.

권장 순서:

1. 사용자 작업과 실패 비용 정의
2. autonomy level 정의
3. golden dataset과 adversarial dataset 작성
4. 도구 입력·출력 schema와 권한 정의
5. trace와 grader 정의
6. 최소 workflow 구현
7. 평가 결과로 prompt·retrieval·tool을 개선

OpenAI의 최신 agent 평가 가이드는 단일 답변보다 tool 선택, handoff, policy 준수 같은 workflow 문제를 trace와 grader로 평가하고, 반복 가능한 dataset 평가로 확장하는 접근을 권장한다. 기존 Evals 플랫폼은 2026년 10월 31일 read-only, 2026년 11월 30일 종료 예정이므로 신규 체계는 Datasets와 현재 평가 API를 기준으로 설계해야 한다.  
출처: [OpenAI Agent evals](https://developers.openai.com/api/docs/guides/agent-evals), [OpenAI Evals 전환 안내](https://developers.openai.com/api/docs/guides/evals)

### 3.2 결정론적 data plane과 확률적 control plane 분리

LLM은 다음을 담당한다.

- 의도 해석
- 계획 수립
- 허용된 도구 선택
- 결과 설명과 요약
- 모호한 입력의 구조화

LLM이 직접 담당하면 안 되는 것은 다음과 같다.

- 인증·인가의 최종 판단
- 금액, 재고, 계정 상태 같은 authoritative state
- 무제한 SQL 또는 임의 코드 실행
- 데이터 보존·삭제 정책
- 고위험 작업의 최종 승인

권한, 쿼리 제한, 데이터 검증, 상태 변경은 결정론적 서비스가 수행해야 한다. Agent는 이 서비스를 typed tool로 호출한다.

### 3.3 Browser에서 모델 provider를 직접 호출하지 않는다

웹 클라이언트에는 provider key를 두지 않는다. 브라우저는 사내 BFF 또는 agent API에 요청하고, 서버가 다음을 담당한다.

- 인증과 tenant context
- provider/model routing
- prompt와 policy version
- tool registry
- token·비용 제한
- 개인정보 필터링
- trace와 audit
- retry, timeout, cancellation
- streaming fan-out

Realtime WebRTC처럼 브라우저가 provider와 직접 연결해야 하는 경우에도 장기 key가 아니라 서버가 발급한 짧은 수명의 ephemeral credential을 사용한다.  
출처: [OpenAI Production best practices](https://developers.openai.com/api/docs/guides/production-best-practices), [OpenAI Realtime 연결 방식](https://developers.openai.com/api/docs/guides/realtime)

### 3.4 모든 경계는 typed contract로 만든다

자연어를 내부 시스템까지 그대로 전달하지 않는다.

- tool input: JSON Schema 또는 Zod
- tool output: versioned result schema
- model output: structured output
- error: retry 가능 여부와 사용자 메시지를 분리
- side effect: idempotency key 필수
- high-impact tool: approval metadata 필수

OpenAI Agents SDK는 function tool의 Zod 검증, handoff, session, guardrail, tracing, realtime을 제공한다. Manager가 최종 답변을 통제해야 하면 agent-as-tool, 전문 agent가 사용자와 직접 대화해야 하면 handoff를 선택하는 것이 적합하다.  
출처: [OpenAI Agents SDK](https://openai.github.io/openai-agents-js/), [Multi-agent 구성](https://openai.github.io/openai-agents-js/guides/multi-agent/)

### 3.5 Workflow는 상태 머신으로 관리한다

단순 chat loop만으로는 운영하기 어렵다. 최소 상태는 다음을 포함해야 한다.

- request ID, user, tenant
- workflow version, prompt version, model
- 현재 step과 남은 step
- tool call과 결과
- approval 대기 상태
- retry count
- max turns, max tool calls, token·비용 budget
- cancellation
- resumable checkpoint

고객센터 이관, 장시간 ingestion, 대규모 분석, 브라우저 승인 대기는 durable job 또는 workflow engine이 필요하다.

### 3.6 Progressive autonomy를 적용한다

처음부터 완전 자율 실행으로 시작하지 않는다.

| 단계 | 동작 | 예 |
|---|---|---|
| L0 | 검색·요약만 | 문서 답변, 코드 설명 |
| L1 | 제안 | 리뷰 comment 초안, 고객 답변 초안 |
| L2 | 사용자 승인 후 실행 | 티켓 생성, 환불 요청, 이메일 전송 |
| L3 | 저위험 allowlist 자동 실행 | 태그 변경, 읽기 전용 조회 |
| L4 | 범용 자율 실행 | 권고하지 않음 |

도구 guardrail은 각 function call에 적용해야 한다. 일부 framework의 agent 입출력 guardrail만으로 내부 agent의 모든 tool call을 보호할 수 없기 때문이다. 고위험 도구는 실행 전 blocking guardrail과 사람 승인을 사용한다.  
출처: [OpenAI Guardrails](https://openai.github.io/openai-agents-js/guides/guardrails/), [Human-in-the-loop](https://openai.github.io/openai-agents-js/guides/human-in-the-loop/)

### 3.7 Retrieval은 권한을 보존해야 한다

RAG 품질보다 먼저 해결할 것은 access control이다.

- 원본 문서의 사용자·그룹 ACL을 ingestion 시 보존
- 검색 요청자의 identity로 query-time security trimming
- 삭제·권한 변경·문서 최신성 동기화
- keyword + vector hybrid retrieval
- 필요 시 semantic reranking
- 답변에 source와 인용 근거 제공
- 근거가 약하면 답변하지 않음

검색 결과가 모델에 전달되기 전에 ACL이 적용되어야 한다. 생성 후 필터링은 이미 유출된 컨텍스트를 되돌릴 수 없다.  
출처: [Azure AI Search 문서 수준 접근 제어](https://learn.microsoft.com/en-us/azure/search/search-document-level-access-overview), [Hybrid search](https://learn.microsoft.com/en-us/azure/search/hybrid-search-how-to-query), [OpenAI File Search](https://developers.openai.com/api/docs/guides/tools-file-search)

### 3.8 모든 외부 콘텐츠를 untrusted input으로 취급한다

다음은 모두 prompt injection 원천이다.

- 사용자 입력
- 검색된 사내 문서
- pull request 본문과 코드 주석
- 고객 메시지와 첨부파일
- 웹페이지 DOM, 접근성 트리, 이미지
- MCP server와 tool output

RAG나 fine-tuning은 prompt injection을 완전히 제거하지 못한다. 최소 권한, 외부 콘텐츠 구분, tool allowlist, 사람 승인, adversarial test가 필요하다.  
출처: [OWASP LLM01 Prompt Injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/), [OWASP LLM06 Excessive Agency](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/)

### 3.9 MCP는 편의 계층이지 보안 경계가 아니다

MCP server는 명시적 사용자 동의, 데이터 프라이버시, tool 안전성을 전제로 사용해야 한다. OAuth token passthrough를 금지하고 token audience를 검증해야 한다.

필수 정책:

- 승인된 MCP server registry
- server별 허용 tool 목록
- tool별 approval 요구
- 전송 데이터 audit
- short-lived token
- tenant별 credential 격리
- server manifest 변경 감지

출처: [MCP 기본 원칙](https://modelcontextprotocol.io/specification/2025-03-26/index), [MCP Authorization](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization), [OpenAI MCP 보안 가이드](https://developers.openai.com/api/docs/guides/tools-connectors-mcp)

### 3.10 관측성은 로그가 아니라 trace 단위로 설계한다

하나의 요청에서 다음 span을 연결해야 한다.

- frontend request
- agent run
- model call
- retrieval
- rerank
- tool call
- approval wait
- handoff
- final answer

기본 지표:

- end-to-end latency
- time to first token
- token과 비용
- model·tool 오류율
- retry와 timeout
- tool 선택 정확도
- retrieval Recall@k, NDCG, MRR
- groundedness와 citation correctness
- approval·handoff율
- task success

OpenTelemetry의 GenAI semantic convention은 agent, model, retrieval, tool call, token usage 등을 표준화하지만 prompt와 completion에는 PII가 포함될 수 있으므로 기본 수집을 제한하고 필터링·truncation해야 한다.  
출처: [OpenTelemetry GenAI attributes](https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/), [OpenAI Tracing](https://openai.github.io/openai-agents-js/guides/tracing/)

### 3.11 지연과 비용은 제품 요구사항이다

권장 전략:

- 작은 모델로 routing·분류
- 어려운 요청만 상위 모델 사용
- context를 최소화하고 retrieval 결과 수 제한
- 독립 tool call 병렬화
- streaming으로 체감 지연 감소
- exact-prefix prompt caching을 고려해 정적 지침을 앞에 배치
- 비동기 분석은 queue와 background job 사용
- 빈번한 결정론적 동작은 LLM 대신 UI·규칙·cache 사용

출처: [OpenAI Latency optimization](https://developers.openai.com/api/docs/guides/latency-optimization), [Cost optimization](https://developers.openai.com/api/docs/guides/cost-optimization), [Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)

---

## 4. 현재 Harness 진단

### 4.1 확인된 강점

#### 역할과 산출물 분리

- web-orchestrator가 계획, 설계, 개발, QA, 릴리스 단계를 구분한다.
- agent별 소유 경로와 read-only verifier 경계가 있다.
- hooks와 enforce-agent-ownership 스크립트가 파일 수정 주체를 제한한다.
- 정적 validator가 22개 구조 검사를 통과한다.

#### 일반 웹 품질

- TypeScript, ESLint, FSD, 접근성, 테스트 존재 여부를 code-reviewer가 확인한다.
- API, 보안, 통합, 브라우저 verifier가 분리되어 있다.
- 요구사항, 설계, 구현, QA 산출물이 workspace에 남는다.

#### 시계열 대시보드

- timeseries-dashboard skill은 데이터 규모, refresh rate, live update, 보존 기간, latency와 rendering budget을 intake한다.
- timeseries-architect는 snapshot + stream, downsampling, Worker, 관측성을 설계한다.
- realtime-data-builder는 bounded buffer, reconnect, backpressure, stale handling을 다룬다.
- chart-performance와 streaming-contract reference가 운영에 필요한 핵심 원칙을 포함한다.

이 기반은 4번 서비스의 chart data plane에 직접 재사용 가능하다.

### 4.2 핵심 결손

#### 제품용 AI runtime 부재

현재 구조에는 다음 소유 영역이 없다.

- apps/agent-api 또는 services/agent-runtime
- provider abstraction과 model gateway
- agent session·workflow state
- queue와 worker
- retrieval index·vector store
- tool registry와 typed adapter
- approval state
- token·cost budget
- AI trace storage

#### AI 보안 모델 부재

security-reviewer는 일반 웹 보안을 다루지만 다음을 검증하지 않는다.

- direct·indirect prompt injection
- system prompt leakage
- retrieval poisoning
- vector·embedding access leakage
- excessive agency
- MCP trust
- tool output injection
- model-generated SQL·code 안전성
- 개인정보의 model·trace 유출

#### 실행 가능한 AI 평가 부재

.claude/evals/scenarios.json에는 14개 정적 시나리오가 있지만 다음이 없다.

- scenario runner
- model 또는 agent 실행
- deterministic assertion
- LLM grader
- golden dataset
- trace 검사
- 점수 threshold와 release gate
- 서비스별 adversarial fixture

현재 validator는 scenario 배열 크기, ID, prompt·assertion 존재 여부와 일부 routing ID를 확인할 뿐 실제 시나리오를 실행하지 않는다. 따라서 “scenario 파일이 존재한다”와 “품질 회귀를 차단한다”를 구분해야 한다.

#### 외부 시스템 통합 부재

- code-reviewer는 로컬 정적 검증자이며 GitHub/GitLab webhook bot이 아니다.
- browser-verifier는 read-only Playwright QA 역할이며 planner·executor·approval을 가진 제품용 Browser Agent가 아니다.
- timeseries agent는 chart data flow에는 강하지만 semantic metric, NL query, query safety가 없다.
- 문서 connector, CRM, ticketing, telephony adapter가 없다.

### 4.3 즉시 수정할 구조적 문제

#### requirements-analyst Markdown 결함

.claude/agents/requirements-analyst.md:26 부근에서 SEO 경고 code fence가 닫히지 않은 상태로 시계열 감지 규칙을 감싼다. 현재 validator는 이를 통과시키므로 사람이 읽는 instruction과 모델이 해석하는 instruction의 의미가 어긋날 수 있다.

조치:

1. code fence를 즉시 정상화한다.
2. Markdown fence balance 검사를 validator에 추가한다.
3. 필수 trigger 문장이 code block 안에 들어가면 실패하도록 semantic 검사한다.

#### validator의 한계

현재 검증은 파일 형태와 routing 문자열에는 강하지만 실제 행동을 검증하지 않는다.

추가할 계층:

- Level 1: schema·frontmatter·ownership
- Level 2: prompt semantic lint
- Level 3: fixture 기반 agent execution
- Level 4: deterministic assertion와 trace assertion
- Level 5: LLM grader와 adversarial regression

### 4.4 현재 구조의 종합 판정

| 역량 | 현 수준 | 판정 |
|---|---|---|
| 웹 UI 개발 | 높음 | 재사용 |
| 일반 웹 QA | 중상 | 확장 |
| 시계열 chart | 높음 | 적극 재사용 |
| Agent backend | 낮음 | 신규 구축 |
| Retrieval·ingestion | 매우 낮음 | 신규 구축 |
| Tool action·approval | 매우 낮음 | 신규 구축 |
| AI security | 매우 낮음 | 신규 구축 |
| AI eval·trace | 매우 낮음 | 신규 구축 |
| 비용·model routing | 매우 낮음 | 신규 구축 |

---

## 5. 공통 참조 아키텍처

### 5.1 논리 구조

    Web / Mobile / SCM / Voice / Browser Session
                         |
                 BFF / Agent API
                         |
        AuthN + Tenant + Rate/Cost Policy
                         |
                  Agent Orchestrator
            /            |             \
       Retrieval      Tool Registry    Model Gateway
          |                |                |
    Index + ACL      Domain Services    Model Providers
          |                |
    Source Systems    Approval + Audit
                         |
               Workflow / Queue / Worker
                         |
                 Trace + Eval + Metrics

### 5.2 필수 패키지와 서비스

권장 monorepo 구조:

| 경로 | 책임 |
|---|---|
| apps/web | 사용자 UI, streaming renderer, approval UI |
| apps/agent-api | 인증된 agent API, SSE·WebSocket, session |
| workers/ingestion | 문서·코드·이벤트 수집과 index 갱신 |
| workers/agent-jobs | 장시간 workflow와 재시도 |
| packages/ai-contracts | tool·event·structured output schema |
| packages/model-gateway | provider adapter, routing, budget |
| packages/agent-runtime | workflow, state, handoff, approval |
| packages/ai-evals | dataset, runner, grader, thresholds |
| packages/observability | trace, metrics, PII filtering |
| packages/security-policy | tool policy, prompt injection policy |
| packages/semantic-model | 인증된 metric과 dimension |

### 5.3 요청 처리 순서

1. API가 사용자·tenant·scope를 확정한다.
2. 입력을 길이, 파일 유형, PII, abuse policy로 검사한다.
3. workflow가 autonomy level과 budget을 설정한다.
4. retrieval 또는 tool candidate를 allowlist에서 선택한다.
5. tool별 schema와 downstream authorization을 다시 검증한다.
6. 고위험 동작이면 approval state로 중단한다.
7. 실행 결과를 구조화하고 모델이 설명한다.
8. source, uncertainty, action result를 UI에 분리 표시한다.
9. trace를 저장하되 민감 정보는 제거한다.
10. offline·online evaluator가 결과를 집계한다.

### 5.4 Provider 독립성

모델 provider를 완전히 동일하게 추상화하는 것은 비현실적이지만 업무 계약은 독립적으로 유지해야 한다.

- provider-specific request는 adapter 내부에 격리
- tool schema와 domain result는 provider 중립
- prompt version과 model version을 trace에 기록
- streaming event를 내부 표준으로 변환
- 기능 capability matrix 유지
- primary와 fallback model 정책 분리
- provider 장애 시 read-only 또는 rule-based fallback

---

## 6. 서비스 1 — AI 코드리뷰 봇

### 6.1 판정

**개발 가능성이 높고 초기 제품으로 적합하다.** 단, LLM만으로 merge 승인·차단을 결정해서는 안 된다. 정적 분석과 테스트는 결정론적 gate로 유지하고, AI는 맥락 이해, 변경 영향 분석, 설명, 누락 탐색에 사용한다.

GitHub의 Copilot code review도 repository context와 custom instruction을 사용하지만 실수나 누락 가능성을 명시하며 사람 리뷰를 보완하는 용도로 설명한다. Copilot comment는 Approve 또는 Request changes가 아니며 required approval을 충족하거나 merge를 차단하지 않는다.  
출처: [GitHub Copilot code review 개념](https://docs.github.com/en/copilot/concepts/agents/code-review), [Copilot code review 사용](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/copilot-code-review)

### 6.2 권장 범위

#### 1차 MVP

- pull request webhook 수신
- diff와 변경 파일 주변 context 수집
- repository instruction과 architecture rule 검색
- ESLint, TypeScript, test, CodeQL 결과 통합
- 심각도·신뢰도·근거·수정 제안을 가진 comment 생성
- 동일 finding dedupe
- 사람이 유용함·오탐·해결됨 feedback 제공

#### 이후 확장

- 변경 영향 graph
- 소유 팀과 CODEOWNERS 연계
- 과거 장애·postmortem 검색
- test case 초안 생성
- 수정 patch 제안
- 조직별 review policy

자동 patch 적용은 별도 승인 단계로 둔다.

### 6.3 아키텍처

    Pull Request Webhook
            |
        Event Queue
            |
       Context Builder
      /      |       \
    Diff   Repo Map  CI/SAST Results
      \      |       /
       Review Orchestrator
         |           |
    Deterministic   LLM Review
      Checks          |
         \           /
       Finding Normalizer
              |
      Dedupe + Line Mapper
              |
       SCM Review Comment

GitHub App은 pull request·review event, 최소 repository permission, webhook signature 검증을 사용해야 한다. CodeQL과 같은 code scanning은 PR annotation과 branch protection을 제공하는 결정론적 보완 계층이다.  
출처: [GitHub Webhook events](https://docs.github.com/en/enterprise-cloud@latest/webhooks/webhook-events-and-payloads), [GitHub Code scanning alerts](https://docs.github.com/en/code-security/concepts/code-scanning/code-scanning-alerts)

### 6.4 필요한 runtime agent와 tool

- review-orchestrator: 전체 finding 통합
- code-context-agent: diff 주변과 호출 관계 수집
- architecture-policy-agent: 조직 규칙과 ADR 대조
- security-review-agent: SAST 결과 설명과 논리 취약점 탐색
- test-gap-agent: 변경 위험과 부족한 테스트 탐색

도구:

- get_pull_request
- get_diff
- get_file_at_sha
- search_repository
- get_ci_results
- get_codeql_findings
- create_review_comment
- resolve_or_dismiss_feedback

쓰기 도구는 create_review_comment 정도로 제한하고 merge, approve, branch write는 초기 범위에서 제외한다.

### 6.5 보안과 품질 gate

- fork PR의 코드를 untrusted input으로 처리
- repository secret과 CI secret을 모델 context에서 제외
- prompt injection 형태의 코드 주석 무시
- comment에 근거 파일·line·rule 명시
- line mapping 실패 시 inline comment 대신 summary
- 동일 finding fingerprint로 재리뷰 중복 방지
- 삭제된 코드에 stale comment 생성 금지
- 모델 결과만으로 merge 차단 금지

### 6.6 평가

핵심 dataset:

- 실제로 수정된 과거 review finding
- 알려진 security bug fixture
- architecture violation fixture
- 정상 코드 negative fixture
- line shift와 rename fixture
- malicious comment injection fixture

지표:

- precision, recall
- actionable finding rate
- critical miss rate
- false-positive rate
- correct line mapping rate
- duplicate comment rate
- developer acceptance·dismissal
- PR latency와 review cost

### 6.7 현재 harness에서 재사용·추가

재사용:

- code-reviewer의 정적 점검 기준
- security-reviewer의 일반 보안 기준
- test-verifier
- ownership hook

추가:

- SCM integration
- code context index
- runtime review workflow
- feedback store
- executable review eval
- AI prompt injection review

---

## 7. 서비스 2 — 사내 문서 검색 AI

### 7.1 판정

**제한된 운영 환경에서 가장 성공 가능성이 높다.** 그러나 “문서를 vector DB에 넣고 chat UI를 붙이는 것”은 기업 검색이 아니다. ACL, 삭제, 최신성, source citation, no-answer 정책이 제품의 핵심이다.

### 7.2 권장 범위

#### 1차 MVP

- Confluence, Notion, Google Drive 등 1~2개 source
- 사용자·그룹 ACL 보존
- 문서와 attachment 정규화
- keyword + vector hybrid retrieval
- citation과 원문 링크
- 근거가 부족하면 답변 거절
- source·기간·부서 filter
- feedback과 검색 trace

#### 이후 확장

- Slack·ticket·code 검색
- 개인화 ranking
- multi-hop 질문
- 문서 간 충돌과 최신 버전 표시
- workflow tool 연동

### 7.3 ingestion 아키텍처

    Source Connector
          |
     Change Capture
          |
    Parse + Normalize
          |
    ACL + Metadata Join
          |
      Chunk + Embed
       /          \
    Keyword      Vector
      Index       Index
          \      /
       Version Registry

필수 metadata:

- source ID와 canonical URL
- document version
- owner
- created_at, updated_at
- effective_from, expires_at
- tenant
- user·group ACL
- classification
- deletion tombstone
- language

### 7.4 query 아키텍처

    User Query + Identity
             |
       Query Rewriter
             |
      ACL-filtered Hybrid Search
             |
          Reranker
             |
     Context Budget Builder
             |
      Grounded Answer + Citation

ACL은 retrieval query 시점에 적용한다. 생성 후 답변 필터만으로는 문서 유출을 방지할 수 없다. Azure AI Search의 document-level access control도 ingestion에서 ACL을 보존하고 query-time security trimming을 수행하는 구조를 명시한다.

### 7.5 필요한 runtime agent와 tool

- search-planner: 질문 분해와 source 선택
- retrieval-agent: query rewrite, hybrid search, rerank
- answer-agent: source 기반 답변과 불확실성 표시
- conflict-agent: 상충 문서와 최신성 판단

도구:

- search_documents
- get_document_excerpt
- get_document_metadata
- resolve_user_groups
- report_bad_source
- open_canonical_source

검색 tool은 사용자 identity를 모델이 인자로 정하지 못하게 해야 한다. 서버가 인증 context에서 강제 주입한다.

### 7.6 보안

- 문서별 ACL negative test
- cross-tenant query 차단
- 문서 내부 prompt injection 격리
- 민감 classification의 model 전송 정책
- source connector token 최소 권한
- 삭제·권한 변경 SLA
- trace에 원문 전체 저장 금지
- 사용자 query와 검색 결과 보존 정책 분리

### 7.7 평가

Retrieval:

- Recall@k
- NDCG@k
- MRR
- ACL leak rate는 반드시 0
- stale document retrieval rate

Generation:

- groundedness
- citation correctness
- citation completeness
- answer relevance
- unsupported claim rate
- no-answer precision

운영:

- freshness lag
- index failure rate
- p50/p95 latency
- cost per answered query
- source click-through
- 사용자 해결률

### 7.8 현재 harness에서 재사용·추가

재사용:

- 일반 웹 UI, API, accessibility, test verifier
- 요구사항·설계 artifact 흐름

추가:

- connector·ingestion worker
- ACL-aware retrieval
- source freshness와 deletion
- RAG security
- retrieval·grounding eval
- search observability

---

## 8. 서비스 3 — AI 고객센터

### 8.1 판정

**텍스트 agent-assist부터 시작하면 운영 가능성이 높다.** 완전 자율 고객 응대보다 상담원 보조, FAQ, 분류, 답변 초안, 대화 요약, 이관부터 시작해야 한다. 환불·계정 변경·결제처럼 상태를 변경하는 업무는 명시적 승인과 downstream authorization이 필요하다.

음성은 WebRTC·WebSocket·SIP, VAD, interruption, turn-taking, telephony 장애를 추가로 다루므로 텍스트보다 난도가 높다. OpenAI의 realtime 가이드는 브라우저·모바일에는 WebRTC, 서버 오디오에는 WebSocket, 전화망에는 SIP를 구분한다. Agents SDK의 voice agent는 interruption, tool, approval, handoff와 tracing을 지원한다.  
출처: [OpenAI Realtime](https://developers.openai.com/api/docs/guides/realtime), [OpenAI Voice Agents](https://openai.github.io/openai-agents-js/guides/voice-agents/)

### 8.2 단계적 범위

#### 단계 A: 상담원 보조

- 고객 의도·감정·긴급도 분류
- 관련 지식 검색
- 답변 초안
- 대화 요약
- 다음 action 추천

#### 단계 B: 저위험 자동 응대

- FAQ
- 배송·티켓 상태 조회
- 비밀번호 재설정 안내
- 상담 예약

#### 단계 C: 승인된 transaction

- 환불 요청 생성
- 주문 변경
- 계정 설정 변경
- 보상 쿠폰 발급

단계 C는 정책 engine과 사람 승인 또는 step-up authentication을 거친다.

#### 단계 D: 음성

- WebRTC web 상담
- SIP telephony
- interruption과 barge-in
- 실시간 transcript
- 상담원 warm handoff

### 8.3 아키텍처

    Chat / Voice / Email
             |
      Channel Gateway
             |
    Identity + Consent + PII
             |
      Conversation Orchestrator
       /          |           \
    Knowledge   CRM/Ticket    Policy Engine
      Search      Tools            |
       \          |           Approval
        \         |              /
         Response / Human Handoff
                    |
        Transcript + Summary + Audit

상담원 이관 시 동일 channel을 유지하고 transcript, AI 요약, 감지된 intent, 인증 상태, tool 결과를 전달해야 한다. Twilio의 AI-to-human handoff blueprint도 사람에게 AI 생성 summary와 context를 넘기는 패턴을 제시한다.  
출처: [Twilio AI-to-human handoff](https://www.twilio.com/docs/conversations/solution-blueprints/ai-to-human-handoff), [Amazon Connect agentic assistance](https://docs.aws.amazon.com/connect/latest/adminguide/agentic-assistance.html)

### 8.4 필요한 runtime agent와 tool

- triage-agent
- knowledge-agent
- response-agent
- transaction-agent
- handoff-agent
- quality-monitor-agent

도구:

- search_support_knowledge
- get_customer_profile
- get_order_status
- create_support_ticket
- request_refund
- schedule_callback
- handoff_to_human

읽기와 쓰기 도구를 namespace로 분리하고 쓰기는 별도 approval policy를 적용한다.

### 8.5 UX 요구사항

- AI 응대임을 명시
- 근거 문서 또는 정책 링크
- 진행 중, 도구 실행 중, 승인 대기 상태 표시
- 답변 수정과 재질문
- 언제든 상담원 연결
- 음성 interruption과 mute
- 민감 정보 입력 경고
- 이관 시 같은 내용을 반복하지 않도록 context 전달

### 8.6 보안·컴플라이언스

- PII·PCI 필드 감지와 masking
- 인증 전 개인 정보·주문 정보 최소화
- tool별 step-up auth
- transcript와 audio 보존 기간
- 학습 데이터 사용 consent
- abusive content 처리
- 상담원 화면의 prompt injection 방어
- 환불·금전 action의 idempotency
- 정책 engine을 모델과 분리

### 8.7 평가

- containment rate
- first contact resolution
- human handoff rate
- incorrect action rate
- policy violation rate
- hallucination·unsupported claim rate
- CSAT
- first token·first audio latency
- interruption recovery
- conversation abandonment
- handoff context completeness

대화 전체를 replay할 수 있는 scenario가 필요하며, 한 turn 답변만 평가해서는 안 된다.

### 8.8 현재 harness에서 재사용·추가

재사용:

- web UI·accessibility·API verifier
- 일반 security 기준

추가:

- conversation state
- CRM·ticket·telephony adapter
- human handoff
- approval·step-up auth
- PII policy
- multi-turn replay eval
- realtime voice test

---

## 9. 서비스 4 — AI 대용량 데이터 대시보드

### 9.1 판정

**현재 harness와 가장 직접적으로 결합된다.** 기존 timeseries-dashboard skill은 역사 데이터, live stream, downsampling, bounded buffer, rendering budget을 이미 다룬다. 부족한 부분은 AI가 안전하게 metric을 선택하고 설명하는 semantic·query·insight 계층이다.

핵심 원칙은 **AI는 control·insight plane이고 대용량 data plane이 아니다**라는 것이다. LLM을 통해 raw event를 전달하거나 unrestricted SQL을 생성하지 않는다.

### 9.2 권장 제품 범위

- 날짜 범위와 resolution 자동 선택
- 인증된 metric·dimension 자연어 검색
- 자연어 질문을 semantic query로 변환
- chart 추천
- 이상 구간 설명
- dashboard 요약
- alert investigation
- historical snapshot + live tail
- query cost와 scan budget

### 9.3 data plane

    Event / Metrics
          |
      Stream Bus
       /      \
    Hot Store  Object Storage
       |             |
    Rollup / Materialized Views
       \             /
         Query Service
              |
     Downsample + Cache
              |
    Snapshot API + Live Stream
              |
      Worker + Chart Renderer

Grafana Live는 WebSocket 기반 PUB/SUB와 data source stream을 제공한다. 패널 query는 max data points와 일관된 resolution을 사용하며 stream은 rolling buffer를 고려한다.  
출처: [Grafana Live](https://grafana.com/docs/grafana/latest/setup-grafana/set-up-grafana-live/), [Grafana query and transform](https://grafana.com/docs/grafana/latest/visualizations/panels-visualizations/query-transform-data/)

ClickHouse와 같은 columnar analytics store를 사용할 경우 ORDER BY, 과도한 partition 방지, materialized view·projection과 summary table을 workload에 맞게 설계한다.  
출처: [ClickHouse best practices](https://clickhouse.com/blog/10-best-practice-tips)

### 9.4 AI control plane

    Natural Language Question
               |
        Intent + Metric Resolver
               |
       Governed Semantic Layer
               |
       Validated Query AST
               |
       Query Policy / Cost Gate
               |
          Query Service
               |
       Result + Provenance
               |
    Chart Spec + Insight Narrative

semantic layer는 metric, dimension, join, access policy, caching을 중앙 정의한다. AI는 raw warehouse schema가 아니라 이 계층을 질의해야 한다.  
출처: [Cube Semantic Layer](https://docs.cube.dev/docs/introduction)

### 9.5 query 안전성

- read-only service account
- raw SQL 대신 semantic query AST 우선
- table·metric·dimension allowlist
- tenant·row-level security 강제
- date range 상한
- row·scan byte·execution time 상한
- concurrency 제한
- query cancellation
- explain·cost estimate
- result size 제한
- prompt에 존재하지 않는 metric 거절

사용자 identity와 tenant filter는 모델이 생성하지 않고 query service가 강제한다.

### 9.6 렌더링과 실시간

기존 harness 원칙을 유지한다.

- initial snapshot과 live tail 분리
- sequence·timestamp 기반 merge
- bounded ring buffer
- reconnect 후 gap recovery
- viewport·pixel width 기반 downsampling
- Web Worker에서 decode·transform
- chart instance 재사용
- animation 제한
- TypedArray 고려
- stale·reconnecting·partial 상태 표시

ECharts는 dataset dimension의 float·int TypedArray 최적화와 대용량 animation threshold 조정을 지원한다.  
출처: [ECharts Dataset](https://echarts.apache.org/handbook/en/concepts/dataset/), [ECharts Animation](https://echarts.apache.org/handbook/en/how-to/animation/transition/)

### 9.7 필요한 runtime agent와 tool

- metric-discovery-agent
- analytics-query-agent
- chart-spec-agent
- anomaly-investigation-agent
- insight-agent

도구:

- list_certified_metrics
- get_metric_definition
- validate_semantic_query
- estimate_query_cost
- execute_readonly_query
- subscribe_live_series
- get_related_deployments
- create_dashboard_draft

### 9.8 평가

- metric resolution accuracy
- semantic query exact match
- tenant·row access leakage 0
- invalid metric rejection
- query budget violation 0
- chart type·axis correctness
- historical/live continuity
- anomaly explanation groundedness
- p95 query latency
- frame rate와 main-thread blocking
- scanned bytes·cache hit
- cost per analysis

### 9.9 현재 harness에서 재사용·추가

재사용:

- timeseries-dashboard skill 전체
- timeseries-architect
- realtime-data-builder
- chart-performance
- streaming-contract
- browser·performance verifier

추가:

- semantic layer
- NL-to-semantic-query
- query policy engine
- insight trace
- analytics golden dataset
- multi-tenant access tests

---

## 10. 서비스 5 — 브라우저 Agent

### 10.1 판정

**정해진 도메인과 업무에서는 개발 가능하지만 가장 위험하다.** “모든 웹사이트에서 사용자를 대신해 무엇이든 하는 agent”는 prompt injection, UI 변화, 인증, CAPTCHA, 금전·법적 행위 때문에 안정적인 production 목표로 적합하지 않다.

우선 다음과 같이 제한해야 한다.

- 허용된 도메인
- 허용된 action
- 읽기와 쓰기 분리
- 고위험 action 승인
- 격리된 browser profile
- session replay
- 명확한 성공 조건

### 10.2 실행 방식 선택

우선순위:

1. 공식 API
2. DOM·accessibility tree 기반 Playwright tool
3. browser extension 또는 deterministic selector
4. screenshot 기반 computer use fallback

OpenAI computer use 가이드는 built-in visual loop, Playwright·Selenium·MCP 기반 custom harness, code execution harness를 구분한다. 브라우저·VM을 격리하고 page content를 untrusted로 취급하며 구매·인증·파괴적 작업에는 사람 승인을 두도록 권고한다.  
출처: [OpenAI Computer use](https://developers.openai.com/api/docs/guides/tools-computer-use)

Playwright Test Agents는 planner가 Markdown test plan을 만들고 generator가 test를 생성하며 healer가 실행 실패를 복구하는 역할 분리를 제공한다. 이는 제품용 브라우저 Agent에도 planner, executor, verifier를 분리해야 한다는 좋은 참조다.  
출처: [Playwright Test Agents](https://playwright.dev/docs/test-agents)

### 10.3 아키텍처

    User Goal
       |
    Task Planner
       |
    Policy Compiler
       |
    Approval Gate
       |
    Browser Executor
     /      |       \
    DOM  Accessibility  Vision Fallback
       \     |       /
      State Extractor
            |
      Verifier / Recovery
            |
      Evidence + Replay

### 10.4 필요한 runtime agent와 tool

- browser-task-planner
- browser-policy-agent
- browser-executor
- browser-state-verifier
- browser-recovery-agent

도구:

- navigate_allowlisted_url
- inspect_accessibility_tree
- click_element
- fill_field
- upload_approved_file
- download_to_quarantine
- request_user_approval
- capture_evidence
- terminate_session

tool 이름 자체에 정책 의미를 담고 범용 arbitrary_js, shell, unrestricted_navigation은 제공하지 않는다.

### 10.5 보안

- container 또는 VM별 세션 격리
- ephemeral browser profile
- cookie·token vault
- domain·origin allowlist
- download quarantine와 malware scan
- clipboard·filesystem 제한
- page prompt injection 탐지
- 사용자 입력과 page instruction 구분
- send, submit, purchase, delete, publish 전 승인
- 승인 화면에 대상·변경·비용을 명확히 표시
- action당 idempotency와 duplicate 방지
- 화면·DOM·action trace 보존

Playwright MCP는 accessibility snapshot과 deterministic element reference를 제공하지만 security boundary가 아니라고 명시한다. allowed origin과 file access 제한만으로 완전한 격리가 되지 않으므로 별도 sandbox와 policy engine이 필요하다.  
출처: [Microsoft Playwright MCP](https://github.com/microsoft/playwright-mcp)

### 10.6 평가

- task success rate
- step efficiency
- recovery success
- unauthorized action rate 0
- domain escape rate 0
- prompt injection success rate 0
- approval bypass rate 0
- secret exposure rate 0
- duplicate side-effect rate 0
- replay completeness
- UI 변경 robustness

평가 fixture에는 악성 banner, 숨은 instruction, 유사 버튼, 지연 로딩, popup, stale element, 재로그인, network 실패를 포함해야 한다.

### 10.7 현재 harness에서 재사용·추가

재사용:

- browser-verifier의 Playwright 기반 확인 관점
- 일반 UX·integration verifier

추가:

- planner와 executor 분리
- isolated browser runtime
- action policy
- credential vault
- approval UI
- replay와 evidence
- page prompt injection eval

---

## 11. 확장 가능한 Skill 설계

### 11.1 설계 원칙

- 공통 AI workflow를 하나의 기반 skill로 둔다.
- 서비스별 skill은 특화 intake, agent routing, 완료 조건만 정의한다.
- reference 문서에는 변동이 적은 domain contract를 둔다.
- side effect가 있는 skill은 자동 model invocation을 제한한다.
- 복잡한 분석은 isolated context에서 실행한다.
- 반드시 지켜야 하는 규칙은 prompt가 아니라 hook으로 강제한다.

Claude Code 공식 기능 구분도 persistent instruction은 CLAUDE.md, on-demand workflow는 skill, 격리된 전문 작업은 subagent, 외부 데이터·행동은 MCP, 항상 실행되어야 하는 기계적 규칙은 hook에 두는 방식을 권장한다.  
출처: [Claude Code 기능 개요](https://code.claude.com/docs/en/features-overview), [Skills](https://code.claude.com/docs/en/slash-commands), [Subagents](https://code.claude.com/docs/en/sub-agents), [Hooks](https://code.claude.com/docs/en/hooks-guide)

### 11.2 공통 skill

#### ai-app-orchestrator

책임:

- AI_MODE 감지
- autonomy와 risk 분류
- 공통 AI 설계 gate
- 서비스 skill routing
- AI QA gate 통합

#### ai-runtime-setup

책임:

- apps/agent-api
- model gateway
- session과 streaming
- tool registry
- approval state
- trace와 budget

#### ai-eval

책임:

- golden·adversarial dataset
- deterministic assertion
- trace grader
- LLM grader
- threshold와 release gate

#### 서비스 skill

- ai-code-review-bot
- enterprise-search-ai
- customer-support-ai
- ai-analytics-dashboard
- browser-agent

### 11.3 mode 분류

| Mode | Trigger |
|---|---|
| AI_MODE | 생성, 추론, tool use, 자율 판단이 있음 |
| RAG_MODE | 외부 지식 검색 후 답변 |
| TOOL_AGENT_MODE | 사내·외부 시스템 tool 호출 |
| CODE_REVIEW_AGENT_MODE | SCM diff와 review comment |
| REALTIME_VOICE_MODE | 음성 streaming과 interruption |
| ANALYTICS_AGENT_MODE | metric·query·chart·insight |
| BROWSER_AGENT_MODE | browser navigation과 action |

하나의 요청에 여러 mode가 동시에 활성화될 수 있다. 예를 들어 고객센터는 RAG_MODE와 TOOL_AGENT_MODE, 음성 채널이면 REALTIME_VOICE_MODE까지 활성화한다.

### 11.4 공통 hard stop

다음 산출물이 없으면 구현 단계로 이동하지 않는다.

- ai-requirements.md
- autonomy-risk-matrix.md
- ai-architecture.md
- tool-contracts.md
- data-governance.md
- ai-threat-model.md
- eval-plan.md
- cost-latency-budget.md

---

## 12. 확장 가능한 Agent 설계

### 12.1 공통 설계 Agent

| Agent | 주요 책임 |
|---|---|
| ai-requirements-analyst | task, failure cost, autonomy, SLO |
| ai-solution-architect | runtime, workflow, provider, state |
| data-governance-architect | source, ACL, retention, deletion |
| tool-contract-designer | schema, scope, idempotency, approval |
| agent-workflow-designer | manager, handoff, state transition |
| ai-threat-modeler | injection, agency, leakage, MCP |
| ai-eval-designer | dataset, grader, threshold |

### 12.2 공통 구현 Agent

| Agent | 주요 책임 |
|---|---|
| agent-runtime-scaffolder | server runtime와 session |
| model-gateway-builder | provider adapter, routing, budget |
| tool-adapter-builder | typed domain tool |
| conversation-state-builder | state, resume, handoff |
| human-approval-builder | approval UI와 server state |
| ai-observability-builder | trace, metrics, PII filter |

### 12.3 공통 검증 Agent

| Agent | 쓰기 권한 | 주요 책임 |
|---|---:|---|
| ai-eval-runner | 없음 | dataset과 grader 실행 |
| ai-security-reviewer | 없음 | LLM·agent threat 검증 |
| cost-latency-verifier | 없음 | token·비용·latency budget |
| agent-trace-verifier | 없음 | tool·handoff·approval trace |
| data-access-verifier | 없음 | tenant·ACL·PII 경계 |

### 12.4 서비스 특화 Agent

#### 코드리뷰

- scm-integration-builder
- review-context-builder
- ai-review-engine-builder
- review-quality-verifier

#### 사내 검색

- knowledge-ingestion-builder
- retrieval-pipeline-builder
- acl-retrieval-verifier
- rag-quality-verifier

#### 고객센터

- support-conversation-builder
- support-system-adapter-builder
- human-handoff-builder
- support-quality-verifier

#### 대시보드

- semantic-layer-designer
- analytics-query-agent-builder
- query-safety-verifier
- insight-agent-builder
- 기존 timeseries-architect와 realtime-data-builder 재사용

#### 브라우저

- browser-task-planner
- browser-executor-builder
- browser-policy-gate-builder
- browser-replay-verifier

### 12.5 Agent 수 증가를 통제하는 기준

새 agent는 다음 조건을 모두 만족할 때만 추가한다.

1. 독립적인 산출물이 있다.
2. 독립적인 tool 또는 권한 경계가 있다.
3. 별도 평가 기준이 있다.
4. 기존 agent context를 오염시키지 않아야 한다.

단순히 prompt가 길다는 이유로 agent를 분리하지 않는다. 지나친 multi-agent 구조는 latency, token, handoff 오류와 debugging 비용을 늘린다.

---

## 13. Workspace 산출물과 소유권

### 13.1 신규 설계 산출물

- _workspace/01_plan/ai-requirements.md
- _workspace/01_plan/autonomy-risk-matrix.md
- _workspace/02_design/ai-architecture.md
- _workspace/02_design/tool-contracts.md
- _workspace/02_design/data-governance.md
- _workspace/02_design/ai-threat-model.md
- _workspace/02_design/eval-plan.md
- _workspace/02_design/cost-latency-budget.md

### 13.2 신규 QA 산출물

- _workspace/04_qa/qa-ai-evals.md
- _workspace/04_qa/qa-ai-security.md
- _workspace/04_qa/qa-data-access.md
- _workspace/04_qa/qa-ai-cost-latency.md
- _workspace/04_qa/qa-agent-traces.md

### 13.3 ownership 제안

| 경로 | 소유 Agent |
|---|---|
| apps/agent-api | agent-runtime-scaffolder |
| packages/model-gateway | model-gateway-builder |
| packages/ai-contracts | tool-contract-designer |
| packages/ai-evals | ai-eval-designer |
| packages/observability | ai-observability-builder |
| workers/ingestion | knowledge-ingestion-builder |
| packages/semantic-model | semantic-layer-designer |
| apps/browser-runner | browser-executor-builder |

Verifier는 source를 수정하지 않고 QA report만 쓴다.

---

## 14. Hook과 Validator 고도화

### 14.1 Prompt로만 강제하면 안 되는 규칙

hook과 validator로 강제할 항목:

- frontend env에 model provider secret 금지
- browser에서 provider API 직접 호출 금지
- tool schema 없는 function 등록 금지
- write tool에 approval·idempotency metadata 누락 금지
- analytics runtime의 raw write SQL 금지
- tenant filter가 model input에 의존하는 구조 금지
- trace에 원문 PII·secret 저장 금지
- 승인되지 않은 MCP server 사용 금지
- agent별 source ownership 위반 금지
- Markdown fence와 필수 trigger semantic 검증

### 14.2 신규 validator

#### validate-ai-harness

- AI mode별 필수 skill·agent 존재
- 공통 hard-stop 문구
- read-only verifier 설정
- tool permission manifest
- service routing reachability

#### validate-tool-contracts

- JSON schema 유효성
- timeout
- retry classification
- side-effect 여부
- idempotency
- required approval
- auth scope
- audit fields

#### validate-ai-security

- secret exposure
- unrestricted tool
- raw SQL
- cross-tenant test
- MCP allowlist
- browser origin allowlist

#### run-agent-evals

- fixture 실행
- trace capture
- deterministic assertion
- grader 실행
- threshold 비교
- 실패 report 생성

### 14.3 배포 gate

다음 중 하나라도 실패하면 배포하지 않는다.

- critical prompt injection fixture
- ACL·tenant leakage
- approval bypass
- unauthorized write
- unsupported high-impact answer
- cost·turn·tool budget 초과
- PII trace leakage
- 서비스별 critical task success threshold

---

## 15. 필수 Eval Scenario

### 15.1 공통

1. provider secret이 frontend bundle에 포함되지 않는다.
2. tool input은 schema 밖 필드를 거절한다.
3. 문서·코드·페이지의 prompt injection이 권한을 높이지 못한다.
4. max turn, max tool, timeout, cost budget을 지킨다.
5. 고위험 tool이 approval 없이 실행되지 않는다.
6. trace에서 PII와 secret이 제거된다.
7. provider timeout 시 안전하게 실패하거나 fallback한다.
8. tenant context는 model이 아니라 서버가 강제한다.

### 15.2 코드리뷰

1. 알려진 bug·security fixture 탐지
2. 정확한 line mapping
3. 해결된 finding 재생성 금지
4. duplicate comment 방지
5. 정상 코드 noise budget
6. code comment prompt injection 무시
7. 자동 approve·merge 금지

### 15.3 사내 검색

1. 접근 불가 문서 유출 0
2. citation이 실제 근거를 지지
3. 근거 부족 시 no-answer
4. 삭제 문서 검색 제외
5. 권한 변경 즉시 반영
6. indexed document injection 무시
7. 상충 문서의 날짜·version 표시

### 15.4 고객센터

1. 이관 시 transcript·summary·intent 유지
2. transaction 전 승인
3. 인증 전 개인 정보 제한
4. PII masking과 보존 정책
5. 공격적·위험 요청 처리
6. tool 실패 후 중복 환불 방지
7. 음성 interruption 후 문맥 회복

### 15.5 대시보드

1. 인증된 metric만 사용
2. tenant·row-level access 유지
3. read-only, scan·time·cost 상한
4. 날짜 범위와 resolution 정확성
5. chart axis·unit 정확성
6. snapshot과 live gap 없음
7. 존재하지 않는 metric 생성 거절

### 15.6 브라우저

1. allowlist 밖 navigation 차단
2. page prompt injection 무시
3. purchase·send·delete 전 승인
4. cookie·secret redaction
5. action replay와 evidence 완전성
6. session 격리
7. side-effect 중복 방지
8. UI 변경 후 recovery

---

## 16. 서비스별 비기능 요구사항

| 서비스 | 최우선 SLO | 가장 중요한 안전 지표 |
|---|---|---|
| 코드리뷰 | PR review 완료 시간 | critical miss, false positive |
| 문서 검색 | 검색·첫 token latency | ACL leak, unsupported claim |
| 고객센터 | 첫 응답·이관 시간 | incorrect action, PII leakage |
| 대시보드 | query p95·frame budget | tenant leak, query budget |
| 브라우저 | task completion time | unauthorized side effect |

모든 서비스에 다음 공통 budget이 필요하다.

- max input bytes
- max context tokens
- max output tokens
- max agent turns
- max tool calls
- max wall-clock time
- max request cost
- max concurrent jobs
- max result rows·files

---

## 17. 예상 개발 노력

다음은 2명의 senior full-stack, 1명의 AI·platform engineer, part-time security·data 지원을 가정한 상대 추정치다. 실제 일정은 source system, 인증, 데이터 정리, 보안 심사에 따라 크게 달라진다.

| 범위 | 대략적 노력 | 제외 항목 |
|---|---:|---|
| 공통 AI foundation | 4~6 engineer-weeks | 사내 인프라 조달 |
| 코드리뷰 MVP | 5~8 engineer-weeks | 대규모 언어별 정밀 분석 |
| 문서 검색 MVP | 8~12 engineer-weeks | source별 복잡한 ACL 정비 |
| AI 대시보드 계층 | 8~14 engineer-weeks | warehouse 재구축 |
| 고객센터 텍스트 | 10~16 engineer-weeks | 규제 인증·24x7 운영 |
| 고객센터 음성 추가 | 8~12 engineer-weeks | telephony 계약 |
| 제한형 브라우저 Agent | 12~20 engineer-weeks | 범용 웹 자동화 |

POC는 더 빠르게 만들 수 있지만, POC 시간을 production 일정으로 환산하면 안 된다. 특히 ACL, human handoff, browser sandbox, eval dataset은 UI 데모에 보이지 않지만 실제 비용의 큰 비중을 차지한다.

---

## 18. 단계별 고도화 로드맵

### Phase 0 — Harness 정합성

목표:

- requirements-analyst fence 결함 수정
- AI mode와 용어 정의
- validator에 Markdown semantic 검사 추가
- current eval을 실행형으로 전환할 기반 정의

완료 조건:

- 기존 22개 검사 유지
- AI-specific 구조 검사 추가
- 모든 필수 trigger가 code block 밖에서 검증됨

### Phase 1 — 공통 AI Foundation

목표:

- ai-app-orchestrator
- ai-runtime-setup
- ai-eval
- 공통 설계·구현·검증 agent
- server-side model gateway
- tool contract
- trace, budget, approval

완료 조건:

- sample read tool과 write tool이 end-to-end 실행
- write tool은 승인 없이 실행 불가
- trace와 비용이 기록됨
- injection·budget 공통 scenario 통과

### Phase 2 — 검색과 코드리뷰

목표:

- bounded internal use case 두 개로 foundation 검증
- 사용자 feedback과 golden dataset 수집

완료 조건:

- ACL leak 0
- code review no-auto-merge
- 서비스별 quality threshold 통과

### Phase 3 — AI 대시보드

목표:

- 기존 timeseries data plane 재사용
- semantic layer와 query policy 추가
- chart·insight agent 구축

완료 조건:

- metric·query golden set 통과
- scan·tenant gate 통과
- historical·live 성능 budget 통과

### Phase 4 — 고객센터

목표:

- agent-assist
- 저위험 자동화
- human handoff
- 이후 voice

완료 조건:

- 잘못된 transaction 0
- PII policy와 replay eval 통과
- handoff context completeness 기준 통과

### Phase 5 — 제한형 브라우저 Agent

목표:

- 1~2개 허용 도메인
- 읽기 workflow부터 시작
- 승인된 쓰기 workflow 확장

완료 조건:

- domain escape·approval bypass·secret leakage 0
- replay 가능한 task success threshold 통과

---

## 19. 주요 위험과 완화

| 위험 | 영향 | 완화 |
|---|---|---|
| 데모를 production으로 오인 | 보안·운영 사고 | 성숙도와 DoD 분리 |
| prompt injection | 데이터·권한 침해 | untrusted content, least privilege, approval |
| 과도한 multi-agent | 비용·지연·오류 | 단일 orchestrator 우선, 명확한 분리 조건 |
| ACL 사후 필터 | 문서 유출 | query-time security trimming |
| raw NL-to-SQL | 데이터·비용 사고 | semantic AST, read-only, query gate |
| 모델 단독 merge·transaction | 잘못된 상태 변경 | deterministic gate와 HITL |
| browser unrestricted tool | 계정·금전 피해 | sandbox, allowlist, policy tool |
| trace 원문 저장 | 개인정보 유출 | opt-in content, redaction, retention |
| provider lock-in | 비용·장애 | gateway와 internal contracts |
| 정적 scenario만 존재 | 품질 착시 | runner, trace assertion, grader |

---

## 20. 하지 말아야 할 구현

- VITE 환경 변수로 model API key 제공
- 하나의 거대한 system prompt에 모든 정책 포함
- 모든 요청을 최고 성능 모델로 처리
- vector similarity만으로 기업 검색 구현
- ACL을 answer 생성 후 적용
- 모델이 tenant ID 또는 user scope를 결정
- 모델 생성 SQL을 warehouse에 바로 실행
- 모델 결과로 PR 자동 승인·merge
- 고객 환불·계정 변경을 무승인 실행
- browser agent에 arbitrary shell·JS·filesystem 제공
- MCP server를 신뢰된 내부 시스템처럼 간주
- prompt·completion 원문을 무기한 trace에 저장
- 실제 실행 없이 scenario JSON 개수만 품질 지표로 사용

---

## 21. 최종 권고안

### 21.1 단기

1. 현재 harness의 Markdown semantic 결함을 수정한다.
2. AI_MODE와 공통 hard stop을 web-orchestrator에 추가한다.
3. 공통 skill 3개와 공통 agent를 먼저 추가한다.
4. frontend-only 소유 구조를 agent API·worker·package까지 확장한다.
5. hooks에 secret, tool permission, approval, raw SQL 규칙을 넣는다.
6. scenarios를 실제 실행 가능한 eval dataset과 runner로 전환한다.

### 21.2 첫 제품

사내 문서 검색 AI와 코드리뷰 봇을 첫 제품군으로 권고한다.

- 범위가 제한적이다.
- read-heavy다.
- 정답과 feedback을 만들기 쉽다.
- 공통 retrieval, tool, trace, eval 체계를 검증할 수 있다.

### 21.3 다음 제품

AI 대용량 대시보드는 현재 시계열 기반의 투자 효과가 가장 크다. semantic layer와 query safety를 추가하면 높은 품질의 bounded analytics agent를 만들 수 있다.

### 21.4 고위험 제품

고객센터 transaction과 브라우저 Agent는 공통 foundation의 승인, 정책, trace, replay, 보안 eval이 실제로 검증된 후 진행한다. 특히 브라우저 Agent는 범용성을 목표로 하지 말고 업무·도메인·action이 제한된 제품으로 정의해야 한다.

### 21.5 최종 판정

현재 harness는 “AI 웹 서비스를 잘 만드는 개발 조직”으로 확장할 잠재력이 충분하다. 하지만 지금 상태는 AI 기능을 가진 production system을 반복적으로 생산하는 harness가 아니라, 일반 웹과 시계열 프런트엔드를 잘 만드는 harness에 가깝다.

고도화의 핵심은 agent 수를 많이 늘리는 것이 아니다.

1. 공통 runtime
2. typed tool
3. data·권한 경계
4. executable eval
5. trace와 비용
6. progressive autonomy
7. deterministic hook

이 일곱 계층을 먼저 만들고, 다섯 서비스는 그 위에 vertical capability로 얹는 것이 가장 안전하고 확장 가능한 접근이다.

---

## 22. 주요 공식 참고자료

### Agent runtime·평가

- [OpenAI Agents SDK](https://openai.github.io/openai-agents-js/)
- [OpenAI Multi-agent](https://openai.github.io/openai-agents-js/guides/multi-agent/)
- [OpenAI Guardrails](https://openai.github.io/openai-agents-js/guides/guardrails/)
- [OpenAI Human-in-the-loop](https://openai.github.io/openai-agents-js/guides/human-in-the-loop/)
- [OpenAI Tracing](https://openai.github.io/openai-agents-js/guides/tracing/)
- [OpenAI Agent evals](https://developers.openai.com/api/docs/guides/agent-evals)

### 보안·프로토콜

- [OWASP LLM01 Prompt Injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)
- [OWASP LLM06 Excessive Agency](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/)
- [OWASP LLM Top 10](https://genai.owasp.org/llm-top-10/?cat=253)
- [OWASP Agentic Threats Navigator](https://genai.owasp.org/resource/owasp-gen-ai-security-project-agentic-threats-navigator/)
- [MCP Specification](https://modelcontextprotocol.io/specification/2025-03-26/index)
- [MCP Authorization](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization)

### 개발 harness

- [Claude Code 기능 개요](https://code.claude.com/docs/en/features-overview)
- [Claude Code Skills](https://code.claude.com/docs/en/slash-commands)
- [Claude Code Subagents](https://code.claude.com/docs/en/sub-agents)
- [Claude Code Hooks](https://code.claude.com/docs/en/hooks-guide)

### 서비스별

- [GitHub Copilot code review](https://docs.github.com/en/copilot/concepts/agents/code-review)
- [Azure AI Search 문서 접근 제어](https://learn.microsoft.com/en-us/azure/search/search-document-level-access-overview)
- [OpenAI Voice Agents](https://openai.github.io/openai-agents-js/guides/voice-agents/)
- [Grafana Live](https://grafana.com/docs/grafana/latest/setup-grafana/set-up-grafana-live/)
- [Cube Semantic Layer](https://docs.cube.dev/docs/introduction)
- [OpenAI Computer use](https://developers.openai.com/api/docs/guides/tools-computer-use)
- [Playwright Test Agents](https://playwright.dev/docs/test-agents)
