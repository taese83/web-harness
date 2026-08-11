# Progressive Interaction Contract

대규모 요청을 한 번의 설문으로 바꾸지 않는다. 구현 결과를 바꾸는 결정만 사용자에게 묻고, 안전한 기본값은 `ASSUMPTION`, 보안·데이터 손실·외부 계약 부재는 `BLOCKER`로 기록한다.

## 질문 규칙

- 한 번에 최대 3개 질문만 제시한다.
- 질문은 제품 목적 → 데이터/계약 → 규모/SLO → 편집/운영 순서로 진행한다.
- 선택지는 추천안을 첫 번째로 두고 각 선택의 결과와 trade-off를 한 문장으로 설명한다.
- 이미 source artifact나 기존 코드에서 확인 가능한 내용은 다시 묻지 않는다.
- 답을 모르는 사용자를 위해 측정 가능한 baseline을 제안하되 확정값처럼 표현하지 않는다.
- 같은 질문을 표현만 바꿔 반복하지 않는다. 답변은 `_workspace/01_plan/decision-log.md`에 결정·가정·검증 방법으로 갱신한다.

## 질문이 필요한 경우

- 화면, 데이터 모델, 공개 계약, 권한, 저장 범위가 선택에 따라 달라진다.
- 조회 범위와 집계 resolution처럼 두 해석이 모두 가능하다.
- 실제 API/stream의 인증·cursor·resume 지원 여부가 architecture를 바꾼다.
- 기존 프로젝트의 public contract 또는 여러 owner 경로를 바꿔야 한다.

## 질문 없이 ASSUMPTION으로 진행 가능한 경우

- 색상·간격 등 Phase 2에서 쉽게 검토 가능한 시각 기본값 — **greenfield(신규 화면)에 한함.**
  기존 화면 수정(existing-change)에서 요청에 없는 외형·동작 변경은 ASSUMPTION 대상이 아니다
  (`minimal-change-contract.md`의 baseline 보존 규칙을 따른다)
- mock fixture의 구체적인 이름과 값
- 요구사항에 위배되지 않는 로컬 개발 기본값

## 단계형 Intake

1. **제품 맥락** — 대상 화면/기능, 사용자, 끝내려는 업무, 현재 pain, 관찰 가능한 성공 조건. API·branch·파일·라이브러리는 아직 묻지 않는다
2. **디자인 방향** — 브랜드 제약(색/로고/폰트), 참조 무드, 밀도/다크모드/주 사용 기기 (`../../web-plan/references/design-readiness-contract.md`). 모르면 재질문하지 않고 `ASSUMPTION(프리뷰 A/B)` — 프리뷰 루프의 시안 비교로 확정한다
3. **데이터** — source, historical/realtime, 기존 API/OpenAPI, 저장 여부
4. **규모** — normal/max/burst, latency, visible data, 지원 환경
5. **편집/운영** — 공유·권한·버전·복구·배포

각 단계의 미결 항목이 다음 단계의 구조를 바꾸지 않으면 ASSUMPTION으로 넘길 수 있다. 구조를 바꾸면 다음 Phase 전에 확인한다.

첫 단계와 UX 피드백 처리는 `../../web-plan/references/planning-facilitation-contract.md`를 따른다. `planning-facilitator`가 답변과 source 근거를 `planning-context.md`, 변경 결정을 `decision-log.md`에 기록한다.
