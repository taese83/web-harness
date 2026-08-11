# Golden — vite-serverless-hybrid

`vite-serverless-hybrid` built-in profile의 재현 가능한 golden fixture다. Vite SPA, 루트 `api/`
Vercel Functions, §7 공통 가드 5종, loopback health, 브라우저 경로와 production bundle 경계를 함께 검증한다.

## 검증 범위

| adapter check | 명령 | 범위 |
|---|---|---|
| quality.lint | `pnpm run lint` | TS/React/API 정적 규칙 |
| quality.typecheck | `pnpm run typecheck` | client/API/test strict typecheck |
| quality.unit | `pnpm run test` | client 단위 동작 |
| api.unit | `pnpm run test:api` | handler 동작 + loopback health |
| api.guards | `pnpm run test:api-guards` | 모든 endpoint × method/auth/body/schema/rate-limit |
| vite.build | `pnpm run build` | strict typecheck 후 production SPA build |
| vite.production-mock-boundary | `pnpm run test:production-boundary` | server secret/guard/mock 문자열의 client bundle 유출 차단 |
| vite.browser | `pnpm run test:e2e` | SPA route, Vite middleware `/api/health`, axe |
| coverage | `pnpm test:coverage` | client/API/guard/loopback 통합 커버리지 |
| audit | `pnpm audit --prod --registry=https://registry.npmjs.org` | 운영 의존성 advisory 감사 |

## 실행

```bash
pnpm install --frozen-lockfile --ignore-scripts
node ../../.claude/scripts/run-golden-profile.mjs \
  --profile vite-serverless-hybrid --allow-host-execution --write-evidence
```

전용 runner는 fixture를 저장소 밖 임시 루트로 복제해 ancestor ingestion fail-closed와 실제 fixture
검증을 분리한다. 원본 설치 그래프는 frozen lockfile과 일치해야 하며, 요청한 경우 receipt만 원본의
ignore된 evidence 경로로 되가져온다.

로컬 실행은 `T0 DIAGNOSTIC_VERIFIED`까지만 주장할 수 있다. T1은 격리 CI의 단일 `--all` cohort와
필수 QA 보고서가 필요하고, T2는 checkout 외부의 신뢰 identity와 Ed25519 attester가 추가로 필요하다.
이 fixture나 `WEB_HARNESS_ISOLATED_EXECUTION=1` 환경 변수만으로 `RELEASED`·`certified`를 주장하지 않는다.

## T1 격리 CI 준비

비활성 canonical 제안본은 `.claude/ci/hybrid-t1.yml`에 있다. 플랫폼 승인 후
`.github/workflows/hybrid-t1.yml`로 배치하고, 보호 environment `hybrid-t1-audit`와
`web-harness-isolated` runner를 프로비저닝한다. 실제 수동 run은 frozen install, 단일 `--all` cohort,
필수 QA report와 source fingerprint 검증, bounded artifact upload 순서로 실행한다. summary의 revision은
workflow 선언값이며, commit과 evidence의 외부 신뢰 결속은 T2 attestation에서 완성한다.

업로드된 `evidence/t1-summary.json`이 `ISOLATED_VERIFIED`일 때만 T1이다. 제안본 체크인, 환경변수 설정,
로컬 재실행은 T1 증거가 아니다.

## 배포 계약 근거

- Vercel은 SPA fallback으로 `/(.*) → /index.html` rewrite를 안내한다.
- 파일시스템과 Vercel Functions가 rewrite보다 먼저 처리되므로 루트 `api/`가 fallback에 삼켜지지 않는다.
- Node.js Vercel Functions는 Web Standard `Request`/`Response` handler를 지원한다.

공식 문서: [Vercel project configuration](https://vercel.com/docs/project-configuration/vercel-json),
[Vercel Node.js runtime](https://vercel.com/docs/functions/runtimes/node-js).
