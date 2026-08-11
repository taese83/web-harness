# Deterministic Render Matrix

## Required axes

기본 matrix:

| Axis | Required baseline |
|---|---|
| Browser | pinned Chromium |
| Reflow | 320 CSS px, 400% zoom equivalent |
| Desktop | contract의 대표 desktop viewport |
| DPR | fixed value, default 1 |
| Locale | product default와 layout-risk locale |
| Timezone | fixed IANA timezone |
| Theme | supported light/dark/high-contrast 중 적용 대상 |
| Motion | reduced-motion과 animation-disabled capture |
| Data | deterministic MSW/local fixture |

Cartesian product 전체를 생성하지 않는다. critical route와 brand component는 넓게, 일반 화면은 대표 mode만 선택한다.

## Stabilization

각 capture 전에 다음을 보장한다.

1. navigation과 required network fixture 완료
2. `document.fonts.ready`
3. clock/date/random과 locale/timezone 고정
4. caret, transition, animation, blinking cursor 비활성
5. image dimension과 lazy content 안정화
6. loading state를 검증하는 target이 아니면 loading 종료

`stylePath`와 mask는 volatile third-party 영역처럼 구조적으로 불가피한 경우만 사용한다. target의 핵심 내용, focus, error, price, chart, action을 숨기지 않는다.

## Non-pixel assertions

Screenshot과 함께 다음을 적용한다.

- WCAG 2.2 Reflow: 320 CSS px에서 비예외 영역의 양방향 scroll과 기능 손실 없음
- sticky/fixed UI가 keyboard focus를 완전히 가리지 않음
- pointer target 24×24 CSS px 또는 공식 spacing/inline 예외
- focus, accessible name, keyboard activation, axe
- layout shift: contract의 CLS budget, 기본 상한 0.1
- font fallback과 missing glyph 없음

## Cross-browser

Firefox/WebKit 또는 Chromatic cloud matrix는 critical route, typography/brand-critical component, browser-specific CSS에만 사용한다. 외부 서비스는 화면·DOM·asset 전송 승인을 먼저 받는다.

