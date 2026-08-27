# Plan History Contract

기획 이력 관리의 단일 계약. 원칙: **기획 문서는 항상 '현재'만 말한다. 역사는 append-only 대장이 말한다.**

- 이력을 문서 본문에 쌓지 않는다 — 기획·설계 문서는 하류 5~13개 소비 스폰이 반복해서 읽는 입력이라(2026-08-26 통합 **전** 에이전트 기준 실측 — 통합 후 재측정 전) 죽은 역사가 섞이면 sharding 예산과 판단 품질을 해친다.
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

### 2-1. 경량 재호출의 기계 검증 (OpenSpec delta 착안)

"경량 재호출"은 지금까지 **지시**였을 뿐 검증되지 않았다. 실측 실패(protected-core §4): apply가
기존 plan을 전체 재작성해 **승인된 TC를 파괴**했는데 사후 존재 검사로는 잡히지 않았다.
그래서 변경을 **선언과 대조**한다 — OpenSpec의 ADDED/MODIFIED/REMOVED를 이 하네스의 안정 ID
규율에 맞춘 형태다.

```bash
# 변경 전: 안정 ID 인벤토리를 기계가 뜬다
node .claude/scripts/validate-plan-delta.mjs --project {root} --change PC-014 --snapshot
# → _workspace/01_plan/plan-delta/PC-014.json 의 declared에 added/modified/removed를 적는다
# 변경 적용 후: 실제 변화와 선언을 대조한다
node .claude/scripts/validate-plan-delta.mjs --project {root} --change PC-014 --verify
```

- `UNDECLARED_REMOVAL` — 선언하지 않았는데 ID가 사라졌다. **승인 산출물이 조용히 파괴된 것**이다.
- `UNDECLARED_ADDITION` — 선언하지 않은 ID가 생겼다. 범위 밖 확장 신호.
- `DECLARED_BUT_PRESENT` / `DECLARED_BUT_ABSENT` — 선언과 결과의 불일치.

**`modified` 선언은 소멸을 정당화하지 않는다** — 재작성으로 하위 TC가 없어지면 modified로
덮어도 UNDECLARED_REMOVAL이 뜬다. 이것이 이 게이트의 핵심이다.

- `LATE_SNAPSHOT` — 승인 레코드에 있는 TC가 before에 없다. **사고를 낸 뒤에 스냅샷을 떠서
  before를 오염시킨 것**이다. 승인 레코드(`_workspace/03_dev/change-request-decisions/`)는
  다른 메커니즘이 다른 시점에 남긴 독립 기록이라, 이 순서 우회의 바닥값이 된다.

before 인벤토리는 스캔 결과이지 자기선언이 아니다. 다만 **선언 자체가 옳은지**(이 변경이
정말 그 ID들만 건드려야 하는지)는 사람 몫이다 — 게이트가 잡는 것은 선언과 실제의 불일치다.

- `NO_STABLE_IDS` — 계획 산출물은 있는데 안정 ID가 0개다. 이 게이트는 ID의 **소멸**을 보므로
  ID가 없으면 볼 것이 없다 — **통과가 아니라 미적용**이다. ID 규율을 쓰지 않는 형태(예:
  라이브러리 프로젝트의 api-design.md)가 맞다면 `--allow-no-ids`로 명시한다(자기진술).

**막지 못하는 것(정확히)**: delta 파일을 지우고 다시 스냅샷하면 초기화된다. 승인 레코드가
없는 변경에는 `LATE_SNAPSHOT` 바닥값도 없다. ID가 유지된 채 **내용만** 파괴되는 경우도
잡히지 않는다 — 로컬 증거는 tamper-evident이지 tamper-proof가 아니다.

## 3. 안정 ID 규율

- `REQ-NNN`(requirements.md), `FEAT-NNN`(feature-plan.md), 선택적 `FEAT-NNN-NN` 하위 기능 — 생성 후 불변, 이름 변경에도 ID 유지, 삭제 대신 상태 표기.
- 하위 기능 순번은 parent 안에서 append-only이며 삭제·병합 뒤에도 재사용하지 않는다. parent 변경은 parent ID를, 특정 행동 변경은 가장 좁은 하위 ID를 decision-log 대상으로 쓴다.
- 대장 엔트리·Traceability 표·change-scope.md는 ID로 대상을 지칭한다 — "주문 화면 그거"가 아니라 `FEAT-007`.
- ID 사슬: REQ → FEAT → 선택적 Sub Feature → 화면/anchor → slice → test evidence → PC 엔트리. 이 사슬로 "이 기능이 언제 왜 이렇게 됐는가"를 추적한다.

## 4. 검사 (reviewer 단계 — 위반 반복 시 hook 승격 후보)

- `plan-reviewer`: Phase 1 재실행·다듬기 라운드 후 — 변경된 기획 문서 대비 대장 엔트리 존재 여부, 고아 REQ/FEAT ID.
- `code-reviewer`: `CHANGE_MODE: existing-change`에서 기획 문서 diff가 있는데 대응 PC 엔트리가 없으면 WARN, **기존 PC 엔트리가 수정·삭제됐으면 FAIL** (append-only 위반).
- HANDOFF/release-readiness는 이번 릴리스에 포함된 PC 엔트리 범위를 인용한다.

## 일반화 근거

이 계약의 §2-1(delta 대조)은 안정 ID 규율(§3)에만 의존하고 특정 서비스의 이름·백엔드·수치를
인코딩하지 않는다. 다만 **실증 범위는 정직하게 좁다**:

- 예약형 SPA (실증 — seminar-booking: 안정 ID 108개 기준선에서 TC 3건 소멸을 `UNDECLARED_REMOVAL`로
  검출, 순서 우회를 `LATE_SNAPSHOT`으로, 증거 인멸을 `RESNAPSHOT`으로 차단)
- 그 외 서비스 형태 (**명명 수준 — 미검증**). ID 규율을 쓰는 어떤 형태에도 적용 가능하다고
  보지만, 두 번째 형태에서 실증하기 전까지 이 계약은 "1개 형태 실측"으로 취급한다.

I3 기준(서로 다른 형태 2개+)은 **아직 충족되지 않았다.** 다음 브라운필드/타 형태 프로젝트에서
재실증하고, 어긋나는 규칙은 write-back한다.

**미충족이 실제로 무엇을 놓쳤는지(2026-08-12 실측).** 두 번째 형태를 가정만 해봐도 구멍이
나왔다 — ID 규율을 쓰지 않는 라이브러리형 계획(`api-design.md`)에서는 안정 ID가 0개라
**계획 문서를 통째로 비워도 `PASS ✅`**가 났다. 예약형 SPA 하나만 보고 만들어서 보이지 않던
vacuous PASS다. `NO_STABLE_IDS` 가드로 닫았지만, 이 사례 자체가 I3의 존재 이유다 — "형태 2개+"는
절차적 요식이 아니라 **가정이 깨지는 지점을 찾으라**는 요구다.
