# Content Panel Components

Primary consumers: component-builder, data-ui-binder

## OverviewPanel

- metric cards: Source, Plan, Design, Features/TCs
- preview status explanation and recent change list

## DocumentExplorer

- phase groups 00/01/02, file buttons, selected state
- reader renders Markdown semantically without trusting raw HTML
- JSON/code/plaintext use `<pre><code>` and textContent

## FeatureList

- 목록은 `pageGroup.order` 순서의 page section으로 묶고 heading에 label, optional PAGE ID/route, FEAT count를 표시한다. 각 FEAT는 primary section 한 곳에만 나타난다.
- explicit Page Group이 없는 legacy Feature는 `screen-fallback`, 화면도 없으면 `미분류` section을 사용한다. unknown PAGE 참조도 FEAT를 숨기지 않고 raw PAGE ID heading으로 드러낸다.
- 좌측 FEAT 선택 button: title, ID, related TC count/chips, `aria-current`
- 우측 `FeatureDetail`: 기능 설명, priority/screen/scope metadata, Test Case Given/When/Then, related document actions, Preview anchor mapping status
- Preview anchor mapping이 있으면 native button card로 표시하고 실행 시 Preview 탭의 해당 route/anchor로 이동해 상세 drawer를 연다. 없으면 status/reason만 표시한다.
- Feature card와 mapping card의 test count는 `TC N` 형식으로 표시한다.
- 선택은 `feature`와 선택적 `subfeature` URL hash로 복원하며 unknown ID는 상위 Feature 또는 첫 Feature로 fallback
- `Sub Feature ID`가 있으면 상위 카드 아래 들여쓴 계층 버튼으로 표시한다. 상위 선택은 전체 TC/anchor 집계, 하위 선택은 그 책임에 연결된 TC/anchor subset만 상세에 표시한다.
- 하위 상세에는 상위 FEAT ID를 함께 표시하며 schema v1 프로젝트는 기존 평면 목록을 유지한다.
- 904px 이하에서는 목록 위·상세 아래의 단일 열로 reflow
- 905px 이상에서는 FeatureList와 FeatureDetail이 남은 viewport를 같은 높이로 채우고 각각 내용 overflow만 독립 스크롤한다. 선택 FEAT/Sub Feature는 deep link/재렌더 뒤 `nearest` 위치로 자동 노출하며, body document는 Features 탭 동안 스크롤하지 않는다.
- 904px 이하 compact에서는 두 pane의 고정 높이·중첩 scrollbar를 해제하고 기존 단일 page scroll과 목록→상세 순서를 유지한다.
- no feature-plan empty state
- 상세 header의 `변경 요청` button은 선택된 Feature/Sub Feature context로 `ChangeRequestDialog`를 연다.
- 상세의 `승인된 변경 이력`은 현재 Feature의 `approvedChanges[]`를 최신 승인 순으로 표시한다. Sub Feature 상세은 해당 Sub Feature를 명시한 변경만 표시하며, 카드 실행 시 Changes 탭의 exact CHG card로 이동하고 focus한다.

## PreviewPanel

- status chip and reason, isolated-origin iframe with title
- 선택된 mapping이 있으면 iframe URL에 encoded anchor query, 선택적 `fixtureId`/`fixtureMode`, 검증된 `#/` route를 결합한다. Console은 cross-origin DOM에 접근하지 않는다.
- `fixtureMode=isolated-reset` mapping은 preview가 매 진입마다 결정론적 상태를 메모리에만 준비한다. destructive flow를 수행해도 일반 preview의 localStorage는 읽거나 쓰지 않으며 iframe을 다시 열면 같은 초기 상태로 복구된다.
- desktop에서는 PreviewPanel만 남은 viewport에 맞춰 늘어나며 바깥 document scrollbar를 만들지 않는다. 프리뷰 내용의 스크롤 책임은 iframe 내부에 둔다.
- MISSING/INVALID/absent has explicit recovery copy; never labels it approved
- 선택된 mapping이 있으면 toolbar의 `변경 요청` button이 anchor/route까지 context에 포함한다.
- iframe 안 `FeatureDetailPanel`의 고정 footer에도 `변경 요청` button을 둔다. Preview는 `schemaVersion`, `featureId`, nullable `subFeatureId`, `anchorId`만 부모에 전달한다. Console은 현재 `.preview-frame`의 `contentWindow`, exact `previewOrigin`, message schema, current catalog ownership이 모두 일치할 때만 기존 `ChangeRequestDialog`를 연다.
- drawer action으로 연 dialog를 취소하면 Console이 같은 iframe에 close acknowledgment를 보내고 Preview가 action button으로 focus를 복귀한다. 요청 생성 성공 시에는 Changes로 이동하므로 iframe focus를 복구하지 않는다.

