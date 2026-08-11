# Library Catalog

서비스 유형 × 기능별 라이브러리 추천 카탈로그.
각 항목에 추천 이유, 대안, 피할 상황을 포함한다.

---

## BASE_STACK — 서비스 유형별 Base Stack

### 데이터 대시보드 / 어드민 도구
```
필수: React Query + Axios, Zustand, MUI (or Ant Design), date-fns
차트: Recharts (단순) / ECharts (복잡·대용량)
테이블: TanStack Table
```

### SaaS 관리 도구 (B2B)
```
필수: React Query + Axios, Zustand, MUI
폼: React Hook Form + Zod
인증: 자체 구현 or Auth0/Clerk (외부 IdP)
권한: casl 또는 자체 role guard
```

### 쇼핑몰 / 이커머스
```
필수: React Query + Axios, Zustand (장바구니), MUI or Tailwind + Radix UI
결제: Toss Payments / 포트원(아임포트) / Stripe
이미지: react-image / next/image (Next.js 사용 시)
무한스크롤: TanStack Virtual
```

### 블로그 / 콘텐츠 사이트
```
필수: TanStack Query (or SWR), Tailwind CSS
마크다운: react-markdown + remark-gfm
SEO: Next.js 권장 (CSR 한계), Vite SSR 플러그인
코드 하이라이트: shiki (or Prism)
```

### 소셜 피드 / 커뮤니티
```
필수: React Query (무한스크롤), Zustand, Tailwind
실시간: Socket.io-client / Supabase Realtime
이미지 업로드: react-dropzone + presigned URL
무한스크롤: TanStack Virtual + IntersectionObserver
```

### 예약 / 캘린더 시스템
```
필수: React Query, React Hook Form + Zod, date-fns
캘린더: FullCalendar / react-big-calendar
시간 선택: @mui/x-date-pickers / react-datepicker
```

### 지도 / 위치 기반 서비스
```
필수: React Query, Zustand
지도: Kakao Maps SDK (국내) / Naver Maps / Leaflet / react-map-gl (Mapbox)
클러스터링: supercluster
```

---


## STATE — 상태 관리

### 서버 상태 (API 데이터)
- **추천:** `@tanstack/react-query v5`
- **이유:** 캐싱, 백그라운드 재조회, 로딩/에러 상태 자동 관리. queryOptions 헬퍼로 queryKey+queryFn 공동 관리.
- **대안:** `SWR` — 설정이 더 단순하나 기능이 적음. 간단한 프로젝트에 적합.
- **피할 것:** 서버 데이터를 `useState`에 복사 — 백그라운드 업데이트 무력화됨.

### 클라이언트 상태 (UI 상태)
- **추천:** `zustand v5`
- **이유:** 번들 크기 작음(~2KB), TypeScript 친화적, devtools 지원, 불필요한 보일러플레이트 없음.
- **대안:** `jotai` — atom 단위 관리, 컴포넌트 트리 지역 상태에 더 자연스러움.
- **피할 것:** `redux-toolkit` — 소규모~중규모 SPA에서는 오버엔지니어링. 팀 규모가 크고 복잡한 상태 흐름 추적이 필요할 때만 선택.

---

## FORMS — 폼 / 유효성 검사

### 폼 상태 관리
- **추천:** `react-hook-form v7`
- **이유:** 비제어 컴포넌트 방식으로 리렌더 최소화. 기본 mode: 'onSubmit' — 제출 후 개별 onChange 재검증.
- **대안:** `formik` — 제어 컴포넌트, 리렌더 많음. 레거시 코드베이스에서나 선택.
- **피할 것:** 복잡한 폼에 `useState` 직접 관리 — 유효성 로직 파편화됨.

### 스키마 유효성 검사
- **추천:** `zod`
- **이유:** TypeScript 타입 추론 통합, React Hook Form `resolver` 연결 용이, 런타임 + 컴파일타임 검증.
- **대안:** `yup` — zod 이전의 표준. 마이그레이션 이유가 없으면 그대로 써도 됨.
- **피할 것:** 유효성 로직을 컴포넌트 안에 직접 작성 — 재사용 불가, 테스트 어려움.

---

## UI — UI 컴포넌트

### 종합 컴포넌트 라이브러리
- **추천:** `@mui/material v5` (MUI)
- **이유:** 가장 성숙한 React UI 라이브러리. TypeScript 완전 지원. Emotion 기반 sx prop으로 유연한 커스터마이징.
- **대안 (디자인 자유도 높을 때):** `Radix UI` + `Tailwind CSS` — 헤드리스 컴포넌트로 디자인 시스템 완전 제어.
- **대안 (어드민/대시보드):** `Ant Design` — 테이블, 폼, 레이아웃 컴포넌트가 풍부하나 번들 크기 큼.
- **피할 것:** `Bootstrap` + `React` 조합 — className 방식과 React 상태 관리 충돌 자주 발생.

