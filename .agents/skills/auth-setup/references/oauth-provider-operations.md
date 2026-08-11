# OAuth Provider Operations

`oauth-server-flow.md`의 공통 code exchange와 session 계약을 구현한 뒤
provider별 endpoint, CSRF, logout, 운영 점검에 이 문서를 사용한다.

## Provider별 endpoint

| Provider | authorize | token | userinfo | scope 예 |
|---|---|---|---|---|
| Google | `accounts.google.com/o/oauth2/v2/auth` | `oauth2.googleapis.com/token` | id_token에 포함 | `openid email profile` |
| GitHub | `github.com/login/oauth/authorize` | `github.com/login/oauth/access_token` | `api.github.com/user` | `read:user user:email` |
| Kakao | `kauth.kakao.com/oauth/authorize` | `kauth.kakao.com/oauth/token` | `kapi.kakao.com/v2/user/me` | provider dashboard |

Generic OAuth2/OIDC는 issuer의 `/.well-known/openid-configuration`을 확인한다.

## CSRF 방어

- OAuth callback의 state cookie를 검증한다.
- 로그인 후 POST/PUT/PATCH/DELETE는 SameSite cookie와 origin 검증을 함께 적용한다.
- 매우 민감한 endpoint는 별도 CSRF token까지 요구한다.
- state cookie는 인증 경로로 범위를 제한하고 callback 완료 후 즉시 삭제한다.

## 로그아웃

```ts
// api/auth/logout.ts
import type {VercelRequest, VercelResponse} from '@vercel/node'
import {clearSessionCookieHeader} from '../_lib/session.js'

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({error: 'POST only'})
    return
  }
  const secure = (process.env.BASE_URL ?? '').startsWith('https://')
  res.setHeader('Set-Cookie', clearSessionCookieHeader(secure))
  res.status(200).json({ok: true})
}
```

로그아웃 endpoint에도 origin/CSRF 정책을 적용한다. 단순 GET 로그아웃은 외부
navigation이나 prefetch가 세션을 종료할 수 있으므로 사용하지 않는다.

## 운영 점검

- `redirect_uri`는 provider에 등록한 값과 protocol, host, path, trailing slash까지 일치시킨다.
- `BASE_URL`에 protocol을 포함한다. 예: `http://localhost:5173`.
- callback에 필요한 state cookie의 SameSite 정책을 실제 provider redirect에서 검증한다.
- `SESSION_SECRET`은 32자 이상의 random 값으로 생성한다.
- state cookie의 `Path`는 `/api/auth`처럼 인증 경로로 제한한다.
- production callback은 `id_token` signature, issuer, audience, expiration을 모두 검증한다.
- token, authorization code, session cookie, provider error body를 로그에 남기지 않는다.
