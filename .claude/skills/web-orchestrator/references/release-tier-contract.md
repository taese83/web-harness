# Release Tier Contract

최종 release는 격리 CI receipt + 외부 Ed25519 attestation을 요구하며 이는 fail-closed다. 이 계약은 그 게이트를 **완화하지 않는다** — 해당 인프라가 없는 팀이 "영원히 릴리스 불가" 이분법에 빠지지 않도록, 현재 도달한 신뢰 수준을 **정직한 라벨**로 보고하고 다음 단계로 가는 경로를 제시한다.

원칙: tier는 게이트 완화가 아니라 라벨이다. 어떤 tier도 상위 tier의 표현을 빌려 쓸 수 없고, 어떤 validator도 하위 tier 문서를 상위 tier evidence로 읽지 않는다.

## Tier 정의

| Tier | 요구 evidence | 완료 라벨 | 할 수 있는 주장 | 금지 표현 |
|---|---|---|---|---|
| **T0 diagnostic** | host receipt (`--allow-host-execution`, 단일 `--all` cohort) | `DIAGNOSTIC_VERIFIED` | "현재 소스 fingerprint에서 이 명령들이 호스트 환경 기준 exit 0" | "검증 완료", "release 후보", "완성" |
| **T1 isolated-verified** | 격리 CI receipt (`WEB_HARNESS_ISOLATED_EXECUTION=1`, `--all` cohort, 24h freshness) + 필수 QA report 전체 PASS | `ISOLATED_VERIFIED` | "격리 선언 환경에서 전체 품질 게이트 통과" | "release", "완성", "서명됨" |
| **T2 attested-release** | T1 + 외부 Ed25519 attestation + manifest v3 + `validate-release-gate.mjs` exit 0 | `RELEASED` (HANDOFF.md) | "서명된 release evidence" | — |

`WEB_HARNESS_ISOLATED_EXECUTION=1`은 외부 격리 선언이지 증명이 아니다(기존 계약과 동일) — T1 라벨에도 "격리 선언 환경"이라는 한정을 유지한다.

## Tier 판정 절차

1. `node .claude/scripts/validate-release-gate.mjs`를 실행하고 error 목록을 수집한다. **게이트 출력을 수정하거나 재해석하지 않는다.**
2. 판정:
   - error 0개 → **T2**
   - 남은 error가 attestation/trust-config/서명 계열뿐이고 격리 CI receipt·QA report는 모두 현재 fingerprint에서 PASS → **T1**
   - 격리 receipt가 없고 host receipt만 있음 → **T0**
   - host receipt조차 없거나 stale, 필수 QA에 FAIL/BLOCKED → **tier 미달** (`NOT_VERIFIED`)
3. 판정 결과를 완료 보고에 tier 라벨 + **다음 tier 승급에 필요한 항목 목록**으로 포함한다.

## Readiness Report (T2 미만)

T2 미만이면 `release-manager`가 HANDOFF.md 대신 `_workspace/RELEASE/release-readiness.md`를 작성한다:

- 판정 tier와 근거 (receipt cohort ID, fingerprint, gate error 요약)
- QA report별 상태 표
- **승급 경로**: 현재 tier → 다음 tier에 부족한 정확한 항목과 명령/인프라
- 이 문서 자체는 evidence가 아니라는 고지

`enforce-release-gate.mjs`는 HANDOFF.md 작성을 gate 통과 시에만 허용한다 — 이 계약은 그 훅을 우회하지 않으며, readiness report는 HANDOFF 경로가 아니다.

## 불변 규칙

- HANDOFF.md는 T2에서만 존재한다 (기계 강제 유지).
- tier 하향 원인(source 변경으로 receipt stale, trust config 변경 등)이 생기면 라벨도 즉시 하향하고 readiness report를 갱신한다.
- T0/T1 상태에서 완료 메시지에 "완성"·"검증 완료"를 쓰지 않는다 — `completion-contract.md`의 표현 규칙이 tier 라벨을 따른다.
- 사용자가 "T1으로 충분하다"고 결정하는 것은 사용자의 위험 수용이며, 그 경우에도 문서·라벨은 T1로 유지한다(라벨 승격 금지).

## 팀 온보딩 경로

| 목표 | 필요한 것 |
|---|---|
| T0 오늘 시작 | 로컬 Node 22 + pnpm pin — `run-quality-gates.mjs --all --allow-host-execution` |
| T0 → T1 | CI 러너 1개에서 `WEB_HARNESS_ISOLATED_EXECUTION=1 … --all` 재실행 (read-only mount·deny-by-default network는 CI 환경 구성 책임) |
| T1 → T2 | `quality-attesters.json` 신뢰 키 파일을 `.claude` 루트에 프로비저닝(저장소에는 의도적으로 없음 — fail-closed), checkout 밖 protected env 6종, 외부 Ed25519 서명자 — README "검증 방법" 절 |
