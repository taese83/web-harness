# Harness Eval Contracts

- `scenarios.json`: 웹 harness의 대표 회귀 계약
- `fixtures/`: result verifier 자체 테스트용 계약 fixture

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
③ 기계 검증 2중: PASS evidence의 실존 파일 참조 확인(fail-closed) + result JSON 스키마 검증.

executor는 전체 앱 빌드를 수행할 수 있어 시나리오당 수십 분·상당한 토큰이 든다.

### 진입점과 커버 선언 (2026-09-11)

- **`entrySkill`은 사용자가 치는 첫 입력이다.** 레인 수준 시나리오는 `/wh <lane>`으로 들어간다 —
  종전에는 48개 중 43개가 `[내부]` 스킬로 곧장 들어가 레인 판정·게이트를 시험하지 않았다.
- **컴패니언 단위 시험**(모드로 골라 쓰는 부품)은 직접 들어가되 `entryKind: "internal-unit"`을
  선언한다 — `/wh`로 넣으면 라우팅 실패와 컴패니언 계약 위반이 한 시험에 섞여 원인을 가를 수 없다.
- **`covers`는 이 시나리오가 증명하려는 스킬이다.** `maturity: eval-covered`는 이 필드만 센다
  (자유 텍스트 언급은 세지 않는다). **선언일 뿐 실행 증거가 아니다** — 아래 receipt와 구별한다.
- `validate-entry-points`가 셋을 검사한다(레인은 `wh/SKILL.md` 선언에서 읽는다).
`--dry-run`으로 먼저 확인하고 개별 시나리오 단위로 실행할 것. `eval-runs/`는 VCS 제외.

## 실행 receipt — 커밋 대상 (2026-08-23 신설)

실행 산출물 전체(`eval-runs/`)는 VCS 제외를 유지한다 — fixture·transcript는 크고 재현
가능하다. **판정 결과만 커밋한다**:

- 검증은 `run-eval-executor.mjs`의 인라인 verifyResult가 `--grade`/`--full` 실행 중에
  수행한다(`eval-runs/`의 runDirectory 컨텍스트 필요) — **커밋된 receipt만으로 사후 독립
  재검증하는 표준 명령은 아직 없다**(protected-core §4 등록). receipt는 실행 당시의 검증
  통과 로그 요약을 JSON에 포함해야 한다.
- 공통 경로: `.claude/evals/receipts/<scenario-id>/<run-id>.json`. 실행 메타(하네스 커밋 SHA·
  모델·grader 판정·evidence 파일 경로)가 없으면 그 run은 receipt로 세지 않는다.
- 현재 receipt 1건(`complete-harness-packaging`, 2026-08-27) — 나머지 47 시나리오는 미실행이며 `maturity: eval-covered` 라벨과 receipt의 기계 결속(receipt 없는 라벨을
  fail)은 **미배선**이다. protected-core §4 "maturity의 eval-언급 검사" 행의 승격 조건이며,
  첫 receipt 배치 후 결속을 검토한다(소급 fail 금지 관례 — G3).

실행 명령·파이프라인은 **이 문서가 현행 정본**이다.
