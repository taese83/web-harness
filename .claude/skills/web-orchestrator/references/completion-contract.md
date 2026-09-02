# Completion Contract

완료 메시지는 다음을 간결하게 제공한다.

- 서비스명과 완료/부분 완료/BLOCKED 상태
- 프로젝트 절대 경로
- package manager 기준 실행 명령과 local URL
- `_workspace/RELEASE/HANDOFF.md` 링크
- 디자인 프리뷰가 있으면 그 위치(`_workspace/02_design/preview/`)와 재기동 명령(`node .claude/scripts/preview-server.mjs --project {root}`), `APPROVED|STALE` 상태 확인 명령, FEAT/TC 추적 커버리지와 승인된 test case — 개발과 분리된 보존 자산이므로 완료 후에도 고객이 언제든 재확인할 수 있음을 명시
- 적용된 mode와 아직 Mock/ASSUMPTION인 경계
- **단계별 공급원과 `specTier`** — `PLAN_SOURCE`·`DESIGN_SOURCE`·`SOLUTION_SOURCE`(`provenance-contract.md` §1)와 `_workspace/03_dev/spec.json`의 `specTier`를 그대로 적는다. `unverifiable`이면 **"수용 기준이 없어 무엇이 완료인지 판정하지 않았다"**를 명시하고, 팀 인계·티켓 청구가 막혀 있다는 사실과 `provenance-contract.md` §3 지연 공급으로 승격하는 경로를 함께 준다. 부분 공급이면 `기획: supplied (핵심 플로우 3건 공급 · 나머지 보강, gap-report 참조)`처럼 **혼합을 드러낸다**(`provenance-contract.md` §9). 이 표기를 생략하면 검증되지 않은 것이 검증된 것처럼 인계된다
- 후속 명령: `/wh <요청>` 하나다. 레인 판정과 게이트 안내를 받으려면 보조 skill을 직접 부르지 않는다

release gate가 통과하지 않았으면 “완성”이라고 표현하지 않는다. 완료 상태는 `release-tier-contract.md`의 tier 라벨(`DIAGNOSTIC_VERIFIED` | `ISOLATED_VERIFIED` | `RELEASED`)을 그대로 사용하고, T2 미만이면 HANDOFF 링크 대신 `_workspace/RELEASE/release-readiness.md` 링크와 다음 tier 승급에 필요한 항목을 제공한다.
