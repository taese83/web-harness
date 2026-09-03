# Design Binding Contract — 이 기획의 이 조건은 어느 디자인 근거를 갖는가

공급된 디자인(Figma 노드·시안 이미지·화면 명세)은 `00_source/`에 스냅샷으로 남고, 시각 검증은
`visual-qa-contract.json`의 `targets[].referenceId`로 근거를 묶는다. **두 끝은 있었는데 가운데가
산문이었다** — 어느 프레임이 어느 화면의 어느 조건인지가 `## Source Trace` 문장에만 있어 기계가
승계하지 못했다. 그래서 조건 분기(권한 없음·빈 상태·모바일)는 구현 단계에서 즉흥으로 결정됐다.

이 계약은 그 한 칸을 채운다. **사람이 한 번 선언하고, 그 뒤로는 기계가 승계한다.**

기계 정본은 `_workspace/00_source/design-binding.json`이며 `.claude/schemas/design-binding.schema.json`을
따른다. 수기 미러는 `.claude/scripts/design-binding-lib.mjs`다.

## 일반화 근거

같은 계약이 서로 다른 형태에서 성립함을 확인한 근거:

- **Figma MCP 공급** — `references`가 `figma-node`로 찬다. 해시를 낼 수단이 없어 재현성이
  스냅샷 + 가져온 시각에 달리고, 그래서 `sha256` 칸이 금지된다. **fixture 실측(2026-09-03)** —
  `validate-visual-design.mjs`가 한 PAGE에 `supplied`·`derive`·`reuse` 세 조건이 병존하는 문서를
  통과시키고, 위조 해시와 발산 참조를 거부하는 것을 확인했다.
- **Figma 없는 공급(시안 이미지 · 화면 명세)** — `references`가 `image`·`specification`으로 차고
  **제약이 반대로 선다**: locator가 프로젝트 상대 경로여야 하고, `sha256`은 선택이되 적히면
  실물과 대조된다. 조건도 `state`가 아니라 `variant`(도메인 어휘)로 갈리는 것이 자연스럽다.
  **fixture 실측(2026-09-03)** — `test-design-binding.mjs`가 이 형태의 정상계, 경로 탈출 거부,
  지어낸 해시 거부, 부재 파일 거부를 확인했다. 두 형태가 같은 `bindings` 구조 위에 선다.
- **화면이 없는 형태(library·cli)** — 이 계약이 서지 않는다. 파일 부재가 정상이며 인계 검사는
  `SKIPPED`다. **명명 수준** — `targetShapes: ["library"]`에서 파일을 만들지 않는다는 규칙이며
  별도 fixture는 없다.

ingestor의 full 정규화와 record-only는 **형태가 아니라 같은 형태의 모드 변주**다. record-only에서
`01_plan`·`02_design`을 쓰지 못한다는 제약이 이 파일의 배치를 `00_source/`로 정했다(§5).

특정 서비스의 이름·백엔드·화면 수를 인코딩하지 않는다. 도메인 어휘가 들어올 수 있는 자리는
`condition.variant` 하나이며, 그것은 **자유 문자열**이다(아래 §2).

## 1. 무엇을 소유하고 무엇을 소유하지 않는가

"디자인이 여러 개"는 세 가지로 갈린다. 셋을 한 배열에 섞으면 "시안 4장"이 *조건 4개*인지
*후보 4개 중 미결*인지 구별되지 않는데, 앞은 정상이고 뒤는 미결이다.

| 종류 | 예 | 정본 | 소유 |
|---|---|---|---|
| **조건 병존** | 권한 없음 · 빈 상태 · 오류 · 모바일 · 무료 플랜 | 전부 동시에 정본 | **이 계약** |
| **택일** | 컨셉 후보 A·B·C, 시안 v1·v2 | 하나만 정본 | `design-approval-contract.md` |
| **다중 진입점** | 한 FEAT이 목록·상세 양쪽에 | 화면이 여럿 | `design-readiness-contract.md` §3 |

그래서 **같은 `(pageGroup, condition)`이 두 번 나오면 거부한다.** 조건이 같은데 근거가 둘이면
그것은 병존이 아니라 택일이고, 택일을 여기 적으면 승인 절차를 우회하게 된다.

