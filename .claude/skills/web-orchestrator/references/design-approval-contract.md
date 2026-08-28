# Design Approval Contract

문서 체크포인트만으로 상호작용·고밀도 화면을 확정하지 않는다.

## Design Preview Loop (Phase 2 기본 흐름)

> **승인은 언제나 프리뷰다. 바탕만 다르다.**(2026-08-28 확정)
>
> 종전에는 서비스 태생에 따라 승인 표면을 나눠 배정했다 — greenfield는 프리뷰, brownfield는
> 실행 중인 앱에 프록시로 오버레이를 주입하는 **라이브 델타**. 그 이원화가 CSP·SSR·Shadow DOM
> 미실증과 신원 대조·anchorReceipt 같은 부수 기제를 전부 끌고 왔고, 표면이 둘이라 규칙도 둘이
> 됐다. 라이브 델타를 제거하고 **승인 표면을 프리뷰 하나로 모았다.**
>
> 달라지는 것은 **프로토타입이 무엇 위에 놓이는가**뿐이다:
>
> | 바탕 | 무엇인가 | 언제 |
> |---|---|---|
> | 없음(빈 바탕) | 프로토타입이 화면 전체다 | 신규 서비스 |
> | 스냅샷 바탕 | 실행 중인 앱을 뜬 **정적 DOM**(`preview/base/`) | 프리뷰가 없던 기존 서비스에 기능을 붙일 때 |
>
> 승인 절차·상태머신·digest 결속·오버레이는 두 경우가 **완전히 같다**. 바탕은 모드가 아니라
> **속성**이며, `design-preview-status-lib`도 새 모드를 만들지 않는다 — 모드를 늘리는 순간
> 방금 치른 이원화 비용을 다시 치른다. 스냅샷 바탕은 아래 §스냅샷 바탕을 따른다.
>
> **라이브는 승인과 무관하다.** 콘솔 Development>Live 탭은 "지금 무엇이 돌고 있나"를 보는
> 운영 뷰이며 기획 매칭도 승인도 하지 않는다(`preview/live.json`은 그 대상 선언일 뿐이다).

화면이 있는 greenfield는 Phase 2 Wave 2(component-spec) 완료 후 **프리뷰 루프를 기본 실행**한다. 사용자가 명시적으로 skip하면 생략한다. **이 계약의 프리뷰가 유일한 기획 확인·승인 표면**이다(라이브 델타 제거, 2026-08-28). 기획 UX(닷+호버 배지·기능 사이드바·변경 요청·승인 상태머신)는 공용 런타임 `assets/wh-overlay.mjs`가 제공하고, 승인은 `validate-design-preview.mjs`가 판정한다. **`preview/live.json`({target})은 승인이 아니라 dev 서버 운영 대상 선언**이며 콘솔 Development>Live 탭이 읽는다 — 특정 agent가 생성하지 않는 **운영자 수기 파일**이고, 깨진 JSON은 침묵 폴백 없이 `INVALID_LIVE_CONFIG`로 loud fail한다(델타 킷 레거시 manifest 폴백은 라이브 델타와 함께 제거). 시각 확인이 불필요한 brownfield 변경은 `docs/brownfield-adoption.md`의 L1(변경 관리 루프)로 충분하다.

프리뷰는 정적 목업이 아니라 **메모리 상태 기반 인터랙티브 프로토타입**이다 — Feature List의 test case(`TC-NNN-N`)가 실제로 동작해야 한다. 목적은 "이렇게 보이는가"를 넘어 **"이렇게 동작하는가"를 사용자 피드백 수준으로** 확인하는 것이다.

