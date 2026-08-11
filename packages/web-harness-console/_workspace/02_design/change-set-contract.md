# Change Set Contract — Web Harness Console

## Purpose

Preview에서 발견한 변경을 기획·Test Case·디자인에 함께 반영할 수 있도록 검토 기준점과 사용자 의도를 먼저 고정하고 Codex impact/apply cycle로 연결한다.

## Lifecycle

`PROPOSED → IMPACT_REVIEW → IN_REVIEW → READY_FOR_REVIEW → APPROVED | REVISION_REQUESTED | DISCARDED`

`REVISION_REQUESTED → IN_REVIEW → READY_FOR_REVIEW`는 같은 Change Request 안에서 새 apply run으로 반복할 수 있다. `APPROVED`와 `DISCARDED`는 terminal이다.

별도의 보존 상태를 추가하지 않는다. active run이 없고 `APPROVED` 승격 전인 Change Request는 사용자 확인 후 원본과 연결된 임시 artifact를 물리 삭제할 수 있다. 삭제된 요청은 lifecycle이나 이력 read model에 남지 않는다.

- Console은 Change Request 원문을 `PROPOSED` append-only로 생성한다.
- apply 시작 전에는 editable request fields를 별도 append-only revision으로 정정할 수 있다. 원문·target context는 불변이며 최신 revision이 effective request다.
- revision은 기존 impact를 `STALE`로 만든다. 모든 run은 effective request digest를 고정하고 apply는 최신 digest와 결속된 completed impact만 허용한다.
- Codex impact 완료는 파생 상태 `IMPACT_REVIEW`, apply 실행 중은 `IN_REVIEW`, 결과 검토 가능 상태는 `READY_FOR_REVIEW`로 run audit에서 표시한다. 원문 metadata를 덮어쓰지 않는다.
- 완료된 impact 뒤 apply 승인은 정본 수정 권한이 아니라 격리 candidate 생성 권한이다. Codex는 temporary candidate workspace만 수정하고 Console은 서버가 계산한 bounded manifest/file bundle을 보존한다.
- 정본 문서 변경은 `READY_FOR_REVIEW` candidate를 사용자가 승인할 때만 수행한다. 서버는 apply 시작 당시 whole-project baseline digest와 current digest가 같은지 확인하고 candidate digest까지 적용됐을 때만 승인 결정을 기록한다.
- apply 시작 뒤 요청 거절·대체가 필요하면 기존 파일을 수정하지 않고 READY_FOR_REVIEW review loop 또는 후속 기록이 이전 Change Request ID를 참조한다.
- 검토 결정은 `_workspace/03_dev/change-request-decisions/<CHG>.jsonl`에 exact apply run ID와 함께 append-only로 기록한다. 같은 apply result에는 한 결정만 허용한다.
- 새 apply result는 영향 FEAT/Sub Feature/TC와 최종 source/preview digest를 구조화한다. 승인 시 target 포함·current ownership·digest 일치를 검증하고 immutable `featureLinks` snapshot을 decision event에 저장한다.
- 승인된 CHG는 정본 `feature-plan.md`를 이력 때문에 다시 쓰지 않고 Change Request+decision join으로 기존 Feature의 revision read model에 투영한다. legacy apply는 request context fallback임을 명시한다.
- `REVISION_REQUESTED` 사유는 다음 apply의 server-owned prompt에 untrusted feedback으로 결속되며 browser가 raw prompt를 만들지 않는다.
- `REVISION_REQUESTED`와 `DISCARDED`는 candidate 비채택 상태이며 정본 파일을 수정하거나 복원하지 않는다. revision은 동일한 current baseline에서 새 candidate를 만든다.
- 삭제는 Change Request 원본, 모든 revision, 해당 CHG 소유 run audit, review decision, candidate bundle을 한 단위로 제거한다. 승인 event가 하나라도 있거나 run이 active면 시작하지 않으며, 파일 이동 도중 실패하면 원래 위치로 rollback한다.

