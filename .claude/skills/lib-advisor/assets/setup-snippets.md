# Library Setup Snippet Catalog

`/lib-advisor`에서 라이브러리 설치 후 초기 설정 코드를 생성할 때 사용한다.
각 스니펫은 현재 프로젝트의 React/TypeScript/rendering profile에 맞게 조정한다. 예시는 React 19 + TypeScript 6 + Vite 8 호환 프로필 기준이다.

---

## TanStack Query v5

Dependency metadata: runtime `@tanstack/react-query`, development `@tanstack/react-query-devtools`. 적용 시 공식 metadata에서 확인한 exact version을 기록하고 typed package broker를 사용한다.

### `src/shared/api/queryClient.ts`
```ts
import {QueryClient} from '@tanstack/react-query'
import {AppError} from '@shared/api'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      retry: (failureCount, error) => {
        if (error instanceof AppError && error.status && error.status < 500) return false
        return failureCount < 2
      },
      throwOnError: error => error instanceof AppError && (error.status ?? 500) >= 500,
    },
  },
})
```

### `src/app/App.tsx` (Provider 추가)
```tsx
import {QueryClientProvider} from '@tanstack/react-query'
import {ReactQueryDevtools} from '@tanstack/react-query-devtools'
import {queryClient} from '@shared/api'

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      {/* 앱 내용 */}
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  )
}
```

---

## Zustand v5

Dependency metadata: runtime `zustand`. 적용 시 공식 metadata에서 확인한 exact version을 기록하고 typed package broker를 사용한다.

### `src/shared/store/createStore.ts`
```ts
import {create, StateCreator} from 'zustand'
import {devtools, subscribeWithSelector} from 'zustand/middleware'

export const createStore = <T extends object>(
  initializer: StateCreator<T, [['zustand/devtools', never], ['zustand/subscribeWithSelector', never]]>,
) =>
  create<T, [['zustand/devtools', never], ['zustand/subscribeWithSelector', never]]>(
    devtools(subscribeWithSelector(initializer)),
  )
```

### 사용 예시
```ts
// features/myFeature/model/store.ts
import {createStore} from '@shared/store'

interface MyState {
  count: number
  increment: () => void
}

export const useMyStore = createStore<MyState>(set => ({
  count: 0,
  increment: () => set(s => ({count: s.count + 1})),
}))
```

---

## React Hook Form + Zod

Dependency metadata: runtime `react-hook-form`, `zod`, `@hookform/resolvers`. 적용 시 공식 metadata에서 확인한 exact version을 기록하고 typed package broker를 사용한다.

### 기본 사용 패턴
```tsx
import {useForm} from 'react-hook-form'
import {zodResolver} from '@hookform/resolvers/zod'
import {z} from 'zod'

const schema = z.object({
  email: z.string().email('올바른 이메일을 입력해주세요'),
  password: z.string().min(8, '8자 이상 입력해주세요'),
})

type FormValues = z.infer<typeof schema>

export const LoginForm = () => {
  const {register, handleSubmit, formState: {errors}} = useForm<FormValues>({
    resolver: zodResolver(schema),
  })

  const onSubmit = (data: FormValues) => {
    console.log(data)
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <input {...register('email')} />
      {errors.email && <span>{errors.email.message}</span>}
      <input type="password" {...register('password')} />
      {errors.password && <span>{errors.password.message}</span>}
      <button type="submit">로그인</button>
    </form>
  )
}
```

---

## MUI (Material UI)

Dependency metadata: runtime `@mui/material`, `@emotion/react`, `@emotion/styled`. 적용 시 공식 metadata에서 확인한 exact version을 기록하고 typed package broker를 사용한다.

### `src/app/App.tsx` (ThemeProvider 추가)
```tsx
import {ThemeProvider, createTheme, CssBaseline} from '@mui/material'

const theme = createTheme({
  palette: {
    primary: {main: '#1976d2'},
  },
  typography: {
    fontFamily: '"Pretendard", "Noto Sans KR", sans-serif',
  },
})

function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {/* 앱 내용 */}
    </ThemeProvider>
  )
}
```

---

## Tailwind CSS + shadcn/ui

Dependency metadata: runtime `tailwindcss`, `@tailwindcss/vite`, `class-variance-authority`, `clsx`, `tailwind-merge`, `@radix-ui/react-slot`(+ 프리미티브별 `@radix-ui/react-*`). 적용 시 공식 metadata에서 확인한 exact version을 기록하고 typed package broker를 사용한다.

