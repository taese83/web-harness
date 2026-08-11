# Design Review

Result: PASS_WITH_DEFERRED_PREVIEW

- Information hierarchy: project → tab → artifact is stable and task-oriented.
- Mode separation: document inspection and preview interaction are separate tabs; Console remains read-only.
- Layout: persistent desktop navigation, stacked compact layout, fixed preview frame.
- Accessibility: semantic controls, focus-visible, text+shape status signals are specified.
- Security: preview executes on a different localhost origin.
- Deferred by explicit Console-first decision: Console 자체 design preview와 formal Preview Approval.

## 2026-08-07 Re-review addendum — mutation-era scope

Result: PASS_WITH_DEFERRED_PREVIEW (재확인)

- 원 리뷰의 "Console remains read-only" 서술은 mutation 도입 이전 시점 기준이며 이 부기로 대체된다. 원문은 보존한다.
- 현재 Console은 REQ-016~REQ-019와 PC-006/PC-008/PC-009/PC-011/PC-014/PC-015에 따른 mutation endpoint(append-only Change Request/request revision, 승인 게이트 executor run, apply-run-bound review decision, 승인 전 요청 삭제)를 가진다.
- Mode separation은 유지된다: document inspection·preview interaction은 여전히 read-only 경로이고, mutation은 loopback Origin/intent/idempotency gate, temporary candidate 격리, digest-guarded promotion 뒤에만 있다.
- 2026-08-07 hardening commit ce7d4a6이 이 경계를 서버에 추가 고정했다: malformed percent-encoding 400 `BAD_URL`, 양 서버 Host 검증 403 `HOST_NOT_ALLOWED`, append-only prefix의 candidate 제외(`CANDIDATE_PATH_UNSAFE`), validate→promote→append review 순서. 증거: 당시 `pnpm run console:test` 34/34, `pnpm run ci` exit 0 (2026-08-07).
- Deferred 항목(Console 자체 design preview, formal Preview Approval)은 그대로 유지된다.
