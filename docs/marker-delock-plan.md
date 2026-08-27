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
- **"26 에이전트"는 단일 마커 `주 소비자` — 단, 실제 완전집합은 27이었다.** 26개 파일이 문자열
  `주 소비자`를 담고, `component-designer.md`는 열 이름 없이 같은 프로토콜을 참조한다(문자열
  grep 인벤토리의 사각 — ③ 리뷰에서 발견). 매칭처는 1곳(`validate-artifact-sharding.mjs`),
  나머지는 *생산자/소비자*(런타임에 INDEX 열을 쓰고 읽는 지시). 즉 1-validator / 27-consumer
  fan-out.
- **`담당 범위`·`소유권`은 기계 매칭 0.** 각 28개 파일의 산문 헤더일 뿐 — 소유권은 에이전트
  *이름*으로 강제(`enforce-agent-ownership.mjs`, `agent-registry.mjs`). **지금 자유 번역 가능.**
- **앵커 스킴은 이미 in-tree 선례.** 발명이 아니라 일반화.

## 1. 마커 분류 (매칭 강도 기준)

**HARD FAIL** = errors[]에 추가 / exit 1 · **WARN** = 출력만 exit 0 · **VACUOUS** = 0건이 조용히 통과

### A. 기계 매칭 · 단일 언어 — **탈잠금 대상**

| 마커 | 매칭처 (file:line) | mismatch 시 |
|---|---|---|
| ~~`주 소비자`~~ → **✅ ③ 완료(2026-08-18)** — validator가 절 행을 구조(2열 백틱 절 파일)로 식별, 헤더 문자열 매칭 삭제. 소스는 `<!-- marker:consumer-read-protocol -->` 앵커(27곳)로 승격, marker-integrity가 보호 | `validate-artifact-sharding.mjs` (구조 식별) | **HARD FAIL** (WARN에서 승격) |
| ~~`전체`~~ → **✅ ③ 완료** — sentinel이 언어 중립 집합 `전체`/`*`/`all`로 확장 | `validate-artifact-sharding.mjs` | **HARD FAIL** |
| ~~`realtime은 필수 조건이 아니다`~~ → **✅ ④ 완료(2026-08-18)** — `<!-- marker:timeseries-historical-only -->` 앵커로 marker-integrity 레지스트리에 이관 | `validate-marker-integrity.mjs` (존재-류) | **HARD FAIL** |
| ~~`realtime interface 완료 후`~~ → **✅ ④ 완료** — `<!-- marker:timeseries-realtime-build-order -->` 앵커로 이관 | `validate-marker-integrity.mjs` (존재-류) | **HARD FAIL** |
| ~~`**시계열/실시간 감지**`~~ → **✅ ④ 완료** — `<!-- marker:detect-timeseries -->` 앵커. (`detect-ai-service`는 2026-08-27 AI 표면 제거로 함께 삭제) 배치-류(코드펜스 밖 검사)라 validate-harness의 instructionPlacementChecks에 남되 needle만 앵커로 전환 | `validate-harness.mjs` instructionPlacementChecks (배치-류) | **HARD FAIL** (코드펜스 안이면도 실패) |

### B. 이미 부분 탈잠금 (bilingual OR 앵커 인식) — 가드 유지만

`## 일반화 근거`/`Generalization evidence`, `항상…읽는다`/`always…read`/`<!-- always-read -->`,
`미구현`/`unimplemented`, `대상 화면/기능`/`Target screens/features`, `## 실행`/`## Execution`,
`catalog 자체를 편집할 때만`/`only when editing the catalog itself`. 번역해도 영어 대안이
같이 있으면 안전. 단 baseline(`contract-hygiene-baseline.json`) 동기화 필요.

### C. 이미 언어 중립 — 대상 아님
`<!-- harness-judgment-gate -->`, `<!-- inventory:skills|agents -->`, `INJECTION_SUSPECT`,
`WEB_PROFILE:`·`SUPPORT_STATUS:`·`maturity:`, `TIMESERIES_MODE`·`LOCAL_DOMAIN_STATE_MODE`
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

