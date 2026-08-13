# Design Readiness Contract

디자인 단계가 기획에게 요구하는 입력의 단일 명세다. 기획 agent(ux-researcher, feature-planner, planning-facilitator)는 이 형식으로 산출하고, 디자인 agent(design-system-architect, layout-designer, component-designer)는 이 절이 없으면 추론으로 채우지 않고 `BLOCKER`로 보고한다.

원칙: **디자인 품질은 기획 문서의 디자인 소비 가능성에 상한이 걸린다.** 화면 목록만으로는 레이아웃을 정할 수 없고, 정보 위계 없이는 시각 위계를 정할 수 없다.

## 1. 화면별 정보 위계 (ux-brief 필수 절)

화면 인벤토리의 각 화면에 대해 작성한다:

```markdown
## 화면별 정보 위계
| 화면 | Primary 정보 (1~3개, 순서 = 중요도) | Secondary | 밀도 | empty 시 내용 | error 시 내용 | 권한 없음 시 |
|---|---|---|---|---|---|---|
| dashboard | ① 금일 오류율 ② 응답시간 추이 | 서비스별 분포, 최근 배포 | 고밀도 | 온보딩 안내 + 데이터 연결 CTA | 마지막 정상 데이터 + 재시도 | 접근 요청 안내 |
```

- Primary는 "사용자가 이 화면에서 3초 안에 얻어야 하는 것" — 3개 초과면 화면 분할을 검토한다.
- 상태별 내용은 컴포넌트가 아니라 **사용자에게 보여줄 내용**으로 쓴다 ("EmptyState 컴포넌트" ✗, "아직 데이터가 없다는 안내와 첫 연결 버튼" ✓).

## 2. 디자인 방향 (ux-brief 필수 절)

인테이크에서 수집하고, 모르는 항목은 값을 지어내지 않고 `ASSUMPTION(프리뷰 A/B)`로 표기한다 — 프리뷰 루프 1라운드에서 시안 비교로 확정된다.

```markdown
## 디자인 방향
- 브랜드 제약: (색/로고/폰트 지정 여부, 없으면 "없음")
- 참조 무드: (참조 서비스/화면과 "어떤 점"이 좋은지)
- 밀도: 고밀도(대시보드형) | 표준 | 여백 중심 — 미정이면 ASSUMPTION(프리뷰 A/B)
- 다크모드: 필수 | 선택 | 불필요
- 주 사용 기기: (데스크탑/모바일 비율 또는 주 환경)
- 용어·문구 톤: (도메인 용어 사전 위치, 존댓말/간결체 등)
```

## 3. Page Groups와 Feature List 표준 표 (feature-plan 필수 절)

페이지 수가 1개 이상이면 먼저 페이지 대분류를 안정 ID로 선언한다. `PAGE-000`은 단일 페이지에 귀속되지 않는 전역/공통 책임에만 예약하고, 실제 페이지는 `PAGE-001`부터 생성한다.

```markdown
## Page Groups
| Page Group ID | Page | Route/Screen | Order |
|---|---|---|---|
| PAGE-001 | Order List | order-list | 1 |
| PAGE-002 | Order Detail | order-detail | 2 |
| PAGE-000 | Common | all | 99 |
```

- `PAGE-NNN`은 생성 후 불변인 기획·Console 탐색 ID다. 페이지명이 바뀌어도 ID를 유지하고 route/screen과 label만 현재화한다.
- `순서`는 사용자가 페이지를 탐색하는 정보 구조 순서의 1 이상 정수다. 같은 값이나 누락은 `plan-reviewer`의 `NEEDS_DECISION` 대상이다.
- `PAGE-000`은 navigation shell, 전역 접근성, 공통 persistence처럼 하나의 primary page를 고를 수 없는 책임에만 사용한다. 편의상 여러 페이지 기능을 모두 공통으로 보내지 않는다.
- 페이지가 삭제·통합되면 행을 즉시 제거하지 않고 관련 FEAT의 primary group을 먼저 이동한 뒤 `plan-history-contract.md`에 변경 이유를 기록한다.

```markdown
## Feature List
| ID | Feature | User Value (1 line) | Priority | Page Group | Screen | Scope |
|---|---|---|---|---|---|---|
| FEAT-001 | Order Status Change | Admin resolves directly without CS | Must | PAGE-002 | order-detail | keep |
| FEAT-002 | 상태 변경 이력 | 감사 추적 | Should | PAGE-002 | order-detail/history | defer |
```

