# vercel.json 계약

Hybrid 프로젝트에서 Vercel이 이해해야 할 것.

## 기본 형태

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "buildCommand": "pnpm run build",
  "outputDirectory": "dist",
  "installCommand": "pnpm install --frozen-lockfile --ignore-scripts",
  "framework": "vite",
  "rewrites": [{"source": "/(.*)", "destination": "/index.html"}]
}
```

- `framework: vite` — built-in provider validator와 Vercel preset을 일치
- `buildCommand` — 이 profile은 app root 단일 package 기준
- `outputDirectory` — Vite `dist` 출력 위치
- install은 frozen lockfile + lifecycle scripts 비활성화

## SPA rewrite와 처리 순서

Vercel의 SPA deep link에는 다음 fallback이 필요하다.
```json
{
  "rewrites": [
    {"source": "/(.*)", "destination": "/index.html"}
  ]
}
```

Vercel은 filesystem과 Functions를 rewrite보다 먼저 처리하므로 `api/*.ts`와 `dist/assets/*`가 catch-all에 삼켜지지 않는다. 반면 Vite dev server는 자체 SPA fallback을 사용한다. `vercel.json` rewrite를 `configureServer` middleware에 복제하지 않는다.

근거: [Vercel project configuration](https://vercel.com/docs/project-configuration/vercel-json), [Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite).

## API 함수 인식

Vercel은 `api/` 폴더(root 또는 명시된 root 하위)를 serverless function으로 자동 인식.

Built-in profile은 app root의 `api/foo.ts`를 `<domain>/api/foo`로 매핑한다. Monorepo 하위 배치는 현재 profile 감지 밖이며 별도 adapter 결정이 필요하다.

## Function 설정

특정 handler에 runtime 옵션:
```json
{
  "functions": {
    "api/heavy.ts": {
      "memory": 1024,
      "maxDuration": 30
    }
  }
}
```

- `memory` — 128~3008 MB
- `maxDuration` — free ~10s, pro ~60s, enterprise ~900s
- `runtime` — `nodejs20.x` (기본), edge 필요시 handler 안에 `export const config = {runtime: 'edge'}`

## Headers

정적 자산 캐싱:
```json
{
  "headers": [
    {
      "source": "/assets/(.*)",
      "headers": [{"key": "cache-control", "value": "public, max-age=31536000, immutable"}]
    },
    {
      "source": "/index.html",
      "headers": [{"key": "cache-control", "value": "no-cache"}]
    }
  ]
}
```

## Redirects

`/api/*` 이전 경로 이동 등:
```json
{
  "redirects": [
    {"source": "/old/:path*", "destination": "/api/:path*", "permanent": true}
  ]
}
```

## Cron

Scheduled function:
```json
{
  "crons": [
    {"path": "/api/refresh", "schedule": "0 * * * *"}
  ]
}
```
- 시간은 UTC
- Free plan은 crons 미지원

## 배포 검증 체크리스트

1. `vercel deploy` 결과에서 API function이 목록에 나타남
2. `curl <preview-url>/api/health` → 200 반환
3. HMR-free production 확인: no console error, no failed asset request
4. `VITE_*` env가 build output에 inline됐는지 확인 (`grep VITE_ dist/assets/*.js` — build 후 값이 보여야 함)
5. server env가 client bundle에 유출됐는지 감사 (`grep SESSION_SECRET dist/` — 아무것도 없어야 함)

## Netlify 등가

`netlify.toml`:
```toml
[build]
  command = "pnpm --filter client build"
  publish = "client/dist"
  functions = "client/api"

[functions]
  node_bundler = "esbuild"
```

Handler 배치는 Vercel `api/`와 유사하지만 URL은 `/.netlify/functions/foo`. Netlify는 redirect로 `/api/*` → `/.netlify/functions/*` 매핑 필요:
```toml
[[redirects]]
  from = "/api/*"
  to = "/.netlify/functions/:splat"
  status = 200
```
