---
name: next-app
description: Build or extend a Next.js App Router application through the next-app-fullstack adapter. Use for greenfield or existing Next App Router work that needs Server Components, Route Handlers, Server Actions, SSR/SSG/ISR, authenticated BFF behavior, or Node/static deployment while preserving profile, security-boundary, cache, and evidence contracts; Docker release remains blocked pending typed OCI evidence.
argument-hint: "[project root and requested Next.js change]"
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Write, Edit, Bash, Agent, AskUserQuestion
metadata:
  version: 1.1.0
  maturity: contract-only
  updated: 2026-08-04
  changelog: 풀스택 Track 2 — backend-patterns-contract 신설·연결. Route Handler·Server Action의 엔드포인트 가드 5종(§7 이식)·트랜잭션 경계·idempotency 레시피·업로드·작업 위임·에러 envelope·서버 관측을 runtime-builder 선행 계약과 contract-verifier FAIL 기준으로 강제.
---

# Next App

`react-vite-spa`와 `next-app-fullstack`을 같은 구현 경로로 취급하지 않는다. profile resolver의 JSON 결과를 기준으로 Next App Router 경로만 실행한다.

## 1. Resolve and preserve the profile

1. 프로젝트 루트에서 다음 resolver를 실행한다.
   ```bash
   node .claude/scripts/web-core/resolve-profile.mjs --project-root {project-root} --requested {auto|next-app-fullstack} [--provider vercel] [--deployment node-server|static-export] [--capability ...]
   ```
2. stdout의 JSON을 변경하지 말고 `_workspace/01_plan/project-profile.json`에 기록한다. 오류 JSON이나 non-zero exit를 성공으로 변환하지 않는다.
3. `profileId`에 따라 분기한다.
   - `react-vite-spa`: 이 skill을 중단하고 기존 Vite 개발 경로로 반환한다.
   - `next-app-fullstack`: 계속 진행한다.
   - 그 외 또는 충돌/모호성: `BLOCKED`로 반환한다.
4. `.claude/adapters/next-app-fullstack/adapter.json`의 `supportLevel`을 확인한다. golden production runtime evidence가 승인되기 전에는 `compatible`을 `certified`로 표현하지 않는다.
5. 다음 plan을 컴파일하고 결과 JSON을 모든 profile의 canonical 경로인 `_workspace/03_dev/web-execution-plan.json`에 그대로 기록한다.
   ```bash
   node .claude/scripts/web-core/compile-execution-plan.mjs --profile-file _workspace/01_plan/project-profile.json
   ```
6. crawler, scheduled sync 또는 generated runtime artifact가 감지되면 두 ingestion 계약과 locked `external-ingestion` capability가 없을 때 중단한다. `static-snapshot`+scheduled이면 `scheduled-static-ingestion`도 필수다.

## 2. Apply scope hard stops

구현 전에 package, app roots, Next config, deployment files를 검사한다. 다음 중 하나가 있으면 자동 변환하거나 우회하지 말고 `BLOCKED`로 반환한다.

- Pages Router 전용 또는 `app`/`pages` 혼합 router
- `runtime = 'edge'` 또는 Edge 전용 배포 요구
- custom Next server
- cache/revalidation coordination 계약이 없는 multi-instance topology
- `app`과 `src/app` 동시 사용

사용자가 범위 확장을 명시하면 별도 migration/experimental profile과 검증 예산을 먼저 제안한다. 이 skill 안에서 기존 `next-app-fullstack` 인증 범위로 가장하지 않는다.

## 3. Lock the design contract

구현 전에 [App Router boundary contract](../../adapters/next-app-fullstack/references/app-router-boundary-contract.md), [rendering/deployment contract](../../adapters/next-app-fullstack/references/rendering-deployment-contract.md), [backend patterns contract](../../adapters/next-app-fullstack/references/backend-patterns-contract.md)를 읽는다. backend patterns는 Route Handler·Server Action의 엔드포인트 가드 5종(method·인증·body 캡·스키마·rate limit), 트랜잭션 경계, idempotency, 업로드, 작업 위임, 에러 envelope, 서버 관측을 강제한다 — endpoint × 가드 매트릭스에 공백이 있으면 완료가 아니다.

두 계약 문서(`next-contract-matrices.md`, `build-environment.json`)는 오케스트레이터가 직접 작성하지 않고 **`next-contract-designer`** subagent에게 위임한다 (resolved profile, plan 산출물, 기존 소스 구조를 입력으로 전달). subagent 실행이 불가능한 환경에서만 같은 계약을 현재 에이전트가 직접 작성한다.

`_workspace/02_design/next-contract-matrices.md`에 아래 exact heading의 여섯 표가 모두 있어야 한다. 요구사항과 기존 설계에서 확정할 수 없는 보안·배포 결정은 추측하지 말고 `BLOCKED`로 둔다.

1. `## Route Matrix`: path, method, rendering, request input, status, metadata
2. `## Server Client Boundary Matrix`: client entry, server-only module, serializable DTO
3. `## Authorization Matrix`: page/handler/action, session, role/resource/tenant authorization, CSRF/idempotency
4. `## Environment Matrix`: name, public/private, build/runtime, consumer, redaction
5. `## Cache Matrix`: data class, scope/key partitions, freshness, invalidation, isolation test
6. `## Deployment Matrix`: target, runtime, artifact, health/shutdown, promotion/rollback

environment matrix의 public build 변수 이름만 다음 machine contract에도 기록한다. 값은 기록하지 않으며 secret/token/password/credential 이름은 public 목록에 둘 수 없다.

```json
{"schemaVersion": 1, "public": ["NEXT_PUBLIC_EXAMPLE"]}
```

