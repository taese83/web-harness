# Design Approval Contract

문서 체크포인트만으로 상호작용·고밀도 화면을 확정하지 않는다.

## Design Preview Loop (Phase 2 기본 흐름)

화면이 있는 greenfield는 Phase 2 Wave 2(component-spec) 완료 후 **프리뷰 루프를 기본 실행**한다. 사용자가 명시적으로 skip하면 생략한다. **이 계약의 프리뷰(디자인 프리뷰)는 greenfield 태생의 기획 확인·승인 표면**이고, brownfield의 표면은 **라이브 델타**(`live-base-delta-contract.md`)다 — 두 표면은 별개 항목이되 같은 기획 UX(닷+호버 배지·기능 사이드바·변경 요청·승인 상태머신, 공용 런타임 `assets/wh-overlay.mjs`)를 공유하고, 같은 validator(`validate-design-preview.mjs` — 델타는 `manifest.json`의 live-delta 모드)로 승인된다. 시각 확인이 불필요한 brownfield 변경은 `docs/brownfield-adoption.md`의 L1(변경 관리 루프)로 충분하다.

프리뷰는 정적 목업이 아니라 **메모리 상태 기반 인터랙티브 프로토타입**이다 — Feature List의 test case(`TC-NNN-N`)가 실제로 동작해야 한다. 목적은 "이렇게 보이는가"를 넘어 **"이렇게 동작하는가"를 사용자 피드백 수준으로** 확인하는 것이다.

1. **생성**: `design-preview-builder`가 `_workspace/02_design/preview/`에 무의존 인터랙티브 프로토타입(in-memory store + 해시 라우팅 + 실제 CRUD/DnD/상태 전이)을 생성하고, `behaviors.md`에 Must test case 커버리지를 남긴다. `traceability.json`에는 모든 `FEAT-NNN ↔ 선택적 FEAT-NNN-NN ↔ TC-NNN-N ↔ data-wh-anchor`를 기록하고 화면 요소에는 클릭 가능한 가장 좁은 책임 ID의 배지와 상세 side panel을 제공한다(배지 표시 형식은 design-preview-builder 규칙 10의 **닷+호버 표준**으로 모든 프로젝트에서 동일 — 상시 노출 pill 등 변형 금지. 배지·패널을 자체 구현한 **레거시 프리뷰는 발견 시 내장 구현·스타일을 제거하고 공용 런타임 로드로 이전**한다 — 스키마 세대 차이(`description`/`howTo`/기능 내장 `testCases` ↔ `summary`/`behavior`/최상위 `testCases`)는 공용 런타임의 별칭이 흡수하므로 traceability 재작성은 불필요, 앱 기능 코드는 건드리지 않는다). Console iframe 안의 side panel에는 Test Case 문맥에서 append-only Change Request dialog를 여는 `변경 요청` action을 제공하되, preview는 schemaVersion 1 ID signal만 부모에 보내고 직접 API/file mutation을 수행하지 않는다. feature-plan에 동작 명세·test case가 없으면 `BLOCKED`.
   - schema v1 parent-only traceability는 계속 유효하다. 하위 기능을 선언한 신규/갱신 preview는 schema v2의 `features[].subFeatures[]`와 `anchors[].subFeatureId`를 사용한다.
   - parent FEAT는 사용자 가치와 aggregate TC/anchor를 유지하고, subfeature는 독립 행동의 TC/anchor subset만 소유한다. 같은 동작의 복수 화면은 subfeature를 늘리지 않고 anchor를 여러 개 연결한다.
   - **Interactive Surface Coverage Gate**: source snapshot 전에 preview의 모든 `button`, `a[href]`, form control, tab/menuitem, drag handle, clickable row/navigation group을 감사한다. 각 surface는 ① 기존 FEAT/Sub Feature anchor가 직접 또는 가장 가까운 container에서 포괄 ② 반복되는 동적 entity instance라면 기존 anchor가 포괄 ③ 순수 표현·preview 전용 control이면 구체적 비매핑 사유 기록 중 하나여야 한다. seed의 도구명·테이블명·주문명 같은 entity label마다 FEAT를 만들지 않는다. 사용자 행동인데 대응 FEAT/TC가 없으면 `design-preview-builder`가 발명하지 않고 Feature List 다듬기로 되돌린다. 기존 parent의 독립 행동이면 Sub Feature, 새로운 사용자 가치·scope이면 top-level FEAT와 REQ/TC를 `requirements.md`·`feature-plan.md`·`decision-log.md`에 write-back한 뒤 preview를 재생성한다. 미분류 surface가 하나라도 있으면 `BLOCKED`이며 snapshot/승인 기록을 만들지 않는다.
