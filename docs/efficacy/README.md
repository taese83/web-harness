# 효능 측정 하네스 (M2)

> B 트랙 마일스톤 2. runaway 방어 게이트가 **실제로 효과가 있는지**를 주장이 아니라
> 증거로 확정한다. 이 디렉터리는 그 측정 설계·프로토콜·receipt의 정본이다.

## 1. 왜 — 자기 I1 구멍

`execution-budget-contract.md`가 스스로 인정한다(L157-164 요지):

- L157-159: *"이 임계는 seminar-booking 단일 서비스 실측에서 뽑은 계산값 … 아직 2개+ 형태로
  일반화되지 않았다."*
- L163-164: *"이는 **교정 증거이지 효능 증거가 아니다**: 이 게이트가 실제 runaway 발생률을
  낮추는지는 Phase 3 재실행으로 측정하기 전이다."*

즉 하네스의 중심 방어 기제가 자기 불변식 **I1(주장≠증명)** 을 아직 만족하지 못한다. M2는 이
문장을 증거로 대체한다. 오픈 범용 control plane이 되려면 중심 기제의 효능이 증명되어야 한다.

## 2. 효능은 **두 개의 다른 질문**이다 (섞으면 I1 위반)

| # | 질문 | 성격 | 비용 |
|---|---|---|---|
| **탐지 효능** | 게이트가 실패 형상(whole-layer fanout·미완 산출·truncation·tamper)을 **실제로 잡는가** | 결정론·오프라인 | ~0 토큰 |
| **결과 효능** | 게이트 **ON이 OFF보다** runaway율↓ / 완주율↑ 를 만드는가 | 라이브 A/B·통계 | 형태당 ~2.8M 토큰 |

두 질문을 한 문장("게이트가 효과 있다")으로 뭉치면 안 된다. 탐지 효능이 증명돼도 결과 효능은
별도로 증명해야 한다 — 잡는 것과 결과를 개선하는 것은 다르다.

## 3. 지표 정의 (`report-execution-telemetry.mjs` 기준)

`_workspace/04_qa/execution-telemetry.json`(`schemaVersion:1`, `spawns[]`)에서 산출:

- **미완주율** = `(truncated + crashed + incomplete) / spawns`
- **완주율** = `complete / spawns`
- **runaway-스폰 비율** = `(tokens>120k OR durationMs>20min) / spawns`
  — ⚠️ **주의: 이 임계는 관측자이지 예방자가 아니다.** ON 상태에서도 초과가 발생한다(§5 실측
  10/22). 예방을 담당하는 것은 pre-spawn `validate-spawn-plan`(whole-layer fanout REFUSE)과
  post-spawn `verify-spawn-completion`(미완 산출 → 재시도)이다.
- **retry율** = `retry===true / spawns`
- **총 토큰** = `Σ tokens` (미계측은 `null`, 절대 날조하지 않음)

## 4. Part 1 — 탐지 효능 (저비용, **이미 실행됨**)

### 1a. 게이트 로직 회귀 — ✅ 완료
```bash
node --test .claude/scripts/test-spawn-plan.mjs \
             .claude/scripts/test-spawn-completion.mjs \
             .claude/scripts/test-resume-manifest.mjs
```
결과: **46/46 pass**. seminar-booking 실패 형상 회귀 포함(`test-spawn-plan.mjs` L190-211
"whole domain layer → REFUSE", readMode 민감도 L160-172). → receipt: [`receipts/gate-logic-unit.md`](receipts/gate-logic-unit.md)

### 1b. 기록된 ON 트레이스 파싱 — ✅ 완료 (n=1)
```bash
node .claude/scripts/report-execution-telemetry.mjs --project workspace/seminar-booking
```
seminar-booking 파일럿(22 스폰·2.8M 토큰)의 ON-암 지표. → receipt:
[`baseline-on-seminar-booking.md`](baseline-on-seminar-booking.md)

