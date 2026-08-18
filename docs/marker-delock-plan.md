# 마커 탈잠금 계획 (M1)

> B 트랙 마일스톤 1. 한국어 산문에 묶인 계약 마커를 **언어 중립 앵커**로 승격해, 산문을
> 번역해도 게이트 매칭이 깨지지 않게 한다. 이것이 오픈·국제화의 물리적 전제조건이다.
> 이 문서는 read-only 인벤토리 + 설계다. 구현(§5)은 harness-change-reviewer + JUDGMENT 경유.

## 0. 핵심 발견 — 예상보다 작고, 이미 시작됨

정밀 매핑 결과 원래 진단("한국어 마커가 26 에이전트에 락인")이 **재-스코핑**된다:

- **탈잠금은 이미 부분 완료.** 세 마커가 이미 언어 중립 앵커로 전환됐다:
  `<!-- harness-judgment-gate -->`(CLAUDE.md:7), `<!-- inventory:skills -->`(README.md:33),
  `<!-- always-read -->`(contract-hygiene). `docs/protected-core.md` §4(L74)가 이미 실패
  클래스("매칭 실패 → 마커 0건 → 조용히 통과")와 해법(앵커 스킴)을 명시.
- **"26 에이전트"는 단일 마커 `주 소비자`.** 26개 파일에 있으나 **매칭처는 1곳**
  (`validate-artifact-sharding.mjs`), 나머지 26은 *생산자*(런타임에 INDEX 열을 쓰는 지시). 즉
  1-validator / 26-producer fan-out.
- **`담당 범위`·`소유권`은 기계 매칭 0.** 각 28개 파일의 산문 헤더일 뿐 — 소유권은 에이전트
  *이름*으로 강제(`enforce-agent-ownership.mjs`, `agent-registry.mjs`). **지금 자유 번역 가능.**
- **앵커 스킴은 이미 in-tree 선례.** 발명이 아니라 일반화.

## 1. 마커 분류 (매칭 강도 기준)

**HARD FAIL** = errors[]에 추가 / exit 1 · **WARN** = 출력만 exit 0 · **VACUOUS** = 0건이 조용히 통과

### A. 기계 매칭 · 단일 언어 — **탈잠금 대상**

| 마커 | 매칭처 (file:line) | mismatch 시 |
|---|---|---|
| `주 소비자` (INDEX 소비자 열 헤더/값) | `validate-artifact-sharding.mjs:148,150,154` | **WARN only** (exit 0). 번역 시 조용히 열화 |
| `전체` (모두-읽음 sentinel) | `validate-artifact-sharding.mjs:152` (`name==='전체'`) | **WARN only** |
| `realtime은 필수 조건이 아니다` | `validate-harness.mjs:352` (`.includes`) | **HARD FAIL** |
| `realtime interface 완료 후` | `validate-harness.mjs:370` | **HARD FAIL** |
| `**시계열/실시간 감지**` · `**AI 서비스 감지**` | `validate-harness.mjs:168-185` | **HARD FAIL** (코드펜스 안이면도 실패) |

### B. 이미 부분 탈잠금 (bilingual OR 앵커 인식) — 가드 유지만

`## 일반화 근거`/`Generalization evidence`, `항상…읽는다`/`always…read`/`<!-- always-read -->`,
`미구현`/`unimplemented`, `대상 화면/기능`/`Target screens/features`, `## 실행`/`## Execution`,
`catalog 자체를 편집할 때만`/`only when editing the catalog itself`. 번역해도 영어 대안이
같이 있으면 안전. 단 baseline(`contract-hygiene-baseline.json`) 동기화 필요.

### C. 이미 언어 중립 — 대상 아님
`<!-- harness-judgment-gate -->`, `<!-- inventory:skills|agents -->`, `INJECTION_SUSPECT`,
`WEB_PROFILE:`·`SUPPORT_STATUS:`·`maturity:`, `TIMESERIES_MODE`·`AI_MODE`·`LOCAL_DOMAIN_STATE_MODE`
·`EXTERNAL_DATA_INGESTION_MODE`, `static-snapshot`·`NEEDS_DECISION`·`S | M | L | XL` 등.

### D. 산문 전용 (기계 매칭 0) — **지금 자유 번역**
`담당 범위`(28파일), `소유권`(28파일). 소유권은 이름 기반 강제. 헤더 번역은 게이트에 무영향.

### E. 의도적 한국어 — **손대지 않음**
탐지 키워드 `그라파나`·`시계열`·`날짜별`·`실시간`·`빅데이터`·`채팅`
(`validate-harness.mjs:349-350`). 한국어 **사용자 요청**을 매칭해 모드 감지 —
번역하면 기능 자체가 깨진다. 탈잠금 대상이 아니다.

## 2. 매칭 기제 (loud vs silent)

- **Tier 1 — 자기 검사** `validate-harness.mjs`: 공유 `errors[]`(`fail()`) → exit 1. 그룹 A의
  HARD FAIL 마커들이 여기. **fail-closed, loud.**
- **Tier 2 — 런타임 validator** (생성된 `_workspace/**` 대상): silent 위험 구역.
  `validate-artifact-sharding.mjs`는 `주 소비자`/`전체` 불일치를 `warnings.push`(exit 0)로 강등 —
  번역 시 조용히 통과.
