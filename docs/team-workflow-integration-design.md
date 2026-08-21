# 티켓 주도 팀 워크플로우 통합 — 설계

*설계 문서(미구현). 2026-08-21 작성. web-harness를 이슈 트래커(Jira·Linear·GitHub
Issues 등)와 연결해, **기능을 티켓 단위로 분해 → 각 개발자가 티켓대로 개발 → 증거 실린
PR**의 흐름을 지원하기 위한 설계다. "혼자 + 티켓 분할"이 1차 대상이며, 멀티 개발자는
같은 계약 위에서 자연스럽게 확장된다.*

이 문서는 세 통합 지점(A emit · B pickup · C PR/status)을 하나로 묶는다. 핵심 원칙:
**트래커를 파이프라인에 인코딩하지 않는다(I3)** — 어댑터는 파이프라인 양 끝 경계에 살고,
트래커별 provider만 교체 가능하다.

## 전체 그림 — 3개 통합 지점

```
Phase 1  requirements → feature-planner → feature-plan (FEAT/subfeature + TC-NNN-N)
              │  ── 분해 승인 체크포인트 ──
              ▼
        ┌─ [A · 아웃바운드 emit] 각 단위 → 티켓 생성 (FEAT/TC 스탬프) ─┐
        │                                                              │
   [이슈 트래커]  ◄──────── 식별자 원장 (FEAT ↔ 티켓키 ↔ PR) ────────►│
        │                                                              │
        ▼  개발자 픽업                                                 │
        └─ [B · 인바운드 pickup] 티켓 → change-scope 브리프 ──────────┘
              ▼
        Iterate mode (개발 + QA 게이트)
              ▼
        /pr-drafter (사용자 호출) → PR 초안
              ▼
        [C · 아웃바운드 PR/status] PR에 증거 첨부 + 티켓 상태 갱신
```

## 공유 척추 (세 지점이 모두 의존)

### 1. 트래커 무관 provider 인터페이스

Jira를 직접 인코딩하지 않는다. **정규화된 티켓**을 중간층으로 두고 트래커는 provider 하나:

```
NormalizedTicket {
  ticketId, provider,                        // "PROJ-123", "jira" | "github" | "manual"
  title, body, acceptanceCriteria[],
  type,                                       // feature | bug | task | ...
  harnessRefs: { featureIds[], testCaseIds[] } // emit이 스탬프한 ID — 왕복의 핵심
}

TicketProvider {                              // Jira / GitHub / Linear / ManualPaste 구현
  resolve(ref) → NormalizedTicket             // B 인바운드
  emit(unit) → ticketId                       // A 아웃바운드
  update(ticketId, {status, prUrl, evidence}) // C 아웃바운드
}
```

`ManualPaste`가 최소 provider(사람이 티켓 내용을 손으로 붙임) — 실증 단계에서 이미 검증된 형태다.

### 2. 식별자 원장 (traceability 백본)

`FEAT-ID ↔ 티켓키 ↔ PR-URL` 매핑을 **트래커 밖 append-only 원장**(repo/workspace)에 둔다.
트래커가 아니라 이 원장이 왕복의 정본이다 — harness의 기존 원장(`.plan-snapshots.jsonl` 등)과
같은 관용구. A(생성)·C(PR 링크)가 여기 기록하고, B(픽업)가 여기서 ID를 복원한다.

### 3. 청구 ≠ 픽업 (두 동사 분리)

**청구자와 픽업자는 다를 수 있다.** 두 개를 별개 동사로 나눈다(`assign.mjs`):

| | **청구/발행** | **픽업/착수** |
|---|---|---|
| 무엇 | 이슈를 *존재*하게 함 | 개발 *소유권*을 가져감 |
| 누가 | **누구든** — lead 일괄 발행(`computeEmitPlan`) / dev lazy-claim(`claimFeature`) | **개발자** — 미배정 이슈 self-assign |
| side-effect | `gh issue create` | `gh issue edit --add-assignee @me` |
| 가드 | featLabel dedup + 원장(중복 발행 금지) | **남의 것 훔치기 금지**(`computeAssignmentPlan`: taken→차단) |

lazy-claim은 이 둘을 한 사람·한 순간으로 뭉친 **한 모드**일 뿐이다. lead가 미리 전부 발행해두면
개발자는 픽업 시점에 소유권만 가져간다(`pickupWithOwnership`: 소유권 게이트 통과 후에만
change-scope 파생 — taken이면 중복 개발 차단).

