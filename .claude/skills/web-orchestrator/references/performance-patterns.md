# Performance Patterns

`environment-scaffolder`(빌드·번들 설정)와 `developer`(라우트 분할·데이터 계층)가 이 패턴을 적용한다.
Read this file before configuring Vite build options or writing any lazy-loaded component.

Grafana-like dashboard, realtime metric, high-volume chart 요구가 있으면 `.claude/skills/timeseries-dashboard/references/chart-performance.md`와 `streaming-contract.md`를 추가로 적용한다. 일반 list 가상화 규칙을 chart point 처리에 그대로 적용하지 않는다.

---

## 1. 번들 분할 (Code Splitting)

### 라우트 레벨 — 측정 후 적용 (developer 책임)

```tsx
// src/app/routes/Routes.tsx
const DashboardPage = lazy(() => import('@pages/dashboard/ui/DashboardPage'))
const SettingsPage  = lazy(() => import('@pages/settings/ui/SettingsPage'))
```

모든 페이지를 기계적으로 분할하지 않는다. 초기 route와 작은 페이지는 정적 import가 더 빠를 수 있다. route 크기, 이동 빈도, waterfall을 bundle report와 브라우저 trace로 측정한 뒤 분할하고 `<Suspense fallback={<PageSkeleton />}>`으로 감싼다.

### 컴포넌트 레벨 — 조건부 적용 (developer 책임)

조건부로 렌더링되는 무거운 컴포넌트(모달, 드로어, 차트, 에디터 등)는 컴포넌트 레벨에서도 분할한다.

```tsx
// 무거운 모달은 열릴 때만 로드
const HeavyModal = lazy(() => import('@features/report/ui/ReportModal'))

export const ReportButton = () => {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)}>리포트 보기</Button>
      {open && (
        <Suspense fallback={<CircularProgress />}>
          <HeavyModal open={open} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  )
}
```

**적용 기준**: 초기 경로에 필요 없고 실제로 큰 차트, 리치 텍스트 에디터, 지도, 관리 전용 화면. 고정 크기 임계값보다 route 전환 latency와 전송/파싱 비용을 기준으로 판단한다.

### Vite chunk 전략 (environment-scaffolder 책임)

Vite 기본 code splitting을 출발점으로 사용한다. `manualChunks`는 실제 중복, cache churn, oversized async chunk가 bundle 분석에서 확인된 경우에만 추가한다. 라이브러리 이름 기반의 고정 vendor chunk는 초기 요청 waterfall과 거대한 공유 chunk를 만들 수 있으므로 기본 템플릿에 넣지 않는다. `chunkSizeWarningLimit`를 올려 경고를 숨기지 않는다.

---

## 2. 이미지 최적화

```tsx
// 레이지 로딩 — 뷰포트 밖 이미지는 지연 로드
<img
  src={thumbnailUrl}
  alt={title}
  loading="lazy"
  width={320}
  height={180}
  style={{aspectRatio: '16/9', objectFit: 'cover'}}
/>

// WebP 우선, PNG fallback
<picture>
  <source srcSet={`${imageUrl}.webp`} type="image/webp" />
  <img src={`${imageUrl}.png`} alt={alt} loading="lazy" />
</picture>
```

**규칙**: `<img>`에 `width`/`height` 속성을 반드시 명시한다 — CLS(레이아웃 이동) 방지.

---

## 3. 목록 가상화 (1000개 이상)

1000개 이상 항목 렌더링 시 `@tanstack/react-virtual`을 사용한다.

```tsx
import {useVirtualizer} from '@tanstack/react-virtual'

export const VirtualList = ({items}: {items: Item[]}) => {
  const parentRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 56,
    overscan: 5,
  })

  return (
    <div ref={parentRef} style={{height: '600px', overflow: 'auto'}}>
      <div style={{height: virtualizer.getTotalSize(), position: 'relative'}}>
        {virtualizer.getVirtualItems().map(vItem => (
          <div
            key={vItem.key}
            style={{
              position: 'absolute',
              top: 0,
              transform: `translateY(${vItem.start}px)`,
              width: '100%',
              height: `${vItem.size}px`,
            }}>
            <ItemRow item={items[vItem.index]} />
          </div>
        ))}
      </div>
    </div>
  )
}
```

---

## 4. React 렌더링 최적화

```tsx
// 비싼 계산은 useMemo로 메모이제이션
const sortedItems = useMemo(
  () => [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  [items],
)

// 순수 컴포넌트는 React.memo로 리렌더 방지
export const StatCard = memo(({title, value, trend}: StatCardProps) => (
  <Card>...</Card>
))

// 자식에게 전달하는 콜백은 useCallback으로 안정화 — useMutation 반환 객체는 참조가 매번 바뀌므로
// 의존성에는 안정적인 mutate만 넣는다(@tanstack/query/no-unstable-deps)
const {mutate: deleteItem} = useDeleteItem()
const handleDelete = useCallback((id: string) => {
  deleteItem(id)
}, [deleteItem])
```

**적용 기준**: 부모 리렌더가 잦고 자식이 실제로 변하지 않는 경우에만 적용. 불필요한 memo는 오히려 비용을 높인다.

---

## 5. Preload 힌트 (developer 책임)

중요 리소스는 `<link rel="preload">`로 우선 로드한다.

