# web-harness 프로덕션 하드닝 방안

프로토타입급 → 프로덕션급 전환 방안. **기능 추가가 아니라 "검증된·재현 가능한 출력의 폐곡선 +
자가 CI + 정직한 tier"**가 목표다. 이 방안 자체가 현 하네스를 퇴보시키지 않도록 §1 가드레일을
모든 파일러에 우선 적용한다.

## 0. "프로덕션급"의 조작적 정의

레인 하나가 `certified`(프로덕션)이려면 **8개 전부**:

1. adapter + resolved profile
2. repo에 **골든 레퍼런스 프로젝트** 존재
3. 골든이 **격리 CI에서 full 릴리스 폐곡선**(`run-quality-gates --all` → attestation → `validate-release-gate`)을 서명 manifest까지 **그린으로 재현**
4. 적용 대상 read-only verifier 전부 통과
5. security/mock-boundary receipt 존재
6. **계약 위생**(bloat/중복/orphan/drift) 기계 검사 통과
7. (사내 서비스 레인) 인증/테넌시/임베드 baseline
8. quickstart 문서 + **정직한 supportLevel**

하네스 전체 프로덕션급 = 모든 `certified` 레인이 위 충족 + 매 변경마다 CI에서 validate+eval+골든-폐곡선 실행 + tier 정직.

## 1. 퇴보 방지 원칙 (모든 파일러에 우선)

이 방안을 실행할 때 아래를 어기면 그 변경은 **배제**한다.

- **G1 — 게이트를 약화시켜 폐곡선을 닫지 않는다.** hybrid/serverless 릴리스 실패는 감지/게이트
  *완화*가 아니라 **올바른 프로파일 모델링**(serverless `api/*` 인식 + §7 가드 강제)으로만 고친다.
  통과율을 위해 검증을 무르게 하는 변경은 금지.
- **G2 — 위생 validator는 현 baseline 기준 calibrate + warn-first.** always-read 예산·단일-소유
  규칙이 정당하게 밀도 높은 기존 스킬(예: web-orchestrator)을 오탐·강등하면 안 된다. 신규 회귀만
  block, 기존은 warn + allowlist.
- **G3 — 기존 capability는 grandfather.** "fixture+verifier 없으면 머지 불가"는 **신규에만** 하드게이트.
  기존은 백필 계획으로 추적하되 소급 하드게이트로 하네스를 얼리지 않는다.
- **G4 — 경량 fast-path도 비협상 하한은 유지.** ui-change/bug-fix 경로가 a11y 하한·security·test·
  receipt를 건너뛰지 않는다. 줄이는 것은 세리머니(문서·단계)뿐, 안전 게이트가 아니다.
- **G5 — 새 machinery는 가치가 명확할 때만.** validator/CI/golden 추가는 폐곡선·회귀탐지 가치가
  분명하고 `validate-harness` 런타임 예산을 지킬 때만. machinery 비대화도 퇴보다.
- **G6 — tier 강등은 라벨이지 기능 제거가 아니다.** 정직한 supportLevel 조정이 DAG 동작·생성 경로를
  바꾸지 않는다.
