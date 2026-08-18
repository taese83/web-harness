# Design Principles — 허브 (디자인 철학과 소비 맵)

web-harness가 생성하는 모든 화면에 적용되는 디자인 원칙 지식 베이스의 인덱스다. 리서치 근거(NN/g·Material 3·Apple HIG·Fluent·WCAG·Tufte·FT Visual Vocabulary 등)가 있는 실행 규칙만 담는다 — 취향이 아니라 근거로 결정한다.

## 철학 선언

> **좋은 디자인은 장식이 아니라 결정의 품질이다.** 간격 하나, 색 하나, 컨트롤 하나가 모두 "왜"에 답할 수 있어야 한다. 답은 이 지식 베이스의 규칙에서 찾고, 규칙에 없으면 관습(Jakob's Law)을 따르고, 관습도 없으면 발산 조사(`design-principles-research.md`)로 방향을 커밋해 `ASSUMPTION(시안 확정)`으로 두고 단일 시안 승인에서 확정한다.

디자인 결정이 충돌할 때의 우선순위 (상세: `design-principles-foundations.md`):

1. 작동하는가 (기능·이해가 미학에 우선)
2. 관습적인가 (이득 없이 관습을 깨지 않는다)
3. 위계가 맞는가 (강조는 화면당 1개)
4. 밀도가 사용자에 맞는가 (전문가·고빈도=밀도↑)
5. 디테일이 완결됐는가 (모든 상태 정의, scale 밖 임의 값 금지)
6. 그다음에 아름다운가

## 절 목록과 주 소비자

| 절 | 파일 | 담당 범위 | 주 소비자 |
|---|---|---|---|
| 철학 기초 | `design-principles-foundations.md` | Rams 10원칙, Swiss/Bauhaus, 시스템 3사 비교, 밀도 전략, Laws of UX | 전체 (모든 design·plan agent) |
| 간격·레이아웃 | `design-principles-spacing-layout.md` | 8pt scale, 터치 타깃, 패딩, 여백 위계, 밀도 수치, 그리드 | design-system-architect, layout-designer, component-designer, design-preview-builder |
| 색상 | `design-principles-color.md` | 팔레트 구성, 조화, OKLCH 스케일, semantic, 대비, 다크 모드 | design-system-architect |
| 타이포그래피 | `design-principles-typography.md` | 타입 스케일, line-height, 줄 길이, letter-spacing, 굵기, 정렬, 폰트 스택, 텍스트 색 | design-system-architect |
| 위계·액션 | `design-principles-hierarchy-actions.md` | 시각 위계 5도구, 스캐닝, 버튼 위계·배치, Fitts, CTA, 정렬, 파괴적 액션 | layout-designer, component-designer, design-preview-builder, design-reviewer |
| 내비게이션·IA | `design-principles-navigation-ia.md` | 내비 구조 선택, 메뉴 설계, 동선, 검색, 모바일 전환, 상태 표시 | ux-researcher, layout-designer |
| 인터랙션·컨트롤 | `design-principles-interaction-controls.md` | 컨트롤 선택 매트릭스, 폼, 피드백, 로딩, 모달/드로어, 모션, DnD, hover/focus | component-designer, ux-researcher, design-preview-builder |
| 데이터 시각화 | `design-principles-data-viz.md` | 차트 선택, Tufte, 색, 축·범례, 대시보드 구성, 숫자 표현, 실시간·상태 | component-designer, timeseries-architect, analytics-domain-architect, ux-researcher |
| 디자인 리서치 | `design-principles-research.md` | 발산 축 4종(동종·이종·트렌드·시스템 릴리스), recency 규칙, 상투 회피, 단일 시안 수렴 | ux-researcher, design-system-architect, planning-facilitator |

## 소비 규칙

- 각 agent는 위 표에서 자기가 주 소비자인 절만 읽는다 — 전체를 읽지 않는다 (`artifact-sharding-contract.md`의 소비자 읽기 프로토콜과 같은 원칙).
- **원칙은 기본값이지 강제 교체가 아니다**: 사용자의 명시적 브랜드 제약·참조 무드(`design-readiness-contract.md`의 디자인 방향)가 원칙과 충돌하면 사용자 결정이 이긴다. 단, 접근성 하한(대비 4.5:1/3:1, 터치 타깃, focus-visible, 색 단독 전달 금지)은 협상 불가.
- **existing-change에서는 기존 디자인 시스템이 이긴다**: 원칙을 이유로 기존 화면의 baseline을 재설계하지 않는다 (`minimal-change-contract.md`). 원칙은 신규 화면·신규 토큰 결정에만 기본값으로 적용한다.
- 산출물(design-system/layout-spec/component-spec)에 원칙과 다른 결정을 내릴 때는 그 절에 한 줄 근거를 남긴다 — "원칙 X 대신 Y: (이유)". design-reviewer가 이 근거 유무를 본다.
- 프리뷰(`design-preview-builder`)에서 스펙이 침묵하는 시각 세부(hover/focus 스타일, 모션 시간, 간격 단계)는 이 원칙의 기본값을 따른다 — 새 결정의 발명이 아니라 기본값 적용이다.

## design-reviewer 검토 연결

design-reviewer는 Phase 2 산출물을 이 지식 베이스와 대조해 다음을 본다 (픽셀 취향이 아니라 규칙 위반만):

- spacing이 token scale 밖의 임의 값을 쓰는가 (`spacing-layout`)
- 한 화면에 primary 강조가 2개 이상인가, 다이얼로그 버튼 순서가 화면마다 다른가 (`hierarchy-actions`)
- 대비·터치 타깃·색 단독 전달·focus-visible 하한 위반 (`color`, `spacing-layout`, `interaction-controls`)
- 컨트롤 선택이 매트릭스와 어긋나는가 — 예: 정확한 값 입력에 slider (`interaction-controls`)
- 차트 유형이 데이터 관계와 어긋나는가 — 예: 8개 범주 pie (`data-viz`)
- 위반이되 산출물에 근거 한 줄이 있으면 pass, 없으면 `NEEDS_DECISION`
