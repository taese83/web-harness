# Slice Template Reference

web-harness FSD 슬라이스 보일러플레이트 템플릿. `/fsd-scaffold`에서 파일 생성 시 사용한다.

## Feature 슬라이스 템플릿

### 디렉토리 구조
```
features/{featureName}/
├── index.ts
├── ui/
│   └── FeatureComponent.tsx
├── model/
│   └── store.ts          (Zustand 상태가 필요한 경우)
└── api/
    └── mutations.ts      (mutation이 필요한 경우)
```

### `index.ts` (공개 API)
```ts
// export * 절대 사용 금지
export {FeatureComponent} from './ui/FeatureComponent'
export type {FeatureComponentProps} from './ui/FeatureComponent'
// mutation이 있으면
export {useFeatureMutation} from './api/mutations'
```

### `ui/FeatureComponent.tsx`

보일러플레이트는 `tech-stack.md`의 `UI_LANE`을 따른다:

```tsx
// UI_LANE: mui
import {Box, Typography} from '@mui/material'

type FeatureComponentProps = {
  // props 정의
}

export function FeatureComponent({}: FeatureComponentProps) {
  return (
    <Box>
      <Typography variant="body1">FeatureName</Typography>
    </Box>
  )
}
```

```tsx
// UI_LANE: tailwind-shadcn
type FeatureComponentProps = {
  className?: string
}

export function FeatureComponent({className}: FeatureComponentProps) {
  return (
    <div className={className}>
      <p className="text-sm">FeatureName</p>
    </div>
  )
}
```

### `model/store.ts` (Zustand)
```ts
import {createStore} from '@shared/store'

interface FeatureState {
  // 상태 타입
  // action은 상태와 같은 interface에 정의
}

export const useFeatureStore = createStore<FeatureState>(set => ({
  // 초기값
  // actions
}))
```

### `api/mutations.ts`
```ts
import {useMutation, useQueryClient} from '@tanstack/react-query'
import {api} from '@shared/api'

// mutationFn은 query factory와 섞지 않는다
export const useFeatureMutation = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: FeatureRequest) => api.post<FeatureResponse>('/endpoint', data),
    onSettled: () => {
      // invalidate 후 pending 상태 유지를 위해 Promise를 반환한다
      return queryClient.invalidateQueries({queryKey: ['relatedKey']})
    },
  })
}
```

---

## Entity 슬라이스 템플릿

### 디렉토리 구조
```
entities/{entityName}/
├── index.ts
├── api/
│   └── queries.ts        (queryOptions factory)
├── model/
│   ├── schema.ts         (외부 응답 runtime schema)
│   └── types.ts          (schema 추론 타입)
└── ui/
    └── EntityCard.tsx    (도메인 UI가 있는 경우)
```

### `api/queries.ts` (queryOptions factory)
```ts
import {queryOptions} from '@tanstack/react-query'
import {api} from '@shared/api'
import type {EntityType} from '../model/types'
import {entityListSchema, entitySchema} from '../model/schema'

export const entityQueries = {
  // queryKey는 v5에서 배열 형태 필수
  all: () => queryOptions({
    queryKey: ['entityName'],
    queryFn: async ({signal}) => entityListSchema.parse(await api.get<unknown>('/entities', {signal})),
  }),
  detail: (id: string) => queryOptions({
    queryKey: ['entityName', id],
    queryFn: async ({signal}) => entitySchema.parse(await api.get<unknown>(`/entities/${id}`, {signal})),
  }),
  // 필터 조건이 있으면 queryKey에 포함
  filtered: (filter: EntityFilter) => queryOptions({
    queryKey: ['entityName', 'list', filter],
    queryFn: async ({signal}) => entityListSchema.parse(await api.get<unknown>('/entities', {params: filter, signal})),
  }),
}
```

### `model/schema.ts`
```ts
import {z} from 'zod'

export const entitySchema = z.object({id: z.string()})
export const entityListSchema = z.array(entitySchema)
```

### `model/types.ts`
```ts
import type {z} from 'zod'
import type {entitySchema} from './schema'

export type EntityType = z.infer<typeof entitySchema>

export interface EntityFilter {
  // 필터 필드
}
```

### `index.ts`
```ts
export {entityQueries} from './api/queries'
export {entityListSchema, entitySchema} from './model/schema'
export type {EntityType, EntityFilter} from './model/types'
export {EntityCard} from './ui/EntityCard'
```

---

## Page 슬라이스 템플릿

### 디렉토리 구조
```
pages/{pageName}/
├── index.ts
└── ui/
    └── PageNamePage.tsx
```

### `ui/PageNamePage.tsx`
```tsx
// UI_LANE: mui → <Box component="main"> / tailwind-shadcn → <main className="...">

function PageNamePage() {
  return (
    <main>
      {/* 페이지 컨텐츠 */}
    </main>
  )
}

export default PageNamePage
```

### `index.ts`
```ts
export {default as PageNamePage} from './ui/PageNamePage'
```

---

## Widget 슬라이스 템플릿

### 디렉토리 구조
```
widgets/{widgetName}/
├── index.ts
└── ui/
    └── WidgetName.tsx
```

### `ui/WidgetName.tsx`
```tsx
import {Box} from '@mui/material'
// feature들을 조합 (features에서 import)
import {FeatureA} from '@features/featureA'
import {FeatureB} from '@features/featureB'

type WidgetNameProps = {
  // 외부에서 주입받을 props (IoC 패턴)
}

export function WidgetName({}: WidgetNameProps) {
  return (
    <Box>
      <FeatureA />
      <FeatureB />
    </Box>
  )
}
```

---

## Shared 세그먼트 추가 시

`shared/`는 슬라이스 없이 세그먼트 바로 아래에 파일을 둔다:

```
shared/newSegment/
├── index.ts
└── newUtil.ts
```

`shared/` 세그먼트의 `index.ts`도 동일하게 명시적 named export만 사용한다.

---

## React Query — 테스트 시 주의

Vitest + jsdom 환경에서 React Query를 테스트할 때:

```ts
// 각 테스트마다 QueryClient 새로 생성 (캐시 오염 방지)
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,  // 테스트 타임아웃 방지 (기본값 3회 재시도)
    },
  },
})
```

---

## React Hook Form — 기본 패턴

```tsx
import {useForm} from 'react-hook-form'

interface FormValues {
  fieldName: string
}

export function FeatureForm() {
  const {register, handleSubmit, formState: {errors}} = useForm<FormValues>({
    // 기본 mode: 'onSubmit' — 제출 후 각 필드가 onChange로 재검증
    // mode: 'onBlur' 로 변경 가능하나 기본값 유지 권장
  })

  const onSubmit = (data: FormValues) => {
    // 처리
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <input {...register('fieldName', {required: true})} />
      {errors.fieldName && <span>필수 입력입니다</span>}
      <button type="submit">제출</button>
    </form>
  )
}
```
