# AI Analytics Implementation Contract

`analytics-contract.md`의 control plane·query guard를 전제로, NL 계층의 구현 결정과 소유 경계를 고정한다.

## `analytics-chart-builder`와의 경계 (역방향 명시)

- **analytics-chart-builder 계열 소유**: semantic layer(metric/dimension catalog), query AST 스키마, chart compatibility registry, dashboard config·revision. 이 스킬이 재정의하지 않는다.
- **이 스킬이 추가하는 것**: ① 자연어 → 후보 AST 변환 ② 결과에 대한 grounded insight 서술 ③ metric 탐색 대화 UX. AST 검증·실행·차트 렌더링은 기존 analytics 파이프라인을 그대로 통과한다.
- 같은 프로젝트에 둘 다 활성이면 NL 계층은 `packages/analytics-agent/`, 결정론 계층은 기존 소유 경로 — 파일 중복 구현은 FAIL.

## NL → AST 품질 측정

- **golden 질의쌍**을 서비스 도입 전에 구축한다: (자연어 질의, 기대 AST, 기대 결과 스키마) 최소 30쌍 — 한국어 질의 포함.
- 판정은 2단: ① AST 정규화 후 exact match ② mismatch면 실행 결과 동치(같은 데이터 반환) 검사. 결과 동치도 아니면 FAIL.
- 회귀: prompt/모델 버전 변경 시 golden 전체 재실행이 release 조건.

## 모호성 처리 UX

- 후보 AST가 2개 이상이고 결과가 달라지는 모호성이면 **임의 선택 금지** — 차이를 자연어로 요약해 사용자에게 선택시킨다 (예: "최근 30일 기준일까요, 이번 달 기준일까요?").
- 선택 이력은 세션 컨텍스트에 남겨 같은 세션 내 동일 모호성을 재질문하지 않는다.
- 해석 불능 질의는 "가장 가까운 certified metric 3개" 제안으로 응답한다 — 존재하지 않는 metric 창작 금지(기존 hard stop).

## Certified Metric Catalog 거버넌스

- 등록 절차: 정의·수식·단위·집계 grain·소유자·검증 쿼리를 갖춰 **사람 승인**으로만 catalog에 진입한다.
- 모델은 미등록 metric을 **제안 초안**으로만 생성할 수 있고(승인 대기 상태), 제안이 질의 실행에 사용되면 FAIL.
- catalog 변경은 버전 태그를 갖고, insight가 참조한 catalog 버전이 기록된다.

## Insight Provenance

- 서술의 모든 수치·비교·추세 주장에는 실행된 query 결과 참조 ID가 붙는다 — 참조 없는 수치는 렌더링 전에 거부한다.
- "왜"에 대한 인과 설명은 데이터가 지지하는 상관까지만 — 인과 단정 문구는 금지 목록으로 관리한다.

## 평가 추가 항목

- golden 질의쌍 AST exact match율 / 결과 동치율 (한국어·영어 분리)
- 모호성 감지 정확도 (임의 해석으로 넘어간 비율 0 목표)
- 미등록 metric 제안이 실행에 흘러든 사례 0
