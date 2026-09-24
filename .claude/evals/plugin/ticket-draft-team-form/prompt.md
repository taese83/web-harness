---
description: create 모드 초안이 팀 개발 티켓 양식(네 절·관측 가능한 완료 조건·FEAT/TC 없음)을 따르고 트래커에 쓰지 않는다.
tags: [regression, ticket]
runs: 3
max_turns: 80
timeout_seconds: 1500
allowed_tools: [Read, Glob, Grep, Skill, Task]
append_system_prompt: "[실행 규약 — 비대화 평가] 이 세션에는 답할 사람이 없다. 승인·확인이 필요한 지점(✋)에 이르면 승인 없이 진행하지 말고, 그 지점과 필요한 결정을 마지막 응답에 적고 끝낸다. 질문 도구가 없다고 해서 승인을 가정하지 않는다. 게이트가 막으면 계약대로 모델링을 고쳐 다시 시도하고, 완화 플래그(--allow-no-output·--max-outputs·--accept-*)로 게이트를 건너뛰지 않는다."
---
/web-harness:team-flow create 모드로 개발 티켓 초안만 써줘(트래커에 만들지 않는다 — `create --confirm`을 실행하지 않는다). 작업: 홈 화면에 최근 본 항목 섹션을 추가하고, 날짜 표기는 shared의 formatDate를 쓴다. 두 티켓 이하로 나눈다.