## ChangeRequestDialog

- native modal dialog, labelled title, Esc/cancel, close 후 trigger focus 복원
- read-only context: Feature/Sub Feature, preview anchor/route, 연결 TC, 관련 문서, preview status/digest
- inputs: title, requested change, reason, expected behavior, version intent (`minor` default)
- submit은 한 개의 append-only request만 생성하며 canonical docs를 수정하지 않는다는 boundary copy를 표시
- submitting/error/success state를 색상 외 텍스트로 전달하고 중복 submit을 막는다.
- Preview drawer에서 시작해도 Feature/Sub Feature/anchor/TC/digest는 message payload가 아니라 현재 Console catalog에서 다시 파생한다.

## ChangesPanel

- 상단 `CodexConnectionPanel`: connected/version/authenticated 또는 연결 필요 reason/recovery copy
- persistent Change Request cards: ID/lifecycle/target/version intent/base preview reference/request summary
- apply 전 card는 `요청 수정` action과 current revision ID/count를 표시한다. revision dialog는 effective request fields를 prefill하고 target을 읽기 전용으로 유지하며, 저장 시 원본 보존·impact 만료를 설명한다.
- `APPROVED` 전이고 active run이 없는 card에는 destructive `삭제` action을 표시한다. native confirmation은 CHG ID와 “요청·수정본·분석/적용 후보가 영구 삭제되고 복구할 수 없음”을 명시하며 별도 사유를 요구하지 않는다. 확인 성공 후 card/count를 다시 불러오고 삭제한 card가 선택된 경우 selection hash를 제거한다. 취소·Esc는 삭제하지 않고 trigger focus를 복원한다.
- 수정 이력 disclosure는 revision ID·시간·제목을 순서대로 표시한다. 기존 impact가 최신 request digest와 다르면 `STALE` copy와 `영향 검토 다시 실행`을 표시하고 apply action은 숨긴다.
- Target은 button link로 표시하고 실행 시 해당 Feature/Sub Feature 상세로 이동한다.
- run이 없으면 `영향 검토`, impact running이면 progress, completed이면 bounded summary/affected artifacts/risks/thread ID와 `변경 적용` action
- result footer는 측정 token input/cache/output/total 또는 `NOT_MEASURED`를 표시한다. semantic impact cache는 `캐시 재사용 · 모델 호출 없음`과 context document/byte 규모를 표시하고 시작 toast도 재사용임을 알린다.
- affected files·risks·blockers·candidate 목록이 있는 completed result panel은 viewport 대응 320~480px 고정 높이와 내부 세로 스크롤을 사용한다. heading/status는 panel 안에서 sticky이며 pending/error/summary-only는 자연 높이를 유지한다.
- apply는 native modal dialog에서 target/impact/candidate write scope/no commit·push를 재확인하고 명시 승인 후 시작한다. 정본은 검토 승인 전 수정되지 않는다고 설명한다.
- apply가 `READY_FOR_REVIEW`이면 카드 footer에 `승인`, `수정 요청`, `변경 폐기`를 같은 단계의 선택 action으로 표시한다. 세 action은 각각 labelled native dialog를 열고 닫힘 뒤 trigger focus를 복원한다.
- 승인 메모는 선택, 수정·폐기 사유는 필수다. 결과 panel은 server-computed candidate changed file kind/count를 표시한다. 승인 dialog는 candidate를 정본에 적용함을, 수정·폐기 dialog는 정본이 변경되지 않음을 명시한다.
- 결정 chip/panel은 `APPROVED|REVISION_REQUESTED|DISCARDED`, 사유, 시간을 색상 외 텍스트로 표시한다. terminal 결정은 action을 제거한다.
- `REVISION_REQUESTED` 카드에는 `Codex 수정 반영`을 표시한다. apply dialog가 기존 impact와 수정 사유를 함께 보여주고 별도 L2 승인을 받은 뒤 새 apply를 시작한다.
- failed/timed-out/interrupted는 색상 외 status/copy를 표시하고 자동 retry하지 않는다. 동일 action을 다시 누르는 수동 recovery만 제공한다.
- timeout도 종료 전 관측된 token usage가 있으면 결과 footer에 유지한다. 재실행은 기존 audit를 덮어쓰지 않고 새 run이다.
- polling은 Changes에 active run이 있을 때만 수행하고 stale response가 다른 project state를 덮지 않는다.
- added/modified/removed groups, line count delta, changed block preview when bounded
- unchanged empty state explains baseline is server start time
