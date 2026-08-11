# Phase Approval Checkpoints

## Phase 1 → Phase 2

Phase 1이 끝나면 다음 내용을 사용자에게 보여주고 명시적으로 확인한다.

- 서비스명과 사용자 목표
- 대상 화면/기능, 현재 pain, 관찰 가능한 성공 조건
- **Feature List 다듬기**: `feature-plan.md`의 Feature List 표(FEAT ID·가치·우선순위·화면 매핑)를 그대로 보여주고 항목별 `keep | cut | defer`를 확인한다 — 최대 2라운드, 라운드마다 변경된 행만 재표시, 결정은 decision-log에 `PC-NNN` 엔트리로 기록 (`design-readiness-contract.md`, `plan-history-contract.md`)
- ux-brief의 디자인 방향 요약과 `ASSUMPTION(프리뷰 A/B)` 항목 (프리뷰 루프에서 확정 예정임을 안내)
- 자동 `UX Check`, critical state, 정규화한 주석과 Phase 2 확인 항목
- `mock | dev-read-only | real-read-only | production-integration-later` 데이터 전략과 Mock→real 조건
- `S | M | L | XL` 상대 노력도, driver, `invest | reduce | split`, 가장 작은 가시적 검토 단위
- `WEB_PROFILE`, 주요 라이브러리, provider/runtime target
- 미해결 `ASSUMPTION`, `NEEDS_DECISION`, `BLOCKED`
- `plan-review.md`의 `PASS | NEEDS_DECISION | BLOCKED`와 최대 3개의 우선 결정사항

수정 요청이 있으면 해당 planning wave만 다시 실행한 후 체크포인트를 반복한다. 확인 전에는 Phase 2를 시작하지 않는다.

## Phase 2 → Phase 3

Phase 2가 끝나면 다음 내용을 사용자에게 보여주고 명시적으로 확인한다.

- 화면·route 목록과 핵심 정보 구조
- shared/feature component 목록과 기존 디자인 재사용 범위
- API endpoint, Mock/OpenAPI adoption, 상태 및 오류 계약
- 색상·타이포그래피·responsive/layout-stability 기준
- `DESIGN_PROTOTYPE_MODE`와 prototype/screenshot이 있으면 시각 자료
- Design Preview Loop 결과: 프리뷰 URL(또는 스크린샷), FEAT/TC 배지·side panel 추적성, A/B 확정 내역, `validate-design-preview.mjs`의 `APPROVED` 상태, `design-review.md`의 source/preview/traceability 승인 해시, 미결 `NEEDS_DECISION` (`design-approval-contract.md`) — 프리뷰는 실렌더링 근사치라는 한계 문구 포함
- `VISUAL_QA_MODE`이면 target/state/mode matrix, reference mapping, threshold와 baseline 승인자
- 새 `ASSUMPTION`, `NEEDS_DECISION`, `BLOCKED`
- `design-review.md`가 있으면 최대 3개의 우선 결정사항

수정 요청이 있으면 해당 design wave만 다시 실행한 후 체크포인트를 반복한다. 확인 전에는 Phase 3 source edit를 시작하지 않는다.

## 질문 규칙

한 번에 최대 3개만 질문한다. 구조를 바꾸지 않는 세부 선호는 제안값과 근거를 함께 제시하고 승인 항목에 포함한다.