0. **방향 승인 — 사람이 결정하는 두 지점 중 첫째(2026-08-23 개정)**: 프리뷰를 만들기 **전에**
   방향을 사람과 함께 확정한다. **이것은 메뉴 제시가 아니라 협업이다** — 후보를 보고, 고르고,
   축을 분해해 재조합하고, 마음에 들 때까지 다듬는 왕복이다.

   **디자인에서 사람이 결정하는 지점은 정확히 둘이다**: ① 신규 서비스의 **디자인 컨셉**(이 절),
   ② 기존 서비스에 **신규 기능이 붙을 때의 디자인**(아래 §신규 기능의 디자인 협업).
   그 외 모든 값은 시스템에서 파생된다 — 사람에게 매번 묻지 않는다.

   **① 신규 서비스 — 컨셉 확정 절차**
   1. `design-system-architect`(fable)가 **자유 렌더 후보 3종**을 낸다. 고정 DOM·토큰 변수 제약을
      두지 않는다 — 레이아웃·조판·모션·물성 표현까지 열어야 사용자가 판단할 근거가 생긴다.
      각 후보는 **같은 실제 화면 1장**(그 서비스의 핵심 화면)이어야 비교가 성립한다.
      근거: `docs/efficacy/receipts/free-lane-divergence-probe.md` — 사용자 판정의 결정적 근거가
      전부 토큰 13변수 **밖**(상태 표시의 형식·레이아웃 원리·물성)에 있었다. 비용은 자유군 33k /
      통제군 132k였으나 **등가 비교가 아니다**(통제군은 시스템 문서·토큰까지 산출) — 이 수치의
      주장 범위는 "자유 렌더가 비싸다는 전제가 자명하지 않다"까지다.
   2. **사용자와 왕복한다.** 후보 하나를 통째로 고르는 것이 기본형이 아니다 — 실측에서 사용자는
      "B가 좋다 → C가 더 낫다 → C의 그래프는 이질적이다 → C 스타일 + A 구조 + 서체는 각각 다른
      후보에서"로 **축을 분해해 재조합**했다. 오케스트레이터는 이 재조합을 지원하고, 매 라운드
      렌더로 확인시킨다. 라운드 상한은 두지 않되 각 라운드의 변경 사유를 decision-log에 남긴다.
      **라운드는 `execution-budget-contract.md`에서 차감한다** — 상한이 없다는 것은 예산 밖이라는
      뜻이 아니다. decision-log 기재는 기계 미검증(honor-system, protected-core §4 포섭).
   3. 확정되면 그 렌더가 **승인 정본**이다(`_workspace/02_design/approved-render.html`).
      후보 렌더는 `_workspace/02_design/design-system/candidates/<라운드>/candidate-{a,b,c}/`에 보존한다
      (§발산 6 보존 규약). **소유권 주의**: 두 경로 모두 `design-system-architect`의 소유 정규식
      (`design-system(.md|/…)`) 안이거나 밖일 수 있다 — `approved-render.html`은 **밖**이므로
      오케스트레이터가 내려쓴다(실측: 소유권 훅이 에이전트 쓰기를 차단하고 에이전트가 우회 없이
      BLOCKER 보고). 소유 regex 확장은 미해결 TODO.
   4. 정본에서 **디자인 시스템을 추출**한다(§시스템 추출). 그다음 아래 1(프리뷰)로 간다.

   **예외**: 사용자가 레퍼런스·시안을 이미 지정했거나 기존 디자인 시스템을 승계하는 경우 —
   그때는 발산 대신 **레퍼런스 해석**을 사용자와 확인한다. decision-log에 **무엇을 승계·참조하는지
   구체적으로**(파일 경로·URL·기존 tokens 출처) 적는다 — "레퍼런스 있음" 같은 자기선언만으로는
   스킵이 성립하지 않는다. 이 스킵의 정당성을 검사하는 기계는 없다(protected-core §4 등재).
   <!-- marker:tile-direction-gate -->

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

## 시스템 추출 — 승인 렌더에서 언어를 뽑는다 (컨셉 확정 직후) <!-- 명명 수준(1형태 실측) -->

