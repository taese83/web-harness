# tailwind-shadcn 레인 스타일링 계약

`UI_LANE: tailwind-shadcn` 프로젝트의 스타일 확장·프리미티브 vendoring 규칙.
mui-styling.md와 같은 형상 원칙("공개 API 우선, 내부 selector 금지, 테마는 루트 소유")을
이 레인의 어휘로 구체화한다. **명명 수준** — 실제 생성 프로젝트 fixture 검증 전이다.

## 스타일 확장 우선순위

1. **cva variant** — 프리미티브의 공개 스타일 축은 `class-variance-authority` variants로 선언한다.
   호출부가 임의 클래스를 덧붙이기 전에 variant 축을 먼저 확장한다.
2. **`className` + `cn()` 병합** — 호출부 조정은 `cn(baseVariants(...), className)` 순서로 병합한다
   (`tailwind-merge`가 뒤가 이기도록 정규화 — 순서를 바꾸면 호출부 override가 조용히 무시된다).
3. **금지** — generated class·substring selector 의존(mui 레인과 동일 원칙), 인라인 style로
   토큰 우회, `@apply` 남용(컴포넌트 밖 전역 CSS에 스타일 축적).

## 토큰 경계

- 토큰의 정본은 `src/app/style.css`의 `@theme` 블록(= CSS 변수)이다. design-system의
  `theme.code.css`에서 파생되며, feature-로컬 `@theme`·하드코딩 색상값을 만들지 않는다.
- 컴포넌트는 토큰 유틸리티(`bg-primary`, `rounded-md`)만 소비한다 — 임의 값(`bg-[#1976d2]`)은
  디자인 시스템 이탈이므로 design-system 갱신으로 해소한다.

## 프리미티브 vendoring 규칙

- 위치는 **`src/shared/ui/{primitive}/`** — shadcn CLI 기본 경로(`src/components/ui/`,
  `components.json`)는 이 하네스의 FSD 레이어 규칙·에이전트 소유권과 충돌하므로 CLI를 쓰지 않고
  수동 vendoring한다. `cn()`은 `src/shared/lib/utils.ts`(shared-foundation-builder 소유).
- 각 프리미티브는 `index.ts`에서 **명시 named export**만 한다(`export *` 금지 — fsd-rules).
- vendored 파일은 **upstream-파생물**이다: 스타일(클래스·variants)·구성은 자유롭게 바꾸되,
  **Radix가 공급하는 a11y 구조는 보존한다** — `aria-*`·`role` props, `Portal`, focus trap /
  roving tabindex 배선. 이탈이 필요하면 해당 줄에 한 줄 사유 주석을 남긴다.
  (근거: mui 레인은 a11y가 node_modules(불변)에 있지만 이 레인은 수정 가능한 repo 소스로
  이동한다 — 보존 규칙 없이는 I6 안전 하한이 조용히 약화된다.)

## 테마 소유

- `@theme`(토큰)·다크 모드 전략(`data-theme` 속성 또는 `prefers-color-scheme`)은 앱 루트
  (`src/app/style.css`) 단일 소유 — feature가 자체 토큰 팔레트를 만들지 않는다.
- 상태 전달은 색상 단독 금지: `:focus-visible` 링·error/success 의미론은 design-system의
  명세를 따른다(mui 레인과 동일 — 라이브러리 무관 원칙).

## 일반화 근거

- **어드민/대시보드 형태(mui 레인과 대비)**: 같은 형상 원칙(공개 API 우선·내부 selector 금지·
  테마 루트 소유·상태 5종 구현)이 mui-styling.md에서는 slot/sx/theme 어휘로, 이 문서에서는
  cva/cn/@theme 어휘로 성립 — 원칙이 라이브러리 2개에서 독립적으로 표현됨을 두 문서가 상호
  증명한다.
- **브랜드-포워드 소비자 제품 형태**: 헤드리스 프리미티브 + 토큰-유틸리티 조합은 디자인 시스템
  전면 제어가 요구되는 형태(랜딩·소비자 앱)에서 성립 — lib-catalog §UI의 레인 판단 축이 이
  형태를 이 레인으로 라우팅한다.
- 검증 상태: 명명 수준 — 실제 생성 프로젝트 2형태 fixture 검증은 eval-covered 승격 시(§b tier).
