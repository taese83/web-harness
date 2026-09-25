# Execution Budget Contract

하네스 **자체 실행**의 비용 상한과 초과 시 행동 규칙이다. 생성되는 앱의 성능 예산(`cost-latency-budget.md`)이나 변경 범위 예산(`CHANGE_BUDGET`)과 다르다 — 이 계약의 대상은 오케스트레이션이 쓰는 스폰 수와 컨텍스트 소비다.

## 왜 필요한가

상한 없는 오케스트레이션은 denial-of-wallet이다 — 성능 향상이 아니라 비용 통제 실패다.

## 측정 단위

오케스트레이터가 정확히 셀 수 있는 것만 **예산(cap) 단위**로 쓴다.

- **스폰 수** — Agent/Task 호출 횟수 (retry 포함)
- **산출물 바이트** — `_workspace`에 쓴/읽은 파일 크기 (`artifact-sharding-contract.md`의 예산과 연동)
- **토큰 실측** — cap 단위가 아니라 **관측 지표**다. 토큰은 사후에만 알 수 있으므로 cap은 여전히 스폰·바이트로 걸고, 실측은 아래 telemetry로 기록해 cap 조정·재읽기 비용 진단의 근거로 쓴다.

사용자가 명시적 토큰 예산(예: "10k 토큰으로", "+500k")을 지시하면 그것이 아래 기본값보다 우선한다.

## 실행 telemetry (실측 기록)

- 오케스트레이터는 **스폰(Agent/Task 호출)이 끝날 때마다** 결과 metadata의 usage를 `_workspace/04_qa/execution-telemetry.json`에 append한다:

```json
{"schemaVersion": 1, "spawns": [
  {"run": "2026-08-04T09:00+fresh", "phase": "P2", "agent": "layout-designer",
   "retry": false, "mode": "fresh", "tokens": 51234, "toolUses": 18, "durationMs": 195912,
   "outcome": "complete", "returnTruncated": false}
]}
```

- `run`은 실행 시작 시각+모드(fresh/iterate/resume)로 한 번 정해 같은 실행의 모든 spawn에 동일하게 쓴다. retry 스폰은 `retry: true`로 같은 파일에 append한다.
- `mode`는 `fresh` | `resume`다 — 새 스폰인지 이전 컨텍스트를 이어받은 재개인지. `resume`이면 `resumeOf`에 이어받은
  스폰의 인덱스를 적는다. **이 둘이 없으면 재개 체인의 비용을 사후에 셀 수 없다** — `retry: true`는 실패 재스폰·
  컨텍스트 재개·피드백 라운드·후속 작업을 전부 섞는다(2026-08 파일럿 34건이 그랬다).
- `returnTruncated`는 반환 서사가 끊겼는지다. `outcome`과 독립이며, 산출물이 완결이면 `outcome: complete` + 
  `returnTruncated: true`가 정상 조합이다.
- `outcome`은 "스폰 완결성 게이트" 판정 결과다: `complete` | `truncated` | `crashed` | `incomplete`. 값을 지어내지 않는다 — 게이트를 돌리지 않았으면 `outcome`을 생략한다(누락은 미판정이지 complete가 아니다).
- 실행 환경이 usage를 제공하지 않으면 해당 필드를 `null`로 기록한다 — **값을 추정하거나 지어내지 않는다.** `tokens: null` 행도 스폰 수 집계에는 유효하다.
- 이 파일은 QA receipt가 아니다. `evidence/` 디렉토리에 두지 않고(receipt 검증과 분리) `_workspace/04_qa/` 직하에 둔다 — release fingerprint 제외 경로라서 Phase 4 중 append가 source hash를 stale로 만들지 않는다.
- 집계 보고: `node .claude/scripts/report-execution-telemetry.mjs --project {root}` — run·phase별 스폰/토큰 합계, 토큰 상위 agent, retry 비율을 출력한다. **advisory이며 gate가 아니다** — 이 수치로 release 판정을 바꾸지 않는다.

## 스폰 완결성 게이트

스폰 수 cap은 **몇 번 스폰했나**를 세지만 **개별 스폰이 온전히 끝났나**는 보지 않는다. 이 게이트는 그 구멍(편집 도중 truncate·환경 crash로 깨진 산출물 위에 다음 단계가 쌓임)을 메운다 — 3개 layer이며, **구현/빌더 계열 스폰마다 다음 의존 단계로 진행하기 전에** 적용한다.

