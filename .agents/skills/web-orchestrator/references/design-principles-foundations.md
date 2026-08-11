# Design Principles — Foundations (디자인 철학 기초)

모든 디자인 결정의 사상적 기반이다. 개별 수치 규칙(간격·색·타이포 등)은 각 `design-principles-*.md`가 담당하고, 이 문서는 **왜 그렇게 결정하는가**의 판단 틀을 제공한다.

## 결정 우선순위 (충돌 시 이 순서로 판단)

1. **작동하는가** — 기능·이해 가능성이 미학에 우선한다 (Useful / Understandable)
2. **관습적인가** — 특별한 이득 없이 관습을 깨지 않는다 (Jakob's Law / Consistency)
3. **위계가 맞는가** — 중요한 것이 시각적으로 지배적인가. 강조는 화면당 1개
4. **밀도가 사용자에 맞는가** — 전문가·고빈도=밀도↑, 신규·저빈도=밀도↓
5. **디테일이 완결됐는가** — 모든 상태(hover/focus/disabled/empty/error/loading) 정의, 토큰 scale 밖 임의 값 금지 (Thorough)
6. **그다음에 아름다운가** — 앞 5개를 통과한 뒤의 미학이 진짜 미학 (Aesthetic-Usability)

## Dieter Rams 10원칙 → 웹 UI 번역

| # | 원칙 | 웹 UI 규칙 |
|---|------|-----------|
| 1 | Innovative | 신기술·효과는 사용자 문제를 풀 때만. "새로워 보이려고" 넣지 않는다 |
| 2 | Useful | 각 요소에 "없으면 뭘 못 하나?"를 물어 답이 없으면 제거한다 |
| 3 | Aesthetic | 미적 품질은 장식이 아니라 사용성의 일부 — 일관된 spacing scale과 정렬 자체가 신뢰를 만든다 |
| 4 | Understandable | 자기설명적 UI — 버튼은 버튼처럼(affordance), 아이콘 단독이면 label 병기, 첫 화면 3초 안에 목적 파악 |
| 5 | Unobtrusive | chrome(내비·툴바)은 중립색, 색·대비는 콘텐츠와 핵심 액션에 집중한다 |
| 6 | Honest | 가짜 progress·dark pattern 금지. 로딩·상태 표시는 실제 상태를 반영한다 |
| 7 | Long-lasting | 유행 효과보다 검증된 패턴. 토큰 기반으로 만들어 스타일 교체가 가능하게 한다 |
| 8 | Thorough | 모든 상태를 정의하고 "대충 이쯤" spacing을 금지한다 — scale에서만 선택 |
| 9 | Environmentally-friendly | 성능이 웹의 환경 원칙 — 이미지 최적화, 번들 예산, 불필요한 리렌더 제거 |
| 10 | As little as possible | "Less, but better"는 기능 삭제가 아니라 위계 정리다. 핵심 action 1개를 지배적이게, 나머지는 후퇴 |

## Bauhaus / Swiss Style이 남긴 실행 규칙

- **그리드가 질서를, 비대칭이 에너지를 만든다** — 모든 레이아웃을 그리드에 정렬하되 좌우 대칭 센터링만 반복하지 않는다 (예: hero 텍스트 7col + 이미지 5col).
- **타이포그래피가 첫 번째 UI다** — 콘텐츠의 95%는 텍스트. type scale로 위계를 구축하고, 색·굵기·크기 중 2가지 이하 조합으로 레벨을 구분한다.
- **형태는 기능을 따른다** — shadow는 layering 표현에만(모달 > 드롭다운 > 카드), 색은 semantic하게, radius는 계층별 일관 값.
- **여백은 낭비가 아니라 그룹핑 도구다** — 관련 요소 간격 < 무관 요소 간격 (Law of Proximity). 구분선보다 여백으로 먼저 분리를 시도한다.

## 디자인 시스템 3대 철학과 공통 불변 원칙

| | Material 3 (Google) | HIG (Apple) | Fluent 2 (Microsoft) |
|---|---|---|---|
| 핵심 가치 | Personal·Adaptive·Expressive | Hierarchy·Harmony·Consistency | Built for focus·포용성 |
| 강점 영역 | 컨슈머 앱, 브랜드 차별화 | 콘텐츠 몰입형, 미디어 | B2B·생산성 도구 |

서비스 성격에 따라 기본 태도를 고른다: 컨슈머·감성 → M3식 expressive / 콘텐츠·미디어 → HIG식 deference / B2B 도구 → Fluent식 focus. 어떤 태도를 골라도 다음 5개는 협상 불가:

1. **위계** — 중요도가 시각적 무게(크기·대비·위치)에 반영될 것
2. **일관성** — 같은 의미는 같은 모습으로, 플랫폼 관습 존중
3. **접근성** — 대비 4.5:1, 터치 타깃 44pt/48dp, 키보드 내비게이션
4. **적응성** — 화면 크기·light/dark 테마·입력 방식에 반응
5. **토큰 기반** — 색·타이포·간격을 토큰으로 추상화해 일관성을 구조적으로 강제

## 미니멀리즘 vs 정보 밀도 — 밀도는 정보 전략이다

밀도는 스타일이 아니라 **사용자 숙련도 × 사용 빈도**로 결정한다 (NN/g Complex Application Design):

- **컨슈머 / 저빈도 / 신규** → 낮은 밀도: 화면당 핵심 action 1개, 넓은 여백, 단계적 온보딩
- **B2B 대시보드 / 고빈도 / 전문가** → 높은 밀도: 한 화면에 컨텍스트+데이터+액션 동시 노출, 내비 왕복 최소화. 메뉴 뒤에 숨긴 기능은 속도의 장벽이다
- **운영(operational) 대시보드** → 밀도 높게 / **경영(executive) 대시보드** → 핵심 지표만 여백 있게

규칙:
- **밀도를 높일수록 위계를 더 강하게** — 밀집 UI의 실패 원인은 정보량이 아니라 위계 부재. 밀집 테이블은 행 높이 축소보다 타이포 위계(tabular-nums, 보조정보 저대비)·정렬 일관성·상태 신호에만 색 사용으로 해결한다.
- **기능을 줄이지 말고 클러터를 줄여라** — staged disclosure: 고급 옵션은 관련 항목 활성화 후 노출. 삭제가 아니라 지연 노출.
- **Tesler's Law** — 복잡성 총량은 보존된다. UI에서 숨기면 사용자의 머리(기억·추측)로 이동한다. 전문가 도구에서는 UI가 복잡성을 드러내는 것이 친절이다.

## Laws of UX 실전 적용표

| 법칙 | 정의 | 설계 적용 |
|------|-----|----------|
| Jakob's Law | 사용자는 다른 서비스에서 익힌 방식대로 기대 | 로고=좌상단 홈링크, 검색=상단, 관습 파괴는 명확한 이득이 있을 때만 |
| Hick's Law | 선택지 수에 비례해 결정 시간 증가 | 내비 항목 5~7개 이하, 추천 옵션 기본 선택, 다단계 폼 분할. 파괴적 작업 앞엔 오히려 마찰 추가 |
| Fitts's Law | 도달 시간 = 거리 ÷ 크기 | 주요 CTA는 크게 + 동선 가까이, 터치 타깃 최소 44px, 위험 버튼은 주 버튼에서 분리 |
| Miller's Law | 작업 기억 7±2 | 번호 chunking, 긴 폼 섹션화. "메뉴 7개 제한"으로 오용하지 말 것 — 핵심은 chunking |
| Tesler's Law | 복잡성은 이전만 가능 | 자동완성·스마트 기본값으로 시스템이 부담. 과한 추상화엔 고급 모드 제공 |
| Aesthetic-Usability | 아름다우면 쉽다고 인지 | 정돈된 시각 품질이 관용을 만든다. 단, 예쁜 UI가 테스트에서 문제를 가릴 수 있음 |
| Peak-End Rule | 최고점과 종료 시점이 평가를 결정 | 성공 화면에 정성 투자, 에러는 복구 경로와 함께, 온보딩 마지막에 성취감 |
| Doherty Threshold | 응답 400ms 이내에 생산성 급상승 | 400ms 초과 시 skeleton/progress, optimistic update, 즉각 피드백 후 백그라운드 처리 |
| Law of Proximity | 가까운 것은 한 그룹 | label은 해당 input에 붙이고 다음 필드와 띄움. 그룹 내 8px < 그룹 간 24px 식 비율 유지 |
| Law of Common Region | 경계 안은 그룹 | 카드·배경·border로 묶되 남용 금지 — 여백으로 안 될 때만 경계 사용 |
| Law of Similarity | 비슷하면 같은 기능으로 인지 | 링크 스타일 통일, 클릭 불가 요소에 버튼 모양 금지 |
| Von Restorff Effect | 다른 하나가 기억된다 | 화면당 시각 강조 1개(primary CTA). 모두 강조 = 강조 없음 |
| Serial Position Effect | 처음과 끝이 기억된다 | 내비에서 가장 중요한 항목을 맨 앞·맨 뒤에 |
| Goal-Gradient Effect | 목표에 가까울수록 동기 상승 | 진행 표시 시작점 미리 채움, 남은 단계 명시 |
| Zeigarnik Effect | 미완료가 기억에 남는다 | 완성도 %, "이어서 하기" 유도 |
| Paradox of Active User | 매뉴얼을 읽지 않는다 | 기본값을 최선으로, 첫 사용에서 문서 없이 성공하는 경로, 학습은 in-context로 |

## 출처

Vitsoe(Rams 원문) · Laws of UX (Jon Yablonski) · NN/g Complex Application Design / Information Density · Material Design 3 · Apple HIG · Fluent 2 · International Typographic Style 문헌
