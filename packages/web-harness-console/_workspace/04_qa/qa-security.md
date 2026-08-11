# Security QA — Approval-gated Isolated Candidates

## Result

PASS

Local Iterate diagnostic only. The custom Console profile is `PROFILE_NOT_DETECTED` and is not release-attested.

## Commands

| Check | Command | Exit Code | Status |
|---|---|---:|---|
| package syntax | `pnpm --filter @web-harness/console check` | 0 | PASS |
| package tests | `pnpm --filter @web-harness/console test` | 0 | PASS (23/23) |
| root CI | `pnpm run ci` with pinned Node 22.22.3/pnpm 11.18.0 | 0 | PASS (Harness 55 checks) |
| AI static ladder | `node .claude/scripts/test-ai-harness.mjs --through eval-contracts` with pinned Node 22.22.3/pnpm 11.18.0 | 0 | PASS |

## API Surface Matrix

| Endpoint | Method | Guard | Validation/resource bound |
|---|---|---|---|
| `/api/projects/:id/change-requests` | POST | loopback Origin + create intent | 16 KiB, UUID idempotency, current Feature ownership, exclusive create |
| `/api/projects/:id/change-requests/:requestId/revisions` | POST | loopback Origin + revise intent | 16 KiB, exact fields, UUID idempotency, pre-apply lifecycle, exclusive create, request digest invalidation |
| `/api/projects/:id/change-requests/:requestId` | DELETE | loopback Origin + delete intent | no body/path override, exact CHG ownership, active/APPROVED block, contained transactional artifact removal |
| `/api/codex/status` | GET/HEAD | loopback bind | binary/version/login probe only; no credential value |
| `/api/projects/:id/change-requests/:requestId/codex-runs` | POST | loopback Origin + run intent + explicit apply approval | exact body allowlist, current request/impact ownership, one active run, bounded timeout/output, no retry |
| `/api/projects/:id/change-requests/:requestId/review-decisions` | POST | loopback Origin + review intent | 16 KiB body, UUID idempotency, latest READY apply binding, one decision/apply, terminal block |
| preview origin | GET/HEAD | separate loopback origin + realpath | remains read-only |

## Findings

| Severity | Evidence | Risk | Owner | Acceptance Criteria |
|---|---|---|---|---|
| None | No open finding in the changed boundary | — | — | — |

## Checks Performed