**판정 계열(설계자·리뷰어·verifier)에도 Layer 1을 적용한다.** 이들은 파일이 아니라 텍스트를 반환해 Layer 2가 닿지 않고, `maxTurns`에 걸리면 **에러가 아니라 빈 보고로 끝나 정상 종료와 반환 형태가 같다**. 반환을 파일로 저장해 기계로 검사한다:

```bash
node .claude/scripts/verify-spawn-completion.mjs --return {반환 저장 파일}
```

exit 1이면 판정을 채택하지 않는다 — **빈 보고를 "검토했다"로 쓰지 않는다.** 판정 계열 마커는 `FILES:` 대신 `FINDINGS: <건수 또는 none>`을 쓴다.

### Layer 1 — 완결성 마커 프로토콜

구현/빌더 스폰은 반환 끝에 다음 블록을 낸다:

```
SPAWN_RESULT: complete | blocked
FILES: <생성·수정한 owned 파일 목록>
SELF_CHECK: <자체 확인 요약 또는 none>
```

오케스트레이터는 반환에서 이 블록을 찾는다. 다음이면 스폰을 **incomplete**로 처리한다:

- 블록 부재, 또는 `SPAWN_RESULT`가 `complete`가 아님
- 반환이 작업 노트·문장 도중에서 끝남(요약 없이 종료 — truncation 신호)
- 실행 환경이 조기 종료를 보고("terminated early", "API error", "connection closed")

`outcome`은 truncation 계열이면 `truncated`, 환경 crash면 `crashed`, 그 외 미완이면 `incomplete`로 telemetry에 기록한다.

**반환 서사의 절단과 산출물의 미완은 다른 일이다.** 아래를 **모두** 만족하면 `complete`로 적고 절단 사실은
`returnTruncated: true`로 남긴다 — 반환 서사는 산출물이 아니다(규칙 5의 보고서형 스폰은 반대로 텍스트가 산출물이다).

- `verify-spawn-completion --paths/--expect`가 전건 OK
- 잠금 매니페스트가 있으면 `resume-manifest`의 remaining 0
- **비-scannable 산출물**(md·json 등)은 위 둘이 존재·비어있지 않음만 보므로, 그 형태의 도메인 검사
  (sharding·INDEX 등)가 PASS여야 한다. 절 중간에서 끊긴 문서는 두 게이트를 통과한다

셋 중 하나라도 없으면 종전대로 `truncated`다. 조건을 낮춰 `complete`로 적으면 미완이 숨는다.

관측(2026-08 파일럿, 오케스트레이터 `note` 판독 — 기계 receipt는 8건 중 4건): `truncated` 9건 중 8건(1,299k)이
산출물 완결이라고 기록돼 있고 진짜 절단은 1건이었다. 성공을 실패로 세면 미완률이 부풀고 진짜 낭비를 못 본다.

### Layer 2 — 산출물·구문 기계 검증

의존 단계로 진행하기 전, owned 파일에 대해 실행한다:

```bash
node .claude/scripts/verify-spawn-completion.mjs --root {project} --paths {owned prefix} --expect {선언 산출물}
```

- 선언 산출물이 존재하고 비어있지 않은지, `.ts/.tsx/.js/.mjs`가 truncation 신호(미종결 문자열·주석·템플릿, 짝 안 맞는 괄호, dangling opener/operator로 끝) 없이 파싱되는지 확인한다.
- exit 1(SUSPECT/MISSING)이면 스폰을 완료로 처리하지 않는다.
- `owned prefix`는 `agent-registry.mjs`가 그 agent에 강제하는 ownership 경로와 일치시킨다(빌더가 실제로 쓰는 경로 — 오케스트레이터가 지시한 경로가 아니라 레지스트리 값).
- 이 게이트는 **의미 결함(타입 오류 등)까지는 못 잡는다.** toolchain+deps가 있으면 `run-quality-gates`의 typecheck가 더 깊은 게이트다. `verify-spawn-completion`은 install 없이 항상 도는 1차 방어선으로, "편집 도중 잘려 깨진 파일" 실패 클래스를 잡는다.
- **무산출 가드**: `--paths`로 owned 범위를 지정했는데 스캔 가능한 산출물이
  0개이면 "검사 0 · PASS"(vacuous PASS)가 아니라 **FAIL**이다. 산출물이 정당하게 0개인 스폰(검증 전용 등)만
  `--allow-no-output`으로 명시한다. **오케스트레이터는 owned 디렉토리의 실제 파일 존재를
  반드시 확인하고, 반환 텍스트의 완료 주장만으로 진행하지 않는다**(반환은 truncation 직전
  "이제 파일을 쓰겠다"로 끝나면서 실제로는 0파일일 수 있다).

