# Environment Variable Management

`developer`가 `.env` 파일을 생성할 때 이 규칙을 적용한다.

## 파일 구조

| 파일 | 용도 | git 추적 |
|---|---|---|
| `.env.dev` | 개발 환경 (MSW Mock API) | 추적 (`VITE_` 공개값만) |
| `.env.staging` | 스테이징 환경 | 추적 (공개값만) |
| `.env.production` | 프로덕션 환경 | 추적 (공개값만) |
| `.env.local` | 로컬 개인 오버라이드 | **비추적** (.gitignore) |
| `.env.*.local` | 환경별 개인 오버라이드 | **비추적** (.gitignore) |

비밀값(API 키, DB 비밀번호 등)은 절대 `VITE_` prefix를 붙이지 않는다 — 브라우저 번들에 노출된다.

## Quality runner public environment contract

quality runner는 host의 `VITE_*`, `NEXT_PUBLIC_*`, `PUBLIC_*`를 자동 상속하지 않는다. build에 필요한 공개 변수 이름만 `_workspace/02_design/build-environment.json`에 기록한다. 값은 기록하지 않는다.

```json
{
  "schemaVersion": 1,
  "public": ["VITE_PHASE", "VITE_API_URL", "VITE_APP_TITLE"]
}
```

이름에 `SECRET`, `TOKEN`, `PASSWORD`, `CREDENTIAL`, `PRIVATE_KEY`, `API_KEY`가 포함되면 public prefix가 있어도 runner가 거부한다. 실제 값은 승인된 실행 환경에서 주입하며 receipt에는 변수 이름만 남긴다.

## 표준 .env 파일 내용

```bash
# .env.dev
VITE_PHASE=dev
VITE_API_URL=http://localhost:8080
VITE_APP_TITLE=앱 이름
```

```bash
# .env.staging
VITE_PHASE=staging
VITE_API_URL=https://api.staging.example.com
VITE_APP_TITLE=앱 이름 (Staging)
```

```bash
# .env.production
VITE_PHASE=production
VITE_API_URL=https://api.example.com
VITE_APP_TITLE=앱 이름
```

## package.json 스크립트 매핑

```json
{
  "scripts": {
    "dev": "vite --host=127.0.0.1 --port=8080 --mode dev",
    "build": "tsc -b && vite build --mode production",
    "build:dev": "tsc -b && vite build --mode dev",
    "build:staging": "tsc -b && vite build --mode staging",
    "preview": "vite preview --host=127.0.0.1 --port 4173"
  }
}
```

## TypeScript 타입 선언

```ts
// src/vite-env.d.ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PHASE: 'dev' | 'staging' | 'production'
  readonly VITE_API_URL: string
  readonly VITE_APP_TITLE: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
```

## .gitignore 필수 항목

```gitignore
# 환경 변수 (로컬 오버라이드 — 비밀값 포함 가능)
.env.local
.env.*.local

# 공개값만 있는 파일은 추적 (위에서 이미 제외됨)
# .env.dev, .env.staging, .env.production 은 추적
```

## MSW 조건부 활성화

```ts
// src/main.tsx
if (import.meta.env.VITE_PHASE === 'dev') {
  const {worker} = await import('./mocks/browser')
  await worker.start({onUnhandledRequest: 'bypass'})
}
```

`VITE_PHASE === 'dev'`일 때만 MSW를 활성화하므로 staging/production 빌드에는 Mock 코드가 포함되지 않는다.

## 환경 변수 사용 규칙

1. 컴포넌트에서 직접 `import.meta.env` 접근 금지. `src/shared/config/index.ts`에서 중앙 관리
2. `VITE_` prefix가 있는 값은 모두 공개 번들 입력으로 취급한다. 비밀값은 browser build에 전달하지 않고 hosting/BFF의 secret manager에서만 사용한다.
3. TypeScript 선언은 런타임 검증이 아니다. Zod schema로 URL, enum, 필수값을 startup에서 검증한다.

```ts
// src/shared/config/index.ts
import {z} from 'zod'

const publicEnvSchema = z.object({
  VITE_API_URL: z.url(),
  VITE_APP_TITLE: z.string().min(1),
  VITE_PHASE: z.enum(['dev', 'staging', 'production']),
})

const publicEnv = publicEnvSchema.parse(import.meta.env)

export const config = {
  apiUrl: publicEnv.VITE_API_URL,
  appTitle: publicEnv.VITE_APP_TITLE,
  phase: publicEnv.VITE_PHASE,
} as const
```
