# Hybrid dotenv 관리

SPA와 serverless handler가 같은 `.env`를 공유하지만 노출 규칙은 다르다.

## 위치 규칙

**`.env.local`은 프로젝트 root 하나만.**

```
<repo>/
  .env.local             # ← app root에 하나
  vite.config.ts
  src/                   # VITE_ 접두어만 접근
  api/                   # process.env 전체 접근
```

- root에 하나만 두면 vercel dev, vite dev, IDE가 모두 같은 파일 읽음
- 여러 곳에 두면 어느 파일이 우선인지 헷갈림 → drift 원인

## VITE_ 접두어 원칙

- **client 접근 가능**: `VITE_*`
- **server만 접근**: prefix 없음
- `.env.local`에서 라벨링:

```
# server-only (절대 client에 노출 금지)
DATABASE_URL=postgres://...
GOOGLE_CLIENT_SECRET=...
SESSION_SECRET=...

# client-safe (build에 inline)
VITE_API_URL=/api
VITE_GOOGLE_CLIENT_ID=abcd.apps.googleusercontent.com
```

Vite는 기본적으로 `VITE_` 없는 값을 `import.meta.env`에 노출하지 않는다. 이 안전장치를 절대 우회하지 않는다.

## vite.config.ts에서 server env 주입

Vite의 dev middleware handler가 실행될 때 `process.env` 접근이 필요하다. Vite는 `VITE_` 없는 값을 자동 주입하지 않으므로 config에서 수동 주입:

```ts
import {defineConfig, loadEnv} from 'vite'

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, process.cwd(), '') // '' = prefix 없음, 모두 로드
  for (const [k, v] of Object.entries(env)) {
    if (!process.env[k]) process.env[k] = v
  }
  return {...}
})
```

- `loadEnv(mode, dir, '')` — 세번째 인자를 비워야 prefix 필터가 해제됨
- `if (!process.env[k])` — shell env를 override하지 않음 (외부에서 넣은 값 우선)

## 배포 환경 (Vercel/Netlify)

Provider 대시보드에 같은 이름으로 등록:

Vercel Dashboard → Project → Settings → Environment Variables:
- `DATABASE_URL` — Production, Preview, Development 각각 (다른 값 가능)
- `GOOGLE_CLIENT_SECRET`
- `SESSION_SECRET`
- `VITE_GOOGLE_CLIENT_ID` — build 시점에 SPA에 inline

**중요**: Preview 환경도 등록해야 PR 배포에서 auth·DB가 동작.

## 계약 파일

프로젝트에 무엇이 필요한지 문서화:

```
# .env.example (커밋)
# Server-only
DATABASE_URL=
GOOGLE_CLIENT_SECRET=
SESSION_SECRET=

# Client-safe
VITE_GOOGLE_CLIENT_ID=
VITE_API_URL=/api
```

이 파일을 신규 개발자가 복사 → `.env.local`로 만들어 채운다.

## Secret hygiene

- **hybrid profile에서는 `.env`와 `.env.*` 전체를 `.gitignore`로 차단하고 `.env.example`만 예외로 커밋한다.**
  이 profile은 서버 시크릿(`SESSION_SECRET`, `DATABASE_URL`, provider key)이 같은 파일 계열에 존재하므로
  "이 파일은 공개 값만 담는다"는 규율은 주석만으로 지켜지지 않는다 — 파일 하나에 실수로 서버 키가 들어가면
  그 순간 저장소 히스토리에 남는다. 커밋 가능한 것은 **키 이름만 있고 값이 빈** `.env.example` 하나다.
  ```gitignore
  .env
  .env.*
  !.env.example
  ```
- `.env.local`은 절대 커밋 금지 (`.gitignore`에 포함)
- 대화·이슈·PR에 secret 값을 붙여넣지 않음 (indexer에 남음)
- 유출 즉시:
  1. provider console에서 rotate
  2. `.env.local` 재입력
  3. Vercel 대시보드 재입력 (Prod/Preview 각각)
  4. 재배포
- Session/JWT secret이 유출되면 기존 session도 무효화 (`SESSION_SECRET` 변경 → 기존 JWT verify 실패)

## Prefix 실수 방지

- `VITE_DATABASE_URL` ❌ — client bundle에 DB creds 유출
- `SESSION_SECRET` on client ❌ — 서버 서명 key 유출
- 정기적으로 `grep -rn "import.meta.env" src/`로 client가 접근하는 env를 감사

## Multiple env

여러 환경을 로컬에서 전환 (**전부 커밋 X** — 위 Secret hygiene의 `.env.*` 차단이 이 목록에도 적용된다):
- `.env.local` — 개인 dev
- `.env.development` — 팀 공유 dev 값. 공유는 커밋이 아니라 `.env.example` + provider 대시보드로 한다
- `.env.production` — production defaults. 실제 값은 provider 대시보드가 유일한 출처다

공개 값이라도 이 계열 파일을 커밋하지 않는 이유: 나중에 서버 시크릿이 같은 파일에 추가되는 것을 막을 장치가 없다.
(실사고: 생성물에서 `.env.development`·`.env.production`이 추적된 상태로 남아 보안 리뷰 finding이 됐다)

Vite는 `.env.local`을 항상 마지막에 로드 (가장 우선).
