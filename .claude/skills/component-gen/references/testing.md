# Testing Conventions

테스트를 쓰기 전에 읽는다(레인 공용). **[lint]** = `project-init` 템플릿(react-vite-spa)의 `eslint.config.js`가 테스트
파일에 기계로 강제한다(`eslint-plugin-testing-library` `flat/react`, `eslint-plugin-playwright` `flat/recommended`).
다른 형태·기존 프로젝트에서는 같은 규칙이 산문 규약이다.

## 무엇을 테스트하는가

- **사용자가 관찰하는 동작**을 테스트한다 — 화면에 보이는 것, 누를 수 있는 것, 그 결과. 내부 state·
  훅 반환값·컴포넌트 인스턴스·CSS 클래스를 단언하지 않는다(구현을 바꾸면 깨지고 버그는 못 잡는다).
- 테스트 이름이나 한 줄 주석에 **TC/FEAT ID**를 남긴다 — `acceptanceCoverage`가 대조한다(`developer.md`).
- 스냅샷만으로 동작을 증명하지 않는다. 스냅샷은 의도한 출력 형태를 고정할 때만 쓴다.

## 요소 찾기 — 쿼리 우선순위

접근성 트리로 찾는 쿼리가 먼저다. 그 쿼리로 찾을 수 없으면 **접근성 이름이 빠진 것**이니
테스트가 아니라 컴포넌트를 고친다(I6 — 접근성 하한과 같은 방향이다).

1. `getByRole(role, {name})` — 거의 모든 경우
2. `getByLabelText` — 폼 필드
3. `getByPlaceholderText` · `getByText` · `getByDisplayValue` — 비대화형 내용
4. `getByAltText` · `getByTitle`
5. `getByTestId` — 위 어느 것으로도 의미 있게 가리킬 수 없을 때만

- `screen`에서 찾는다. `container.querySelector`·`document.querySelector`로 DOM을 직접 찾지 않는다 **[lint]**.
- 없는 것을 단언할 때만 `queryBy*`, 비동기로 나타나는 것은 `findBy*`를 쓴다 **[lint]**.

## 상호작용과 비동기

- 입력은 `@testing-library/user-event`의 `userEvent.setup()`으로 한다 — `fireEvent`는 실제 브라우저가
  보내는 이벤트 순서(focus → keydown → input → keyup)를 건너뛴다 **[lint]**.
- 기다림은 `findBy*`·`waitFor`로 **조건**을 기다린다. 고정 시간 대기(`setTimeout`·`sleep`)를 쓰지 않는다.
- `waitFor` 안에는 단언 하나만 둔다. 부수효과(클릭·입력)를 넣지 않는다 **[lint]**.
- 네트워크는 테스트에서 직접 mock하지 않고 프로젝트의 Mock 계층(MSW handler)을 쓴다.

## 브라우저 테스트 (Playwright)

- locator는 `page.getByRole`·`getByLabel`·`getByText` 순으로 쓴다. CSS·XPath selector는 최후다.
- 단언은 web-first(`await expect(locator).toBeVisible()`)로 쓴다 — 조건이 설 때까지 재시도한다.
  `expect(await locator.isVisible()).toBe(true)`는 한 번만 보고 끝난다 **[lint]**.
- `page.waitForTimeout`을 쓰지 않는다 **[lint]**. `test.only`와 조건 없는 `test.skip`을 남기지 않는다 **[lint]**.
- `await`를 빠뜨린 단언은 조용히 통과한다 — `playwright/missing-playwright-await`가 잡는다 **[lint]**.
- 테스트끼리 상태를 공유하지 않는다. 각 테스트는 자기 데이터로 시작한다.

## 하지 않는 것

- 통과시키려고 단언을 약하게 바꾸지 않는다 — 막힌 것은 구현이다.
- `--passWithNoTests`·빈 `describe`·`expect(true)`로 테스트를 채우지 않는다.

## 일반화 근거

- **React SPA(Vite·Vitest·Testing Library)** — 전 절이 적용된다. 쿼리 우선순위는 레인(mui·tailwind-shadcn)과 무관하다.
- **Next 풀스택·서버리스 하이브리드** — 컴포넌트·브라우저 테스트 규칙이 산문으로 그대로 선다(lint 배선은 아직 없다).
- **UI 없는 라이브러리·CLI** — 「무엇을 테스트하는가」의 관찰 가능한 동작·TC 인용·하지 않는 것만 적용된다(공개 API가 관찰 대상).
- 진실 검증 수준: **명명 수준** — lint 규칙 발화는 플러그인 설치로 확인했고, 생성 프로젝트에서 테스트 품질이 나아졌는지는 미실측이다.
