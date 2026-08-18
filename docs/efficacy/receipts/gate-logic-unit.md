# Receipt — 게이트 로직 회귀 (탐지 효능, 결정론)

**측정 대상:** runaway 방어 3게이트의 pure-core 로직이 실패 형상을 잡는지를 결정론 단위
테스트로 확인. 라이브 실행 0 토큰.

## 재현 명령

```bash
# Node 22.22.3 (nvm)
node --test .claude/scripts/test-spawn-plan.mjs \
             .claude/scripts/test-spawn-completion.mjs \
             .claude/scripts/test-resume-manifest.mjs
```

## 실측 결과 (2026-08-18)

```
# tests 46
# suites 0
# pass 46
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 331.584291
```

**46/46 pass.**

## 무엇을 증명하는가

- `validate-spawn-plan` — whole-layer fanout(`OUTPUT_FANOUT`)·read 예산 초과(`READ_BUDGET`)·
  누락 read(`READ_MISSING`)를 `REFUSE`로 잡는다. seminar-booking 실패 회귀 포함
  (`test-spawn-plan.mjs` L190-211: "whole domain layer → REFUSE + OUTPUT_FANOUT+READ_BUDGET",
  L160-172: readMode `browse`/`injected` 민감도).
- `verify-spawn-completion` — 미작성(`MISSING`)·빈 파일/truncation(`SUSPECT`)·**0-산출 vacuous
  PASS 방지**(no-output guard)를 잡는다. 이 guard는 seminar-booking에서
  `client-domain-state-builder`가 파일 0개 쓰고 "checked 0 · PASS"로 통과할 뻔한 사건 회귀.
- `resume-manifest` — `done/truncated/missing` 분류, plan-lock tamper 탐지(`TAMPERED`),
  축소된 plan이 COMPLETE를 사칭하지 못함(fail-closed). 위조 성립 한계도 회귀로 고지
  (원장+planLock 모두 삭제 시 충돌 소멸).

## 위치 (탐지 효능 매트릭스에서)

이 receipt는 [`../README.md`](../README.md) §4-1a에 해당 — **탐지 로직**의 결정론 증거다.
탐지의 나머지(현장 ON 분포)는 [`../baseline-on-seminar-booking.md`](../baseline-on-seminar-booking.md),
합성 precision/recall은 (예정) `synthetic-replay.md`가 채운다. **결과 효능**(ON/OFF)은 이
receipt로 증명되지 않는다 — §Part 2 라이브 A/B의 몫.
