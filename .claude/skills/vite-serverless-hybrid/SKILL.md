---
name: vite-serverless-hybrid
description: Implementation contract for the built-in vite-serverless-hybrid profile (certified — T1 isolated-CI receipt) — a Vite React SPA with Vercel-style serverless functions under a root api/ directory. Used by web-orchestrator when HYBRID_SERVERLESS_MODE locks this profile, or standalone to add a thin serverless backend to an existing Vite SPA. Endpoint guard contract (§7) precedes any handler implementation and is enforced by the profile DAG's api.guards/api.unit machine receipts.
argument-hint: "[project root or hybrid setup requirements]"
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Write, Edit, Bash, Agent, AskUserQuestion
metadata:
  version: 1.2.3
  maturity: eval-covered
  updated: 2026-08-23
  changelog: certified 승격 — 격리 CI(hybrid-t1, run 32614388125)가 ISOLATED_VERIFIED t1-summary receipt를 산출해 validate-certified-evidence의 기계 하한을 처음 통과했다. T2 attestation은 여전히 별도. 이전 — T1 제안본·QA report·cohort 검증기 추가.
---

# Vite + Serverless Hybrid

Vite React SPA에 얇은 backend를 붙이는 hybrid 구성. `next-app-fullstack`은 너무 무겁고 `react-vite-spa`만으로는 서버가 없는, 그 중간 지점.

## Support gate

`SUPPORT_STATUS: certified` — built-in `vite-serverless-hybrid` profile이다 (`web-profile-contract.md`). certified의 근거는 `golden/vite-serverless-hybrid/_workspace/04_qa/t1-summary.json`(격리 CI run 32614388125, `ISOLATED_VERIFIED`)이며 `validate-certified-evidence`가 라벨을 이 receipt에 기계 결속한다 — T1 하한이지 T2 서명 attestation은 아니다. 루트 `api/` 디렉토리가 감지 마커이며 `react-vite-spa`와 상호 배타로 감지된다. release는 profile DAG의 machine receipt(일반 Vite evidence + `api.unit`·`api.guards`)로 판정한다. 체크인된 golden fixture는 T0/T1 재현 경로이지 production 배포나 T2 attestation 증거가 아니다. SSR/SEO 핵심·실시간·장기 실행 job은 이 profile로 수용하지 않고 `next-app-fullstack` 또는 전용 backend로 안내한다. 워크스페이스 하위(`client/api/` 등) 배치는 아직 adapter 감지 밖 — app root 단일 배치로 정규화한다.

Read `references/architecture.md` before touching any config. `references/dev-middleware.md`는 로컬 개발 실행 방식, `references/env-management-hybrid.md`는 dotenv 통일, `references/vercel-config.md`는 배포 계약을 다룬다.

`api/` 아래 handler를 하나라도 만들거나 수정하기 전에 **§7 엔드포인트 공통 가드**를 먼저 읽는다. serverless handler는 파일 추가만으로 공개 HTTP 표면이 늘어나므로, 가드 계약이 구현보다 앞선다.

`auth-setup`, `server-db-migration`, `api-contract-typegen`이 이 profile 위에서 자연스럽게 조합된다. 예약·주기 작업이 필요하면 `../web-orchestrator/references/background-jobs-contract.md`(outbox + Vercel cron/GitHub Actions schedule)를 따른다.

## 언제 사용

- Vite SPA에 인증·DB·upload 정도의 backend가 필요
- Next.js로 넘어가기엔 SPA UX와 build tooling을 유지하고 싶음
- 배포는 Vercel/Netlify serverless functions
- 서버 로직은 endpoint 5~30개 규모

**적절하지 않은 경우**:
- SSR/SEO가 핵심 → `next-app-fullstack`
- 서버 로직이 없음 → 순수 `react-vite-spa`
- 실시간·오래 걸리는 job → 전용 backend service

## Start

`/vite-serverless-hybrid`를 호출하면:

> Vite SPA + serverless functions 구성을 설정합니다. 프로젝트 root와 API 배치를 알려주세요.

intake:
1. **프로젝트 root** — `client/`, `.` 등 (SPA와 API가 같은 root)
2. **API 위치** — built-in profile은 app root의 `api/`; `client/api/`·커스텀은 별도 profile 결정
3. **배포 provider** — Vercel / Netlify / self-host
4. **dev 실행 방식** — Vite middleware (권장, HMR 유지) / `vercel dev` (Vercel API 완전 재현)
5. **런타임 deps 필요 여부** — DB(Neon, Postgres) / JWT(jose) / OAuth / upload

## Workflow

### 1. 디렉토리 구조 확정

권장 배치:
```
<root>/
  src/                      # SPA
  api/                      # serverless handlers
    _lib/                   # 공유 유틸 (guards, db, session)
    health.ts
    profiles.ts
  public/
  package.json              # SPA + server deps 모두 여기
  vite.config.ts
  vercel.json
  .env.local                # server + client env (VITE_ prefix로 client 분리)
```

