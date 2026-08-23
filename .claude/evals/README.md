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

## 실행 receipt — 커밋 대상 (2026-08-23 신설)

실행 산출물 전체(`eval-runs/`)는 VCS 제외를 유지한다 — fixture·transcript는 크고 재현
가능하다. **판정 결과만 커밋한다**:

- **ai 카탈로그**(`ai-scenarios.json`): `run-ai-evals.mjs --verify-result`를 통과한 result JSON을
  커밋한다 — receipt JSON만으로 사후 독립 재검증이 가능하다.
- **web 카탈로그**(`scenarios.json`): 검증은 `run-eval-executor.mjs`의 인라인 verifyResult가
  `--grade`/`--full` 실행 중에 수행한다(`eval-runs/`의 runDirectory 컨텍스트 필요) — **커밋된
  receipt만으로 사후 독립 재검증하는 표준 명령은 아직 없다**(ai 카탈로그와의 비대칭,
  protected-core §4 등록). web receipt는 실행 당시의 검증 통과 로그 요약을 JSON에 포함해야 한다.
- 공통 경로: `.claude/evals/receipts/<scenario-id>/<run-id>.json`. 실행 메타(하네스 커밋 SHA·
  모델·grader 판정·evidence 파일 경로)가 없으면 그 run은 receipt로 세지 않는다.
- 현재 receipt 0건 — `maturity: eval-covered` 라벨과 receipt의 기계 결속(receipt 없는 라벨을
  fail)은 **미배선**이다. protected-core §4 "maturity의 eval-언급 검사" 행의 승격 조건이며,
  첫 receipt 배치 후 결속을 검토한다(소급 fail 금지 관례 — G3).

실행 명령·파이프라인은 **이 문서가 현행 정본**이다. 서비스별 승격 순서와 최초 설계 배경은
`docs/archive/AI_AGENT_HARNESS_TESTING.md`(2026-07-13 기록, archive 보존)를 참고한다.
