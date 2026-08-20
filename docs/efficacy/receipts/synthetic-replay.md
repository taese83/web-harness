# Receipt — 합성 리플레이 (탐지 효능, 결정론 · M2 §4-1c)

**측정 대상:** 게이트 pure core 3종의 탐지 성능을 **변형 공간**에서 측정 — 단위 테스트
(receipts/gate-logic-unit.md, 46/46)가 "알려진 실패 형상을 잡는가"를 답했다면, 이 receipt는
"얼마나 넓은 변형에서 어떤 비율로 잡는가"를 답한다. 라이브 실행 0 토큰.

## 재현 명령

```bash
# Node 22.22.3 (nvm) · 결정론(난수·시각 없음 — 같은 커밋에서 동일 출력)
node docs/efficacy/run-synthetic-replay.mjs
```

코퍼스: repo 내 `.mjs` 전체(126파일 — `.claude/scripts` + `packages`, node_modules 제외).
gitignored 산출물에 의존하지 않으므로 저장소만으로 재현된다.

## 실측 결과 (2026-08-18, exit 0)

### 실험 1 · scanSource 절단 탐지 — recall과 오탐

```
코퍼스: 126개 .mjs (절단 대상 120개 ≥1024B)
완전 파일 오탐: 0/126
byte-cut recall — 25%: 88.3% · 50%: 94.2% · 75%: 98.3% · 90%: 96.7% · 99%: 94.2%
line-cut recall — 25%: 76.7% · 50%: 90.0% · 75%: 91.7% · 90%: 93.3% · 99%: 90.8%
```

(모드당 지점별 120 표본 = 총 1,200 절단 표본)

**해석:**
- **byte-cut**(토큰 중간 절단)은 88~98% — 절단점이 깊을수록 열린 구조가 많아 88%(25%)에서
  98%(75%)로 상승, 99%에서는 마지막 문장 완결 직후에 걸리는 사례가 늘어 94%로 되내림.
- **line-cut**(줄 경계 절단 — LLM 절단의 흔한 형태이자 더 어려운 클래스)은 77~93%.
  미탐은 대부분 **문장·블록이 마침 완결된 지점의 절단** — 구문 스캐너의 원리적 한계다
  (완결로 보이는 절단은 어떤 구문 검사로도 구분 불가). 이 한계는 완결성 게이트의 Layer 1
  (SPAWN_RESULT 완료 마커)·Layer 3(규모 임계)이 보완하도록 설계돼 있다.
- **오탐 2/126(1.6%) 발견 → 당일 해소(2026-08-18)**: 최초 측정에서 validate-settings.mjs·
  validate-workflows-and-evals.mjs 두 완전 파일이 SUSPECT로 오탐됐다 — **정규식 리터럴 안의
  괄호 문자**(`\(`, 문자클래스 `[…]`)를 상태기계가 실제 열림으로 오인. 근본 원인 2개:
  (a) word 버퍼가 `/` 판정 전에 flush되지 않아 키워드-선행 정규식(`return /re/`)이 코드로
  읽힘, (b) 화살표 `=>` 미추적으로 본문 위치 정규식(`rule => /re/`) 미인식(bare `>`는 JSX
  보호로 제외돼 있어 `=>` 합성 토큰이 필요). scanSource의 진입 판정을 정밀화(flush 순서 교정
  + `=>` 합성)해 **재측정 오탐 0/126**, recall 비열화 확인(line-cut 50% 89.2→90.0%, 나머지
  지점 동일 — 위 표는 정밀화 후 수치). 실측 2건 원문은 test-spawn-completion.mjs 회귀로 고정.
  이 발견-해소 이력은 protected-core §4 완결성 게이트 행에 기록.

### 실험 2 · analyzePlan 경계 정밀성

```
OUTPUT_FANOUT 경계(>8) 정확: YES  (outputs 1..16 스윕 — 9부터 정확히 REFUSE)
READ_BUDGET 경계(>60,000 tokens) 정확: YES
  59,999 → FITS · 60,000 → FITS · 60,001 → REFUSE · 120,000 → REFUSE
READ_MISSING REFUSE: YES
```

임계가 문서 값에서 **정확히 한 단위 차이로** 뒤집힌다 — 경계 구현 오류(off-by-one·단위 혼동)
없음. **이것은 경계 정밀성이지 실형상 recall이 아니다** — 실형상 결과 수준 진실은 protected-core
§4에 등록된 재구성 실측(베이스라인 6건 중 OUTPUT_FANOUT 2건 탐지, 4건은 임계 미만으로 미탐 —
"잡으려면 정직하게 넓은 reads 선언 필요")이 정본이며, 이 스윕은 그것을 대체하지 않는다.

### 실험 3 · computeRemaining 분류 배터리

```
done.mjs: done ✓ · truncated.mjs(60% 절단): truncated ✓ · empty.mjs: missing ✓
missing.mjs: missing ✓ · notes.md(비-code): done ✓
전체 정확: YES · remaining 정확: YES (truncated ∪ missing = 3건)
```

## 정직 한계 (I1·I5)

1. 합성 recall은 **모델링된 실패 형상**(체계적 절단)에 대한 것 — 실세계 절단 발생률·분포는
   측정하지 않았다(그건 텔레메트리 축적의 몫).
2. 코퍼스는 하니스 자기 코드(.mjs) — 생성물(TS/TSX 앱 코드)과 스타일이 다르다. 생성물 코퍼스
   (workspace/)는 gitignored라 재현성 있는 receipt에서 제외했다. 로컬 확장 실행은 가능.
3. 이 receipt는 **탐지 효능**의 완결이다. **결과 효능**(게이트 ON이 OFF보다 완주율을 높이는가)
   은 여전히 미측정 — README §5의 예산 승인 게이트 뒤에 있다.

## 탐지 효능 매트릭스에서의 위치

| 질문 | 증거 | 상태 |
|---|---|---|
| 알려진 실패 형상을 잡는가 | gate-logic-unit.md (46/46) | ✅ |
| 현장(ON)에서 발화했는가 | baseline-on-seminar-booking.md (n=1) | ✅ |
| 변형 공간에서 어떤 비율로 잡는가 | **이 receipt** (1,200 표본 + 경계 + 분류) | ✅ |

**탐지 효능 측정 완결.** 남은 것은 결과 효능(ON/OFF × 2형태 라이브 A/B)뿐이다.