**중요**: `api/` 폴더가 SPA와 **같은 package.json**을 공유. deps가 두 번 install되지 않도록.

### 2. Vite dev middleware 셋업

`references/dev-middleware.md` 참고. `vite.config.ts`에 API 라우팅 미들웨어 추가:

```ts
// vite.config.ts
import {defineConfig, loadEnv} from 'vite'
import react from '@vitejs/plugin-react'
import {resolve} from 'path'

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, process.cwd(), '')
  // VITE_ prefix 없는 env도 process.env에 주입 → API handler에서 사용
  for (const [k, v] of Object.entries(env)) {
    if (!process.env[k]) process.env[k] = v
  }

  return {
    plugins: [
      react(),
      {
        name: 'api-middleware',
        configureServer(server) {
          server.middlewares.use(async (req, res, next) => {
            const url = req.url ?? ''
            if (!url.startsWith('/api/')) return next()
            try {
              const handler = await resolveApiHandler(server, url)
              if (!handler) return next()
              await handler.fetch(toWebRequest(req)).then(result => writeWebResponse(result, res))
            } catch (err) {
              res.statusCode = 500
              res.end(JSON.stringify({error: String(err)}))
            }
          })
        },
      },
    ],
  }
})

async function resolveApiHandler(server, url) {
  // /api/profiles → api/profiles/index.ts | api/profiles.ts
  // /api/profiles/123 → api/profiles/[id].ts (params: {id: '123'})
  // 실제 로직: references/dev-middleware.md의 resolver
}
```

`vercel dev`도 가능하지만 Vite HMR과 충돌 이력 있음 → Vite middleware 방식 권장.

### 3. dotenv 정책

`references/env-management-hybrid.md`:
- `.env.local`은 프로젝트 root 하나 (혼동 방지)
- `VITE_` prefix — client가 build 시 참조
- prefix 없음 — 서버 handler가 `process.env`로 참조
- vite.config.ts가 `loadEnv(..., '')`로 로드해 `process.env`에 주입 (dev)
- 배포 provider 대시보드에서 same variable 등록 (prod)

### 4. deps 정리

Hybrid에 필요한 서버 deps는 app root `package.json`의 `dependencies`에 기록한다. 직접 package manager를 실행하지 않고 `run-package-operation.mjs`의 lockfile 검토 → frozen install 계약을 사용한다. 예:
```
jose, @neondatabase/serverless: exact runtime dependencies
```
- `jose` — JWT
- `@neondatabase/serverless` — HTTP 기반 Postgres (serverless 친화)
- 신규 Vercel Node Functions는 Web Standard `Request`/`Response` handler를 우선한다. legacy Node signature가 꼭 필요할 때만 `@vercel/node` 타입을 추가한다.

### 5. vercel.json

`references/vercel-config.md`:
```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "vite",
  "buildCommand": "pnpm run build",
  "outputDirectory": "dist",
  "installCommand": "pnpm install --frozen-lockfile --ignore-scripts",
  "rewrites": [{"source": "/(.*)", "destination": "/index.html"}]
}
```

Vercel production에서는 SPA deep link를 위해 catch-all rewrite가 필요하다. Vercel은 filesystem과 Functions를 rewrite보다 먼저 처리하므로 `/api/*`와 정적 asset은 보존된다. 이 `vercel.json` 규칙을 Vite dev middleware에 재적용하지 않는다. `vercel dev`를 선택했다면 HMR과 `/api/*`를 별도 runtime fixture로 확인한다.

### 6. `_lib/` 공유 유틸

`api/_lib/`에 handler가 공유하는 모듈. import path는 handler에서 `../_lib/db.js` (Node ESM 요구사항으로 `.js` 확장자).

### 7. 엔드포인트 공통 가드 (생략 불가)

serverless handler는 파일 하나가 곧 공개 HTTP 표면이다. `api/` 아래 **모든** handler는 아래 5종 가드를 통과해야 하며,
가드는 `_lib/`의 공유 모듈로 구현해 handler마다 재작성하지 않는다.

| 가드 | 요구 | 위반 시 결과 |
|---|---|---|
| method allowlist | 처리할 method만 통과, 나머지 405 | 의도 밖 동사로 mutation 경로 진입 |
| 인증 가드 | 공개 의도가 명시된 endpoint 외 전부 세션/토큰 검증 후 진행 | 무인증 mutation·서버 키 소모 |
| body 크기 캡 | JSON 파싱 **전에** byte 상한(기본 32KB)으로 절단, 초과는 413 | 입력 토큰 증폭·메모리 소모 |
| 입력 스키마 검증 | 필드 allowlist + 타입·범위·배열 길이 상한. 미지 키는 구조적 드롭 | 클라이언트 신뢰 저장·타입 불일치 500 |
| rate limit | 사용자/IP 단위 window 상한. 외부 유료 API·LLM·메일 호출 경로는 필수 | denial-of-wallet |

