# Responsive MUI Layout

## 구조적 breakpoint

단순 visibility나 spacing은 responsive `sx`를 사용한다. DOM 순서, interaction, table/card 표현이 달라지면 `useMediaQuery(theme.breakpoints.down(...))`와 별도 subcomponent로 분리한다. CSS와 JavaScript에 서로 다른 breakpoint 숫자를 중복 선언하지 않는다.

## AppBar와 flex overflow

모바일 header는 고정 높이만 주지 말고 shrink contract를 함께 정의한다.

```tsx
<Toolbar sx={{height: 52, minHeight: '52px !important', flexWrap: 'nowrap', overflow: 'hidden'}}>
  <Box component="img" alt="" sx={{flexShrink: 0}} />
  <Typography noWrap sx={{flex: 1, minWidth: 0}}>제목</Typography>
  <Chip sx={{display: {xs: 'none', sm: 'inline-flex'}}} />
  <IconButton aria-label="설정" sx={{flexShrink: 0}} />
</Toolbar>
```

유동 텍스트에는 `minWidth: 0`과 ellipsis contract를, 필수 control에는 `flexShrink: 0`을 둔다. 중요한 action을 overflow hidden으로 감추지 않는다.

## Mobile segmented control

작은 화면에서 `ToggleButtonGroup`을 tab처럼 쓰면 group은 `width: '100%'`, 각 button은 `flex: 1`로 균등 배치한다. label을 지나치게 축소하지 말고 최소 44 CSS px target 또는 동등한 spacing을 보장한다. 선택 상태를 색상만으로 표현하지 않는다.

## Grid row alignment

같은 row의 card 높이를 맞출 때 container는 `alignItems: 'stretch'`, item은 `height: '100%'`와 `boxSizing: 'border-box'`를 사용한다. content가 무제한 증가하면 고정 높이 대신 line clamp, virtualization, expand interaction 중 하나를 설계한다.

## Transform clipping

`transform: scale()`은 layout 공간을 늘리지 않는다. 확대량만큼 wrapper padding을 예약하고 해당 경계가 `overflow: visible`인지 확인한다.

ancestor가 `overflow: hidden|clip`이면 child의 `overflow: visible`로 우회할 수 없다. 이 경우 owning ancestor의 overflow contract를 변경하거나, scale 대신 border/shadow를 쓰거나, overlay를 Portal로 렌더링한다.

## 검증 viewport

최소한 320px, 375px, tablet breakpoint 전후, desktop에서 확인한다.

- horizontal scroll와 clipped focus ring 없음
- header action과 dialog close control 접근 가능
- 320 CSS px/400% zoom equivalent reflow와 200% text resize에서 핵심 정보와 action 유지
- sticky/fixed 영역이 keyboard focus를 완전히 가리지 않음
- touch target overlap 없음
- 모바일과 desktop DOM이 다르면 두 경로 모두 browser test 존재