승인 렌더는 **화면 1장**이다. 나머지 화면을 같은 언어로 그리려면 그 1장에서 체계를 뽑아야 한다.
`design-system-architect`가 `_workspace/02_design/design-system/`에 산출한다(20KB 초과 시 sharding).

1. **토큰** — 렌더의 실제 사용값에서 색·타이포·간격·형태·모션을 추출하고, 격자 밖 값은 정규화한다
   (정규화 근거를 기록 — 렌더 실측 vs 토큰 값의 차이가 사후에 "왜 다른가"로 남지 않게).
2. **원리(가장 중요)** — 렌더의 이식 판단·구현 결정에서 **생성 규칙 3~5개**를 뽑는다. 원리는
   "토큰에 없는 값을 정해야 할 때 무엇을 근거로 결정하는가"에 답해야 한다. **원리 없는 토큰
   목록은 색표이지 시스템이 아니다** — 다음 화면을 결정하는 것은 값이 아니라 규칙이다.
3. **컴포넌트 인벤토리** — 승인 렌더에 **있는 것(A)** 과, 화면 인벤토리가 요구하지만 렌더에
   **없어서 원리에서 파생한 것(B)** 을 구분 표기한다. B는 "승인 대기" 상태이며, 첫 실물 구현
   화면에서 사용자 확인을 받는다. **추측을 승인된 사실로 위장하지 않는다**(I1).
4. **접근성 계약** — 토큰 쌍의 대비를 계산해 표로 남긴다. 계산이 아니라 추정이면 추정이라고
   표기한다. 실측으로 얻은 규칙(예: 기능 보더는 놓일 수 있는 **모든 배경**에서 3:1)을 명문화한다.
5. **스타일 타일(선택)** — 시스템에서 파생한 견본 1장(`style-tile.html`). **타일은 시스템 뒤에
   선다** — 방향을 고르는 객관식이 아니라 확정된 언어의 참조표다. 신규 기능 담당자가 문서를
   읽기 전에 눈으로 확인하는 용도이며, 시스템이 바뀌면 함께 갱신한다(준거가 낡으면 신규 화면이
   옛 언어로 만들어진다).

실증: `docs/efficacy/receipts/design-system-extraction.md` — 이 절차로 추출한 시스템이 화면 4종을
파생하는 데 충분했고(새 색 0개·새 대비 계산 0건), 파생 원소 10건이 전부 위 3의 B 목록에서 발생했다.

## 신규 기능의 디자인 협업 — 사람이 결정하는 두 지점 중 둘째 <!-- 명명 수준(1형태 실측) -->

기존 서비스에 기능이 붙을 때다. **원칙: 시스템·타일에서 파생하는 것이 기본이고, 사람에게는
언어를 바꾸는 결정만 묻는다.** 매 화면·매 값을 확인받으면 협업이 아니라 병목이 된다.

**사람에게 묻지 않는 것(자동 파생)** — 기존 토큰·컴포넌트로 표현 가능한 모든 것. 시스템의
원리로 결정이 유도되는 것(예: "이 상태 표시는 원리 1에 따라 잉크 농도로"). 접근성 하한 준수.

**사람에게 반드시 묻는 것(언어의 변경)**:

| 상황 | 왜 사람인가 | 제시 방법 |
|---|---|---|
| 시스템에 **없는 컴포넌트 유형**이 필요 (예: 첫 차트·첫 캘린더·첫 지도) — §시스템 추출 3의 **B-목록(원리 파생·승인 대기) 첫 실물 사용 포함** | 새 표현 언어의 도입이며, 한 번 정하면 이후 전부 상속한다 | 원리에서 파생한 **후보 2~3안을 렌더**로 제시하고 고르게 한다. 산문 설명 단독 금지 |
| 기존 원리와 **충돌**하는 요구 (예: "여기만 그림자를", "이 화면은 다크로") | 예외를 허용하면 원리가 장식이 된다 — 예외 승인은 사람 몫 | 충돌 지점과 대안을 함께 제시. 승인 시 **원리에 예외로 명문화**(구두 예외 금지) |
| 기능이 **화면의 성격**을 바꿈 (기록지 → 문서, 소비자 → 관리자 등) | 밀도 모드 전환은 화면 전체의 인상을 바꾼다 | 해당 화면의 렌더를 보여주고 확인 |
| 시스템 **토큰의 변경·신설** | 전 화면에 소급 적용된다 | 변경 전/후를 같은 조건에서 렌더 비교. 색·서체 변경은 **전 화면 재검증** 대상 |

