# 그린필드 파일럿 2 프로토콜 — 통합 검색 포털 (사전 등록)

> 2026-08-19 실행 전 고정. 사후 변경 금지 — 좋게 나온 항목만 기록하는 것은 I1 위반이다.

## 목적 (사중 효율 — 한 실행이 4개 부채를 갚는다)

1. **M3 2형태 임계 재교정** — seminar-booking(SPA·local-domain-state)과 다른 형태
   (hybrid serverless)에서 execution-budget 임계(fit-gate 8/60k·runaway 120k/20min·
   spawn cap 55)의 실측 분포 수집 → `execution-budget-contract.md` L157-159의
   "2개+ 형태로 일반화되지 않았다" 부채 해소 데이터.
2. **M2 I3** — 위와 동일 데이터가 효능 하네스의 2형태 요건 충족.
3. **M4 DoD receipt** — "문서·하네스만으로 첫 앱 생성"의 repo-모드 실증
   (플러그인-경로 DoD는 별도 실행 필요함을 정직 표기).
4. **디자인 체계 첫 실전** — UI_LANE 결정·tailwind-shadcn 레인·발산 리서치 프로토콜·
   단일 시안+근거 루프·validate-ui-lane, 전부 "명명 수준"에서 "실행됨"으로.

## 대상 서비스 (사용자 지정)

통합 검색 포털 — 구글/네이버/YouTube/ChatGPT/Gemini 검색 API를 취합해 하나의 결과로
보여주는 서비스. 자동완성 등 포털 기본 검색 기능 + "검색 정보를 이질감 없이 세련되게".
API는 Mock 우선 + 실연결 가이드(외부 키는 serverless proxy 뒤). 위치:
`workspace/search-portal`.

## 예상 기록 (실측이 다르면 다른 대로 적는다)

- WEB_PROFILE: `vite-serverless-hybrid` (검색 proxy·자동완성 API = 앱 루트 `api/`)
- UI_LANE: `tailwind-shadcn` — 단, 결정은 tech-advisor가 lib-catalog 판단 축으로
  내리는 것이며 이 예상이 결정을 앵커하면 안 된다(결정 근거 1줄이 증거)

## 측정 항목 (사전 고정)

| 항목 | 출처 | 비교 기준 |
|---|---|---|
| 스폰 수·토큰·outcome·runaway | `_workspace/04_qa/execution-telemetry.json` | seminar-booking ON-암(22스폰·2.8M·미완 3·runaway 10) |
| fit-gate 판정 분포 | validate-spawn-plan 실행 기록 | REFUSE/FITS와 실제 결과의 정합 |
| UI 레인 일치 | `validate-ui-lane.mjs --project` | PASS 필수 (CROSS_LANE이면 그 자체가 발견) |
| 발산 리서치 실행 흔적 | ux-brief Reference 표(축≥3·기각 기록·recency 출처·날짜) | 형식 충족 여부 — 미충족이면 프로토콜이 산문에 그친 것 |
| 단일 시안 루프 | 프리뷰 디자인 근거 패널 + 승인 기록, opt-in 토글 발동 여부·사유 | A/B 회귀(기록 없는 토글) 발생 여부 |
| 상투 회피 | design-system 산출물 vs research 계약의 금지 목록 | 위반 시 근거 기록 유무 |
| 완주/게이트 발화 | Gate A/B/C·스폰 완결성 게이트 기록 | 발화 시 회수 여부 |

## 정직 조건

- 이 실행은 **ON-암 단독**이다 — OFF 대조군이 없으므로 결과 효능("게이트 덕분")을
  주장하지 않는다. 산출은 2형태 교정 데이터 + 탐지 발화 사례 + 디자인 체계 실행 receipt다.
- "세련됨"의 판정 기준은 사용자의 시안 승인이며, 하네스의 자기평가가 아니다.
- 미완주·게이트 실패·설계 결함이 나오면 그대로 기록한다 — 그것이 이 파일럿의 산출물이다.
- 결과는 이 파일에 append하고 receipt는 `docs/efficacy/receipts/`에 남긴다.

## 실행 기록 (실행 후 append)

### R1 — 2026-08-19 시작