### 헤드리스 컴포넌트 (디자인 시스템 자체 구축 시)
- **추천:** `@radix-ui/react-*`
- **이유:** 접근성(WAI-ARIA) 내장, 비스타일 컴포넌트로 커스터마이징 완전 자유.
- **함께 사용:** `tailwindcss` + `class-variance-authority(cva)` + `clsx`

---

## CHARTS — 차트 / 데이터 시각화

### 표준 차트 (막대, 선, 파이 등)
- **추천:** `recharts`
- **이유:** React 컴포넌트 기반 API, SVG 렌더링, 번들 크기 합리적(~500KB gzip ~150KB). 선언적 구성.
- **대안:** `Chart.js` + `react-chartjs-2` — 성숙하고 문서 풍부하나 React 통합이 어색.
- **조건부(analytics-BI):** `highcharts` — 상업 라이선스 필요. 기본은 회피(무료 대안 우선)하되,
  analytics-BI 부류에서 `analytics-chart-builder/references/chart-engine-adapter.md`의
  **inform-and-choose**(라이선스 필요 고지 → 사용자 선택 → `decision-log`에 근거 기록)를 거친 경우에만 채택.
  선택 결과일 뿐 기본값이 아니다 — 다른 프로젝트에 라이선스 의무를 자동 생성하지 않는다.

### 대용량 / 복잡한 시각화
- **추천:** `echarts` + `echarts-for-react`
- **이유:** Canvas 렌더링, incremental update, 다양한 시계열 interaction을 지원. 실제 가능 데이터량은 series 수·option·device fixture로 측정.
- **대안:** `d3` — 완전 커스텀 시각화가 필요할 때. 학습 곡선 가파름.

---

## TABLES — 테이블 / 데이터 그리드

### 헤드리스 테이블 (커스텀 UI)
- **추천:** `@tanstack/react-table v8`
- **이유:** 정렬, 필터, 페이지네이션, 가상화 등 모든 테이블 기능 내장. UI는 직접 구현.
- **대안:** 단순 목록이면 그냥 `map` + MUI `Table` 컴포넌트로 충분.
- **피할 것:** `MUI DataGrid Pro` — 기능은 좋으나 상업 라이선스(Community 버전은 기능 제한).

### 가상화 (대용량 목록/테이블)
- **추천:** `@tanstack/react-virtual`
- **이유:** TanStack Table과 통합 쉬움, DOM에 보이는 행만 렌더링.
- **대안:** `react-window` — 더 단순하나 기능 제한. 유지보수 소극적.

---

## INFINITE_SCROLL — 무한 스크롤

- **추천:** `react-intersection-observer` + React Query `useInfiniteQuery`
- **이유:** 네이티브 IntersectionObserver 래퍼, 번들 크기 최소. React Query와 자연스럽게 통합.
- **대안:** `react-infinite-scroll-component` — 독립적이지만 React Query 없이도 동작 필요할 때.

---

## DND — 드래그 앤 드롭

- **추천:** `@hello-pangea/dnd` (Atlassian DnD 유지보수 fork)
- **이유:** 리스트 재정렬에 특화, 접근성 내장, 활발히 유지보수 중.
- **대안 (자유도 높은 DnD):** `@dnd-kit/core` — 커스텀 센서, 충돌 감지 알고리즘 선택 가능.
- **피할 것:** `react-beautiful-dnd` — 유지보수 중단, @hello-pangea/dnd로 마이그레이션 권장.

---

## DATETIME — 날짜 / 시간

### 날짜 유틸리티
- **추천:** `date-fns v4`
- **이유:** 트리셰이킹 완벽 지원, TypeScript 내장, 함수형 API.
- **대안:** `dayjs` — API가 Moment.js와 유사해 마이그레이션 쉬움, 번들 작음.
- **피할 것:** `moment.js` — 번들 크기 크고 트리셰이킹 불가, 유지보수 종료.

### 날짜 선택 UI
- **추천:** `@mui/x-date-pickers` (MUI 사용 시)
- **이유:** MUI 스타일 시스템과 통합, date-fns/dayjs adapter 지원.
- **대안:** `react-datepicker` — MUI 미사용 프로젝트에서 가볍게 사용.

---

## RICH_TEXT — 마크다운 / 리치 텍스트

### 마크다운 렌더링
- **추천:** `react-markdown` + `remark-gfm`
- **이유:** 가볍고 커스텀 컴포넌트 교체 가능. GitHub Flavored Markdown 지원.
- **대안:** `@uiw/react-md-editor` — 에디터 기능이 필요할 때.

