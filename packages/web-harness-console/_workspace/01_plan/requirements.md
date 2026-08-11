# Requirements — Web Harness Console

## Must

- REQ-001: root의 `workspace/`, `packages/`와 root 자체에서 `_workspace` 프로젝트를 자동 탐색한다.
- REQ-002: `00_source`, `01_plan`, `02_design`만 인덱싱하고 `03_dev`, `04_qa`, `RELEASE`는 노출하지 않는다.
- REQ-003: 프로젝트별 문서 트리, 파일 메타데이터, 안전한 본문 뷰어를 제공한다.
- REQ-004: `feature-plan.md`에서 FEAT와 TC를 추출해 기능 목록을 제공한다.
- REQ-005: 디자인 프리뷰 존재 여부와 `MISSING|INVALID|DRAFT|UNAPPROVED|APPROVED|STALE` 상태를 정확히 표시한다.
- REQ-006: 프리뷰를 Console과 다른 localhost origin에서 표시해 prototype script를 Console 권한과 격리한다.
- REQ-007: 서버 시작 snapshot 대비 문서 added/modified/removed와 line count 변화를 보여준다.
- REQ-008: 정본 Source/Plan/Design 문서는 승인 전 수정하지 않는다. Plan write boundary는 `_workspace/01_plan/change-requests/CHG-*.md` 원본과 `_workspace/01_plan/change-request-revisions/CHG-*-REV-*.md` 수정본을 append-only로 생성하는 전용 API로 제한한다.
- REQ-009: root에서 `pnpm console`로 실행한다.
- REQ-013: Features 상세, Preview toolbar 또는 Preview 안의 FEAT/Sub Feature 시나리오 drawer에서 선택한 Feature/Sub Feature/anchor/TC와 현재 디자인 digest를 기준점으로 변경 요청을 생성한다. Preview drawer는 ID만 전달하고 Console이 현재 catalog에서 소유권과 파생 context를 다시 검증한다.
- REQ-014: 생성된 변경 요청의 상태·요청 내용·version intent·기준 디자인을 Changes에서 조회한다. 승인되어 정본에 반영된 요청과 그 검토 이력은 영구 보존하고, 승인 전 삭제된 작업 초안은 조회·이력 대상에서 제거한다.
- REQ-015: Changes에서 로컬 Codex CLI 설치·인증 상태를 확인하고 연결되지 않았으면 실행 대신 원인과 복구 방법을 표시한다.
- REQ-016: 사용자가 요청 카드에서 실행한 영향 검토는 read-only Codex session으로 수행하고, 상태·thread ID·bounded 결과를 append-only audit로 남긴다.
- REQ-017: 정본 변경 후보는 완료된 영향 검토를 확인한 사용자가 별도 승인한 경우에만 temporary candidate workspace의 workspace-write Codex session으로 생성한다. 검토 전 정본은 수정하지 않으며 자동 재시도·commit·push·PR·deploy는 하지 않는다.
- REQ-018: `READY_FOR_REVIEW` candidate 결과에는 `승인|수정 요청|변경 폐기` 검토 action을 제공한다. 결정은 정확한 apply run에 결속된 append-only 이력으로 저장한다. 승인은 baseline 불변을 재검증한 candidate만 정본에 적용하고, 수정 요청·폐기는 정본을 변경하지 않는다.
- REQ-019: 승인된 Change Request는 승인 시점의 영향 FEAT/Sub Feature/TC와 최종 digest snapshot을 보존하고 기존 Feature 상세의 revision 이력으로 조회한다. Feature와 Changes 사이에서 해당 CHG와 target으로 양방향 이동할 수 있어야 한다.
- REQ-020: 기획의 `PAGE-NNN` Page Group과 FEAT primary page 참조를 인덱싱해 Features 목록을 페이지 단위로 그룹핑한다. Page Group이 없는 기존 문서는 `화면`의 첫 항목을 fallback으로 사용하고 화면도 없을 때만 `미분류`로 표시한다.
- REQ-021: 905px 이상 Features 탭은 목록과 선택 상세이 남은 viewport를 같은 높이로 채우고 각각 독립 스크롤한다. 선택 FEAT/Sub Feature는 목록 안에 자동 노출하며 904px 이하에서는 단일 page scroll을 유지한다.
- REQ-022: Change Request는 apply 시작 전까지 editable fields를 append-only 수정본으로 정정할 수 있다. 원본과 target context는 불변이며 수정 후 기존 impact는 STALE로 표시하고 최신 request digest 기반 재검사 없이는 apply를 거부한다.
- REQ-023: impact는 인덱싱된 target FEAT/TC/anchor와 관련 문서 metadata로 만든 bounded context에서만 분석하고 동일 request·Plan·Design digest 결과를 재사용한다. apply는 승인된 영향 파일과 인접 검증만 수행하며 전체 저장소 재탐색·root Harness/CI/install/build-all을 실행하지 않는다. 실행·실패·timeout에는 CLI가 제공한 token usage만 기록하고 미제공 값은 `NOT_MEASURED`로 유지한다.
- REQ-024: `APPROVED` 정본 승격 전이고 active Codex run이 없는 Change Request는 사용자의 명시적 확인 후 물리 삭제할 수 있다. 삭제는 원본·revision·Codex run audit·review decision·미승인 candidate 등 해당 CHG의 임시 산출물을 함께 제거하고 카드와 인덱스에서 즉시 사라지게 한다. `APPROVED` 요청이나 active run이 있는 요청은 삭제를 거부하며, 일부만 삭제된 상태를 남기지 않는다.

## Should

- REQ-010: 키보드로 프로젝트·탭·문서 탐색이 가능하고 focus-visible을 제공한다.
- REQ-011: 905px 이하에서 pane을 쌓아 문서와 프리뷰를 계속 사용할 수 있다.
- REQ-012: 새로고침 버튼으로 디스크를 재인덱싱하고 변경 요약을 즉시 갱신한다.

## Won't — MVP

- 등록 즉시 무승인 자동 편집, automatic retry, commit/push/PR/deploy
- danger-full-access, browser-controlled command/prompt/cwd/model/sandbox, remote multi-user execution
- 03_dev/04_qa/release 대시보드
- Git commit 간 semantic diff와 승인된 release/version 이력
- 외부 배포, 원격 repository, 로그인·권한 관리

## Critical States

- project 없음, 문서 없음, preview 없음, traceability 없음/깨짐
- 문서가 삭제되거나 읽는 중 변경됨
- 허용 목록 밖 path 요청과 symlink
- 매우 긴 문서와 binary file
- 잘못된 Origin/intent/content type, 중복 submit, 유효하지 않은 Feature·anchor, write collision
- Codex CLI 없음/미인증, impact/apply timeout, malformed output, server restart로 중단된 run, apply-before-impact, active run 충돌
- review-before-ready, 같은 apply의 중복 결정, terminal 결정 뒤 재실행, 수정·폐기 사유 누락, decision audit 손상
- 승인 apply의 target FEAT 누락, unknown FEAT/Sub Feature, 현재 catalog와 결과 digest 불일치, 구조화 범위가 없는 legacy apply
- candidate 파일 수·용량 초과, symlink, unsafe path, 검토 전 baseline 변경, candidate 승격 중 digest 불일치
- request revision 무변경 제출, malformed revision, active/apply/review 이후 수정, 이전 request digest의 impact로 apply
- 중복/unknown Page Group, 순서 누락, legacy Feature의 화면 누락, 페이지 그룹 안의 긴 FEAT/Sub Feature 제목
- 동일 impact cache의 stale project digest, malformed token event, bounded apply scope 부족, apply time budget 초과