**절차**: ① 신규 기능의 화면을 시스템·타일에서 파생해 만든다 → ② 만드는 중 위 표의 상황을
만나면 **그 자리에서 지역 스타일로 때우지 않고** 사용자에게 묻는다 → ③ 결정을 **시스템에 먼저
반영**하고 화면을 재파생한다(`design-principles-research.md` §시스템-우선 왕복) → ④ 파생 기록을
남긴다(무엇을 그대로 썼고 무엇을 원리에서 파생했는지).

**검증 상태 — 명명 수준**: 이 표는 1형태 실측에서 귀납한 것이다. 두 번째 형태에서 "묻지 않는 것"에
넣은 항목이 실제로는 물었어야 했는지(또는 그 반대) 관찰해 갱신한다.

**정직 규약**: 사용자 검토에서 나온 지적은 대개 **시스템의 공백**이지 구현 실수가 아니다.
화면만 고치고 시스템을 그대로 두면 다음 기능에서 같은 지적이 반복된다 — 실측(위 receipt)에서
지적 12건 중 대부분이 시스템 갱신으로 이어졌고, 그것이 이 왕복의 실제 산출이었다.

## 프리뷰 → 개발 연속성 보장 (A 방식의 전제)

무의존 프리뷰는 실제 구현과 별개 코드다. 둘이 어긋나지 않으려면 **같은 스펙을 시각화**하도록 묶는다:

- **단일 토큰**: 프리뷰 `tokens.css`와 구현 `src/app/theme.ts`가 모두 design-system `theme.code.ts`에서 파생 → 색·타이포·밀도 동일.
- **단일 동작 계약**: 프리뷰 `behaviors.md`가 통과시킨 `TC-NNN-N`을 Phase 4 `developer`가 동일 ID로 구현에 대해 자동 검증. 프리뷰에서 승인한 동작이 구현 test로 재확인된다.
- **단일 구조**: 프리뷰·구현 모두 `layout-spec`/`component-spec`/정보 위계를 입력으로 쓴다.

따라서 **프리뷰 승인 = 토큰·동작 TC·구조 스펙의 승인**이고, 구현(`developer`)이 그 세 소스를 따르면 승인 내용이 재현된다. release 시 `code-reviewer`는 구현이 승인된 토큰·component-spec을 벗어났는지, Phase 4는 승인된 TC가 실제로 통과하는지 확인한다 — 이 고리가 "프리뷰에서 본 디자인이 개발로 이어짐"의 보장이다. 프리뷰가 스펙에 없는 시각·동작을 지어내면 이 보장이 깨지므로 금지(스펙이 유일한 소스).

## 계속 다듬기 — 프리뷰는 반복 가능한 디자인 작업 공간 (필수)

