# Phase 4 — 검증 (테스트 준비 → 결정론적 실행 → 판정)

`web-orchestrator`의 Phase 4 본문이다. **Phase 3 체크포인트를 통과한 시점에 읽는다**(선행 로드 금지).
SKILL.md 본문에서 시점 로드로 강등했다(2026-08-27) — 강등 근거와 한계는 `docs/protected-core.md` §4.

package/config/source 구현이 끝난 현재 project를 대상으로 같은 deployment/capabilities로 profile resolver를 다시 실행하고 canonical `web-execution-plan.json`을 다시 컴파일한다. framework/toolchain declaration, adapter hash, plan graph가 달라졌거나 exact version이 아니면 quality runner 전에 `BLOCKED`다.

external ingestion greenfield에서는 web app과 crawler/workflow/runtime contract를 같은 canonical project root에 둔다. parent wrapper의 crawler와 nested web app을 서로 다른 release root로 만든 뒤 한쪽 evidence만으로 완료하지 않는다. 기존 split-root project는 자동 재배치하지 않고 migration decision이 확정될 때까지 `BLOCKED`다.

먼저 `environment-scaffolder`와 `developer`를 순서대로 실행한다. 로컬 진단에서는 오케스트레이터가 사용자 확인 후 실제 process exit를 기록하는 quality runner를 실행한다:

```bash
node .claude/scripts/run-quality-gates.mjs --all --allow-host-execution
```

quality runner는 generated project의 package script를 실행하므로 실행 직전에 사용자 확인을 받는다. 이 host receipt는 진단 전용이다. release 후보는 격리 CI에서 `WEB_HARNESS_ISOLATED_EXECUTION=1 node .claude/scripts/run-quality-gates.mjs --all`로 다시 실행한다. `external-ingestion` capability에서는 built-in artifact semantic validation을 포함한 `ingestion` receipt가 같은 cohort에 반드시 있어야 한다. host public env는 자동 상속하지 않고 `_workspace/02_design/build-environment.json`에 이름이 명시된 공개 변수만 전달한다.

runner가 non-zero여도 보고서를 생략하지 않는다. `_workspace/04_qa/evidence/*.json`의 `FAIL`/`BLOCKED`를 owner에게 연결하는 QA 보고서를 생성하고 retry 여부를 판단한다. verifier가 Markdown에 임의의 exit code를 작성하거나 machine receipt를 대신 생성하면 안 된다.

그 다음 아래 read-only verifier를 병렬 실행한다:
- `code-reviewer` → `_workspace/04_qa/qa-code.md` (TypeScript, ESLint, FSD, a11y, 테스트 파일 존재 여부)
- `ux-validator` → `_workspace/04_qa/qa-ux.md`
- `integration-verifier` → `_workspace/04_qa/qa-integration.md`
- `security-reviewer` → `_workspace/04_qa/qa-security.md`
- `api-contract-verifier` → `_workspace/04_qa/qa-api-contract.md`
- `ANALYTICS_BUILDER_MODE`이면 `analytics-verifier` → `_workspace/04_qa/qa-analytics.md`
- `LOCAL_DOMAIN_STATE_MODE`이면 `state-invariant-verifier` → `_workspace/04_qa/qa-state.md`
- `EXTERNAL_DATA_INGESTION_MODE`이면 `data-quality-verifier` → `_workspace/04_qa/qa-data-quality.md`. 공개 노출 요구이면 `seo-verifier` → `qa-seo.md`, `performance-budget.md`가 있으면 `performance-verifier` → `qa-perf.md`, `TIMESERIES_MODE`이면 `timeseries-verifier` → `qa-timeseries.md` (모두 `_workspace/04_qa/`)
- 다중 tenant·서버 인가 경로가 있으면 `data-access-verifier` → `_workspace/04_qa/qa-data-access.md`
- `test-executor` → `_workspace/04_qa/qa-test.md`
- `browser-verifier` → `_workspace/04_qa/qa-browser.md`
- `VISUAL_QA_MODE`이면 `visual-regression-verifier` → `_workspace/04_qa/qa-visual.md`