### 리치 텍스트 에디터
- **추천:** `@tiptap/react`
- **이유:** 모듈식 확장 구조, 헤드리스라 UI 완전 제어. TypeScript 지원 우수.
- **대안:** `slate` — 더 낮은 수준의 제어가 필요할 때. 학습 곡선 가파름.
- **피할 것:** `quill` — React 통합 어색, 유지보수 불안정.

---

## UPLOAD — 파일 업로드

- **추천:** `react-dropzone`
- **이유:** 드래그&드롭 + 클릭 업로드, 파일 타입/크기 유효성 내장. Headless.
- **함께 사용:** presigned URL (S3/GCS) 또는 multipart form + Axios.

---

## REALTIME — 실시간 통신

### WebSocket
- **추천:** `socket.io-client`
- **이유:** 자동 재연결, room/namespace, fallback 내장.
- **대안:** 네이티브 `WebSocket` API — 서버가 socket.io가 아닐 때.

### Server-Sent Events / 실시간 DB
- **추천:** `Supabase` (BaaS 선택 시)
- **이유:** Realtime 구독, Auth, Storage 포함. 빠른 프로토타이핑.
- **대안:** `Firebase Realtime DB` — Google 인프라, 기존 Firebase 사용 시.

---

## AUTH — 인증

### 자체 인증/BFF
- **추천:** BFF + HttpOnly session cookie, 독립 SPA가 resource server를 직접 호출해야 하면 OIDC Authorization Code + PKCE
- **이유:** browser storage credential을 피하고 서버 authorization·CSRF/CORS·세션 갱신 경계를 명확히 할 수 있음.

### 외부 IdP (소셜 로그인, SSO)
- **추천:** `@auth0/auth0-react` (Auth0) 또는 `@clerk/clerk-react` (Clerk)
- **이유:** OAuth, OIDC, MFA를 직접 구현하지 않아도 됨. Clerk는 UI 컴포넌트까지 제공.

---

## I18N — 국제화 (i18n)

- **추천:** `react-i18next`
- **이유:** 가장 널리 쓰이는 React i18n. namespace, lazy loading, TypeScript 타입 추론 지원.
- **대안:** `next-intl` (Next.js 사용 시), `lingui` — 더 정적인 번역 접근법.

---

## ANIMATION — 애니메이션

### 인터랙션 애니메이션
- **추천:** `framer-motion`
- **이유:** 선언적 API, layout 애니메이션, gesture 지원. 설치된 React major의 공식 peer 호환성을 생성 시 확인.
- **대안:** `react-spring` — physics-based 애니메이션이 필요할 때.
- **피할 것:** CSS keyframe만으로 복잡한 시퀀스 애니메이션 구현 — 유지보수 어려움.

---

## PAYMENT — 결제

### 국내
- **추천:** `@portone/browser-sdk` (포트원 v2) 또는 `@tosspayments/sdk`
- **이유:** 카드, 간편결제, 가상계좌 등 국내 PG 통합. 웹훅 기반 검증 필수.

### 해외
- **추천:** `@stripe/stripe-js` + `@stripe/react-stripe-js`
- **이유:** 가장 성숙한 결제 SDK. PCI-DSS 준수.

---

## MAPS — 지도

### 국내 서비스
- **추천:** `kakao-maps-sdk` (react-kakao-maps-sdk)
- **이유:** 국내 지명/주소 데이터 가장 정확. 카카오 API 키 필요.
- **대안:** `react-naver-map` — 네이버 지도 사용 시.

### 글로벌 서비스
- **추천:** `react-map-gl` (Mapbox GL JS 래퍼)
- **이유:** 벡터 타일 기반 고성능. 스타일 완전 커스터마이징.
- **대안:** `react-leaflet` — 무료, 래스터 타일. 간단한 지도에 적합.

---

## ANTIPATTERNS — 피해야 할 조합

| 상황 | 피할 것 | 이유 |
|---|---|---|
| React + TypeScript | `propTypes` | TypeScript 타입으로 대체 |
| 공개 콘텐츠 앱 | rendering 전략 없이 CSR 고정 | SSR/SSG, status code, metadata, sitemap 요구를 먼저 결정 |
| 소규모 앱 | `redux-toolkit` | Zustand + React Query로 충분 |
| 국내 서비스 | `moment.js` | 번들 크기, 유지보수 종료 |
| MUI 프로젝트 | `styled-components` 혼용 | Emotion과 CSS 충돌 가능 |
| 간단한 목록 | `react-window` | 1000개 미만이면 그냥 map으로 충분 |
