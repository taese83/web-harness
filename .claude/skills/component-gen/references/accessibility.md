# Component Accessibility Contract

## Semantic interaction

- action은 `button`, navigation은 `a`, 입력은 native form control 또는 레인 라이브러리의 대응 component를 우선한다.
- custom widget은 해당 WAI-ARIA keyboard pattern, role, state를 모두 구현할 때만 사용한다.
- **vendored 프리미티브(tailwind-shadcn 레인)**: Radix가 공급하는 a11y 구조(`aria-*`·`role`·Portal·focus trap)는 upstream-파생 계약이다 — 스타일·구성만 바꾸고 a11y 배선을 제거하지 않는다. 이탈 시 해당 줄에 한 줄 사유를 남긴다.
- icon-only button은 목적을 설명하는 `aria-label`이 필요하다.
- 장식 이미지는 `alt=""`, 정보 이미지는 문맥에 맞는 대체 텍스트를 제공한다.

## Keyboard and focus

- 모든 action은 keyboard로 도달하고 실행할 수 있어야 한다.
- focus indicator를 제거하지 않는다.
- modal은 focus trap, 초기 focus, close 후 trigger 복원을 보장한다.
- DOM 순서와 시각 순서를 불필요하게 다르게 만들지 않는다.
- hover에서만 나타나는 기능은 focus와 touch에서도 사용할 수 있어야 한다.

## Forms and async status

- visible label을 input과 연결한다.
- error text는 `aria-describedby`로 연결하고 색상 외의 표시를 제공한다.
- submit 실패 시 error summary 또는 첫 invalid field로 이동하는 정책을 정한다.
- loading, success, background refresh는 적절한 `role="status"` 또는 live region으로 전달하되 반복 announce를 억제한다.
- destructive action은 결과와 복구 가능성을 명확히 알린다.

## Visual requirements

- text와 control 상태는 WCAG AA contrast를 만족한다.
- 색상만으로 상태나 series를 구분하지 않는다.
- pointer target은 기본 44×44 CSS px를 목표로 하고 인접 target 간 간격을 둔다.
- motion은 reduced-motion preference에서 제거하거나 축소한다.
- 320 CSS px/400% zoom equivalent reflow와 200% text resize에서 content와 action이 손실되지 않는다.
- sticky/fixed content가 keyboard focus를 완전히 가리지 않는다.

## Required checks

interaction이 있는 component는 다음을 테스트한다.

1. accessible name과 role
2. keyboard activation과 focus order
3. error/status announcement
4. disabled 또는 pending 중 중복 action 방지
5. axe의 자동 규칙과 핵심 흐름의 수동 keyboard 확인
6. 320 CSS px reflow와 적용 가능한 24×24 CSS px target/spacing 기준

자동 axe 통과만으로 접근성 PASS를 선언하지 않는다.
