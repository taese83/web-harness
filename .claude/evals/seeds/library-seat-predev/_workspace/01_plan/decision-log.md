# Decision Log — 도서관 열람실 좌석 예약 웹앱

append-only. 기존 엔트리는 수정·삭제하지 않으며, 정정도 새 엔트리로 남긴다.

## PC-001 (2026-09-25) — 초기 기획 생성 (비대화 세션)
- 트리거: 신규 요구 (`/wh plan`, 비대화 세션 — 사용자 질의 불가)
- 대상: requirements.md 전체, ux-brief.md 전체
- 변경: 없음(신규) → Product Frame, Modes, REQ-F-001~005, NFR-001~004, Data Review Strategy, Effort Trade-off, Open Decisions 최초 작성
- 근거·승인: 사용자 요청 원문 1건이 유일한 source(generated, 첨부 문서 없음). 비대화 세션이라 사용자 승인 절차 없이 미결 항목은 ASSUMPTION/NEEDS_DECISION/BLOCKER로 명시 기록.
- 영향 산출물: requirements.md, ux-brief.md

## PC-002 (2026-09-25) — 모드 판정: EXTERNAL_DATA_INGESTION_MODE = false
- 트리거: 신규 요구 (모드 감지)
- 대상: requirements.md `## Modes`
- 변경: (판정 없음) → false, 근거 기록. 앱이 도서관 REST API를 매 요청 실시간 조회/호출만 하고 별도 수집·정규화·승격 파이프라인이 없어 `external-data-ingestion.md` 감지 조건 미해당.
- 근거·승인: `external-data-ingestion.md` "브라우저가 일반적인 내부 API를 조회만 하고 별도 수집·정규화·승격 단계가 없으면 이 모드를 켜지 않는다" 문구 직접 적용.
- 영향 산출물: requirements.md `## Modes`

## PC-003 (2026-09-25) — 모드 판정: LOCAL_DOMAIN_STATE_MODE = false
- 트리거: 신규 요구 (모드 감지)
- 대상: requirements.md `## Modes`
- 변경: (판정 없음) → false, 근거 기록. 좌석·예약 데이터의 authoritative store는 도서관 API이고, 앱은 CRUD 도메인 데이터를 브라우저에 영속하지 않으며 정렬·다중선택·undo·참조관계 같은 로컬 상태 불변식이 없음.
- 근거·승인: `local-domain-state.md` Detection 조건 대조.
- 영향 산출물: requirements.md `## Modes`

## PC-004 (2026-09-25) — API 계약 부재를 BLOCKER(production 연결)로 분류, Phase 1~2는 mock으로 진행
- 트리거: 신규 요구 (데이터 전략 결정)
- 대상: requirements.md `## Data Review Strategy`, `## Open Decisions`
- 변경: (미정) → strategy `mock`(Phase 1~2) + `production-integration-later`로 분리. OpenAPI 부재, 인증 토큰 방식(세션 쿠키 vs Bearer), CORS, 409 충돌 스펙, 노쇼 정책 소유권을 BLOCKER 3건으로 명시.
- 근거·승인: `planning-readiness-contract.md`의 데이터 검토 전략 표 — "API가 없거나 불안정하고 UX·상태 검토가 목적"이면 mock, "현재는 계약만 있고 연결은 후속 단계"면 production-integration-later. 이 프로젝트는 API가 존재하나 계약 문서가 제공되지 않아 두 전략을 단계별로 결합. 기획·디자인은 mock으로 진행 가능하나 Phase 4 개발 착수 전 계약 확보가 필수라는 사용자 지시(작업 지시문 "주의할 점")를 근거로 BLOCKER 소재를 "production 연결"로 한정.
- 영향 산출물: requirements.md `## Data Review Strategy`, `## Open Decisions`

## PC-005 (2026-09-25) — 예약 취소는 confirm dialog로 확정(즉시 실행+undo 대신)
- 트리거: 방향 결정
- 대상: REQ-F-004, ux-brief.md Key Interaction Patterns
- 변경: (미정) → confirm dialog 채택
- 근거·승인: `design-principles-interaction-controls.md`는 되돌릴 수 있는 액션에 undo를 권장하지만, 이 도메인은 취소 즉시 좌석이 다른 회원에게 재선점될 수 있어(헛걸음이 많다는 pain이 곧 높은 수요 신호) undo 재실행이 항상 성공한다고 보장할 수 없다. ASSUMPTION으로 기록하고 Phase 2 프로토타입에서 사용성 검증 예정.
- 영향 산출물: requirements.md REQ-F-004, ux-brief.md Key Interaction Patterns

## PC-006 (2026-09-25) — 성공 조건 "1분" 측정 구간 정의
- 트리거: 방향 결정
- 대상: requirements.md Product Frame, REQ-NFR-001, Open Decisions
- 변경: (미정) → 측정 시작점 = 좌석 현황 화면 진입(로그인 완료 후), 종료점 = 예약 확정 피드백 표시 시점
- 근거·승인: 로그인 소요시간은 회원별 편차(비밀번호 재설정 등)가 크고 앱이 통제할 수 없는 변수라 핵심 성공 지표에서 분리. ASSUMPTION으로 기록, 검증 방법은 Phase 2 task timing.
- 영향 산출물: requirements.md Product Frame, REQ-NFR-001, Open Decisions

## PC-007 (2026-09-25) — Phase 1 승인: 정책 결정 3건 확정
- 트리거: 사용자 결정 (Phase 1 → 2 체크포인트, plan-review NEEDS_DECISION 3건)
- 대상: requirements.md Open Decisions(REQ-F-002·REQ-F-003)
- 변경: NEEDS_DECISION 3건 → 결정. 동시 활성 예약 2건·1일 4건 / 연속 슬롯 불허(30분 한 칸) / 운영시간 09:00~22:00, 마지막 칸 예약 가능
- 근거·승인: 사용자가 체크포인트에서 답했다. API 계약·409 스펙·노쇼 정책 BLOCKER는 production 연결 전까지 유지하고 Phase 2는 mock으로 진행한다(PC-004).
- 영향 산출물: requirements.md(기능 단위·TC 무변경 — 한도 안내는 FEAT-005의 기존 확정 흐름 안)

## PC-008 (2026-09-25) — Phase 1 승인: plan-review D1·D3 처분과 API 계약 부재 시 착수 방식
- 트리거: 사용자 결정 (Phase 1 → 2 체크포인트, plan-review 우선 결정 D1·D3 — D2는 PC-007로 처분)
- 대상: requirements.md Open Decisions(API 계약 BLOCKER 문구), tech-stack.md AD-02 재방문 시점
- 변경: D1 → 수동 새로고침 버튼과 마지막 갱신 시각은 FEAT-004 화면 요소로 둔다(요구사항 AC는 그대로, 자동 폴링 FEAT-008은 defer). D3 → 동시성·취소 문구 세부는 개발 착수 전 API 계약과 함께 정한다. 권한 축은 회원/비회원 구분뿐이라 조건 표에 `권한` 열이 없는 것이 정상이다. API 계약 부재 → production 연결 전 확보 대상이다. 개발은 잠정 계약(MSW)으로 착수할 수 있고, 착수 여부는 개발 착수 전 사용자 결정이다.
- 근거·승인: 사용자가 체크포인트에서 답했다. PC-004의 「개발 착수 전 계약 필수」 서술은 이 엔트리가 대체한다(append-only — PC-004는 그대로 둔다).
- 영향 산출물: requirements.md, tech-stack.md

