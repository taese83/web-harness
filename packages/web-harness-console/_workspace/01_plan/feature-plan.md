# Feature Plan — Web Harness Console

## Page Groups

| Page Group ID | 페이지 | Route/Screen | 순서 |
|---|---|---|---|
| PAGE-001 | Workspace 개요 | Overview | 1 |
| PAGE-002 | 문서 | Documents | 2 |
| PAGE-003 | 기능 | Features | 3 |
| PAGE-004 | 디자인 프리뷰 | Preview | 4 |
| PAGE-005 | 변경 관리 | Changes | 5 |
| PAGE-000 | 공통 | All | 99 |

## Feature List

| FEAT ID | Feature | Priority | 페이지 그룹 | Screen |
|---|---|---|---|---|
| FEAT-001 | 프로젝트 자동 탐색과 상태 요약 | Must | PAGE-001 | Console workspace |
| FEAT-002 | Source/Plan/Design 문서 탐색기 | Must | PAGE-002 | Documents |
| FEAT-003 | FEAT/TC 기능 목록 | Must | PAGE-003 | Features |
| FEAT-004 | 격리된 디자인 프리뷰 | Must | PAGE-004 | Preview |
| FEAT-005 | 승인·STALE 상태 표시 | Must | PAGE-001 | Overview/Preview |
| FEAT-006 | 세션 snapshot 변경 요약 | Must | PAGE-005 | Changes |
| FEAT-007 | 반응형·키보드 접근성 | Should | PAGE-000 | All |
| FEAT-008 | Feature 상세 선택과 추적 정보 확인 | Must | PAGE-003 | Features |
| FEAT-009 | 기획·TC·디자인 Change Set 요청과 이력 | Must | PAGE-003 | Features/Preview/Changes |
| FEAT-010 | Codex 영향 검토와 승인 기반 변경 적용 | Must | PAGE-005 | Changes |
| FEAT-011 | 적용 결과 검토 결정과 revision loop | Must | PAGE-005 | Changes |
| FEAT-012 | 승인된 변경과 기존 Feature revision 연결 | Must | PAGE-003 | Features/Changes |
| FEAT-013 | 페이지 대분류 기반 Feature 탐색 | Must | PAGE-003 | Features |
| FEAT-014 | UNAPPROVED 프리뷰의 Console 승인 기록 | Should | PAGE-001 | Overview |

### FEAT-008 하위 기능

| Sub Feature ID | 동작 | 관련 Test Case | 화면/영역 | 이번 범위 |
|---|---|---|---|---|
| FEAT-008-01 | 상위 Feature 상세와 전체 TC/Preview mapping 확인 | TC-008-1, TC-008-2, TC-008-3, TC-008-8 | Features / 상위 카드·상세 | 변경 |
| FEAT-008-02 | 하위 Feature 탐색과 책임별 TC/Preview mapping 확인 | TC-008-6 | Features / 계층 목록·상세 | 추가 |
| FEAT-008-03 | Preview mapping 실행, 격리 fixture 준비와 상세 drawer 자동 열기 | TC-008-4, TC-008-5, TC-008-7 | Features → Preview | 유지 |

### FEAT-009 하위 기능

| Sub Feature ID | 동작 | 관련 Test Case | 화면/영역 | 이번 범위 |
|---|---|---|---|---|
| FEAT-009-01 | 선택한 Feature·Sub Feature·Preview mapping 기준으로 변경 요청 생성 | TC-009-1, TC-009-2, TC-009-3, TC-009-4, TC-009-6, TC-009-7 | Features/Preview drawer / Change Request dialog | 추가 |
| FEAT-009-02 | 영구 변경 요청 이력과 기준 디자인/version intent 확인 | TC-009-5 | Changes | 추가 |
| FEAT-009-03 | apply 전 요청 수정본 저장·이력 확인과 impact 만료 | TC-009-8, TC-009-9, TC-009-10, TC-009-11 | Changes / request card·revision dialog | 추가 |
| FEAT-009-04 | 승인 전 변경 요청과 연결된 임시 산출물 물리 삭제 | TC-009-12, TC-009-13, TC-009-14, TC-009-15 | Changes / request card·delete confirmation | 추가 |

