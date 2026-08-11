# Browser QA — Codex Changes Review Actions

## Result

PASS

- Hard-loaded `http://127.0.0.1:4310/?round=9#project=nocode-builder-0e2d5d16&tab=changes` after server restart.
- Snapshot showed CHG-20260806-002 `READY_FOR_REVIEW` with `승인`, `수정 요청`, `변경 폐기`; CHG-001 remained `PROPOSED`.
- Approval dialog identified CHG/target and terminal effect. Revision dialog exposed a required 2,000-character textbox and explained `Codex 수정 반영` linkage.
- Discard dialog explicitly stated that current workspace files are not automatically restored; cancel returned focus to the invoking discard button.
- Three actions measured 40px high, wrapped within 444px without horizontal overflow (`clientWidth=scrollWidth=444`).
- Browser warning/error log was empty.
- No decision was submitted and no live Codex run was started during browser QA; CHG-002 and its audit state remain unchanged.

## Round 10 — Feature revision history

- Loaded latest Console at `http://127.0.0.1:4320/#project=nocode-builder-0e2d5d16&tab=features&feature=FEAT-001` without changing the user's 4310 session.
- Existing approved `CHG-20260806-002` appeared under `승인된 변경 이력 · 1` with title, requested change, patch intent, `TC 3`, approved time and `APPROVED` text.
- Executing the history card navigated to `tab=changes&change=CHG-20260806-002` and focused the exact request article after the hash render settled.
- Executing the Changes Target returned to `tab=features&feature=FEAT-001` and restored the `도구 생성` detail.
- Browser warning/error log was empty. No review decision or Codex run was submitted during this round.

## Round 11 — Isolated candidate copy smoke

- Started the updated Console on temporary `4330/4331`, preserving the user's running `4310` server and tab.
- Loaded `#project=nocode-builder-0e2d5d16&tab=changes`; Changes, Codex connection, legacy apply result and approved revision history rendered successfully.
- Existing pre-candidate apply correctly remained a legacy result. Candidate dialog/list behavior is covered by API/UI contract tests; QA did not start a live impact/apply solely to manufacture browser state.
- At the 1280px viewport, `body.scrollWidth` equaled `documentElement.clientWidth` (1280); warning/error logs were empty.
- Closed the temporary browser tab and stopped only the temporary server. No request, run or review decision was submitted.

## Round 12 — Page-grouped Features

- 사용자 4310 세션은 유지하고 temporary `4340/4341`에서 갱신된 Console을 검증했다.
- Console 자체 기획 문서는 Page Group `순서`대로 `Workspace 개요`, `문서`, `기능`, `디자인 프리뷰`, `변경 관리`, `공통` 6개 section과 13 FEAT/47 TC를 표시했다. 각 section count는 2/1/5/1/3/1이었다.
- FEAT-013 선택 시 URL이 `tab=features&feature=FEAT-013`으로 갱신되고 상세의 `PAGE 기능`, 3개 TC가 유지됐다.
- Page Groups 표가 없는 nocode-builder 문서는 첫 `화면` component 기준 7개 section과 26 FEAT/53 TC로 fallback했고 FEAT-013은 `table-builder` section에 표시됐다.
- 1280px에서 `body.scrollWidth === viewportWidth === 1280`, Feature list `overflow-y: visible`, warning/error log 0이었다.
- temporary browser tab과 4340 server만 종료했다. 문서 rewrite, Change Request, Codex run, review decision은 수행하지 않았다.

## Round 13 — Viewport-equal Feature panes

- 사용자 4310 세션은 유지하고 temporary `4340/4341`에서 `#project=nocode-builder-0e2d5d16&tab=features&feature=FEAT-021`을 hard load했다.
- 1280×720 viewport에서 FeatureList와 FeatureDetail의 bounding rect는 모두 top 243.5px, bottom 696px, height 452.5px로 동일했다.
- 목록은 `scrollHeight/clientHeight=3797/453`, 상세은 `643/451`이고 둘 다 computed `overflow-y:auto`였다. 각 pane을 +80px 이동해도 body `scrollY=0`을 유지해 독립 scroll을 확인했다.
- deep link로 선택된 FEAT-021 카드는 list `scrollTop=2139`에서 목록 viewport 안에 자동 노출됐고 상세 제목/metadata가 같은 FEAT로 렌더됐다.
- `body.scrollWidth === viewportWidth === 1280`, browser warning/error log 0이었다.
- temporary browser tab과 server만 종료했다. 사용자 4310, Change Request, Codex run, review decision은 변경하지 않았다.

## Round 14 — Apply 전 Change Request 수정

- temporary 4350/4351에서 nocode-builder Changes와 `CHG-20260806-003`을 1280×720으로 hard-load했다. 사용자 4310은 유지했다.
- completed impact 카드에 `요청 수정`과 `변경 적용`이 함께 표시되고, 승인 완료 CHG-002에는 수정 action이 나타나지 않음을 확인했다.
- revision dialog는 기존 제목·요청·사유·기대 동작·minor intent를 정확히 prefill하고 immutable target `FEAT-020`, 현재 revision `원본`, 원본 보존·impact 만료 copy를 표시했다.
- submit하지 않고 취소했으며 dialog가 제거되고 CHG 카드로 돌아왔다. horizontal overflow 0, browser warning/error 0이었다.
- STALE 표시와 stale apply 차단은 mutation 없는 browser QA 대신 storage/API 통합 테스트의 `revision → CODEX_IMPACT_STALE → re-impact → candidate` evidence로 검증했다.
- 임시 tab과 4350/4351만 종료했다. 실제 revision, Codex run, candidate, review decision, 사용자 4310 state는 변경하지 않았다.

## Round 15 — Fixed-height Codex result panels

- 사용자 4310/4311 최신 서버에서 `#project=nocode-builder-0e2d5d16&tab=changes&change=CHG-20260806-002`를 1280×720으로 확인했다.
- READY_FOR_REVIEW 결과 panel은 `codex-run-panel is-scrollable`로 렌더됐고 `clientHeight=344`, `scrollHeight=606`, computed `block-size=345.594px`, `overflow-y:auto`였다.
- panel 위 wheel 입력으로 `scrollTop`이 0에서 220으로 이동하는 동안 body `scrollY=375`는 변하지 않아 내부 scroll containment를 확인했다.
- heading/status는 computed `position:sticky`였고 horizontal overflow는 0, browser warning/error log는 0이었다.
- CHG-003의 revision history와 `영향 검토 다시 실행` action이 기존대로 표시됨을 확인했다. Change Request, revision, Codex run, candidate, review decision mutation은 수행하지 않았다.

## Round 18 — 승인 전 Change Request 삭제

- 최신 4310/4311 서버를 재시작하고 `#project=nocode-builder-0e2d5d16&tab=changes`를 hard load했다.
- `INTERRUPTED` CHG-20260806-003과 `PROPOSED` CHG-20260806-001에는 `요청 삭제`가 표시되고, `APPROVED` CHG-20260806-002에는 삭제 action이 0개임을 확인했다.
- CHG-003 삭제 dialog는 exact CHG/FEAT와 원본·수정본·실행 기록·candidate 영구 삭제 및 복구 불가를 표시했다. 초기 focus는 안전한 `취소`였고 `영구 삭제`는 별도 destructive action이었다.
- 취소 후 open dialog 0개, request card 3개 유지, 원래 `요청 삭제` button focus 복원을 확인했다. browser warning/error log는 0개였다.
- QA는 `영구 삭제`를 실행하지 않아 사용자의 기존 CHG와 audit/candidate를 변경하지 않았다.
