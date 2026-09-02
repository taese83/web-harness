# Re-entry Map — 재진입 시 상황별 최소 계약 로드

> **목적**: 이미 진행 중인 프로젝트에 오케스트레이터가 다시 관여할 때(후속 턴·새 세션·
> context 압축 후), SKILL.md 전체와 references 연쇄를 재로드하지 않고 이번 작업에 필요한
> 계약만 **원문으로** 로드한다. 재진입 단가를 낮추는 것이 이 문서의 존재 이유다.
>
> **경계**: 이 맵은 안내 층이다. 소유권 훅·게이트·validator 같은 강제 층은 컨텍스트 로드와
> 무관하게 작동하며, 이 맵을 따랐다는 사실이 어떤 게이트도 완화하지 않는다 — 진입점이
> 강도를 바꾸지 않는다(`request-type-contract.md`).

## 사용 규칙

1. 아래 상황 중 이번 요청과 일치하는 행을 고르고, core 목록을 원문으로 Read한 뒤 시작한다.
2. 조건 열의 트리거가 성립하면 해당 계약을 추가 로드한다. **판단이 서지 않으면 로드한다** —
   과로드의 비용은 토큰이고 누락의 비용은 계약 위반이다.
3. 어떤 상황에도 맞지 않거나, 신규 서비스 생성이거나, Plan/Design 산출물이 아직 없으면
   이 맵을 쓰지 않는다 — `/web-orchestrator` 전체 진입이 정본이다.
4. 이 맵은 SKILL.md·`execution-contract.md`의 기존 로드 지시를 재서술한 **인덱스**이며 새
   규칙을 만들지 않는다. 두 문서가 어긋나면 SKILL.md가 이기고, 어긋남을 발견하면 그 자리에서
   이 맵을 고친다(발견자가 수리 책임).

재진입 판별 신호는 요청 문장이 아니라 프로젝트 상태다: 대상 프로젝트에 `_workspace/`
하네스 산출물이 있으면 관할이다. 플러그인 세션에서는 SessionStart 훅
(`detect-harness-project.mjs`)이 이 신호를 감지해 이 맵의 경로를 자동 주입한다 —
감지 실패 시에도 강제 층은 영향받지 않는다(훅은 안내 층, fail-safe는 침묵).

## 상황 A — Iterate 라운드: buildable 프로젝트의 범위 좁힌 변경

`bug-fix`·`ui-change`·`refactor`·`api-integration`·소형 `feature` 요청. 루프 정의는
`execution-contract.md` §Iterate mode가 정본이다.

**Core (항상 로드):**

| 계약 | 역할 |
|---|---|
| `execution-contract.md` | §Iterate mode 경량 루프 + §Runtime verifiability (LOCAL_VERIFIABLE/DEPLOY_ONLY) |
| `request-type-contract.md` | 요청 유형 고정 — 진입점이 게이트 강도를 바꾸지 않는다 |
| `minimal-change-contract.md` | change brief를 `_workspace/03_dev/change-scope.md`에 라운드별 append |
| `development-gates-contract.md` | typecheck·lint·test·build를 toolchain pin으로 실행 |
| `qa-evidence-contract.md` | §Iterate evidence — 라운드 종료 게이트 3종(승격 QA·evidence 재발급·문서 동기화) 정본 |
| `operational-gotchas.md` | 전 구간 금지·선행 조건 |

**Conditional (트리거 성립 시 로드):**

| 트리거 | 계약 |
|---|---|
| **요청에 새 문서·링크·시안 이미지·Figma가 붙어 있을 때** | `provenance-contract.md` §6 — **레인 판정 전** 공급 감지. 기존 산출물이 있으면 `00_source/` 기록까지만(record-only). 이 행이 없으면 재진입 경로에서 사용자가 준 문서가 조용히 읽히지 않는다 |
| 에이전트를 스폰하기 전(승격 QA 포함) | `execution-budget-contract.md` — telemetry 기록 의무 포함 |
| QA 재시도를 결정하기 전 | `retry-policy.md` |
| `DEPLOY_ONLY` criterion을 fixture 주입으로 검증할 때 | `auth-verification-contract.md` |
| 기존 source 변경 감지 시(SKILL.md 지시) | `change-journal-contract.md` + `integration-overlay.md` |
| 완료 보고 작성 전 | `completion-contract.md` — 표현 규칙이 tier 라벨을 따른다 |
| 외부 콘텐츠(수집·RAG·사용자 제공 외부 파일)가 이번 라운드에 유입될 때 | `untrusted-content-quarantine.md` — 수집 에이전트 prompt에 경로 전달 의무 |

## 상황 B — 승인 표면이 필요한 변경: 신규 기능·화면·데이터 계약

상황 A의 core 전체에 더해:

| 트리거 | 계약 |
|---|---|
| v1 구현 검증 **완료 후** (브라운필드) | **승인 표면 없음**(라이브 델타 제거, 2026-08-28) — 스냅샷 바탕 프리뷰가 들어오면 갱신한다 |
| v1 구현 검증 **전** | `design-approval-contract.md` — 프리뷰가 유일한 살아있는 승인 표면 |
| `02_design` 산출물을 갱신할 때 | `artifact-sharding-contract.md` + `validate-artifact-sharding.mjs` 실행 |
| 사용자 확인 체크포인트를 제시할 때 | `approval-checkpoints.md` |

어느 시대인지는 판정 기준(승인 TC 전부가 같은
ID의 구현 검증 기록으로 통과 확인된 시점)으로 가른다.

## 상황 C — 배포 후보 승격·릴리스 판정

iterate 라운드 산출물을 배포 후보로 낼 때(§Iterate mode: full attestation은 이때만 승격).

| 계약 | 역할 |
|---|---|
| `qa-evidence-contract.md` (전문) | evidence 승격 절차 |
| `release-tier-contract.md` | tier 판정 + 다음 tier 승급에 부족한 항목 목록 |
| `web-profile-contract.md` | locked profile 재확인 — stale이면 BLOCKED |
| `development-gates-contract.md` | 최종 게이트 재실행 |
| `completion-contract.md` | 완료 보고 표현 규칙 — T0/T1에서 "완성"·"검증 완료" 금지 |

## 폴백

신규 서비스 · 모드 미판별 · Phase 1~2 미완 · 위 상황 분류가 애매한 요청 → 이 맵을 버리고
`/web-orchestrator` 전체 진입. 축약 진입이 애매함을 이기지 않는다.

## 일반화 근거

이 맵이 인덱싱하는 로드 지시들은 기존 계약에서 검증됐지만, **맵을 경유한 재진입 경로
자체는 아직 실증 전이다** — 아래 두 형태에서 실제 재진입 라운드가 완주하면 실증으로
승격하고, 어긋나면 맵을 고쳐 write-back한다.

- 하네스 생성 greenfield 산출물의 후속 iterate (명명 수준 — 미검증. `react-vite-spa`
  형태의 기존 `_workspace/` 프로젝트에 상황 A 경로로 재진입할 때 실증)
- 기존 브라운필드 서비스의 승인 표면 재진입 (명명 수준 — 미검증. `vite-serverless-hybrid`
  형태에 상황 B 경로로 재진입하는 day-2 파일럿에서 실증 — 당시 표면은 라이브 델타였고 2026-08-28 제거됐다)

상황 분류는 요청 유형과 phase 상태만 참조하며 특정 서비스의 이름·백엔드·수치를
인코딩하지 않는다.
