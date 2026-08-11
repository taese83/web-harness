# AI Requirements — Codex Change Request Bridge

AI_MODE: true
SUBMODES: [TOOL_AGENT_MODE]
AUTONOMY_LEVEL: L2
HIGH_IMPACT_ACTIONS: [workspace planning/TC/design/preview edits, local command execution]
BLOCKERS: []

## Task and authority

- 사용자는 Changes 카드에서 저장된 Change Request를 Codex 작업으로 연결한다.
- Change Request Markdown과 현재 catalog/worktree가 authoritative input이다. 모델 출력은 권한·상태·성공 판정의 authority가 아니다.
- read-only `impact` 실행은 영향 범위·위험·이미 적용 여부를 구조화한다.
- `apply` 실행은 impact 완료 후 별도 사용자 확인이 있어야 시작하며 server-created temporary candidate만 수정한다. 정본은 review approval 전 read-only다.
- apply 완료는 자동 승인이 아니다. 사용자는 exact apply result에 `APPROVED|REVISION_REQUESTED|DISCARDED`를 기록하며 revision만 다음 별도 승인 apply를 허용한다.

## Boundaries

- browser는 CLI path, argv, prompt, cwd, model, sandbox를 지정하지 않는다.
- server가 request ID를 current catalog에서 재검증하고 prompt와 argv를 생성한다.
- `danger-full-access`, commit, push, PR, deploy, dependency install, 외부 mutation은 허용하지 않는다.
- Codex CLI 미설치·미인증이면 실행하지 않고 연결 상태와 복구 문구를 표시한다.

## Budgets and failure

- input: persisted request fields only, each existing field limit 이하
- one active run per project, automatic retry 0, impact 5분/apply 20분 timeout
- captured stdout/stderr 각 1 MiB, final structured fields/items bounded
- timeout, non-zero exit, malformed output, stale/unknown request, process disconnect는 typed failure이며 자동 재실행하지 않는다.
- review decision endpoint는 모델을 호출하지 않으며 5초 이내 로컬 append를 목표로 한다. revision feedback은 다음 apply 입력 예산 안에서 최대 2,000자로 제한한다.

## Scenario Review

| ID | Scenario | Expected Behavior | Evidence |
|---|---|---|---|
| AI-1 | CLI 설치·로그인 정상 | 연결됨 표시, impact 시작 가능 | status/API/browser |
| AI-2 | CLI 없음 또는 미인증 | 연결 필요와 복구 문구, action disabled | unit/API |
| AI-3 | 같은 요청을 중복 실행 | idempotency replay 또는 active conflict, process 1개 | unit/server |
| AI-4 | impact 완료 전 apply | 409로 거부 | unit/server |
| AI-5 | apply 승인 | explicit dialog 확인 뒤 temporary candidate workspace-write 세션 시작, 정본 digest 유지 | browser/server |
| AI-6 | timeout/process failure | FAILED 표시, 자동 retry 없음 | fake executor |
| AI-7 | server 재시작 중 running log | INTERRUPTED/unknown state 표시, 자동 재실행 없음 | persistence unit |
| AI-8 | 악성 browser payload | mode 외 argv/cwd/prompt 주입 불가 | contract/security test |
| AI-9 | READY_FOR_REVIEW 수정 요청 | exact apply에 사유 기록, 다음 approved apply prompt에 untrusted feedback 결속 | unit/server/browser |
| AI-10 | 승인/폐기 뒤 재실행 | terminal conflict, 추가 process 없음 | server test |
| AI-11 | candidate 생성 후 정본 변경 | 승인 시 `CANDIDATE_BASE_STALE`, candidate 미적용·decision 미기록 | unit/server |
| AI-12 | candidate 승인·수정·폐기 | 승인만 정본 digest를 candidate로 전환, 수정·폐기는 정본 무변경 | unit/server |
