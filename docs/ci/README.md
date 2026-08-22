# CI 활성화 가이드 (대화형 — G7)

CI/CD 구성은 org·플랫폼 결합(워크플로 승인·러너·시크릿·배포 신뢰 identity)이라 **하네스가 자율로 닫지
않는다**. 하네스는 **검증-준비 아티팩트 생성(a) + 대화형 설정 가이드(b) + 활성화 후 검증(c)**만 소유한다
(`docs/production-hardening-plan.md` G7·Pillar B). 이 문서가 (b)다.

> **acceptance 불변(G7)**: 아래 활성화는 certified 도달의 **필수 게이트**다. "가이드를 넘겼다"로 완료가
> 아니라, (c)에서 **실제 CI 런이 green**이어야 완료다. 문서만으론 통과 불가.

## (a) 이미 준비된 아티팩트 [완료]

| 아티팩트 | 위치 | 상태 |
|---|---|---|
| 하네스 자가 CI 워크플로 | `.claude/ci/harness-ci.yml` | canonical 정본 — **활성 미러** `.github/workflows/harness-ci.yml`와 바이트 동일해야 한다(`validate-harness`가 드리프트를 `CI_MIRROR_DRIFT`로 fail). Node 22.22.3·pnpm 11.18.0 직접 설치, block-style·persist-credentials:false·timeout·SHA-pin |
| Hybrid T1 워크플로 제안본 | `.claude/ci/hybrid-t1.yml` | 비활성 canonical 제안본. 수동 trigger·보호 environment·격리 runner·frozen install·단일 cohort·bounded artifact upload |
| 로컬 dogfooding 게이트 | `package.json` → `pnpm run ci` | mirror·toolchain·validate·ai — 승인 전에도 로컬/PR 실행 |
| SPA 골든 레퍼런스 | `golden/react-vite-spa/` | 정적·유닛·빌드·boundary **5/7 로컬 green** |
| Hybrid 골든 레퍼런스 | `golden/vite-serverless-hybrid/` | 가드·API loopback·build·browser·boundary·audit 포함 **10/10 단일 T0 host cohort green** |
| 골든 독립-root runner | `.claude/scripts/run-golden-profile.mjs` | 상위 repo ingestion marker와 fixture를 분리하고 receipt를 현재 fingerprint에 결속 |
| 릴리스-루프 스크립트 | `.claude/scripts/` | `run-quality-gates.mjs`·`prepare-quality-attestation.mjs`·`validate-release-gate.mjs` (이미 존재) |

Hybrid 제안본의 artifact upload는 GHES 지원용 `actions/upload-artifact@v3.2.2-node20` 커밋 SHA에
고정했다. 플랫폼이 GitHub.com/GHEC이면 v4+ 전환을 별도 검토하되 mutable tag로 바꾸지 않는다.

## (b) 플랫폼 요청 체크리스트

> org-specific 값(호스트 도메인·워크플로 승인 주체 등)은 조직마다 다르다 — 아래는 형식 예시다.
> 다른 org는 자기 플랫폼 승인 경로·러너·시크릿 이름으로 치환한다. 계약은 중립.

- [x] **1. 자가 CI 워크플로 활성화** — 완료(2026-08-18): `.claude/ci/harness-ci.yml`가
      `.github/workflows/harness-ci.yml`로 배치·활성화됐고 첫 유효 실행이 green
      (`docs/ci-activation-runbook.md` 단계 A). 두 사본의 동기화는 기계 검사가 지킨다.
- [ ] **2. 골든 T1 job 활성화** — `.claude/ci/hybrid-t1.yml`을 플랫폼 검토 후
      `.github/workflows/hybrid-t1.yml`로 배치한다. 워크플로가 골든을 격리 실행하며, 먼저 frozen install 후:
      `WEB_HARNESS_ISOLATED_EXECUTION=1 node .claude/scripts/run-golden-profile.mjs --profile vite-serverless-hybrid --write-evidence --verify-t1 --expected-revision <full-sha>`.
      runner는 같은 임시 실행 경계에서 isolated cohort를 판정한다. 실제 artifact의 `t1-summary.json`이
      `ISOLATED_VERIFIED`여야 T1이다.