shadcn CLI는 사용하지 않는다 — 프리미티브를 **`src/shared/ui/`에 수동 vendoring**한다(CLI 기본 경로 `src/components/ui/`·`components.json`은 이 하네스의 FSD 규칙·에이전트 소유권과 충돌). vendored 파일은 upstream-파생물이다: 스타일·구성은 바꿔도 **Radix a11y props(`aria-*`·`role`)·Portal·focus 구조는 보존**하고, 이탈 시 한 줄 사유를 남긴다.

### `vite.config.ts` (Tailwind v4 — PostCSS 불필요)
```ts
import tailwindcss from '@tailwindcss/vite'
// plugins: [react(), tailwindcss()]
```

### `src/app/style.css` (토큰 = CSS 변수 = @theme)
```css
@import "tailwindcss";

@theme {
  --color-primary: #1976d2;
  --font-sans: "Pretendard", "Noto Sans KR", sans-serif;
  --radius-md: 0.5rem;
}
```

### `src/shared/lib/utils.ts`
```ts
import {clsx, type ClassValue} from 'clsx'
import {twMerge} from 'tailwind-merge'

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))
```

### vendored 프리미티브 예시 — `src/shared/ui/button/`
```tsx
// button.tsx — cva variants + cn 병합. index.ts에서 명시 named export(export * 금지).
import {cva, type VariantProps} from 'class-variance-authority'
import {cn} from '@/shared/lib/utils'

const buttonVariants = cva('inline-flex items-center justify-center rounded-md font-medium', {
  variants: {variant: {default: 'bg-primary text-white', outline: 'border border-primary'}},
  defaultVariants: {variant: 'default'},
})

export function Button({className, variant, ...props}: React.ComponentProps<'button'> & VariantProps<typeof buttonVariants>) {
  return <button className={cn(buttonVariants({variant}), className)} {...props} />
}
```

---

## Recharts

Dependency metadata: runtime `recharts`. 적용 시 공식 metadata에서 확인한 exact version을 기록하고 typed package broker를 사용한다.

### 기본 LineChart 예시
```tsx
import {LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer} from 'recharts'

const data = [
  {name: '1월', value: 400},
  {name: '2월', value: 300},
  {name: '3월', value: 600},
]

export const SimpleLineChart = () => (
  <ResponsiveContainer width="100%" height={300}>
    <LineChart data={data}>
      <CartesianGrid strokeDasharray="3 3" />
      <XAxis dataKey="name" />
      <YAxis />
      <Tooltip />
      <Line type="monotone" dataKey="value" stroke="#1976d2" />
    </LineChart>
  </ResponsiveContainer>
)
```

---

## TanStack Table v8

Dependency metadata: runtime `@tanstack/react-table`. 적용 시 공식 metadata에서 확인한 exact version을 기록하고 typed package broker를 사용한다.

### 기본 테이블 예시
```tsx
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table'

interface Person {
  name: string
  age: number
}

const columnHelper = createColumnHelper<Person>()

const columns = [
  columnHelper.accessor('name', {header: '이름'}),
  columnHelper.accessor('age', {header: '나이'}),
]

export const BasicTable = ({data}: {data: Person[]}) => {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  return (
    <table>
      <thead>
        {table.getHeaderGroups().map(hg => (
          <tr key={hg.id}>
            {hg.headers.map(h => (
              <th key={h.id}>{flexRender(h.column.columnDef.header, h.getContext())}</th>
            ))}
          </tr>
        ))}
      </thead>
      <tbody>
        {table.getRowModel().rows.map(row => (
          <tr key={row.id}>
            {row.getVisibleCells().map(cell => (
              <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
```

---

## Framer Motion

Dependency metadata: runtime `framer-motion`. 적용 시 공식 metadata에서 확인한 exact version을 기록하고 typed package broker를 사용한다.

### 기본 페이지 전환 예시
```tsx
import {motion, AnimatePresence} from 'framer-motion'

export const FadeInBox = ({children}: {children: React.ReactNode}) => (
  <motion.div
    initial={{opacity: 0, y: 8}}
    animate={{opacity: 1, y: 0}}
    exit={{opacity: 0, y: -8}}
    transition={{duration: 0.2}}>
    {children}
  </motion.div>
)

// 라우트 전환 시
export const PageTransition = ({children}: {children: React.ReactNode}) => (
  <AnimatePresence mode="wait">
    <FadeInBox>{children}</FadeInBox>
  </AnimatePresence>
)
```

---

## react-i18next

