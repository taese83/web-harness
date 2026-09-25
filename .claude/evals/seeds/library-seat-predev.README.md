# seed: library-seat-predev — 출처와 편집 기록

기획·디자인(프리뷰 승인 포함)까지 끝난 그린필드 앱이다. `predev-stops-at-api-decision` 사례가 착수 전 구간(⓪ API 계약 →
① 구현 설계 → ② 스팩 확정)을 진행 중인 프로젝트에서 재도록 fixture에 복사된다. 이 기록은 시드 폴더 **밖**에 둔다 — 안에 두면
평가 작업 공간에 복사돼 모델이 「평가용 기록」이라는 서술을 읽고 행동이 흔들린다.

- `_workspace/01_plan/`: 0.47.0 plan 레인 1회차 트레이스의 Write를 그대로 재생했다. Phase 1 승인을 입히려고 다음을 더했다 —
  plan-review NEEDS_DECISION의 정책 3건을 PC-007 결정으로, D1·D3와 「API 명세가 없으면 잠정 계약(MSW)으로 착수할 수 있다」를
  PC-008로 기록했다(PC-004는 append-only라 그대로 둔다). PC-005 인용, 분할 예산에 맞춘 축약(feature-plan의 미결 항목 절 삭제·
  근거 문단 축약, tech-stack H2 2개 → H3), 평가 환경 결함 흔적(exit 127) 삭제, 「Phase 4(개발)」 → 개발 단계 표기.
- `_workspace/02_design/`: design-system·layout-spec·component-spec·design-review와 프리뷰는 손으로 썼다. 프리뷰 승인 레코드는
  하네스의 `validate-design-preview.mjs --write-source-snapshot` → `--record-approval`로 기록한 **fixture**다(승인 문구에
  「평가 시드」 표기) — 실제 사용자 승인이 아니며 어떤 보고에서도 증거로 인용하지 않는다.
- 상태(커밋 시점 실측): `--to design` READY · `--to development`의 HOLE은 `design-decisions`·`spec` 둘뿐 · 분할 계약 만족 ·
  모션 역할 PASS · 프리뷰 APPROVED.
- 시드 문서를 고치면 프리뷰 source digest가 바뀐다 — 승인 레코드를 지우고 위 두 명령으로 다시 기록한 뒤 상태를 다시 잰다.
  receipt가 시드 digest로 판본을 묶으므로 측정 뒤의 수정은 전후 비교를 끊는다.
