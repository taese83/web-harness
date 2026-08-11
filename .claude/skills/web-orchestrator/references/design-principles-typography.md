# Design Principles — Typography (타이포그래피)

타입 스케일·크기·행간·자간·정렬·폰트 스택·텍스트 색의 수치 규칙이다.

## 타입 스케일

- **비율은 매체 성격으로 선택** — UI/데이터 밀집은 1.2(minor third), 마케팅/에디토리얼은 1.25(major third) 이상. 비율이 클수록 대비가 극적(히어로용), 작을수록 촘촘(여러 위계 공존하는 UI용).
- **수학적 비율을 그대로 쓰지 말고 4px 격자에 반올림한 실용 스케일**: `12 / 14 / 16 / 20 / 24 / 32 (/ 40 / 48)`. M3·Carbon·Polaris가 모두 이 계열로 수렴. 순수 비율 값(25.6px)은 line-height·spacing 격자와 어긋난다.
- **역할 기반 3계층**: display(≥32px, 히어로) / heading·title(16~28px) / body·label(11~16px). 시작은 3단계면 충분 — 단계가 많을수록 오용이 늘어난다 (NN/g).

## 크기

- **본문 기본 16px. 줄이지 말 것** — 브라우저 기본값 존중, NN/g 데스크톱 최적값 ≈16px, iOS Safari는 input이 16px 미만이면 포커스 시 강제 줌. `rem` 사용으로 사용자 설정 승계.
- **13~14px은 "데이터 밀집 + 짧은 라벨 + 스캔 목적" 3조건 충족 시만** — 테이블 셀·폼 라벨·메타데이터. 그 안의 설명 문단은 다시 16px로 복귀. (Carbon body-compact-01=14px, GitHub Primer 14px 관례)
- **절대 하한: 11px 미만 금지, 캡션·법적 고지는 12px 이상** (NN/g, M3 Label Small 11px).

## Line-height

- **본문 1.5** (16px → 24px) — WCAG 1.4.8. 문단 간격은 줄 간격의 1.5배.
- **크기와 반비례** — 본문 1.5 → 소제목 1.3 → 대제목 1.2 → display 1.1~1.15. 큰 글자에 1.5를 유지하면 두 줄 제목이 한 덩어리로 읽히지 않는다. (M3: Body 16/24, Headline 32/40, Display 57/64)
- **단위 없는 값으로 지정** (`line-height: 1.5`, not `24px`) — 상속 시 배율로 재계산되어 안전.

## 줄 길이 (Measure)

- **영문 45~75자(이상적 66자), CJK는 최대 40자 전후** — 80자 초과 시 줄 되돌아가기 실패로 읽기 속도 급락 (NN/g, WCAG 1.4.8).
- **넓은 화면에서 텍스트 컬럼 max-width 필수** — 컨테이너가 아니라 텍스트 블록에 건다: `article p { max-width: 65ch }`, 한글 본문은 `max-width: 36em` 감각.

## Letter-spacing

- **크기별 부호가 바뀐다** — 큰 제목(≥24px) 음수 -0.01~-0.02em, 본문(14~16px) 0, 작은 텍스트(≤12px) 약한 양수. 폰트는 본문 크기 기준으로 설계되어 확대하면 벌어져 보이고 축소하면 붙어 보인다.
- **ALL CAPS 라벨은 +0.05~0.12em 필수** — 대문자 나열은 형태 변별력이 떨어져 자간으로 보상 (Butterick). 예: overline 라벨 `text-transform: uppercase; letter-spacing: 0.08em`.
- **한글은 0 또는 약한 음수(-0.01~-0.02em)까지만. Pretendard에는 추가 자간 금지** — 자간 보정이 폰트에 내장되어 있다. 한글에 양수 자간은 단어 경계를 흐려 금지.

## 폰트 굵기 위계

- **4단계면 충분**: 400(본문) / 500(UI 라벨·버튼) / 600(섹션·카드 제목) / 700(페이지 제목·strong). M3는 400/500 두 굵기로 전체 스케일 구성.
- **같은 크기에서는 굵기만으로 위계** (14px 400 vs 14px 600) — 데이터 밀집 UI에서 크기를 늘리면 행 높이가 무너진다. 단 인접 위계는 2단계 차(400→600)가 안전 — 1단계 차는 저해상도에서 소실.
- **300(Light) 이하는 18px 미만 금지, 본문 700 남용 금지** — 가는 획은 저해상도에서 뭉개진다.

## 정렬

- **기본은 왼쪽 정렬 + ragged right. `text-align: justify` 금지** — 시선이 매 줄 같은 x좌표로 복귀. 양쪽 정렬은 웹에서 'rivers' 발생 (WCAG 1.4.8 AAA도 금지).
- **가운데 정렬은 "3줄 이하 + 독립 블록"만** — 히어로 제목, empty state, 다이얼로그 안내문. 좌정렬 본문과 같은 컬럼에 섞지 않는다.
- **숫자 컬럼은 오른쪽 정렬 + `font-variant-numeric: tabular-nums`** — 자릿수 비교는 일의 자리 정렬이 전제. 컬럼 헤더는 데이터 정렬을 따른다. 테이블·가격·타이머에만 적용 (본문 숫자는 proportional).

## 폰트 스택과 로딩

- **한글 서비스 표준 스택**: `"Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif`.
- **UI 전용·사내 도구는 `system-ui, sans-serif`로 충분** — 한글 웹폰트 풀셋은 수 MB. 브랜드 노출 화면만 웹폰트.
- **웹폰트를 쓸 때**: 가변 폰트 + dynamic subset woff2, `font-display: swap`, 본문 폰트만 preload, 폴백에 `size-adjust`/`ascent-override`로 metrics 매칭(CLS 방지).

## 텍스트 색

- **순수 검정 `#000` 금지** — 흰 배경 + 순흑은 대비 21:1로 halation(시각 피로) 유발. 진회색 `#1a1a1a`~`#333` 계열. (GitHub `#1f2328`, Material `rgba(0,0,0,.87)`)
- **위계는 3단계 투명도 관례**: primary 87~100% / secondary 60% / disabled 38% (Material). 투명도 방식은 유색 배경 위에서도 자동 조화.
- **어떤 위계든 WCAG 하한 준수** — 일반 텍스트 4.5:1, 18px+ 또는 14px bold는 3:1. disabled만 예외. 흰 배경 위 4.5:1의 실용 하한은 `#767676`.

## 요약 치트시트 (16px 기준)

| 역할 | size / line-height | weight | letter-spacing |
|---|---|---|---|
| Display | 40~57 / 1.1 | 700 | -0.02em |
| H1 | 32 / 1.2 | 700 | -0.02em |
| H2 | 24 / 1.25 | 600 | -0.01em |
| H3 | 20 / 1.3 | 600 | 0 |
| Body | 16 / 1.5 | 400 | 0 (한글 0~-0.01em) |
| Body-compact | 14 / 1.45 | 400 | 0 |
| Caption | 12 / 1.35 | 400 | +0.02em |
| Overline(caps) | 11~12 / 1.3 | 500 | +0.08em |

+ 본문 `max-width: 65ch`(한글 ≈36em) · 숫자 테이블 우측 정렬 + tabular-nums · 텍스트 색 `#1a1a1a` / 60% / 38%.

## 출처

Material 3 type scale tokens · Apple HIG Typography · Butterick's Practical Typography · WCAG 1.4.8/1.4.3 · NN/g font size 연구 · Pretendard 공식 저장소 · A List Apart "Web Typography: Tables"
