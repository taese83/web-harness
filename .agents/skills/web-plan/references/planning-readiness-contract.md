# Planning Readiness Contract

Phase 1은 문서가 존재한다는 이유로 완료되지 않는다. 제품 의도, UX 위험, 데이터 검토 방식, 상대 노력도, 미결정이 Phase 2에서 사용할 수 있을 만큼 명확해야 한다.

## 데이터 검토 전략

초기 intake에서 API 존재 여부부터 묻지 않는다. 제품 의도를 고정한 뒤 화면 상태와 데이터 shape가 무엇을 검증해야 하는지 선택한다.

| 전략 | 선택 조건 | Phase 1에서 고정할 것 |
|---|---|---|
| `mock` | API가 없거나 불안정하고 UX·상태 검토가 목적 | normal/empty/loading/error/partial/permission fixture |
| `dev-read-only` | 실제 shape·cardinality·권한 경계가 설계를 바꿈 | source, 자격 증명 경계, 읽기 범위, fallback |
| `real-read-only` | 허가된 실데이터가 정확한 검토에 필수 | 최소 권한, PII 마스킹, 저장·로그 금지, 실패 처리 |
| `production-integration-later` | 현재는 계약만 있고 연결은 후속 단계 | Mock→real 전환 조건, owner, blocker |

기획·디자인 검토 중 production mutation은 금지한다. 개발 데이터의 변경·삭제도 같은 작업에서 명시적으로 만든 격리 fixture가 아니면 하지 않는다.

## 상대 노력도와 선택지

`S | M | L | XL`은 일정 약속이나 인원 추정이 아니라 범위 비교용 신호다.

- `S` — 한 화면/한 상태 중심, 기존 계약과 구성요소 재사용
- `M` — 여러 상태 또는 인접 화면, 제한된 새 계약
- `L` — 여러 도메인·권한·데이터 흐름 또는 중요한 migration
- `XL` — 독립 milestone이 필요한 cross-system/고위험 변화

각 추정에는 다음을 포함한다.

- effort driver: 화면 수, 상태 수, 새 계약, 권한, migration, 검증 범위
- `invest | reduce | split` 권고와 이유
- 가장 작은 가시적 검토 단위
- Mock 검토 노력과 production 통합 노력을 분리한 설명

일(day/week) 단위 일정은 팀 속도와 담당자가 없는 상태에서 만들지 않는다.

## Readiness Gate

`plan-reviewer`는 다음을 모두 확인한다.

- 대상 화면/기능, 주 사용자, 핵심 업무, 현재 pain, 관찰 가능한 성공 조건
- Must/Should/Won't와 근거 없는 “당연한 기능”의 범위 유입 방지
- 자동 UX Check trigger가 적용되었거나 비적용 근거가 있음
- 정상·empty·loading·error와 관련 destructive/permission/partial 상태
- 주석이 좌표가 아닌 의도로 정규화되고 상충 항목이 드러남
- 데이터 전략과 Mock→real 전환 조건
- S/M/L/XL, driver, `invest|reduce|split`, 최소 검토 단위
- requirement → 화면/owner → evidence traceability
- ASSUMPTION의 검증 방법과 최대 3개 우선 결정, BLOCKER

판정:

- `PASS` — Phase 2가 새 제품 결정을 발명하지 않고 시작 가능
- `NEEDS_DECISION` — 안전하게 병렬화할 수 있으나 사용자 선택이 필요한 항목이 있음
- `BLOCKED` — 권한, authoritative source, destructive safety, 핵심 목표 또는 상충 요구가 해결되지 않음

## Phase 경계

Phase 1에서는 구현 source, prototype source, commit, push, PR을 만들지 않는다. 빠른 시각 검토가 필요하면 무엇을 Phase 2 prototype에서 확인할지만 정의한다. 자동 구현이나 저장소별 명령·label 정책은 기획 계약에 포함하지 않는다.
