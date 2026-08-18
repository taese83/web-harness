# Receipt — ON-암 베이스라인 (seminar-booking, n=1)

**측정 대상:** 게이트 **ON**(활성) 상태에서 완주된 full-service 파일럿 1건.
**성격:** 결과 효능의 ON-암 seed(n=1). OFF 대조군은 존재하지 않음 → 이 receipt 단독으로는
"게이트가 runaway를 낮춘다"를 **증명하지 않는다**(그건 Part 2 A/B의 몫). 이 receipt가 증명하는
것은 (a) ON 상태의 실제 분포와 (b) 완결성 게이트가 현장에서 **발화했다**는 사실이다.

## 재현 명령

```bash
# Node 22.22.3 (nvm) 기준
node .claude/scripts/report-execution-telemetry.mjs --project workspace/seminar-booking
```

원자료: `workspace/seminar-booking/_workspace/04_qa/execution-telemetry.json`
(`schemaVersion:1`, spawns 22개 — **gitignored** workspace, 파일럿 기록물). 아래 수치는 위 명령의
표준출력을 그대로 옮긴 것이다.

## 실측 출력 (2026-08-11+fresh run)

```
=== run: 2026-08-11+fresh — 스폰 22개 ===
  P1: 스폰 10 (retry 3) · 844,039 tokens (10/10 스폰 계측) · 42.9min
  P2: 스폰 6 (retry 0) · 1,130,234 tokens (6/6 스폰 계측) · 84.9min
  P3: 스폰 6 (retry 1) · 831,449 tokens (6/6 스폰 계측) · 60.3min
  토큰 상위 agent:
    design-preview-builder: 473,007
    client-domain-state-builder: 359,782
    feature-planner: 200,550
    shared-foundation-builder: 165,051
    component-designer: 160,135
  완결성 outcome: complete 19 · incomplete 1 · truncated 2
    ⚠️  미완 스폰 3개 — 완결성 게이트 실패가 있었다.
  🐘 runaway 스폰 10개 (>120,000 tokens 또는 >20min):
    tech-advisor [P1]: 146,457 tokens · 6.8min
    layout-designer [P2]: 126,692 tokens · 9.5min
    api-schema-designer [P2]: 129,545 tokens · 9.9min
    state-contract-designer [P2]: 132,479 tokens · 11.9min
    component-designer [P2]: 160,135 tokens · 8.6min
    design-preview-builder [P2]: 473,007 tokens · 36.8min
    shared-foundation-builder [P3]: 165,051 tokens · 11.6min
    app-shell-builder [P3]: 144,652 tokens · 10.0min
    client-domain-state-builder [P3]: 167,986 tokens · 12.2min
    client-domain-state-builder [P3]: 191,796 tokens · 17.2min
  합계: 스폰 22 · retry 4 (18%) · 2,805,722 tokens (22/22 스폰 계측)
```

## 파생 지표 (ON-암, n=1)

| 지표 | 값 |
|---|---|
| 총 스폰 | 22 |
| 총 토큰 | 2,805,722 (22/22 계측) |
| 완주율 (`complete`) | 19/22 = **86.4%** |
| 미완주율 (`truncated+incomplete`) | 3/22 = **13.6%** |
| retry율 | 4/22 = **18.2%** |
| runaway-임계 초과 스폰 | 10/22 = **45.5%** |

## 해석 — 정직하게

1. **완결성 게이트는 현장에서 발화했다(탐지 효능 증거).** `client-domain-state-builder`가 P3에서
   `incomplete`(167,986 토큰, "파일 0개 작성 후 종료")로 잡혀 **재시도**되었고 재시도가
   `complete`(191,796)로 마감됐다. 미완 산출 위에 다음 단계를 쌓지 않았다 = 게이트의 의도된 동작.
   `truncated` 2건(layout-designer·api-schema-designer)도 같은 계열로 표시됐다.

2. **runaway 임계(120k/20min)는 예방자가 아니라 관측자다.** ON 상태인데도 10/22 스폰이 임계를
   넘었다. 이 임계는 "큰 스폰을 막는" 장치가 아니라 "큰 스폰을 표시하는" 진단이다. 예방은
   pre-spawn `validate-spawn-plan`(whole-layer fanout REFUSE)이 담당하며, 그 효능은 이 트레이스가
   아니라 §Part 1의 단위 테스트/합성 리플레이로 측정한다.

3. **이것은 n=1이다.** 이 한 건으로 완주율 86.4%가 "게이트 덕분"이라고 말할 수 없다 — OFF 대조군이
   없기 때문이다. 완주율·runaway율이 게이트에 **인과적으로** 귀속되는지는 Part 2(ON/OFF × 2형태
   라이브 A/B)에서만 결정된다. 이 receipt는 그 A/B의 ON-암 첫 데이터점으로 재사용된다.

## 한계 고지

- workspace 기록물은 gitignored이므로 원자료는 저장소에 없다. 위 명령은 해당 워크스페이스가
  로컬에 존재할 때만 재현된다. 파생 지표 표는 이 receipt에 고정 보존된다.
- 토큰은 오케스트레이터가 스폰 후 수기 기록한 값(자동 훅 아님) — `report-execution-telemetry.mjs`는
  집계만 하며 미계측을 `null`로 둔다. 이 파일럿은 22/22 전부 계측됨.
