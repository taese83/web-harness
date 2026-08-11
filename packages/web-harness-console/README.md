# Web Harness Console

`_workspace/00_source`, `01_plan`, `02_design` 문서와 디자인 프리뷰를 한 화면에서 확인하는 localhost 전용 도구입니다. 변경 의도를 append-only Change Request로 기록하고, 사용자가 승인한 요청은 로컬 실행기 CLI(Codex 또는 Claude Code)의 영향 검토·적용 작업으로 연결할 수 있습니다.

저장소 root에서 실행합니다.

```bash
pnpm console
```

## Skill로 운영

Codex/Claude skill 환경에서는 `/web-console`로 같은 서버를 안전하게 운영할 수 있습니다.

| 명령 | 동작 |
|---|---|
| `/web-console start` | 상태를 먼저 확인하고, 실행 중이 아닐 때만 Console과 preview 서버를 시작합니다. |
| `/web-console status` | 서버를 변경하지 않고 port, project index와 Codex CLI 연결 상태를 확인합니다. |
| `/web-console restart` | 현재 작업이 시작한 session을 정상 종료한 뒤 같은 root에서 다시 시작합니다. |
| `/web-console stop` | 현재 작업이 소유한 session을 종료하고 4310/4311 해제를 확인합니다. |

인자 없이 `/web-console`을 호출하면 먼저 `status`를 확인하고 필요한 다음 동작을 안내합니다. 이미 정상 실행 중이면 두 번째 process를 만들지 않고 `ALREADY_RUNNING`을 반환합니다. 다른 process가 4310을 사용하거나 서버 소유권을 확인할 수 없으면 자동 종료하지 않고 `PORT_CONFLICT` 또는 확인 요청으로 처리합니다. `pkill`, `killall`, broad process pattern은 사용하지 않습니다.

시작 후 `GET /api/projects`와 `GET /api/codex/status`를 조회해 indexed project 수와 Codex의 설치·인증·연결 상태를 검증합니다. Codex가 연결되지 않았더라도 Console 서버 상태와 구분해 원인을 보고하며 서버를 임의 종료하지 않습니다. 브라우저 열기와 특정 project/tab 이동은 별도 요청이 있을 때만 수행합니다.

- Console: `http://127.0.0.1:4310`
- Isolated preview origin: `http://127.0.0.1:4311`

## Executor

영향 검토·변경 적용은 로컬 CLI 실행기로 수행합니다. 기본값 `--executor auto`는 Codex CLI를 먼저 확인하고, 연결되지 않으면 Claude Code CLI(`claude`)를 사용합니다. `node packages/web-harness-console/server.mjs --root . --executor codex|claude-code|auto`로 고정할 수 있습니다.

페이즈별 모델은 서버 시작 시에만 `--impact-model <id>`·`--apply-model <id>`(선택)로 지정합니다. read-only 분류 작업인 impact를 저비용 모델로 라우팅해 토큰을 줄일 수 있고, 미지정 시 각 CLI의 기본 모델을 사용합니다. 사용된 모델은 run 기록의 `model` 필드에 남아 usage 수치와 함께 비교할 수 있습니다. browser는 여전히 model을 지정할 수 없습니다.

- Codex: `codex exec` + `--sandbox read-only|workspace-write` + `--output-schema`로 구조화 결과를 강제합니다.
- Claude Code: `claude --print --output-format json --json-schema`로 같은 구조화 결과 계약을 강제합니다. impact는 Read/Glob/Grep만 허용하고, apply는 server-created candidate 사본 안에서 파일 편집 도구까지 허용합니다. Bash·네트워크 도구는 양 단계 모두 차단하므로 apply의 targeted check는 실행되지 않고 `NOT_RUN:` 접두사로 보고됩니다.
- `/api/codex/status`가 활성 실행기를 `executor` 필드로 보고하고, 각 run 기록에도 실행 백엔드가 남습니다. 서버는 두 실행기 모두 저장된 CLI 인증만 사용하며 credential을 browser나 audit log에 노출하지 않습니다.

Features는 `feature-plan.md`의 `PAGE-NNN` Page Groups와 각 FEAT의 primary `페이지 그룹`을 읽어 페이지별로 표시합니다. 기존 문서에 Page Group이 없으면 `화면`의 첫 항목으로 그룹핑하고, 화면도 없는 Feature만 `미분류`로 유지합니다.

## Security boundary

