# SDD 전환 기록 — 스팩이 개발을 구속한다 (2026-08-26)

*디자인된 단면 버전은 Claude artifact로 존재한다(링크는 메인테이너에게 문의).*

**범위**: 커밋 23 · 플러그인 0.2.1 → 0.4.1 · 신설 검증 스크립트 4 · 신설 회귀 107 ·
적대 리뷰 6회차

한계 표기의 정본은 `docs/protected-core.md` §4다. 이 문서는 요약이며 그것을 대체하지 않는다.

---

## 1. 왜 손댔나

하네스는 개발 단계를 **산문 22단계 파이프라인**으로 지시하고 있었다. 어떤 빌더가 어떤 순서로
도는지, 디렉토리를 어떻게 나눌지, 어떤 라이브러리를 쓸지가 전부 하드코딩이었다.

실측으로 드러난 결과: 사내 모노레포의 한 React 패키지를 분석했더니 **레이어 10개 중 5개가
소유자 없음으로 훅에 막혔다**. 그 저장소는 `entities/features/widgets`가 아니라
`stores/hooks/consts` 어휘를 쓰고, 그 어휘가 루트 ESLint의 `import/order` pathGroups에
인코딩돼 있어 바꿀 수도 없었다.

동시에 브라운필드 계약(`integration-overlay`)은 "기존 설정에서 감지하고 임의 기본값으로
덮어쓰지 않는다"를 요구하고 있었다. **계약과 구현이 모순이었다.**

---

## 2. 설계 — 세 층으로 갈랐다

| 층 | 성격 | 소유 |
|---|---|---|
| **원칙** | 프로세스 법 — test-first, 증거 요구, 안전 하한 | `protected-core`. **스팩에서 재선언하지 않는다** |
| **고정 기반** | 도구 substrate — 패키지 매니저·언어·번들러·테스트 러너·lint·formatter·e2e | `constitution.substrate`. 하네스 기본 제공, **브라운필드 실측이 이긴다** |
| **유동 선택** | 서비스마다 답이 다른 것 | 스팩 — `targetShapes`·`architecture`·`layerMap`·`libraries`·`communication`·`concurrency`·`moduleBoundaries` |

핵심 판단: **스캐폴딩에 두 종류가 있다.**

- **능력 보상형** — 모델이 못 하는 걸 보상한다(프로필 enum·FSD 경로·22단계 파이프라인).
  모델이 좋아지면 녹아 없어져야 한다
- **협업 계약형** — 사람들이 합의해야 하는 걸 인코딩한다(스팩 락·receipt·소유권 경계).
  **모델 능력과 무관하게 남는다**

업계 논의(Lance Martin, Han Chung Lee, Addy Osmani)는 대부분 앞의 것만 다룬다 — 1인 생산성
프레임이기 때문이다. 뒤의 것이 이 전환의 중심이다.

### GitHub Spec Kit 대조

조사 결과 Spec Kit은 `constitution` / `spec` / `plan` / `tasks` 넷으로 나눈다. 매핑:

| Spec Kit | web-harness |
|---|---|
| `constitution.md` | 없었다 → `constitution.substrate` 신설 (원칙은 `protected-core`가 소유) |
| `spec.md` | `requirements.md` + `feature-plan.md` + `ux-brief` (Phase 1) |
| — | **디자인 산출물** — Spec Kit에 없는 층 |
| `plan.md` | **`solution-design.md`** (신설) |
| `tasks.md` | `web-execution-plan.json` + 22단계 산문 |

**그대로 채택하지 않은 이유**: Spec Kit 헌법은 원칙(test-first)과 아키텍처 의견(library-first,
CLI 의무, 최대 3 프로젝트)을 섞어 놨다. 그 의견들은 "라이브러리도 웹앱도"와 정면 충돌한다 —
산출물 형태는 스팩 결정이어야지 헌법이 강제할 게 아니다.

---

## 3. 흐름