run ID `2026-08-19T01:27+fresh`. 인테이크 확정(공개 서비스 지향 / 여러 탭 왕복 제거 /
5소스 전부), 모드 배너 사용자 확인(AI_MODE true·L0·submode 없음, vite-serverless-hybrid,
API_CONTRACT+MOCK_SERVICE) 후 Phase 1 진행.

#### 게이트 발화 1 — sharding(P1 Wave 0) + 하니스 실측 결함 4호

planning-facilitator 산출 `planning-context.md`에 sharding 게이트 발화. 원시 출력:

    Artifact sharding contract violations (1):
    - _workspace/01_plan/planning-context.md: has 10 sections (trigger 8) — split required

분할 재실행(retry 스폰)에서 **enforce-agent-ownership이 shard Write 7건 전부 차단** —
에이전트는 우회 없이 `SPAWN_RESULT: blocked`로 보고(부분 산출물 0건, 97,207 tokens는
incomplete로 telemetry 기록). 원인: artifact-sharding-contract는 Phase 1 산출물 분할을
명시하는데 agent-registry.mjs의 Phase 1 소유자 6패턴이 전원 flat-only — **계약↔강제
어긋남(실측 결함 4호)**. 회수: 레지스트리 6패턴을 Phase 2 관용구 `(?:\.md|\/.+)$`로 확장
(project-brief는 계약이 분할 금지라 의도적 flat 유지), harness-change-reviewer
PASS_WITH_FINDINGS(정합화 판정·regex 안전성 확인, 회귀 fixture·본 receipt 보완 지시 →
반영). 분할 후 재검증:

    Artifact sharding contract satisfied (2 artifacts inspected).

정직 기록: 분할 자체는 환경 권한 분류기가 planning-facilitator 재스폰을 반복 차단해
스킬의 명시 폴백(오케스트레이터 직접 실행, 내용 보존 기계 변환)으로 수행 — 스폰
telemetry에 잡히지 않는 구간이며 validator 기계 판정으로 결과를 검증했다.

#### 게이트 발화 2 — sharding(P1 Wave 1)

requirements-analyst가 처음부터 sharded 디렉토리로 산출(레지스트리 확장의 첫 정상 소비).
INDEX 위반 3건 발화 — 원시 출력:

    Artifact sharding contract violations (3):
    - _workspace/01_plan/requirements/INDEX.md: 6.9KB exceeds the index budget 5.0KB — keep the table, drop prose
    - _workspace/01_plan/requirements/INDEX.md: references a missing section file local-domain-state.md
    - _workspace/01_plan/requirements/INDEX.md: references a missing section file ai-requirements.md

담당 에이전트 재개(retry 스폰)로 INDEX만 수정(6.9KB→4.7KB, 허위 참조 2건 제거) 후 재검증:

    Artifact sharding contract satisfied (3 artifacts inspected).

두 발화 모두 회수 완료 — 발화→재실행→기계 재판정 루프가 Phase 1에서 2회 작동.

#### 게이트 발화 3 — sharding(P1 Wave 1-A) + 결함 4호의 예고된 재현(5호)

ai-requirements-analyst 산출에 발화. 원시 출력:

    Artifact sharding contract violations (1):
    - _workspace/01_plan/ai-requirements.md: unsharded artifact is 24.0KB (budget 20.0KB) — split required

