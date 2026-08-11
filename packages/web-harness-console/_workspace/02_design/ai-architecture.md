# AI Architecture — Local Codex Execution Bridge

## Decision

공식 Codex의 non-interactive `codex exec`를 argv-only child process로 사용한다. App Server는 rich client에 적합하지만 WebSocket transport가 experimental이며, 이번 로컬 단일 사용자 자동 실행 범위에는 CLI adapter가 더 작고 검증 가능하다.

## Components

1. `CodexRunManager`: connection probe, per-project concurrency, timeout, cancellation-on-server-close.
2. `CodexCliAdapter`: server-owned cwd/prompt/schema/sandbox argv; shell 사용 금지. canonical impact는 Git repository 검사를 유지하고 `.git`을 의도적으로 제외한 server-created apply candidate에만 `--skip-git-repo-check`를 사용한다.
3. append-only run event store: `_workspace/03_dev/codex-runs/*.jsonl`; 00/01/02 catalog에는 노출하지 않는다.
4. Console API/UI: connection state, impact start, apply approval, polling, typed failure/result.
5. append-only review decision store: exact apply-run-bound `APPROVED|REVISION_REQUESTED|DISCARDED`; revision feedback is injected only by the server into the next approved apply.
6. `ChangeCandidateManager`: safe bounded snapshot → temporary candidate cwd → server-computed changed file bundle → digest-guarded canonical promotion.
7. append-only request revision store: immutable base CHG + latest effective fields + SHA-256 request digest; run snapshot과 apply authorization에 결합.
8. `ImpactContextBuilder`: current index의 target FEAT/TC/anchor, 최대 12개 관련 문서 metadata, source/preview digest로 16 KiB 미만 실행 manifest와 SHA-256 context key를 만든다.
9. completed `READY|ALREADY_APPLIED` impact cache: analyzer/request/project digest가 모두 같을 때 새 append-only audit를 만들고 model invocation을 생략한다.

## State machine

`PENDING → RUNNING → COMPLETED | FAILED | TIMED_OUT | INTERRUPTED`

- phase는 `impact|apply`다.
- impact `COMPLETED`가 없으면 apply는 시작할 수 없다.
- impact run의 `requestDigest`가 current effective request digest와 다르면 apply는 `CODEX_IMPACT_STALE`로 종료하고 process를 만들지 않는다.
- 새 impact run의 `impactContext.contextDigest`가 current project context와 다르면 apply도 stale로 거부한다. legacy audit는 기존 request-digest 호환 경계를 유지한다.
- server 시작 시 마지막 event가 terminal이 아닌 run은 `INTERRUPTED`로 읽고 자동 재개하지 않는다.

Review state is derived separately: `READY_FOR_REVIEW(candidate) → APPROVED(promoted) | REVISION_REQUESTED(not promoted) | DISCARDED(not promoted)`. Revision can start a new candidate from the unchanged canonical baseline. Approval/discard are terminal and block new runs.

## Normalized events

`run.started`, `output.delta`(메모리 bounded), `run.completed`, `run.failed`. 각 event는 runId, sequence, timestamp, schemaVersion, phase를 가진다. 공개 API는 raw reasoning/tool stream 대신 bounded final summary, threadId, status, allowlisted numeric usage, public impact-context/cache metadata만 반환한다.

## Model/provider boundary

Console은 모델/API key를 선택하거나 보관하지 않고 설치된 Codex CLI의 현재 인증과 기본 model routing을 재사용한다. browser bundle에는 credential이나 provider secret이 없다.