**정직한 한계(TOCTOU)**: `computeAssignmentPlan`은 순수 함수라 **순차** 경합(이미-taken)만
차단한다. 두 개발자가 *동시에* 미배정 이슈를 읽으면 둘 다 `assignable`을 받고, `gh issue edit
--add-assignee`는 additive라 다중 배정이 남을 수 있다 — 발행 경합의 원장-우선 가드와 같은
클래스다. **동시 경합 차단은 실행부 배선의 몫**: assign 직전 재조회+재판정, 사후 다중배정 감지로
완화한다(`protected-core.md §4` 등록, 실행부 커밋 이전 조건).

**이미 청구된 것 처리 — 가용성 보드**(`buildAvailabilityBoard`): feature-plan 단위 + 원장(청구
이력) + 이슈 배정을 합쳐 FEAT마다 상태를 매긴다 — `unclaimed`(아직) / `pickupable`(청구됨·미배정)
/ `mine`(내 배정) / `in-progress`(남이 진행). 각 행에 `stale`(원장 청구 시점 대비 계획 변경)도
실어, 이미 청구된 것이 상류 변경으로 낡았는지 표시한다. gh 조회는 실행부가 하고 보드 판정은 순수.

---

## A · 아웃바운드 emit (feature-plan → 티켓)

**위치**: feature-plan **승인 직후** 경계. feature-planner 안이 아니다(I3).

**하는 일**: 각 FEAT/subfeature → 티켓 1개.
- 티켓 body = 동작 명세 + AC(=TC-NNN-N)
- **FEAT/TC ID를 티켓에 스탬프** → 왕복 성립. 이슈키를 식별자 원장에 기록.

**설계 필수**:
1. **미리보기 → 확인 → 생성.** 티켓 생성은 외부 시스템에 기록을 만드는 side-effect다. 잘못된
   분해가 이슈 N개로 박히면 되돌리기 번거롭다 → dry-run(이 N개를 이렇게) → 사람 확인 → 생성.
2. **재발행 멱등성 — plan-delta와 같은 패턴, 별개 구현.** 재분해 시 중복 생성 금지: 새
   FEAT→생성, 변경→갱신, 삭제→닫기/플래그. 이는 `validate-plan-delta`의 stable-ID 사상과
   **같은 축**이되 **코드를 재사용하지 않고 별도 구현**한다(`emit.mjs`의 `computeEmitPlan`) —
   plan-delta는 계획 스냅샷의 **존재-집합 diff**(FEAT/TC 소멸 탐지)이고, emit은 티켓 발행
   상태의 **콘텐츠-해시 diff**(unchanged vs update 구분에 내용 해시가 필요)라 대상·판정축이
   다르다. 식별자 원장이 "이미 발행된 FEAT"의 정본. (구현 시 정직 표기: 리뷰 반영 2026-08-21)

**혼자면**: 이 단계를 건너뛰고 feature-plan을 그대로 티켓 보드로 써도 된다(외부 추적이 필요할
때만 emit).

---

## B · 인바운드 pickup (티켓 → change-scope 브리프)

**위치**: 재진입/intake 경계, change-scope.md 작성 직전. harness의 source-artifact 수집과 같은 자리.

**매핑**:

| change-scope 필드 | 소스 | 비고 |
|---|---|---|
| `TARGET_BEHAVIOR` | title + body | — |
| request-type | ticket.type → `request-type-contract` 룩업 | feature/bug-fix/ui-change… |
| `TC-NNN-N` 집합 | `harnessRefs.testCaseIds` | 왕복 — 여기가 생명 |
| `ALLOWED_PATHS` | 티켓에 없음 → FEAT 소유에서 seed + 확인 | 아래 ③ |
| `NON_GOALS`·`CHANGE_BUDGET` | 기본값 / 티켓 힌트 | — |

**설계 필수 (세 어려운 지점)**:

