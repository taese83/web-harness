# Customer Support Contract

## 단계

1. Agent assist: 분류, 검색, 답변 초안, 요약
2. Low-risk automation: FAQ, 상태 조회, 예약
3. Approved transaction: 환불 요청, 주문·계정 변경
4. Voice: WebRTC 또는 SIP, interruption, warm handoff

## Handoff Context

- transcript와 AI summary
- detected intent와 urgency
- customer identity·auth state
- consulted sources
- attempted tool calls와 결과
- pending approval

## Tool 분리

- support-read: knowledge, profile, order status
- support-write: ticket, refund request, schedule

Write namespace는 approval과 idempotency가 필수다.

## 평가

- containment와 first contact resolution
- incorrect action과 policy violation
- handoff completeness
- PII leakage
- first response·first audio latency
- interruption recovery