```html
<!-- index.html -->
<head>
  <!-- 폰트 preload -->
  <link rel="preload" href="/fonts/inter-var.woff2" as="font" type="font/woff2" crossorigin />
  <!-- 위에 그려지는 히어로 이미지 preload -->
  <link rel="preload" href="/images/hero.webp" as="image" />
</head>
```

React Router **Framework mode**에서만 `<Link prefetch>`가 동작한다 — Data mode(`createBrowserRouter`, 이 하네스
템플릿)·Declarative mode에서는 아무것도 하지 않는다(react-router 8 소스: framework context가 없으면 prefetch 비활성).
Data mode에서는 진입 의도 시점(hover·focus)에 데이터와 코드를 직접 당긴다:
```tsx
const prefetchDetail = () => {
  void queryClient.prefetchQuery(itemQueries.detail(id))
  void import('@pages/item-detail/ui/ItemDetailPage')
}

<Link
  to={`/items/${id}`}
  onMouseEnter={prefetchDetail}
  onFocus={prefetchDetail}
>
  상세
</Link>
```

preload/prefetch는 사용 확률, 데이터 비용, mobile network를 측정하고 적용한다.

---

## 6. Web Vitals 측정 (developer 책임)

```ts
// src/shared/utils/webVitals.ts
import {onCLS, onFCP, onINP, onLCP, onTTFB} from 'web-vitals'

export const reportWebVitals = (onReport: (metric: {name: string; value: number}) => void) => {
  onCLS(onReport)
  onFCP(onReport)
  onINP(onReport)
  onLCP(onReport)
  onTTFB(onReport)
}
```

```tsx
// src/main.tsx — consent와 sampling 정책을 적용한 RUM adapter로 전송
import('@shared/utils/webVitals').then(({reportWebVitals}) =>
  reportWebVitals(metric => rumClient.send(metric)),
)
```

**목표 기준 (Core Web Vitals)**:
| 지표 | 좋음 | 개선 필요 |
|---|---|---|
| LCP (최대 콘텐츠 렌더링) | < 2.5s | 2.5~4.0s |
| INP (다음 페인트와의 상호작용) | < 200ms | 200~500ms |
| CLS (누적 레이아웃 이동) | < 0.1 | 0.1~0.25 |

---

## 7. 번들 크기 분석

번들 크기 이상 감지 시:
```ts
// 공식 metadata에서 확인한 exact version을 devDependencies에 기록하고
// typed package broker의 lockfile 검토 → frozen install을 거친 뒤 임시 추가
import {visualizer} from 'rollup-plugin-visualizer'
plugins: [visualizer({open: false, filename: 'dist/stats.html'})]
```

`integration-verifier`는 bundle report를 이전 기준선과 비교해 route별 JS 증가, 중복 dependency, 비정상 async waterfall을 기록한다. 고정 임계값 하나만으로 PASS/FAIL을 결정하지 않는다.

---

## 8. 쿼리 취소 (AbortSignal)

페이지 전환 시 이전 요청을 자동 취소한다.

```ts
// src/entities/{name}/api/queries.ts
export const itemQueries = {
  list: (filter: ItemFilter) => queryOptions({
    queryKey: ['items', filter],
    queryFn: ({signal}) =>
      api.get<Item[]>('/items', {params: filter, signal}),  // signal 전달
  }),
}
```

React Query가 queryKey가 바뀌면 이전 요청에 abort signal을 보내므로, `api.get`에 `signal`을 전달하면 자동으로 취소된다.

---

## 9. 데이터 요청 waterfall (developer 책임)

서로 기다릴 이유가 없는 요청이 **차례로** 나가면 화면이 요청 수만큼 늦게 뜬다. 번들 waterfall(§1)과
별개이며 대개 더 크다.

- **독립 쿼리는 같은 컴포넌트(또는 라우트)에서 함께 시작한다.** 부모가 A를 받아 렌더한 뒤에야 자식이
  B를 시작하는 구조(부모 쿼리 → 자식 컴포넌트 쿼리)면 B를 부모로 끌어올리거나 부모에서 prefetch한다.
  suspense 쿼리 여러 개는 `useSuspenseQueries`로 묶는다 — 연달아 `useSuspenseQuery`를 쓰면 직렬이 된다.
- **lazy 라우트는 코드와 데이터를 함께 당긴다.** 라우트 loader나 링크 hover·진입 시점에
  `queryClient.prefetchQuery(xxxQueries.detail(id))`를 부른다 — 코드 청크를 받은 뒤 렌더 중에 fetch가
  시작되면 청크 → 요청이 직렬이 된다.
- **정말 앞 결과가 필요한 요청만** 직렬로 둔다(`enabled: Boolean(user?.id)`). 그 의존은 쿼리 키에 드러난다.
- 쿼리 키는 `queryFn`이 읽는 값을 전부 담는다 — 빠지면 필터를 바꿔도 캐시가 갱신되지 않는다. `QueryClient`는
  렌더마다 만들지 않는다. 생성 템플릿은 둘 다 lint로 막는다(`@tanstack/eslint-plugin-query` `flat/recommended`).

판정은 측정으로 한다 — Playwright trace(`trace: 'on-first-retry'` 또는 `--trace on`)나 브라우저 개발자 도구의
Network 탭에서 같은 화면의 요청이 앞 요청 완료 직후에만 시작하면 waterfall이다. 추측으로 병렬화하지 않는다.