### Layer 3 — per-spawn 규모 임계 (runaway)

스폰 수 cap과 별개로, **단일 스폰**이 다음을 넘으면 runaway로 플래그한다:

- 토큰 > 120,000 **또는** durationMs > 20분 (advisory soft — 사용자의 명시적 토큰 예산 지시가 있으면 그것이 우선)

runaway 감지 시 다음 스폰 전에 아래 "초과 시 행동 규칙"을 적용한다(조용히 진행 금지, 원인·남은 작업 보고, 병렬 폭 축소·scope 분할 등 degrade 고려).

### 게이트 실패 시 행동

- **re-spawn**: `retry` 예산에서 차감하고 `retry-policy.md`의 진전 조건을 지킨다. 같은 실패를 반복 스폰하지 않는다.
- 진전이 없거나 예산이 소진되면 **`NEEDS_DECISION`**으로 사용자에게 남은 작업·원인과 함께 알린다.
- **절대 깨졌거나 불완전한 산출물 위에 다음 단계를 쌓지 않는다.** 완결성 미확인은 "일단 진행"의 사유가 아니다.

## 스폰 분해와 스펙 주입 (runaway 예방 — 서비스 규모 실측 도출)

per-spawn 규모 임계(Layer 3)와 무산출 가드는 runaway를 **사후 검출**한다. 아래 규칙은 스폰 전에 **예방**한다.

**규칙 1~3은 `spawn-decomposition-contract.md`에 있다** — 출력 분해·발췌 주입(기계 게이트 `validate-spawn-plan.mjs`),
재개 가능한 빌드(`resume-manifest.mjs`)와 계획 잠금. 산출물을 여러 개 쓰는 빌더 스폰(구현·프리뷰·설계 빌더)을
계획할 때 그 계약을 먼저 읽는다. 규칙 4(산출 스폰)·5(보고서형 스폰)는 아래에 있다.

4. **즉시-쓰기 계약 (무산출 예방 — 프롬프트 규칙).** <!-- marker:immediate-write-contract --> 산출 스폰 프롬프트에 **"첫 도구 호출은
   반드시 선언 산출물 중 하나의 Write"**를 명시하고, 읽기가 필요하면 **상한과 순서를 함께
   지정**한다("읽기는 최대 N회: a → b → c, 그 외 재독 금지"). 규칙 2(발췌 주입, `spawn-decomposition-contract.md`)와 짝이다 —
   주입했으면 읽을 것이 없으므로 즉시 쓸 수 있다.

   유형 구분(재발 시 오진 방지): ①읽기 후 절단(다수) ②**장시간 hang**(tool round가 발생하지 않아
   SendMessage 재개 지시도 미전달 → `TaskStop` 후 재스폰이 유일 회수 경로) ③**세션 경계 유실**
   (백그라운드 스폰이 세션 재시작에 결박 — 무산출이 아니라 운영 유형).
5. **축소-스코프 재개 (보고서형 산출물의 절단 대응 — 프롬프트 규칙).** read-only verifier처럼
   **보고 텍스트 자체가 산출물**인 스폰은 완결성 게이트(파일 존재 기반)가 무력하다. 절단
   징후(최종 메시지가 서사 중간에서 끊기거나 공백)면 재개 프롬프트를 **범위 축소형**으로
   보낸다: "이미 수행한 검증 결과만으로 **지금 즉시** 완결 보고를 출력하라 — 추가 도구 호출
   없이" + 출력 형식(첫 절 `## Result` + status 한 단어)을 지정한다.

   회수한 보고는 오케스트레이터가 재타이핑하지 말고
   **transcript JSONL의 마지막 assistant 텍스트를 기계 추출**해 저장한다(컨텍스트 절약이자
   전사(轉寫) 변조 방지).

   **한계**: 규칙 4·5는 프롬프트 산문이라 기계 강제가 없다(준수는 telemetry `outcome` 분포로만
   사후 확인). 처음부터 적게 선언한 산출물은 어떤 게이트도 잡지 못한다 — 계약 몫이다.

