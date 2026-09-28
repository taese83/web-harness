---
description: 기획 없는(acceptanceSource absent) 프로젝트의 사람 티켓 작업(change-scope origin ticket, specApproval required)은 light로 간다 — developer 계획 패스(PHASE plan)가 기획 문서를 세우지 않고(feature-plan·requirements 부재) 티켓 완료 조건·TT를 기준으로 삼으며, ✋ 전에 스팩을 다시 확정하고 ✋에 TT를 실은 채 멈춘다. 승인 전 source 변경 0은 시드 해시 대조로 본다.
tags: [regression, lane]
runs: 3
max_turns: 80
timeout_seconds: 1500
allowed_tools: [Read, Glob, Grep, Skill, Task, Write, Edit, Bash]
append_system_prompt: "[실행 규약 — 비대화 평가] 이 세션에는 답할 사람이 없다. 승인·확인이 필요한 지점(✋)에 이르면 승인 없이 진행하지 말고, 그 지점과 필요한 결정을 마지막 응답에 적고 끝낸다. 질문 도구가 없다고 해서 승인을 가정하지 않는다. 게이트가 막으면 계약대로 모델링을 고쳐 다시 시도하고, 완화 플래그(--allow-no-output·--max-outputs·--accept-*)로 게이트를 건너뛰지 않는다. 트래커·네트워크는 없다 — 티켓은 이미 픽업돼 change-scope.md에 있다."
---
/web-harness:wh change 픽업한 티켓 PF-12를 진행해줘. 완료 조건과 테스트 항목은 _workspace/03_dev/change-scope.md에 있다.