- `ID`는 안정 식별자 — 이름이 바뀌어도 ID는 유지하고, 삭제는 행 제거가 아니라 `Scope: cut`으로 표기 후 `plan-history-contract.md`에 기록한다.
- 각 FEAT는 정확히 하나의 **primary `페이지 그룹`**을 참조한다. 여러 화면에 나타나는 기능도 검토·변경의 주 책임 페이지 하나를 고르고, 나머지 진입점은 `화면`에 쉼표로 남긴다. 정말 primary page가 없는 전역 책임만 `PAGE-000`을 사용한다.
- Feature List가 참조한 `PAGE-NNN`이 Page Groups 표에 없거나 Page Group에 연결된 FEAT가 0개면 `plan-reviewer`의 `NEEDS_DECISION` 대상이다.
- 모든 Must 기능은 ≥1개 화면에 매핑되고, 화면 인벤토리의 모든 화면은 ≥1개 기능에 매핑돼야 한다 — **고아 화면/고아 기능은 plan-reviewer의 NEEDS_DECISION 대상**이다.

## 3-1. 기능 동작 명세와 Test Case (feature-plan 필수 — Must 전부)

Feature List의 한 줄 요약은 "무엇을"만 말한다. 디자인·프리뷰·구현·QA가 하나의 기준으로 움직이려면 **"어떻게 동작하는가"**와 **검증 가능한 test case**가 있어야 한다. 각 Must FEAT에 대해 작성한다:

```markdown
### FEAT-001 — Order Status Change
**동작 명세**: 결제완료 상태의 주문에서만 [상태 변경] 버튼이 활성화된다. 클릭하면 확인 dialog가 열리고, 확인 시 상태가 갱신되어 목록·상세에 즉시 반영되며 취소 시 아무 변화가 없다. 변경 중에는 버튼이 처리중(disabled)으로 바뀐다.

| Test Case | Given | When | Then |
|---|---|---|---|
| TC-001-1 | 결제완료 주문 상세 | 상태 변경 버튼 클릭 → 확인 | 상태가 '배송중'으로 바뀌고 목록에도 반영된다 |
| TC-001-2 | 결제 전 주문 상세 | — | 상태 변경 버튼이 비활성(disabled)이다 |
| TC-001-3 | 확인 dialog | 취소 클릭 | 상태가 그대로이고 dialog가 닫히며 포커스가 트리거로 복귀한다 |
```

규칙:
- `TC-NNN-N`은 안정 ID다. **requirements.md의 Must acceptance criteria(Given/When/Then)를 test case의 정본 근거로 재사용·구체화**하고, 새로 발명하지 않는다 — REQ의 AC를 FEAT 단위로 그룹핑·세분화한 것이 TC다. Traceability 표에 `REQ → FEAT → TC` 연결을 남긴다.
- test case는 **관찰 가능한 결과**로 쓴다("잘 동작한다" ✗, "목록에 새 행이 추가된다" ✓). 정상·실패·경계(빈 상태, 권한/조건 미충족, 취소, 중복 클릭, 필터 중 삭제 등)를 포함한다.
- LOCAL_DOMAIN_STATE_MODE이면 상태 불변식(참조 무결성·구조 필드 격리·cascade·stale selection)을 test case로 명시한다 — 프리뷰와 구현이 위반을 재현하면 FAIL이다.
- 이 test case 집합은 **하나의 정본**으로 세 소비자가 공유한다: ① `design-preview-builder`가 프로토타입에서 실제로 통과시키고(`behaviors.md` 커버리지) ② Phase 4 `test-writer`가 자동 test로 구현하고 ③ 사용자가 프리뷰·릴리스 승인 체크리스트로 사용한다. 세 곳이 다른 시나리오를 쓰면 안 된다.
- Must FEAT에 동작 명세나 test case가 없으면 `plan-reviewer`의 `NEEDS_DECISION`(디자인·프리뷰가 무엇을 동작시켜야 하는지 알 수 없음) 대상이다.

## 3-2. 하위 기능(Sub Feature) 계층 — 복합 Feature에만 선택 적용

하나의 `FEAT-NNN` 안에 서로 독립적으로 설명·검증·변경할 수 있는 동작이 둘 이상이면 `FEAT-NNN-NN` 하위 기능을 선언한다. 화면의 버튼 수를 그대로 복사하는 분해가 아니라 **행동 책임 경계**를 명확히 하기 위한 선택 계약이다.

```markdown
#### FEAT-004 하위 기능
| Sub Feature ID | Behavior | Related Test Case | Screen/Area | Scope |
|---|---|---|---|---|
| FEAT-004-01 | 테이블 생성 | TC-004-1 | tool-detail/create | keep |
| FEAT-004-02 | 테이블 이름 변경 | TC-004-2, TC-004-5 | tool-detail/row | keep |
| FEAT-004-03 | 테이블 삭제 | TC-004-3, TC-004-4 | tool-detail/row | keep |
```