## 2. 조건의 어휘 — 새로 만들지 않는다

조건 축은 이미 양쪽에 있다. 여기서 하는 일은 잇는 것뿐이다.

| 키 | 어디서 오는가 | 성격 |
|---|---|---|
| `state` | `visual-qa-contract.json`의 `targets[].state` | 두 파일에서 **문자열이 같아야 한다** |
| `modeId` | 같은 파일의 `modes[].id` (뷰포트·테마) | 같음 |
| `variant` | 기획 문서의 표현 그대로 (역할·플랜·기능 플래그) | **자유 문자열** |

`variant`를 enum으로 박지 않는 이유는 I3다 — 역할·등급 어휘는 서비스마다 다르고, 박으면 그
계약은 한 서비스에서만 참이 된다. 대신 기획 문서의 낱말을 그대로 옮기고 출처를 남긴다.

세 키 중 최소 하나는 있어야 한다. 조건 없는 바인딩은 "이 화면 전체"라는 뜻이 아니라 **무엇에
대한 근거인지 말하지 않은 것**이다.

## 3. 근거가 없는 조건 — 비워두지 않고 결정한다

현실의 시안은 default만 있다. 그것은 결함이 아니라 정상이며(`provenance-contract.md` §9),
빈 칸이 아니라 **결정**으로 적는다. `referenceIds`가 비면 `resolution`이 필수다.

| 값 | 뜻 | 뒤따르는 것 |
|---|---|---|
| `derive` | 디자인 시스템 원리에서 파생한다 | `design-approval-contract.md` §시스템 추출 3의 **B-목록**과 같은 취급 — 승인 대기, 첫 실물 화면에서 사용자 확인 |
| `reuse:<referenceId>` | 다른 조건의 근거를 그대로 쓴다 | 근거 있는 재사용. 승계된다 |
| `pending` | 아직 정하지 않았다 | **인계 구멍** — `gap-report.md`에 `NEEDS_DECISION` |

`pending`이 인계를 막는 것은 의도다. 막지 않으면 `unbound`를 비우려고 `pending`을 적는 우회가
생기고, 그러면 이 검사는 "행이 있는가"만 세는 프록시가 된다.

`derive`로 채운 조건은 **공급물이 아니라 파생물**이다. §9의 "보강분은 `ASSUMPTION`으로 표기한다"가
그대로 적용되고, 완료 보고에 혼합을 드러낸다 — `디자인: supplied (PAGE-002 default·권한없음 공급 ·
empty·error 파생 · 모바일 재사용)`.

## 4. 지어낸 값이 들어올 자리를 좁힌다 — 문법 한 자리, 대조 한 자리, 자기신고 한 자리

세 장치의 강도가 서로 다르다. 같은 것처럼 적으면 이 계약이 실제보다 강한 척하게 된다.

- **문법으로 막는다 — `kind: figma-node`에 `sha256`을 금지한다.** 이 경로에는 해시를 낼 수단이
  없고(`source-artifacts.md` 「이 경로가 남기지 못하는 것」), 계산하지 않은 해시를 적는 것은
  위조다. 재현성은 `snapshot` + `capturedAt`이 담보한다.
- **실물로 대조한다 — 적은 경로는 실재해야 하고, 적은 해시는 파일과 맞춰본다.**
  `figma-node`의 `snapshot`과 `image`·`specification`의 `locator`는 모두 프로젝트 상대 경로여야
  하고 읽히지 않으면 거부된다. 문자열 존재만 보면 없는 스냅샷이 통과하고, 그러면 "추적성의
  정본"이 이름뿐인 값이 된다(교차 모델 리뷰 2026-09-03).
  `sha256`은 **선택이되 적히면 대조한다. 필수로 두지 않는다** — 쓰는 주체
  (`source-artifact-ingestor`)에 Bash가 없어 계산할 수 없고, 못 내는 값을 필수로 만들면 그 칸은
  **지어내야만 채워진다**(적대 리뷰 2026-09-03에서 되돌렸다).

  **누가 계산하는가**: `source-artifacts.md` 「인증이 필요한 URL」의 규칙을 그대로 쓴다 —
  **Bash를 가진 주체가 수집 시점에 계산하고, ingestor는 받은 값을 옮길 뿐 만들어내지 않는다.**
  이것이 선택으로 끝나지 않는 이유가 하나 있다: `visual-qa-contract.json`은 `image` reference에
  **`sha256`을 필수로 요구한다**(`visual-evidence-lib`, 이 계약보다 앞선 규칙). 그래서 시각
  검증까지 올라갈 로컬 근거는 그 전에 해시가 채워져 있어야 하고, 비어 있으면
  `visual-contract-designer`가 지어내는 것이 아니라 **오케스트레이터에 계산을 요청한다.**