| 단계 | 내용 |
|---|---|
| 기획 | 기존 스킬 유지. FEAT/TC ID가 수용 기준이 된다 |
| 디자인 | 기존 스킬 유지 (선택). 디자인 없는 개발도 있다 |
| **설계** ★ | `system-architect` — 아키텍처 패턴·레이어 맵·라이브러리·통신·동시성·모듈 경계를 기록. 브라운필드는 실측이 제안을 이기고, 갈리는 결정은 확정하지 않고 사용자에게 올린다 |
| **잠금** ★ | `lock-spec` — **확정되지 않은 결정이 하나라도 남으면 잠기지 않는다.** 잠금 자신의 해시가 append-only 원장에 기록된다 |
| 개발 | 가이드라인 + 잠긴 스팩. 소유권 경계가 `layerMap`에서 나온다 — 역할은 하네스가 고정하고 경로는 프로젝트가 정한다 |
| **검증** ★ | `validate-spec-conformance` → 릴리스 게이트. 잠긴 프로젝트는 릴리스가 스팩에 묶인다 |

### 주요 명령

```bash
node .claude/scripts/spec.mjs --project-root <path>
node .claude/scripts/validate-spec-conformance.mjs --project-root <path> --json
node .claude/scripts/validate-shape-checks.mjs --project-root <path> --shapes library,cli
```

### 잠금 거부 조건 (fail-closed)

- `status: "open"`인 미결정 잔존 — 착수 전 확정이 전제다
- 결정 블록 부재·중복(정본 모호)·JSON 오류
- `acceptanceSource` 자기 모순, `architecture.rationale` 부재
- `targetShapes` 부재·구 단수 필드 사용

### 거부하지 않고 라벨로 표기

수용 기준이 없으면 `specTier: "unverifiable"`로 잠긴다. 기획 없는 브라운필드 개선을 막지
않으면서 그 상태를 숨기지도 않는다.

### 형태 → 요구 검증 (합집합)

| | 요구 | 방식 |
|---|---|---|
| 공통 | `quality.lint` · `quality.typecheck` · `quality.unit` | runtime — 구현됨 |
| `web-app` | `vite.build` · `vite.browser` | runtime — 구현됨 |
| `library` | `pack.publish-metadata` · `lib.public-api` | **static — 구현됨** |
| | `pack.contents` | runtime — **미구현** |
| `cli` | `cli.bin-entrypoint` | **static — 구현됨** |
| | `cli.exit-codes` · `cli.stderr-errors` | runtime — **미구현** |

**미구현 요구는 프로젝트 실패로 보고하지 않는다.** 하네스가 못 하는 것을 FAIL로 내면
"프로젝트가 잘못했다"는 뜻이 되는데 잘못한 건 하네스다. `unimplementedChecks`로 분리 보고한다.

### 원장 결박

| 판정 | 뜻 |
|---|---|
| `OK` | 원장의 어느 기록과든 일치 — 재잠금 정상 |
| `SPEC_TAMPERED` | 잠금 해시가 원장 어디와도 불일치 — 사후 수정 |
| `SPEC_DELETED` | 원장에 기록이 있는데 파일이 없음 — 삭제로 결박 해제 |
| `NO_LEDGER` | 원장 없음 — 실패가 아니라 **결박 부재**로 보고 |
| `INVALID_SPEC` | 파일이 있는데 읽을 수 없음 — 잠금 없음으로 강등되지 않는다 |

---

## 4. 실측으로 바뀐 것 — 설계가 틀렸던 지점들

전부 조사나 적대 리뷰가 잡았다. 추측으로 만든 뒤 고친 기록이다.

| 만든 것 | 무엇이 틀렸나 | 어떻게 잡혔나 |
|---|---|---|
| 단일 `targetShape` | 라이브러리이면서 CLI인 패키지가 정상 패턴이다. 하나로 강제하면 검증의 절반을 잃는다 | 배선 전 조사 |
| lockfile 근거 | 설치 증거를 채택 증거로 오귀속. webpack+vitest 앱이 react-vite-spa로 조용히 오탐 | 적대 리뷰 |
| FSD를 기본 layerMap으로 | 등록부는 레이어 이름보다 많은 것을 인코딩한다(`live-mode` carve-out). 평면 map이 경계를 무너뜨림 | **게이트가 잡음** |
| 깨진 잠금 → `NO_SPEC` | 파일 한 바이트만 깨뜨리면 결박이 꺼진다. 보고까지 거짓(있는 파일을 없다고) | 적대 리뷰 |
| receipt 이름 `quality.lint` | 러너는 `lint.json`을 쓴다. 잠근 프로젝트 전원이 오탐 블록될 뻔 | 적대 리뷰 |
| scoped 패키지 파싱 | `@scope/pkg`가 빈 문자열이 돼 검증을 통째로 건너뜀. 위조가 PASS | 적대 리뷰 |

