# OAuth Server-Flow (Google/GitHub/generic)

`auth-patterns.md`의 BFF + 서버 세션 cookie 방식 중, 서버가 직접 OAuth 코드 교환을 수행하는 흐름의 구체 계약. Vite serverless hybrid나 Node backend에서 그대로 사용 가능.

## 흐름

```
1. Browser → GET /api/auth/google/start
     ├─ 서버: state=random, code_verifier(선택), state를 HttpOnly cookie로 심음
     └─ 응답: 302 redirect → https://accounts.google.com/o/oauth2/v2/auth?...

2. Browser → Google 로그인 → Google → GET /api/auth/google/callback?code=...&state=...
     ├─ 서버:
     │   ├─ state cookie 검증 (없거나 mismatch → 401)
     │   ├─ code를 token endpoint에 교환 → access_token + id_token
     │   ├─ id_token JWT 검증 (issuer, aud, exp)
     │   ├─ 사용자 upsert (DB)
     │   ├─ 세션 JWT 생성 → HttpOnly cookie
     │   └─ state cookie 삭제
     └─ 응답: 302 redirect → /

3. Browser → 이후 요청은 cookie 자동 전송 → 서버가 JWT 검증 → 사용자 식별
```

## 필요한 secret

`.env.local`:
```
GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxx
SESSION_SECRET=<32byte 이상 random>
BASE_URL=http://localhost:5173   # dev
```

Production은 provider dashboard에 등록. `BASE_URL`은 redirect_uri 계산에 사용.

## `_lib/oauth.ts` (Google 예시)

```ts
// api/_lib/oauth.ts
import {createRemoteJWKSet, jwtVerify} from 'jose'

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const GOOGLE_SCOPES = ['openid', 'email', 'profile']

export function buildAuthUrl(params: {clientId: string; redirectUri: string; state: string}): string {
  const url = new URL(GOOGLE_AUTH_URL)
  url.searchParams.set('client_id', params.clientId)
  url.searchParams.set('redirect_uri', params.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', GOOGLE_SCOPES.join(' '))
  url.searchParams.set('state', params.state)
  url.searchParams.set('access_type', 'online')
  return url.toString()
}

export async function exchangeCodeForTokens(params: {
  code: string; clientId: string; clientSecret: string; redirectUri: string
}) {
  const body = new URLSearchParams({
    code: params.code,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    redirect_uri: params.redirectUri,
    grant_type: 'authorization_code',
  })
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: {'content-type': 'application/x-www-form-urlencoded'},
    body,
  })
  if (!res.ok) throw new Error(`google token exchange failed: ${res.status}`)
  return res.json() as Promise<{access_token: string; id_token: string; expires_in: number}>
}

// id_token은 사용자 신원 주장이다 — 서명·발급자·수신자를 검증한 것만 신뢰한다.
// decode만 하면 누구나 만든 JWT로 임의 계정에 로그인할 수 있다.
const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'))

export type IdTokenClaims = {sub: string; email: string; name: string; picture?: string}

export async function verifyIdToken(idToken: string, clientId: string): Promise<IdTokenClaims> {
  const {payload} = await jwtVerify(idToken, GOOGLE_JWKS, {
    issuer: ['https://accounts.google.com', 'accounts.google.com'],  // Google은 두 형태를 모두 낸다
    audience: clientId,
  })
  if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') {
    throw new Error('id_token is missing required claims')
  }
  return payload as IdTokenClaims
}
```

## `_lib/session.ts` (JWT with jose)

```ts
// api/_lib/session.ts
import {SignJWT, jwtVerify} from 'jose'

export interface SessionPayload {
  sub: string      // user id
  email: string
  name: string
  picture?: string
}

const enc = new TextEncoder()
function key() {
  const s = process.env.SESSION_SECRET
  if (!s || s.length < 32) throw new Error('SESSION_SECRET must be >=32 chars')
  return enc.encode(s)
}

// `__Host-` 접두사는 브라우저가 강제한다 — Secure·Path=/·Domain 없음. 하위 도메인이나
// 평문 페이지가 세션 cookie를 덮어쓰는 fixation을 막는다. http dev에서는 쓸 수 없다.
const SECURE_ORIGIN = (process.env.BASE_URL ?? '').startsWith('https://')
export const SESSION_COOKIE = SECURE_ORIGIN ? '__Host-session' : 'session'
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7  // 7 days

export async function createSessionJwt(payload: SessionPayload): Promise<string> {
  return new SignJWT(payload as any)
    .setProtectedHeader({alg: 'HS256'})
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(key())
}

export async function verifySessionJwt(token: string): Promise<SessionPayload | null> {
  try {
    const {payload} = await jwtVerify(token, key())
    return payload as unknown as SessionPayload
  } catch {
    return null
  }
}

// 이름과 `Secure`를 같은 값 하나로 정한다 — 호출자가 따로 정하면 `__Host-` without `Secure`가
// 만들어지고, 브라우저는 그 cookie를 **조용히 버린다**(302는 성공하고 세션만 없다).
const cookieAttributes = (value: string, maxAge: number): string => {
  const parts = [`${SESSION_COOKIE}=${value}`, 'HttpOnly', 'Path=/', 'SameSite=Lax', `Max-Age=${maxAge}`]
  if (SECURE_ORIGIN) parts.push('Secure')
  return parts.join('; ')
}

export const sessionCookieHeader = (token: string): string =>
  cookieAttributes(token, SESSION_TTL_SECONDS)

export const clearSessionCookieHeader = (): string => cookieAttributes('', 0)

export function readCookie(req: {headers: {cookie?: string}}, name: string): string | null {
  const raw = req.headers.cookie
  if (!raw) return null
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return decodeURIComponent(v.join('='))
  }
  return null
}
```

