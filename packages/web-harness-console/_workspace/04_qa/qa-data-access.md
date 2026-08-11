# AI Data Access QA — Codex Run Bridge

## Result

PASS

- Project root is selected from the current server catalog, never from browser input.
- Change Request and impact run ownership are resolved server-side.
- The service is loopback single-user; there is no remote tenant claim or cross-project writable root.
- Audit files are realpath-contained under the selected project's `_workspace/03_dev`.
- Browser cannot select applyRunId for a review decision; the server derives the latest owned apply and public projection omits idempotency keys.

## 2026-08-07 — 검증 근거 (test mapping)

2026-08-07 `pnpm run console:test` 42/42 PASS 기준으로 위 주장을 실제 테스트에 대응시킨다.

- "Project root는 server catalog에서 선택" — `server.test.mjs` 'console keeps canonical artifacts read-only and isolates its single append-only mutation boundary'(03_dev 문서 404, POST 405)와 `indexer.test.mjs`의 00/01/02 allowlist 검증.
- "Change Request·impact run ownership의 server-side 해석" — `codex-runs.test.mjs` 'impact is idempotent and apply requires its completed owned review and explicit approval', `server.test.mjs` 'Codex run endpoint is loopback-gated and separates read-only impact from approved apply'.
- "loopback 경계" — `server.test.mjs` 'malformed URL encoding and non-loopback Host headers are rejected without killing the server'(403 `HOST_NOT_ALLOWED`)와 첫 서버 테스트의 non-loopback Origin 403. 단, "single-user·no remote tenant claim" 자체는 구조 주장으로 테스트 미커버.
- "audit 파일의 `_workspace/03_dev` realpath 격리" — 직접 테스트 미커버. 인접 경계만 커버된다: `change-requests.test.mjs`의 symlinked append-only directory 거부 2건, `change-candidates.test.mjs` 'candidate snapshot rejects symlinks and promotion rejects a tampered traversal path'.
- "browser는 applyRunId 선택 불가·idempotency key 비공개" — `change-request-reviews.test.mjs` 'review decisions append once, bind to the exact apply run, and replay idempotently'(공개 projection의 idempotencyKey 부재 확인)와 `server.test.mjs`의 server-derived applyRunId 일치 확인.
