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

const SESSION_COOKIE = 'session'
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

export function sessionCookieHeader(token: string, secure: boolean): string {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

export function clearSessionCookieHeader(secure: boolean): string {
  const parts = ['session=', 'HttpOnly', 'Path=/', 'SameSite=Lax', 'Max-Age=0']
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

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
import {readCookie, verifySessionJwt, type SessionPayload} from './session.js'

/** handler 상단에서 호출. 세션 없으면 401 응답하고 null 반환. */
export async function requireSession(
  req: VercelRequest, res: VercelResponse
): Promise<SessionPayload | null> {
  const token = readCookie(req, 'session')
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
import {exchangeCodeForTokens} from '../../_lib/oauth.js'
import {createSessionJwt, sessionCookieHeader, readCookie} from '../../_lib/session.js'
import {upsertUser, ensureDefaultProfile} from '../../_lib/db.js'
import {decodeJwt} from 'jose'

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

  // id_token은 이미 Google이 서명. decode만 (서명 검증은 openid-client 등 별도)
  // Production은 반드시 signature verification 추가
  const claims = decodeJwt(tokens.id_token) as {
    sub: string; email: string; name: string; picture?: string
  }

  await upsertUser({id: claims.sub, email: claims.email, name: claims.name, picture: claims.picture})
  await ensureDefaultProfile(claims.sub, claims.name)

  const session = await createSessionJwt({
    sub: claims.sub, email: claims.email, name: claims.name, picture: claims.picture,
  })
  const secure = baseUrl.startsWith('https://')
  res.setHeader('Set-Cookie', [
    sessionCookieHeader(session, secure),
    'oauth_state=; Path=/api/auth; Max-Age=0',  // state cookie 삭제
  ])
  res.setHeader('Location', '/')
  res.status(302).end()
}
```

## id_token 서명 검증 (Production 필수)

`decodeJwt`만 쓰면 위조 가능. Production은:

```ts
import {jwtVerify, createRemoteJWKSet} from 'jose'
const JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'))
const {payload} = await jwtVerify(tokens.id_token, JWKS, {
  issuer: 'https://accounts.google.com',
  audience: process.env.GOOGLE_CLIENT_ID!,
})
```

이 검증 없이 서비스 배포하지 않는다.

Provider endpoint, CSRF, logout, 운영 점검을 구현할 때
`references/oauth-provider-operations.md`를 읽는다.
