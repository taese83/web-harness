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

## 릴리스 전 회귀 — 배포본 플러그인 평가 (`.claude/evals/plugin/`)

스크립트 테스트는 CLI·훅이 맞는지만 잰다. 계약·프롬프트·에이전트 문서를 바꾼 릴리스는 **배포본이 그대로 행동하는지**를
따로 본다. 사례는 `claude plugin eval` 형식(`<사례>/prompt.md` + `graders/*.md` + `case.yaml`)이고, 빌드된
`dist/web-harness-plugin` 사본에 사례와 시드(`seeds/`)를 붙여 격리 실행한다 — 사용자에게 가는 배포본에는 싣지 않는다.

```bash
node .claude/scripts/run-plugin-evals.mjs                          # 전 사례, 사례마다 3회(pass^3)
node .claude/scripts/run-plugin-evals.mjs --case ticket-draft-team-form --runs 1   # 한 사례 시범
```

- **언제**: `.claude/skills`·`.claude/agents`·계약 문서를 바꾼 릴리스 전. `dist` 판본이 소스 판본과 같아야 돈다(CI 빌드 후).
- **판정**: 사례의 모든 실행이 통과해야 통과다(pass^k). 실행은 비대화라 승인 지점에서 멈추고 보고하는 것이 정답이다.
- **사례 작성**: 레인 사례의 요청은 interaction-contract 「질문이 필요한 경우」(데이터 모델·저장 범위가 선택에 따라
  갈린다)에 걸리지 않게 쓴다 — 걸리면 먼저 묻는 것이 정답이라 사례가 재려는 경로에 가지 않는다. 고치는 쪽은 요청이다:
  「묻고 멈춤」을 통과시키려고 채점기를 넓히지 않는다(양성 채점기가 공허해진다).
- **지표**: receipt(`receipts/plugin/<시각>.json`, schema 3부터 사례·시드 digest로 잰 판본을 묶고, schema 4부터 실행별 디스패처 누락 건수 `dispatcherNotFound`를 남긴다)에 실행마다 턴·최대 컨텍스트·출력 토큰·비용·에이전트 스폰·
  하네스 스크립트 소스를 연 횟수(도구 안내가 부족하다는 신호)를 남긴다 — 컨텍스트 절감 같은 변경의 전후 비교 기준이다.
- **비용**: 실행마다 실제 모델 호출이다. `--max-cost-usd`(기본 40)가 상한이고, 넘으면 부분 결과로 끝난다(종료 2).
- **사후 검사**: 사례의 `checks.json`을 실행 뒤 작업 공간에서 결정적으로 본다 — `source-unchanged`(시드와 해시 대조, 쓴 에이전트와
  무관), `ticket-drafts-valid`(배포본의 초안 검사기 그대로), `file-exists`, `artifact-exists`(파일이나 같은 이름의 분할 디렉터리),
  `file-absent`(멈춰야 할 단계를 넘지 않았는가), `artifact-matches`(파일이나 분할 `INDEX.md`에서 정규식 — 상태 줄·열린 결정).
  배포본에 있는 스크립트를 디스패처가 못 찾은 실행과 인증 실패로 모델에 닿지 못한 실행은 판정이 아니라 환경 오류다(종료 2) —
  배포본에 디스패처가 있는데 셸이 못 찾은 실행도 환경 오류다. 러너는 부모 세션 PATH에서 설치된 플러그인 bin을 빼고 배포본 bin을
  앞에 둔다(설치본과 같은 조건 — 없으면 서브에이전트가 디스패처를 못 찾는다). 인증이 만료됐으면 `claude auth login` 뒤 다시 돌린다.
- **릴리스 채택 조건**: 선택 없이 돈 실행(`selection`의 case·tag·runs가 전부 null — regression 사례 전원·prompt.md의 runs) ·
  `partial: false` · 환경 오류 없음 · receipt의 `harnessCommit`이 릴리스 커밋이고 `dirty: false`. 러너는 평가 직전에 그 트리로
  dist를 다시 빌드한다(`distDigest`가 그 빌드다).
- **보지 않는 것**: 비대화 규약이 첫 ✋에서 멈춘다. 앞 단계를 시드로 깐 사례(`predev-stops-at-api-decision`)로 착수 전 구간(⓪①②)까지는
  보지만, 구현·검증(Gate 0 이후)은 보지 않는다. 채점은 결정적이라 초안
  문장의 품질(완료 조건이 관측 가능한지)은 판정하지 않는다 — 그런 판단은 능력 평가의 몫이다. 사례 5개·k=3이라 드문 회귀는 놓친다.
- `run-eval-executor.mjs`의 시나리오(`scenarios.json`)는 저장소 모드 능력 평가로 남는다.

## 실행 receipt — 커밋 대상 (2026-08-23 신설)

실행 산출물 전체(`eval-runs/`)는 VCS 제외를 유지한다 — fixture·transcript는 크고 재현
가능하다. **판정 결과만 커밋한다**:

- 검증은 `run-eval-executor.mjs`의 인라인 verifyResult가 `--grade`/`--full` 실행 중에
  수행한다(`eval-runs/`의 runDirectory 컨텍스트 필요) — **커밋된 receipt만으로 사후 독립
  재검증하는 표준 명령은 아직 없다**(protected-core §4 등록). receipt는 실행 당시의 검증
  통과 로그 요약을 JSON에 포함해야 한다.
- 공통 경로: `.claude/evals/receipts/<scenario-id>/<run-id>.json`. 실행 메타(하네스 커밋 SHA·
  모델·grader 판정·evidence 파일 경로)가 없으면 그 run은 receipt로 세지 않는다.
- 현재 receipt 9건 — `complete-harness-packaging`(2026-08-27)과 회귀 묶음 8건(0.42.0·0.43.0·0.44.0·0.45.0 릴리스 전 각 2건). 나머지 47 시나리오는 미실행이다. **스킬 라벨로 세면 `eval-covered` 12개 중 receipt가 뒷받침하는 것은 `project-init` 1개**다(2026-09-11 실측) — 나머지 11개의 라벨은 「시나리오가 선언돼 있다」는 뜻이지 「돌려봤다」가 아니다. 라벨과 receipt의 기계 결속(receipt 없는 라벨을
  fail)은 **미배선**이다. protected-core §4 "maturity의 eval-언급 검사" 행의 승격 조건이며,
  첫 receipt 배치 후 결속을 검토한다(소급 fail 금지 관례 — G3).

실행 명령·파이프라인은 **이 문서가 현행 정본**이다.
