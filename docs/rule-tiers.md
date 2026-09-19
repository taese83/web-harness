# 규칙 층위 — 무엇이 막고, 무엇이 알리는가

개발을 얼마나 제약하는지 한눈에 보고 관리하기 위한 표다. 규칙을 더할 때는 **어느 층인지와 출구**를 먼저 정한다.
막는 규칙이 늘면 사람도 에이전트도 우회한다 — 새 규칙은 알림으로 시작하고, 실측 근거가 쌓이면 막음으로 올린다.

`★` = 2026-09 리서치 반영분(최근 누적). 규칙의 정본은 각 행의 근거 문서이며, 이 표는 색인이다.

## 층 요약

| 층 | 발동 | 막는가 | 출구 |
|---|---|---|---|
| 1. 도구 차단 | 에이전트 도구 호출 순간(훅) | 즉시 거부 | 없음 — 사람이 직접 하거나 정책을 고친다 |
| 2. 단계 게이트 | 단계 진입·통과 시 | 다음 단계로 못 감 | 원인을 고친다. 일부는 선언으로 적용 대상에서 빠진다 |
| 3. lint | 생성 프로젝트의 `pnpm lint`(Gate A·B·C·릴리스) | 게이트를 통해 막음 | 사유를 적은 `eslint-disable` 한 줄 |
| 4. 리뷰 FAIL | QA 리뷰어 판단 | 릴리스 보고에서 막음 | 근거를 들어 반박하거나 사용자가 예외 승인 |
| 5. 멈추고 묻기 | 개발 중 특정 상황 | 사람 결정까지 대기 | 사용자의 답 |
| 6. 알림 | 진단·WARN | 막지 않음 | — |
| 7. 산문 규율 | 에이전트가 읽고 따름 | 기계 강제 없음 | — |

## 1. 도구 차단 (훅)

| 규칙 | 훅 | 근거 |
|---|---|---|
| 비밀 경로(.env·.ssh·키·credential) 읽기·검색 금지 | `enforce-sensitive-access` | `sensitive-access-policy-lib.mjs` |
| 서브에이전트 Bash는 승인된 명령 계약만(셸 재진입·네트워크·파괴 명령 금지) | `enforce-global-bash-policy` | `global-bash-policy-lib.mjs` |
| 검증 에이전트는 읽기·검사 명령만 | `enforce-verifier-bash` | 같은 파일 |
| 브라우저 코드에 모델 자격증명·provider SDK·직접 호출 금지, 부수효과 도구는 승인·멱등 필수 | `enforce-ai-safety` | 스크립트 본문 |
| 쓰기는 스펙 `layerMap` ∩ 스폰 범위(`ALLOWED_PATHS`)만, developer 쓰기는 체크아웃당 한 스폰 | `enforce-agent-ownership` + write lease | `phase-3-development.md` |
| `HANDOFF.md`는 릴리스 게이트 통과 뒤에만 | `enforce-release-gate` | `release-gate-lib.mjs` |

## 2. 단계 게이트

| 규칙 | 시점 | 출구·적용 조건 | 근거 |
|---|---|---|---|
| 스펙 확정: 미결정(`open`) 0, 아키텍처 사유, 레이어 겹침 없음, `layerDependencies`는 전 레이어 ★ | Phase 3 전 | 필드를 안 쓰면 해당 검사 없음 | `solution-design-contract.md` §6 |
| Gate 0 개발 착수 준비(스펙 신선도·소유권 예행·환경) | 첫 줄 전 | `--fix`가 기계적 항목을 닫음 | `development-gates-contract.md` |
| Gate A0 의존성 pin 실재·peer 호환 | install 전 | 네트워크 없으면 skip | 같은 문서 |
| Gate A·B·C typecheck·lint·build | 각 단계 뒤 | — | 같은 문서 |
| 레이어 방향 위반 ★ | Gate B·C | 선언이 없으면 `NOT_DECLARED`(막지 않음) | `validate-layer-boundaries.mjs` |
| Gate R 요구사항 표기 · Gate D 디자인 토큰 · Gate L 산출물 언어 | 해당 단계 | Gate D는 `designSource` 선언 시만 | 같은 문서 |
| 스폰 완결 마커(`SPAWN_RESULT`) | 스폰마다 | — | `execution-budget-contract.md` |
| 릴리스 필수 QA 리포트(기본 7종 + 조건부: 상태·분석·시각·성능·SEO ★·시계열·수집·데이터 접근) | 릴리스 | 조건 산출물·선언이 없으면 요구 안 함 | `release-report-policy.mjs` |
| 공개 노출 선언이면 SEO QA 필수 ★ | 릴리스 | `PUBLIC_EXPOSURE: no` | 같은 파일 |
| CI에서 재시도로 통과한 테스트는 실패 ★ | 브라우저 테스트 | — | 템플릿 `PLAYWRIGHT_CONFIG` |

## 3. lint (생성 템플릿 react-vite-spa)

