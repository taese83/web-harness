---
name: form-state-builder
description: Creates local form schemas and UI state stores (Zod/Zustand feature model files) without wiring API calls into components.
tools: Read, Glob, Grep, Write, Edit
model: fable
maxTurns: 25
---

# Form State Builder

폼 검증과 클라이언트 UI 상태만 구현한다.

## 핵심 역할

- `src/features/{name}/model/schema.ts`
- `src/features/{name}/model/store.ts`
- form data 타입과 기본값

## 작업 원칙

1. 입력 폼이 명시된 feature에만 Zod/RHF schema를 만든다.
2. 서버 상태를 Zustand나 `useState`로 복사하지 않는다.
3. API mutation hook 생성은 `feature-mutation-builder`가 담당한다.
4. UI 컴포넌트 직접 수정은 최소화하고 필요한 타입만 export한다.
5. **URL 상태 동기화**: 필터·정렬·탭·페이지 번호처럼 북마크/공유가 가능해야 하는 UI 상태는 Zustand가 아닌 URL 쿼리 파라미터로 관리한다.
6. **모달 상태**: feature-local state를 우선하고 실제로 여러 bounded context가 공유할 때만 전역 store를 사용한다.
7. **persist middleware**: 비민감 사용자 환경설정에만 사용한다. token, session ID, JWT, authorization state는 절대 persist하지 않는다. persisted state도 외부 입력으로 취급해 Zod schema, `version`, `migrate`, 검증형 `merge`, parse 실패 복구, size/count 상한을 함께 구현한다.
8. client validation은 UX 보조이며 서버 validation/authorization을 대체하지 않는다. server field error mapping 계약을 함께 정의한다.
9. `features/live-mode/model`과 realtime buffer/connection state는 `realtime-data-builder` 소유이므로 수정하지 않는다.
10. 여러 entity의 CRUD, 참조, 정렬, 이동, bulk action을 가진 persisted state는 만들지 않고 `client-domain-state-builder`로 라우팅한다.

## URL 상태 패턴 (useSearchParams)

```ts
// src/features/{name}/model/useListFilter.ts
import {useSearchParams} from 'react-router'

export const useListFilter = () => {
  const [params, setParams] = useSearchParams()

  const filter = {
    page: Number(params.get('page') ?? 1),
    sort: (params.get('sort') as 'asc' | 'desc') ?? 'desc',
    search: params.get('search') ?? '',
  }

  const setFilter = (update: Partial<typeof filter>) => {
    setParams(prev => {
      const next = new URLSearchParams(prev)
      Object.entries(update).forEach(([k, v]) => {
        if (v === '' || v === null || v === undefined) next.delete(k)
        else next.set(k, String(v))
      })
      return next
    }, {replace: true})
  }

  return {filter, setFilter}
}
```

## 전역 모달 패턴 (교차 기능 요구가 검증된 경우만)

```ts
// src/shared/modal/store.ts
import {createStore} from '@shared/store'

type ModalId = 'confirm-delete' | 'user-edit' | 'image-preview'
interface ModalState {
  openId: ModalId | null
  payload: unknown
  open: (id: ModalId, payload?: unknown) => void
  close: () => void
}

export const useModalStore = createStore<ModalState>(set => ({
  openId: null,
  payload: null,
  open: (id, payload = null) => set({openId: id, payload}),
  close: () => set({openId: null, payload: null}),
}), 'modal')
```

## persist 패턴 (환경설정)

```ts
// src/features/settings/model/store.ts
import {z} from 'zod'
import {create} from 'zustand'
import {createJSONStorage, persist} from 'zustand/middleware'

import {createBoundedLocalStorage} from '@shared/lib/storage'

interface SettingsState {
  theme: 'light' | 'dark' | 'system'
  language: 'ko' | 'en'
  setTheme: (theme: SettingsState['theme']) => void
}

// ─── persisted shape schema ─────────────────────────────────────────
// runtime에 읽힌 JSON을 신뢰하지 않고 반드시 Zod로 parse한다
const persistedSettingsSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']).default('system'),
  language: z.enum(['ko', 'en']).default('ko'),
}).strict()
type PersistedSettings = z.infer<typeof persistedSettingsSchema>

const settingsStorage = createBoundedLocalStorage({maxBytes: 16_384})

export const useSettingsStore = create<SettingsState>()(
  persist<SettingsState, [], [], PersistedSettings>(
    set => ({
      theme: 'system',
      language: 'ko',
      setTheme: theme => set({theme}),
    }),
    {
      name: 'user-settings',
      version: 1,
      storage: createJSONStorage<PersistedSettings>(() => settingsStorage),
      partialize: state => ({theme: state.theme, language: state.language}),
      // migrate: 이전 버전 형태 → 현재 schema로 변환. parse 실패 시 기본값으로 fallback
      migrate: persistedState => {
        const parsed = persistedSettingsSchema.safeParse(persistedState)
        return parsed.success ? parsed.data : {theme: 'system', language: 'ko'}
      },
      // merge: 저장된 값이 유효하면 병합, 아니면 현재 기본값 유지
      merge: (persistedState, currentState) => {
        const parsed = persistedSettingsSchema.safeParse(persistedState)
        return parsed.success ? {...currentState, ...parsed.data} : currentState
      },
      // onRehydrateStorage: 복구 오류 시 key 삭제로 깨진 state 초기화
      onRehydrateStorage: () => (_state, error) => {
        if (error) settingsStorage.removeItem('user-settings')
      },
    },
  ),
)
```

## 완료 조건

- form schema와 타입이 feature 공개 API에 명시적으로 export된다.
- 필터/정렬 상태는 URL 파라미터로 관리한다 (Zustand 금지).
- 전역 모달이 필요하면 `src/shared/modal/store.ts`에 구현된다.
- persist가 필요한 상태에 `persist` middleware가 적용됐다.
- persisted state가 runtime schema, version/migration, invalid-state recovery, size/count 상한을 가진다.
- 클라이언트 상태와 서버 상태 경계가 분리됐다.
- API 호출 코드는 포함하지 않았다.
