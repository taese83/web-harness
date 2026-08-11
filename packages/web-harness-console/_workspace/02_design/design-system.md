# Design System — Web Harness Console

## Tokens

- font: `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
- type: 12/14/16/20/24/32px; body document 16/1.6, compact UI 14/1.45
- space: 4/8/12/16/24/32/48/64px
- radius: 8px control, 12px panel, 16px prominent card
- background: `#f3f5f8`; surface: `#ffffff`; surface-subtle: `#f8fafc`
- text: `#172033`; muted: `#526078`; border: `#c7cfdb`
- primary: `#175cd3`; primary-hover: `#1849a9`; focus: `#1570ef`
- success: `#067647`; warning: `#93370d`; error: `#b42318`; info: `#175cd3`

## Component Style

- Sidebar item: 40px min-height, selected background + left indicator + `aria-current`
- Status chip: icon/dot + uppercase text; color-only 금지
- Panel: 1px border, 12px radius, shadow는 preview frame 같은 실제 layering에만 사용
- Primary action: Refresh 하나만 filled; tabs/document/project rows는 neutral controls
- Focus: 2px primary ring, 2px offset

## Accessibility

- 일반 텍스트 4.5:1, UI boundary/focus 3:1
- 실제 button/nav/section/iframe title 사용
- `prefers-reduced-motion`에서 transform transition 제거
- 문서 본문 최대 72ch, source code는 horizontal scroll
