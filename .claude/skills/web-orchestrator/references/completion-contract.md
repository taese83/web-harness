# Completion Contract

완료 메시지는 다음을 간결하게 제공한다.

- 서비스명과 완료/부분 완료/BLOCKED 상태
- 프로젝트 절대 경로
- package manager 기준 실행 명령과 local URL
- `_workspace/RELEASE/HANDOFF.md` 링크
- 디자인 프리뷰가 있으면 그 위치(`_workspace/02_design/preview/`)와 재기동 명령(`node .claude/scripts/preview-server.mjs --project {root}`), `APPROVED|STALE` 상태 확인 명령, FEAT/TC 추적 커버리지와 승인된 test case — 개발과 분리된 보존 자산이므로 완료 후에도 고객이 언제든 재확인할 수 있음을 명시
- 적용된 mode와 아직 Mock/ASSUMPTION인 경계
- 후속 명령: `/api-connect`, `/component-gen`, `/feature-add`, `/timeseries-dashboard`, `/analytics-chart-builder`

release gate가 통과하지 않았으면 “완성”이라고 표현하지 않는다. 완료 상태는 `release-tier-contract.md`의 tier 라벨(`DIAGNOSTIC_VERIFIED` | `ISOLATED_VERIFIED` | `RELEASED`)을 그대로 사용하고, T2 미만이면 HANDOFF 링크 대신 `_workspace/RELEASE/release-readiness.md` 링크와 다음 tier 승급에 필요한 항목을 제공한다.
