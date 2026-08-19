# MUI Styling And Component Contracts

## 공개 API 우선순위

1. component prop과 `slotProps`
2. theme `components.*.styleOverrides`
3. exported utility class 또는 문서화된 stable global class
4. 내부 DOM selector는 근거와 upgrade regression test가 있을 때만 사용

`[class*="Mui..."]`, 생성된 Emotion class, minified class는 dev/build 삽입 순서와 MUI upgrade에서 깨질 수 있으므로 금지한다.

```tsx
// Bad
<Box sx={{'& [class*="MuiCard-content"]': {flexGrow: 1}}} />

// Good: 공개 slot contract
<Card slotProps={{content: {sx: {flexGrow: 1}}}} />
```

## 타입 안전한 sx

반복되는 style은 render 밖의 `SxProps<Theme>` 상수로 둔다. 조건부 style은 object spread보다 sx array로 조합하되 `false`만 조건값으로 사용한다.

```tsx
import type {SxProps, Theme} from '@mui/material'

const rootSx: SxProps<Theme> = {
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
}

<Box sx={[rootSx, selected && {outline: '2px solid', outlineColor: 'primary.main'}]} />
```

public wrapper가 `sx`를 받으면 `SxProps<Theme>`로 노출하고 호출자 style이 마지막에 적용되게 한다. wrapper가 지원하지 않는 slot style을 임의 selector로 우회하지 말고 명시적 slot prop을 추가한다.

## Form binding

MUI controlled input은 React Hook Form `Controller`로 연결하고 validation message를 helper text와 접근성 설명에 같이 연결한다.

```tsx
<Controller
  name="title"
  control={control}
  render={({field, fieldState}) => (
    <TextField
      {...field}
      label="제목"
      error={Boolean(fieldState.error)}
      helperText={fieldState.error?.message}
      slotProps={{htmlInput: {'aria-describedby': fieldState.error ? 'title-error' : undefined}}}
    />
  )}
/>
```

mutation 버튼은 pending 동안 중복 제출을 막고 텍스트로 상태를 전달한다. spinner만 표시하지 않는다.

## Theme boundary

- 앱 최상위 `ThemeProvider`가 현재 theme을 소유한다.
- feature가 자체 `createTheme`를 호출하지 않는다.
- 공통 variant와 override는 app theme에 둔다.
- **임의 값 금지 — design-system 갱신으로 해소**: 컴포넌트·sx에 theme을 우회하는 raw hex·
  임의 px(스페이싱 스케일 밖)·로컬 fontFamily를 넣지 않는다. 시스템에 없는 원소가
  필요하면 design-system 정본을 먼저 갱신하고 theme 경유로 소비한다(시스템-우선 왕복 —
  `design-principles-research.md` §시안 적용 완결성 규칙 4가 흐름 수준 정본,
  tailwind-shadcn 레인의 동명 규칙과 대칭).
- user preset은 stable ID만 저장하고 theme object는 저장하지 않는다.
- `prefers-reduced-motion`, contrast, dark/light surface 조합을 함께 검증한다.

## Asset and format rules

- SVG component는 Vite SVGR query 형식인 `import Icon from './icon.svg?react'`를 사용한다.
- icon-only button은 `aria-label`이 필요하다.
- 프로젝트 formatter를 따르고 생성 코드만을 위해 별도 formatter 설정을 만들지 않는다.

