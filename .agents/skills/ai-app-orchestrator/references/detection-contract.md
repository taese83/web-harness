# AI Mode Detection Contract

이 문서는 `AI_MODE`와 submode의 단일 판별 기준이다. 한국어·영어 prompt, 기존 PRD, API 문서를 의미 기반으로 판별한다.

## AI_MODE

다음 중 하나면 활성화한다.

- 모델이 사용자에게 생성 답변·요약·분류·추천을 제공
- retrieval 결과를 근거로 답변
- 모델이 tool을 선택하거나 workflow를 분기
- 코드, 쿼리, chart, browser action을 모델이 제안·실행
- “AI”, “agent”, “LLM”, “RAG”, “Copilot”, “챗봇”, “자동화”가 핵심 기능

단순 deterministic 검색, 규칙 기반 필터, 일반 WebSocket, 고정 chart만 있으면 활성화하지 않는다.

## Submodes

### RAG_MODE

“사내 문서”, “문서 검색”, “knowledge”, “semantic search”, “vector”, “RAG”, “근거”, “citation”이 핵심이면 활성화한다.

### TOOL_AGENT_MODE

모델이 CRM, SCM, ticket, database, API, MCP 또는 사내 시스템을 호출하거나 상태 변경을 제안하면 활성화한다.

### CODE_REVIEW_AGENT_MODE

“AI 코드리뷰”, “PR review bot”, “pull request comment”, “GitHub/GitLab review”가 핵심이면 활성화한다.

### REALTIME_VOICE_MODE

“음성 상담”, “voice agent”, “전화”, “WebRTC”, “SIP”, “실시간 음성”, “interrupt”가 핵심이면 활성화한다.

### ANALYTICS_AGENT_MODE

“자연어 지표”, “AI 대시보드”, “NL query”, “metric 설명”, “이상 탐지”, “chart 추천”이 핵심이면 활성화한다. 일반 시계열 chart만 있으면 `TIMESERIES_MODE`만 사용한다.

### BROWSER_AGENT_MODE

“브라우저 agent”, “웹사이트 대신 조작”, “click/fill/submit”, “computer use”, “Playwright agent”가 핵심이면 활성화한다. read-only browser QA는 제외한다.

## 조합 예

| 요청 | Modes |
|---|---|
| 사내 문서 답변 | AI_MODE, RAG_MODE |
| 환불 가능한 고객센터 | AI_MODE, RAG_MODE, TOOL_AGENT_MODE |
| 음성 고객센터 | 위 modes + REALTIME_VOICE_MODE |
| Grafana형 AI 분석 | AI_MODE, TOOL_AGENT_MODE, ANALYTICS_AGENT_MODE, TIMESERIES_MODE |
| Playwright 회귀 QA | AI_MODE 아님 |
| 사용자를 대신해 구매 | AI_MODE, TOOL_AGENT_MODE, BROWSER_AGENT_MODE |

## 판별 출력

`_workspace/01_plan/ai-requirements.md` 최상단에 다음을 기록한다.

    AI_MODE: true | false
    SUBMODES: [...]
    AUTONOMY_LEVEL: L0 | L1 | L2 | L3 | L4
    HIGH_IMPACT_ACTIONS: [...]
    BLOCKERS: [...]
