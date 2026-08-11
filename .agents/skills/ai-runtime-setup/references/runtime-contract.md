# AI Runtime Contract

## 권장 경계

| 경로 | 책임 |
|---|---|
| apps/web | UI, stream rendering, approval interaction |
| apps/agent-api | auth, session, workflow API |
| workers/agent-jobs | durable background execution |
| packages/agent-runtime | state machine, handoff, budget |
| packages/model-gateway | provider adapter와 routing |
| packages/ai-contracts | structured output와 tool schema |
| packages/tool-adapters | domain service adapter |
| packages/approval-policy | approval state와 policy |
| packages/observability | trace, metrics, redaction |

## Request State

- requestId, userId, tenantId
- workflowVersion, promptVersion, model
- currentStep, completedSteps
- toolCalls, approvals
- retryCount
- budgetUsage
- cancellation
- resumable checkpoint

## Streaming Event

모든 provider event를 다음 유형으로 정규화한다.

- run.started
- output.delta
- tool.requested
- tool.completed
- approval.required
- handoff.started
- run.completed
- run.failed

각 event에는 requestId, sequence, timestamp, schemaVersion을 포함한다.

## Tool 실행

1. schema validation
2. server-side identity·tenant 주입
3. scope와 policy 검사
4. approval 검사
5. idempotency reserve
6. timeout이 있는 실행
7. result schema validation
8. audit와 trace

## Mock 전환

Mock은 성공만 흉내 내지 않는다. timeout, rate limit, malformed result, denied scope, approval wait, partial stream fixture를 제공한다.
