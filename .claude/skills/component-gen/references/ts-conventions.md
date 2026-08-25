# TypeScript Conventions

React·TypeScript 코드를 생성하기 전에 읽는다. 근거·미결 항목은 `docs/js-ts-convention-research.md`.
포매팅 정본은 생성된 `.prettierrc`(세미콜론 없음·singleQuote·`bracketSpacing: false`·printWidth 120).

## 타입 선언

- **`type` vs `interface`**: 슬라이스 public API로 내보내는 계약(옵션 객체·도메인 엔티티)은
  `interface`, **컴포넌트 props와 유니온/교차/매핑/조건부는 `type`**. props가 예외인 이유는
  `ComponentProps<'button'>` 같은 React 유틸리티 타입과의 조합이 잦기 때문이다.
- **`enum`·`const enum` 금지** — `isolatedModules`+Vite에서 삭제 불가 구문이다. `as const` 객체와
  파생 union을 쓴다:
  ```ts
  const Status = {Idle: 'idle', Loading: 'loading', Failed: 'failed'} as const
  type Status = (typeof Status)[keyof typeof Status]
  ```
- **`any` 금지** — `unknown`·제네릭·좁은 도메인 타입으로 대체한다.
- **`satisfies`를 `as`보다 우선**한다. 설정 객체(TanStack Query `queryOptions`, Zustand creator,
  라우트 정의)는 `satisfies`로 검증하되 리터럴 타입 폭을 유지한다. 컴파일 타임 전용이므로
  런타임 검증(Zod 등)을 대체하지 않는다.
- **반환 타입**: 내부 함수는 추론에 맡기고 **슬라이스 public API로 내보내는 함수만** 명시한다.
- **불변성**: 함수 파라미터로 받는 배열·객체는 `readonly`/`ReadonlyArray`, 도메인 상수는
  `as const`. `readonly`는 얕고 런타임 강제가 아니다(중첩까지 막지 않는다).

## import·export

- 타입 전용 import는 **`import type {X} from '...'` 분리 구문**을 쓴다(인라인 `{type X}` 아님).
  tsconfig `verbatimModuleSyntax`가 이를 강제한다.
- **barrel(`index.ts`)은 슬라이스 경계에만** 둔다(FSD public API 규칙). 경계 barrel도
  **`export *` 금지 — named export만 선택적으로 재노출**한다(트리쉐이킹·API 변경 안전성).
- **슬라이스 내부는 direct import**한다. 내부용 barrel을 만들지 않는다(순환 참조·번들 증가·
  Vite 캐시 무효화).

## 명명

- 컴포넌트 파일 `PascalCase.tsx`, 훅 파일 `useXxx.ts`(함수명과 1:1), 그 외 유틸·타입은 kebab-case.
- props 타입은 `{ComponentName}Props`. 제네릭은 단일이면 `T`, 복수면 `TData`/`TError`.
- 불리언 변수·prop은 `is`/`has`/`should`/`can` 접두사.
- 의도적으로 쓰지 않는 파라미터는 `_` 접두사.

## 에러

- `catch` 변수는 `unknown`이다(strict). `instanceof Error` 가드 뒤에만 사용하고, 원인 보존이
  필요하면 `new AppError('...', {cause: error})`로 체이닝한다.
  단 `promise.catch(cb)`의 콜백 인자는 여전히 `any`이므로 직접 좁힌다.
- 네트워크·폼 경계의 실패는 예외로 흘려보내 TanStack Query의 에러 상태가 받게 한다.

## React 컴포넌트

`React.FC`를 쓰지 않는다(React 19에서 비권장). 함수 선언 + props 타입으로 작성한다.
`forwardRef`도 쓰지 않는다 — `ref`는 일반 prop이다.

```tsx
import type {ReactNode, Ref} from 'react'
// UI_LANE: mui 레인만 — import type {SxProps, Theme} from '@mui/material'

type PanelProps = {
  title: string
  children?: ReactNode
  ref?: Ref<HTMLElement>
  // 스타일 확장 prop은 레인을 따른다: mui → sx?: SxProps<Theme> / tailwind-shadcn → className?: string
  className?: string
}

export function Panel({title, children, className, ref}: PanelProps) {
  return (
    <section className={className} ref={ref}>
      <h2>{title}</h2>
      {children}
    </section>
  )
}
```

`UI_LANE: tailwind-shadcn`에서 벤더링한 Radix 프리미티브에 `forwardRef`가 남아 있을 수 있다 —
벤더링 시점에 확인하고, 남아 있으면 그대로 두되 신규 컴포넌트에는 쓰지 않는다.

## 쿼리·뮤테이션 타입

- 도메인 응답 타입은 `entities/{entity}/model/types.ts`에 둔다.
- 뮤테이션 요청 타입은 그 뮤테이션을 소유한 feature·entity 옆에 둔다.
- 서버 상태를 `useState`로 복사하지 않는다 — TanStack Query에서 읽는다.
- pending이 refetch를 기다려야 하면 뮤테이션 `onSettled`에서 `queryClient.invalidateQueries(...)`를
  반환한다.