- Browser cannot submit prompt, command, cwd, model, sandbox, environment or writable roots; unsupported fields return 400.
- Child process uses an argv array with `shell:false`; impact is canonical `read-only`, apply is server-created temporary candidate `workspace-write`. `danger-full-access`, `--add-dir`, commit/push/PR/deploy are absent.
- Apply requires a completed impact owned by the same project/request plus the exact approval marker from a dedicated dialog.
- Request revision is server-path-derived and append-only, preserves the original CHG and immutable target, rejects active/apply/review states, and invalidates prior impact through a SHA-256 request digest checked again at apply.
- Connection probe handles Codex login status emitted on stderr without exposing the output or tokens to browser state.
- Child environment is allowlisted and excludes API/token-shaped variables; raw JSONL/reasoning/tool output is not persisted or returned.
- One active process, 5/20 minute timeouts, 1 MiB process-local capture, bounded structured result and zero automatic retries limit denial-of-wallet/process risk.
- Audit path is realpath-contained under `_workspace/03_dev/codex-runs`; 00/01/02 catalog and Preview permissions are unchanged.
- Review event uses no-follow append under `_workspace/03_dev/change-request-decisions`, hides idempotency keys, bounds reason to 2,000 characters and never rewrites CHG/run records.
- Existing malformed, unsafe or oversized review audit fails closed and is not appended or overwritten.
- Revision feedback is delimited as untrusted; discard does not invoke Git restore/reset, a model run or file deletion.
- Approval feature links are server-derived and append-only. Structured results must retain the request target, reference current known Feature/Sub Feature ownership, and match current catalog digests when both sides provide them; mismatches fail before write.
- Existing pre-Round-10 apply audits do not gain invented result fields. Their approval projection is explicitly marked `request-context-legacy`.
- Candidate snapshot rejects symlinks, non-regular files, unsafe/excluded paths and file/byte budget overflow. Audit/candidate directories, `.git`, dependency and build caches are excluded.
- Candidate changed files are computed by the server rather than trusted from model output. The public API exposes bounded path/kind/size metadata, not temporary paths or file contents.
- Approval validates the whole-project base digest, manifest transitions, content digests and final tree digest. Partial promotion errors restore only touched files from a complete pre-write backup and do not append the review decision.
- `REVISION_REQUESTED|DISCARDED` never promote or restore candidate content, so canonical files remain unchanged. Existing candidate-less direct apply audits retain explicit legacy messaging.
- Non-Git execution is allowed only for `phase=apply` because the bounded server-created candidate excludes `.git`; canonical impact retains the repository trust check. The flag does not bypass the workspace-write sandbox, add writable directories, or permit danger-full-access.
- Impact model input은 server-indexed FEAT/TC/anchor와 bounded document metadata로 축소되고 broad enumeration을 금지한다. cache key는 analyzer/request/project/preview digest에 결속되어 stale evidence를 재사용하지 않는다.
- Apply prompt는 approved affected files, 직접 필요한 trace/journal, targeted checks만 허용한다. 범위 부족은 BLOCKED이며 root Harness/full CI/install/build-all로 자동 확장하지 않는다.
- Token telemetry는 JSONL의 non-negative integer allowlist만 audit/public model에 복사한다. raw event, prompt, reasoning, unknown provider metadata와 금액 추정은 계속 비공개다.

## Accepted Local Constraints

- The model can edit any snapshotted regular file inside the temporary candidate, subject to source/change budgets. It cannot alter the canonical project before review approval.
- Candidate bundles are local audit artifacts without signing or encryption. A local actor already able to modify the project can tamper with them; promotion still validates paths, content and whole-tree digests but this is not a remote trust boundary.
- Promotion and append-only decision recording use rollback compensation, not a crash-atomic database transaction. Process/host loss between file promotion and decision append requires digest-based operator recovery.
- Candidate retention cleanup and concurrent merge are intentionally out of scope. External deployment or multi-user use remains prohibited without authentication, authorization, rate limits and a supported durable worker boundary.

## Round 14 — Request revision security delta

- RESULT: PASS for storage and API integration; capability escalation is limited to one same-origin localhost mutation endpoint under the existing 16 KiB/idempotency boundary.
- PASS: malicious Origin and wrong media type return 403/415; unsupported fields and unchanged bodies fail; private revision keys are absent from the read model.
- PASS: original CHG remains byte-identical, revision directory rejects unsafe/symlink boundaries, and revision filename/path/sequence/previous digest are validated on read.
- PASS: prior impact cannot authorize apply after revision (`CODEX_IMPACT_STALE`); re-impact snapshots the latest digest/revision and prompt points to both immutable base and latest append-only revision.
- EVIDENCE: Console syntax and 27/27 tests, full root CI including adapter parity/toolchain/Harness/AI eval-contracts, browser overflow/log checks and `git diff --check` PASS.

## Round 18 — Pre-approval hard-delete security delta

- RESULT: PASS. 물리 삭제 capability는 same-origin localhost의 exact project/CHG endpoint 하나로 제한되며 client가 artifact path, run ID, command 또는 body를 전달할 수 없다.
- PASS: matching artifact마다 dedicated storage root containment와 regular-file/safe-directory/no-symlink를 검증한다. exact CHG filename prefix만 수집하므로 인접 Change Request artifact는 유지된다.
- PASS: selected CHG의 PENDING/RUNNING run 또는 어느 `APPROVED` decision도 409로 차단한다. `DISCARDED|REVISION_REQUESTED`는 정본 승격이 없으므로 삭제 가능하다.
- PASS: same-filesystem staging 중 injected move failure는 이동된 artifact를 역순 복원하고 transient directory를 제거한다. 성공 시 tombstone·reason·cancellation event를 남기지 않는다.
- EVIDENCE: storage negative/rollback 4 cases, catalog lifecycle/API Origin·intent·body·ID/replay assertions, Console 42/42, pinned Node 22.22.3/pnpm 11.18.0 root CI, Harness 55와 AI eval contracts 31 PASS.

