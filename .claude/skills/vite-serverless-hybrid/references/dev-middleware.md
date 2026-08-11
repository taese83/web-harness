# Vite dev middleware로 /api/* 라우팅

Vite dev server의 HMR을 유지하면서 app root `api/`의 Vercel Web Handler를 같은 프로세스에서 실행한다.
실행 가능한 기준 구현은 `golden/vite-serverless-hybrid/vite.config.ts`와 `dev/node-adapter.ts`다.

## 계약

- production handler는 Web Standard `Request`를 받고 `Response`를 반환한다.
- 권장 export는 `export default {fetch}`다. legacy `VercelRequest`/`VercelResponse` signature는 명시적 호환 요구가 있을 때만 쓴다.
- dev middleware는 Node `IncomingMessage`를 streaming `Request`로 변환하고 응답을 `ServerResponse`로 되돌린다.
- JSON body를 middleware에서 먼저 무제한 buffer하지 않는다. §7 공통 가드가 stream을 byte cap까지 읽고 초과 즉시 중단한다.
- handler module은 `server.ssrLoadModule()`로 읽어 HMR 갱신을 반영한다.
- URL에서 만든 file path는 canonical `api/` root 안인지 확인하고 허용 문자·동적 segment 규칙을 검증한다.

## 최소 형태

```ts
// api/health.ts
import {withGuards} from './_lib/guard'

export const guards = {
  methods: ['GET'],
  auth: 'public',
  maxBodyBytes: 0,
  schema: null,
  rateLimit: null,
} as const

export const fetch = withGuards(guards, () => Response.json({status: 'ok'}))
export default {fetch}
```

```ts
// vite.config.ts의 핵심 흐름
const module = await server.ssrLoadModule(handlerPath)
const handler = module.default?.fetch
if (typeof handler !== 'function') throw new TypeError('API module must default-export {fetch}')
const result = await handler(toWebRequest(request))
await writeWebResponse(result, response)
```

`toWebRequest`는 request body를 `Readable.toWeb()`으로 연결하고 body가 있는 method에는 Node Fetch의
`duplex: 'half'`를 설정한다. `writeWebResponse`는 status와 headers를 복사한 뒤 bounded response를 종료한다.
큰 streaming response가 필요한 endpoint는 buffer 대신 `Readable.fromWeb(response.body)` pipe 경로를 별도로 구현한다.

## Vercel production과 dev의 차이

- Vercel은 app root `api/*.ts`를 Functions로 빌드하고 Web Handler를 직접 호출한다.
- Vite dev는 `vercel.json` rewrite를 읽지 않는다. 자체 SPA fallback과 `configureServer` API middleware를 사용한다.
- production `/(.*) → /index.html` rewrite는 filesystem/Functions 뒤에 적용된다. 이 규칙을 dev middleware에 복제하면 HMR 경로를 삼킬 수 있다.
- `vercel dev`를 선택했다면 HMR, deep link, `/api/health`를 별도 runtime fixture로 검증한다.

## Cookie와 환경 변수

- cookie는 Web API의 `request.headers.get('cookie')`와 response `Set-Cookie` header로 다룬다.
- server env는 `loadEnv(mode, process.cwd(), '')`로 읽되 shell/provider 값은 덮어쓰지 않는다.
- `VITE_*`가 아닌 값은 client source에서 접근하지 않는다.
- 인증·소유자 allowlist env가 없으면 유료/mutation 경로는 503 fail-closed다.

## 함정

- `api/` 아래 helper도 Vercel entrypoint로 오인되지 않도록 공유 코드는 `_lib/`에 둔다.
- in-memory rate limit은 instance-local soft limit이다. 강한 전역 한도는 외부 atomic store가 필요하다.
- local middleware 성공은 실제 provider routing 증거가 아니다. preview deployment에서 `/api/health`와 SPA deep link를 다시 확인한다.

근거: [Vercel Node.js runtime](https://vercel.com/docs/functions/runtimes/node-js),
[Vercel Functions API](https://vercel.com/docs/functions/functions-api-reference).