이 규칙들은 `retry` 예산이 아니라 **첫 스폰 설계**에 적용한다 — 예방이 재시도보다 싸다.

## 스폰 예산 (기본값)

| 구간 | Fresh/greenfield | existing-change · iterate |
|---|---|---|
| Phase 1 기획 | 6 | — (재사용) |
| Phase 2 디자인 | 12 | 필요 Wave만 |
| Phase 3 개발 | 22 | 12 |
| Phase 4 검증 | 18 | 10 |
| QA retry | 6 | 4 |
| **전체 soft cap** | **55** | **25** |

조건부 MODE가 둘 이상 활성이면 활성 MODE당 전체 cap을 +6 한다. cap은 soft다 — 초과가 곧 실패는 아니지만, 초과 시 아래 행동 규칙을 반드시 따른다.

## 체크포인트 보고

각 Phase 완료 체크포인트(`approval-checkpoints.md`)에 다음을 함께 표시한다:

```
📊 실행 예산: 스폰 {사용}/{cap} · _workspace {누적 KB} · 토큰 {telemetry 누적 실측 | 미계측}
```

토큰 값은 `execution-telemetry.json`의 해당 run 합계다. usage가 제공되지 않은 환경이면 "미계측"으로 표시하고 숫자를 지어내지 않는다.

## 초과 시 행동 규칙

- **조용히 진행하지 않는다.** cap 도달 시 남은 작업량과 초과 원인을 보여주고 `NEEDS_DECISION`으로 계속 여부를 확인한다.
- **허용되는 degrade**: 병렬 폭 축소(순차 전환), sharded 산출물의 절 단위 읽기 강화, 같은 owner의 인접 verifier scope 병합.
- **금지되는 degrade**: release 필수 evidence 생략, machine receipt 없는 판정, 검증 표본 축소의 미보고. 예산 부족은 hard gate를 약화할 사유가 아니다 — 예산이 다하면 gate를 건너뛰는 게 아니라 멈추고 사용자에게 알린다.
- retry 스폰도 같은 예산에서 차감한다. `retry-policy.md`의 진전 조건과 결합해 진전 없는 retry에 예산을 쓰지 않는다.

## 모델 계층 (advisory)

실행 환경이 모델 선택을 지원할 때만 적용한다. frontmatter `model`이 기본값이다.

| 계층 | 대상 | 강등 |
|---|---|---|
| 기계적 | `environment-scaffolder`(package·tooling·test 설정, 배포 config) | 저비용 모델 허용 |
| 생성 | builder·designer 계열 | 기본 유지 |
| 판단 | `plan-reviewer`, `design-reviewer`, `code-reviewer`, `security-reviewer`, verifier 전원, `release-manager` | 강등 금지 |

판단 계층을 강등해 얻는 절감은 false PASS 위험보다 작다.

## 동적 확장 (hybrid)

정적 Phase 구조가 커버하지 못하는 탐색·취향 작업 — 레이아웃/네이밍 N안 비교, generate-and-filter, tournament, 가설 병렬 검증 — 은 오케스트레이터가 경량 동적 워크플로로 확장할 수 있다. 단 세 원칙을 지킨다:

1. **등록된 agent 정의를 빌딩블록으로 재사용한다.** `.claude/agents/`에 있는 역할로 조합하고, 즉석 페르소나 발명은 기존 정의로 표현 불가능할 때만 한다.
2. **같은 예산에서 차감하고 같은 가드레일을 지킨다.** 동적으로 스폰해도 ownership hook, release gate, machine receipt 요구를 우회하지 않는다.
3. **결과를 `_workspace`에 기록한다.** 비교안·심사 근거·탈락 사유를 산출물로 남겨 정적 실행과 같은 감사 가능성을 유지한다.

정적 골격이 반복성과 감사 가능성을 담보하고, 동적 확장이 탐색 품질을 담보한다. 어느 쪽도 다른 쪽의 규칙을 면제하지 않는다.