1-A. **입력 고정**: 생성 직후 `node .claude/scripts/validate-design-preview.mjs --project {root} --write-source-snapshot`을 실행한다. 이 명령만 `traceability.json.sourceSnapshot`을 기록하며 구조·TC 커버리지·DOM 앵커를 함께 검증한다. 성공 상태는 아직 승인 전인 `UNAPPROVED`다.
2. **서빙**: 오케스트레이터가 `node .claude/scripts/preview-server.mjs --project {root}`를 실행하고 URL을 안내한다 (localhost·read-only·idle 자동 종료). Claude Code 데스크톱이면 browser pane으로 표시하고 실제 조작(등록·삭제·드래그·이동)으로 test case 통과를 확인·캡처한다.
3. **피드백**: 라운드당 최대 3개 항목. `ASSUMPTION(시안 확정)` 항목은 커밋된 시안의 승인으로 확정한다(디자인 근거 패널 참조) — 비교 토글은 opt-in 축에만 존재한다. 동작이 test case와 다르면 그 자체가 피드백 항목이다.
4. **반영**: 피드백은 해당 owner가 **스펙에 먼저** 반영한다 — 시각·정보 위계는 designer, **동작·test case 변경은 feature-planner(동작 명세·TC)**, 그 뒤 `design-preview-builder`가 재생성한다. 프리뷰 직접 수정 금지 (스펙이 유일한 소스).
5. **반복 상한**: 기본 3라운드. 상한 도달 시 미결 항목을 `NEEDS_DECISION`으로 체크포인트에 올린다. 라운드는 `execution-budget-contract.md`에서 차감한다.
6. **승인 기록**: 명시적 사용자 승인 뒤 `node .claude/scripts/validate-design-preview.mjs --project {root} --record-approval --approval-text "{verbatim approval}"`을 실행한다. 이 명령은 승인 시점의 source/preview/traceability SHA-256, 통과한 test case 목록, 사용자 승인 문구를 `design-review.md`의 `## Preview Approval` 절에 append-only로 기록한다. 상태가 `APPROVED`인지 다시 확인하고, `VISUAL_QA_MODE`이면 승인된 프리뷰 스크린샷을 `visual-qa-contract`의 reference 후보로 등록한다.
7. **스코프 경계**: 피드백 중 기획 레벨 변경(새 기능·화면 추가/삭제·Must 변경)은 디자인에서 처리하지 않고 Feature List 다듬기(`design-readiness-contract.md`)로 되돌리고 `plan-history-contract.md`에 기록한다.

프로토타입의 **동작은 실제**(메모리 state)이지만 **시각 렌더링은 근사치**로 실제 UI 라이브러리와 다르다 — 이 경계를 체크포인트 문구에 포함한다. 실제 DB·API·영속성·성능·접근성 실측은 여전히 Phase 3 구현 + Phase 4 QA의 몫이다. 실제 UI 라이브러리 컴포넌트의 시각·모션 충실도가 승인의 핵심일 때만 아래 `DESIGN_PROTOTYPE_MODE`의 rendered prototype(실스택)을 추가로 켠다.

## 프리뷰 → 개발 연속성 보장 (A 방식의 전제)

무의존 프리뷰는 실제 구현과 별개 코드다. 둘이 어긋나지 않으려면 **같은 스펙을 시각화**하도록 묶는다:

