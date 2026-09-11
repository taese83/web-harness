# 감사 독립 재검증 및 정정 — 2026-09-10

- 대상: `docs/audits/web-harness-workflow-audit-2026-09-10.md`
  — **이 저장소에 커밋되지 않은 로컬 문서다.** 사용자 소유이므로 수정하지도, 커밋에 넣지도
  않았다. 링크 대신 경로만 적는다(커밋만 받은 사람에게 깨진 링크를 주지 않기 위해서다).
  아래 인용은 그 문서를 재검증한 결과이며, 원문 없이도 읽히도록 필요한 부분을 옮겨 적었다.
- 수행: Claude Code, 해당 문서 §8 「프롬프트 A」 지시
- 성격: **원본을 수정하지 않는 별도 정정 문서.** 원본은 사용자의 로컬 1차 감사로 그대로 둔다.
- 실행 환경: 고정 toolchain(Node 22.22.3 · pnpm 11.18.0)

## 0. 선행 — toolchain

셸 기본은 고정본이 **아니다**. 실측:

| Node | `validate-toolchain.mjs` |
|---|---|
| v24.18.1 (셸 기본) | exit 1 — `pnpm version could not be verified read-only` |
| 22.22.3 (고정) | exit 0 — `PASS (Node 22.22.3, pnpm 11.18.0)` |

원본 §6이 고정 toolchain을 쓴 것은 옳다. 이 문서의 모든 판정도 고정본이다.

## 1. 판정 요약

| FINDING | 원본 초기 판정 | 독립 재판정 |
|---|---|---|
| 001 진입점 마이그레이션 불완전 | CONFIRMED 후보 | **CONFIRMED (원본보다 강함)** |
| 002 verify 불변성 충돌 | CONFIRMED 후보 | **CONFIRMED** |
| 003 병렬 developer 경쟁 조건 | PARTIAL 후보 | **CONFIRMED(기제) / NOT_MEASURED(발현)** |
| 004 eval assertion 유령 agent | CONFIRMED 후보 | **CONFIRMED (수량 정정)** |
| 005 `eval-covered` 미결속 | CONFIRMED 후보 | **CONFIRMED (부분 결속 존재)** |
| 006 ownership coverage 미실측 | CONFIRMED 후보 | **CONFIRMED** |
| 007 팀 협업 GitHub 편중 | CONFIRMED 후보 | **PARTIAL — 특징 서술 부정확** |
| 008 process-test 커버리지 | CONFIRMED 후보 | **CONFIRMED** |
| §6.2 전체 CI not green | 관측 | **REJECTED — 일시적 트리 오염** |

## 2. 정정 항목

### 2.1 §6.2 「전체 CI를 green으로 볼 수 없다」 — REJECTED

원본이 관측한 실패:

```
falsification [normalize-refuses-intaken-source]:
변형 지점을 찾지 못했다: if (String(issue.body ?? '').includes('web-harness:source'))
```

**원인은 registry ↔ 구현 불일치가 아니라 작업 트리 오염이다.** `ticket/cli.mjs:897`에
`if (false && String(issue.body ?? '')…)` 가 남아 있었고, 그것은 반증 seed의 변형이 복원되지
않은 잔재였다.

**근본 원인(신규 발견)**: `validate-falsification.mjs`를 **두 개 겹쳐 돌렸다.** `falsifyOne`은
진입 시 원본을 읽고 `finally`에 되쓴다 —

```
러너 A: original 읽기 → 변이 쓰기 ───────────── 복원
러너 B:          original 읽기(= A의 변이본) ────────── 복원(= 변이본 영구화)
```

`finally`는 예외를 덮지만 **다른 프로세스는 덮지 못한다.** 원본이 "일시적 불일치인지 seed가
구현을 못 따라간 것인지"를 물었고, 답은 **전자**이며 그 과정에서 러너 자체의 결함이 드러났다.

복원 후 실측: `pnpm run ci` **exit 0 · 1021 pass · 반증 104/104**.

### 2.2 FINDING-007 — PARTIAL

원본은 "board·자동 close·일부 완료 전이는 불완전"이라 했다. provider 표면 실측:

```
github            : assign buildFields classifyError closeReference comment createIssue
                    findByFeature findByLabel reopenIssue resolveIssue updateBody
jira(전이 선언 시) : + availableTransitions  isClosed  transition      − findByLabel
```

- **전이는 Jira가 더 넓다** — `transition`·`isClosed`·`availableTransitions`를 GitHub은 갖지 않는다
- `findByLabel`은 GitHub `findByFeature`의 내부 구현이며 board의 요구가 아니다
- 실제 격차는 하나: Jira의 `closeReference`가 `verified: true`에도 `null`을 반환한다.
  PR 본문 자동 close는 GitHub 플랫폼 기능이므로 **하네스 결함이 아니다**