- [x] **2-a. Registry audit 데이터 승인(T0 host)** — full `--all`의 `pnpm audit --prod --registry=https://registry.npmjs.org`가 사용자 승인 아래 실행됐고 단일 host cohort 10/10이 통과했다. 다른 CI나 조직 환경에서는 destination/payload 승인을 새로 확인하며, 이 host 승인을 T1 격리 CI 승인으로 재사용하지 않는다.
- [ ] **2-b. 활성 workflow 등록 확인** — 활성화 후 GitHub Actions UI에서 `hybrid-t1`이 수동 실행 항목으로
      노출되는지 확인한다. 등록만으로 T1은 아니며, 아래 러너·보호 environment 준비와 실제 green run이 필요하다.
- [ ] **3. attestation 신뢰 identity** — `prepare-quality-attestation --issuer-run-id <trusted-ci-run-id>`는
      **checkout 밖의 신뢰 CI identity**(OIDC/CI run id)를 요구한다(로컬 위조 차단 설계). 플랫폼이 이 identity를 제공.
- [ ] **4. 러너·시크릿** — 필요한 러너 라벨과 (해당 시) 시크릿을 최소 권한으로 등록. 워크플로는 `permissions: contents: read` 기본.
- [ ] **4-a. Hybrid T1 러너 계약** — `web-harness-isolated` label은 ephemeral filesystem, process-group teardown,
      deny-by-default outbound와 npm registry allowlist, Node 22.22.3·pnpm 11.18.0·stable Chrome을 제공한다.
      `hybrid-t1-audit` protected environment는 수동 승인자를 설정한다.

## (c) 활성화 후 검증

- [ ] `harness-ci`가 push/PR에서 **green**(mirror·toolchain·validate·ai).
- [ ] `hybrid-t1` 수동 run이 **green**이고 업로드된 10개 receipt가 같은 cohort·source fingerprint·24h
      freshness에 결속되며 7개 필수 QA report가 전부 PASS다. summary의 revision은 workflow 선언값이며,
      commit과 증거의 외부 신뢰 결속은 T2 attestation에서 완성한다. 이때만 `ISOLATED_VERIFIED`로 기록한다.
- [ ] 골든 릴리스-루프가 **서명 manifest까지 green** → 루브릭 기준 ③(폐곡선) 충족 → `react-vite-spa`가
      **"certified(재현 증명)"**. (e2e·서명 attestation은 여기서만 증명된다.)
- [ ] green이 아니면 **미완** — 게이트를 무르게 해 통과시키지 않는다(G1). 실패 지점이 곧 고칠 결함이다.

## 복붙용 — 플랫폼 요청 문구(예시)

> 안녕하세요. `<org>/<repo>`에 자가 CI 워크플로 활성화를 요청드립니다.
> - 파일: `.claude/ci/harness-ci.yml` → `.github/workflows/harness-ci.yml` 배치
> - 내용: 외부 의존성 없는 순수 node 검증(validate/mirror/toolchain/ai). `permissions: contents: read`(최소 권한),
>   `persist-credentials: false`, action은 커밋 SHA-pin, job `timeout-minutes` 지정 — 하네스 workflow 보안 정책 통과.
> - 추가로 골든 릴리스-루프(격리 실행 + attestation) job의 러너/신뢰 identity도 협의 부탁드립니다.

## 일반화

이 (a)(b)(c) 흐름은 이 org 전용이 아니다. 향후 `deploy-ci-writer`가 프로젝트별로 이 가이드(요청 체크리스트 +
검증 기준)를 **산출물로** 생성하도록 승격할 수 있다 — org 특수는 config, 계약은 중립.