### FEAT-010 하위 기능

| Sub Feature ID | 동작 | 관련 Test Case | 화면/영역 | 이번 범위 |
|---|---|---|---|---|
| FEAT-010-01 | Codex CLI 설치·인증 연결 상태 확인과 복구 안내 | TC-010-1, TC-010-2 | Changes / connection panel | 추가 |
| FEAT-010-02 | bounded context·semantic cache 기반 read-only 영향 검토와 audit/result 확인 | TC-010-3, TC-010-4, TC-010-7, TC-010-9, TC-010-10 | Changes / request card | 변경 |
| FEAT-010-03 | 완료된 impact의 승인 범위만 사용해 격리 candidate 생성 | TC-010-5, TC-010-6, TC-010-8, TC-010-11, TC-010-12 | Changes / apply dialog·request card | 변경 |

### FEAT-011 하위 기능

| Sub Feature ID | 동작 | 관련 Test Case | 화면/영역 | 이번 범위 |
|---|---|---|---|---|
| FEAT-011-01 | READY_FOR_REVIEW candidate 승인·정본 승격과 terminal audit | TC-011-1, TC-011-4 | Changes / request card·review dialog | 변경 |
| FEAT-011-02 | 수정 사유 기록과 다음 Codex apply 연결 | TC-011-2, TC-011-5 | Changes / review·apply dialog | 추가 |
| FEAT-011-03 | candidate 폐기와 정본 무변경 보장 | TC-011-3, TC-011-4 | Changes / discard dialog·request card | 변경 |

### FEAT-012 하위 기능

| Sub Feature ID | 동작 | 관련 Test Case | 화면/영역 | 이번 범위 |
|---|---|---|---|---|
| FEAT-012-01 | 승인 시 영향 FEAT/Sub Feature/TC와 digest snapshot 검증·보존 | TC-012-1, TC-012-2, TC-012-3 | Review decision / read model | 추가 |
| FEAT-012-02 | Feature 상세에서 승인된 CHG revision 이력 확인과 Changes 이동 | TC-012-4, TC-012-5 | Features/Changes | 추가 |

## Test Cases