- **자기신고다 — `declaredBy`의 어휘는 `user | carried` 둘뿐이고 `inferred`가 없다.** 이것이
  없애는 것은 추론이 아니라 **추론을 정직하게 적을 자리**다. 프레임 이름이 「주문 상세」라서
  `PAGE-002`로 묶고 `user`라고 적으면 어떤 검사도 구별하지 못한다 — `provenance-contract.md`의
  공급원 자기보고와 같은 신뢰 등급이며, 실질 방어는 이 파일이 git에 남아 사후에 반증 가능한
  것이다. 그럼에도 어휘를 좁히는 이유는, 적을 칸이 있으면 그 칸이 채워지기 때문이다.
  `carried`는 이전 라운드 승계분으로 `provenance-contract.md` §5(선택의 영속)에 따라 다시 묻지
  않는다.

## 5. 소유와 타이밍

| 시점 | 주체 | 하는 일 |
|---|---|---|
| `DESIGN_SOURCE: supplied` 확정 직후 | 오케스트레이터 | 프레임 링크를 받을 때 **어느 화면·어느 조건인지 함께 묻는다** |
| 수집 | `source-artifact-ingestor` | 스냅샷을 뜨고 `references[]`를 채운다. `bindings[]`는 **사용자가 말한 것만** |
| 미선언분 | 같음 | `unbound`에 넣고 `gap-report.md`에 `NEEDS_DECISION` |
| Phase 1 → 2 체크포인트 | 오케스트레이터 | `unbound`와 `pending`을 그대로 보여주고 확정받는다 |
| 소비 | `layout-designer` | 라우팅 맵에 route ↔ `PAGE-NNN` ↔ `referenceId`를 잇는다 |
| 소비 | `visual-contract-designer` | `references[]`의 `id`·`kind`·`locator`를 옮긴다 — 재발명하지 않되 **객체를 통째로 복사하지도 않는다**(`capturedAt`·`snapshot`은 이 계약의 필드이고 visual-qa 스키마가 거부한다) |

**체크포인트에서 정해진 것을 파일에 반영하는 주체도 ingestor다.** `unbound → bindings`,
`pending → derive` 전이는 오케스트레이터가 직접 쓰지 않고 record-only로 재스폰해 반영한다 —
`00_source/`의 기록 주체가 둘이 되면 안 된다(`source-artifacts.md` 「Figma MCP」 도입부와 같은
규칙, `agent-registry.mjs`의 쓰기 범위).

`bindings`가 빈 문서는 **유효하다**. 수집은 끝났고 바인딩 전이라는 정상 상태이며, 그때
미바인딩 근거는 전부 `unbound.references`에 있다.

**기계 게이트가 서는 자리는 Phase 2 → 3 하나다.** `validate-handoff-readiness.mjs --to design`이
같은 검사를 갖지만 **그것을 부르는 계약 문장이 아직 없다**(`protected-core.md` §4 「단계 인계
판정」 한계 ③ — 이 계약보다 앞선 부채다). 그래서 Phase 1 → 2에서 `unbound`·`pending`은
사람이 보고 확정하는 항목이고, 기계가 막는 것은 그다음 인계다. **여기서 "Phase 2에 못 들어간다"고
쓰지 않는다** — 부르지 않는 검사를 게이트라 부르면 그 문장이 곧 I1 위반이다.

수집 순서: **각 화면의 `default` 조건부터 전부, 그다음 조건 분기.** Figma MCP는 seat 등급별
호출 한도가 있어 노드가 많으면 절단되는데(`source-artifacts.md` 「호출 한도」), 이 순서가 아니면
default 없이 error 프레임만 남은 상태가 만들어진다.

