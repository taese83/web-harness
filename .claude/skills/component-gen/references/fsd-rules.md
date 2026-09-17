# FSD Rules Reference

web-harness의 Feature-Sliced Design(FSD) 레이어 결정 기준. 코드를 어디에 두어야 하는지 판단할 때 사용한다.

## 레이어 구조 (위 → 아래 순서)

```
app/        앱 초기화, 라우팅, Provider, 전역 스타일
pages/      라우트에 대응하는 페이지 컴포넌트
widgets/    여러 features를 조합한 대형 독립 블록
features/   사용자 인터랙션 단위 기능 (한 가지 역할)
entities/   도메인 모델, API 연동, 도메인 타입
shared/     레이어 없음 — 세그먼트만 존재 (api, ui, hooks, utils 등)
```

**Processes 레이어는 deprecated** — 내용을 `features/` 또는 `app/`으로 이동한다.

## 핵심 규칙 (검증된 규칙)

### 1. 단방향 import
모듈은 자신보다 **아래 레이어**에서만 import할 수 있다. 위 방향 import는 무조건 금지다.

```
✅ features → entities → shared
✅ pages → widgets → features
❌ shared → features (금지)
❌ entities → features (금지)
```

### 2. 공개 API — `export *` 금지
슬라이스는 반드시 `index.ts`에서 **명시적 named export**만 사용한다. Wildcard re-export(`export *`)는 금지다.

```ts
// ✅ 좋음 — 명시적 named export
export {FeatureComponent} from './ui/FeatureComponent'
export type {FeatureProps} from './ui/FeatureComponent'
export {useFeatureStore} from './model/store'

// ❌ 나쁨 — wildcard re-export
export * from './ui/FeatureComponent'
```

슬라이스 내부 구조를 아무리 바꿔도, 외부 코드는 `index.ts`의 공개 API만 바라보므로 수정 없이 유지된다.

### 3. 같은 레이어 간 cross-import
같은 레이어의 슬라이스끼리 직접 import는 기본적으로 피한다.

- **Entities 레이어만** 예외적으로 `@x` 표기법 허용 (최소한으로만):
  ```
  entities/chartA/@x/chartB.ts  ← chartB에서만 쓰는 별도 공개 API
  ```
- **Features, Widgets** 레이어에서는 cross-import 대신 props/callback 주입(IoC) 패턴을 사용한다.

## 레이어 결정 트리

```
만들려는 것이 무엇인가?

├─ 앱 전역 설정, 라우터, Provider?
│   → app/

├─ URL에 대응하는 페이지 컴포넌트?
│   → pages/{페이지명}/

├─ 여러 features를 합쳐서 만드는 독립적인 큰 UI 블록?
│   (여러 페이지에서 재사용되는 사이드바, 헤더, 대시보드 패널 등)
│   → widgets/{위젯명}/

├─ 사용자가 직접 하는 행동/인터랙션 단위의 기능?
│   (로그인, 차트 생성, 대시보드 공유, 세그먼트 필터 등)
│   → features/{기능명}/

├─ 도메인 데이터/모델/API?
│   (Chart, Dashboard, Segment, User 등의 CRUD + 타입)
│   → entities/{도메인명}/

└─ 여러 레이어에서 공통으로 쓰는 유틸/UI/훅/상수?
    (특정 도메인에 묶이지 않음)
    → shared/{세그먼트명}/
       예: shared/api, shared/ui, shared/hooks, shared/utils, shared/constants
```

## web-harness 슬라이스 구조 (세그먼트)

각 슬라이스는 필요한 세그먼트만 포함한다:

```
{layer}/{sliceName}/
├── index.ts          ← 공개 API (반드시 있어야 함)
├── ui/               ← React 컴포넌트
├── model/            ← 상태(Zustand store), 타입, 비즈니스 로직
├── api/              ← API 호출 (queryOptions, mutationFn)
├── lib/              ← 슬라이스 내부 유틸
└── hooks/            ← 슬라이스 전용 커스텀 훅
```

`shared/`는 슬라이스 없이 세그먼트 바로 아래 파일을 둔다:
```
shared/
├── api/              ← API 클라이언트 인스턴스, queryClient, 공통 타입
├── ui/               ← 범용 UI 컴포넌트
├── hooks/            ← 범용 커스텀 훅
├── utils/            ← 범용 유틸 함수
├── constants/        ← 앱 전역 상수
└── lang/             ← 다국어 (i18n)
```

## web-harness Path Alias

```json
"@app/*"      → "src/app/*"
"@pages/*"    → "src/pages/*"
"@widgets/*"  → "src/widgets/*"
"@features/*" → "src/features/*"
"@entities/*" → "src/entities/*"
"@shared/*"   → "src/shared/*"
"@lang"       → "src/shared/lang"
```

## TanStack Query 배치 규칙 (검증됨)

`queryOptions` 헬퍼로 `queryKey`와 `queryFn`을 한 곳에 모은다:

```ts
// entities/chart/api/chartQueries.ts
import {queryOptions} from '@tanstack/react-query'
import {api} from '@shared/api'
import {chartListSchema, chartSchema} from '../model/schema'

export const chartQueries = {
  list: () => queryOptions({
    queryKey: ['charts'],
    queryFn: async ({signal}) => chartListSchema.parse(await api.get<unknown>('/charts', {signal})),
  }),
  detail: (id: string) => queryOptions({
    queryKey: ['charts', id],
    queryFn: async ({signal}) => chartSchema.parse(await api.get<unknown>(`/charts/${id}`, {signal})),
  }),
}
```

**Mutation은 query factory와 섞지 않는다.** mutation은 다음 위치에 둔다:
- 페이지/feature 자체의 `api/` 세그먼트 (단일 사용)
- `entities/{name}/api/` (여러 곳에서 재사용)

```ts
// features/createChart/api/mutations.ts (point-of-use 배치 예시)
export const createChartMutation = {
  mutationFn: (data: CreateChartRequest) => api.post('/charts', data),
}
```

## 자주 묻는 케이스

| 만들려는 것 | 위치 |
|---|---|
| 차트 목록 API 호출 | `entities/chart/api/` |
| 차트 생성 폼 + 제출 | `features/createChart/` |
| 대시보드 편집 사이드패널 | `widgets/dashboardEditPanel/` |
| 로그인 페이지 | `pages/login/` |
| 날짜 포맷 유틸 | `shared/utils/` 또는 `shared/lib/` |
| 전역 모달 관리 | `shared/modal/` |
| 에러 바운더리 | `shared/ui/error/` 또는 `app/` |
| 인증 상태 관리 | `shared/auth/` (현재 위치 유지) |