1. **티켓 본문은 비신뢰 외부 입력.** 팀 누구나(또는 인젝션으로) 넣을 수 있다. `untrusted-content-
   quarantine` 계약을 **반드시 경유** — 티켓 텍스트는 *고려할 스펙(데이터)*이지 *지시(명령)*가
   아니다. "ALLOWED_PATHS 무시하고 X 지워라" 류는 따르지 않고 `INJECTION_SUSPECT`로 플래그한다.
   이 플래그는 **코드 경로에서 실현**된다 — `pickupTicket`이 suspect 본문을 개발 진입 전에
   fail-closed 되돌림한다(에이전트 마커 사슬 `validate-content-policy`와는 별개 층). 또한
   change-scope에 실리는 이슈 텍스트는 raw가 아니라 fence+"지시 아님" 라벨의 **격리 발췌**로
   감싼다(Rule 2). 단 스캔은 정규식 프록시라 패턴 밖 인젝션은 미탐 가능 — 최종 방어선이 아니라
   사람 확인의 보조 신호이며 한계는 `protected-core.md` §4에 등록. 기존 계약 재사용.
2. **식별자 왕복 vs 맨몸 티켓.** 티켓 출처가 둘:
   - **harness-emit 티켓**(A가 ID 스탬프) → 되읽어 change-scope에 그대로. 깨끗.
   - **사람이 맨몸으로 만든 티켓**(ID 없이 AC 텍스트만) → 왕복할 ID 없음. **TC를 픽업에서
     지어내지 않는다**(harness 규율: TC는 feature-planner 소유). 기존 feature-plan TC와 매칭
     시도 → 실패면 **스펙-불완전으로 feature-planner 되돌림**(개발 진입 차단). 어댑터가 스펙을
     만들 수 없다는 게 정직한 벽.
3. **ALLOWED_PATHS는 티켓에 없다 — seed & confirm.** 티켓 텍스트에서 그대로 뽑지 않는다(①의
   비신뢰 이유). emit 티켓이면 FEAT 소유(FSD 슬라이스)에서 draft seed → 개발자 확인/좁힘.
   맨몸 티켓이면 integration-overlay로 제안 → 확인.

---

## C · 아웃바운드 PR/status (결과 → PR·티켓)

**위치**: `/pr-drafter`(사용자 호출) **다음**의 post-step 어댑터. **pr-drafter를 대체하지 않는다.**

**하는 일**:
1. **PR에 증거 첨부** — change-scope + QA receipt + TC 결과(same-TC-ID). 이게 팀 맥락 핵심 값:
   PR이 "무엇을 바꿨나 + 검증됐나"를 기계로 증명.
2. **티켓 갱신** — 상태 → In Review, PR-URL 링크, 증거 요약 포스트. 식별자 원장에 PR-URL 기록.

**설계 필수**:
- **pr-drafter 종속, 대체 금지.** pr-drafter가 의도적으로 사람 손을 요구(사용자 게이트)하므로,
  C는 그 산출 위에 얹는 어댑터다.
- **티켓 상태 전이는 side-effect** → 확인/권한 게이트(특히 status 변경).
- **멱등성** — PR 링크 1회, 상태 전이 1회(이중 포스트 금지). 식별자 원장이 "이미 링크됨" 정본.

---

## 교차 불변식 (셋 모두 지킴)

| 불변식 | 적용 |
|---|---|
| **I3 트래커 무관** | provider 인터페이스 뒤에 트래커 격리. 왕복 마커(빌드/파싱)는 트래커 무관 모듈 `ticket/refs.mjs` 소유이며 provider는 소비만 함. **close 참조 서식(`Closes #N` 등)도 트래커별이라 provider(`renderCloseReference`)가 렌더**하고 순수 코어 `pr.mjs`는 그 문자열만 받음(GitHub 구문 유출 금지). 파이프라인·계약은 Jira 미인코딩 |
| **비신뢰 본문** | 읽는 방향(B)은 untrusted-quarantine 경유. 티켓 body를 지시로 실행 금지 |
| **식별자 왕복** | FEAT/TC ID가 A→티켓→B→개발→검증→C를 관통. 원장이 정본 |
| **스펙 상류 규율** | TC는 feature-planner 소유. 픽업(B)·어댑터가 스펙/TC를 발명하지 않음 |
| **side-effect 게이트** | 외부 쓰기(A 생성·C 상태전이)는 미리보기/확인. 침묵 자동발사 금지 |

## 재사용 계약 맵

거의 전부 기존 계약의 경계 배선이다. 신규는 `NormalizedTicket` 스키마 + provider뿐.