1. **[무위험] 산문 전용 번역** — **결정 변경(⑤ 시점)**: 그룹 D는 기계 매칭 0이 확정됐으므로
   bilingual 병기라는 사전 작업 자체가 불필요하다(56파일 churn만 남는 일). 그룹 D 번역은
   M4 패키징의 전면 영어화에서 일괄 수행한다 — ⑤ receipt가 그룹 D 포함 번역의 안전성을
   이미 실증했다.
2. **[저위험] `validate-marker-integrity` 신설** — 게이트를 **먼저** 만든다(마커를 바꾸기 전에
   안전망 설치). baseline 스냅샷. 이 시점엔 아무 마커도 안 바뀌었으니 green.
   → 실질 변경 → **harness-change-reviewer + JUDGMENT**.
3. **[중위험] 소비자-열 앵커화** — **✅ 완료(2026-08-18, 리뷰 HIGH 2건 반영)**. 설계에서 한
   단계 개선: 생성물(INDEX.md) 쪽은 앵커 의존 대신 **구조 식별**(절 행 = 2열 백틱 절 파일)로
   전환 — LLM이 앵커를 복사할 필요가 없어 *앵커 소실*이라는 실패 모드는 생성물 쪽에 존재하지
   않는다. 대신 동형의 잔여 위험(**백틱 포맷 이탈로 행이 절 행 인식을 벗어나는 부분 우회**)이
   생기는데, 리뷰가 이를 실증해(단일 행 백틱 생략 + 평문 substring 등재 검사의 분리) **절 행
   커버리지 검사**(디스크의 모든 절 파일은 백틱 절 행으로 커버, 4열 EOL 앵커)로 폐쇄했다 —
   회귀 2종(단일 행 생략·5열 표)으로 고정. 소스 쪽은 **27 에이전트**(26 + 리뷰가 발견한
   `component-designer` 누락분) + 계약에 `<!-- marker:consumer-read-protocol -->` 앵커(28곳,
   baseline 28)로 승격. sentinel은 `전체`/`*`/`all`. WARN→HARD FAIL 승격 + 빈 칸 위반 추가.
   **파일럿 재실행**(로컬 전용 — workspace/는 gitignored라 저장소 내 재현물이 없는
   self-attestation이다. 재현: `for p in workspace/*/_workspace; do node
   .claude/scripts/validate-artifact-sharding.mjs --project $(dirname $p); done`): 12개 exit
   변화 0, 오탐 소멸(영어 헤더 `Primary consumer`·타 표·괄호 한정어), 실재 위반(`e2e-test-writer`
   등 미존재 에이전트)만 error 승격. 회귀: `test-artifact-sharding.mjs` 9종(영어 INDEX 통과·
   우회 2종 포함). adapter 재생성 + mirror 일치 확인.
4. **[중위험] HARD FAIL 마커 앵커화** — **✅ 완료(2026-08-18)**. 마커를 두 류로 분리해 이관:
   **존재-류**(realtime 2종)는 validate-harness 인라인 매칭을 삭제하고 marker-integrity
   레지스트리로 이관(앵커 각 1, baseline 등록). **배치-류**(감지 2종 — 코드펜스 밖 배치까지
   검사)는 placement 로직이 레지스트리에 없으므로 validate-harness에 남되 needle을 한국어
   굵은 글씨에서 앵커로 전환. 중복 검사 없음(존재는 레지스트리, 배치는 harness — 류당 1곳).
   이로써 **그룹 A의 기계 매칭 한국어 마커는 0이 됐다**. 남은 한국어 기계 매칭은 (a) 의도적
   유지인 그룹 E(탐지 키워드), (b) 계약 마커가 아닌 **기능 테스트 fixture 매칭** —
   `validate-harness.mjs`의 `## 작업 내용`(read-skill-section 로더가 templates.md의 실제 절
   내용을 보존하는지 검증; 마커가 아니라 fixture 콘텐츠라 분류표 밖, 템플릿 영어화 시 함께
   갱신하면 됨 — ④ 리뷰 지적으로 명시).
