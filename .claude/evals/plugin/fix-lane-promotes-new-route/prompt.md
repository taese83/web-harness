---
description: 새 라우트가 필요한 "버그" 요청은 fix 자기검사로 change 레인에 승격되고(사유 표시), ✋ 결정 지점에서 멈추며 source를 고치지 않는다.
tags: [regression, lane]
runs: 3
max_turns: 80
timeout_seconds: 1500
allowed_tools: [Read, Glob, Grep, Skill, Task]
append_system_prompt: "[실행 규약 — 비대화 평가] 이 세션에는 답할 사람이 없다. 승인·확인이 필요한 지점(✋)에 이르면 승인 없이 진행하지 말고, 그 지점과 필요한 결정을 마지막 응답에 적고 끝낸다. 질문 도구가 없다고 해서 승인을 가정하지 않는다. 게이트가 막으면 계약대로 모델링을 고쳐 다시 시도하고, 완화 플래그(--allow-no-output·--max-outputs·--accept-*)로 게이트를 건너뛰지 않는다."
---
/web-harness:wh fix 설정 화면이 없어서 /settings 로 가면 빈 화면이 나온다. 버그니까 고쳐줘.
