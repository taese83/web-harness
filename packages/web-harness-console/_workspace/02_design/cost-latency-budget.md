# Cost and Latency Budget — Codex Change Request Bridge

| Budget | Impact | Apply |
|---|---:|---:|
| Concurrent runs | 1 per project / 1 Console global default | same |
| Wall clock | 5 min | 20 min |
| Automatic retries | 0 | 0 |
| Persisted final summary | 8 KiB | 8 KiB |
| Captured stdout/stderr | 1 MiB each, process-local | 1 MiB each, process-local |
| Turns | 1 Codex exec session | 1 Codex exec session |
| Additional writable roots | 0 | 0 |

Codex JSONL이 제공하는 `input/cached/cache-write/output/reasoning/total` token count만 allowlist로 보존한다. monetary cost는 단가·model metadata가 없으므로 계산하지 않는다. 성공·실패·timeout에서 event가 없으면 `NOT_MEASURED`, semantic cache hit는 `모델 호출 없음`으로 구분한다.

Impact context는 관련 문서 12개, TC 24개, anchor 12개, 직접 참조 fallback read 4개로 제한한다. 동일 analyzer/request/project digest의 완료 결과는 재사용한다. Apply는 impact affected files와 직접 필요한 trace/journal, targeted checks만 허용하고 root Harness/full CI/install/build-all을 금지한다. 5/20분 hard timeout과 retry 0은 유지하며 timeout을 늘려 비용 문제를 숨기지 않는다.

Review decision append has a 5-second API budget, creates no model/provider request and adds at most 2,000 characters of revision feedback to the next explicitly approved apply. It does not change the one-active-run or automatic-retry budgets.