## `_lib/authGuard.ts`

```ts
// api/_lib/authGuard.ts
import type {VercelRequest, VercelResponse} from '@vercel/node'
import {readCookie, verifySessionJwt, SESSION_COOKIE, type SessionPayload} from './session.js'

/** handler 상단에서 호출. 세션 없으면 401 응답하고 null 반환. */
export async function requireSession(
  req: VercelRequest, res: VercelResponse
): Promise<SessionPayload | null> {
  const token = readCookie(req, SESSION_COOKIE)
  if (!token) {
    res.status(401).json({error: 'unauthenticated'})
    return null
  }
  const payload = await verifySessionJwt(token)
  if (!payload) {
    res.status(401).json({error: 'unauthenticated'})
    return null
  }
  return payload
}
```

Handler에서:
```ts
export default async function handler(req, res) {
  const user = await requireSession(req, res)
  if (!user) return
  // user.sub, user.email 등 사용
}
```

## `/auth/google/start.ts` handler

```ts
import type {VercelRequest, VercelResponse} from '@vercel/node'
import {buildAuthUrl} from '../../_lib/oauth.js'
import {randomBytes} from 'crypto'

export default function handler(req: VercelRequest, res: VercelResponse) {
  const clientId = process.env.GOOGLE_CLIENT_ID!
  const baseUrl = process.env.BASE_URL!
  const redirectUri = `${baseUrl}/api/auth/google/callback`
  const state = randomBytes(24).toString('hex')

  const secure = baseUrl.startsWith('https://')
  const stateCookie = [
    `oauth_state=${state}`,
    'HttpOnly',
    'Path=/api/auth',
    'SameSite=Lax',
    'Max-Age=600',
    ...(secure ? ['Secure'] : []),
  ].join('; ')

  res.setHeader('Set-Cookie', stateCookie)
  res.setHeader('Location', buildAuthUrl({clientId, redirectUri, state}))
  res.status(302).end()
}
```

## `/auth/google/callback.ts` handler

```ts
import type {VercelRequest, VercelResponse} from '@vercel/node'
import {exchangeCodeForTokens, verifyIdToken} from '../../_lib/oauth.js'
import {createSessionJwt, sessionCookieHeader, readCookie} from '../../_lib/session.js'
import {upsertUser, ensureDefaultProfile} from '../../_lib/db.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const state = req.query.state as string | undefined
  const cookieState = readCookie(req, 'oauth_state')
  if (!state || !cookieState || state !== cookieState) {
    res.status(400).json({error: 'state mismatch'})
    return
  }
  const code = req.query.code as string | undefined
  if (!code) {
    res.status(400).json({error: 'missing code'})
    return
  }

  const baseUrl = process.env.BASE_URL!
  const tokens = await exchangeCodeForTokens({
    code,
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    redirectUri: `${baseUrl}/api/auth/google/callback`,
  })

  // 서명·issuer·audience를 검증한 claim만 신원으로 쓴다. 실패하면 로그인시키지 않는다.
  let claims
  try {
    claims = await verifyIdToken(tokens.id_token, process.env.GOOGLE_CLIENT_ID!)
  } catch {
    res.status(401).json({error: 'invalid id_token'})
    return
  }

  await upsertUser({id: claims.sub, email: claims.email, name: claims.name, picture: claims.picture})
  await ensureDefaultProfile(claims.sub, claims.name)

  const session = await createSessionJwt({
    sub: claims.sub, email: claims.email, name: claims.name, picture: claims.picture,
  })
  res.setHeader('Set-Cookie', [
    sessionCookieHeader(session),
    'oauth_state=; Path=/api/auth; Max-Age=0',  // state cookie 삭제
  ])
  res.setHeader('Location', '/')
  res.status(302).end()
}
```

Provider endpoint, CSRF, logout, 운영 점검을 구현할 때
`references/oauth-provider-operations.md`를 읽는다.