Dependency metadata: runtime `react-i18next`, `i18next`, `i18next-browser-languagedetector`. 적용 시 공식 metadata에서 확인한 exact version을 기록하고 typed package broker를 사용한다.

### `src/shared/lang/i18n.ts`
```ts
import i18n from 'i18next'
import {initReactI18next} from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      ko: {translation: {}},
      en: {translation: {}},
    },
    fallbackLng: 'ko',
    interpolation: {escapeValue: false},
  })

export default i18n
```

### `src/main.tsx` (import 추가)
```ts
import '@shared/lang/i18n'
```

### 사용 예시
```tsx
import {useTranslation} from 'react-i18next'

const MyComponent = () => {
  const {t} = useTranslation()
  return <div>{t('common.hello')}</div>
}
```

---

## react-dropzone (파일 업로드)

Dependency metadata: runtime `react-dropzone`. 적용 시 공식 metadata에서 확인한 exact version을 기록하고 typed package broker를 사용한다.

### 기본 드롭존
```tsx
import {useDropzone} from 'react-dropzone'

export const FileUploader = ({onUpload}: {onUpload: (files: File[]) => void}) => {
  const {getRootProps, getInputProps, isDragActive} = useDropzone({
    onDrop: onUpload,
    accept: {'image/*': ['.png', '.jpg', '.jpeg']},
    maxSize: 5 * 1024 * 1024, // 5MB
  })

  return (
    <div
      {...getRootProps()}
      style={{
        border: `2px dashed ${isDragActive ? '#1976d2' : '#ccc'}`,
        padding: 24,
        textAlign: 'center',
        cursor: 'pointer',
      }}>
      <input {...getInputProps()} />
      {isDragActive ? '파일을 여기에 놓으세요' : '파일을 드래그하거나 클릭해서 선택하세요'}
    </div>
  )
}
```

---

## @hello-pangea/dnd (드래그 앤 드롭)

Dependency metadata: runtime `@hello-pangea/dnd`. 적용 시 공식 metadata에서 확인한 exact version을 기록하고 typed package broker를 사용한다.

### 기본 드래그 리스트
```tsx
import {DragDropContext, Droppable, Draggable, DropResult} from '@hello-pangea/dnd'

export const DraggableList = ({items, onReorder}: {
  items: {id: string; content: string}[]
  onReorder: (items: {id: string; content: string}[]) => void
}) => {
  const onDragEnd = (result: DropResult) => {
    if (!result.destination) return
    const next = Array.from(items)
    const [removed] = next.splice(result.source.index, 1)
    next.splice(result.destination.index, 0, removed)
    onReorder(next)
  }

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <Droppable droppableId="list">
        {provided => (
          <div ref={provided.innerRef} {...provided.droppableProps}>
            {items.map((item, index) => (
              <Draggable key={item.id} draggableId={item.id} index={index}>
                {provided => (
                  <div
                    ref={provided.innerRef}
                    {...provided.draggableProps}
                    {...provided.dragHandleProps}>
                    {item.content}
                  </div>
                )}
              </Draggable>
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </DragDropContext>
  )
}
```

---

## socket.io-client (실시간)

Dependency metadata: runtime `socket.io-client`. 적용 시 공식 metadata에서 확인한 exact version을 기록하고 typed package broker를 사용한다.

### `src/shared/socket/socket.ts`
```ts
import {io, Socket} from 'socket.io-client'

let socket: Socket | null = null

export const getSocket = () => {
  if (!socket) {
    socket = io(import.meta.env.VITE_WS_URL, {
      autoConnect: false,
      reconnectionAttempts: 5,
    })
  }
  return socket
}
```

### 커스텀 훅
```ts
import {useEffect, useState} from 'react'
import {getSocket} from '@shared/socket'

export const useSocketEvent = <T>(event: string) => {
  const [data, setData] = useState<T | null>(null)

  useEffect(() => {
    const socket = getSocket()
    socket.on(event, setData)
    return () => { socket.off(event, setData) }
  }, [event])

  return data
}
```

---

## Tiptap (리치 텍스트 에디터)

Dependency metadata: runtime `@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit`. 적용 시 공식 metadata에서 확인한 exact version을 기록하고 typed package broker를 사용한다.

### 기본 에디터
```tsx
import {useEditor, EditorContent} from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'

export const RichTextEditor = ({
  content,
  onChange,
}: {
  content: string
  onChange: (html: string) => void
}) => {
  const editor = useEditor({
    extensions: [StarterKit],
    content,
    onUpdate: ({editor}) => onChange(editor.getHTML()),
  })

  return <EditorContent editor={editor} />
}
```