capability를 표기할 필요는 있으나 "Jira가 뒤처진다"는 서술은 과장이다.

### 2.3 FINDING-004 — 수량 정정

원본 "총 14회" → 실측 **14종 · 17회**. 원본 목록에 없던 것: `ingestion-ci-writer`,
`vercel-config-writer`, `deploy-ci-writer`. 최다는 `seo-meta-builder`(3회).

### 2.4 FINDING-005 — "무결속"이 아니라 "receipt 미결속"

`validate-contract-hygiene.mjs:245`가 `eval-covered` 선언 시 **해당 스킬이 `scenarios.json`에
언급되는지**는 검사한다. 없는 것은 **receipt 결속**이다. 실측: `eval-covered` 13개 vs receipt 1개.

부수 확인 — `.claude/evals/README.md:35`의 "나머지 45 시나리오"는 stale이다(실제 48개, 미실행 47).

### 2.5 FINDING-001 — 원본보다 강한 판정

원본은 "기획 전용 흐름이 단일 진입점에서 도달 **불가능할 수 있다**"고 썼다. 실측 결과
**도달 불가가 확정**이다:

- `/wh` SKILL.md 전문에 `plan` 문자열 0건
- `web-orchestrator/` 전체에서 `web-plan` 검색 → `references/*.md` 5건, **스킬 호출 0건**
- 즉 `web-plan`의 description "`/wh`가 호출한다"는 **거짓이었다**

eval `entrySkill` 분포도 기록해 둔다 — 48개 중 `/wh`는 **2개**:

```
17 /web-orchestrator · 9 /web-verify · 5 /web-plan · 3 /visual-design-verify
 2 /dev-orchestrator · 2 /timeseries-dashboard · 2 /feature-add
 2 /vite-serverless-hybrid · 2 /wh · 1씩 /auth-setup /project-init /api-connect /analytics-chart-builder
```

## 3. 인수 기준 대비 현황

| 기준 | 상태 |
|---|---|
| 모든 FINDING 독립 재판정 | ✅ |
| REJECTED 항목 근거와 함께 정정 | ✅ (이 문서) |
| P0 수정 계획 승인 | ✅ |
| 수정된 계약마다 소비 지점·process 회귀 | ✅ P0 범위 |
| falsification registry가 현재 코드와 맞고 전량 실행 | ✅ 104/104 |
| 고정 toolchain `pnpm run ci` exit 0 | ✅ 1021 pass |
| 작업 전 사용자 변경 보존 | ✅ `docs/audits/` 원본 무수정 |
| `harness-change-reviewer` 결과와 I1~I6 기록 | ✅ 2회 실행, 커밋 JUDGMENT |

## 4. 남은 항목

**P1** — FINDING-004(eval assertion reachability) · 005(receipt 결속, 중간 maturity 필요) ·
006(프로필 확장, 골든 재-잠금 동반) · 007(capability matrix)

**P2** — FINDING-008(process test 9개, `run-golden-profile.mjs` 정책)

**증거를 더 모아야 하는 것** — FINDING-003의 실제 발현(동일 체크아웃 병렬 write spawn이
실제로 일어나는지), `eval-covered` 13개 중 실행 가능 수

**갱신(2026-09-11) — FINDING-003을 기계로 닫았다.** 훅 입력에 스폰별 `agent_id`가 실리는 것을 임시 프로젝트에서 실측한 뒤(병렬 서브에이전트 둘 → 서로 다른 id, 메인 스레드 → 없음), 같은 체크아웃의 developer 쓰기를 **write 임대로 직렬화**했다. 실제 Claude Code 종단 실행에서 두 번째 developer의 쓰기가 막히고, 홀더의 종료 뒤 임대가 남지 않았다 — receipt `docs/audits/receipts/2026-09-11-write-lease-e2e.json`. 「남의 `SubagentStop`은 임대를 풀지 않는다」는 종단 실행이 아니라 단위 회귀(`test-write-lease.mjs`)가 근거다. 남은 한계는 `protected-core.md` §4(write 임대 행).

**이전 판정(2026-09-10)** — FINDING-003은 **해소되지 않았다.** 스폰별 범위 주입(U5b)을 구현했다가
**걷어냈다** — 그 값을 스폰별로 넣는 생산자가 0건이었고(실측), 쓰이지 않는 보안 민감 경로에서
교차 모델 커밋 리뷰가 경로 탈출·주입 부재 fail-open·기본 경로 명시 주입 fail-open·symlink
우회를 연달아 잡았다. 소비자 0인 표면이 결함만 끌어온 셈이다. 남은 것은 **산문 직렬화 선언(U5a)**
뿐이며 훅이 강제하지 않는다 — 실효 안전 조건은 「직렬화 또는 체크아웃(worktree) 분리」다. 세션만 나누면 같은 `change-scope.md`를 읽으므로 격리가 아니다.
