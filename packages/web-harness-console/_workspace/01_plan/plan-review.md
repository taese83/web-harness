# Plan Review

Result: PASS

- 제품 목표·사용자·성공 조건이 명확하다.
- 02_design 이후 산출물은 명시적으로 제외됐다.
- filesystem은 read-only이고 외부 데이터·인증·배포가 없다.
- preview origin 격리와 traversal 차단이 필수 acceptance criterion이다.
- Console-first 결정으로 Console 자체 디자인 프리뷰 승인은 후속이지만 구현 범위를 막지 않는다.

## 2026-08-07 재검토 부기 — mutation-era 범위 재확인

Result: PASS (재확인)

- 원 리뷰의 "filesystem은 read-only" 서술은 mutation 도입 이전 시점의 것으로 이 부기로 대체된다. 원문은 append-only 원칙에 따라 보존한다.
- Console은 현재 REQ-016~REQ-019와 PC-006/PC-008/PC-009/PC-011/PC-014에 따라 append-only Change Request 생성, append-only request revision, 승인 게이트 executor run, apply-run-bound review decision의 mutation endpoint를 가지며, PC-015에 따라 승인 전 요청의 물리 삭제가 추가되었다.
- 경계는 서버가 강제한다: loopback Origin/intent/idempotency gate, temporary candidate 격리, digest 검증 승격(`APPROVED`만 정본 반영).
- 2026-08-07 hardening commit ce7d4a6: GET 경로 decodeURIComponent crash → 400 `BAD_URL`, 양 서버 loopback Host 검증(403 `HOST_NOT_ALLOWED`), `change-requests`·`change-request-revisions`의 candidate snapshot/promotion 제외(`CANDIDATE_PATH_UNSAFE`), review endpoint validate→promote→append 재정렬. 증거: 당시 `pnpm run console:test` 34/34, `pnpm run ci` exit 0 (2026-08-07).
- 재확인 결과: 현재 mutation-era 범위 기준으로도 원 리뷰의 PASS verdict를 유지한다.