- 두 서버 모두 `127.0.0.1`에만 bind합니다.
- API는 기본적으로 GET/HEAD만 허용합니다. POST는 append-only Change Request 생성·apply 전 수정본 추가, 승인된 Codex run enqueue, apply-run-bound 검토 결정 기록, 그리고 디자인 프리뷰 승인 기록으로 제한합니다.
- 프리뷰 승인 POST는 `UNAPPROVED` 상태에서만 허용되며, 요청 body의 source/preview digest가 서버가 재계산한 현재 digest와 일치해야 합니다(검토한 프리뷰만 승인). 기록은 canonical writer(`design-preview-status-lib.recordPreviewApproval`)가 `design-review.md`에 append-only marker로 남기고, Console발 승인은 `recordedVia: console-user-attested`로 하네스 세션 승인과 증거 출처를 구분합니다. STALE 재승인은 Console에서 불가하며 하네스 세션의 재생성 절차를 따릅니다.
- 문서는 인덱싱된 00/01/02 path allowlist로만 읽습니다.
- preview는 Console과 다른 origin에서 실행합니다.
- Change Request POST는 same-loopback Origin, intent header, bounded JSON, idempotency key를 검증합니다. 수정은 원본/target을 유지한 `REV-NNN` 이력이며 이전 영향도는 자동으로 만료됩니다.
- 서버가 Feature/Sub Feature/anchor 소유권과 TC/document/preview digest를 현재 index에서 다시 계산합니다.
- 요청 생성 단계는 `_workspace/01_plan/change-requests/CHG-*.md`만 exclusive-create합니다.
- Codex impact는 정본 read-only이며, apply는 완료된 impact와 별도 사용자 확인 뒤 server-created temporary candidate에서만 workspace-write로 실행합니다.
- READY_FOR_REVIEW 결정은 `_workspace/03_dev/change-request-decisions/`에 append-only로 남습니다. 승인·폐기는 terminal이고, 수정 요청은 다음 별도 승인 apply에 연결됩니다.
- 새 candidate는 `_workspace/03_dev/change-candidates/`의 bounded manifest/file bundle로 보존됩니다. 승인은 baseline digest를 다시 확인한 뒤 정본에 적용하고, 수정 요청·폐기는 정본을 변경하지 않습니다. candidate 도입 전 legacy direct apply에는 기존 복원 한계가 계속 표시됩니다.
- browser는 실행기(Codex/Claude Code) command/prompt/cwd/model/sandbox/tool 정책을 지정할 수 없고 danger-full-access, commit, push, PR, deploy, automatic retry는 제공하지 않습니다.

## Change Request flow

1. Features에서 기능을 선택하거나 Preview mapping 위치를 엽니다.
2. `변경 요청`에서 변경 내용·이유·기대 동작·version intent를 입력합니다.
3. Changes에서 `PROPOSED` 요청과 Codex 연결 상태를 확인합니다.
4. 실제 적용 전 요청을 정정하려면 `요청 수정`으로 수정본을 저장합니다. 기존 영향도 결과가 있으면 `STALE`이므로 다시 검토합니다.
5. `영향 검토`로 최신 요청 digest에 결합된 read-only 분석을 실행합니다.
6. 결과를 확인한 뒤 `Candidate 생성`을 별도로 승인하고, 격리된 변경 파일 목록을 검토합니다. 이 시점의 정본은 바뀌지 않습니다.
7. `READY_FOR_REVIEW`에서 승인하면 candidate를 정본에 적용하고, 수정 요청·변경 폐기는 정본을 그대로 유지합니다.
8. candidate 수정 요청이면 사유를 확인한 뒤 `Codex 수정 반영`을 다시 승인하고 새 결과를 검토합니다.
9. 승인된 CHG는 기존 Feature 상세의 `승인된 변경 이력`에 나타나며 Feature와 Changes 사이를 양방향으로 이동할 수 있습니다.

사용 가능한 실행기 CLI가 없거나 로그인되지 않았으면 Changes에 연결 필요 상태가 표시됩니다. 서버 process는 저장된 CLI 인증을 사용하지만 credential은 browser나 audit log에 노출하지 않습니다.

영향 검토는 현재 FEAT/TC/preview mapping과 관련 문서 metadata만 사용합니다. 요청·Plan·Design·preview digest가 완전히 같으면 이전 완료 결과를 새 audit에 재사용해 모델을 호출하지 않습니다. 변경 적용은 승인된 영향 파일과 인접 검증만 수행하며 전체 Harness/CI/install/build-all은 실행하지 않습니다. 결과 footer의 token 수치는 Codex가 제공한 값만 표시하고, 제공되지 않으면 `NOT_MEASURED`입니다. `TIMED_OUT`은 자동 재시도하지 않으므로 범위를 확인한 뒤 사용자가 `변경 적용 다시 실행`을 선택합니다.

## Verification

```bash
pnpm console:test
pnpm run console:check
```