세 번째가 특히 그렇다 — **내가 게이트를 약화시켰고 게이트가 그것을 잡았다.**

다섯째·여섯째는 내 테스트가 못 잡은 이유가 자기일관적이었다. fixture를 손으로 잘못된 이름으로
써서 버그와 같은 방향으로 오염돼 있었고, 깨진 잠금 테스트는 `assert.ok(Array.isArray(errors))`
라는 vacuous assertion으로 fail-open을 회귀에 고정하고 있었다.

---

## 5. 상태

| 단계 | 내용 | 상태 |
|---|---|---|
| 0 설계자 | 구현 설계 결정 기록 | ✅ |
| 1 스팩 잠금 | 미결정 잔존 시 거부 · 원장 결박 | ✅ |
| 2a 정합 검사 | `measured` 실측 대조 · staleness | ✅ |
| 2b 형태 → 검증 | 합집합 요구 · 릴리스 배선 | ◐ runtime 3종 미구현 |
| 3b 스팩 유래 소유권 | `layerMap`이 쓰기 경계 공급 | ✅ |
| 3c 커버리지 보고 | 덮이지 않은 디렉토리 통보 | ✅ |
| 3d FSD 기본값 제거 | — | ❌ carve-out 표현 불가 |
| 4 파이프라인 제거 | — | ❌ 미착수 |

---

## 6. 정직하게 남긴 한계

**실사용 잠금이 0건이다.** 골든 레퍼런스 3종이 전부 `NO_SPEC`이고 이 전환 전체가
**fixture 회귀로만 무장**돼 있다. "릴리스가 스팩에 묶인다"는 잠금 실사용이 발생하는 시점부터
참이다.

**원장도 파일이다.** 잠금과 함께 지우면 탐지되지 않는다. 로컬 신뢰 모델의 명시적 리스크
인수이며(티켓 원장과 같은 판단), 실질 방어는 원장이 git에 커밋되어 삭제가 히스토리에 남는 것이다.

**`measured`는 여전히 자기보고다.** 실존 대조가 붙었지만 도구명이 npm 패키지명과 다르고
aliases 미등록이면 `unverifiable`로 샌다. 그리고 그 오탐이 이제 릴리스 블록으로 격상됐다.

**`substrate-defaults.json`은 4번째 사본이다.** `tooling-scaffolder`·`validate-toolchain`·
`ts-conventions`와 값을 공유하지 않는다. `packageManager` 하나만 텍스트 결속 테스트가 있다.

**결과 효능은 여전히 미측정이다.** 같은 날 A/B가 결론 불가로 종료됐고, 이 전환이 실제로 더
나은 결과를 내는지에 대한 증거는 없다. 다만 *이전 상태가 낫다는 증거도 없다* — "증명된 것 →
미증명"이 아니라 "미증명이고 좁음 → 미증명이고 넓음"이다.

---

## 7. 남은 순서

1. **runtime 3종 구현** — `pack.contents`·`cli.exit-codes`·`cli.stderr-errors`. 실행 관측이
   필요해 quality runner 바인딩이 있어야 한다. **정적 근사로 대체하지 않는다** — 그건 프록시다
2. **`layerMap` carve-out 표현** — 3d의 전제. 평면 map이 "이 레이어에서 이 하위는 제외"를
   표현할 수 있어야 FSD 하드코딩을 걷어낼 수 있다
3. **22단계 파이프라인 제거** — 가장 큰 해제. 1·2가 서야 검증을 잃지 않고 할 수 있다

**순서와 무관하게 값이 큰 것**: 실사용 잠금 하나. 골든에 잠긴 변형을 넣으면 이 전환이 fixture
밖에서 처음 발화하고, 그때 무엇이 더 틀렸는지가 드러난다 — §4의 여섯 항목이 그렇게 나왔다.
