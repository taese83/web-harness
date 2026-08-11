# UX Brief — Web Harness Console

## Screen Inventory

| Screen | Primary information | Primary action | States |
|---|---|---|---|
| Console workspace | project status, phase counts, changes | 프로젝트 선택 | empty/loading/error/populated |
| Overview | Plan/Design/Preview health, FEAT/TC summary | 관련 탭 열기 | missing/stale/approved |
| Documents | phase tree, selected document | 문서 선택 | no selection/long file/read error |
| Features | FEAT list, TC, mapping detail | feature 검토·변경 요청 | no feature-plan/populated/request dialog |
| Preview | isolated interactive preview | 프리뷰 탐색·변경 요청 | absent/MISSING/STALE/available/request dialog |
| Changes | persistent requests, Codex connection/run, review decision, session file diff | 영향 검토·승인 기반 적용·결과 승인/수정/폐기·디스크 새로고침 | disconnected/idle/running/ready/revision/approved/discarded/failed/unchanged/changed |

## User Flow

1. `pnpm console` 실행 후 브라우저에서 프로젝트 목록 확인
2. 상태 chip과 phase count로 검토할 프로젝트 선택
3. Overview에서 FEAT/TC·Preview·변경 요약 확인
4. Documents에서 plan/design 원문 확인
5. Preview에서 실제 디자인 결과물 확인
6. 수정이 필요하면 Preview의 FEAT/TC 시나리오 drawer에서 `변경 요청`을 실행하고, 현재 Feature·anchor·TC·Preview 기준점이 채워진 Console dialog에서 변경 내용과 version intent를 제출
7. Changes에서 Codex 연결 상태를 확인하고 요청 카드의 `영향 검토`를 실행
8. 영향 범위·위험·이미 적용 여부를 확인한 뒤 `Candidate 생성` dialog에서 temporary workspace-write 범위를 명시적으로 승인
9. 실행 상태·Codex thread ID·server-computed candidate 변경 파일을 확인한다. 이 단계에서는 정본과 session diff가 바뀌지 않는다.
10. `READY_FOR_REVIEW` 결과를 확인한 뒤 정본 승격 승인, 사유가 있는 수정 요청, 또는 정본 무변경 candidate 폐기 중 하나를 선택
11. 수정 요청이면 `Codex 수정 반영`의 별도 apply 승인을 거쳐 새 결과를 다시 검토

## Design Direction

- 운영 도구형 고밀도 화면: 지속 노출 sidebar + 상단 project context + content tabs
- neutral slate surface 위 blue를 선택/주요 액션에만 사용
- 상태는 색 단독이 아니라 label과 symbol을 함께 사용
- system-ui, 14px compact UI / 문서 본문 16px
- 8px spacing scale, 40px 이상 주요 control target

## Data Strategy

- local filesystem read + append-only Change Request/run audit + temporary candidate workspace-write + 검토 승인 시 digest-guarded 정본 승격 boundary
- normal fixture: `nocode-builder`, `minicar-laptime`
- boundary fixture: preview 없는 프로젝트, traceability 없는 legacy preview
- Mock→real 전환 없음; filesystem이 실제 source다.

## UX Check — Codex 실행

- 첫눈에 알 수 있어야 하는 것: 연결 여부, 요청 상태, 지금 단계가 impact인지 apply인지, 실행 중/실패/완료 여부
- 다음 행동이 보이는가: impact 전에는 `영향 검토`, impact 완료 후에만 `변경 적용`
- 실수하거나 오해할 지점: 요청 등록과 자동 수정 혼동, candidate 생성이 정본 적용이라고 오해, apply가 commit/push까지 수행한다고 오해, stale base를 최신으로 오해
- 먼저 정할 방향: L2 candidate generation과 별도 promotion approval, no automatic retry, candidate와 canonical session diff 분리
- 확인할 것: keyboard focus, 중복 click, disconnect/timeout copy, compact card action reflow

## UX Check — 결과 검토

- 첫눈에 알 수 있어야 하는 것: 실행 완료와 검토 완료는 다르며 현재 결정이 어느 apply 결과에 대한 것인지
- 다음 행동이 보이는가: READY_FOR_REVIEW에서 세 action, REVISION_REQUESTED에서 `Codex 수정 반영`, terminal 상태에서 action 없음
- 실수하거나 오해할 지점: `승인` 전 candidate가 이미 정본을 바꿨다고 오해하거나, legacy direct apply와 신규 candidate를 혼동
- 먼저 정할 방향: 원본 CHG/run 보존, apply-run-bound append-only decision, 신규 run은 candidate-only, legacy run은 복원 한계 표시
- 확인할 것: required reason, confirmation copy, terminal run block, mobile action stack, focus return
