# Design System — Grainhouse

승인 렌더(`_workspace/02_design/approved-render.html`, 접수 현황 화면)에서 추출·정규화한
디자인 시스템이다. 발산은 종료됐다 — 이 문서는 새 방향을 제안하지 않고, 승인된 화면 1장을
아직 그려지지 않은 화면(스캔 보관함·새 롤 접수 폼·가격 안내·계정)으로 확장하는 **생성 규칙**을
명문화한다. UI_LANE: `tailwind-shadcn` (토큰 = CSS 변수 `@theme`).

## 절 목록

| 절 | 파일 | 담당 범위 | 주 소비자 |
|---|---|---|---|
| 생성 원리 | `principles.md` | 5개 원리 — 값이 없을 때의 결정 근거, 우선순위 | 전체 |
| 토큰 | `tokens.md` | 색·타입·간격·형태·모션 토큰, 정규화 기록, 서체 3분할 계약, 일회성 판단 기준 | layout-designer, component-designer, design-preview-builder, app-shell-builder |
| 테마 코드 | `theme.code.css` | `@font-face` + `@theme` 전문 — Phase 3에서 `src/app/style.css`로 생성 | app-shell-builder |
| 컴포넌트 인벤토리 | `components.md` | 렌더에 있는 것 / 원리에서 파생한 것(폼·상태·모달 등) 구분 명세 | component-designer, design-preview-builder |
| 접근성 계약 | `accessibility.md` | 대비 계산표, 기능 보더 이중 배경 규칙, focus·타깃·모션·forced-colors, 다크 모드 결정 | design-reviewer, component-designer |

## 전역 결정

- **정본은 승인 렌더다.** 원칙 기본값과 다른 값은 렌더가 이긴다(접근성 하한 제외).
  차이는 각 절에 "원칙 X 대신 Y: 이유"로 기록했다.
- 기각 방향과 이유는 `_workspace/01_plan/ux-brief.md` §디자인 방향에 기록되어 있다
  (라이트 테이블·특성곡선 플롯·다크 계기반 원안). 여기서 재발산하지 않는다.
- 다크 모드는 제공하지 않는다 — 근거는 `accessibility.md` §다크 모드.
- 렌더의 8pt 격자 밖 값(17·30·34·14.5px 등)은 토큰 스케일로 정규화했다(시각 차 1~2px,
  밀도 인상 유지). 기록은 `tokens.md` §정규화.

## Assumptions and Blockers

- ASSUMPTION: semantic 색(error/success/warning)은 승인 렌더에 없어 원리에서 파생했다 —
  대비는 계산으로 확보했으나 실화면 승인은 미완.
- ASSUMPTION: `@font-face`의 Noto Serif KR woff2 URL은 렌더가 참조한 Google Fonts 배포본이다.
  Phase 3에서 self-host로 교체 가능하나 `unicode-range` 계약은 유지해야 한다.
