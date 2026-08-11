# Plan History Contract

기획 이력 관리의 단일 계약. 원칙: **기획 문서는 항상 '현재'만 말한다. 역사는 append-only 대장이 말한다.**

- 이력을 문서 본문에 쌓지 않는다 — 기획·설계 문서는 하류 5~13개 agent가 반복해서 읽는 입력이라 죽은 역사가 섞이면 sharding 예산과 판단 품질을 해친다.
- git은 byte 수준 이력, 이 대장은 의미 수준 이력(왜/누가 승인/무엇→무엇)을 담당한다.

## 1. 변경 대장 — `_workspace/01_plan/decision-log.md`

append-only. 기존 엔트리의 수정·삭제는 금지이며, 정정도 새 엔트리로 한다.

```markdown
## PC-014 (2026-08-10) — 주문 상세에 배송지 변경 추가
- 트리거: 기능 변경 (/feature-add)
- 대상: FEAT-007, 화면 order-detail
- 변경: 배송지 읽기 전용 → 결제완료 상태에서만 수정 가능 (확인 dialog)
- 근거·승인: 사용자 승인 (Phase 1 체크포인트, 2026-08-10)
- 영향 산출물: feature-plan.md(FEAT-007), requirements.md §3.2, api-schema.md
```

- `PC-NNN`은 순차 증가, 재사용 금지.
- 트리거 분류: `신규 요구 | 기능 변경 | 다듬기 라운드(keep/cut/defer) | 프리뷰 피드백 | QA 발견 | 방향 결정`
- **기록 기준선**: 요구·기능·화면 구조·우선순위·데이터 계약이 바뀔 때만 기록한다. 오탈자·문구 다듬기·형식 정리는 기록하지 않는다 (대장 인플레이션 방지).

## 2. Write-back 계약 (기획 문서 부패 방지)

기능이 추가·변경·제거되면 — `/feature-add`, 프리뷰 루프의 기획 레벨 변경, 다듬기 라운드 포함 — 확정 시점에 다음 세 가지가 한 세트로 일어난다:

1. `feature-plan.md`의 Feature List 표 현재화 (행 추가/수정, cut은 표기 변경)
2. `requirements.md` 해당 절 갱신
3. `decision-log.md`에 엔트리 append

- 갱신 주체는 main thread가 아니라 **기존 owner agent의 경량 재호출**이다: `requirements-analyst`(requirements.md), `feature-planner`(feature-plan.md), `planning-facilitator`(decision-log.md). 경량 재호출은 전체 재작성이 아니라 대상 절/행만 수정한다.
3. 세 가지 중 하나라도 빠지면 그 변경은 미기록 변경이며 code-reviewer/plan-reviewer의 검사 대상이다.

## 3. 안정 ID 규율

- `REQ-NNN`(requirements.md), `FEAT-NNN`(feature-plan.md), 선택적 `FEAT-NNN-NN` 하위 기능 — 생성 후 불변, 이름 변경에도 ID 유지, 삭제 대신 상태 표기.
- 하위 기능 순번은 parent 안에서 append-only이며 삭제·병합 뒤에도 재사용하지 않는다. parent 변경은 parent ID를, 특정 행동 변경은 가장 좁은 하위 ID를 decision-log 대상으로 쓴다.
- 대장 엔트리·Traceability 표·change-scope.md는 ID로 대상을 지칭한다 — "주문 화면 그거"가 아니라 `FEAT-007`.
- ID 사슬: REQ → FEAT → 선택적 Sub Feature → 화면/anchor → slice → test evidence → PC 엔트리. 이 사슬로 "이 기능이 언제 왜 이렇게 됐는가"를 추적한다.

## 4. 검사 (reviewer 단계 — 위반 반복 시 hook 승격 후보)

- `plan-reviewer`: Phase 1 재실행·다듬기 라운드 후 — 변경된 기획 문서 대비 대장 엔트리 존재 여부, 고아 REQ/FEAT ID.
- `code-reviewer`: `CHANGE_MODE: existing-change`에서 기획 문서 diff가 있는데 대응 PC 엔트리가 없으면 WARN, **기존 PC 엔트리가 수정·삭제됐으면 FAIL** (append-only 위반).
- HANDOFF/release-readiness는 이번 릴리스에 포함된 PC 엔트리 범위를 인용한다.