- **유일한 명시 가드:** `validate-contract-hygiene.mjs:233-237` `MARKER_LOST` — baseline>0인데
  검출 0이면 HARD FAIL("적을수록 좋음"으로 오인 방지). 탈잠금의 안전 모델은 이 가드를 **모든**
  탈잠금 마커로 일반화하는 것.

## 3. 앵커 스킴 (기존 선례 일반화)

가시 산문 + 뒤에 언어 중립 앵커, validator는 **앵커만** 매칭:

```
## 판단 게이트 <!-- harness-judgment-gate -->      ← 기존 선례 (CLAUDE.md:7)
| 주 소비자 <!-- marker:index-consumer-column --> |  ← 신규 (열 헤더)
전체 → <!-- marker:consumer-all --> 또는 중립 리터럴(* / ALL)
```

- 산문(`주 소비자`, `Primary consumer`, 무엇이든)은 자유 번역.
- validator는 `cell === '주 소비자'` 대신 앵커 존재로 열을 식별.
- 탐지 키워드(그룹 E)는 **제외** — 그대로 둔다.

## 4. `validate-marker-integrity` 게이트 설계

기존 `MARKER_LOST`(always-read 전용)를 **모든 탈잠금 앵커**로 일반화한 신규 validator:

- **입력:** 탈잠금 대상 앵커 목록 + baseline 카운트(`marker-integrity-baseline.json`).
- **규칙:** 각 앵커에 대해 baseline>0인데 현재 검출 0 → **HARD FAIL**(`MARKER_LOST`).
  translation-before/after 카운트 불변을 강제 → silent-pass 원천 차단.
- **추가 강화:** `validate-artifact-sharding.mjs`의 소비자-열 앵커 누락을 **WARN → HARD FAIL**로
  승격(현재 exit 0 → 앵커가 사라져도 통과하는 구멍 폐쇄).
- **CI 배선:** `validate-harness.mjs`에서 호출 → `pnpm run ci` green 조건에 포함.
- **불변식:** I2(게이트 강도 — 약화 아니라 강화), I3(언어 독립으로 일반화).

## 5. 변경 계획 (순서 = 위험 오름차순, 각 단계 커밋 분리)

1. **[무위험] 산문 전용 번역** — 그룹 D(`담당 범위`·`소유권` 헤더)를 bilingual 병기. 게이트 무영향.
   회귀: `pnpm run ci` green 확인.
2. **[저위험] `validate-marker-integrity` 신설** — 게이트를 **먼저** 만든다(마커를 바꾸기 전에
   안전망 설치). baseline 스냅샷. 이 시점엔 아무 마커도 안 바뀌었으니 green.
   → 실질 변경 → **harness-change-reviewer + JUDGMENT**.
3. **[중위험] 소비자-열 앵커화** — `주 소비자`/`전체`에 앵커 추가, `validate-artifact-sharding.mjs`
   매칭을 앵커 기반으로, WARN→HARD FAIL 승격. **26개 에이전트 body + 계약 spec + validator를
   원자적으로** 편집(부분 편집 시 매칭 깨짐 + adapter-drift byte-identity 동시 실패).
   → `node .claude/scripts/build-adapters.mjs` 재생성 → `validate-harness` green.
4. **[중위험] HARD FAIL 마커 앵커화** — 그룹 A의 `realtime…`·`시계열/실시간 감지`·`AI 서비스 감지`
   4종을 앵커로. 각 = 소스 문서 1 + `validate-harness.mjs` 매칭 1 + 재생성.
5. **[검증] 번역 불변 실증** — 산문을 영어로 바꾼 사본에서 `validate-marker-integrity` 매칭 수가
   **번역 전후 동일**함을 실측. 이것이 M1 완료 정의(DoD)의 증거.

## 6. 위험·주의

- **`주 소비자`가 최고 위험** — 1 validator + 1 계약 spec + 26 에이전트 body(→ `.codex/agents/*.toml`
  verbatim). 부분 편집은 (a) 매칭 파괴 + (b) adapter-drift HARD FAIL 동시 유발. **원자적 편집 +
  즉시 재생성** 필수.
- **미러 규칙** — 편집은 `.claude/` 원본만, 이후 `build-adapters.mjs`. `.agents/`·`.codex/` 직접
  편집 또는 재생성 누락 시 `validate-adapter-hygiene` byte-identity 실패.
- **baseline 동기화** — 탈잠금은 카운트를 바꾸므로 `contract-hygiene-baseline.json`·신규
  `marker-integrity-baseline.json` 갱신이 필요. 갱신은 의식적 행위 — **사유를 JUDGMENT에 기록**.
- **그룹 E 절대 번역 금지** — 탐지 키워드는 한국어 사용자 입력 매칭이 목적.

## 7. 완료 정의 (DoD)

- [ ] 그룹 A 마커 전부 언어 중립 앵커로 승격, validator 앵커 기반 매칭.
- [ ] `validate-marker-integrity` 게이트가 `pnpm run ci`에 배선, baseline 확립.
- [ ] 산문 영어화 사본에서 **마커 매칭 수 번역 전후 불변** 실측 receipt.
- [ ] `validate-artifact-sharding` 소비자-열 누락이 HARD FAIL로 승격(silent 구멍 폐쇄).
- [ ] adapter 재생성 + `validate-harness` green.