## Atomic Change Set

승인된 change cycle은 다음을 하나의 변경 단위로 취급한다.

1. Feature/Sub Feature 기획과 acceptance behavior
2. 연결 Test Case 추가·수정·supersede
3. component/layout/preview/traceability 디자인
4. 새 preview digest와 design version
5. 검증 evidence와 변경 journal

부분 반영은 `APPROVED` 또는 `RELEASED`로 표시할 수 없다.

## Version Semantics

- `patch`: 문구·시각 보정처럼 acceptance behavior가 유지되는 호환 변경 의도
- `minor`: 새 동작·상태·TC를 추가하는 호환 확장 의도
- `major`: 기존 behavior/contract를 제거하거나 비호환 변경하는 의도
- Change Request에는 intent만 기록한다. 승인 전에는 새 `design-v*`를 발행하지 않는다.
- 현재 preview가 versionless/unapproved여도 `status + sourceDigest + previewDigest`가 immutable review base다.

## Integrity Boundary

- path는 서버가 계산하며 client가 filename/directory를 지정하지 않는다.
- 현재 catalog에서 Feature/Sub Feature/anchor ownership과 TC/document context를 재검증한다.
- `wx` exclusive create와 idempotency key로 overwrite와 retry duplicate를 방지한다.
- request revision endpoint는 editable fields exact allowlist와 lifecycle(active/apply/review 없음)을 검증한다. revision path/sequence/digest는 server가 계산하며 원본 CHG와 target은 변경하지 않는다.
- request deletion endpoint는 same loopback Origin과 exact delete intent를 확인하고 body/path override를 허용하지 않는다. 서버가 검증한 CHG와 그 audit에서 파생한 run ID만 삭제 대상으로 삼으며 symlink·storage escape·승인 완료·active run을 거부한다.
- Source/Plan/Design/Preview 정본은 이 endpoint에서 절대 수정하지 않는다.
- Preview iframe의 drawer action은 `web-harness:request-change` schemaVersion 1 UI signal만 부모에 보낸다. Console은 exact preview origin·현재 iframe source·Feature/Sub Feature/anchor ownership을 current catalog에서 재검증하고, payload에서 TC·문서·digest·path를 받거나 신뢰하지 않는다.
- direct preview처럼 안전한 Console parent가 없으면 drawer action을 노출하지 않는다. 취소 acknowledgment는 같은 source/origin으로만 반환한다.
- Codex run endpoint는 exact loopback Origin·intent·idempotency·request ownership·phase transition을 재검증한다. CLI argv/cwd/prompt/sandbox는 server-owned이며 browser override를 허용하지 않는다.
- impact는 정본 read-only다. apply는 explicit L2 approval 뒤 server-created temporary candidate root만 workspace-write이며 정본 project root는 실행 cwd/writable root가 아니다. automatic retry, danger-full-access, commit/push/PR/deploy는 경로에 없다.
- candidate snapshot은 symlink를 거부하고 파일 수·총 입력 크기·changed file 수·changed bytes를 제한한다. `.git`, dependency/install output, build/cache와 Console audit/candidate 디렉터리는 복제·diff·승격에서 제외한다.
- candidate 승격은 manifest의 상대 경로와 before/after digest만 사용한다. current whole-project digest가 base와 다르면 `CANDIDATE_BASE_STALE`로 아무 파일도 적용하지 않는다. 승격 중 candidate digest가 맞지 않으면 touched file backup으로 즉시 복원하고 승인 event를 기록하지 않는다.
- review decision endpoint는 same loopback Origin·explicit intent·UUID idempotency·request/current apply ownership·READY_FOR_REVIEW를 확인한다. `APPROVED|DISCARDED` 뒤에는 새 Codex run을 차단한다.
- 승인 scope가 request target FEAT를 누락하거나 unknown FEAT/Sub Feature를 포함하거나 현재 catalog digest와 불일치하면 decision append 전에 typed 409로 거부한다.