이는 결함 4호 리뷰에서 리뷰어가 명시적으로 예고한 잔여 후보("ai-requirements-analyst는
여전히 flat-only이고 계약 표 밖 — 동일 클래스 결함이 재현되면 같은 정합화 적용")의
실측 재현이다. 회수: ai-requirements만 sharded 허용(autonomy-risk-matrix는 실측 없어
flat 유지 — 근거 없는 선제 확장 금지), 회귀 케이스 4건 추가, 계약 표에 ai-requirements
행 추가(AI 설계 Gate 5종의 소비자 경계).

#### 게이트 발화 4 — sharding(P1 Wave 5) + 기계끼리 모순(결함 6호)

planning-synthesizer의 project-brief.md(20KB 이내)에 섹션 트리거 발화. 원시 출력:

    Artifact sharding contract violations (1):
    - _workspace/01_plan/project-brief.md: has 11 sections (trigger 8) — split required

그런데 계약은 project-brief 분할을 금지하고("요약이 원본만큼 커지면 요약이 아니다 —
축소하라") 소유권 레지스트리도 flat-only로 잠겨 있다(결함 4호 회수 때 그 negative
케이스까지 추가함). 즉 validator가 **시정 불가능한 지시**를 낸 기계끼리 모순 — 계약의
예외를 validator가 모델링하지 않은 결함이다. 회수: SHRINK_ONLY_BASENAMES 도입 —
project-brief는 섹션 트리거 제외, KB 예산은 "축소" 지시로 유지(게이트 강도 불변),
회귀 테스트 3건 추가(예산 내 11섹션 통과 / 20KB 초과는 축소 지시로 위반 / 일반
산출물 섹션 트리거 불변) → 스위트 12/12, 파일럿 재검증:

    Artifact sharding contract satisfied (9 artifacts inspected).

#### fit-gate 첫 실전 판정 분포 (P2 Wave 1 스폰 전)

광폭 선언(01_plan 전체, browse): **4/4 REFUSE** — read 추정 62,696 > 임계 60,000. P1에서
fit-gate 없이 나간 스폰 4건이 전부 runaway(147~189k)였던 실측이 이 경고를 소급 입증.
소비자 맵 좁힘(디렉터리 2개씩) 재선언: **4/4 FITS + lock**, 프롬프트에서 읽기 범위를
잠금 선언과 일치시키고 교차 산출물 핵심 사실은 발췌 주입. 효과 실측: 좁힘 스폰 4건은
28.7k~119.7k로 전원 완주(seminar에서 truncate났던 layout-designer 포함), 광폭으로 나간
api-schema-designer만 139.5k 초과. **발견: P1 기획 웨이브에는 fit-gate 배선이 없다** —
P1 runaway 4건은 게이트가 볼 기회조차 없었다(개선 후보).

#### 게이트 발화 5 — sharding(P2 Wave -1·1 완료 검증) + 동일 클래스 3번째 재현(7호)

원시 출력(위반 5건):

    - _workspace/02_design/ai-threat-model.md: unsharded artifact is 22.5KB (budget 20.0KB) — split required
    - _workspace/02_design/api-schema/INDEX.md: references a missing section file data-model.md
    - _workspace/02_design/design-system/INDEX.md: references a missing section file design-direction.md
    - _workspace/02_design/layout-spec/search-results.md: 16.6KB exceeds the section budget 15.0KB — re-split on a smaller axis
    - _workspace/02_design/performance-budget.md: has 9 sections (trigger 8) — split required

분류·회수: ① ai-threat-model 초과는 4·5호와 동일 클래스(AI_MODE 소유자 flat-only)의
3번째 실측 재현 — 리뷰어가 예고한 잔여 후보 그대로. 레지스트리 확장 + 회귀 케이스 2건 +
계약 표 행 추가, 분할은 소유 에이전트 재개로 수행. ② bare 백틱 교차 산출물 오탐 2건
(재현 5회째 — 오탐 클래스로 §4 등록 검토 대상), 경로 한정 표기로 기계 수정. ③
search-results.md 절 초과는 verbatim 이동 분할(+INDEX 행). ④ performance-budget
9섹션은 Assumptions 푸터가 9번째 절로 집계된 것 — 헤딩 강등. 재검증으로 회수 확인.

#### 결함 8호 — design-preview-status-lib의 Phase 1 flat-only 요구 (4호의 하류 재현)

design-preview-builder(428.7k, 최대 스폰, 완결 반환)가 산출물 완성과 함께 보고:
`design-preview-status-lib.mjs`의 `SOURCE_INPUTS`가 `_workspace/01_plan/feature-plan.md`·
`ux-brief.md`를 flat 필수(required: true)로 요구하는데 두 산출물은 sharding 계약대로
디렉토리 형태다 — Phase 2 3종(design-system 등)에는 이미 있는 `(.md|/)` 그룹 폴백이
Phase 1 2종에는 없었다. **결함 4호(레지스트리 flat-only)의 하류 판박이** — 계약을 한 곳
고치면 소비자들이 차례로 드러난다. 실측: 수정 전 `validate-design-preview` INVALID
(missing input 오탐), 수정 후 DRAFT(errors 0)·source digest에 sharded 파일 정상 포함.
동일 관용구(그룹 필수 검사) 적용, delta 모드의 같은 클래스(DELTA_SOURCE_INPUTS
feature-plan.md flat 필수)는 미실측이라 관찰 대기로 남긴다.

(이후 기록은 파일럿 완료 시 append)