- **단일 토큰**: 프리뷰 `tokens.css`와 구현 `src/app/theme.ts`가 모두 design-system `theme.code.ts`에서 파생 → 색·타이포·밀도 동일.
- **단일 동작 계약**: 프리뷰 `behaviors.md`가 통과시킨 `TC-NNN-N`을 Phase 4 `test-writer`가 동일 ID로 구현에 대해 자동 검증. 프리뷰에서 승인한 동작이 구현 test로 재확인된다.
- **단일 구조**: 프리뷰·구현 모두 `layout-spec`/`component-spec`/정보 위계를 입력으로 쓴다.

따라서 **프리뷰 승인 = 토큰·동작 TC·구조 스펙의 승인**이고, 구현(`route-builder`/`component-builder`)이 그 세 소스를 따르면 승인 내용이 재현된다. release 시 `code-reviewer`는 구현이 승인된 토큰·component-spec을 벗어났는지, Phase 4는 승인된 TC가 실제로 통과하는지 확인한다 — 이 고리가 "프리뷰에서 본 디자인이 개발로 이어짐"의 보장이다. 프리뷰가 스펙에 없는 시각·동작을 지어내면 이 보장이 깨지므로 금지(스펙이 유일한 소스).

## 계속 다듬기 — 프리뷰는 반복 가능한 디자인 작업 공간 (필수)