## 6. 기계가 무엇을 잡고 무엇을 못 잡는가 <!-- 프록시 등록: protected-core §4 -->

**잡는 것**(`validate-handoff-readiness.mjs --to design|development`의 `design-binding`):

- 문서 형식과 참조 무결성 — 알 수 없는 `referenceId`, 중복 조건, 어긋난 `unbound`
- 미결 — `unbound.references`·`unbound.pageGroups`·`resolution: pending`
- 기획 ↔ 기록의 화면 집합을 **양방향으로** 대조한다 (`PAGE-000` 제외 — 전역 책임은 화면 근거를
  요구하지 않는다). 기획에 있으나 기록에 없는 화면과, **기획에 없는데 기록에만 있는 화면**
  둘 다 구멍이다 — 후자를 안 보면 유령 화면에 근거를 붙여 `unbound`를 비우는 우회가 열린다
- 발산 — `visual-qa-contract.json`과 같은 id가 서로 다른 것을 가리키면 receipt 단계에서 거부
  (`visual-evidence-lib.mjs`)

**못 잡는 것 — 프록시임을 먼저 적는다.** 전부 `protected-core.md` §4에 등록한다.

1. **선언이 옳은가.** `PAGE-002`에 엉뚱한 프레임을 적어도 통과한다. 기계가 판정하는 것은
   *선언이 있었고 끝까지 이어졌는가*이며, *옳은가*는 승인 체크포인트의 사람 몫이다.
2. **조건 단위 커버리지.** 분모인 `ux-brief`의 「화면별 정보 위계」 표는 **존재만 검사되고
   칸이 비어도 통과한다**(`checkDesignInputs`의 기존 한계). 그래서 조건을 0개 선언하면 덮을
   조건도 0개가 되어 `0/0`으로 통과한다 — 조건을 **안 적는 것이 통과하는 길**이다.
   이 커버리지는 지금 **정보성 보고**이며, 게이트로 올리는 것은 그 표의 빈 칸을
   `NEEDS_DECISION`으로 잡는 `plan-reviewer` 강화 이후다. 분모가 서기 전에 올리면 게이트가
   아니라 우회 유인이 된다.
3. **파일을 아예 안 쓰면 통과한다.** `SKIPPED` 조건은 `DESIGN_SOURCE: supplied`가 아니라
   **파일 부재**다. 공급원 마커(`_workspace/web-harness.md`)를 읽는 기계 소비자가 아직 없기
   때문이며(`provenance-contract.md` §5 한계), 가장 싼 우회는 빈 문서가 아니라 무문서다.
4. **근거 몰아넣기.** 한 조건에 근거 15개를 전부 넣으면 `unbound.references`가 비어 통과한다.
   binding당 근거 수에 상한이 없고, 상한을 두는 것이 옳은지도 아직 모른다(한 화면이 시안
   여러 장으로 명세되는 것은 정상이다).
5. **전면 `derive`.** 모든 화면에 `{state: default}, resolution: derive` 한 행씩 적으면
   공급물이 하나도 붙지 않은 채 통과한다. `derive`는 결정이므로 원칙상 허용되나, 그 결정을
   받는 자리는 지금 `layout-designer`의 산문 지시뿐이다 — `design-approval-contract.md`의
   B-목록 승인으로 올리는 배선은 **단방향 참조이며 미구현**이다.
6. **조건 어휘의 실제 일치.** §2는 `state`·`modeId`가 `visual-qa-contract.json`과 같은
   문자열이어야 한다고 정하지만, 대조하는 것은 `references`뿐이다 — 조건 낱말이 어긋나도
   기계는 모른다.
7. **receipt는 바인딩 내용을 잡지 않는다.** `visual-evidence-lib`가 넣는 것은 발산 오류이며,
   binding 문서의 해시는 receipt payload에 없다. 승인 뒤 스냅샷 경로나 조건을 바꿔도 조용하다.

지금 이 계약의 정직한 표현은 **"조건 커버리지를 셀 수 있게 만든다"**이지 "조건 누락을 막는다"가
아니다.
