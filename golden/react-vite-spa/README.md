# Golden — react-vite-spa

`react-vite-spa` 레인의 **골든 레퍼런스 프로젝트**. 프로덕션 하드닝 Pillar A
(`docs/production-hardening-plan.md`): "certified"의 조작적 정의는 이 골든이 **격리 CI에서
full 릴리스 폐곡선**(`run-quality-gates --all` → attestation → `validate-release-gate`)을 서명
manifest까지 그린으로 재현하는 것이다.

## 게이트 ↔ 스크립트 (react-vite-spa adapter 명령과 1:1)

| adapter check | 명령 | 로컬 검증 |
|---|---|---|
| quality.lint | `pnpm run lint` | ✅ 로컬 |
| quality.typecheck | `pnpm run typecheck` | ✅ 로컬 |
| quality.unit | `pnpm run test` (vitest) | ✅ 로컬 |
| vite.build | `pnpm run build` | ✅ 로컬 |
| vite.production-mock-boundary | `pnpm run test:production-boundary` | ✅ 로컬(build 후) |
| vite.browser | `pnpm run test:e2e` (playwright+axe) | ⏳ CI(브라우저 설치 필요) |
| — signed attestation | `prepare-quality-attestation` → `validate-release-gate` | ⏳ CI(신뢰 CI identity — 로컬 위조 불가) |

## 정직성 (G1)

정적/유닛/빌드 게이트는 로컬에서 실제 green으로 확인한다. e2e와 **서명 attestation은
CI에서만 증명**한다 — 하네스가 로컬 위조를 의도적으로 막아두었기 때문이다. 게이트를 약화시켜
통과시키지 않는다.

## 위치

미러(`.agents`/`.codex`)·스킬 로드에 영향 주지 않도록 repo-root `golden/`(비-미러 경로)에 둔다.
`node_modules`/`dist`는 커밋하지 않는다(`.gitignore`). `pnpm-lock.yaml`은 커밋해 CI의
`--frozen-lockfile` 설치를 재현 가능하게 한다.