- TC-001-1: `_workspace`가 있는 root/workspace/packages 프로젝트만 목록에 나타난다.
- TC-001-2: 프로젝트별 source/plan/design 문서 수와 preview 상태가 표시된다.
- TC-002-1: 03_dev와 04_qa 파일은 API와 UI 어디에도 나타나지 않는다.
- TC-002-2: 허용된 문서는 본문을 읽을 수 있고 traversal path는 거부된다.
- TC-003-1: feature-plan의 FEAT ID와 관련 TC ID가 같은 feature card에 표시된다.
- TC-004-1: preview가 있으면 별도 origin iframe에서 열리고 없으면 empty state가 표시된다.
- TC-004-2: desktop Preview 탭은 바깥 document scrollbar 없이 남은 viewport를 iframe에 할당하고, iframe 내부 스크롤만 유지한다.
- TC-005-1: traceability 없는 legacy preview는 APPROVED가 아니라 MISSING으로 표시된다.
- TC-005-2: source/preview digest가 승인본과 다르면 STALE로 표시된다.
- TC-006-1: 서버 시작 후 문서 수정·추가·삭제가 refresh 뒤 변경 요약에 나타난다.
- TC-007-1: project/tab/document control을 키보드로 탐색할 수 있다.
- TC-007-2: 905px 이하에서 panes가 겹치거나 핵심 control이 사라지지 않는다.
- TC-008-1: Feature 카드를 클릭하거나 키보드로 실행하면 선택 상태와 상세 패널 제목이 같은 FEAT로 갱신된다.
- TC-008-2: 상세 패널에 기능 설명·우선순위/화면/범위·Test Case 상세·관련 문서·Preview 매칭 상태가 표시된다.
- TC-008-3: 선택한 FEAT ID가 URL hash에 기록되고 새로고침 후 복원되며 존재하지 않는 ID는 첫 Feature로 안전하게 대체된다.
- TC-008-4: Preview mapping card를 실행하면 Preview 탭으로 전환하고 매핑 route/anchor 위치를 연 뒤 해당 Feature 상세 drawer를 자동으로 표시한다.
- TC-008-5: Feature와 Preview mapping의 test count는 숫자만이 아니라 `TC N` 형식으로 의미를 표시한다.
- TC-008-6: `FEAT-NNN-NN` 하위 기능이 있으면 상위 카드 아래 계층 목록으로 표시되고, 선택 시 URL hash가 복원되며 해당 하위 기능의 TC와 preview anchor만 상세에 표시된다. 하위 기능이 없는 schema v1 프로젝트는 기존 상위 Feature 화면을 유지한다.
- TC-008-7: mapping에 `fixtureId`와 `fixtureMode=isolated-reset`이 있으면 Console은 iframe에 이를 전달하고 preview는 결정론적 fixture를 메모리에만 준비한다. 삭제·이름 변경 뒤 mapping을 다시 열면 fixture가 초기화되며 일반 localStorage 데이터는 읽거나 쓰지 않는다.
- TC-008-8: 905px 이상에서는 Feature 목록과 상세이 header·tabs·section heading 아래 남은 viewport를 같은 높이로 채우고 각각 독립 스크롤한다. URL hash 또는 선택 변경의 FEAT/Sub Feature는 목록 viewport 안에 자동 노출되고 body·가로 overflow를 만들지 않으며, 904px 이하에서는 단일 page scroll로 돌아간다.
- TC-009-1: Features 상세, Preview toolbar 또는 Preview FEAT/TC drawer의 변경 요청 action을 실행하면 현재 Feature/Sub Feature/anchor/route, 연결 TC, 관련 문서, preview digest가 읽기 전용 context로 표시된다.
- TC-009-2: 유효한 요청을 제출하면 `_workspace/01_plan/change-requests/` 아래에 정확히 한 개의 `PROPOSED` Markdown만 생성되고 기존 Source/Plan/Design/Preview 파일은 변경되지 않는다.
- TC-009-3: 허용되지 않은 Origin·intent, 잘못된 content type/body/Feature/anchor 요청은 typed 4xx로 거부되고 파일을 만들지 않는다.
- TC-009-4: 같은 idempotency key의 재시도는 기존 Change Request를 반환하고 중복 파일을 만들거나 덮어쓰지 않는다.
- TC-009-5: Changes는 persistent Change Request의 ID·상태·대상·기준 디자인 digest·version intent를 세션 문서 diff와 구분해 표시한다.
- TC-009-6: dialog 취소·Esc는 요청을 생성하지 않고 Features/toolbar 또는 iframe drawer 안의 실행 control로 focus를 복원한다.
- TC-009-7: Preview drawer 메시지는 현재 preview iframe의 exact source와 preview origin에서 온 schemaVersion 1 payload만 허용한다. Console은 feature/subfeature/anchor ownership을 현재 catalog로 재검증하며 불일치·unknown payload는 dialog나 파일을 만들지 않고 무시한다.
- TC-009-8: apply run이 시작되지 않은 Change Request의 `요청 수정`은 현재 제목·요청·사유·기대 동작·version intent를 prefill하고 target Feature/Sub Feature는 읽기 전용으로 유지한다.
- TC-009-9: 수정 저장은 원본 CHG를 byte-identical로 보존하고 `_workspace/01_plan/change-request-revisions/CHG-*-REV-NNN.md`를 exclusive-create하며 같은 idempotency key는 동일 revision을 반환한다.
- TC-009-10: 수정 후 Changes는 최신 요청을 본문으로 표시하고 revision ID/건수/시간 이력을 제공한다. 이전 impact는 `STALE`이며 `영향 검토 다시 실행`만 적용 경로로 제공한다.
- TC-009-11: active Codex run, apply 시작 또는 review decision 이후 수정은 typed 409로 거부한다. apply는 impact run의 request digest가 최신 request digest와 다르면 `CODEX_IMPACT_STALE`로 거부하고 재검사 이후에만 허용한다.
- TC-009-12: `APPROVED` 전이고 active Codex run이 없는 Change Request에는 `삭제` action이 표시되며, 명시적 확인 전에는 파일·인덱스·화면 상태를 변경하지 않고 취소 시 원래 control로 focus를 복원한다.
- TC-009-13: 삭제를 확인하면 원본 CHG, 모든 revision, 해당 CHG의 Codex run audit, review decision과 미승인 candidate를 하나의 작업으로 물리 삭제하고 Changes 카드·count·selection에서 즉시 제거한다. 별도 tombstone이나 취소 이력은 만들지 않는다.
- TC-009-14: active Codex run 또는 `APPROVED` 정본 승격이 있는 요청은 typed 409로 거부하며 어떤 관련 artifact도 삭제하지 않는다. 도중 실패도 rollback되어 부분 삭제 상태를 남기지 않는다.
- TC-009-15: 유효하지 않은 Origin·intent·project/CHG ID는 typed 4xx로 거부한다. 이미 존재하지 않는 well-formed CHG 삭제 재시도는 성공으로 처리해 HTTP DELETE의 idempotency를 유지하고 다른 CHG artifact는 건드리지 않는다.
- TC-010-1: Codex CLI가 설치되고 로그인되어 있으면 Changes에 version과 `연결됨` 상태가 표시되고 impact action을 사용할 수 있다.
- TC-010-2: binary가 없거나 인증되지 않았으면 `연결 필요`와 bounded 복구 안내가 표시되며 run endpoint는 typed 409를 반환한다.
- TC-010-3: `영향 검토`는 current catalog의 Change Request를 server-generated prompt/cwd에 묶고 `read-only` sandbox의 argv-only Codex process를 정확히 하나 시작한다.
- TC-010-4: impact의 running/completed/failed/timed-out/interrupted 상태와 bounded summary, affected artifacts, risks, thread ID가 request card에 표시되고 자동 retry하지 않는다.
- TC-010-5: impact 완료 전 apply, impact가 다른 request/project 소유인 apply, explicit approval intent가 없는 apply는 실행하지 않는다.
- TC-010-6: 사용자가 apply dialog에서 쓰기 범위와 금지 동작을 확인한 뒤 승인하면 서버가 정본과 분리된 temporary candidate workspace를 만들고 그 경계에서만 `workspace-write` Codex process를 시작한다. browser는 command/prompt/cwd/model/sandbox를 지정할 수 없다.
- TC-010-7: 같은 idempotency key는 같은 run을 반환하고 프로젝트별 active run이 있으면 추가 process 없이 conflict를 반환한다.
- TC-010-8: apply 결과는 `READY_FOR_REVIEW|NO_CHANGE|BLOCKED`, 서버가 계산한 candidate changed files와 tests/blockers를 표시한다. `READY_FOR_REVIEW` 전후 정본은 동일하며 commit/push/PR/deploy와 danger-full-access는 실행 경로에 없다.
- TC-010-9: impact prompt는 current FEAT/Sub Feature, 연결 TC/anchor, 최대 12개 관련 문서 metadata와 현재 digest만 포함하고 broad repository enumeration을 금지한다. evidence가 부족하면 최대 4개 직접 참조 파일 뒤 `BLOCKED`로 종료한다.
- TC-010-10: request digest, 전체 인덱스 document hash, preview digest, analyzer version이 같은 완료 impact는 새 audit run을 남기되 executor를 호출하지 않고 cache source를 표시한다. 어느 값이든 바뀌면 cache가 무효화된다.
- TC-010-11: apply prompt는 승인된 impact affectedFiles와 필요한 trace/journal만 허용하고 root Harness, full CI, install, build-all과 broad enumeration을 금지한다. 범위 부족 시 임의 확장 대신 `BLOCKED`다.
- TC-010-12: 완료·실패·timeout run은 Codex JSONL에서 관측한 숫자 token usage만 allowlist로 보존한다. cache hit는 모델 호출 없음, usage 미제공은 `NOT_MEASURED`로 UI에 구분한다.
- TC-011-1: 최신 apply가 `COMPLETED/READY_FOR_REVIEW`이고 bounded candidate manifest가 있을 때만 `승인`, `수정 요청`, `변경 폐기` action이 표시된다. 승인은 current baseline digest가 apply 시작점과 같을 때 candidate를 정본에 한 번만 적용한다.
- TC-011-2: `수정 요청`은 비어 있지 않은 사유를 정확한 apply run에 append-only로 기록하고 정본을 변경하지 않는다. 다음 `Codex 수정 반영`은 같은 정본 baseline에서 새 candidate를 만들며 server-generated prompt에 untrusted feedback을 연결한다.
- TC-011-3: `변경 폐기`는 사유와 terminal `DISCARDED`를 기록하고 candidate를 채택하지 않는다. apply가 정본을 수정하지 않았으므로 복원 동작 없이 정본 digest가 유지된다.
- TC-011-4: 같은 idempotency key는 같은 결정을 반환하고, 같은 apply의 두 번째 결정·ready 이전 결정·`APPROVED|DISCARDED` 뒤 Codex 재실행은 추가 write 없이 거부한다.
- TC-011-5: revision apply가 새 `READY_FOR_REVIEW`를 만들면 이전 `REVISION_REQUESTED`는 이전 apply에만 남고 새 결과에 세 action이 다시 표시된다.
- TC-012-1: 새 Codex result는 영향 FEAT/Sub Feature/TC와 최종 source/preview digest를 구조화해 반환하고 승인 event는 이를 exact apply run과 함께 immutable `featureLinks` snapshot으로 저장한다.
- TC-012-2: 구조화된 apply scope가 Change Request target FEAT를 포함하지 않거나 unknown FEAT/Sub Feature를 참조하거나 현재 catalog digest와 불일치하면 승인을 추가 write 없이 거부한다.
- TC-012-3: 기존 audit의 legacy apply result는 request target/TC context를 `request-context-legacy`로 명시해 승인 가능하며 과거 review event를 rewrite하지 않는다.
- TC-012-4: 승인된 CHG는 영향받은 상위 Feature의 `approvedChanges`에 나타나고 Sub Feature 상세에는 해당 Sub Feature를 명시적으로 포함한 이력만 나타난다.
- TC-012-5: Feature 이력에서 해당 Changes 카드로 이동해 focus할 수 있고 Changes의 Target을 실행하면 원래 Feature/Sub Feature 상세로 돌아간다.
- TC-013-1: `PAGE-NNN` Page Groups와 Feature List의 primary 참조가 있으면 Console은 `순서`대로 페이지 heading을 표시하고 각 FEAT를 정확히 한 section에 배치한다.
- TC-013-2: Page Group 열이 없는 legacy 문서는 `화면`의 첫 항목으로 그룹핑하고, 화면도 없는 FEAT는 삭제하지 않고 `미분류` section에 표시한다.
- TC-013-3: 페이지 section 안에서도 상위 FEAT/Sub Feature 선택, `feature`/`subfeature` URL hash 복원, 상세·TC·Preview mapping·승인 이력은 기존과 동일하게 동작한다.
- TC-014-1: Overview·Preview의 상태 chip 클릭 또는 `프리뷰 승인` 버튼(UNAPPROVED에서만 표시)이 상태 dialog를 열고, dialog의 승인 폼은 `UNAPPROVED`에서만 포함되며 확인 진술 checkbox와 비어 있지 않은 한 줄 승인 문구가 있어야 제출할 수 있다. 다른 상태의 dialog는 설명·다음 행동만 표시한다.
- TC-014-2: 승인 POST는 loopback Origin과 `record-preview-approval` intent를 요구하고, body의 source/preview digest가 서버가 재계산한 현재 digest와 다르면 `PREVIEW_DIGEST_MISMATCH`로 거부하며 파일을 쓰지 않는다.
- TC-014-3: 성공한 승인은 canonical writer가 `design-review.md`에 `recordedVia: console-user-attested` marker를 append하고 상태가 `APPROVED`로 갱신된다. 같은 digest·문구의 재시도는 추가 write 없이 기존 결과를 반환한다.
- TC-014-4: `UNAPPROVED`가 아닌 상태(STALE 포함)의 승인 시도는 `PREVIEW_NOT_APPROVABLE`로 거부된다 — STALE 재승인은 하네스 세션의 재생성 절차 전용이다.
