# Harness Eval Contracts

- `scenarios.json`: 기존 웹 harness의 대표 회귀 계약
- `ai-scenarios.json`: AI 서비스의 위험도·증거 기반 실행 계약
- `fixtures/`: result verifier 자체 테스트용 계약 fixture

## 정적 단계

순서대로 한 단계씩 실행:

1. `node .claude/scripts/test-ai-harness.mjs --stage baseline`
2. `node .claude/scripts/test-ai-harness.mjs --stage foundation`
3. `node .claude/scripts/test-ai-harness.mjs --stage routing`
4. `node .claude/scripts/test-ai-harness.mjs --stage services`
5. `node .claude/scripts/test-ai-harness.mjs --stage policy`
6. `node .claude/scripts/test-ai-harness.mjs --stage eval-contracts`

누적 실행:

`node .claude/scripts/test-ai-harness.mjs --through all`

## Runtime Scenario

### 자동 실행 (executor 파이프라인)

```bash
node .claude/scripts/run-eval-executor.mjs --scenario <id> --dry-run   # 비용 확인 (실행 없음)
node .claude/scripts/run-eval-executor.mjs --scenario <id> --full     # run → grade → verify
node .claude/scripts/run-eval-executor.mjs --list-runs
```

파이프라인: ① 격리 fixture(`eval-runs/<id>/<run-id>/fixture/`)에 deploy-harness로 control plane을
배포하고 headless Claude가 entrySkill+prompt를 실행한다 (transcript는 `executor.log`) →
② 별도 read-only grader가 반증 우선으로 채점해 result JSON을 본문으로 반환한다 (저장은 스크립트가) →
③ 기계 검증 2중: PASS evidence의 실존 파일 참조 확인(fail-closed) + 기존 `--verify-result` 스키마 검증.

executor는 전체 앱 빌드를 수행할 수 있어 시나리오당 수십 분·상당한 토큰이 든다.
`--dry-run`으로 먼저 확인하고 개별 시나리오 단위로 실행할 것. `eval-runs/`는 VCS 제외.

### 수동 실행 (기존 절차)

1. `node .claude/scripts/run-ai-evals.mjs --list`
2. `node .claude/scripts/run-ai-evals.mjs --scenario <id>`
3. 출력된 `entrySkill`과 `prompt`를 격리 fixture에서 실행한다.
4. 생성 파일, command log, trace ID, tool call, approval, 측정값을 assertion evidence로 기록한다.
5. `node .claude/scripts/run-ai-evals.mjs --verify-result <result.json>`

PASS assertion에는 비어 있지 않은 evidence가 필요하다. Critical scenario의 BLOCKED는 release PASS가 아니다.

정적 script는 실제 model, 외부 API, SCM, CRM, warehouse, browser를 호출하지 않는다. Runtime scenario와 서비스 품질 평가는 별도 격리 환경에서 실행해야 한다.

전체 절차와 서비스별 승격 순서는 `docs/archive/AI_AGENT_HARNESS_TESTING.md`를 따른다.
