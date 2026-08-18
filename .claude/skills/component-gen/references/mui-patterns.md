# Component Pattern Index

컴포넌트를 만들기 전에 `tech-stack.md`의 `UI_LANE`을 확인하고 작업 유형에 맞는 reference만
선택한다. 모든 세부 문서를 한꺼번에 읽지 않는다. (파일명의 "mui"는 역사적 — 이 인덱스는
두 레인 공용이다.)

## Reference map

- `mui-styling.md` (UI_LANE: mui): `sx`, slot API, theme override, form binding, loading state, SVG
- `tailwind-shadcn-styling.md` (UI_LANE: tailwind-shadcn): cva variants, `cn()` 병합, `@theme` 토큰, vendoring·a11y 보존
- `input-focus-ime.md` (레인 공용): CJK IME, Enter 처리, Menu/Popover focus, URL 검색 상태
- `responsive-layout.md` (레인 공용 — 예시는 MUI): 구조적 breakpoint, AppBar, tabs, grid, transform clipping
- `accessibility.md` (레인 공용): semantic element, keyboard/focus, form error, status, dialog, contrast
- `ts-conventions.md` (레인 공용): strict TypeScript와 public props/export 규칙

## 공통 금지 (레인 무관)

- 생성된 hash class(Emotion·Tailwind JIT 무관) 또는 `[class*="..."]` substring selector에 의존하지 않는다.
- 문서화되지 않은 내부 DOM 구조를 styling contract로 사용하지 않는다.
- `!important`로 cascade 문제를 숨기지 않는다.
- clickable `div`를 native button/link 대신 사용하지 않는다.
- IME 조합 중 Enter 제출이나 URL 상태 commit을 실행하지 않는다.

## MUI 레인 한정 금지

- `<Box data-*={x}>` 로 DOM attribute를 스크롤 타겟 식별에 사용하지 않는다 — MUI 버전에 따라 실제 DOM에 붙지 않을 수 있다. 스크롤 타겟은 `id` 또는 `ref`를 사용한다.

## 선택 원칙

1. style이나 라이브러리 wrapper면 레인의 styling 문서(`mui-styling.md` 또는 `tailwind-shadcn-styling.md`)
2. text input, keyboard, menu focus가 있으면 `input-focus-ime.md`
3. 모바일 구조 또는 grid/scale 효과가 있으면 `responsive-layout.md`
4. 사용자 interaction이 있으면 `accessibility.md`
5. 모든 TypeScript 컴포넌트는 `ts-conventions.md`