- **G7 — interactive ≠ optional.** CI/CD 구성은 org·플랫폼 결합(시크릿·러너·워크플로 승인·배포 신뢰
  identity)이라 하네스가 자율로 위조·우회하지 않고 **사용자와 상호작용으로** 설정한다. 그러나 이 대화형
  설정은 certified 도달의 **필수 게이트**이지 건너뛰기가 아니다 — acceptance("루프가 실제 CI에서 green으로
  증명")는 완화하지 않는다. (org별 특수는 config, 계약은 중립.)

## 2. 성숙도 루브릭 (레인 × 기준, 현 상태)

| 레인 | ①adapter | ②골든 | ③폐곡선 | ④verifier | ⑤security | ⑥위생 | ⑦엔터프라이즈 | ⑧문서/tier |
|---|---|---|---|---|---|---|---|---|
| react-vite-spa | ✅ | 부분(5/7 로컬) | ❌(CI 미증명) | 부분 | ✅ | 부분 | ❌ | 부분 |
| vite-serverless-hybrid | ✅ | ✅(fixture·10/10 T0 host cohort) | ✅ **T1**(격리 CI run 32614388125 `ISOLATED_VERIFIED`, 2026-08-23 — T2 attestation은 별도) | 부분 | ✅(가드·boundary·audit host) | ✅(golden/T1 validator) | ❌ | 부분 |
| next-app-fullstack | ✅ | ❌ | ❌ | 부분 | 부분 | 부분 | 부분 | 부분 |
| analytics-BI | ✅ | ❌ | ❌ | ❌ | — | 교정됨 | ❌ | 부분 |

현재 8/8 레인 없음 — "certified"는 주장이지 증명이 아니다. 이 표를 그린으로 채우는 것이 목표.

> **2026-08-18 갱신 (B트랙 M3)**: 위 문장을 기계로 강제했다. `validate-certified-evidence`가
> certified 라벨에 증거(골든 + locked certified profile + `t1-summary.json ISOLATED_VERIFIED` +
> QA 전부 PASS)를 요구하며, 이 기준으로 `react-vite-spa`를 **compatible로 강등**했다(라벨 역전
> 해소 — 증거가 더 강한 hybrid가 compatible인데 증거 없는 SPA가 certified였다. 강등은 라벨이지
> 기능 제거가 아니다, §D). 이제 certified는 0개다. **이 게이트는 §0 정의의 ③(격리 CI 폐곡선)
> 하한만 기계로 강제한다** — 8/8 production-grade 판정에는 ④verifier·⑤security·⑥위생·
> ⑦enterprise·⑧문서가 별도로 필요하며, 게이트 통과는 그 전체 정의를 좁히지 않는다(리뷰 지적
> 반영). T1 폐곡선을 그린으로 재현하는 레인이 기계 하한을 처음 통과하는 레인이 된다. CI 활성화
> 절차는 `docs/ci-activation-runbook.md`.
>
> **2026-08-23 갱신 (B트랙 단계 B·C)**: `vite-serverless-hybrid`가 그 첫 레인이 됐다 — self-hosted
> 격리 러너 + protected environment에서 `hybrid-t1`이 `ISOLATED_VERIFIED` receipt를 산출(run
> 32614388125; 1차 run 32613714281은 cohort 성공 후 v3 artifact API 퇴역으로 upload만 실패 →
> v4 전환 후 재실행)했고 `validate-certified-evidence`의 기계 하한을 통과해 certified 1개. 이
> 과정에서 게이트 자체의 결함 1건을 실측으로 잡았다(locked profile의 `supportLevel` 위치를 top-level로
> 읽던 필드 형상 오류 — seed도 가짜 형상이라 "armed"가 허위였음; 실형상으로 정정). 8/8
> production-grade 판정은 여전히 ④verifier·⑦enterprise·⑧문서가 별도다.

## 3. 파일러 (레버리지 순, 가드레일 연결)

### P0 · 신뢰 폐곡선

**A. 릴리스 폐곡선을 골든으로 닫기** 〔L·최우선, G1〕
- `react-vite-spa`에 골든 레퍼런스 프로젝트 체크인 → full 릴리스 폐곡선 그린. "certified"의 조작적
  정의이자 전 레인 템플릿.
- hybrid-serverless 실패는 **올바른 모델링으로만** 수정(G1) — ingestion 오탐 제거 + serverless 프로파일화.
- hybrid golden은 `golden/vite-serverless-hybrid/`와 전용 독립-root runner를 체크인하고, 승인된 registry audit을 포함한 단일 T0 host cohort 10/10을 통과했다. **2026-08-23 갱신**: 격리 CI(`hybrid-t1`, run 32614388125)가 `ISOLATED_VERIFIED` receipt를 산출해 **T1 충족** — T2(외부 서명 attestation)·provider 증거는 여전히 미충족이며 폐곡선 완료(T2)로 세지 않는다.
- T1 canonical 제안본(`.claude/ci/hybrid-t1.yml`)은 활성 미러(`.github/workflows/hybrid-t1.yml`)로 배치됐고 self-hosted 격리 runner + 보호 environment에서 실제 run artifact가 green이었다 — 그 전까지는 `ISOLATED_VERIFIED`로 승격하지 않는다는 원칙을 지켰다(1차 run은 upload 단계 실패로 불인정, 2차 run으로 충족).
- 스크립트 재사용: `run-quality-gates.mjs`·`prepare-quality-attestation.mjs`·`validate-release-gate.mjs`(이미 존재).

**B. 하네스 자체 CI (dogfooding) — 대화형 설정** 〔M·최우선, G5·G7〕
CI는 자율 생성이 아니라 **사용자와 상호작용하는 human-in-the-loop 단계**다(org·플랫폼 결합 — 실증: 일부 GHE는 `.github/workflows/*.yml` push를 플랫폼팀 승인으로 게이트한다. 성숙한 공급망 보안). 하네스 역할 3단계:
- **(a) 검증-준비 아티팩트 생성** — canonical 워크플로 제안본(`.claude/ci/harness-ci.yml`, 하네스 workflow 보안 정책 통과)·골든·게이트 스크립트. `package.json`의 `pnpm run ci`(mirror·toolchain·validate·ai)로 승인 전에도 로컬/PR dogfooding 확보. **[완료]**
- **(b) 대화형 설정 가이드** — 무엇을 플랫폼(워크플로 승인 주체)에 요청할지: 워크플로 활성화·러너·시크릿·승인 체크리스트를 사용자와 함께. **[협의 대상]**
- **(c) 활성화 후 검증** — 실제 CI 런이 green인지 확인. green 아니면 여전히 미완(문서만으론 통과 불가 — §0 acceptance 유지, G7). **[CI 활성화 후]**
현재 CI 전무 = 조용한 회귀 가능 = 프로덕션 불가의 근본 원인.

**C. 계약 위생 자동화 + 판단 계층** 〔M, G2·G5〕 — **[구현됨]**
- `validate-contract-hygiene`: 판단 계층 보호(CLAUDE.md 게이트·protected-core 실존) + 전 스킬
  always-read ratchet(실측 baseline, 성장만 fail) + 신규 계약 `## 일반화 근거` 강제(I3 기록).
  seed 회귀 3종 탐지·오탐 0 실증.
- **판단 계층**(`docs/protected-core.md` + 루트 `CLAUDE.md` 판단 게이트 + `harness-change-reviewer`
  에이전트): 불변식 서열 I1~I6, 변경 클래스별 질문, 알려진 프록시 등록부. 기계는 "판단이 일어났고
  기록됐는가"를 강제하고, 진실 검증은 리뷰어·fixture 몫(정직한 한계 명세).

### P1 · 커버리지 신뢰

**D. 증거 백필 + 정직한 tier** 〔L, G3·G6〕
- 모든 companion 모드에 골든 fixture + verifier + test-matrix. **신규만** "증거 없으면 머지 불가"(G3).
- 골든 없는 레인은 `compatible`/`experimental`로 정직 강등 — **라벨만**(G6). analytics-BI도 fixture 전까진 미검증 표기.

**E. 엔터프라이즈 baseline (SPA 레인)** 〔M〕
- 외부 게이트웨이 쿠키 SSO · SPA 테넌시 스코핑 + 크로스테넌트 음성 테스트 · 임베드/익명 토큰.
  각 fixture+verifier, 일반화(조건부 — always-read 비대화 금지).

### P2 · 범위·DX

**F. 브라운필드 채택 경로** 〔L〕 — 기존 대형 repo 인벤토리→감지→컨벤션 추출→기존 스택 존중 확장. 초기 `compatible`.
**G. DX 비례성** 〔M, G4〕 — ui-change/bug-fix 경량 fast-path(**안전 하한 유지**), 실패 진단, tier 노출, 레인별 quickstart.

## 4. 로드맵

| 단계 | 파일러 | 완료 시 |
|---|---|---|
| 1 신뢰 | A + B + C | 한 레인 폐곡선 그린 + 자가 CI + 위생 기계화 → "증명된 certified" 1개 |
| 2 커버리지 | D + E | 전 레인 정직 tier + 사내 서비스 실사용 |
| 3 범위 | F + G | 기존 repo 확장 + 무게 비례 |

## 5. 첫 수 (최고 레버리지)

**A + B를 한 레인에 묶는다** — `react-vite-spa`:
- **[완료]** 골든 체크인(`golden/react-vite-spa/`, 정적·유닛·빌드·boundary **5/7 로컬 검증**) + 로컬 dogfooding `pnpm run ci` + canonical 워크플로 제안본(`.claude/ci/harness-ci.yml`).
- **[대화형·협의]** CI 활성화를 플랫폼(워크플로 승인 주체)에 요청 → GitHub Actions가 골든을 full 릴리스 폐곡선 + `validate-harness`로 격리 실행. e2e·**서명 attestation**은 여기서만 증명(로컬 위조 불가 = 강점).

이 단일 산출물이 "certified(주장)"를 "certified(재현 증명)"로 바꾸고 나머지 전부의 템플릿이 된다.
(G1: 골든이 통과하도록 게이트를 무르게 하지 않는다 — 통과 못 하면 그것이 곧 고쳐야 할 결함이다. G7: 활성화는 대화형이지만 증명은 필수.)

## 6. 리스크·결정 필요

- **CI 활성화는 플랫폼 대화형 단계**(G7) — 일부 org는 워크플로 파일을 플랫폼 승인으로 게이트. 폐곡선의 마지막 증명(e2e·서명 attestation)은 그 활성화 후 CI에서만 가능. 하네스는 (a)까지 완료, (b)(c)는 사용자·플랫폼 협의.
- CI 격리 실행(`WEB_HARNESS_ISOLATED_EXECUTION`) 지원 러너 필요.
- 골든 유지보수 비용 = 회귀 탐지 가치(의도된 것).
- 정직한 tier는 일부 레인 강등을 요구(G6: 라벨만, 불편하나 프로덕션 정직성).
