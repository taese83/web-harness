# Authentication Patterns

`/auth-setup` 실행 전 반드시 읽는다. 이 문서는 브라우저 credential 탈취와 client-only authorization을 피하기 위한 최소 계약이다.

## 아키텍처 선택

| 방식 | Credential 위치 | 기본 선택 조건 | 주요 방어 |
|---|---|---|---|
| BFF + 서버 세션 | 서버가 발급한 `HttpOnly` cookie | 일반 프로덕션 웹앱의 기본값 | CSRF, CORS allowlist, cookie attributes, 서버 인가 |
| OIDC Authorization Code + PKCE | access token은 OIDC SDK 메모리, refresh 정책은 IdP 계약 | 독립 SPA가 resource server를 직접 호출해야 할 때 | PKCE, state/nonce, rotation, 짧은 수명, CSP |

access token, refresh token, session ID, JWT를 `localStorage`, `sessionStorage`, IndexedDB, Zustand persist에 저장하지 않는다. 프로토타입도 이 금지 규칙을 완화하지 않는다.

## BFF 세션 계약

- 서버가 session cookie를 `HttpOnly`, `Secure`, 적절한 `SameSite`와 제한된 `Path`로 설정한다.
- browser JavaScript는 cookie 값을 읽거나 복사하지 않는다.
- credential 요청은 `withCredentials: true`를 사용하고 서버는 명시적 origin allowlist와 `Access-Control-Allow-Credentials: true`를 적용한다.
- 상태 변경 요청은 서버 검증 CSRF token 또는 검증된 same-origin 방식을 사용한다. `SameSite`만으로 CSRF 방어가 완료됐다고 보지 않는다.
- 로그인, 갱신, 로그아웃, current-user endpoint의 cache 정책과 401/403 응답을 명세한다.
- logout은 서버 세션을 폐기하고 cookie를 만료시킨다.

```ts
// src/entities/auth/model/authStore.ts
import {create} from 'zustand'

import type {AuthUser} from './types'

type AuthState = {
  sessionChecked: boolean
  user: AuthUser | null
  clearSession: () => void
  setSession: (user: AuthUser | null) => void
}

export const useAuthStore = create<AuthState>(set => ({
  sessionChecked: false,
  user: null,
  clearSession: () => set({sessionChecked: true, user: null}),
  setSession: user => set({sessionChecked: true, user}),
}))
```

스토어에는 credential이 없고 새로고침 시 `/api/auth/me`로 서버 세션을 다시 확인한다.

## CSRF 요청 패턴

```ts
import axios from 'axios'

const authApi = axios.create({
  baseURL: '/api',
  withCredentials: true,
})

authApi.interceptors.request.use(request => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method?.toUpperCase() ?? 'GET')) {
    const csrfToken = csrfTokenStore.get()
    if (csrfToken) request.headers.set('X-CSRF-Token', csrfToken)
  }
  return request
})
```

CSRF token 자체를 장기 브라우저 저장소에 넣지 않는다. 서버가 발급한 현재 문서의 meta/bootstrap 응답 또는 전용 endpoint에서 가져와 메모리에 유지한다.

## Single-flight 세션 갱신

```ts
import axios from 'axios'
import type {AxiosError, InternalAxiosRequestConfig} from 'axios'

type RetryableRequest = InternalAxiosRequestConfig & {_sessionRetry?: boolean}

let refreshPromise: Promise<void> | null = null
const refreshClient = axios.create({baseURL: '/api', withCredentials: true})

const refreshSession = () => {
  const csrfToken = csrfTokenStore.get()
  const refreshConfig = csrfToken ? {headers: {'X-CSRF-Token': csrfToken}} : undefined
  refreshPromise ??= refreshClient
    .post('/auth/refresh', undefined, refreshConfig)
    .then(() => undefined)
    .finally(() => {
      refreshPromise = null
    })
  return refreshPromise
}

authApi.interceptors.response.use(undefined, async (error: AxiosError) => {
  const request = error.config as RetryableRequest | undefined
  if (error.response?.status !== 401 || !request || request._sessionRetry) {
    throw error
  }

  request._sessionRetry = true
  try {
    await refreshSession()
    return authApi.request(request)
  } catch (refreshError) {
    useAuthStore.getState().clearSession()
    window.dispatchEvent(new Event('auth:session-expired'))
    throw refreshError
  }
})
```

refresh endpoint는 cookie로 세션을 식별하며 request body로 refresh token을 받지 않는다. refresh 전용 client에는 401 interceptor를 연결하지 않아 재귀 갱신을 막고, 원 요청은 최대 한 번만 재시도한다.

## OIDC PKCE 규칙

- 자체 OAuth 구현 대신 검증된 IdP/OIDC SDK를 사용한다.
- Authorization Code + PKCE, `state`, `nonce`, exact redirect URI를 적용한다.
- implicit flow와 password grant를 사용하지 않는다.
- access token은 메모리에만 두고 짧은 수명을 사용한다.
- refresh token 발급이 필요한 browser client는 IdP의 rotation/reuse detection 지원과 위협 모델을 확인한다. 지원이 불명확하면 BFF로 전환한다.
- ID token을 API authorization token으로 사용하지 않는다.

## Protected Route

```tsx
import {Navigate, Outlet, useLocation} from 'react-router'

import {useAuthStore} from '@entities/auth'

export const ProtectedRoute = () => {
  const location = useLocation()
  const sessionChecked = useAuthStore(state => state.sessionChecked)
  const user = useAuthStore(state => state.user)

  if (!sessionChecked) return <div role="status">세션 확인 중...</div>
  if (!user) return <Navigate replace state={{from: location}} to="/login" />
  return <Outlet />
}
```

이 가드는 화면 탐색을 제어할 뿐 데이터 접근 권한을 보장하지 않는다. 모든 read/mutation endpoint가 서버에서 사용자, tenant, role/scope를 다시 검증해야 한다.

## 서버 인가 계약

API schema에 endpoint별로 다음을 포함한다.

| Method/Path | Authentication | Required Role/Scope | Tenant Rule | 401 | 403 |
|---|---|---|---|---|---|

- object ID만 바꿔 다른 사용자의 자원에 접근할 수 없는지 contract/E2E test로 검증한다.
- UI에서 버튼을 숨기는 것과 서버가 mutation을 거부하는 것을 각각 테스트한다.
- 401은 인증 부재/만료, 403은 인증됐지만 권한 없음으로 일관되게 구분한다.

## 인증 테스트 최소 세트

1. 비인증 사용자의 보호 route 이동
2. `/auth/me` 성공·401과 초기 loading 상태
3. 동시 401 여러 건에서 refresh request가 한 번만 발생
4. refresh 실패 시 loop 없이 session-expired 처리
5. 상태 변경 요청의 CSRF token 누락/불일치 거부
6. 다른 role/tenant의 API 접근이 서버에서 403 또는 404로 거부
7. logout 후 기존 session 재사용 불가

## 금지 패턴

- Web Storage 또는 IndexedDB에 credential 저장
- refresh token을 JSON request body로 전송하는 browser 구현
- client-side role guard만으로 authorization 완료 처리
- wildcard CORS origin과 credential 허용 조합
- raw token, authorization header, password, session cookie 로깅
- 401마다 독립 refresh 요청을 보내는 interceptor
- redirect loop 또는 원 요청 무제한 재시도
