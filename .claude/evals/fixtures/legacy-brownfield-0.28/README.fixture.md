# fixture: legacy-brownfield-0.28

하네스 0.28.0(`ea8ecf0`)의 스크립트로 실제로 만든 브라운필드 프로젝트다 — `init-workspace`로 도입하고, `spec.mjs`로 스팩을
잠그고(schemaVersion 2 · `acceptanceSource: absent`), 그 판본의 `validate-development-readiness --fix`가 READY를 낸 상태다.
티켓 설정은 이름을 지운 Jira 형태다. 손으로 고치지 않는다 — 다시 만들 때도 옛 판본 스크립트로 만든다.

`test-upgrade-check.mjs`가 지금 판본의 업그레이드 점검을 여기에 돌려 **부딪히는 항목 목록을 고정한다.** 새 판본이 옛 산출물에
요구를 더하면 이 테스트가 깨진다 — 그때 목록을 고치는 것은 의식적 행위다(릴리스 커밋에 무엇이 새로 부딪히는지 적는다).
