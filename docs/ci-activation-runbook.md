# CI 활성화 Runbook — 첫 "증명된 certified"로 가는 길

> B트랙 M3. `validate-certified-evidence`(2026-08-18)가 certified 라벨에 T1 격리 CI 폐곡선
> receipt를 요구한다. 이 runbook은 그 receipt를 실제로 만들 수 있게 CI를 활성화하는 절차다.
> **토큰 비용 0 — 전부 플랫폼(GitHub) 작업이며, 핵심 단계는 저장소 관리자만 수행할 수 있다.**

## 현재 상태 (실측)

- **단계 A 완료(2026-08-18)**: `harness-ci.yml`이 `.github/workflows/`에 배치·활성화됐고
  첫 유효 실행(run #2)이 **success** — 저장소 최초의 독립 CI green 실증. 이제 모든 main
  push·PR이 자동 회귀를 받는다.
- **단계 B 완료(2026-08-23)**: WSL2 Ubuntu self-hosted 러너(`web-harness-isolated`, ephemeral) +
  protected environment `hybrid-t1-audit`(필수 reviewer) 위에서 `hybrid-t1`이 실행됐다. 1차 run
  32613714281은 cohort 검증까지 성공한 뒤 upload 단계에서 실패(GitHub.com v3 artifact API 퇴역 —
  v4.6.2 pin으로 전환), 2차 run 32614388125가 **success** + artifact 업로드 — `t1-summary.json` =
  `ISOLATED_VERIFIED`(revision 48b96b3). receipt를 `golden/vite-serverless-hybrid/_workspace/04_qa/`에
  커밋했다. **provenance 대조 완료**: 사용자가 내려받은 artifact zip(`hybrid-t1-32614388125.zip`, 53,736B)
  내 `evidence/t1-summary.json`의 sha256 `b3c24f7209e013bc…`가 커밋본과 바이트 일치(2026-08-23).
- **단계 C(승격) 진행**: adapter `certified` + locked profile 재잠금 + SKILL `SUPPORT_STATUS` 동기화 →
  `validate-certified-evidence` green이 곧 증명. 이 과정에서 게이트의 locked profile `supportLevel`
  필드 형상 오류(top-level 읽기 → 실제는 `adapter.supportLevel`)를 실측으로 잡아 정정했다.
- hybrid 골든은 T1 실행 준비 완료: 골든 fixture 완비, `run-golden-profile.mjs --verify-t1`,
  `validate-isolated-cohort.mjs`(격리 컨텍스트·24h freshness 검증) 구현됨.

## 단계 A — harness-ci 활성화 (쉬움 · self-hosted 불필요 · 즉시 가능)

1. `.claude/ci/harness-ci.yml` → `.github/workflows/harness-ci.yml` 복사 커밋.
   *(이 배치는 저장소 커밋으로 가능 — 요청 시 하네스 세션이 준비해 커밋 승인을 받는다.)*
2. push 후 Actions 탭에서 첫 실행 green 확인.
3. 효과: 모든 push/PR에서 `pnpm run ci`(mirror·toolchain·validator·AI 하네스) 자동 회귀 —
   저장소가 처음으로 자기 게이트를 CI에서 실행하게 된다.

## 단계 B — hybrid T1 활성화 (관리자 작업 · 첫 certified의 실제 게이트)

`hybrid-t1.yml` 머리말: *"Platform approval must place this file at
.github/workflows/hybrid-t1.yml and provision the protected environment and runner labels."*

관리자 체크리스트(순서대로):

1. **Self-hosted runner 프로비저닝** — 라벨 `[self-hosted, linux, x64, web-harness-isolated]`.
   - 요구사항: Node 22.22.x + pnpm 11.18.0 경로, `google-chrome`(e2e), 네트워크 격리 원칙
     (워크플로 외 자격증명 없음).
   - GitHub → Settings → Actions → Runners → New self-hosted runner.
2. **Protected environment 생성** — 이름 `hybrid-t1-audit`.
   - Settings → Environments → New. 필수 reviewer 지정(수동 승인 게이트).
3. **워크플로 배치** — `.claude/ci/hybrid-t1.yml` → `.github/workflows/hybrid-t1.yml` 커밋.
   *(요청 시 하네스 세션이 준비해 커밋 승인을 받는다 — 1·2 없이 배치만 하면 실행이 큐에서
   실패하므로 순서를 지킨다.)*
4. **첫 실행** — Actions → hybrid-t1 → `workflow_dispatch`.
5. **성공 판정** — 산출물 `t1-summary.json`의 `status === 'ISOLATED_VERIFIED'`
   (`WEB_HARNESS_ISOLATED_EXECUTION=1` 컨텍스트 + 24h freshness + 전체 receipt cohort).
6. **receipt 커밋** — artifact의 `evidence/t1-summary.json`을 `golden/vite-serverless-hybrid/_workspace/04_qa/t1-summary.json`
   으로 커밋하면 `validate-certified-evidence`의 요구 3번이 충족된다. (`evidence/`는 24h receipt cohort라
   gitignore 대상이고, summary만 영구 receipt로 04_qa 루트에 둔다.) 커밋 바이트는 **GitHub artifact에서
   채취**하고 sha256을 JUDGMENT에 기록한다 — 러너 디스크 사본은 self-report다(§4).
7. **승격 후 재실행** — 단계 C의 승격 커밋이 locked profile을 재잠금하므로 6의 receipt는 승격 *전*
   트리의 증거다(fingerprint stale, §4 "T1 receipt의 트리 결속"). 승격 커밋 push 후 그 SHA로 `hybrid-t1`을
   재dispatch해 receipt를 교체한다 — 이때 declaredRevision이 certified 잠금 트리를 가리킨다.

## 단계 C — 승격 (기계 게이트 통과가 곧 증명)

B-6까지 완료된 뒤에야:

1. `adapter.json` `supportLevel: certified` + locked profile 재해석(digest 갱신) + SKILL
   `SUPPORT_STATUS` 동기화.
2. `pnpm run ci` — `validate-certified-evidence`가 골든·locked·T1·QA를 검사해 green이면
   그것이 곧 "증명된 certified"다. **T1 receipt 없이 1번을 먼저 하면 ci가 빨간불이다 — 그게
   이 게이트의 목적이다.**
3. harness-change-reviewer + JUDGMENT(tier 변경 클래스: "라벨이 증거와 일치하는가") 후 커밋.

## 그 너머 — T2 (별도 추적)

T1은 certified의 기계 하한이다. 완전한 릴리스 서명(T2 `RELEASED`)은 추가로:
- `.claude` 루트에 `quality-attesters.json` 신뢰 키 프로비저닝(저장소에 의도적으로 없음 — fail-closed)
- checkout 밖 protected env 6종 + 외부 Ed25519 서명자
- `prepare-quality-attestation` → `validate-release-gate` exit 0 → manifest v3

## 한계 고지

- 이 runbook 자체는 절차 문서이지 증거가 아니다. 증거는 CI가 산출한 `t1-summary.json`뿐이다.
- **신뢰 모델 고지(2026-08-23 실측)**: 첫 T1의 격리 러너는 저자 본인 PC의 WSL2 ephemeral 러너이고
  protected environment 승인자도 동일인이다. `isolated-ci-declared`는 "워크플로가 선언한 격리 컨텍스트에서
  실행됐다"는 뜻이지 제3자 인프라의 독립 검증이 아니다 — 외부 신뢰 결속은 T2 attestation(외부 서명자)이
  담당한다.
- hybrid 어댑터의 감지 범위는 앱 루트 `api/` — workspace/monorepo 레이아웃(`client/api/`,
  `apps/*/api/`)은 감지 밖(G-7). 감지 확장은 I3 증거(2형태+)가 필요한 별도 계약 변경이다.