## Round 19 (2026-08-07) — P0 hardening delta (commit ce7d4a6 소급 기록)

- RESULT: PASS — Local Iterate diagnostic evidence only; custom Console profile은 여전히 `PROFILE_NOT_DETECTED`이며 release attestation이 아니다. 대상 커밋 ce7d4a6은 Round 18(삭제 기능)보다 먼저 커밋되었으나 QA 기록이 누락되어 여기 소급 부기한다.
- FIXED: GET 경로의 malformed percent-encoding(`/api/projects/%zz`)이 decodeURIComponent 예외로 process를 죽이던 crash를 400 `BAD_URL` typed 응답으로 봉합했다.
- FIXED: Console/Preview 양 서버에 loopback Host header 검증을 추가했다. DNS-rebinding 기반 read 접근은 403 `HOST_NOT_ALLOWED`로 차단된다.
- FIXED: `_workspace/01_plan/change-requests`·`change-request-revisions`를 candidate snapshot/promotion 제외 prefix에 추가해 append-only 계약을 서버가 강제한다. promotion은 해당 경로를 `CANDIDATE_PATH_UNSAFE`로 거부하고, 새 CHG 생성은 기존 candidate를 stale로 만들지 않는다.
- FIXED: review endpoint를 prepare/commit 분리로 validate→promote→append 순서로 재정렬했다. invalid body는 정본 승격 전에 거부되며 `recordChangeRequestReview` compatibility wrapper는 유지된다.
- EVIDENCE: 당시 `pnpm run console:test` 34/34 PASS(신규 회귀 3 포함), `pnpm run console:check` PASS, root `pnpm run ci` exit 0 (2026-08-07). isolated 4320/4321 browser에서 `/api/projects/%zz` 400 후 서버 생존, catalog 기반 preview fallback route 렌더, console error 0.

## Round 20 (2026-08-07) — Claude Code executor security delta

- RESULT: PASS — Local Iterate diagnostic evidence only.
- ADDED: 실행기 어댑터(`--executor auto|codex|claude-code`). browser는 실행기 선택·command·prompt·cwd·model·tool 정책을 지정할 수 없고 서버 시작 플래그로만 고정된다.
- ADDED: Claude Code 경로는 `--print --output-format json --json-schema`로 Codex `--output-schema`와 동일한 구조화 결과 계약을 강제한다. impact는 `Read,Glob,Grep`만, apply는 candidate 사본에서 파일 편집 도구까지 허용하고 Bash/PowerShell/WebFetch/WebSearch/Agent/Task는 양 단계 모두 `--disallowedTools`로 차단한다.
- BOUNDARY: child env allowlist에 `ANTHROPIC_API_KEY`·`ANTHROPIC_AUTH_TOKEN` 등이 추가되었으나 child process에만 전달되고 browser·audit log에는 노출되지 않는다. 연결 프로브(`--version`, `auth status`)는 토큰을 소비하지 않는다.
- EVIDENCE: `pnpm run console:test` 42/42 PASS(claude 프로브 3상태·argv 도구 정책·구조화 출력/오류 파싱·auto 폴백 디스패치 신규 4 테스트 포함), root `pnpm run ci` exit 0 (2026-08-07). 실제 머신 browser에서 auto 프로브가 Claude Code 2.1.223 CONNECTED를 보고. live model run은 QA에서 시작하지 않아 provider token·latency·candidate 품질은 `NOT_MEASURED`.