프리뷰는 한 번 승인하고 버리는 게 아니라, 디자인을 계속 다듬는 살아있는 공간이다.
다듬는 중 **디자인 시스템에 없는 원소가 필요해지면 프리뷰에서 지어내지 않는다** —
design-system을 먼저 갱신하고 그 베이스로 프리뷰를 재생성한다(시스템-우선 왕복,
`design-principles-research.md` §시안 적용 완결성 규칙 4가 정본. 위 "스펙이 유일한
소스" 금지의 해소 경로이기도 하다 — 지어내는 대신 스펙을 갱신해 경유한다).
**단, 이 "살아있는 공간"의 수명은 v1 구현 검증 완료까지다** — 실행 가능한 실물이 승인 TC
**전부**의 같은-ID 검증을 통과 기록한 뒤의 새 변경은 프리뷰를 갱신하지 않고 dev server 위
**현재 승인 표면이 없다**(라이브 델타 제거, 2026-08-28 — 아래 상태 표기). 실물이 생긴 뒤에도 프리뷰를 계속 갱신하는 것은
구현된 동작 전부를 따라잡는 두 번째 앱을 병행 유지하는 일이며, 그 자체가 drift다:

- Phase 2뿐 아니라 v1 구현 검증 **전**의 `iterate` 모드·`/feature-add`에서도 프리뷰 루프에 재진입한다. 화면·동작이 바뀌면 스펙을 고치고 프리뷰를 재생성해 다시 확인한다. v1 구현 검증 **후**의 iterate/feature-add는 **승인 표면이 현재 없다**(라이브 델타 제거, 2026-08-28) — 스냅샷 바탕 프리뷰가 그 자리를 채운다.
- 라운드 상한(기본 3)은 한 번의 확인 주기 기준이며, 세션을 재개해 계속 다듬을 수 있다. 매 개선은 스펙 갱신 → 프리뷰 재생성 → 재승인 순서를 지킨다(프리뷰 직접 수정 금지).
- **양방향 동기화**: 구현(Phase 3) 중 디자인이 바뀌면 스펙과 프리뷰도 함께 갱신해 프리뷰가 stale해지지 않게 한다. 프리뷰는 항상 "현재 승인된 디자인"을 반영한다.
- **파생 상태 판정**: `validate-design-preview.mjs --project {root} --json`은 현재 입력·프리뷰 digest를 마지막 승인 기록과 비교해 `MISSING | INVALID | DRAFT | UNAPPROVED | APPROVED | STALE`을 반환한다. 승인 뒤 source 또는 preview 파일 하나라도 바뀌면 기록을 덮어쓰지 않고 상태를 `STALE`로 파생한다. 재생성·재확인·재승인 전에는 Phase 3 진입과 Console의 "승인됨" 표시를 금지한다.
- 각 다듬기 라운드의 승인 기록(SHA-256·통과 TC·승인 문구)은 `design-review.md`에 누적돼 이력이 유실되지 않는다.

## 프리뷰 보존 — 개발과 분리, 언제든 재확인 (필수)

프리뷰는 일회성 산출물이 아니라 **릴리스까지 보존되는 자산**이다. 승인 후에도 언제든 고객에게 다시 보여줄 수 있어야 한다. **릴리스(v1 구현 검증 완료) 이후의 프리뷰는 증거물이다** — "무엇을 근거로 승인했나"를 재확인하는 보존 대상이지 승인 표면이 아니며, 이후 변경의 승인 표면은 **현재 없다**(라이브 델타 제거, 2026-08-28).

- **개발과 물리적으로 분리**: 프리뷰는 `_workspace/02_design/preview/`에만 존재하고 `src/`·production 코드와 섞이지 않는다. Phase 3 구현·Phase 4 QA 어느 agent도 `preview/`를 재료로 쓰거나 수정·삭제하지 않는다(소유자는 `design-preview-builder` 하나뿐). 구현이 진행돼도 프리뷰는 그대로 남는다.
- **자기완결·무의존이라 언제든 재기동**: 외부 의존성이 0이므로 빌드·설치 없이 `node .claude/scripts/preview-server.mjs --project {root}`만으로 항상 다시 띄울 수 있다. 특정 시점 환경에 묶이지 않는다.
- **Console 단일 연결점**: Console은 별도 프리뷰 복사본을 만들지 않고 이 디렉토리를 iframe/새 창으로 표시한다. 상태는 같은 로컬 서버의 `GET /__web-harness/preview-status` JSON을 읽으며, `STALE`·`UNAPPROVED`를 `APPROVED`처럼 표시하지 않는다.
- **인수인계에 포함**: `HANDOFF.md`(및 완료 보고)에 프리뷰 위치와 재기동 명령, 승인된 test case 커버리지를 남겨, 개발이 끝난 뒤에도 "승인받은 디자인·동작이 무엇이었는지"를 고객이 재확인할 수 있게 한다.
- **재생성은 덮어쓰기가 아니라 갱신**: 피드백 반영으로 재생성할 때 이전 승인본의 승인 기록(SHA-256·통과 TC)은 `design-review.md`에 남아 이력이 유실되지 않는다.

## 스냅샷 바탕 — 프리뷰가 없던 서비스에 기능을 붙일 때 <!-- 명명 수준(1형태 실측) -->

프리뷰가 없는 기존 서비스에는 "기획이 화면의 어디에 붙는가"를 보여줄 바탕이 없다. 그 바탕을
**실행 중인 앱의 정적 DOM 스냅샷**으로 만든다. 이미 렌더된 결과를 가져오므로 런타임 주입이
앓던 CSP·SSR·Shadow DOM 문제가 원리적으로 사라진다.

**시드/테스트 데이터 상태에서만 캡처한다.** 스냅샷은 커밋되므로 실사용 데이터가 화면에 있으면
PII가 git 히스토리에 들어간다. 아래 치환은 안전망이지 면허가 아니다 — 이미지·바이너리는 치환
대상이 아니므로 **시드 데이터가 근본 방어다**. 남은 미커버 채널은 protected-core §4와 산출물의
`meta.json.limits`에 기록돼 있다.

캡처는 **대상 프로젝트에서** 실행한다(하네스는 의존성 0, Playwright 없음 — quality gate와 같은 구조):

```
node <harness>/skills/web-orchestrator/assets/capture-base-snapshot.mjs \
  --base http://127.0.0.1:5173 --route / --route /orders \
  --source src --anchor-map _workspace/02_design/preview/anchor-map.json \
  --out _workspace/02_design/preview/base
```

- `--base`는 **loopback만** 허용한다.
- `--source`는 보존 어휘의 출처다. 치환의 극성은 **allowlist(보존) 기반 fail-closed** —
  "PII를 찾아 지운다"가 아니라 "소스에서 수집한 컴포넌트 문구를 보존하고 나머지를 치환한다".
  어휘가 비면 화면이 통째로 마스킹된다(보기엔 나쁘고, 새지는 않는다).
- `--anchor-map`이 **무엇에 배지가 붙는가의 정본**이다. `{anchorId, featureId, route, selector}`를
  사람이 적는다 — 기획이 어느 요소에 붙는지는 추측하지 않는다. 셀렉터가 안 맞거나 여러 요소에
  걸리면 파일을 쓰기 전에 죽는다.

**배지는 기획 연관 요소에만 붙는다.** 오버레이는 traceability에 있는 앵커만 배지하므로,
anchor-map에 없는 나머지 화면은 시각적 소음 없이 바탕으로만 남는다.

**anchor-map 없이 캡처하면 바탕은 열람 전용이다** — 배지가 없고, 앵커 검사 3종이 전부 공허하게
통과한다. 승인 바탕에 anchor-map을 요구하는 **기계 강제는 아직 없다**(protected-core §4 등록).
앵커 없는 바탕 위에서 기획 매칭을 주장하지 마라.

바탕은 `inspectDesignPreview`가 함께 판정한다 — `meta.json` 부재·선언되지 않은 html·앱 script
잔존·`computed-fallback` 스타일은 전부 INVALID다. 바탕 파일은 preview digest에 포함되므로
**바탕이 바뀌면 승인이 무효화된다**(별도 기제 없이 기존 STALE 경로를 그대로 탄다).

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