프리뷰는 한 번 승인하고 버리는 게 아니라, 디자인을 계속 다듬는 살아있는 공간이다.
다듬는 중 **디자인 시스템에 없는 원소가 필요해지면 프리뷰에서 지어내지 않는다** —
design-system을 먼저 갱신하고 그 베이스로 프리뷰를 재생성한다(시스템-우선 왕복,
`design-principles-research.md` §시안 적용 완결성 규칙 4가 정본. 위 "스펙이 유일한
소스" 금지의 해소 경로이기도 하다 — 지어내는 대신 스펙을 갱신해 경유한다).
**단, 이 "살아있는 공간"의 수명은 v1 구현 검증 완료까지다** — 실행 가능한 실물이 승인 TC
**전부**의 같은-ID 검증을 통과 기록한 뒤의 새 변경은 프리뷰를 갱신하지 않고 dev server 위
라이브 델타로 승인한다(판정 기준은 `live-base-delta-contract.md` 전환 규칙이 정본). 실물이 생긴 뒤에도 프리뷰를 계속 갱신하는 것은
구현된 동작 전부를 따라잡는 두 번째 앱을 병행 유지하는 일이며, 그 자체가 drift다:

- Phase 2뿐 아니라 v1 구현 검증 **전**의 `iterate` 모드·`/feature-add`에서도 프리뷰 루프에 재진입한다. 화면·동작이 바뀌면 스펙을 고치고 프리뷰를 재생성해 다시 확인한다. v1 구현 검증 **후**의 iterate/feature-add는 프리뷰가 아니라 라이브 델타로 재진입한다(전환 규칙).
- 라운드 상한(기본 3)은 한 번의 확인 주기 기준이며, 세션을 재개해 계속 다듬을 수 있다. 매 개선은 스펙 갱신 → 프리뷰 재생성 → 재승인 순서를 지킨다(프리뷰 직접 수정 금지).
- **양방향 동기화**: 구현(Phase 3) 중 디자인이 바뀌면 스펙과 프리뷰도 함께 갱신해 프리뷰가 stale해지지 않게 한다. 프리뷰는 항상 "현재 승인된 디자인"을 반영한다.
- **파생 상태 판정**: `validate-design-preview.mjs --project {root} --json`은 현재 입력·프리뷰 digest를 마지막 승인 기록과 비교해 `MISSING | INVALID | DRAFT | UNAPPROVED | APPROVED | STALE`을 반환한다. 승인 뒤 source 또는 preview 파일 하나라도 바뀌면 기록을 덮어쓰지 않고 상태를 `STALE`로 파생한다. 재생성·재확인·재승인 전에는 Phase 3 진입과 Console의 "승인됨" 표시를 금지한다.
- 각 다듬기 라운드의 승인 기록(SHA-256·통과 TC·승인 문구)은 `design-review.md`에 누적돼 이력이 유실되지 않는다.

## 프리뷰 보존 — 개발과 분리, 언제든 재확인 (필수)

프리뷰는 일회성 산출물이 아니라 **릴리스까지 보존되는 자산**이다. 승인 후에도 언제든 고객에게 다시 보여줄 수 있어야 한다. **릴리스(v1 구현 검증 완료) 이후의 프리뷰는 증거물이다** — "무엇을 근거로 승인했나"를 재확인하는 보존 대상이지 승인 표면이 아니며, 이후 변경의 승인은 라이브 델타가 맡는다(`live-base-delta-contract.md` 전환 규칙).

- **개발과 물리적으로 분리**: 프리뷰는 `_workspace/02_design/preview/`에만 존재하고 `src/`·production 코드와 섞이지 않는다. Phase 3 구현·Phase 4 QA 어느 agent도 `preview/`를 재료로 쓰거나 수정·삭제하지 않는다(소유자는 `design-preview-builder` 하나뿐). 구현이 진행돼도 프리뷰는 그대로 남는다.
- **자기완결·무의존이라 언제든 재기동**: 외부 의존성이 0이므로 빌드·설치 없이 `node .claude/scripts/preview-server.mjs --project {root}`만으로 항상 다시 띄울 수 있다. 특정 시점 환경에 묶이지 않는다.
- **Console 단일 연결점**: Console은 별도 프리뷰 복사본을 만들지 않고 이 디렉토리를 iframe/새 창으로 표시한다. 상태는 같은 로컬 서버의 `GET /__web-harness/preview-status` JSON을 읽으며, `STALE`·`UNAPPROVED`를 `APPROVED`처럼 표시하지 않는다.
- **인수인계에 포함**: `HANDOFF.md`(및 완료 보고)에 프리뷰 위치와 재기동 명령, 승인된 test case 커버리지를 남겨, 개발이 끝난 뒤에도 "승인받은 디자인·동작이 무엇이었는지"를 고객이 재확인할 수 있게 한다.
- **재생성은 덮어쓰기가 아니라 갱신**: 피드백 반영으로 재생성할 때 이전 승인본의 승인 기록(SHA-256·통과 TC)은 `design-review.md`에 남아 이력이 유실되지 않는다.

## DESIGN_PROTOTYPE_MODE 활성 조건

- dashboard, chart builder, editor, dense table
- drag/resize, multi-mode, destructive action
- reference image 또는 annotation 제공
- Phase 2에 layout/interaction 미결 사항 존재

## 기존 프로젝트 Inventory

기존 source가 있으면 새 theme/component를 설계하기 전에 다음을 기록한다.

```markdown
## Existing Design Inventory
- UI library and version:
- theme/token source:
- shared components:
- similar screens and patterns:
- public slot/classes API:
- missing capability:
```

탐색 순서는 표준 UI library → `shared/ui` → 유사 feature → 신규 component다.

## 배치 결정

위치·형태에 두 해석이 있으면 최소 rendered prototype으로 비교한다. ASCII는 구조 설명 보조 자료일 뿐 시각 승인 증거가 아니다. 동적 요소는 나타날 때 어떤 영역이 고정되고 어떤 영역만 줄어드는지 명시한다.

## Prototype Isolation

- prototype은 시각·행동 스펙이며 production 구현 재료가 아니다.
- mock state, 임시 sx, prototype component tree를 그대로 승격하지 않는다.
- production owner는 확정된 requirement, interaction, screenshot만 입력으로 사용한다.
- 사용자 확인 후 production implementation을 시작한다.
- production builder는 승인된 source digest가 가리키는 design-system/layout-spec/component-spec/feature-plan을 입력으로 사용한다. preview의 HTML/CSS/JS를 import하거나 복사하지 않는다.

L/XL 또는 `DESIGN_PROTOTYPE_MODE`에서는 read-only `design-reviewer`가 information hierarchy, mode separation, layout stability, states, accessibility를 검토한 뒤 사용자 체크포인트를 연다.

`VISUAL_QA_MODE`이면 `/visual-design-verify`의 target/state/mode와 baseline governance를 Phase 2 승인에 포함한다. prototype mode에서 rendered evidence 또는 visual contract가 없으면 `BLOCKED`다.