### 1c. 합성 리플레이 — ⬜ 예정 (저비용)
게이트 pure core(`analyzePlan`·`scanSource`·`computeRemaining`·`verifyPlanLock`)에 합성/기록
manifest·truncated 파일을 먹여 탐지 **precision/recall**을 결정론적으로 측정. 라이브 실행 0.

## 5. Part 2 — 결과 효능 (고비용, **명시적 예산 승인 게이트**)

현 상태: **OFF(게이트 비활성) 텔레메트리가 어디에도 없고, ON/OFF 토글도 없다.** 따라서 "ON이
runaway율을 낮춘다"는 지금 증명 불가. 필요한 것 셋:

1. **ON/OFF 토글** — 게이트 스크립트에 bypass env는 없다(하드 정책이 막음:
   `global-bash-policy-lib.mjs` L708-736, override 상한 32/200k). 실제 제어점은 *오케스트레이터가
   게이트를 호출하느냐*이므로 토글은 스크립트 플래그가 아니라 **실행 지시 변형**이어야 한다.
   주입 지점: `run-eval-executor.mjs` L97-98 프롬프트 구성(`${entrySkill} ${prompt}`)에 env-gated
   지시 추가 + telemetry `run` 라벨에 `+gatesOff` 태그(라벨은 이미 mode 인코딩: `fresh/iterate/resume`).
2. **암별 텔레메트리 기록** — `run-eval-executor.mjs`가 암(ON/OFF)별로 telemetry를 분리 저장.
3. **소형 라이브 매트릭스** — 2형태 × 2암 × n replicate(율 추정 위해 n≥2-3).
   형태 = **local-domain-state**(seminar류, 기록 ON을 n=1 seed로 재사용) + **enterprise-search**
   (`ai-scenarios.json` L247-355). `--dry-run` 비용 게이트 필수.

**비용:** 기록 파일럿 기준 형태당 ~2.8M 토큰. 신뢰할 A/B(2암×2형태×replicate)는 **order 10~20M+
토큰**. OFF 베이스라인이 한 번도 기록된 적 없어 이 절반은 저비용 대체가 **불가능**하다.

> ⛔ **Part 2 라이브 실행은 사용자의 명시적 토큰 예산 승인 없이 착수하지 않는다.** (I4 비용 정직·
> denial-of-wallet 방어) 승인 전까지 Part 2는 "토글·매트릭스 설계"까지만 진행한다.

## 6. 정직 상태표

| 질문 | 방법 | 비용 | 상태 |
|---|---|---|---|
| 탐지 — 로직 회귀 | unit test 3종 | ~0 | ✅ 46/46 pass |
| 탐지 — 현장(ON) | 기록 트레이스 파싱 | ~0 | ✅ n=1 baseline |
| 탐지 — 합성 precision/recall | pure-core replay | ~0 | ⬜ 예정 |
| 결과 — ON/OFF × 2형태 | 라이브 A/B | 10~20M | ⛔ 예산 승인 대기 |

## 7. 불변식 매핑

- **I1** — 각 셀은 "주장"이 아니라 재현 가능한 명령 + 실측 receipt로만 채운다. 미측정은
  `NOT_MEASURED`로 표기(빈칸·추정 금지).
- **I3** — 결과 효능은 반드시 **2개+ 형태**에서 재현돼야 성립(단일 형태 = 교정, 효능 아님).
- **I4** — Part 2 비용을 토큰 단위로 명시하고 승인 게이트를 둔다.

## 8. 산출물

- [`baseline-on-seminar-booking.md`](baseline-on-seminar-booking.md) — ON-암 n=1 실측 receipt
- `receipts/gate-logic-unit.md` — 게이트 로직 46/46 회귀 receipt
- (예정) `receipts/synthetic-replay.md` — 합성 precision/recall
- (예산 승인 후) `receipts/ab-<shape>-<on|off>.md` — 라이브 A/B 암별 receipt