`TIMESERIES_MODE`에서는 API contract에 stream schema/cursor를 포함하고 browser QA에 normal/max/burst, reconnect/gap, visible-point, render cadence, heap trend를 포함한다.

`ANALYTICS_BUILDER_MODE`에서는 semantic query, chart compatibility, dashboard revision과 Funnel/Retention/Flow fixture를 QA에 포함한다. `qa-analytics.md` 누락이나 `BLOCKED`는 release hard stop이다.

`LOCAL_DOMAIN_STATE_MODE`에서는 state-contract의 invariant와 filter/search × mutation matrix를 unit/browser QA에 포함한다. 데이터 손실 가능성, 구조 필드 broad patch, hidden-data destructive action, migration/recovery 누락은 release hard stop이다.

`EXTERNAL_DATA_INGESTION_MODE`에서는 source fixture, runtime schema, empty/drift/count-drop, atomic promotion, last-known-good, clean clone/provider build matrix를 검증한다. static target에서는 promoted `public/` required/validated optional/last-known-good snapshot과 실제 `dist/|out/` 복사본 digest가 같아야 한다. `ingestion` machine receipt 누락, required artifact 누락·empty·schema/count/freshness/coverage failure, 배포 복사본 parity 실패, 실제 runtime mode와 locked capability 불일치는 release hard stop이다. Vercel static external-ingestion은 격리 build namespace 종료 후 attested immutable artifact를 동일 prebuilt deployment에 결합하는 protected broker evidence가 없으면 provider build가 통과해도 release `BLOCKED`다. Markdown `qa-data-quality.md`만으로 machine receipt를 대체하지 않는다.
`VISUAL_QA_MODE`에서는 승인 manifest와 browser `visualEvidence`를 요구한다. unreviewed baseline, stale hash, missing target/mode, snapshot mutation, 환경 drift는 release hard stop이다.

read-only verifier는 보고서 본문을 반환하고 오케스트레이터가 해당 경로에 저장한다. verifier에게 Write/Edit 권한을 부여하지 않는다.

Next 최종 리포트를 제외한 일반·조건부 QA 리포트와 격리 CI receipt가 완성되면 external quality attestation을 만든다. Next profile은 서명 뒤 machine validator와 read-only verifier를 순서대로 실행해 `_workspace/04_qa/qa-next-contract.md`를 저장한다. 그 다음 report hash, machine receipt, 전체 source fingerprint, 모든 package/workspace manifest hash와 attestation을 manifest v3에 고정한다:

```bash
node .claude/scripts/prepare-quality-attestation.mjs --project . --issuer-run-id <trusted-ci-run-id>
# unsigned request를 checkout 밖의 protected trust/CI identity와 대조해 final subject를 구성·서명한 뒤
# Next profile이면 validate-next-contracts.mjs와 next-contract-verifier를 실행한 뒤
node .claude/scripts/validate-release-gate.mjs --write-manifest
node .claude/scripts/validate-release-gate.mjs
```

필수 리포트 누락, `FAIL`, `BLOCKED`, `NEEDS_REVIEW`, receipt 누락·stale·non-zero exit, test file 0개, source/manifest hash 불일치 중 하나라도 있으면 release-manager를 실행하지 않는다. Markdown 표만 PASS로 바꿔서는 gate를 통과할 수 없다.

완료 후 `release-manager` 실행:
- FAIL 항목 있으면 해당 에이전트 재실행 (retry-policy.md 기준, 보고서별 최대 2회)
- 같은 QA 보고서가 3회 연속 FAIL이면 Hard Stop — 사용자에게 보고하고 자동 재시도를 중단한다
- 배포 CI, scheduled ingestion workflow 또는 provider config가 필요한데 Phase 4 전에 생성되지 않았다면 release를 중단하고 해당 owner agent 실행 후 quality runner부터 다시 시작
- release gate가 exit 0이고 모두 PASS(또는 정책상 WARN)일 때만 `_workspace/RELEASE/HANDOFF.md` 생성. 그 미만이면 `release-tier-contract.md`의 tier 판정에 따라 `release-manager`가 `release-readiness.md`로 tier 라벨과 승급 경로를 보고한다
