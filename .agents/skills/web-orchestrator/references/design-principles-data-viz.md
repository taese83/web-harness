# Design Principles — Data Visualization (차트·대시보드)

차트 유형 선택, Tufte 원칙, 색 사용, 축·라벨·범례, 대시보드 구성, 숫자 표현, 인터랙션, 상태 표현의 규칙이다.

## 차트 유형 선택 매트릭스 (FT Visual Vocabulary)

| 데이터 관계 | 1순위 | 대안 | 금지/주의 |
|---|---|---|---|
| 시계열 추이 | line | area(누적량), column(기간 적을 때) | dual-axis 주의(인과 오해) |
| 범주 크기 비교 | bar | lollipop, dot plot | 3D·radar로 크기 비교 금지 |
| 구성비 | stacked bar / 100% stacked | treemap(항목 많을 때), donut | pie는 조건부(아래) |
| 분포 | histogram | boxplot(그룹 비교) | bin 간격은 좁게 |
| 상관 | scatter | bubble(3변수), XY heatmap | 상관≠인과 주석 |
| 순위·순위 변화 | ordered bar / slope | bump chart(다기간) | 정렬 안 된 bar 금지 |
| 기준 대비 편차 | diverging bar | surplus/deficit line | 기준선(0/목표) 명시 |
| 흐름·전환 | sankey | waterfall(증감 분해) | 단계 5개 이하 |

- **범주 라벨이 길거나 7개+ 이면 세로 column 대신 가로 bar** — 라벨 회전 없이 읽히고 스캔이 빠르다. 값 내림차순 정렬.
- **pie/donut은 "항목 2~5개 + 합 100% + 정확 비교가 목적 아님"일 때만** — 각도·면적 비교는 길이 비교보다 부정확. 2항목 성공/실패 donut은 허용, 8개 점유율은 bar로.
- **정렬 기준 명시** — 순위면 값 내림차순, 시간이면 시간순, 고정 순서(요일)면 그 순서. 정렬 자체가 메시지다.

## Tufte 원칙

- **data-ink ratio 최대화** — 배경색·테두리·3D·그림자·아이콘 장식 제거 (chartjunk). gridline만 연하게 유지.
- **lie factor ≈ 1** — 그래픽 효과 크기 = 데이터 효과 크기.
  - **bar/column: y축 0 시작 필수** (길이 인코딩 — 잘리면 왜곡).
  - **line: 0 시작 예외 허용** (위치·기울기 인코딩) — 미세 변동이 중요한 경우에 한정, 축 라벨 명확히.
- **선 8개를 한 차트에 겹치지 말고 small multiples** — 동일 scale·axes의 작은 차트 그리드 (예: 리전 6개 → 2×3 그리드, y축 범위 통일).

## 색 사용

- **범주형 색은 6~8개가 한계** — 넘으면 차트 유형을 바꾸거나 상위 5개 + "기타"로 그룹.
- **팔레트 선택**: 순서 없는 범주 = categorical(다른 hue) / 낮음→높음 = sequential(한 hue 밝기 단계) / 의미 있는 중간점(0·목표) = diverging. 색 구조가 데이터 구조를 인코딩해야 한다. 예: CPU 사용률 heatmap = sequential, 전월 대비 증감 = diverging.
- **강조 1색 + 나머지 회색** — 우리 서비스 선만 브랜드 색, 비교 대상 7개는 `#d0d0d0`.
- **색맹 안전** — Okabe-Ito 팔레트(`#E69F00 #56B4E9 #009E73 #F0E442 #0072B2 #D55E00 #CC79A7 #000000`) 기본, hue뿐 아니라 밝기 차이 병행(흑백에서도 구분).
- **색만으로 의미 전달 금지** — 라벨·모양·패턴 병행 (WCAG).
- **같은 의미 = 같은 색을 대시보드 전체에서 유지** — "iOS"가 A 차트에서 파랑이면 모든 차트에서 파랑.

## 축·라벨·범례

- **범례보다 직접 라벨링 우선** — 선 오른쪽 끝에 시리즈명. 범례↔차트 시선 왕복 제거. 범례는 시리즈 5개+ 일 때만, 순서는 데이터 순서(마지막 값 크기순/스택 순서)와 일치.
- **축 눈금 4~6개** — nice number(0, 25, 50…)로 반올림.
- **단위는 축 제목 또는 최상단 눈금에 한 번만** (예: "매출 (억원)", 마지막 눈금만 "40%").
- **x축 라벨 회전(45°/90°) 금지** — 필요하면 가로 bar로 전환하거나 라벨 축약.
- **gridline은 연한 회색(`#e0e0e0` 수준) 최소 개수, 축선은 생략 가능** — 데이터보다 튀면 안 된다.