| 규칙 | 대상 | 근거 |
|---|---|---|
| enum·`export *`·`React.FC` 금지, TODO 금지, 타입 import, 불리언·제네릭 명명, 미사용 `_`, 파일명 kebab | `ts·tsx` | `ts-conventions.md` |
| jsx-a11y recommended, react-hooks 7 recommended(컴파일러 규칙 포함) | `tsx` | 템플릿 `ESLINT_CONFIG` |
| FSD 경계(별칭 import) | 레이어 | `environment-scaffolder.md` 15 |
| testing-library `flat/react` + `prefer-user-event` ★ | `src/**/*.{test,spec}` | `testing.md` |
| playwright `flat/recommended` + 고정 대기·조건 없는 skip error ★ | `e2e/**` | `testing.md` |
| TanStack Query `flat/recommended`(쿼리 키 누락 등) ★ | `ts·tsx` | `performance-patterns.md` §9 |

다른 형태(Next·하이브리드·기존 프로젝트)에서는 같은 규칙이 산문이다.

## 4. 리뷰 FAIL (릴리스 보고에 반영)

| 규칙 | 리뷰어 |
|---|---|
| 토큰·세션·credential을 브라우저 저장소·persist에 저장 | code-reviewer · security-reviewer |
| 범위 밖 변경·요청 없는 public contract 변경·사용자 변경 덮어쓰기 | code-reviewer |
| 상태 불변식(Partial 엔티티 변경, 화면 index로 원본 명령) | code-reviewer |
| 테마 경로 부재, 수집 산출물 누락을 성공 처리 | code-reviewer |
| 복사한 프리미티브의 접근성 배선 제거, dialog·sheet 이름 없음 ★ | code-reviewer 10-1 |
| 인증 필드 붙여넣기 차단 ★, 대체 없는 포커스 표시 제거 ★ | code-reviewer 10 |
| 추적된 비밀 파일(프로필별) ★, 의존성 high·critical, 레지스트리 밖 소스 | security-reviewer |
| 서버 엔드포인트 방어 불균질, 클라이언트 신뢰 저장 | security-reviewer |

## 5. 멈추고 묻기

| 상황 | 근거 |
|---|---|
| 확정 스펙을 바꾸거나 더해야 할 때(권장안이 있어도) ★ | `phase-3-development.md` 「개발 중 스팩 변경」 |
| 화면 조건(빈 상태·오류·권한 없음)의 근거가 없을 때 — 인수 기록이 있으면 진행 | `developer.md` |
| 스펙에 없는 동작(TC)을 만들어야 할 때 | `phase-3-development.md` |
| `ALLOWED_PATHS` 밖, 확정 계약과 충돌, 되돌리기 어렵거나 팀 전체 영향 | 같은 문서 |
| PR 생성 직전 | 같은 문서 |
| 호스트에서 프로젝트 스크립트 첫 실행(프로젝트당 1회) | `host-execution-grant.mjs` |

## 6. 알림 (막지 않음)

| 신호 | 근거 |
|---|---|
| 재사용 목록 대조 — 새 export 미사용·이름 중복 ★ | `reuse-inventory.mjs` |
| 미사용 파일·export·의존성(knip, 있음/없음) ★ | `run-quality-gates --check deadcode` |
| 레이어 방향 `NOT_DECLARED`·`INCOMPLETE` ★ | `validate-layer-boundaries.mjs` |
| 디자인 부채 청구, 스펙 정합 note, 중복·재사용 리팩토링 제안 | 각 문서 |
| code-reviewer·security-reviewer의 WARN | 각 에이전트 |

## 7. 산문 규율 (기계 강제 없음)

| 규율 | 근거 |
|---|---|
| 쓰는 곳에 두고 두 번째 사용처에서 추출(pages-first) ★ | `fsd-rules.md` |
| 만들기 전 재사용 목록 확인 ★ | `developer.md` |
| 커스텀 훅 기준(훅을 부를 때만 `use`, 수명주기 래퍼 금지) ★ | `ts-conventions.md` |
| 테스트 작성 규약(관찰 가능한 동작, 접근성 쿼리 우선) ★ | `testing.md` |
| 컴파일러 on이면 새 수동 memo 금지 ★ | `developer.md` |
| 주석 최소화, TODO 대신 스펙 왕복 | `developer.md` |
| 한 커밋 = 한 변화, 테스트·기능 분리 커밋 ★, 하네스 산출물·코드 분리 | `phase-3-development.md` |
| 스타일 우선순위(레인 공개 API → 토큰 → 국소 조정) | `mui-styling.md` · `tailwind-shadcn-styling.md` |
| 측정 후 최적화(memo·분할·prefetch) | `performance-patterns.md` |

## 새 규칙을 넣을 때

1. 층을 정한다 — 안전 하한(I6)이 아니면 **알림이나 산문으로 시작**한다.
2. 막는 규칙에는 **출구**를 함께 둔다(선언으로 빠지기, 사유 있는 disable, 사용자 승인).
3. 막음으로 올리는 근거는 실측이다 — 하네스 자기 산출물이 아니라 실제 프로젝트에서 놓친 사례.
4. 이 표에 한 줄을 더한다.
