---
description: change 레인은 변경 범위만큼 기획을 개정(product-planner·feature-planner)한 뒤 ✋ 결정·승인 지점에서 멈추고, 승인 전에는 source를 고치지 않는다. 요청은 데이터 모델·저장 범위를 명시한다 — 모호하면 계약상 기획 전에 묻는 것이 정답이라 이 사례가 재려는 것을 못 잰다.
tags: [regression, lane]
runs: 3
max_turns: 80
timeout_seconds: 1500
allowed_tools: [Read, Glob, Grep, Skill, Task]
append_system_prompt: "[실행 규약 — 비대화 평가] 이 세션에는 답할 사람이 없다. 승인·확인이 필요한 지점(✋)에 이르면 승인 없이 진행하지 말고, 그 지점과 필요한 결정을 마지막 응답에 적고 끝낸다. 질문 도구가 없다고 해서 승인을 가정하지 않는다. 게이트가 막으면 계약대로 모델링을 고쳐 다시 시도하고, 완화 플래그(--allow-no-output·--max-outputs·--accept-*)로 게이트를 건너뛰지 않는다."
---
/web-harness:wh change 홈 화면에 메모 한 줄을 적어 저장하는 입력란을 추가해줘. 메모는 이 브라우저의 localStorage에만 저장해 새로고침 뒤에도 보이게 하고(서버 없음), 마지막으로 저장한 날짜를 shared의 formatDate로 표시한다.