생성 기준:
- 독립적인 정상·실패·경계 조건 또는 별도 TC subset이 있다.
- 다른 하위 동작과 독립적으로 변경·cut·defer될 수 있다.
- 별도 화면 영역이나 preview anchor로 설명해야 추적이 명확하다.

생성하지 않는 기준:
- 같은 동작이 여러 화면에 반복될 뿐이면 하위 기능 하나에 anchor를 여러 개 연결한다.
- 레이블·아이콘·레이아웃 같은 순수 시각 요소는 하위 기능이 아니다.
- 관찰 가능한 결과를 독립적으로 정의할 수 없으면 parent FEAT의 anchor grouping으로 유지한다.

ID와 소유권 규칙:
- `FEAT-NNN`은 사용자 가치와 scope를 소유하고 `FEAT-NNN-NN`은 구체 행동과 TC/anchor subset을 소유한다.
- 하위 ID의 앞 3자리는 parent와 같아야 하고 두 자리 순번은 생성 후 불변·재사용 금지다.
- TC 정본 ID는 기존 `TC-NNN-N`을 유지한다. 하위 기능 때문에 TC를 복제하거나 번호를 다시 매기지 않는다.
- 같은 TC가 여러 진입점을 함께 검증하면 복수 하위 기능이 참조할 수 있고, parent는 모든 TC/anchor를 aggregate한다.
- 하위 기능의 변경·cut·defer는 `plan-history-contract.md`에 해당 하위 ID를 대상으로 append한다.

## 3-3. Preview interactive surface 누락의 기획 환류

프리뷰에서 조작 가능한 영역이 발견됐는데 FEAT/TC가 없다고 해서 화면 label을 그대로 새 기능으로 만들지 않는다. `button`, 링크, form control, tab/menuitem, drag handle, clickable row/navigation group을 사용자 행동 기준으로 분류한다.

- 기존 FEAT의 동일 행동이 다른 화면·사이드바·행에 반복된 것: 새 ID 없이 기존 FEAT/Sub Feature에 anchor를 추가한다.
- 도구명·테이블명·주문명처럼 반복 렌더링되는 entity instance: 각 값은 기능이 아니며 목록/선택/navigation 행동을 소유한 parent anchor가 포괄한다.
- 기존 parent 안에서 독립 TC subset과 변경 경계를 가진 새 행동: 다음 미사용 `FEAT-NNN-NN`을 만들고 기존 TC를 연결하거나, REQ acceptance criteria에서 필요한 TC를 안정 ID로 추가한다.
- 새로운 사용자 가치·scope·화면을 만드는 행동: top-level FEAT와 대응 REQ/TC를 추가하고 우선순위·화면·`keep|cut|defer`를 확인한다.
- 순수 표현 또는 preview 전용 control: Feature를 만들지 않고 비매핑 사유를 traceability audit에 남긴다.

기획 생성·변경이 필요하면 `requirements.md`·`feature-plan.md`·append-only `decision-log.md`를 한 세트로 write-back한다. 세 문서가 현재화되기 전 design preview 재생성과 승인을 진행하지 않는다.

## 4. 다듬기 라운드 (Phase 1 체크포인트)

Feature List를 표로 보여주고 항목별 `keep | cut | defer`를 확인한다.

- 최대 2라운드 — 라운드마다 변경된 행만 다시 보여준다.
- cut/defer 결정은 행 삭제가 아니라 표기 변경 + history 엔트리다.
- 라운드 중 새 기능 요구는 즉시 FEAT ID를 부여해 표에 추가하고 같은 라운드에서 우선순위를 확인한다.

## 5. 디자인 단계 소비 규칙

- `layout-designer`: 정보 위계 표의 Primary 순서를 시각 위계(크기·위치·대비)의 근거로 사용하고, 근거 없는 재배열을 하지 않는다.
- `design-system-architect`: 디자인 방향 절이 없으면 `BLOCKER`. `ASSUMPTION(프리뷰 A/B)` 항목은 두 시안의 토큰 변형으로 준비한다.
- `component-designer`: 상태별 내용 열을 각 컴포넌트의 상태 계약으로 옮긴다 — 내용 없는 상태(빈 EmptyState)를 만들지 않는다.
- 프리뷰 피드백 중 **기획 레벨 변경**(새 기능, 화면 추가/삭제, Must 변경)은 디자인에서 처리하지 않고 Feature List 다듬기로 되돌린다 — 프리뷰는 스코프 뒷문이 아니다.