5. **[검증] 번역 불변 실증** — **✅ 완료(2026-08-18)**. 레지스트리가 스캔하는 4개 표면 전체
   (에이전트 99파일 + 샤딩 계약 + detection-contract + web-orchestrator SKILL)를 사본으로 뜨고,
   **마커를 지닌 모든 라인**(consumer 프로토콜 27 + 계약 헤딩 + historical-only + 빌드 순서 +
   배치-류 지시문 2)을 영어로 치환한 뒤 실측:

   ```
   원본(한국어): {"consumer-read-protocol":28,"timeseries-historical-only":1,"timeseries-realtime-build-order":1}
   사본(영어화): {"consumer-read-protocol":28,"timeseries-historical-only":1,"timeseries-realtime-build-order":1}
   불변: YES · 영어화 사본 게이트 판정: PASS (0 failures) · 잔존 한국어 마커 문장: 0
   ```

   생성물 쪽 대칭 증거는 `test-artifact-sharding.mjs`(영어 INDEX 동일 판정)가 상시 회귀로
   보유. 재현: 사본 트리에 위 치환을 적용하고 `snapshotMarkers(원본) === snapshotMarkers(사본)`
   + `validateMarkerIntegrity(사본)` 0 failures를 확인한다.

## 6. 위험·주의

- **`주 소비자`가 최고 위험** — 1 validator + 1 계약 spec + 26 에이전트 body(→ `.codex/agents/*.toml`
  verbatim). 부분 편집은 (a) 매칭 파괴 + (b) adapter-drift HARD FAIL 동시 유발. **원자적 편집 +
  즉시 재생성** 필수.
- **미러 규칙 (역사적 — 2026-08-18 ×3 미러 제거로 소멸, M4 판정)** — 편집은 `.claude/` 원본만, 이후 `build-adapters.mjs`. `.agents/`·`.codex/` 직접
  편집 또는 재생성 누락 시 `validate-adapter-hygiene` byte-identity 실패.
- **baseline 동기화** — 탈잠금은 카운트를 바꾸므로 `contract-hygiene-baseline.json`·신규
  `marker-integrity-baseline.json` 갱신이 필요. 갱신은 의식적 행위 — **사유를 JUDGMENT에 기록**.
- **그룹 E 절대 번역 금지** — 탐지 키워드는 한국어 사용자 입력 매칭이 목적.

## 7. 완료 정의 (DoD)

- [x] 그룹 A 마커 전부 언어 중립화 — `주 소비자`/`전체` ✅(③), HARD FAIL 4종(존재-류 2 →
      레지스트리 이관 · 배치-류 2 → 앵커 needle) ✅(④)
- [x] `validate-marker-integrity` 게이트가 `pnpm run ci`에 배선, baseline 확립. (②, c9f57dc)
- [x] **번역 전후 매칭 불변** 실측 — 소스: ⑤ 실물 receipt(마커 라인 전원 영어화 사본에서
      28/1/1 불변 + 게이트 PASS) + `test-marker-integrity.mjs` "언어 독립성" 상시 회귀.
      생성물: `test-artifact-sharding.mjs` 영어 INDEX(`Primary consumer` 헤더 + `*` sentinel)
      동일 판정 + telemetry-viewer 실파일럿에서 영어 헤더 오탐 소멸 실측. (③⑤)
- [x] `validate-artifact-sharding` 소비자-열 검사 HARD FAIL 승격 + 빈 칸·vacuous pass 폐쇄. (③)
- [x] adapter 재생성 + mirror 일치 + `validate-harness` green. (③④)

**M1 DoD 전 항목 충족(2026-08-18)** — 계약 산문은 이제 게이트를 깨지 않고 번역 가능하다.
전면 영어화 자체는 M4(채택·패키징)의 몫이며, 그때 이 게이트들이 안전망으로 작동한다.