## 대시보드 구성

- **한 화면 원칙** — 핵심 정보는 스크롤 없이. 대시보드의 가치는 한눈 비교(simultaneity)이며 스크롤이 이를 파괴한다 (Few). 상세 테이블은 드릴다운 뒤로.
- **가장 중요한 지표는 좌상단** — F-패턴 스캐닝.
- **KPI 카드(big number) + 추이 sparkline 조합** — 숫자로 현재 상태 즉시 판단 + 차트로 맥락. 숫자만 있으면 좋은지 나쁜지 모른다 (Few "inadequate context"). 예: "99.2% uptime ▼0.3%p" + 30일 sparkline.
- **5초 규칙** — 열자마자 5초 안에 "정상/문제" 판단 가능해야. 임계치 초과 지표만 색으로 강조, 나머지는 무채색.
- **한 화면 차트 수 5~9개(KPI 카드 제외)** — 넘으면 focused dashboard로 분리.
- **차트 크기 = 정보 위계** — 핵심 차트 2배 크게, 보조는 작게.
- **차트 유형을 다양하게 쓰려 하지 않는다** — 같은 성격의 데이터는 같은 차트로. "meaningless variety"는 학습 비용만 추가 (Few).
- **구조는 Shneiderman mantra**: Overview first(상단 KPI) → zoom and filter(중단 추이/비교) → details-on-demand(클릭 시 상세).

## 숫자 표현

- **큰 수 축약** — 1,234,567 → 1.2M / 123.5만(한국어). 원본값은 tooltip에.
- **소수점 자리는 지표 단위별 고정** — 비율 1자리(99.2%), 통화 0자리. 같은 카드 그룹 안 혼용 금지.
- **변화율은 3중 인코딩** — 방향 기호(▲/▼) + 색 + 숫자. 색 의미는 도메인 확인(에러율은 증가=빨강).
- **숫자 컬럼·KPI는 `font-variant-numeric: tabular-nums` + 우측 정렬** — 실시간 갱신 시 흔들림 방지.

## 인터랙션

- **tooltip은 details-on-demand** — 화면에는 요약, 정확값·부가 차원은 tooltip에. 다중 시리즈 line은 shared tooltip(x축 기준 전 시리즈) + 색 스와치 + 본문과 동일한 숫자 포맷.
- **hover는 해당 시리즈 강조 + 나머지 dim(opacity 0.2~0.3), 색 변경 금지** — 색이 바뀌면 의미 매핑이 깨진다.
- **zoom/brush는 포인트가 화면 픽셀보다 많을 때만** (수천 포인트 시계열). 기본 뷰는 전체 범위 + brush 구간 선택.
- **드릴다운은 계층 명시** — 클릭 가능 요소에 hover affordance, 진입 후 breadcrumb 복귀 경로.
- **실시간 차트** — y축 domain 고정 또는 히스테리시스(여유 범위 내 변동은 축 유지), 시간 window 고정(최근 5분), 새 포인트는 오른쪽 slide-in. 매 tick 축 재계산으로 덜컥거리면 변화를 읽을 수 없다. "Updated 3s ago" 신선도 표기.

## 빈/로딩/에러 상태

- **로딩은 차트 모양 스켈레톤** (축 자리 + 실루엣 pulse) — 스피너 단독 금지. 카드 크기는 로드 전후 동일(CLS 방지).
- **"데이터 없음"은 0과 구분** — 빈 영역에 "이 기간에 데이터가 없습니다" + 해결 액션(기간 변경·필터 해제). 0을 그리면 거짓 데이터다.
- **부분 결측(gap)은 line을 끊어서 표시** (null → 선 단절, 필요 시 점선 + "누락 구간" 주석). **결측을 0으로 그리지 않는다** — 급락으로 오독된다.
- **에러는 실패한 차트 카드 안에서만** — 메시지 + "다시 시도" + 마지막 성공 데이터가 있으면 "N분 전 데이터" 라벨로 유지. 부분 실패가 전체 모니터링을 막으면 안 된다.

## 출처

FT Visual Vocabulary · Stephen Few "Common Pitfalls in Dashboard Design" · Tufte "The Visual Display of Quantitative Information" · Datawrapper 색상 가이드 · Material data viz accessibility · Observable 대시보드 팁 · Shneiderman mantra