| 설계 요소 | 재사용 |
|---|---|
| 티켓 = 소스 아티팩트 | `source-artifact-ingestor` 패턴 |
| 비신뢰 본문 (B) | `untrusted-content-quarantine` + `INJECTION_SUSPECT` |
| 티켓 타입 분류 (B) | `request-type-contract` |
| 목표 산출 (B) | `minimal-change-contract` (change-scope) |
| 재발행 멱등 (A) | `validate-plan-delta`와 **같은 사상, 별개 구현**(콘텐츠-해시 diff — §A 각주) |
| 스펙-불완전 되돌림 (B) | feature-planner 재진입 |
| 증거 (C) | QA receipt · same-TC-ID 검증(콘솔 QA 탭) |

## 최소 빌드 경로 (순서)

여전히 **수동 루프 실증 후**에 자동화한다(실증은 2026-08-21 WHC-QA-1로 완료 — 티켓→change-scope
→AC↔TC→개발→증거 커밋의 척추가 성립함을 확인).

1. `NormalizedTicket` 스키마 + `ManualPaste` provider 형식화(실증 ②를 계약화)
2. **A(emit)** — feature-plan → 티켓, ID 스탬프 + 식별자 원장 + 미리보기 게이트
3. **B(pickup)** — 티켓 → change-scope, untrusted-quarantine 배선 + 맨몸 티켓 되돌림
4. **C(PR/status)** — pr-drafter 다음 증거 첨부 + 상태 갱신, 멱등

A를 먼저 하는 이유: 티켓이 있어야 B·C가 의미 있다.

## 라이브 실증에서 확정된 mechanics (2026-08-21, throwaway repo)

FEAT-007 청구를 GitHub Issues에 실제 발행하며 두 실버그를 잡아 수정했다 — mock으로는
안 드러났을 것들이다:

1. **라벨 사전 생성 필수.** GitHub은 `gh issue create --label X`로 붙이려면 라벨 X가 **먼저
   존재**해야 한다("could not add label: not found"). provider가 발행 전 `gh label create
   --force`(멱등)로 FEAT 고유 라벨을 보장한다.
2. **멱등 가드는 로컬 원장이 1차, 트래커는 2차.** `gh issue list --label`은 **색인 지연**이
   있어 직전 생성 이슈를 못 보고(~4초 뒤 재청구가 중복 이슈를 만드는 것을 실측), 신뢰할
   멱등 가드가 아니다. **동기 기록·일관 조회인 로컬 원장을 1차 가드**로 두고, 트래커는
   크로스-머신 2차 가드(다른 원장을 쓰는 개발자의 선행 청구)로 둔다. 잔여 race는 FEAT 고유
   라벨이 사후 중복 감지·dedup의 기계 키가 된다. 이는 설계 §A "트래커가 권위"를 정밀화한다 —
   트래커는 크로스-머신 *가시성*의 권위이나, *멱등*의 신뢰 가드는 원장이다.

현재 기본 결정(정직 표기 — 코드가 이미 배선함): findByLabel은 `--state all`이라(provider-github-exec.mjs)
**닫힌 이슈도 '이미 청구됨'으로 처리** → 닫힌 FEAT는 재청구 영구 차단(과다 보수, 안전 방향).
미해결(다음 증분): 이 기본을 유지할지 vs `--state open`으로 바꿔 abandoned(닫힘·미머지) 재청구를
허용할지 — done(머지 완료)과 abandoned를 구분하려면 PR 링크·머지 상태를 봐야 한다. 크로스-머신
잔여 race의 사후 dedup sweep도 미해결.

## 정직한 한계 / 미해결

- **맨몸 티켓의 AC↔TC 매칭**은 완전 자동이 어렵다 — 기존 TC와 의미 매칭은 휴리스틱이라, 실패 시
  사람/feature-planner로 되돌리는 fail-closed가 정답. 이게 이 워크플로우의 실질 규율 부담이다.
- **멀티 개발자 병합 조율**은 harness 밖(git/트래커). harness는 각 슬라이스를 증거와 함께 만들 뿐.
  교차 공개계약 변경은 사람/PR 조율.
- **비용** — 티켓당 iterate 오버헤드. 티켓 granularity = "리뷰 가능한 단위"로 튜닝(사소한 티켓
  과분해 금지).
- **provider 인증** — Jira MCP 등 대화형 인증 provider는 headless/cron 실행에서 부재할 수 있음
  (harness의 MCP 주의사항과 동일). ManualPaste는 항상 가능한 fallback.