출력 경로: `_workspace/02_design/build-environment.json`

같은 문서에 exact Next.js/Node/pnpm versions, `app|src/app` root, cache model, 현재 활성화된 `node-server|static-export` target을 고정한다. `docker-standalone`은 typed OCI digest broker가 추가될 때까지 `BLOCKED`다. static export에서 server identity, Server Actions, ISR, request-dependent handler 또는 불완전 dynamic route가 필요하면 구현 전 `BLOCKED`다.

## 4. Implement by ownership

다음 순서를 지킨다.

1. 기존 `environment-scaffolder`에게 resolved profile, version lock, execution plan, deployment matrix를 전달한다. package metadata와 scripts만 맡긴다. install은 기존 승인 정책을 따른다.
   - package metadata가 완성되면 같은 deployment/capabilities로 profile resolver를 다시 실행하고 canonical `web-execution-plan.json`을 다시 컴파일한다. 초기 scaffold profile digest를 quality 단계에 재사용하지 않는다.
2. `environment-scaffolder`에게 config/tooling 기반만 맡기되 **Next 계약으로 스폰한다** — Vite 전용 설정(`vite.config.ts`·Vite 플러그인·Vite 전용 test 설정)을 Next 경로에 만들지 않는다.
3. `developer`에게 App Router source를 맡긴다. Server Component를 기본으로 하고 client boundary, handler/action authorization, private env, cache 계약을 지킨다.
4. locked capability에 `external-ingestion`이 있으면 `developer`에게 두 ingestion 계약을 전달하고 runtime schema, quality validation, atomic promotion과 last-known-good만 맡긴다. Next route/runtime가 crawler output shape를 추론하게 하지 않는다.
5. 기존 `environment-scaffolder`, `developer`에게 six matrices와 Next adapter 계약을 함께 전달한다. external ingestion이면 deterministic empty/drift/partial/count-drop/LKG fixture도 전달한다. production source를 테스트에 맞춰 수정하게 하지 않는다.
6. 배포 산출물이 요구되면 `environment-scaffolder`에게 deployment matrix와 immutable artifact/rollback 계약을 전달한다. `scheduled-static-ingestion`이면 refresh workflow를, provider가 Vercel이면 root/app `vercel.json`을 같은 에이전트에게 **별도 스폰**으로 맡긴다 — 산출물이 다르므로 스폰을 나눈다.

Writable agent는 Bash를 사용하지 않는다. 각 구현 agent의 완료는 파일/계약 작성 완료만 뜻한다. build, test, deploy가 실행됐거나 통과했다고 말하지 않는다.

## 5. Verify without promoting trust

검증 전에 [QA/evidence contract](../../adapters/next-app-fullstack/references/qa-evidence-contract.md)를 읽는다.

1. 로컬 진단은 공통 quality runner를 실행해 실제 exit와 source fingerprint receipt를 남긴다. 이 명령은 generated project의 package script를 실행하므로 **프로젝트당 첫 실행은 `--allow-host-execution` 승인**이 필요하고, 그 승인은 기록돼 이후에는 다시 묻지 않는다(`development-gates-contract.md` 공통 규칙).
   ```bash
   node .claude/scripts/run-quality-gates.mjs --all --project {project-root} --allow-host-execution
   ```
2. release 후보는 격리 CI에서 `WEB_HARNESS_ISOLATED_EXECUTION=1 node .claude/scripts/run-quality-gates.mjs --all --project {project-root}`로 receipt를 다시 만든다. `external-ingestion`에서는 built-in semantic validation을 포함한 `ingestion` receipt가 같은 cohort에 없으면 중단한다. checkout 밖의 protected trust digest와 CI provenance를 주입하고, `prepare-quality-attestation.mjs`의 unsigned request를 project 밖의 trusted attester가 CI/OIDC·격리·frozen install과 독립 대조한다. 일치할 때만 final subject를 구성·서명해 `quality-attestation.json`을 작성한다. 로컬 receipt와 environment flag만으로는 격리를 증명하지 않는다. `docker-standalone`은 typed OCI digest broker가 없으므로 profile resolution에서 `BLOCKED`다.
3. 서명 완료 후 `node .claude/scripts/web-core/validate-next-contracts.mjs --project {project-root}`의 machine result를 확인한다. 그 다음 `next-contract-verifier`를 호출해 profile, matrices, source, build artifact, receipt freshness, attestation, secret/auth/cache/deployment hard stop을 읽기 전용으로 판정하고 반환 본문을 `_workspace/04_qa/qa-next-contract.md`에 저장한다.
4. verifier의 Markdown 문구를 machine receipt로 사용하지 않는다. 실행하지 않은 command, 없는 runtime, 누락된 golden fixture를 PASS로 기록하지 않는다.
5. adapter 전용 receipt, trusted attestation 또는 production golden evidence가 아직 없으면 구현 결과를 `COMPATIBLE_IMPLEMENTED`로 보고하되 release/certification은 `BLOCKED`로 유지한다.
6. source, lockfile, config, matrices, adapter, trust configuration 또는 deployment가 바뀌면 downstream evidence를 stale 처리하고 quality runner부터 다시 실행한다.

## Output

다음을 반환한다.

- resolved profile ID와 support level
- 생성/수정된 파일과 owner agent
- six matrix completeness와 남은 blocker
- 관찰된 receipt ID/fingerprint/status만 포함한 QA 요약
- `COMPATIBLE_IMPLEMENTED | VERIFIED_FOR_CURRENT_FINGERPRINT | BLOCKED`

실제 deploy/rollback은 별도 승인과 target evidence 없이는 수행하거나 성공으로 표현하지 않는다.