**표면 균질성 원칙**: 한 endpoint에 있는 가드가 형제 endpoint에 없으면 그 **부재 자체가 결함**이다.
"선례를 따랐다"는 주석은 이행 증거가 아니다 — 실제 코드에 가드가 있어야 한다. 신규 handler를 추가할 때는
기존 handler 중 가장 방어 수준이 높은 것을 기준선으로 삼는다(가장 낮은 것에 맞추지 않는다).

**클라이언트 검증은 서버 검증을 대체하지 않는다.** 특히 "로컬 상태를 서버로 mirror push"하는 스냅샷 동기화 endpoint는
클라이언트가 보낸 배열을 그대로 저장하기 쉬운데, `Array.isArray` 확인만으로는 부족하다 — 행 단위 스키마 검증과
배열 길이·문자열 길이 상한이 서버에 있어야 한다(실사고: 클라이언트 zod 검증이 pull 경로에만 있고 push 경로가 무방비였다).

**env 미설정 시 방향**: 소유자 제한(allowlist) 같은 보호가 env로 켜지는 구조라면, 유료 자원을 쓰는 경로는
env 미설정 시 **fail-closed**(503)로 막는다. 편의를 위한 fail-open은 서버 키를 쓰지 않는 경로에만 허용하고
그 선택을 코드 주석과 HANDOFF에 남긴다.

구현 후 `security-reviewer`의 API 표면 균질성 매트릭스(endpoint × 5종 가드)를 채워 공백이 없음을 보인다.

## Golden 실행

<!-- repo-only:start -->
하네스 source repo에서는 ancestor ingestion marker와 fixture를 분리하는 전용 runner를 사용한다.

```bash
node .claude/scripts/run-golden-profile.mjs --profile vite-serverless-hybrid --allow-host-execution --write-evidence
```
<!-- repo-only:end -->

host 실행은 T0 진단이다. T1은 실제 격리 CI와 필수 QA 보고서, T2는 checkout 외부 trust root와 Ed25519 attestation이 추가로 필요하다. registry audit은 dependency graph를 외부 registry에 전송하므로 사용자/조직 정책이 허용한 CI에서만 실행한다.

T1 준비 경로는 `.claude/ci/hybrid-t1.yml`이다. 이 파일은 비활성 canonical 제안본이며 플랫폼 승인 후
`.github/workflows/hybrid-t1.yml`로 배치한다. 보호 environment `hybrid-t1-audit`와 격리 러너 label
`web-harness-isolated`가 실제로 프로비저닝되어야 한다. CI는 frozen install → 단일 `--all` cohort →
같은 임시 실행 경계의 `validate-isolated-cohort.mjs` 판정 → bounded evidence upload 순서로 실행한다. 제안본 존재나 환경변수만으로
`ISOLATED_VERIFIED`를 주장하지 않고, 실제 run의 summary artifact가 PASS일 때만 T1로 판정한다.

## Compatible 구현 완료 조건

- 승인된 typed runner로 SPA + API의 종료 가능한 local fixture 확인
- loopback health fixture가 handler 응답을 확인
- HMR이 API 요청에 영향 없이 동작 (React Refresh 살아있음)
- `.env.local`의 서버 env가 handler에서 `process.env`로 읽힘
- production build에서 API deps가 SPA bundle에 섞이지 않음
- Vercel 배포 시 `/api/*` 요청이 serverless function으로 라우팅됨
- typed quality runner의 typecheck/build 진단 통과
- **`api/` 전 endpoint × 5종 가드 매트릭스에 공백이 없음** (§7 — 한 곳이라도 비면 완료 아님)
- `.env*`가 `.gitignore`에 포함되고 커밋된 시크릿이 없음 (`references/env-management-hybrid.md`)
- profile DAG의 `api.unit`·`api.guards`를 포함한 현재 fingerprint receipt가 없으면 해당 검증은 `BLOCKED`다. golden host receipt만으로는 T0이며, 실제 배포·격리 CI·외부 attestation이 없으면 support level은 `compatible`로 유지하고 `certified`로 승격하지 않는다.

## 감지 마커

프로젝트를 이 profile로 인식하는 신호:
- app root의 `api/` 폴더에 `*.ts` handler
- `package.json`에 `@vercel/node`, `@neondatabase/serverless` 등 serverless dep
- `vite.config.ts`에 `configureServer` 미들웨어
- `vercel.json`이 root에 존재하지만 Next.js가 아님

workspace/monorepo의 `client/api/`, `apps/*/api/`는 현재 adapter 감지 범위 밖이다. app root 단일 배치로 정규화하거나 별도 profile 확장 결정을 `NEEDS_DECISION`으로 남긴다.
