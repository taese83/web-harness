# Reference Checklist — 접근성 컴포넌트

허브: `implementation-references.md`(판단 순서·산출물에 드러내지 않기). 항목 ID는 스폰 반환에서만 인용한다(파일로 남는 산출물에는 쓰지 않는다).
출처: WAI-ARIA Authoring Practices(APG) https://www.w3.org/WAI/ARIA/apg/ · WCAG 2.2 https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/ ·
MDN ARIA https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA — 모두 확인 2026-10.
레퍼런스 구현: React Aria(https://react-spectrum.adobe.com/react-aria/ — APG 동작을 훅으로 구현), GitHub Primer(https://primer.style/accessibility/ — 포커스 관리·`useFocusTrap`).

## 대화상자·모달·바텀시트(모달인 것) — APG Dialog (Modal)

- **A11Y-1** 열면 포커스를 대화상자 **안**으로 옮긴다 — 보통 첫 포커스 가능 요소. 내용이 길면 맨 위 정적 요소(`tabindex="-1"`), 되돌릴 수 없는
  작업이면 가장 덜 파괴적인 버튼, 안내용이면 가장 가능성 높은 버튼(확인).
- **A11Y-2** Tab·Shift+Tab은 대화상자 안에서만 돈다(마지막↔처음). 바깥 내용은 비활성(`inert`)이고, 닫지 않고 밖으로 나갈 길이 없다.
- **A11Y-3** Esc로 닫힌다. 보이는 닫기 버튼(role button)을 탭 순서 안에 둔다(도출).
- **A11Y-4** 닫히면 포커스를 **연 요소로 되돌린다**. 연 요소가 사라졌으면 논리적으로 다음 요소로(다음 단계가 더 자연스러운 흐름은 예외).
- **A11Y-5** `role="dialog"` + 접근 이름(`aria-labelledby`로 보이는 제목, 없으면 `aria-label`). `aria-modal="true"`는 바깥과의 상호작용을 실제로
  막고 시각적으로 가릴 때만. 조작에 필요한 요소는 모두 대화상자의 자손이다. 겹친 모달은 맨 위 층만 활성이다.

## 메뉴 버튼·메뉴 — APG Menu Button / Menu

- **A11Y-6** 버튼: `aria-haspopup="menu"`(또는 true), `aria-expanded`가 열림 상태를 따른다. Enter·Space(선택: ↓)로 열고 첫 항목에 포커스, ↑는 마지막 항목.
- **A11Y-7** 메뉴 안: ↓·↑로 이동(끝에서 감기는 선택), 감지 않으면 Home·End로 처음·끝. Enter는 실행하고 닫는다. **Esc는 닫고 연 버튼으로 포커스를
  되돌린다.** Tab은 항목 사이를 움직이지 않고 메뉴를 닫으며 밖으로 나간다. 비활성 항목은 포커스는 되지만 실행되지 않는다.

## 탭 — APG Tabs

- **A11Y-8** `tablist`(접근 이름) > `tab`(`aria-controls`) / `tabpanel`(`aria-labelledby`). 선택된 탭만 `aria-selected="true"`.
- **A11Y-9** Tab은 탭 목록의 **선택된 탭**으로 들어가고, 다시 Tab이면 패널로. ←·→는 탭 사이를 감기며 이동, Home·End(선택)로 처음·끝.
  패널이 바로 보이면 포커스 즉시 활성(자동), 지연이 있으면 Enter·Space로 활성(수동). 세로 목록만 ↑·↓를 쓴다.

## 실시간 메시지·알림

- **A11Y-10** 채팅 기록처럼 끝에만 덧붙는 영역은 `role="log"` + 접근 이름. 기본 `aria-live="polite"`·`aria-atomic="false"`를 유지한다 —
  assertive는 아껴 쓴다. 스트리밍 중인 메시지는 토큰마다 읽히지 않게 완료 뒤 한 번 알린다(도출).
- **A11Y-11** 짧은 상태 알림(성공 등)은 `role="status"`, 즉시 알려야 하는 오류는 `role="alert"`. 같은 알림을 중복으로 띄우지 않는다(도출).

## WCAG 2.2 — 새로 생긴 AA·A 기준(컴포넌트에 자주 걸리는 것)

- **A11Y-12** 2.4.11 Focus Not Obscured(AA): 포커스된 요소가 고정 헤더·바텀시트·토스트 같은 작성자 콘텐츠에 **완전히** 가려지지 않는다.
- **A11Y-13** 2.5.8 Target Size(AA): 포인터 대상은 24×24 CSS px 이상(예외: 간격·같은 기능의 대안·문장 속 링크·브라우저 기본·필수). 24는 하한이지
  목표가 아니다 — 실무 기본값은 `design-principles-spacing-layout.md`의 터치 타깃.
- **A11Y-14** 2.5.7 Dragging Movements(AA): 드래그(예: 바텀시트 끌어 닫기)에는 한 번 누르기 대안이 있다.
- **A11Y-15** 3.3.7 Redundant Entry(A): 같은 과정에서 이미 입력한 값을 다시 입력하게 하지 않는다. 3.3.8 Accessible Authentication(AA): 로그인에
  기억·퍼즐 같은 인지 테스트를 요구하지 않는다(붙여넣기·비밀번호 관리자 허용).
- **A11Y-16** 기존 하한은 그대로다 — 대비(텍스트 4.5:1, UI 3:1), focus-visible, 색만으로 정보 전달 금지(`design-principles.md` 소비 규칙).

## 검증

- jsdom 테스트는 역할·이름·포커스 이동까지만 본다 — 실제 키보드 순서·가림·대상 크기는 브라우저 검증(`browser-verifier`, axe)이 본다.

## 일반화 근거

- **웹 앱 화면** — 대화상자·메뉴·탭·알림은 모든 화면형 서비스에 공통이다.
- **컴포넌트 라이브러리** — 같은 APG 패턴이 공개 컴포넌트의 키보드·ARIA 계약이 된다.

명명 수준 — eval·실사용 적용 전.
