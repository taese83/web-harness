# Layout Spec — Web Harness Console

## Desktop ≥1240

- 264px project sidebar
- fluid main: 64px header + tab bar + content
- Documents tab: 280px document tree + fluid reader
- Preview tab: status header + viewport-filling preview frame

## Tablet 905–1239

- 224px sidebar, document tree 240px
- metric cards 2 columns

## Compact <905

- project navigation becomes horizontal scroll region above content
- document tree and reader stack vertically
- preview minimum height 560px; no control is hidden behind hover
- Features는 선택 목록 위·상세 패널 아래의 단일 열로 reflow

## Routes and State

- single page; URL hash stores `project`, `tab`, optional document path, selected Feature ID, optional Sub Feature ID, Preview에서 열 mapping anchor ID, Changes에서 focus할 optional CHG ID
- tabs: Overview, Documents, Features, Preview, Changes
- browser back restores the previous project/tab/document selection
- mapping navigation은 Features → Preview로 이동하고 Preview iframe 안에서 route 복원·anchor scroll·drawer open을 수행한다.
- Features 상세, Preview toolbar, Preview FEAT/TC drawer의 `변경 요청` action은 현재 selection context를 유지한 Console modal dialog를 연다. drawer action은 panel test list 아래 sticky footer에 두고 320 CSS px에서도 닫기·시나리오 스크롤과 겹치지 않는다. 성공 후 Changes로 이동해 생성된 `PROPOSED` 항목에 focus한다.
- Changes는 Codex connection panel, persistent Change Requests와 run action/result, server-start 기준 file diff 순으로 표시한다.
- Features 상세은 설명 다음에 승인된 CHG revision 이력을 배치하고 Test Case·관련 문서·Preview mapping을 이어 표시한다. 이력 카드는 Changes의 exact CHG로 이동한다.
- Changes request card의 Target은 Features의 원래 FEAT/Sub Feature로 돌아가는 양방향 탐색 control이다.
- request card action은 desktop에서 card footer 우측, compact에서는 full-width로 reflow한다. impact result는 bounded plain text/list로 표시해 raw terminal scroll 영역을 만들지 않는다.
- 긴 Codex result panel은 `clamp(320px, 48vh, 480px)` 높이 안에서 독립 스크롤하고 heading/status를 상단에 고정한다. request card와 body는 결과 목록 길이 때문에 무제한 확장되지 않으며 short state는 불필요한 빈 높이를 만들지 않는다.
- apply 전 `요청 수정`은 같은 action footer에 배치한다. native revision dialog는 current fields와 immutable target, 저장 후 impact 재검사 필요성을 한 화면에 표시하고 닫힘 뒤 trigger focus를 복원한다.
- revision history는 접을 수 있는 card 내부 목록이며 STALE impact warning과 재검사 action은 작은 화면에서도 card 폭을 넘지 않는다.
- apply confirmation은 target·impact summary·temporary candidate workspace boundary·정본 무변경·금지된 Git/external action을 한 화면에서 확인하고 취소 시 trigger focus를 복원한다.
- READY_FOR_REVIEW card는 candidate changed file 요약 뒤 승인·수정 요청·변경 폐기 action을 wrap 가능한 한 행으로 표시하고 compact에서는 full-width 세로 stack으로 reflow한다. review dialog는 CHG/target, 승인 시 정본 승격, 수정·폐기 시 정본 무변경, required reason을 표시한다.
- revision feedback panel과 decision panel은 card 폭을 넘지 않으며 긴 사유를 줄바꿈한다. 새 revision apply dialog는 impact와 수정 요청 사유를 함께 보여준다.
- Features 목록은 `FEAT-NNN` 상위 카드 아래에 선택적 `FEAT-NNN-NN` 하위 카드를 들여써 책임 계층을 유지한다.
- Features 목록의 최상위는 `PAGE-NNN` page section이다. page order → FEAT 원문 order → Sub Feature 원문 order를 유지하고 heading에 page label/route/count를 표시한다. legacy screen fallback과 `미분류`도 동일 section layout을 사용한다.
- desktop Features 탭은 header·tabs·section heading을 제외한 남은 viewport 높이를 목록과 상세이 동일하게 채운다. 두 pane은 각각 독립 세로 스크롤을 사용하며 body document는 잠근다. deep link/선택 변경 시 선택 FEAT/Sub Feature가 목록 viewport 안에 자동 노출된다.
- desktop Preview 탭은 Console 바깥 document의 세로 overflow를 잠그고 iframe에 남은 viewport 높이를 할당한다. compact layout은 page scroll을 유지한다.

## Layout Stability

- loading skeleton reserves sidebar and content dimensions
- status/banner occupies fixed minimum height
- preview absent/available states use the same frame container
- Change Request dialog는 target context와 form action 영역을 예약하며 validation copy로 인한 control 이동을 최소화한다.
- review decision action은 submitting 중 중복 입력을 막고 dialog 닫힘 뒤 원래 card button으로 focus를 복원한다.
- page group heading은 긴 label/route가 있어도 360px 목록 폭을 넘지 않고 FEAT selection/hash 변경 시 layout shift를 만들지 않는다.
- Features 두 pane은 내용 길이가 달라도 같은 computed height를 유지하며 scrollbar 출현으로 목록 카드 폭이 흔들리지 않도록 gutter를 예약한다.
