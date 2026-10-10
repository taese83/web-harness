# Reference Checklist — 구조·React

허브: `implementation-references.md`(판단 순서·산출물에 드러내지 않기). 항목 ID는 스폰 반환에서만 인용한다(파일로 남는 산출물에는 쓰지 않는다).
렌더링 최적화·번들·Web Vitals 측정은 `performance-patterns.md`가 정본이다.
출처: react.dev https://react.dev/learn/you-might-not-need-an-effect · Feature-Sliced Design https://feature-sliced.design/docs/reference/layers ·
Testing Library https://testing-library.com/docs/queries/about/ · web.dev Core Web Vitals https://web.dev/articles/vitals — 확인 2026-10.
레퍼런스 구현: Bulletproof React(https://github.com/alan2207/bulletproof-react — 기능 단위 폴더·단방향 import), FSD 공식 예제(https://github.com/feature-sliced/examples).

## Effect와 상태 위치 — react.dev

- **STR-1** Effect는 **외부 시스템과 동기화**할 때만 쓴다(네트워크·DOM·React 밖 위젯). 외부 시스템이 없으면 Effect가 필요 없다.
- **STR-2** props·state로 계산되는 값은 렌더 중에 계산한다(상태로 복사하지 않는다). 비싸다고 **측정**됐을 때만 `useMemo`.
- **STR-3** prop이 바뀔 때 상태 전체를 초기화하려면 `key`를 바꾼다. 일부만 맞추려면 ID를 저장하고 렌더 중에 고른다.
- **STR-4** 사용자 행동 때문에 일어나는 일(알림·전송)은 **이벤트 핸들러**에 둔다 — 화면에 보였기 때문에 일어나는 일만 Effect다. Effect가 상태를
  바꾸고 그 상태가 다른 Effect를 부르는 연쇄를 만들지 않는다.
- **STR-5** 부모에 알릴 일은 상태를 바꾸는 같은 핸들러에서 `onChange`를 부른다(또는 상태를 부모로 올린다). 외부 저장소 구독은
  `useSyncExternalStore`. Effect로 데이터를 가져와야 하면 정리 함수로 늦게 온 응답을 버린다.

## 레이어 — Feature-Sliced Design(프로젝트가 FSD일 때)

- **STR-6** 레이어 순서 app → pages → widgets → features → entities → shared. 한 슬라이스는 **자기보다 아래 레이어만** import한다.
- **STR-7** 같은 레이어의 슬라이스끼리 import하지 않는다 — 공유는 아래 레이어로 내리거나, 엔티티 사이는 `@x` 교차 참조로 명시한다. app·shared는
  레이어이자 슬라이스라 안쪽 세그먼트끼리 자유롭다.
- **STR-8** FSD가 아니면 기능 단위 폴더 + 단방향 import(공유 → 기능 → 앱, 기능끼리 직접 import 금지)를 기본으로 본다(Bulletproof React).

## 테스트 — Testing Library

- **STR-9** 테스트는 사용자가 쓰는 방식을 닮을수록 믿을 만하다 — 컴포넌트 인스턴스가 아니라 DOM으로 다룬다.
- **STR-10** 쿼리 우선순위: `getByRole` → `getByLabelText` → `getByPlaceholderText` → `getByText` → `getByDisplayValue` → `getByAltText`·`getByTitle` →
  `getByTestId`(역할·텍스트로 못 찾거나 텍스트가 동적일 때만). 역할로 못 찾으면 접근성 결함의 신호다.

## 성능 기준값 — web.dev

- **STR-11** 좋은 기준: LCP ≤ 2.5초, INP ≤ 200ms, CLS ≤ 0.1(사용자 75번째 백분위). 스트리밍·지연 로딩으로 레이아웃이 밀리지 않게 자리를 잡아 둔다.

## 일반화 근거

- **웹 앱(React SPA·Next)** — Effect·레이어·테스트·성능 항목이 모두 적용된다.
- **라이브러리** — Effect·테스트 항목과 공개 API의 단방향 의존이 적용된다. 레이어 항목은 그 저장소가 FSD일 때만이다.

명명 수준 — eval·실사용 적용 전. 스팩의 `layerMap`이 FSD 방향과 다르면 스팩이 이긴다.
